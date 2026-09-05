/**
 * "Not checked" is not "checked and clean".
 *
 * `maybeFetchRows` caught any error and returned `[]`. For the two TRUST inputs that was not a
 * degradation but an INVERSION: `deriveSuspicionLevel([])` is `'clear'` and
 * `deriveEvidenceStatus([])` is `'none'`, so a failed `partsentry_logs` read published a governed
 * all-clear — `risk_status: 'clear'`, no risk banner, `operator_review_required: false` — for a
 * vehicle whose rows might carry `flagged`. The buyer could not tell it from a vehicle that had
 * actually been checked and found clean, and a safety signal was silently inverted.
 *
 * The rule was already stated in the same file, one reader down: `readListingImages` is deliberately
 * kept OUT of `maybeFetchRows` because "`[]` is a FINDING … and a read that threw has found nothing
 * of the sort". Evidence and PartSentry were simply left inside it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { buildTrustSummary } = await import('../services/marketplace/marketplaceTrustSummaryService.js');
const { fetchListingRelatedRows } = await import('../services/marketplace/listingSummaryService.js');

const vehicle = { vin: 'TRUSTVIN00000001', status: 'Available' };
const listingSummary = { marketplace_tags: [], passport_verified: false };

/** A PartSentry row that SHOULD raise the alarm. */
const FLAGGED = [{ suspicion_status: 'flagged', verification_status: 'verified', public_card_eligible: true }];

// ═══════════════════════════════════════════════════════════════════════════════════
// The inversion itself
// ═══════════════════════════════════════════════════════════════════════════════════

test('an UNREADABLE parts-provenance input never publishes a governed all-clear', () => {
  const summary = buildTrustSummary({ vehicle, listingSummary, partSentryRows: [], partSentryRead: false });

  assert.equal(summary.suspicion_status, 'unavailable', 'an unread input is not "clear"');
  assert.notEqual(summary.risk_status, 'clear', 'risk must never read clear off a read that failed');
  assert.equal(summary.risk_status, 'unavailable');
  assert.ok(summary.risk_reasons.includes('trust_inputs_unreadable'),
    'the reason must name the actual fact');
  // And it must NOT claim a provenance finding that was never made.
  assert.ok(!summary.risk_reasons.includes('parts_provenance_under_review'));
});

test('an UNREADABLE evidence input never publishes "none"', () => {
  const summary = buildTrustSummary({ vehicle, listingSummary, evidenceRows: [], evidenceRead: false });
  assert.equal(summary.evidence_status, 'unavailable', '"none" is a finding; this read found nothing of the sort');
  assert.equal(summary.risk_status, 'unavailable');
});

test('the inversion is closed: a flagged vehicle whose read fails is not published as clear', () => {
  // The concrete harm. Before the fix, the rows below were unreachable because the read threw, and
  // the empty array they degraded to produced exactly the same summary as a clean vehicle.
  const readFailed = buildTrustSummary({ vehicle, listingSummary, partSentryRows: [], partSentryRead: false });
  const actuallyClean = buildTrustSummary({ vehicle, listingSummary, partSentryRows: [], partSentryRead: true });

  assert.notDeepEqual(
    { r: readFailed.risk_status, s: readFailed.suspicion_status },
    { r: actuallyClean.risk_status, s: actuallyClean.suspicion_status },
    'a failed read and a clean vehicle must not produce the same trust verdict',
  );
  assert.equal(actuallyClean.risk_status, 'clear');
  assert.equal(readFailed.risk_status, 'unavailable');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ANTI-VACUITY — a MEASURED all-clear is still correct, and a real finding still fires
// ═══════════════════════════════════════════════════════════════════════════════════

test('a SUCCESSFUL empty read still reads clear — a measured zero is correct', () => {
  const summary = buildTrustSummary({ vehicle, listingSummary, evidenceRows: [], partSentryRows: [] });
  assert.equal(summary.suspicion_status, 'clear');
  assert.equal(summary.evidence_status, 'none');
  assert.equal(summary.risk_status, 'clear');
  assert.deepEqual(summary.risk_reasons, []);
});

test('a real flagged row still raises the alarm', () => {
  const summary = buildTrustSummary({ vehicle, listingSummary, partSentryRows: FLAGGED });
  assert.equal(summary.suspicion_status, 'flagged');
  assert.equal(summary.risk_status, 'flagged');
  assert.ok(summary.risk_reasons.includes('parts_provenance_under_review'));
});

test('a quarantined vehicle still outranks an unreadable input', () => {
  const summary = buildTrustSummary({
    vehicle: { ...vehicle, status: 'Suspended' }, listingSummary, partSentryRead: false,
  });
  assert.equal(summary.risk_status, 'blocked', 'a known block must not be softened to "unavailable"');
  assert.ok(summary.risk_reasons.includes('listing_restricted_pending_review'));
  assert.ok(summary.risk_reasons.includes('trust_inputs_unreadable'));
});

// ═══════════════════════════════════════════════════════════════════════════════════
// The discriminator actually reaches the summary
// ═══════════════════════════════════════════════════════════════════════════════════

/** A client whose named tables fail and whose other reads succeed. */
function clientFailing(failTables) {
  return {
    from(table) {
      const chain = {
        select: () => chain,
        in: () => chain,
        order: () => chain,
        then: (res, rej) => (failTables.includes(table)
          ? Promise.resolve({ data: null, error: { message: `${table} unavailable` } })
          : Promise.resolve({ data: [], error: null })).then(res, rej),
      };
      return chain;
    },
  };
}

test('fetchListingRelatedRows reports WHICH reads resolved', async () => {
  const ok = await fetchListingRelatedRows(clientFailing([]), ['V1']);
  assert.equal(ok.evidenceRead, true);
  assert.equal(ok.partSentryRead, true);
  assert.equal(ok.ownershipRead, true);

  const broken = await fetchListingRelatedRows(clientFailing(['vehicle_evidence', 'partsentry_logs']), ['V1']);
  assert.equal(broken.evidenceRead, false, 'a failed evidence read must be reported as such');
  assert.equal(broken.partSentryRead, false);
  // Independent reads: one failing must not be reported as all failing.
  assert.equal(broken.ownershipRead, true);
});

test('the flags carry into a trust summary that fails closed', async () => {
  const broken = await fetchListingRelatedRows(clientFailing(['partsentry_logs']), ['V1']);
  const summary = buildTrustSummary({
    vehicle, listingSummary,
    evidenceRows: broken.evidenceByVin.get('V1') || [],
    partSentryRows: broken.partSentryByVin.get('V1') || [],
    evidenceRead: broken.evidenceRead,
    partSentryRead: broken.partSentryRead,
  });
  assert.equal(summary.risk_status, 'unavailable');
  // `operator_review_required` in marketplaceListingDetailService is derived from
  // `risk_status !== 'clear'`, so this vehicle is now REVIEWED rather than quietly passed.
  assert.notEqual(summary.risk_status, 'clear');
});
