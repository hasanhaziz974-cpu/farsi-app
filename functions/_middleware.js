// Free trial for the web version: anyone who signs in gets TRIAL_DAYS of everything from their
// first visit, then the free version of the app. People on the allowlist (written to KV by
// tools/sync_access.py from ACCESS_LIST) are never limited. A KV entry "allow:<email>"
// added by hand in the Cloudflare dashboard also admits that person: its value is the
// last day of access (YYYY-MM-DD, UTC, Arabic or Persian digits accepted) or any other
// text for no end date. Signed-in requests are checked only on page loads; audio, font and script
// requests pass straight through. Requests without a verified sign-in get only the public pages.
import { accessEmail, accessStatus } from '../lib/trial.js';

// Shown instead of the app when access has ended: the trial, or a subscription period.
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

  // Starts the trial on the first visit. When the trial or subscription has ended the app still
  // opens, in its free version (first lessons and review); it learns which from /api/me.
  await accessStatus(env.TRIALS, email, true);
  return next();
}

