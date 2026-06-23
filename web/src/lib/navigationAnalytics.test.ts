import { describe, it, expect, vi } from 'vitest'
import { NavigationAnalytics } from './navigationAnalytics'

function makeClient(captured: any[]) {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }) as unknown as typeof fetch
  return { fetchImpl }
}

describe('NavigationAnalytics (web client)', () => {
  it('track is non-throwing and buffers events', () => {
    const a = new NavigationAnalytics({ endpoint: '/x', fetchImpl: (async () => new Response(null, { status: 202 })) as any })
    expect(() => a.track({ event_type: 'navigation_surface_opened', surface: 'mega_menu' })).not.toThrow()
    expect(a.pendingCount).toBe(1)
  })

  it('queue is bounded to 100 (drop-oldest)', () => {
    const a = new NavigationAnalytics({ endpoint: '/x', fetchImpl: (async () => new Response(null, { status: 202 })) as any })
    for (let i = 0; i < 150; i++) a.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs', node_id: `n${i}` })
    expect(a.pendingCount).toBe(100)
  })

  it('suppresses duplicate impressions per surface+node within a session', () => {
    const a = new NavigationAnalytics({ endpoint: '/x', fetchImpl: (async () => new Response(null, { status: 202 })) as any })
    a.track({ event_type: 'navigation_item_impression', surface: 'mega_menu', node_id: 'buy.shop-all' })
    a.track({ event_type: 'navigation_item_impression', surface: 'mega_menu', node_id: 'buy.shop-all' })
    expect(a.pendingCount).toBe(1)
  })

  it('flush posts a schema-versioned batch then clears the queue', async () => {
    const captured: any[] = []
    const { fetchImpl } = makeClient(captured)
    const a = new NavigationAnalytics({ endpoint: '/api/analytics/navigation', fetchImpl })
    a.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'admin.ai' })
    await a.flush()
    expect(a.pendingCount).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].schemaVersion).toBe(1)
    expect(captured[0].events[0].platform).toBe('web')
    expect(captured[0].events[0].event_type).toBe('navigation_item_selected')
  })

  it('flush never throws when the transport rejects (events dropped, nav unaffected)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    const a = new NavigationAnalytics({ endpoint: '/x', fetchImpl })
    a.track({ event_type: 'navigation_error', surface: 'unknown' })
    await expect(a.flush()).resolves.toBeUndefined()
    expect(a.pendingCount).toBe(0) // dropped, not requeued unboundedly
  })

  it('flush is a no-op on an empty queue', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch
    const a = new NavigationAnalytics({ endpoint: '/x', fetchImpl })
    await a.flush()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
