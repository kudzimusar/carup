/**
 * CARUP-MVP-STAB-01 F-011 — why CarUp declined a SafePay deposit, worded for the buyer.
 *
 * `POST /api/escrow/:id/deposit/eligibility` answers with machine reasons
 * (backend/services/transaction/marketplacePaymentService.js): `active_reservation_required`,
 * `reservation_expired`, four `reservation_*_mismatch` codes, `listing_amount_unavailable`,
 * `listing_amount_below_deposit_policy`, `deposit_currency_unsupported`, and `transaction_gate:<reason>`.
 * Joining those codes onto the screen showed a buyer "active_reservation_required". Each code maps to one
 * sentence; codes that mean the same thing to a buyer share it; an unknown code is never echoed.
 */
const SENTENCES: Record<string, string> = {
  active_reservation_required: 'You need an active reservation for this vehicle first.',
  reservation_expired: 'Your reservation has expired. Reserve the vehicle again to continue.',
  reservation_transaction_mismatch: 'Your reservation does not match this purchase. Start again from the reservation.',
  reservation_buyer_mismatch: 'Your reservation does not match this purchase. Start again from the reservation.',
  reservation_seller_mismatch: 'Your reservation does not match this purchase. Start again from the reservation.',
  reservation_inquiry_mismatch: 'Your reservation does not match this purchase. Start again from the reservation.',
  listing_amount_unavailable: 'This listing has no price CarUp can use for a deposit.',
  listing_amount_below_deposit_policy: 'This listing’s price is below the amount SafePay deposits are offered for.',
  deposit_currency_unsupported: 'SafePay deposits are not available in this listing’s currency yet.',
}
const TRANSACTION_GATE_SENTENCE = 'CarUp has not cleared this purchase for a deposit yet.'
const UNKNOWN_SENTENCE = 'CarUp could not offer a deposit for this purchase yet.'

/** One reason code as a buyer sentence; never the code itself. */
export function depositEligibilityReasonSentence(code: string): string {
  const value = String(code ?? '').trim()
  if (SENTENCES[value]) return SENTENCES[value]
  if (value.startsWith('transaction_gate:')) return TRANSACTION_GATE_SENTENCE
  return UNKNOWN_SENTENCE
}

/** Every reason as distinct buyer sentences, in the order CarUp gave them, joined into one paragraph. */
export function depositEligibilitySummary(reasons: readonly string[] | null | undefined): string {
  const list = Array.isArray(reasons) ? reasons : []
  const sentences: string[] = []
  for (const reason of list) {
    const sentence = depositEligibilityReasonSentence(reason)
    if (!sentences.includes(sentence)) sentences.push(sentence)
  }
  return sentences.length ? sentences.join(' ') : UNKNOWN_SENTENCE
}
