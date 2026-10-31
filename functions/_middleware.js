// Free trial for the web version: anyone who signs in through Cloudflare Access gets
// TRIAL_DAYS from their first visit. People on the allowlist (written to KV by
// tools/sync_access.py from ACCESS_LIST) are never limited. Only page loads are checked;
// audio, font and script requests pass straight through.
const TRIAL_DAYS = 7;
const DAY = 864e5;
const CONTACT = 'languageparsa777@gmail.com';

function accessEmail(request) {
  const direct = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (direct) return direct.trim().toLowerCase();
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return '';
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(part)).email || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

const ENDED = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>انتهت الفترة التجريبية</title>
<style>body{font:17px/1.9 Tahoma,Arial,sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;text-align:center;color:#14263A;background:#EEF4F3}
h1{color:#12807F;font-size:24px}a{color:#12807F}</style></head><body>
<h1>انتهت فترتك التجريبية</h1>
<p>شكراً لتجربتك تطبيق «الفارسية من الصفر». انتهت مدة التجربة المجانية (${TRIAL_DAYS} أيام).</p>
<p>للاستمرار تواصل معنا: <a href="mailto:${CONTACT}" dir="ltr">${CONTACT}</a></p>
</body></html>`;

const PAGES = new Set(['/', '/index', '/index.html']);

export async function onRequest({ request, env, next }) {
  if (!PAGES.has(new URL(request.url).pathname)) return next();
  const email = accessEmail(request);
  if (!email || !env.TRIALS) return next();

  const allowed = (await env.TRIALS.get('allowlist', 'json')) || [];
  if (allowed.includes(email)) return next();

  const key = 'trial:' + email;
  let start = Number(await env.TRIALS.get(key));
  if (!start) {
    start = Date.now();
    await env.TRIALS.put(key, String(start));
  }
  if (Date.now() - start < TRIAL_DAYS * DAY) return next();

  return new Response(ENDED, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
