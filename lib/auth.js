// The app's own sign-in: a 6-digit code sent by email, then a signed session cookie.
// - The session cookie "ps" holds the email and an expiry, signed with HMAC-SHA256. Checking it needs
//   no storage, so signed-in requests cost no KV reads or writes. It lasts SESSION_DAYS and is renewed
//   by /api/me when fewer than RENEW_DAYS are left, so active learners stay signed in.
// - The signing key is created once and kept in KV as "authkey".
// - A pending code is kept in KV as "code:<email>" for 10 minutes, as a salted hash, with a limit on
//   wrong attempts. Codes are sent by the Google Apps Script in tools/mail-sender.gs (MAIL_URL, MAIL_KEY).

export const SESSION_DAYS = 30;
const RENEW_DAYS = 7;
const DAY = 864e5;
export const CODE_MINUTES = 10;
export const MAX_TRIES = 5;
export const RESEND_SECONDS = 60;
export const MAX_SENDS_PER_DAY = 5; // per email
export const MAX_MAILS_PER_DAY = 90; // in all; consumer Gmail sends up to 100 a day

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let keyCache = null;
async function hmacKey(kv) {
  if (keyCache) return keyCache;
  let raw = await kv.get('authkey');
  if (!raw) {
    raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await kv.put('authkey', raw);
  }
  keyCache = await crypto.subtle.importKey('raw', unb64url(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return keyCache;
}

export async function makeSession(kv, email) {
  const body = b64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * DAY })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(kv), enc.encode(body));
  return body + '.' + b64url(sig);
}

// {email, exp} of a valid session cookie, or null.
export async function readSession(request, kv) {
  if (!kv) return null;
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)ps=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(kv), unb64url(sig), enc.encode(body)))) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!s.e || !(s.x > Date.now())) return null;
    return { email: String(s.e), exp: s.x };
  } catch (e) {
    return null;
  }
}

export function sessionCookie(value) {
  return `ps=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const CLEAR_COOKIE = 'ps=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
export const needsRenewal = (s) => s.exp - Date.now() < RENEW_DAYS * DAY;

export async function codeHash(kv, email, code) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(kv), enc.encode('code|' + email + '|' + code));
  return b64url(sig);
}

export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return /^[^\s@<>"']{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : '';
}

// Throwaway inbox services, refused so the free trial cannot be restarted again and again.
const DISPOSABLE = new Set(('mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la ' +
  '10minutemail.com 10minutemail.net temp-mail.org temp-mail.io tempmail.com tempmail.net tempmailo.com tempr.email ' +
  'yopmail.com yopmail.net yopmail.fr throwawaymail.com trashmail.com trashmail.de getnada.com nada.email ' +
  'dispostable.com maildrop.cc mailnesia.com mintemail.com mohmal.com emailondeck.com fakeinbox.com ' +
  'mailcatch.com spamgourmet.com tempinbox.com moakt.com tmail.ws tmpmail.org tmpmail.net mail.tm ' +
  'mailpoof.com burnermail.io inboxkitten.com emailfake.com email-fake.com fakemail.net 33mail.com ' +
  'discard.email cs.email tempmail.plus minuteinbox.com luxusmail.org dropmail.me spambox.us').split(' '));
export const isDisposable = (email) => DISPOSABLE.has(email.split('@')[1]);
