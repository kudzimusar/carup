/**
 * RX-02A S1-4B — Route-family presentation flag (DEFAULT-OFF).
 *
 * The unified shell candidate is OFF in every existing environment. It is
 * exercised only through an explicit, isolated opt-in so the new presentation
 * never changes what existing users see. This is a PRESENTATION flag only: it
 * swaps chrome/layout and never grants, removes or weakens any route guard,
 * tenancy, entitlement, reviewer isolation or backend check. Those remain
 * authoritative and untouched.
 *
 * Opt-in precedence (first match wins):
 *   1. sessionStorage 'carup-unified-ui' = '1'   (per-tab isolated test enable)
 *   2. globalThis.__CARUP_UNIFIED_UI__ === true  (isolated test harness only)
 *   3. import.meta.env.VITE_CARUP_UNIFIED_UI === 'true'  (build-time, opt-in env)
 *   4. URL ?carup-ui=unified                      (read once at boot; isolated preview)
 *
 * Anything else (unset, '0', 'false', any other value) ⇒ OFF. No default-on,
 * no auto-detection, no persistence beyond the sessionStorage the tester set.
 *
 * Rollback: remove the flag source (close the tab / drop the env / remove the
 * query) — presentation returns to the preserved legacy composition. No data,
 * transaction, reviewer audit or permission is affected because the flag only
 * ever changed chrome.
 */
export const UNIFIED_UI_STORAGE_KEY = 'carup-unified-ui'
export const UNIFIED_UI_QUERY_PARAM = 'carup-ui'
export const UNIFIED_UI_QUERY_VALUE = 'unified'

function readFlag(): boolean {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (window.sessionStorage.getItem(UNIFIED_UI_STORAGE_KEY) === '1') return true
    }
  } catch {
    /* storage unavailable (private mode, disabled) — fall through */
  }
  try {
    const g = globalThis as { __CARUP_UNIFIED_UI__?: unknown }
    if (g.__CARUP_UNIFIED_UI__ === true) return true
  } catch {
    /* ignore */
  }
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    if (env?.VITE_CARUP_UNIFIED_UI === 'true') return true
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
      const params = new URLSearchParams(window.location.search)
      if (params.get(UNIFIED_UI_QUERY_PARAM) === UNIFIED_UI_QUERY_VALUE) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

const enabled = readFlag()

/** True only when the unified shell candidate was explicitly opted into. */
export function isUnifiedUiEnabled(): boolean {
  return enabled
}
