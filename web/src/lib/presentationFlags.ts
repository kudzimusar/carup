/**
 * RX03 — page-composition release switches (separate from, and never weakening, the RX-02
 * unified-shell flag in `components/shell/unifiedFlag.ts`).
 *
 * The redesigned "showroom" compositions ship alongside the accepted ones. Which one a visitor sees
 * is decided here, fail-closed:
 *
 *  PRODUCTION-MODE BUILDS (`vite build`; production, staging and every preview):
 *    only a BUILD-TIME setting can turn a presentation on —
 *      VITE_CARUP_SHOWROOM_PAGES=on   (P1a: Home, Marketplace, Vehicle Detail page bodies)
 *      VITE_CARUP_SHOWROOM_CHROME=on  (P1b: Option 5 logo in header/footer, one phone bottom bar)
 *      VITE_CARUP_LAUNCH_PREVIEW=on   (launch-capability previews: designed experiences whose
 *                                      underlying capability is not yet functional/certified, e.g.
 *                                      Scan to Start. Internal preview only; never a public default.)
 *    Nothing a visitor controls is read: no query string, no storage, no global. Setting that
 *    variable on a deployed project is a release decision for the Owner; removing it and rebuilding
 *    (or promoting the previous build) is the rollback. No data, API, permission or route changes
 *    with either: the switch only chooses which component renders inside the same guarded route.
 *
 *  NON-PRODUCTION BUILDS (dev server, vitest):
 *    the build-time setting, or an isolated opt-in for review —
 *      sessionStorage 'carup-showroom-pages' / 'carup-showroom-chrome' = '1'
 *      globalThis.__CARUP_SHOWROOM_PAGES__ / __CARUP_SHOWROOM_CHROME__ === true  (test harnesses)
 *      ?carup-showroom=pages,chrome,preview on any URL (remembered for the tab via sessionStorage)
 *
 * Anything else is OFF. The default everywhere is the accepted composition.
 */
export type PresentationKey = 'pages' | 'chrome' | 'preview'

interface PresentationDefinition {
  envName: string
  storageKey: string
  globalName: string
  queryToken: string
}

export const PRESENTATIONS: Record<PresentationKey, PresentationDefinition> = {
  pages: {
    envName: 'VITE_CARUP_SHOWROOM_PAGES',
    storageKey: 'carup-showroom-pages',
    globalName: '__CARUP_SHOWROOM_PAGES__',
    queryToken: 'pages',
  },
  chrome: {
    envName: 'VITE_CARUP_SHOWROOM_CHROME',
    storageKey: 'carup-showroom-chrome',
    globalName: '__CARUP_SHOWROOM_CHROME__',
    queryToken: 'chrome',
  },
  preview: {
    envName: 'VITE_CARUP_LAUNCH_PREVIEW',
    storageKey: 'carup-launch-preview',
    globalName: '__CARUP_LAUNCH_PREVIEW__',
    queryToken: 'preview',
  },
}

export const PRESENTATION_QUERY_PARAM = 'carup-showroom'

export interface PresentationSources {
  /** True in any `vite build` output (MODE=production), including staging and previews. */
  prod: boolean
  envValue: string | undefined
  storageValue: string | null
  globalValue: unknown
  search: string
}

/** Pure decision, exported so the fail-closed production rule is testable for every input. */
export function readPresentation(key: PresentationKey, s: PresentationSources): boolean {
  if (s.envValue === 'on') return true
  // Production-mode builds stop here: no visitor-controlled source is consulted.
  if (s.prod) return false
  if (s.storageValue === '1') return true
  if (s.globalValue === true) return true
  try {
    const tokens = (new URLSearchParams(s.search).get(PRESENTATION_QUERY_PARAM) || '').split(',').map(t => t.trim())
    if (tokens.includes(PRESENTATIONS[key].queryToken)) return true
  } catch {
    /* unparseable search: OFF */
  }
  return false
}

function gatherSources(key: PresentationKey): PresentationSources {
  const def = PRESENTATIONS[key]
  // Static member access on purpose: Vite replaces `import.meta.env.PROD` and each named variable
  // with literals at build time (and vitest's stubEnv reaches exactly these accesses).
  const envValue = key === 'pages'
    ? (import.meta.env.VITE_CARUP_SHOWROOM_PAGES as string | undefined)
    : key === 'chrome'
      ? (import.meta.env.VITE_CARUP_SHOWROOM_CHROME as string | undefined)
      : (import.meta.env.VITE_CARUP_LAUNCH_PREVIEW as string | undefined)
  let storageValue: string | null = null
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) storageValue = window.sessionStorage.getItem(def.storageKey)
  } catch {
    storageValue = null
  }
  let globalValue: unknown
  try {
    globalValue = (globalThis as Record<string, unknown>)[def.globalName]
  } catch {
    globalValue = undefined
  }
  return {
    prod: import.meta.env.PROD === true,
    envValue,
    storageValue,
    globalValue,
    search: typeof window !== 'undefined' && typeof window.location?.search === 'string' ? window.location.search : '',
  }
}

/**
 * Remember a review opt-in from the URL for the rest of the tab, in non-production builds only, so
 * in-app navigation (which drops the query string) keeps the same presentation.
 */
function rememberQueryOptIn(key: PresentationKey, s: PresentationSources) {
  if (s.prod || typeof window === 'undefined') return
  if (!readPresentation(key, { ...s, storageValue: null, globalValue: undefined, envValue: undefined })) return
  try {
    window.sessionStorage?.setItem(PRESENTATIONS[key].storageKey, '1')
  } catch {
    /* storage unavailable: the query still applies to this page view */
  }
}

export function isPresentationEnabled(key: PresentationKey): boolean {
  const sources = gatherSources(key)
  rememberQueryOptIn(key, sources)
  return readPresentation(key, sources)
}

/** P1a: the redesigned Home, Marketplace and Vehicle Detail page bodies. */
export function isShowroomPagesEnabled(): boolean {
  return isPresentationEnabled('pages')
}

/** P1b: the Option 5 public chrome (legacy header/footer logo, one phone bottom bar). Independent of P1a. */
export function isShowroomChromeEnabled(): boolean {
  return isPresentationEnabled('chrome')
}

/**
 * Launch-capability previews: designed launch experiences whose capability is not yet functional or
 * independently accepted (Scan to Start before governed OCR is live). Never on in a production build
 * unless the build sets VITE_CARUP_LAUNCH_PREVIEW=on for an internal preview deployment.
 */
export function isLaunchPreviewEnabled(): boolean {
  return isPresentationEnabled('preview')
}
