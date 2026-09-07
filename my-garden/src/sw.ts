/// <reference lib="webworker" />
// src/sw.ts
// Custom service worker source — vite-plugin-pwa is in `injectManifest`
// mode (see vite.config.ts) instead of its default `generateSW`, purely so
// this file can add push/notificationclick handling; everything else
// (precaching, the update-prompt flow) is unchanged from before.
//
// registerType stays 'prompt': a new deploy going live used to
// force-reload the page instantly, wiping out unsaved work (see
// UpdatePrompt.tsx) — the SKIP_WAITING message listener below is what lets
// that flow still work, exactly like generateSW's own template did.

import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'My Garden';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Something in your garden needs attention.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  );
});

// Focuses an already-open tab instead of always opening a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
