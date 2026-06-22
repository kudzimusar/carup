/**
 * Phase 8 — Diaspora Subscription UI feature flag (fail closed).
 *
 * VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED gates the Subscription frontend ONLY:
 *   - OFF (default): the nav entry is hidden (featureRegistry isHidden) AND the
 *     /diaspora/subscription page renders an explicit "not available" unavailable state.
 *   - ON  ('true'): the nav entry appears and the page renders the live UI.
 *
 * This is distinct from the backend enforcement flag (DIASPORA_SUBSCRIPTION_ENFORCEMENT) and from any
 * billing-live switch. It NEVER enables real billing — the backend billing provider is always sandbox.
 *
 * Read at call time (not module-eval time) so tests can stub import.meta.env per case.
 */
export function subscriptionUiEnabled(): boolean {
  return import.meta.env.VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED === 'true'
}

/** Visible-text contract for sandbox mode (asserted by tests; never claim a real charge). */
export const SANDBOX_BILLING_NOTICE =
  'Subscription management is currently operating in sandbox mode. No real payment is collected and no live billing provider is activated.'
