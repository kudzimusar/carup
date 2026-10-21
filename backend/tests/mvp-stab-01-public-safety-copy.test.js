/**
 * CARUP-MVP-STAB-01 F-013 — PUBLIC SAFETY COPY MAKES NO VERIFICATION CLAIM AND USES NO JARGON.
 *
 * Every public listing told buyers to "use the verified inquiry flow" (safety warnings and the Trust
 * summary's public copy — Serena GFC27-027051's live public_copy: "Trust signals are limited for this
 * listing. Request an inspection and use the verified inquiry flow."). Nothing about an inquiry is
 * verified, and "inquiry flow" / "backend-governed" are implementation words. The copy now says what
 * a buyer should do — keep the conversation in CarUp messages — and states the badge rule plainly.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { buildMockSupabase } = await import('./fixtures/marketplaceListings.js');
const { getMarketplaceListingDetail } = await import('../services/marketplace/marketplaceListingDetailService.js');
const { buildTrustSummary, buildVerificationSummary } = await import('../services/marketplace/marketplaceTrustSummaryService.js');
const { buildMarketplaceListingSummary } = await import('../services/marketplace/listingSummaryService.js');

const VIN = '1HGBH41JXMN109186';
const JARGON = /verified inquiry flow|inquiry flow|backend-governed|evidence-based/i;

function publicVehicle(overrides = {}) {
  const owner = '550e8400-e29b-41d4-a716-446655440000';
  return {
    vin: VIN, make: 'Nissan', model: 'Serena', year: 2018, mileage: 61000, price: 9800, currency: 'USD',
    status: 'Available', owner_id: owner, current_seller_id: owner, tenant_id: null,
    registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner',
    publication_status: 'published', created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

test('the public safety warnings say what to do, in plain words — exactly this list', async () => {
  const detail = await getMarketplaceListingDetail(buildMockSupabase({ vehicles: [publicVehicle()] }), VIN);
  assert.deepEqual(detail.safety_warnings, [
    'Do not pay outside CarUp.',
    'Contact the seller through CarUp and keep the conversation in CarUp messages.',
    'An independent inspection is recommended before purchase.',
    'CarUp shows a badge only when its records support it.',
    'Report any listing that asks you to transact off-platform.',
  ]);
  for (const line of detail.safety_warnings) assert.doesNotMatch(line, JARGON);
});

test('a listing with limited trust signals (Serena today) gets plain public copy', async () => {
  const detail = await getMarketplaceListingDetail(buildMockSupabase({ vehicles: [publicVehicle()] }), VIN);
  const expected = 'Trust signals are limited for this listing. Request an inspection and keep the conversation in CarUp messages.';
  assert.equal(detail.trust_summary.safe_public_copy, expected);
  assert.equal(detail.trust_summary.public_copy, expected);
});

test('every trust-summary copy branch keeps the conversation in CarUp messages and names no "inquiry flow"', () => {
  const branches = {
    blocked: { vehicle: publicVehicle({ status: 'Flagged' }) },
    under_review: { vehicle: publicVehicle(), partSentryRows: [{ vin: VIN, suspicion_status: 'watch' }] },
    limited: { vehicle: publicVehicle() },
    with_signals: { vehicle: publicVehicle(), evidenceRows: [{ verification_status: 'verified', visibility_level: 'public_safe' }] },
  };
  const copies = {};
  for (const [name, { vehicle, evidenceRows = [], partSentryRows = [] }] of Object.entries(branches)) {
    const listingSummary = buildMarketplaceListingSummary({ vehicle, evidenceRows, partSentryRows });
    const summary = buildTrustSummary({ vehicle, listingSummary, evidenceRows, partSentryRows });
    copies[name] = summary.safe_public_copy;
    assert.match(summary.safe_public_copy, /CarUp messages/, `${name}: ${summary.safe_public_copy}`);
    assert.doesNotMatch(summary.safe_public_copy, JARGON, `${name}: ${summary.safe_public_copy}`);
    assert.equal(summary.public_copy, summary.safe_public_copy);
  }
  // The branches still say different things — the rewording did not collapse them.
  assert.equal(new Set(Object.values(copies)).size, 4, JSON.stringify(copies));
  assert.match(copies.blocked, /under review/);
  assert.match(copies.under_review, /under review/);
});

test('the limited-verification note uses the same plain wording', () => {
  const vehicle = publicVehicle();
  const listingSummary = buildMarketplaceListingSummary({ vehicle });
  const verification = buildVerificationSummary({ vehicle, listingSummary });
  assert.deepEqual(verification.verification_notes_public, [
    'Verification is limited. Ask the seller for evidence and request an inspection in CarUp messages.',
  ]);
});
