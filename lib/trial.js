// Shared by functions/_middleware.js (the trial check) and functions/admin.js (the admin page).
import { readSession } from './auth.js';
export const TRIAL_DAYS = 7;
export const DAY = 864e5;
export const CONTACT = 'languageparsa777@gmail.com';

// The Cloudflare Access team that signs people in. Its tokens are checked against its public keys,
// so a forged header or cookie is never taken as a signed-in email.
export const TEAM = 'https://parsa-farsi-pages.cloudflareaccess.com';

let keys = null;
let keysAt = 0;

async function accessKeys(refresh) {
  if (keys && !refresh && Date.now() - keysAt < 3600e3) return keys;
  const res = await fetch(TEAM + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('certs ' + res.status);
  const found = {};
  for (const k of (await res.json()).keys || []) {
    found[k.kid] = await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  keys = found;
  keysAt = Date.now();
  return keys;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function token(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : '';
}

// The signed-in email, or '' when the request carries no valid sign-in: the app's own session cookie
// (lib/auth.js), or a Cloudflare Access token from before the app had its own sign-in.
export async function accessEmail(request, env) {
  const own = await readSession(request, env && env.TRIALS);
  if (own) return own.email;
  const jwt = token(request);
  const parts = jwt.split('.');
  if (parts.length !== 3) return '';
  try {
    const head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const body = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (head.alg !== 'RS256' || body.iss !== TEAM || !(body.exp * 1000 > Date.now())) return '';
    let key = (await accessKeys(false))[head.kid];
    if (!key) key = (await accessKeys(true))[head.kid];
    if (!key) return '';
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed))) return '';
    return String(body.email || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

// The last day of an "allow:" entry (YYYY-MM-DD, Arabic or Persian digits accepted), or null for no end date.
export function lastDay(value) {
  const v = value.trim()
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Access status of a signed-in email, used by the page check (functions/_middleware.js, which also
// starts the trial on the first visit) and by the app (functions/api/me.js, which only reads it).
// kind: 'list' (ACCESS_LIST, no end), 'member' (an allow: entry; until = last day or null for no end),
// 'trial' (until = the trial's end time). ok: whether access is open now; left: whole days left.
export async function accessStatus(kv, email, startTrial) {
  if (((await kv.get('allowlist', 'json')) || []).includes(email)) return { kind: 'list', ok: true };
  const allow = await kv.get('allow:' + email);
  if (allow !== null) {
    const until = lastDay(allow);
    if (!until) return { kind: 'member', until: null, ok: true };
    const left = Math.floor((Date.parse(until + 'T23:59:59Z') - Date.now()) / DAY) + 1;
    return { kind: 'member', until, ok: today() <= until, left: Math.max(0, left) };
  }
  const key = 'trial:' + email;
  let start = Number(await kv.get(key));
  if (!start) {
    if (!startTrial) return { kind: 'trial', ok: true, left: TRIAL_DAYS, started: false };
    start = Date.now();
    await kv.put(key, String(start));
  }
  const end = start + TRIAL_DAYS * DAY;
  return { kind: 'trial', ok: Date.now() < end, left: Math.max(0, Math.ceil((end - Date.now()) / DAY)), until: new Date(end).toISOString() };
}
