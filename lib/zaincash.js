// Online payment with ZainCash (payment gateway v2, https://docs.zaincash.iq): the learner pays in the
// gateway's own page and their subscription is extended at once, with no WhatsApp receipt.
//
// Settings, entered by the site owner in Cloudflare Pages (Settings > Variables and Secrets), never in the code:
//   ZC_CLIENT_ID, ZC_CLIENT_SECRET  the merchant's credentials (Secret type)
//   ZC_BASE                         the gateway address; without it the test environment (UAT) is used
// It is switched on in /admin («الدفع الإلكتروني بزين كاش»), and works only when both ids are set.
//
// A payment is trusted only after asking the gateway itself (transaction inquiry, with our own token) that the
// transaction we created is SUCCESS for the same reference and amount; the token on the return address is not needed.
import { DAY, lastDay, today } from './trial.js';

export const UAT = 'https://pg-api-uat.zaincash.iq';
export const PLAN_DAYS = { month: 30, quarter: 90, half: 180, year: 365, forever: 0 };
const ORDER_TTL = 3 * 86400; // an unpaid order is forgotten after 3 days; a paid one is kept
const PAID = new Set(['SUCCESS', 'COMPLETED']);
const ENDED = new Set(['FAILED', 'EXPIRED', 'REFUNDED']);

export const zcReady = (env) => !!(env && env.ZC_CLIENT_ID && env.ZC_CLIENT_SECRET);
const base = (env) => String(env.ZC_BASE || UAT).replace(/\/+$/, '');

// "5,000 دينار", "٥٠٠٠" -> 5000; 0 when the price has no number.
export function amountOf(price) {
  const d = String(price || '')
    .replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660)
    .replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0)
    .replace(/[,،٬.\s]/g, '')
    .match(/\d+/);
  return d ? Number(d[0]) : 0;
}

// The OAuth2 token, kept in KV until shortly before it expires (one KV write a day).
async function token(env, kv) {
  return (await fetchToken(env, kv, false)).t;
}

// The admin page's «افحص الاتصال» asks for a fresh token: {ok, status}. No payment is made.
export async function testConnection(env, kv) {
  try { await fetchToken(env, kv, true); return { ok: true }; } catch (e) { return { ok: false, status: String(e.message || e).replace(/^token /, '') }; }
}

async function fetchToken(env, kv, fresh) {
  const cached = await kv.get('zc:token', 'json');
  if (!fresh && cached && cached.t && cached.b === base(env) && cached.exp > Date.now() + 60e3) return { t: cached.t };
  const r = await fetch(base(env) + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.ZC_CLIENT_ID, client_secret: env.ZC_CLIENT_SECRET, scope: 'payment:read payment:write' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token ' + r.status);
  const life = Math.max(120, Number(j.expires_in) || 3600);
  await kv.put('zc:token', JSON.stringify({ t: j.access_token, b: base(env), exp: Date.now() + (life - 300) * 1000 }), { expirationTtl: Math.max(60, life - 300) });
  return { t: j.access_token };
}

// Creates a payment for one plan; the learner is sent to the returned url.
export async function createPayment(env, kv, { email, plan, amount, origin }) {
  const ref = crypto.randomUUID();
  const t = await token(env, kv);
  const r = await fetch(base(env) + '/api/v2/payment-gateway/transaction/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({
      language: 'ar',
      externalReferenceId: ref,
      orderId: ref,
      serviceType: 'farsi-' + plan,
      amount: { value: String(amount), currency: 'IQD' },
      redirectUrls: { successUrl: origin + '/api/pay/return/' + ref, failureUrl: origin + '/api/pay/return/' + ref },
    }),
  });
  const j = await r.json().catch(() => ({}));
  const tx = j && j.transactionDetails && j.transactionDetails.transactionId;
  if (!r.ok || !tx || !/^https:\/\//.test(String(j.redirectUrl || ''))) throw new Error('init ' + r.status + ' ' + String(j && (j.status || j.message || '')).slice(0, 80));
  await kv.put('zco:' + ref, JSON.stringify({ email, plan, amount, tx, at: Date.now(), st: 'init' }), { expirationTtl: ORDER_TTL });
  return { ref, url: j.redirectUrl };
}

// Asks the gateway for the order's transaction and, the first time it is paid, extends the learner's access.
// Returns 'paid', 'failed' or 'pending' (or 'unknown' for no such order).
export async function settle(env, kv, ref) {
  if (!/^[0-9a-f-]{36}$/.test(String(ref || ''))) return 'unknown';
  const o = await kv.get('zco:' + ref, 'json');
  if (!o) return 'unknown';
  if (o.st === 'paid') return 'paid';
  if (o.st === 'failed') return 'failed';
  const t = await token(env, kv);
  const r = await fetch(base(env) + '/api/v2/payment-gateway/transaction/inquiry/' + encodeURIComponent(o.tx), { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return 'pending';
  const d = j.transactionDetails || {};
  const status = String(j.status || '');
  if (PAID.has(status) && d.externalReferenceId === ref && Number(d.amount && d.amount.value) === Number(o.amount)) {
    await kv.put('zco:' + ref, JSON.stringify({ ...o, st: 'paid', paidAt: Date.now() })); // kept: the admin page lists it
    await extend(kv, o.email, PLAN_DAYS[o.plan]);
    return 'paid';
  }
  if (ENDED.has(status)) {
    await kv.put('zco:' + ref, JSON.stringify({ ...o, st: 'failed' }), { expirationTtl: ORDER_TTL });
    return 'failed';
  }
  return 'pending';
}

// Adds days to an "allow:" entry (from its last day if still running), like the admin page; 0 days = no end.
export async function extend(kv, email, days) {
  if (((await kv.get('allowlist', 'json')) || []).includes(email)) return;
  const key = 'allow:' + email;
  const current = await kv.get(key);
  if (current !== null && !lastDay(current)) return; // already without an end
  if (!days) {
    await kv.put(key, 'دائم');
    return;
  }
  const end = current === null ? null : lastDay(current);
  const from = end && end > today() ? end : today();
  await kv.put(key, new Date(Date.parse(from + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10));
}
