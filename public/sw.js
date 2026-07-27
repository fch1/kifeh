// Service worker Kifeh — VOLONTAIREMENT minimal : uniquement les notifications
// « M'alerter dans cette zone » (Web Push). Aucune interception de requêtes,
// aucun cache : le comportement réseau de l'application reste inchangé.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
