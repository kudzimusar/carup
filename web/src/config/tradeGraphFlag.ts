/**
 * UI-10 — Diaspora Trade Graph dashboard feature flag (fail closed) + truthfulness notices.
 *
 * VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED gates the Trade Graph FRONTEND only:
 *   - OFF (default): the nav entry is hidden (featureRegistry isHidden) AND /diaspora/trade-graph
 *     renders an explicit unavailable state and fetches nothing.
 *   - ON ('true'): the nav entry appears and the dashboard renders.
 *
 * This is DISTINCT from the backend capability gate (DIASPORA_TRADE_GRAPH), which makes the entire
 * API surface return 404 when off. Both must be on for the dashboard to show data, and neither is an
 * authorization boundary: every traversal is tenant-scoped server-side, with RLS behind it. Turning
 * this flag on can never widen what a user is allowed to see — only whether they see the page.
 *
 * Read at call time (not module-eval time) so tests can stub import.meta.env per case, and
 * optional-chained so a Node context with no import.meta.env fails closed instead of throwing (the
 * Playwright Node runner imports the feature registry, and therefore this module, transitively).
 */
export function tradeGraphUiEnabled(): boolean {
  return import.meta.env?.VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED === 'true'
}

/**
 * AI insight panels are gated SEPARATELY from the dashboard itself.
 *
 * The dashboard is a read-only view of counts and relationships. AI insights send a redacted context
 * to a model — a materially different risk, so it gets its own switch and stays off even when the
 * dashboard is on.
 */
export function tradeGraphAiInsightsEnabled(): boolean {
  return import.meta.env?.VITE_DIASPORA_TRADE_GRAPH_AI_ENABLED === 'true'
}

/**
 * Load-bearing, asserted-verbatim notice shown wherever AI insight is offered.
 *
 * The claim it makes is enforced by the backend redaction policy, not by this string: the AI context
 * path passes node data and edge metadata through role-aware redaction before anything leaves the
 * service. The notice exists so a user can see that guarantee, not so the UI can assert it.
 */
export const TRADE_GRAPH_AI_REDACTION_NOTICE =
  'AI insights are generated from a redacted view of your trade graph. Raw participant identifiers, ' +
  'document references, email addresses and phone numbers are removed on the server before any ' +
  'context is sent to a model.'

/**
 * Shown whenever the projection is behind. A dashboard that renders a confidently-empty graph
 * because the projection stalled is worse than one that renders nothing.
 */
export const TRADE_GRAPH_STALE_NOTICE =
  'These figures are derived from a background projection that is currently behind. What you see may ' +
  'not reflect the latest activity.'

/** The graph is derived, never authored — this is why there is no "edit" anywhere on the page. */
export const TRADE_GRAPH_DERIVED_NOTICE =
  'The trade graph is derived automatically from recorded events. It cannot be edited directly; ' +
  'corrections are made by fixing the underlying record.'

export type TradeGraphHealth = 'HEALTHY' | 'DEGRADED' | 'STALLED' | 'UNKNOWN' | 'EMPTY'

/**
 * Presentation for each health state.
 *
 * `label` carries the meaning on its own — colour is never the only signal, so a colour-blind or
 * monochrome-display user loses nothing. `icon` is decorative; the label is the accessible name.
 */
export const TRADE_GRAPH_HEALTH_PRESENTATION: Record<TradeGraphHealth, {
  label: string
  description: string
  tone: 'ok' | 'warn' | 'error' | 'neutral'
}> = {
  HEALTHY: {
    label: 'Up to date',
    description: 'The projection has processed all recent events.',
    tone: 'ok',
  },
  DEGRADED: {
    label: 'Behind',
    description: 'The projection is lagging or has events it could not process.',
    tone: 'warn',
  },
  STALLED: {
    label: 'Stalled',
    description: 'The projection is significantly behind or needs a replay. Figures may be well out of date.',
    tone: 'error',
  },
  UNKNOWN: {
    label: 'Not yet run',
    description: 'The projection has not run for this tenant, so there is nothing to report yet.',
    tone: 'neutral',
  },
  EMPTY: {
    label: 'No activity yet',
    description: 'The projection is up to date and there is no trade activity to show.',
    tone: 'neutral',
  },
}

/** Human-readable lag, used in text so the state is never conveyed by colour alone. */
export function formatLag(lagSeconds: number | null | undefined): string {
  if (lagSeconds == null || Number.isNaN(Number(lagSeconds))) return 'unknown'
  const s = Math.max(0, Math.round(Number(lagSeconds)))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

/**
 * Node/edge type labels for display.
 *
 * Falls back to a de-underscored, title-cased form so a node type added to the backend later still
 * renders as readable text rather than SELLER_STOCK_ITEM.
 */
export function humanizeGraphType(type: string): string {
  const known: Record<string, string> = {
    BUYER_ORDER: 'Buyer orders',
    SELLER_STOCK_ITEM: 'Seller stock',
    ACCEPTED_QUOTE: 'Accepted quotes',
    SUPPLY_DOCUMENT: 'Supply documents',
    CARGO_RESERVATION: 'Cargo reservations',
    COMPLIANCE_REVIEW: 'Compliance reviews',
    PAYMENT_MILESTONE: 'Payment milestones',
    SAFETRADE_TRANSACTION: 'SafeTrade cases',
    SAFETRADE_MILESTONE: 'SafeTrade milestones',
    SAFETRADE_DISPUTE: 'SafeTrade disputes',
    REPUTATION_RECORD: 'Reputation records',
    TRADE_PROFILE: 'Trade profiles',
    WORKBOOK_BATCH: 'Workbook batches',
    DRIVE_FILE: 'Drive files',
    AI_COMMAND: 'AI commands',
  }
  if (known[type]) return known[type]
  return String(type || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
