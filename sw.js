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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && isAppPage(url)) {
    // The page is large (all the lessons are in it), so a saved copy opens at once and the network copy
    // replaces it in the background for the next visit. The sign-in check still runs on every visit: when the
    // background request is sent to the sign-in page (signed out), the saved copy is dropped and the page reloads.
    const fresh = (async () => {
      const res = await fetch(req);
      const cache = await caches.open(APP);
      if (res.ok && res.type === 'basic' && !res.redirected) {
        await cache.put(PAGE, res.clone());
      } else if (res.type === 'opaqueredirect' || res.redirected || res.status === 403) {
        await cache.delete(PAGE);
      }
      return res;
    })();
    e.respondWith((async () => {
      const cached = await caches.match(PAGE, { cacheName: APP });
      if (!cached) return fresh;
      e.waitUntil(fresh.then(async (res) => {
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
