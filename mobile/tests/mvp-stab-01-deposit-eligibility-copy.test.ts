import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { depositEligibilityReasonSentence, depositEligibilitySummary } from '@shared/transaction/depositEligibilityCopy';

/**
 * CARUP-MVP-STAB-01 F-011 (Native SafePay) — a declined deposit is explained in sentences. The screen
 * used to join the server's reason codes ("CarUp declined deposit eligibility: active_reservation_required").
 */
const BACKEND_CODES = [
  'active_reservation_required', 'reservation_expired', 'reservation_transaction_mismatch', 'reservation_buyer_mismatch',
  'reservation_seller_mismatch', 'reservation_inquiry_mismatch', 'listing_amount_unavailable',
  'listing_amount_below_deposit_policy', 'deposit_currency_unsupported',
];

describe('deposit eligibility copy', () => {
  it('every code the backend can send has its own sentence, and no sentence repeats a code', () => {
    const source = readFileSync(resolve(__dirname, '../../backend/services/transaction/marketplacePaymentService.js'), 'utf8');
    const sent = Array.from(source.matchAll(/reasons\.push\('([a-z_]+)'\)/g), (m) => m[1]);
    expect([...new Set(sent)].sort()).toEqual([...BACKEND_CODES].sort());
    for (const code of BACKEND_CODES) {
      const sentence = depositEligibilityReasonSentence(code);
      expect(sentence).not.toContain('_');
      expect(sentence).not.toBe('CarUp could not offer a deposit for this purchase yet.');
    }
  });

  it('the four mismatch codes read as one sentence, and transaction-gate reasons are grouped', () => {
    expect(depositEligibilitySummary(['reservation_buyer_mismatch', 'reservation_seller_mismatch', 'transaction_gate:seller_authority_missing', 'transaction_gate:x']))
      .toBe('Your reservation does not match this purchase. Start again from the reservation. CarUp has not cleared this purchase for a deposit yet.');
  });

  it('an unknown or missing reason is never echoed', () => {
    expect(depositEligibilitySummary(['some_new_internal_code'])).toBe('CarUp could not offer a deposit for this purchase yet.');
    expect(depositEligibilitySummary([])).toBe('CarUp could not offer a deposit for this purchase yet.');
    expect(depositEligibilitySummary(null)).toBe('CarUp could not offer a deposit for this purchase yet.');
  });

  it('the purchase screen words the decline with the shared sentences, never the joined codes', () => {
    const screen = readFileSync(resolve(__dirname, '../app/vehicle/[vin]/transaction.tsx'), 'utf8');
    expect(screen).toContain('depositEligibilitySummary(eligibility.reasons)');
    expect(screen).not.toContain("eligibility.reasons.join(', ')");
  });
});
