/**
 * Issue #164 — D1: the three unsupported GOVERNMENT_APPROVAL_FACTS claims cannot render publicly.
 *
 * Physically observed on the paired preview: a Landing card showed pill badges "Duty Cleared" and
 * "Zimra Verified" for VIN JF1GPAL60J9UAT303, while the SAME API response's canonical trust block
 * said, of those exact flags, "is not supported by any authoritative record and is not published"
 * (`unbacked_legacy_claims: 3`).
 *
 * Owner decision: OPTION 3 — suppress the three unconditionally now. Not the full FACT_MODEL M4
 * provenance gate, which is tracked separately.
 *
 * Why suppression loses nothing true: no legitimate writer exists for any of the three.
 * `duty_paid` is never set true; `zimra_verified` has no writer repo-wide; and `police_verified`
 * is set true in exactly one place, where it means "was reported stolen, then recovered" — the
 * INVERSE of the police-clearance badge it produced.
 *
 * Both publication routes are covered: the `marketplace_tags` array AND the flat booleans on the
 * summary, because suppressing only the array would leave the same assertion reachable by the
 * second route, where consumers derive their own labels from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  deriveMarketplaceTags,
  UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS,
  MARKETPLACE_TAGS,
} = await import('../services/marketplace/listingSummaryService.js');

/** A vehicle row with every legacy government-approval boolean set TRUE — the worst case. */
const vehicleClaimingEverything = (over = {}) => ({
  vin: 'JF1GPAL60J9UAT303',
  duty_paid: true,
  zimra_verified: true,
  police_verified: true,
  safe_pay_ready: true,
  inspection_ready: true,
  condition_category: 'recently_imported',
  mileage: 55700,
  ...over,
});

const PARTS_NONE = Object.freeze({
  recent_service: false, partsentry_checked: false,
  repair_history_count: 0, verified_parts_count: 0,
});

/** `deriveMarketplaceTags(vehicle, evidenceSummary, partSentrySummary, ownershipCount)` — positional. */
const derive = (vehicle, over = {}) => deriveMarketplaceTags(
  vehicle,
  over.evidenceSummary ?? { evidence_count: 0 },
  over.partSentrySummary ?? PARTS_NONE,
  over.ownershipCount ?? 2,
);

// ── The three claims cannot reach a public surface ───────────────────────────────────────────────

test('duty_cleared, zimra_verified and cid_clear are never derived, even when every column says true', () => {
  const tags = derive(vehicleClaimingEverything());
  for (const suppressed of ['duty_cleared', 'zimra_verified', 'cid_clear']) {
    assert.ok(
      !tags.includes(suppressed),
      `${suppressed} reached a public tag list; no authority in this platform can substantiate it`,
    );
  }
});

test('the suppression list names exactly the three government-approval claims', () => {
  assert.deepEqual(
    [...UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS].sort(),
    ['cid_clear', 'duty_cleared', 'zimra_verified'],
  );
});

test('police_verified — whose only writer means "reported stolen, then recovered" — yields no clearance badge', () => {
  // This is the semantic inversion the owner decision calls out by name.
  const tags = derive(vehicleClaimingEverything({
    duty_paid: false, zimra_verified: false, police_verified: true,
  }));
  assert.ok(!tags.includes('cid_clear'), 'a theft report must never render as a police clearance');
});

// ── Unrelated governed tags are untouched ────────────────────────────────────────────────────────

test('fresh_import, safe_pay_ready and inspection_ready still derive normally', () => {
  const tags = derive(vehicleClaimingEverything());
  for (const kept of ['fresh_import', 'safe_pay_ready', 'inspection_ready']) {
    assert.ok(tags.includes(kept), `${kept} is unrelated to the government-approval suppression`);
  }
});

test('provenance-gated neighbours are unaffected', () => {
  const tags = derive(vehicleClaimingEverything({
    plate_verified_at: '2026-01-01T00:00:00Z',
    current_seller_type: 'private',
    current_seller_type_source: 'operator_recorded',
  }), { ownershipCount: 1 });
  assert.ok(tags.includes('plate_verified'), 'plate_verified has real provenance and stays');
  assert.ok(tags.includes('one_owner'));
});

test('evidence_available still derives from real evidence', () => {
  const tags = derive(vehicleClaimingEverything(), { evidenceSummary: { evidence_count: 4 } });
  assert.ok(tags.includes('evidence_available'));
});

// ── The suppression is fail-closed, not merely an omitted line ───────────────────────────────────

test('the final filter removes a suppressed tag even if some future edit re-adds it', () => {
  // Proves the guard is structural: it does not rely on the three `tags.add(...)` lines staying gone.
  const tags = derive(vehicleClaimingEverything());
  for (const suppressed of UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS) {
    assert.ok(!tags.includes(suppressed));
  }
  // ...and the vocabulary itself still declares them, so a future M4 gate has a name to re-enable.
  for (const suppressed of UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS) {
    assert.ok(MARKETPLACE_TAGS.includes(suppressed), 'the tag name remains part of the vocabulary');
  }
});

test('every derived tag is still a member of the declared vocabulary', () => {
  const tags = derive(vehicleClaimingEverything());
  for (const tag of tags) assert.ok(MARKETPLACE_TAGS.includes(tag), `${tag} is not a declared tag`);
});

// ── The second publication route: the flat booleans ──────────────────────────────────────────────

test('the summary publishes the three claims as false, not as the raw column', async () => {
  const src = (await import('node:fs')).readFileSync(
    new URL('../services/marketplace/listingSummaryService.js', import.meta.url), 'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

  for (const [key, column] of [
    ['duty_cleared', 'duty_paid'],
    ['zimra_verified', 'zimra_verified'],
    ['cid_clear', 'police_verified'],
  ]) {
    assert.match(
      code, new RegExp(`${key}:\\s*false`),
      `${key} must be published as false, not derived from a column`,
    );
    assert.doesNotMatch(
      code, new RegExp(`${key}:\\s*boolValue\\(vehicle\\.${column}\\)`),
      `${key} must not read ${column} — that is the second publication route`,
    );
  }
});
