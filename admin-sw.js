/* FPS admin service worker — shows new-booking alerts and puts a count on the app icon.
   Keep this file in the SAME folder as the admin page. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { /* plain text push */ }
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'New booking', {
      body: d.body || 'Open the dashboard to review it.',
      icon: 'https://femixplumbing.name.ng/images/branding/femix-logo.webp',
      badge: 'https://femixplumbing.name.ng/images/branding/femix-logo.webp',
      tag: d.id || undefined,
      data: { url: self.registration.scope }
    });
    if (self.navigator && self.navigator.setAppBadge && d.count != null) {
      try { await self.navigator.setAppBadge(d.count); } catch (e) { /* not supported */ }
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
