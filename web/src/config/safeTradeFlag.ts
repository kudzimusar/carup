/**
 * Phase 9 — Diaspora SafeTrade UI feature flag (fail closed) + non-custodial notice constants.
 *
 * VITE_DIASPORA_SAFETRADE_UI_ENABLED gates the SafeTrade frontend ONLY:
 *   - OFF (default): the nav entry is hidden (featureRegistry isHidden) AND the
 *     /diaspora/safetrade page renders an explicit "not available" unavailable state.
 *   - ON  ('true'): the nav entry appears and the page renders the live UI.
 *
 * This is DISTINCT from the backend master gate (DIASPORA_SAFETRADE_ENABLED) and from the
 * live-payment switch (DIASPORA_SAFETRADE_LIVE_PAYMENT). It NEVER enables real money movement —
 * SafeTrade is assurance coordination + a SANDBOX payment-state simulation only. The UI must never
 * claim CarUp holds, receives or automatically releases real customer funds.
 *
 * Read at call time (not module-eval time) so tests can stub import.meta.env per case.
 */
export function safeTradeUiEnabled(): boolean {
  // Optional-chain so a Node context where import.meta.env is undefined fails closed (false), not
  // throws. The Playwright Node runner imports the registry (which imports this) transitively, and
  // there import.meta.env is undefined — a non-optional access would crash the whole e2e job.
  return import.meta.env?.VITE_DIASPORA_SAFETRADE_UI_ENABLED === 'true'
}

/**
 * The MANDATORY non-custodial assurance notice. Exact, load-bearing wording asserted by tests and
 * rendered verbatim on every SafeTrade surface. It must never claim CarUp is a bank / escrow
 * custodian / regulated payment provider / customs authority / delivery guarantor.
 */
export const SAFETRADE_NON_CUSTODIAL_NOTICE =
  'SafeTrade coordinates assurance checks and sandbox payment-state simulations. CarUp does not hold, ' +
  'receive or automatically release real customer funds. Live payment or escrow services require a ' +
  'separately approved regulated provider and are not active.'

/**
 * Secondary clarifying line: lifecycle states are only shown when an authoritative CarUp workflow
 * has verified them — the UI never fabricates compliance/shipment/delivery/release progress.
 */
export const SAFETRADE_VERIFIED_STATES_NOTICE =
  'Shipment, compliance, delivery and release states appear only when verified by the corresponding ' +
  'CarUp workflow.'

/** Short sandbox label reused on money-related controls/milestones (never claims a real charge). */
export const SAFETRADE_SANDBOX_LABEL =
  'Sandbox simulation only — no real funds move and no live escrow provider is active.'
