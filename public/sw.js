// Service worker Kifeh — notifications Web Push + cache du SHELL pour les
// réseaux instables. Règles d'honnêteté du cache :
//   · les DONNÉES (/api/…) ne sont JAMAIS mises en cache ici — l'application
//     gère son propre instantané local, toujours horodaté ;
//   · HTML/CSS/JS : réseau d'abord (jamais de version périmée quand on est en
//     ligne), copie de secours servie UNIQUEMENT hors connexion ;
//   · ressources versionnées (vendor, images) : cache d'abord (immuables).
'use strict';

const SHELL_CACHE = 'kifeh-shell-v1';
const PRECACHE = [
  '/', '/index.html', '/offline.html', '/css/app.css',
  '/js/i18n.js', '/js/api.js', '/js/map-common.js', '/js/home.js', '/js/home-layers.js',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/img/logo.svg?v=marque4', '/img/icon-192.png?v=marque4',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
    } catch { /* pré-cache partiel : le réseau reste la référence */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) {
    if (k.startsWith('kifeh-shell-') && k !== SHELL_CACHE) await caches.delete(k);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // JAMAIS de cache sur les données ni les flux temps réel.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sandbox')) return;

  // Ressources versionnées : cache d'abord (elles ne changent jamais sans ?v=).
  const immutable = url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/img/');
  if (immutable) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Shell (HTML/CSS/JS) : réseau d'abord, secours hors connexion.
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return (await caches.match('/offline.html'))
          || new Response('Hors connexion', { status: 503 });
      }
      throw new Error('hors connexion');
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Kifeh';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/img/icon-192.png?v=marque4',
    badge: '/img/icon-192.png?v=marque4',
    tag: data.tag || 'kifeh',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.url.startsWith(self.location.origin)) { tab.navigate(url); return tab.focus(); }
    }
    return clients.openWindow(url);
  }));
});
