self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch {}

  const title = data.title || 'RCXT Radar'
  const options = {
    body: data.body || 'RCXT has a new wallet alert.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'rcxt-alert',
    renotify: true,
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification?.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('navigate' in client) {
          try { await client.navigate(target) } catch {}
        }
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    }),
  )
})
