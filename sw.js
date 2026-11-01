// Service worker for the installed web app (web version only; the Android app does not register it).
// - The app page: network first, so the sign-in and trial checks in functions/_middleware.js still run
//   whenever there is a connection. The last good copy is used only when the phone is offline.
// - Fonts, scripts, icons and audio: cached on first use, so lessons heard once also play offline.
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
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(APP);
        if (res.ok && res.type === 'basic' && !res.redirected) {
          await cache.put(PAGE, res.clone());
        } else if (res.status === 403) {
          await cache.delete(PAGE); // the trial or access period ended
        }
        return res;
      } catch (err) {
        const cached = await caches.match(PAGE, { cacheName: APP });
        if (cached) return cached;
        throw err;
      }
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
