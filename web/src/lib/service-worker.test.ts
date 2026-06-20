import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')
const MAIN_SOURCE = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')

function cacheKey(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input.startsWith('http') ? new URL(input).pathname : input
  if (input instanceof URL) return input.pathname
  return new URL(input.url).pathname
}

class MemoryCache {
  store = new Map<string, Response>()

  constructor(entries: Record<string, string> = {}) {
    Object.entries(entries).forEach(([key, body]) => this.store.set(key, new Response(body)))
  }

  async put(input: RequestInfo | URL, response: Response) {
    this.store.set(cacheKey(input), response.clone())
  }

  async match(input: RequestInfo | URL) {
    return this.store.get(cacheKey(input))
  }
}

function createCaches(initial: Record<string, Record<string, string>> = {}) {
  const cachesByName = new Map<string, MemoryCache>()
  Object.entries(initial).forEach(([name, entries]) => cachesByName.set(name, new MemoryCache(entries)))

  return {
    async open(name: string) {
      if (!cachesByName.has(name)) cachesByName.set(name, new MemoryCache())
      return cachesByName.get(name)!
    },
    async keys() {
      return [...cachesByName.keys()]
    },
    async delete(name: string) {
      return cachesByName.delete(name)
    },
    async match(input: RequestInfo | URL) {
      for (const cache of cachesByName.values()) {
        const response = await cache.match(input)
        if (response) return response
      }
      return undefined
    },
  }
}

function loadWorker(fetchImpl: typeof fetch, caches: ReturnType<typeof createCaches>) {
  const listeners: Record<string, (event: any) => void> = {}
  const worker = {
    location: new URL('https://carup.test/'),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener
    },
  }
  vm.runInNewContext(SW_SOURCE, {
    self: worker,
    caches,
    fetch: fetchImpl,
    Response,
    URL,
    console,
  })
  return { listeners, worker }
}

async function dispatchLifecycle(listener: (event: any) => void) {
  const pending: Promise<unknown>[] = []
  listener({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) })
  await Promise.all(pending)
}

async function dispatchFetch(listener: (event: any) => void, request: Request) {
  let responsePromise: Promise<Response> | undefined
  listener({ request, respondWith: (promise: Promise<Response>) => { responsePromise = Promise.resolve(promise) } })
  expect(responsePromise).toBeDefined()
  const response = await responsePromise!
  expect(response).toBeInstanceOf(Response)
  return response
}

describe('service worker cache and fetch behavior', () => {
  it('does not precache development source paths', () => {
    expect(SW_SOURCE).not.toContain('/src/main.tsx')
    expect(SW_SOURCE).not.toContain('/src/App.tsx')
    expect(SW_SOURCE).not.toContain('/src/index.css')
  })

  it('registers sw.js without relying on the browser HTTP cache', () => {
    expect(MAIN_SOURCE).toContain("updateViaCache: 'none'")
  })

  it('failed non-HTML fetch always returns a Response', async () => {
    const caches = createCaches()
    const { listeners } = loadWorker(vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch, caches)

    const response = await dispatchFetch(
      listeners.fetch,
      new Request('https://carup.test/assets/app.abc123.js', { headers: { accept: '*/*' } }),
    )

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('Network unavailable')
  })

  it('removes the old permanent cache on activation', async () => {
    const caches = createCaches({
      'carup-offline-cache-v1': { '/': 'old shell' },
    })
    const { listeners, worker } = loadWorker(vi.fn(() => Promise.resolve(new Response('ok'))) as unknown as typeof fetch, caches)

    await dispatchLifecycle(listeners.activate)

    expect(await caches.keys()).not.toContain('carup-offline-cache-v1')
    expect(worker.clients.claim).toHaveBeenCalled()
  })

  it('navigation fetches the network shell instead of an incompatible stale shell', async () => {
    const caches = createCaches({
      'carup-offline-cache-v1': { '/': 'old stale shell' },
    })
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('new deployment shell', {
      headers: { 'content-type': 'text/html' },
    }))) as unknown as typeof fetch
    const { listeners } = loadWorker(fetchImpl, caches)

    await dispatchLifecycle(listeners.activate)
    const response = await dispatchFetch(
      listeners.fetch,
      new Request('https://carup.test/dashboard', { headers: { accept: 'text/html' } }),
    )

    expect(await response.text()).toBe('new deployment shell')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('new deployment replaces the old app shell used for offline navigation', async () => {
    const caches = createCaches({
      'carup-offline-cache-v1': { '/index.html': 'old deployment shell' },
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('new deployment shell'))
      .mockResolvedValueOnce(new Response('new deployment shell'))
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch
    const { listeners } = loadWorker(fetchImpl, caches)

    await dispatchLifecycle(listeners.install)
    await dispatchLifecycle(listeners.activate)

    const response = await dispatchFetch(
      listeners.fetch,
      new Request('https://carup.test/marketplace/compare', { headers: { accept: 'text/html' } }),
    )

    expect(await response.text()).toBe('new deployment shell')
    expect(await caches.keys()).not.toContain('carup-offline-cache-v1')
  })
})
