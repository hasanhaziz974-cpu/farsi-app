// ZainCash online payment (lib/zaincash.js), for the signed-in learner:
//   POST {plan}      creates the payment and answers {url}: the app sends the learner to the gateway's page.
//   GET ?check=<ref> asks the gateway about the learner's own payment (when they come back to the app without
//                    passing the return address): {st: 'paid' | 'pending' | 'failed' | 'unknown'}.
import { accessEmail } from '../../lib/trial.js';
import { zcReady, amountOf, createPayment, settle, PLAN_DAYS } from '../../lib/zaincash.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  if (!email || !kv) return json({ error: 'signin' }, 401);
  const cfg = (await kv.get('paycfg', 'json')) || {};
  if (!cfg.zc || !zcReady(env)) return json({ error: 'off', msg: 'الدفع الإلكتروني غير مفعّل الآن.' }, 503);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const ref = url.searchParams.get('check') || '';
    const o = /^[0-9a-f-]{36}$/.test(ref) ? await kv.get('zco:' + ref, 'json') : null;
    if (!o || o.email !== email) return json({ st: 'unknown' });
    try { return json({ st: await settle(env, kv, ref) }); } catch (e) { return json({ st: 'pending' }); }
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  const plan = String(body && body.plan || '');
  const amount = amountOf(cfg.prices && cfg.prices[plan]);
  if (!(plan in PLAN_DAYS) || amount < 250) return json({ error: 'plan', msg: 'هذه الباقة غير متاحة للدفع الإلكتروني.' }, 400);
  // At most a few payment pages a day for one learner (each creates a transaction at the gateway).
  const day = new Date().toISOString().slice(0, 10), nk = 'zcn:' + email + ':' + day, n = Number(await kv.get(nk)) || 0;
  if (n >= 8) return json({ error: 'limit', msg: 'حاولت الدفع مرات كثيرة اليوم. حاول غداً أو راسلنا.' }, 429);
  await kv.put(nk, String(n + 1), { expirationTtl: 2 * 86400 });
  try {
    return json(await createPayment(env, kv, { email, plan, amount, origin: url.origin }));
  } catch (e) {
    return json({ error: 'gateway', msg: 'تعذّر فتح صفحة الدفع الآن. حاول بعد قليل.' }, 502);
  }
}
