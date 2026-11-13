/**
 * RX-02A S1-4B R2 — Unified presentation flag is fail-closed.
 *
 * Two test layers:
 *   1. PURE decision tests (`readFlag`) — prove the production gate fail-closes
 *      EVERY opt-in source and every combination of them (P0-C), and prove the
 *      nonproduction precedence branches.
 *   2. MODULE-level tests (`isUnifiedUiEnabled` via a fresh module registry) —
 *      prove the real module wiring reads sessionStorage/global/query in a
 *      NONPRODUCTION (vitest) build.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFlag, UNIFIED_UI_QUERY_VALUE, UNIFIED_UI_QUERY_PARAM, type UnifiedFlagSources } from './unifiedFlag'

const KEY = 'carup-unified-ui'

const base: UnifiedFlagSources = {
  prod: false,
  storageValue: null,
  globalValue: undefined,
  envValue: undefined,
  search: '',
}

describe('readFlag — pure decision', () => {
  it('is OFF with no opt-in of any kind', () => {
    expect(readFlag(base)).toBe(false)
  })

  it('honors sessionStorage=1 only in nonproduction', () => {
    expect(readFlag({ ...base, storageValue: '1' })).toBe(true)
    expect(readFlag({ ...base, storageValue: '0' })).toBe(false)
    expect(readFlag({ ...base, storageValue: 'yes' })).toBe(false)
  })

  it('honors the global harness override only in nonproduction', () => {
    expect(readFlag({ ...base, globalValue: true })).toBe(true)
    expect(readFlag({ ...base, globalValue: 'true' })).toBe(false)
  })

  it('honors the env var only in nonproduction', () => {
    expect(readFlag({ ...base, envValue: 'true' })).toBe(true)
    expect(readFlag({ ...base, envValue: 'TRUE' })).toBe(false)
  })

  it('honors the URL query only in nonproduction', () => {
    expect(readFlag({ ...base, search: `?${UNIFIED_UI_QUERY_PARAM}=${UNIFIED_UI_QUERY_VALUE}` })).toBe(true)
    expect(readFlag({ ...base, search: `?${UNIFIED_UI_QUERY_PARAM}=other` })).toBe(false)
  })

  describe('P0-C — production gate fail-closed', () => {
    it('sessionStorage=1 cannot enable a production build', () => {
      expect(readFlag({ ...base, prod: true, storageValue: '1' })).toBe(false)
    })
    it('the global override cannot enable a production build', () => {
      expect(readFlag({ ...base, prod: true, globalValue: true })).toBe(false)
    })
    it('the env var cannot enable a production build', () => {
      expect(readFlag({ ...base, prod: true, envValue: 'true' })).toBe(false)
    })
    it('the URL query cannot enable a production build', () => {
      expect(readFlag({ ...base, prod: true, search: `?${UNIFIED_UI_QUERY_PARAM}=${UNIFIED_UI_QUERY_VALUE}` })).toBe(false)
    })
    it('ALL four opt-in sources crafted at once still cannot enable a production build', () => {
      expect(readFlag({
        prod: true,
        storageValue: '1',
        globalValue: true,
        envValue: 'true',
        search: `?${UNIFIED_UI_QUERY_PARAM}=${UNIFIED_UI_QUERY_VALUE}`,
      })).toBe(false)
    })
  })
})

describe('isUnifiedUiEnabled — module wiring (NONPRODUCTION vitest build)', () => {
  async function loadFresh() {
    vi.resetModules()
    return await import('./unifiedFlag')
  }

  beforeEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  })
  afterEach(() => {
    window.sessionStorage.clear()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
    window.history.replaceState({}, '', '/')
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
