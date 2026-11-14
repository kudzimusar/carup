/**
 * RX-02A S1-4B (R2) — Route-family presentation flag (DEFAULT-OFF + fail-closed).
 *
 * The unified shell candidate is a NONPRODUCTION, isolated QA surface. Two
 * independent layers protect every existing environment:
 *
 *  LAYER 1 — ENVIRONMENT GATE (fail-closed, P0-C): in a production build
 *    (`vite build`, MODE=production — which is how production AND every shared
 *    staging/preview deploy is built) the flag can NEVER turn on. Not via
 *    sessionStorage, not via the global harness override, not via
 *    VITE_CARUP_UNIFIED_UI, not via ?carup-ui=unified, even when a user crafts
 *    all four at once. Only an isolated, specifically authorized NONPRODUCTION
 *    build (dev server, vitest, or an explicitly authorized development-mode
 *    build) can evaluate the opt-in sources at all.
 *
 *  LAYER 2 — EXPLICIT OPT-IN (first match wins, only when layer 1 passes):
 *    1. sessionStorage 'carup-unified-ui' = '1'   (per-tab isolated test enable)
 *    2. globalThis.__CARUP_UNIFIED_UI__ === true  (isolated test harness only)
 *    3. import.meta.env.VITE_CARUP_UNIFIED_UI === 'true'  (authorized test builds)
 *    4. URL ?carup-ui=unified                      (read once at boot)
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

/** Every input the flag decision needs, gathered from the environment. */
export interface UnifiedFlagSources {
  /** True in any `vite build` output (MODE=production) — incl. shared staging/preview. */
  prod: boolean
  storageValue: string | null
  globalValue: unknown
  envValue: string | undefined
  search: string
}

/**
 * Pure flag decision. Exported (and side-effect free) so the fail-closed
 * production behavior is deterministically testable: `readFlag({ prod: true, … })`
 * must be false for EVERY opt-in combination.
 */
export function readFlag(s: UnifiedFlagSources): boolean {
  // LAYER 1 — deployed builds (production + shared staging/preview) are
  // permanently OFF regardless of any client-controlled opt-in source.
  if (s.prod) return false
  // LAYER 2 — explicit, isolated opt-in (first match wins).
  if (s.storageValue === '1') return true
  if (s.globalValue === true) return true
  if (s.envValue === 'true') return true
  try {
    const params = new URLSearchParams(s.search)
    if (params.get(UNIFIED_UI_QUERY_PARAM) === UNIFIED_UI_QUERY_VALUE) return true
  } catch {
    /* unparseable search — fall through to OFF */
  }
  return false
}

/** Gather the real sources from the runtime environment (called once at load). */
function readSources(): UnifiedFlagSources {
  let storageValue: string | null = null
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      storageValue = window.sessionStorage.getItem(UNIFIED_UI_STORAGE_KEY)
    }
  } catch {
    /* storage unavailable (private mode, disabled) — treat as unset */
  }
  let globalValue: unknown
  try {
    globalValue = (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__
  } catch {
    globalValue = undefined
  }
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
  return {
    prod: env?.PROD === true,
    storageValue,
    globalValue,
    envValue: typeof env?.VITE_CARUP_UNIFIED_UI === 'string' ? env.VITE_CARUP_UNIFIED_UI : undefined,
    search: typeof window !== 'undefined' && typeof window.location?.search === 'string'
      ? window.location.search
      : '',
  }
}

const enabled = readFlag(readSources())

/** True only when the unified shell candidate was explicitly opted into inside
 * an isolated NONPRODUCTION build. Always false in production/staging builds. */
export function isUnifiedUiEnabled(): boolean {
  return enabled
}
