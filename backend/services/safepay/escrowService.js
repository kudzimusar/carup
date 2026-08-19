// Issue #164 Phase 6 — legacy SafePay compatibility shim.
//
// Historical CarUp code used this module as a second transaction authority. It accepted buyer/seller
// economics directly, wrote `safepay_escrows`, fabricated fee splits, and — most critically — treated
// a payment-state transition to `Completed` as legal ownership proof by rewriting `vehicles.owner_id`
// and `vehicle_ownership_history`.
//
// The canonical transaction authority now lives in:
//   - services/transaction/marketplaceTransactionAuthority.js
//   - services/reservation/reservationService.js
//   - services/transaction/marketplacePaymentService.js
//   - services/escrow/escrowTrustService.js
//
// Keep the numeric helpers exported for any harmless legacy consumers, but leave no executable
// transaction/ownership writer behind. The old server routes are shadowed by the canonical router;
// this shim is defense-in-depth so route reordering or a forgotten direct import cannot resurrect the
// pre-Phase-6 authority model.

export const LEGACY_SAFEPAY_DISABLED = 'LEGACY_SAFEPAY_TRANSACTION_AUTHORITY_DISABLED';

export function toCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

export function fromCents(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return NaN;
  return Number((value / 100).toFixed(2));
}

function legacyAuthorityError(operation) {
  const error = new Error(
    `${operation} is disabled. Use the canonical Marketplace transaction/reservation/payment authority.`,
  );
  error.code = LEGACY_SAFEPAY_DISABLED;
  return error;
}

/**
 * @deprecated Phase 6 removed this function as a transaction writer. Browser/server callers must
 * request a canonical transaction from VIN + authenticated identity; seller, economics and provider
 * state are resolved server-side.
 */
export async function createEscrow() {
  throw legacyAuthorityError('Legacy SafePay escrow creation');
}

/**
 * @deprecated Phase 6 removed direct status mutation. Provider money truth is reconciled through the
 * SafeTrade PaymentProvider abstraction and canonical atomic RPCs. Payment settlement never transfers
 * legal vehicle ownership by itself.
 */
export async function updateEscrowStatus() {
  throw legacyAuthorityError('Legacy SafePay status mutation');
}

export default {
  LEGACY_SAFEPAY_DISABLED,
  toCents,
  fromCents,
  createEscrow,
  updateEscrowStatus,
};
