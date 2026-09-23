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
    renotify: Boolean(data.renotify),
    requireInteraction: Boolean(data.critical),
    silent: Boolean(data.silent),
    data: { url: data.url || '/', category:data.category || null },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

function notificationTarget(data) {
  try {
    const url = new URL(data?.url || '/', self.location.origin)
    if (url.origin !== self.location.origin) return new URL('/', self.location.origin)
    return url
  } catch {
    return new URL('/', self.location.origin)
  }
}

async function openNotificationTarget(target) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const token = target.searchParams.get('token')
  for (const client of windows) {
    try {
      // Focus immediately while the notification tap still grants user activation.
      await client.focus()
      if (token && typeof MessageChannel !== 'undefined') {
        const opened = await new Promise((resolve) => {
          const channel = new MessageChannel()
          const finish = (value) => {
            clearTimeout(timer)
            channel.port1.close()
            resolve(value)
          }
          const timer = setTimeout(() => finish(false), 800)
          channel.port1.onmessage = (event) => finish(event.data?.opened === true)
          try {
            client.postMessage({ type: 'RCXT_OPEN_TOKEN', token }, [channel.port2])
          } catch { finish(false) }
        })
        if (opened) return
      }
      const navigated = await client.navigate(target.href)
      if (navigated) { await navigated.focus(); return }
    } catch {
      // A stale/closed client must not swallow the tap. Try another or open one.
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(target.href)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openNotificationTarget(notificationTarget(event.notification?.data)))
})
