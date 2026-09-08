/**
 * O2 — F-round independent re-audit closure (F1–F4).
 *
 * Every check here CALLS the owning canonical function. Nothing is reimplemented, because a
 * reimplementation is what drifts, and the drift is the defect: the workbook dry run was saying
 * "importable" for evidence rows the canonical route had always refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVehicleWorkbookPayload,
} from '../services/workbook/vehicleWorkbookImportService.js';
import { resolveWorkbookCatalogue } from '../services/workbook/workbookCatalogueService.js';
import {
  validateEvidenceUploadPayload,
  canUploadEvidenceRecord,
} from '../services/evidence/evidenceService.js';
import { CLASS_SUBTYPES } from '../services/evidence/evidenceTaxonomy.js';
import {
  buildVehicleListingCandidate,
  getListingEligibility,
} from '../services/marketplace/marketplaceListingEligibility.js';
import { VEHICLE_WORKBOOK_SHEETS } from '../constants/workbook/workbookFieldRegistry.js';

const VIN = 'JTMHY7AJ2K4012345';
const subtypeCode = (x) => (typeof x === 'string' ? x : x.code);
const REG_SUBTYPES = (CLASS_SUBTYPES.registration || []).map(subtypeCode);
const IMPORT_SUBTYPES = (CLASS_SUBTYPES.import || []).map(subtypeCode);
const FOREIGN_SUBTYPE = IMPORT_SUBTYPES.find((s) => !REG_SUBTYPES.includes(s));

/** Run the workbook dry-run validation for ONE evidence row, as a given server-derived role. */
async function dryRunEvidence(row, actorRole = null) {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles',
    sheetRows: {
      VEHICLES: [{ vin: VIN }],
      EVIDENCE_NOTES: [{ vin: VIN, file_url: 'https://files.example/a.pdf', file_mime_type: 'application/pdf', ...row }],
    },
  }, { actorRole });
  return validation.errors.filter((e) => e.sheetName === 'EVIDENCE_NOTES');
}
const canonical = (row) => {
  try {
    return { ok: true, normalized: validateEvidenceUploadPayload({ vehicle_id: VIN, file_url: 'https://files.example/a.pdf', mime_type: 'application/pdf', ...row }, { requireVehicleId: true }) };
  } catch (error) { return { ok: false, message: String(error.message || error) }; }
};

/* ── F1 ───────────────────────────────────────────────────────────────────────────────── */
test('F1 REPRODUCTION: the canonical validator refuses a blank subtype and a wrong-class subtype', () => {
  assert.equal(canonical({ evidence_class: 'registration' }).ok, false);
  assert.match(canonical({ evidence_class: 'registration' }).message, /evidence_type is required/);
  assert.equal(canonical({ evidence_class: 'registration', evidence_subtype: FOREIGN_SUBTYPE }).ok, false);
  assert.match(canonical({ evidence_class: 'registration', evidence_subtype: FOREIGN_SUBTYPE }).message, /not valid for class/);
  assert.equal(canonical({ evidence_class: 'registration', evidence_subtype: REG_SUBTYPES[0] }).ok, true);
});

test('F1: a valid class + valid subtype passes the dry run', async () => {
  assert.deepEqual(await dryRunEvidence({ evidence_class: 'registration', evidence_subtype: 'registration_book' }), []);
});

test('F1: a MISSING subtype now fails the dry run, with the canonical reason', async () => {
  const errors = await dryRunEvidence({ evidence_class: 'registration' });
  assert.ok(errors.length > 0, 'the dry run must refuse what the route will refuse');
  assert.ok(errors.some((e) => e.code === 'EVIDENCE_CLASSIFICATION_INVALID' || e.code === 'REQUIRED_MISSING'));
});

test('F1: a WRONG-CLASS subtype fails the dry run — the flat vocabulary is not the real check', async () => {
  const errors = await dryRunEvidence({ evidence_class: 'registration', evidence_subtype: FOREIGN_SUBTYPE });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'EVIDENCE_CLASSIFICATION_INVALID');
  assert.match(errors[0].message, /not valid for class 'registration'/);
});

test('F1: an UNKNOWN subtype fails', async () => {
  const errors = await dryRunEvidence({ evidence_class: 'registration', evidence_subtype: 'not_a_real_subtype' });
  assert.ok(errors.length > 0);
});

test('F1: the same subtype passes under its PROPER class', async () => {
  assert.deepEqual(await dryRunEvidence({ evidence_class: 'import', evidence_subtype: FOREIGN_SUBTYPE }), []);
});

test('F1: no legacy semantic field is fabricated — the workbook offers no evidence_type column', () => {
  const keys = VEHICLE_WORKBOOK_SHEETS.EVIDENCE_NOTES.fields.map((f) => f.key);
  assert.equal(keys.includes('evidence_type'), false,
    'adding a user-enterable legacy type would bypass the canonical-first requirement rather than meet it');
  assert.equal(VEHICLE_WORKBOOK_SHEETS.EVIDENCE_NOTES.fields.find((f) => f.key === 'evidence_subtype').required, true);
});

test('F1: what the dry run validated is what the canonical upload receives', async () => {
  const row = { evidence_class: 'registration', evidence_subtype: 'registration_book' };
  assert.deepEqual(await dryRunEvidence(row), []);
  const normalized = canonical(row).normalized;
  assert.equal(normalized.evidenceClass, row.evidence_class);
  assert.equal(normalized.evidenceSubtype, row.evidence_subtype);
  assert.equal(normalized.explicitCanonical, true);
});

/* ── F2 ───────────────────────────────────────────────────────────────────────────────── */
test('F2 REPRODUCTION: the owning role matrix really refuses some role/class/subtype pairs', () => {
  const auction = canonical({ evidence_class: 'auction', evidence_subtype: 'auction_sheet' }).normalized;
  assert.equal(canUploadEvidenceRecord(auction, 'owner'), false);
  assert.equal(canUploadEvidenceRecord(auction, 'dealer'), true);
  // subtype-level override, straight from subtypeUploadRoleOverrides
  const police = canonical({ evidence_class: 'registration', evidence_subtype: 'police_clearance_first_registration' }).normalized;
  assert.equal(canUploadEvidenceRecord(police, 'owner'), false);
  assert.equal(canUploadEvidenceRecord(police, 'dealer'), false);
  assert.equal(canUploadEvidenceRecord(police, 'government'), true);
});

test('F2.1: Owner + Owner-allowed evidence is allowed in the dry run', async () => {
  assert.deepEqual(await dryRunEvidence({ evidence_class: 'registration', evidence_subtype: 'registration_book' }, 'owner'), []);
});

test('F2.2: Owner + evidence forbidden to Owner is refused BEFORE confirmation', async () => {
  const errors = await dryRunEvidence({ evidence_class: 'auction', evidence_subtype: 'auction_sheet' }, 'owner');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'EVIDENCE_ROLE_FORBIDDEN');
  assert.match(errors[0].message, /permission rule, not a file problem/,
    'a deterministic 403 must not read as a retryable fault');
});

test('F2.3: Dealer + Dealer-allowed evidence is allowed', async () => {
  assert.deepEqual(await dryRunEvidence({ evidence_class: 'auction', evidence_subtype: 'auction_sheet' }, 'dealer'), []);
  assert.deepEqual(await dryRunEvidence({ evidence_class: 'dealer_listing', evidence_subtype: 'listing_photograph' }, 'dealer'), []);
});

test('F2.4: a subtype-level restriction admits ONLY the roles the override names', async () => {
  const row = { evidence_class: 'registration', evidence_subtype: 'police_clearance_first_registration' };
  assert.equal((await dryRunEvidence(row, 'owner'))[0].code, 'EVIDENCE_ROLE_FORBIDDEN');
  assert.equal((await dryRunEvidence(row, 'dealer'))[0].code, 'EVIDENCE_ROLE_FORBIDDEN');
  assert.deepEqual(await dryRunEvidence(row, 'government'), []);
  assert.deepEqual(await dryRunEvidence(row, 'admin'), []);
});

test('F2.5: Admin follows the canonical policy — not a workbook shortcut', async () => {
  // canUploadEvidenceRecord grants admin broadly; the workbook neither widens nor narrows it.
  for (const [cls, sub] of [['auction', 'auction_sheet'], ['registration', 'registration_book']]) {
    const normalized = canonical({ evidence_class: cls, evidence_subtype: sub }).normalized;
    const canonicalSays = canUploadEvidenceRecord(normalized, 'admin');
    const workbookSays = (await dryRunEvidence({ evidence_class: cls, evidence_subtype: sub }, 'admin')).length === 0;
    assert.equal(workbookSays, canonicalSays, `${cls}/${sub}: the workbook must agree with the owning policy, not decide for itself`);
  }
});

test('F2.6: the refusal is by role, not by tenant — no cross-tenant relaxation exists here', async () => {
  const row = { evidence_class: 'auction', evidence_subtype: 'auction_sheet' };
  assert.equal((await dryRunEvidence(row, 'owner'))[0].code, 'EVIDENCE_ROLE_FORBIDDEN');
});

test('F2.7: a healthy dry run can no longer call a role-forbidden row importable', async () => {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles',
    sheetRows: {
      VEHICLES: [{ vin: VIN }],
      EVIDENCE_NOTES: [{ vin: VIN, evidence_class: 'auction', evidence_subtype: 'auction_sheet', file_url: 'https://f/a.pdf', file_mime_type: 'application/pdf' }],
    },
  }, { actorRole: 'owner' });
  // The VIN carrying the bad evidence row is blocked, exactly as the existing model blocks a VIN.
  assert.equal(validation.acceptedGroups.length, 0);
  assert.equal(validation.canImport, false);
});

/* ── F3 ───────────────────────────────────────────────────────────────────────────────── */
// J-3 — `d1` is the GOVERNED dealer for DEALER_TENANT and nobody else is a dealer anywhere. Both
// helpers below resolve the dealership the same way the deployed paths do, so the F-round's
// assertions keep testing WHO MAY SELL rather than what a role string says.
const DEALER_TENANT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
// The governed dealership register for this suite: these users ARE the dealer for that tenant.
const GOVERNED_DEALERS = new Map([
  ['d1', DEALER_TENANT],
  ['9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', DEALER_TENANT],
]);
const isGovernedDealer = (userId, tenantId) => Boolean(tenantId) && GOVERNED_DEALERS.get(userId) === tenantId;
const dealershipDb = {
  from: (table) => ({
    select: () => {
      const f = {};
      const chain = {
        eq(k, v) { f[k] = v; return chain; },
        async maybeSingle() {
          if (table !== 'dealer_profiles') return { data: null, error: null };
          return {
            data: isGovernedDealer(f.user_id, f.tenant_id)
              ? { id: 'dp-1', tenant_id: DEALER_TENANT, suspension_state: 'none' } : null,
            error: null,
          };
        },
      };
      return chain;
    },
  }),
};
const listingFor = (userContext) => {
  const candidate = buildVehicleListingCandidate({
    body: { vin: VIN, make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.' },
    userContext,
    dealerListingSubject: isGovernedDealer(userContext.id, userContext.tenantId)
      ? { granted: true, tenantId: userContext.tenantId, dealerProfileId: 'dp-1', reason: null }
      : null,
  });
  return { candidate, eligibility: getListingEligibility(candidate) };
};
const catalogueFor = (actor) => resolveWorkbookCatalogue(actor, { supabaseClient: dealershipDb });

test('F3 REPRODUCTION: an ordinary Admin has no listing subject, so no valid draft is possible', () => {
  const { candidate, eligibility } = listingFor({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', role: 'admin', tenantId: null });
  assert.equal(candidate.owner_id, null);
  assert.equal(candidate.tenant_id, null);
  assert.equal(candidate.current_seller_type, null);
  assert.equal(eligibility.eligible, false);
  assert.deepEqual(eligibility.reasons.sort(), ['missing_owner_for_private_listing', 'unknown_seller_type']);
});

test('F3: the catalogue no longer offers that Admin an impossible action, and says why', async () => {
  const catalogue = await catalogueFor({ id: 'a1', role: 'admin', tenantId: null });
  const available = catalogue.available.map((t) => t.template_key);
  assert.equal(available.includes('seller_vehicles'), false, 'advertising it would promise an authority that does not exist');
  const entry = catalogue.unavailable.find((t) => t.template_key === 'seller_vehicles');
  assert.equal(entry.reason, 'no_listing_subject');
  assert.match(entry.note, /owner account or a dealer organisation/i);
});

test('F3: the Owner catalogue path remains valid', async () => {
  const catalogue = await catalogueFor({ id: 'o1', role: 'owner', tenantId: null });
  const entry = catalogue.available.find((t) => t.template_key === 'seller_vehicles');
  assert.ok(entry, 'an owner IS the listing subject');
  assert.equal(listingFor({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', role: 'owner', tenantId: null }).eligibility.eligible, true);
});

test('F3: the active Dealer catalogue path remains valid', async () => {
  const catalogue = await catalogueFor({ id: 'd1', role: 'dealer', tenantId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' });
  assert.ok(catalogue.available.find((t) => t.template_key === 'seller_vehicles'));
  assert.equal(listingFor({ id: 'd1', role: 'dealer', tenantId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }).eligibility.eligible, true);
});

// SUPERSEDED BY I-2. The F-round wrote this as "an Admin who genuinely holds a governed tenant
// behaves exactly as the canonical contract says" — and it did, but the canonical contract was
// itself wrong: `authorizeRole` sets `tenantId` from any `tenant_users` row, and that membership
// is not a governed selling capability. The assertion is inverted rather than deleted, so the
// history of the mistake stays legible.
test('F3/I-2: an Admin holding a tenant context is NOT a Dealer seller, and is not offered the template', async () => {
  const tenant = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const { candidate, eligibility } = listingFor({ id: 'a1', role: 'admin', tenantId: tenant });
  assert.equal(candidate.tenant_id, null, 'membership is not commerce authority');
  assert.equal(candidate.current_seller_type, null);
  assert.equal(eligibility.eligible, false);
  const catalogue = await catalogueFor({ id: 'a1', role: 'admin', tenantId: tenant });
  assert.equal(catalogue.available.find((t) => t.template_key === 'seller_vehicles'), undefined,
    'the catalogue must mirror the canonical subject, not a role');
  assert.equal(catalogue.unavailable.find((t) => t.template_key === 'seller_vehicles').reason, 'no_listing_subject');
});

test('F3: no user-supplied ownership or tenant field exists on any workbook sheet', () => {
  const forbidden = ['owner_id', 'tenant_id', 'current_seller_id', 'seller_user_id', 'owner_user_id'];
  for (const [sheetName, sheet] of Object.entries(VEHICLE_WORKBOOK_SHEETS)) {
    for (const field of sheet.fields) {
      assert.equal(forbidden.includes(field.key), false,
        `${sheetName}.${field.key} would let a spreadsheet assert ownership or organisational scope`);
    }
  }
});

/* ── the interaction journey: catalogue → dry run → create → evidence → receipt ────────── */

/**
 * One journey, end to end, for each actor disposition — every stage decided by the CANONICAL
 * function that owns it, never by a stub that returns success.
 */
async function journey({ actor, evidenceRow }) {
  const catalogue = await catalogueFor(actor);
  const offered = Boolean(catalogue.available.find((t) => t.template_key === 'seller_vehicles'));
  if (!offered) {
    return { offered, reason: catalogue.unavailable.find((t) => t.template_key === 'seller_vehicles')?.reason ?? null };
  }
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles',
    sheetRows: {
      // A complete VEHICLES/LISTINGS row, because the point of a journey test is to reach the
      // stage under test rather than to stop at an unrelated required field.
      VEHICLES: [{
        vin: VIN, make: 'Toyota', model: 'Hilux', year: '2019', mileage: '90000',
        color: 'White', body_style: 'Pickup', fuel_type: 'Diesel', transmission: 'Manual',
        seller_stated_condition: 'Used',
      }],
      LISTINGS: [{
        vin: VIN, price: '15000', currency: 'USD',
        listing_city: 'Harare', seller_description: 'A well maintained Toyota Hilux with full service history, offered for sale by its owner in Harare.',
      }],
      EVIDENCE_NOTES: [{ vin: VIN, file_url: 'https://files.example/a.pdf', file_mime_type: 'application/pdf', ...evidenceRow }],
    },
  }, { actorRole: actor.role });
  if (!validation.canImport) {
    return { offered, canImport: false, errors: validation.errors.map((e) => e.code) };
  }
  const { candidate, eligibility } = listingFor({ id: actor.id, role: actor.role, tenantId: actor.tenantId ?? null });
  const normalized = canonical(evidenceRow);
  return {
    offered,
    canImport: true,
    listing: { tenant_id: candidate.tenant_id, seller_type: candidate.current_seller_type, eligible: eligibility.eligible },
    evidenceAccepted: normalized.ok && canUploadEvidenceRecord(normalized.normalized, actor.role),
  };
}

test('JOURNEY · Owner: offered → validates → owner-scoped eligible draft → evidence accepted', async () => {
  const result = await journey({
    actor: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', role: 'owner', tenantId: null },
    evidenceRow: { evidence_class: 'registration', evidence_subtype: 'registration_book' },
  });
  assert.equal(result.offered, true);
  assert.equal(result.canImport, true);
  assert.equal(result.listing.tenant_id, null);
  assert.equal(result.listing.seller_type, 'Private Owner');
  assert.equal(result.listing.eligible, true);
  assert.equal(result.evidenceAccepted, true);
});

test('JOURNEY · Owner is stopped at the DRY RUN for evidence its role may not file', async () => {
  const result = await journey({
    actor: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', role: 'owner', tenantId: null },
    evidenceRow: { evidence_class: 'auction', evidence_subtype: 'auction_sheet' },
  });
  assert.equal(result.canImport, false, 'the refusal must arrive before confirmation, not after a created vehicle');
  assert.ok(result.errors.includes('EVIDENCE_ROLE_FORBIDDEN'));
});

test('JOURNEY · active Dealer: offered → validates → tenant-scoped eligible draft → evidence accepted', async () => {
  const tenant = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const result = await journey({
    actor: { id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', role: 'dealer', tenantId: tenant },
    evidenceRow: { evidence_class: 'dealer_listing', evidence_subtype: 'listing_photograph' },
  });
  assert.equal(result.offered, true);
  assert.equal(result.canImport, true);
  assert.equal(result.listing.tenant_id, tenant);
  assert.equal(result.listing.seller_type, 'Dealer');
  assert.equal(result.listing.eligible, true);
  assert.equal(result.evidenceAccepted, true);
});

test('JOURNEY · ordinary Admin: the journey ends honestly at the catalogue, before any work', async () => {
  const result = await journey({
    actor: { id: 'a1', role: 'admin', tenantId: null },
    evidenceRow: { evidence_class: 'registration', evidence_subtype: 'registration_book' },
  });
  assert.equal(result.offered, false);
  assert.equal(result.reason, 'no_listing_subject');
});
