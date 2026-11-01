// Free trial for the web version: anyone who signs in through Cloudflare Access gets
// TRIAL_DAYS from their first visit. People on the allowlist (written to KV by
// tools/sync_access.py from ACCESS_LIST) are never limited. A KV entry "allow:<email>"
// added by hand in the Cloudflare dashboard also admits that person: its value is the
// last day of access (YYYY-MM-DD, UTC, Arabic or Persian digits accepted) or any other
// text for no end date. Signed-in requests are checked only on page loads; audio, font and script
// requests pass straight through. Requests without a verified sign-in get only the public pages.
import { TRIAL_DAYS, DAY, CONTACT, accessEmail, lastDay, today } from '../lib/trial.js';

const ENDED = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>انتهت الفترة التجريبية</title>
<style>body{font:17px/1.9 Tahoma,Arial,sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;text-align:center;color:#14263A;background:#EEF4F3}
h1{color:#12807F;font-size:24px}a{color:#12807F}</style></head><body>
<h1>انتهت فترتك التجريبية</h1>
<p>شكراً لتجربتك تطبيق «الفارسية من الصفر». انتهت مدة التجربة المجانية (${TRIAL_DAYS} أيام).</p>
<p>للاستمرار تواصل معنا: <a href="mailto:${CONTACT}" dir="ltr">${CONTACT}</a></p>
</body></html>`;

const PAGES = new Set(['/', '/index', '/index.html']);

// Without a verified sign-in only the public pages may be served. They carry data-public on their
// <html> tag; anything else (the app, or the app served as a fallback for an unknown path) is refused.
// This also covers hosts Access does not cover, like a deployment's own *.pages.dev address.
const PUBLIC = ['/welcome', '/fonts/', '/pwa/'];

async function publicOnly(request, next) {
  const url = new URL(request.url);
  if (!PUBLIC.some((p) => url.pathname.startsWith(p))) return Response.redirect(url.origin + '/welcome/', 302);
  const res = await next();
  if (res.status >= 300 && res.status < 400) return res; // e.g. /welcome -> /welcome/
  if (!(res.headers.get('Content-Type') || '').includes('text/html')) return res; // images and fonts
  const html = await res.text();
  if (!/<html[^>]*\bdata-public\b/.test(html)) return new Response('Not found', { status: 404 });
  const headers = new Headers(res.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(html, { status: res.status, headers });
}

export async function onRequest({ request, env, next }) {
  const email = await accessEmail(request);
  if (!email) return publicOnly(request, next);
  if (!PAGES.has(new URL(request.url).pathname) || !env.TRIALS) return next();

  const allowed = (await env.TRIALS.get('allowlist', 'json')) || [];
  if (allowed.includes(email)) return next();

  const allow = await env.TRIALS.get('allow:' + email);
  if (allow !== null) {
    const until = lastDay(allow);
    if (!until || today() <= until) return next();
    return ended();
  }

  const key = 'trial:' + email;
  let start = Number(await env.TRIALS.get(key));
  if (!start) {
    start = Date.now();
    await env.TRIALS.put(key, String(start));
  }
  if (Date.now() - start < TRIAL_DAYS * DAY) return next();
  return ended();
}

function ended() {
  return new Response(ENDED, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
