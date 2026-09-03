const VERSION = 'betzion-pwa-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Keep app files network-first so a release never leaves players on an old game bundle.
self.addEventListener('fetch', () => {});
