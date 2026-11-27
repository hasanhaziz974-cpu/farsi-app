// Free trial for the web version: anyone who signs in gets TRIAL_DAYS of everything from their
// first visit, then the free version of the app. People on the allowlist (written to KV by
// tools/sync_access.py from ACCESS_LIST) are never limited. A KV entry "allow:<email>"
// added by hand in the Cloudflare dashboard also admits that person: its value is the
// last day of access (YYYY-MM-DD, UTC, Arabic or Persian digits accepted) or any other
// text for no end date. Signed-in requests are checked only on page loads; audio, font and script
// requests pass straight through. Requests without a verified sign-in get only the public pages.
import { accessEmail, accessStatus } from '../lib/trial.js';
import { applyInvite } from '../lib/invite.js';

// Shown instead of the app when access has ended: the trial, or a subscription period.
const PAGES = new Set(['/', '/index', '/index.html']);

// Without a verified sign-in only the public pages may be served. They carry data-public on their
// <html> tag; anything else (the app, or the app served as a fallback for an unknown path) is refused.
// This also covers hosts Access does not cover, like a deployment's own *.pages.dev address.
// /audio/ is public: the Android app (no sign-in) streams the recorded pronunciation and downloads it as a pack.
// /api/pay/return/ is where ZainCash sends a learner back after paying; it checks the payment with the gateway itself.
const PUBLIC = ['/welcome', '/fonts/', '/pwa/', '/audio/', '/login', '/api/auth/', '/logout', '/api/pay/return/'];
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
// no MIME sniffing, a strict referrer, no camera or location, and the microphone for this site only (speaking practice). Fonts never change and
// are cached for a year; audio, signed-in content, for a week in the browser only.
const SECURITY = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
};
const CACHE = [
  [/^\/fonts\/.+\.woff2$/, 'public, max-age=31536000, immutable'],
  [/^\/audio\/.+\.mp3$/, 'private, max-age=604800'],
  [/^\/(pwa|welcome)\/.+\.(png|webp)$/, 'public, max-age=604800'],
];

// Repository files that are not part of the site (admin tools, server code, store listing, notes). The Pages
// build copies only the site's files to www, so these are not published; a 404 for everyone in case that changes.
const INTERNAL = /^\/(tools|tests|lib|workers|store|functions|\.github)(\/|$)|^\/(README\.md|package(-lock)?\.json|capacitor\.config\.json|icon-only\.png|\.gitignore)$|\.(py|pyc|gs|md)$/i;

// The recorded pronunciation is deployed in packs (tools/pack-audio.js: audio/p/<first 3 hex>.bin), because Pages
// takes at most 20,000 files. /audio/<hex>.mp3 is answered from its pack, with byte ranges for the audio
// player (Safari asks for them). Without the pack (a deployment of the separate files) the file itself is served.
// One file out of its pack: its bytes, false when the pack has no such file, null without packs. A file once taken
// out is kept a day in Cloudflare's cache at that location, so a word heard again is not unpacked again.
async function audioBytes({ request, env, next, waitUntil }, name) {
  const cache = typeof caches !== 'undefined' && caches.default, key = new URL('/audio/' + name, request.url).toString();
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const at = new URL('/audio/p/' + name.slice(0, 3) + '.bin', request.url);
  const pk = env.ASSETS ? await env.ASSETS.fetch(new Request(at)) : await next(new Request(at));
  if (!pk || pk.status !== 200) return null;
  const buf = new Uint8Array(await pk.arrayBuffer());
  if (buf.length < 4) return null;
  const hl = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  let head;
  try { head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl))); } catch (e) { return null; }
  const e = head[name];
  if (!e) return false;
  const body = buf.slice(4 + hl + e[0], 4 + hl + e[0] + e[1]);
  if (cache) {
    const put = cache.put(key, new Response(body.slice(), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' } })).catch(() => {});
    if (waitUntil) waitUntil(put); else await put;
  }
  return body;
}

async function packedAudio(context, name) {
  const { request } = context;
  const body = await audioBytes(context, name);
  if (body === null) return null;
  if (body === false) return new Response('Not found', { status: 404 });
  const size = body.length;
  const headers = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  const r = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (r && (r[1] || r[2])) {
    let a = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2])), b = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    if (a > b || a >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(body.slice(a, b + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
  }
  return new Response(body.slice(), { headers: { ...headers, 'Content-Length': String(size) } });
}

export async function onRequest(context) {
  let path0 = '/';
  try {
    path0 = decodeURIComponent(new URL(context.request.url).pathname);
  } catch (e) {}
  const au = /^\/audio\/([0-9a-f]{1,8}\.mp3)$/.exec(path0);
  const res = INTERNAL.test(path0) ? new Response('Not found', { status: 404 }) : (au && (await packedAudio(context, au[1]))) || (await handle(context));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
  if (out.status === 200 || out.status === 206) {
    const path = new URL(context.request.url).pathname;
    const rule = CACHE.find(([re]) => re.test(path));
    if (rule) out.headers.set('Cache-Control', rule[1]);
    // The Android app's page (https://localhost) fetches the audio pack across origins.
    if (path.startsWith('/audio/')) out.headers.set('Access-Control-Allow-Origin', '*');
  }
  return out;
}

// The app page carries all its code and lessons in one inline script (2.5 MB). For signed-in visitors the page is
// sent with that script apart, as /app.js?v=<hash of the script>: the browser (and sw.js) keeps it, compiled,
// until the hash changes, so the app opens faster. index.html itself stays one file (the Android app and the
// tests use it as it is). /app.js is served only to signed-in visitors, like the page.
const APP_JS = '/app.js';
function appParts(html) {
  const a = html.indexOf('<script>'), b = html.lastIndexOf('</script>');
  if (a < 0 || b < a) return null;
  return { head: html.slice(0, a), js: html.slice(a + 8, b), tail: html.slice(b + 9) };
}
let appMemo = { tag: '', v: '' };
async function appVersion(js, tag) {
  if (tag && appMemo.tag === tag) return appMemo.v;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(js));
  const v = [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
  if (tag) appMemo = { tag, v };
  return v;
}
async function splitPage(res) {
  if (res.status !== 200 || !(res.headers.get('Content-Type') || '').includes('text/html')) return res;
  const html = await res.text(), parts = appParts(html);
  const headers = new Headers(res.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  if (!parts || parts.js.length < 10000) return new Response(html, { status: res.status, headers });
  const v = await appVersion(parts.js, res.headers.get('ETag'));
  return new Response(parts.head + '<script src="' + APP_JS + '?v=' + v + '"></script>' + parts.tail, { status: res.status, headers });
}
async function appScript(request, env, next) {
  const home = new URL('/', request.url);
  const res = env.ASSETS ? await env.ASSETS.fetch(new Request(home)) : await next(new Request(home));
  const parts = res.ok ? appParts(await res.text()) : null;
  if (!parts) return new Response('Not found', { status: 404 });
  const v = await appVersion(parts.js, res.headers.get('ETag'));
  const same = new URL(request.url).searchParams.get('v') === v;
  return new Response(parts.js, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': same ? 'private, max-age=31536000, immutable' : 'private, no-cache' } });
}

async function handle({ request, env, next }) {
  const email = await accessEmail(request, env);
  if (!email) return publicOnly(request, next);
  // The shared link is the welcome page; people already signed in go straight to the app (also from /login).
  const path = new URL(request.url).pathname;
  if (WELCOME.has(path)) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (path === APP_JS) return appScript(request, env, next);
  if (!PAGES.has(path)) return next();
  if (!env.TRIALS) return splitPage(await next());

  // Starts the trial on the first visit. When the trial or subscription has ended the app still
  // opens, in its free version (first lessons and review); it learns which from /api/me.
  // A friend's invite link (/welcome/?r=<code>) left its code in the "pr" cookie: it counts when the trial starts.
  const st = await accessStatus(env.TRIALS, email, true);
  const pr = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)pr=([a-z0-9]{8})(?:;|$)/);
  if (!pr) return splitPage(await next());
  if (st.fresh) await applyInvite(env.TRIALS, email, pr[1]);
  const res = await splitPage(await next());
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', 'pr=; Max-Age=0; Path=/; Secure; SameSite=Lax');
  return out;
}

