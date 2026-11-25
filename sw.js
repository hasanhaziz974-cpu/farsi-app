// Service worker for the installed web app (web version only; the Android app does not register it).
// - The app page: the last good copy opens at once (it holds all the lessons, so it is large), while the network
//   copy is fetched in the background, so the sign-in and trial checks in functions/_middleware.js still run on
//   every visit. New content shows on the next visit (the page is told, and says so).
// - Fonts, scripts, icons and audio: cached on first use, so lessons heard once also play offline.
// - Daily reminder: the reminder Worker (workers/reminders/index.js) sends an empty push; the text is chosen here (on the
//   trial's last day it says the trial is ending).
const APP = 'parsa-app-v1';
const MEDIA = 'parsa-media-v1';
const PAGE = '/';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('parsa-') && k !== APP && k !== MEDIA) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function isAppPage(url) {
  return url.pathname === '/' || url.pathname === '/index' || url.pathname === '/index.html';
}

function isMedia(url) {
  return /^\/(fonts|audio)\//.test(url.pathname) || /^\/pwa\/.*\.png$/.test(url.pathname) || url.pathname === '/bridge.js';
}

// Fetches and saves one version of the app's code, once even when the page and the background update ask
// together; older versions are dropped. Answers the saved copy, or null when it could not be saved.
const appLoads = new Map();
function getApp(href) {
  if (!appLoads.has(href)) {
    appLoads.set(href, (async () => {
      const cache = await caches.open(MEDIA);
      if (!(await cache.match(href))) {
        const res = await fetch(href, { credentials: 'same-origin' });
        if (!(res.ok && res.type === 'basic' && !res.redirected)) return;
        await cache.put(href, res);
        for (const k of await cache.keys()) if (new URL(k.url).pathname === '/app.js' && k.url !== href) await cache.delete(k);
      }
    })().catch(() => {}).finally(() => appLoads.delete(href)));
  }
  return appLoads.get(href).then(() => caches.match(href, { cacheName: MEDIA })).then((r) => r || null);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && isAppPage(url)) {
    // The page opens from the saved copy at once and the network copy replaces it in the background for the next
    // visit. The sign-in check still runs on every visit: when the background request is sent to the sign-in page
    // (signed out), the saved copy is dropped and the page reloads. The site serves the app's code apart, as
    // /app.js?v=<hash> (functions/_middleware.js); the new page is saved only once its code is saved, so a saved
    // page always finds its code here.
    const net = fetch(req).then((res) => ({ res, page: res.clone(), text: res.clone() }));
    const stored = net.then(async ({ res, page, text }) => {
      const cache = await caches.open(APP);
      if (res.ok && res.type === 'basic' && !res.redirected) {
        const m = (await text.text()).match(/<script src="(\/app\.js\?v=[0-9a-f]+)"/);
        if (m) await getApp(new URL(m[1], url).href);
        await cache.put(PAGE, page);
      } else if (res.type === 'opaqueredirect' || res.redirected || res.status === 403) {
        await cache.delete(PAGE);
      }
      return res;
    });
    e.respondWith((async () => {
      const cached = await caches.match(PAGE, { cacheName: APP });
      if (!cached) {
        e.waitUntil(stored.catch(() => {}));
        return (await net).res;
      }
      e.waitUntil(stored.then(async (res) => {
        const out = res.type === 'opaqueredirect' || res.redirected || res.status === 403;
        const tag = (r) => r.headers.get('ETag') || '';
        const msg = out ? 'parsa-reload' : res.ok && tag(res) && tag(res) !== tag(cached) ? 'parsa-updated' : '';
        // The page this navigation opens may not exist yet when the answer comes, so wait for it (up to 10 s).
        for (let i = 0; msg && i < 40; i++) {
          const c = e.resultingClientId && (await self.clients.get(e.resultingClientId));
          if (c) return c.postMessage(msg);
          await new Promise((ok) => setTimeout(ok, 250));
        }
      }).catch(() => {}));
      return cached;
    })());
    return;
  }

  // The app's code (/app.js?v=<hash>): kept until a newer version replaces it; the browser keeps it compiled.
  if (url.pathname === '/app.js') {
    e.respondWith((async () => (await caches.match(url.href, { cacheName: MEDIA })) || (await getApp(url.href)) || fetch(req))());
    return;
  }

  if (isMedia(url)) {
    e.respondWith((async () => {
      const cached = await caches.match(url.href, { cacheName: MEDIA });
      if (cached) return cached;
      // Fetch the whole file (audio elements ask for byte ranges, which give partial responses).
      const res = await fetch(url.href, { credentials: 'same-origin' });
      if (res.ok && res.type === 'basic' && !res.redirected && res.status === 200) {
        const cache = await caches.open(MEDIA);
        cache.put(url.href, res.clone());
      }
      return res;
    })());
  }
});

const REMINDERS = [
  ['🔥 حافظ على سلسلتك', 'خمس دقائق من الفارسية اليوم تكفي. هيا نراجع!'],
  ['📚 حان وقت درسك', 'كلماتك تنتظر المراجعة قبل أن تنساها.'],
  ['🌷 سلام! وقت الفارسية', 'درس قصير الآن يقرّبك من المحادثة.'],
  ['⭐ هدفك اليومي', 'أكمل هدف اليوم واجمع نقاطك.'],
];

// On the last day of the trial the reminder says so instead (the learner's status comes from /api/me).
async function reminderText() {
  try {
    const res = await Promise.race([
      fetch('/api/me', { credentials: 'same-origin' }),
      new Promise((_, no) => setTimeout(no, 4000)),
    ]);
    const me = res.ok ? await res.json() : null;
    if (me && me.kind === 'trial' && me.ok && me.left <= 1) {
      return ['⏳ تنتهي تجربتك المجانية اليوم', 'اشترك لتتابع كل الدروس ومحادثة پارسا. تقدّمك محفوظ.'];
    }
  } catch (err) { /* offline or signed out: the usual reminder */ }
  return REMINDERS[Math.floor(Math.random() * REMINDERS.length)];
}

self.addEventListener('push', (e) => {
  e.waitUntil(reminderText().then(([title, body]) => self.registration.showNotification(title, {
    body, lang: 'ar', dir: 'rtl', tag: 'daily-reminder',
    icon: '/pwa/icon-192.png', badge: '/pwa/badge-96.png', // badge: white shape on transparent; Android draws only its outline
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow('/');
  })());
});
