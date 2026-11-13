/**
 * RX-02A S1-4B — Unified presentation flag is strictly DEFAULT-OFF and only
 * enables via an explicit isolated opt-in. These tests run each precedence
 * branch in a fresh module registry so the module-level read is re-evaluated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEY = 'carup-unified-ui'

async function loadFresh(): Promise<{ isUnifiedUiEnabled(): boolean }> {
  // Reset the module registry so the module body (and its readFlag) re-runs.
  vi.resetModules()
  const mod = await import('./unifiedFlag')
  return mod
}

describe('unifiedFlag — default OFF', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  })
  afterEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  })

  it('is OFF with no opt-in of any kind', async () => {
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(false)
  })

  it('is OFF when sessionStorage is set to something other than "1"', async () => {
    window.sessionStorage.setItem(KEY, '0')
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(false)
  })

  it('is OFF when the query param has a non-unified value', async () => {
    window.history.replaceState({}, '', '/login?carup-ui=other')
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(false)
  })
})

describe('unifiedFlag — explicit opt-in', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  })
  afterEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
    window.history.replaceState({}, '', '/')
  })

  it('is ON when sessionStorage flag is "1" (isolated per-tab enable)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(true)
  })

  it('is ON when the test harness global is set', async () => {
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(true)
  })

  it('is ON when the URL query requests the unified presentation', async () => {
    window.history.replaceState({}, '', '/login?carup-ui=unified')
    const { isUnifiedUiEnabled } = await loadFresh()
    expect(isUnifiedUiEnabled()).toBe(true)
  })
})
