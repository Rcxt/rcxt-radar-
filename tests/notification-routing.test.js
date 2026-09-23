import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const token = '976CYJJEVhntZhKS5wdUb3mz2w8FxViDbfCWK8xg2eQ7'
const origin = 'https://rcxt-radar.vercel.app'

function worker(windows, Channel) {
  const handlers = {}, opened = []
  const self = {
    location: { origin },
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: {
      matchAll: async () => windows,
      openWindow: async url => { opened.push(url) },
    },
  }
  vm.runInNewContext(source, { self, URL, MessageChannel: Channel, setTimeout, clearTimeout })
  return {
    opened,
    async click(url) {
      let task, closed = false
      handlers.notificationclick({
        notification: { data: { url }, close: () => { closed = true } },
        waitUntil: promise => { task = promise },
      })
      await task
      assert.equal(closed, true)
    },
  }
}

test('notification cold start opens the exact coin URL', async () => {
  const w = worker([])
  await w.click('/?token=' + token)
  assert.deepEqual(w.opened, [origin + '/?token=' + token])
})

test('a failed existing window navigation cannot swallow the coin tap', async () => {
  const w = worker([{ focus: async () => {}, navigate: async () => { throw Error('closed') } }])
  await w.click('/?token=' + token)
  assert.deepEqual(w.opened, [origin + '/?token=' + token])
})

test('older open app navigates to the coin when message routing is unavailable', async () => {
  const targets = []
  const client = { focus: async () => {}, navigate: async url => { targets.push(url); return client } }
  const w = worker([client])
  await w.click('/?token=' + token)
  assert.deepEqual(targets, [origin + '/?token=' + token])
  assert.equal(w.opened.length, 0)
})

test('warm app receives the selected coin and acknowledges it without reload', async () => {
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null }
      this.port2 = { postMessage: data => this.port1.onmessage?.({ data }) }
    }
  }
  let received, navigated = false
  const client = {
    focus: async () => {},
    postMessage: (data, ports) => { received = data; ports[0].postMessage({ opened: true }) },
    navigate: async () => { navigated = true },
  }
  const w = worker([client], Channel)
  await w.click('/?token=' + token)
  assert.equal(received.type, 'RCXT_OPEN_TOKEN')
  assert.equal(received.token, token)
  assert.equal(navigated, false)
  assert.equal(w.opened.length, 0)
})

test('notification cannot navigate the app to an external origin', async () => {
  const w = worker([])
  await w.click('https://example.com/?token=' + token)
  assert.deepEqual(w.opened, [origin + '/'])
})
