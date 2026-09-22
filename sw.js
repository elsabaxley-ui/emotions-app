// GitHub Pages serves index.html with `cache-control: max-age=600`, so for ten
// minutes after a deploy a plain refresh can keep showing the old page. This
// worker goes to the network first and bypasses the HTTP cache while doing it,
// so one refresh always gets the current build. The cached copy is the fallback
// for when the network is gone — which is what makes the app work offline, and
// on a phone that matters: you check in on the subway too.
const CACHE = 'hourly-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      const shell = await caches.match('index.html');
      if (shell && req.mode === 'navigate') return shell;
      throw err;
    }
  })());
});
