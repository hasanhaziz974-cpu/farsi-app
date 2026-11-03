// Free trial for the web version: anyone who signs in through Cloudflare Access gets
// TRIAL_DAYS from their first visit. People on the allowlist (written to KV by
// tools/sync_access.py from ACCESS_LIST) are never limited. A KV entry "allow:<email>"
// added by hand in the Cloudflare dashboard also admits that person: its value is the
// last day of access (YYYY-MM-DD, UTC, Arabic or Persian digits accepted) or any other
// text for no end date. Signed-in requests are checked only on page loads; audio, font and script
// requests pass straight through. Requests without a verified sign-in get only the public pages.
import { TRIAL_DAYS, CONTACT, accessEmail, accessStatus, payConfig } from '../lib/trial.js';

// Shown instead of the app when access has ended: the trial, or a subscription period.
const h = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Prices, payment numbers and a WhatsApp button with the learner's email filled in (admin page settings).
function payBlock(pay, email) {
  const msg = encodeURIComponent('مرحباً، أريد الاشتراك في «الفارسية من الصفر».\nبريدي: ' + email + '\nالباقة: \nأرسلت المبلغ عبر: \n(أرفق صورة الإيصال)');
  return `<div class="card"><b>💳 الباقات</b>${pay.plans.map((p) => `<div class="pl"><span>${h(p.label)}</span><b>${h(p.price)}</b></div>`).join('')}</div>
<div class="card"><b>طرق الدفع</b>${pay.methods.map((m) => `<div class="pl"><span>${h(m.label)}</span><b class="e">${h(m.value)}</b></div>`).join('')}
<p class="mu" style="margin:8px 0 0">حوّل مبلغ الباقة، ثم أرسل لنا صورة الإيصال على واتساب مع بريدك.${pay.note ? ' ' + h(pay.note) : ''}</p></div>
<a class="btn" href="https://wa.me/${h(pay.whatsapp)}?text=${msg}">💬 أرسلت المبلغ: راسلنا على واتساب</a>`;
}

function endedPage(kind, email, pay) {
  const trial = kind === 'trial';
  const subject = encodeURIComponent('اشتراك في «الفارسية من الصفر»');
  const body = encodeURIComponent('مرحباً، أريد الاشتراك في التطبيق.\nبريدي المسجّل: ' + email);
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${trial ? 'انتهت الفترة التجريبية' : 'انتهى اشتراكك'}</title>
<meta name="theme-color" content="#12807F"><link rel="icon" href="/pwa/icon-192.png">
<style>
:root{--bg:#EEF4F3;--sf:#fff;--tx:#14263A;--mu:#5B7083;--pr:#12807F;--bd:#D5E2E0;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0E1A24;--sf:#16293A;--tx:#E8F1F0;--mu:#93A8B6;--pr:#3FB8B5;--bd:#264054;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--tx);font:17px/1.9 Tahoma,Arial,sans-serif;text-align:center}
main{max-width:520px;margin:0 auto;padding:40px 16px}img{width:96px;height:96px;border-radius:22px}
h1{color:var(--pr);font-size:24px;margin:16px 0 6px}.card{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:16px;margin:16px 0;text-align:start}
.btn{display:block;background:var(--pr);color:#fff;text-decoration:none;font-weight:700;border-radius:12px;padding:12px;margin:10px 0}
.mu{color:var(--mu);font-size:15px}a{color:var(--pr)}.e{direction:ltr;unicode-bidi:isolate;font-weight:700}
.pl{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--bd)}.pl:first-of-type{border-top:0}
</style></head><body><main>
<img src="/pwa/icon-192.png" alt="">
<h1>${trial ? 'انتهت فترتك التجريبية' : 'انتهت مدة اشتراكك'}</h1>
<p>${trial ? `شكراً لتجربتك «الفارسية من الصفر» طوال ${TRIAL_DAYS} أيام.` : 'شكراً لتعلّمك معنا في «الفارسية من الصفر».'} للاستمرار في التعلّم تواصل معنا ليُفعَّل اشتراكك.</p>
${pay ? payBlock(pay, email) : `<a class="btn" href="mailto:${CONTACT}?subject=${subject}&body=${body}">✉️ راسلنا للاشتراك</a>`}
<div class="card">💾 <b>تقدّمك محفوظ</b> في جهازك كما هو: كلماتك ونقاطك وسلسلتك. ستجده عندما يُفعَّل اشتراكك.</div>
<p class="mu">أنت مسجّل بالبريد <span class="e">${email.replace(/[<>&"]/g, '')}</span><br>
<a href="/logout">الدخول ببريد آخر</a></p>
</main></body></html>`;
}

const PAGES = new Set(['/', '/index', '/index.html']);

// Without a verified sign-in only the public pages may be served. They carry data-public on their
// <html> tag; anything else (the app, or the app served as a fallback for an unknown path) is refused.
// This also covers hosts Access does not cover, like a deployment's own *.pages.dev address.
const PUBLIC = ['/welcome', '/fonts/', '/pwa/', '/login', '/api/auth/', '/logout'];
const WELCOME = new Set(['/welcome', '/welcome/', '/welcome/index.html', '/login', '/login/', '/login/index.html']);

async function publicOnly(request, next) {
  const url = new URL(request.url);
  if (!PUBLIC.some((p) => url.pathname.startsWith(p))) {
    // Sign in first, then back to the page asked for (the welcome page's buttons lead to the app).
    const to = PAGES.has(url.pathname) ? '/login/' : '/login/?next=' + encodeURIComponent(url.pathname);
    return Response.redirect(url.origin + to, 302);
  }
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

// Headers added to every response: no framing (protects the admin buttons from clickjacking),
// no MIME sniffing, a strict referrer and no camera, microphone or location. Fonts never change and
// are cached for a year; audio, signed-in content, for a week in the browser only.
const SECURITY = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const CACHE = [
  [/^\/fonts\/.+\.woff2$/, 'public, max-age=31536000, immutable'],
  [/^\/audio\/.+\.mp3$/, 'private, max-age=604800'],
  [/^\/(pwa|welcome)\/.+\.(png|webp)$/, 'public, max-age=604800'],
];

export async function onRequest(context) {
  const res = await handle(context);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
  if (out.status === 200) {
    const path = new URL(context.request.url).pathname;
    const rule = CACHE.find(([re]) => re.test(path));
    if (rule) out.headers.set('Cache-Control', rule[1]);
  }
  return out;
}

async function handle({ request, env, next }) {
  const email = await accessEmail(request, env);
  if (!email) return publicOnly(request, next);
  // The shared link is the welcome page; people already signed in go straight to the app (also from /login).
  const path = new URL(request.url).pathname;
  if (WELCOME.has(path)) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!PAGES.has(new URL(request.url).pathname) || !env.TRIALS) return next();

  const st = await accessStatus(env.TRIALS, email, true);
  return st.ok ? next() : ended(st.kind, email, await payConfig(env.TRIALS));
}

function ended(kind, email, pay) {
  return new Response(endedPage(kind, email, pay), {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
