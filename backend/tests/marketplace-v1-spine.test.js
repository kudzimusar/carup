/**
 * Marketplace v1 backend spine — hermetic tests (no live DB; buildMockSupabase + injected mocks).
 * Covers: PartSentry suppression, trust/verification summaries, pricing, listing detail privacy,
 * inquiry creation + referral emission, referral bridge boundaries, saved, compare, moderation,
 * analytics, and AI advisory fallback.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMockSupabase } from './fixtures/marketplaceListings.js';
import {
  summarizePartSentry,
  buildMarketplaceListingSummary,
} from '../services/marketplace/listingSummaryService.js';
import {
  buildTrustSummary,
  buildVerificationSummary,
  deriveEvidenceStatus,
  deriveSuspicionLevel,
} from '../services/marketplace/marketplaceTrustSummaryService.js';
import { buildPricingSummary } from '../services/marketplace/marketplacePricingService.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import { createInquiry, assessInquiryRisk, listInquiriesForAdmin, updateInquiryStatus } from '../services/marketplace/marketplaceInquiryService.js';
import { MarketplaceReferralBridgeService } from '../services/marketplace/marketplaceReferralBridgeService.js';
import { saveListing, unsaveListing, listSavedListings } from '../services/marketplace/marketplaceSavedService.js';
import { compareListings } from '../services/marketplace/marketplaceDiscoveryService.js';
import { moderateListing, deriveListingPublicStatus } from '../services/marketplace/marketplaceModerationService.js';
import { getMarketplaceAnalytics } from '../services/marketplace/marketplaceAnalyticsService.js';
import { listingDraft, deterministicShareCopy } from '../services/marketplace/marketplaceAiAssistantService.js';

const NOW = new Date().toISOString();
const REAL_VIN = '1HGBH41JXMN109186';
const DEALER_VIN = '1FMCU0GD9JUA12345';

function publicVehicle(overrides = {}) {
  return {
    vin: REAL_VIN, make: 'Toyota', model: 'Corolla', year: 2018, mileage: 42000,
    price: 9500, currency: 'USD', status: 'Available', trust_score: 78,
    owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: null,
    registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner',
    duty_paid: true, police_verified: true, passport_verified: false, created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PartSentry suppression (ports PR #11 read-side governance)
// ---------------------------------------------------------------------------

test('PartSentry: a verified public-card-eligible log surfaces signals', () => {
  const s = summarizePartSentry([
    { action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'none' },
  ]);
  assert.equal(s.partsentry_checked, true);
  assert.equal(s.verified_parts_count, 1);
  assert.equal(s.public_status, 'eligible');
  assert.equal(s.suppressed, false);
});

test('PartSentry: a single watch/flagged log suppresses ALL signals even when another is eligible', () => {
  const s = summarizePartSentry([
    { action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'none' },
    { action_type: 'Inspected', timestamp: NOW, verification_status: 'verified', public_card_eligible: true, suspicion_status: 'flagged' },
  ]);
  assert.equal(s.suppressed, true);
  assert.equal(s.partsentry_checked, false);
  assert.equal(s.verified_parts_count, 0);
  assert.equal(s.repair_history_count, 0);
  assert.equal(s.public_status, 'suppressed');
});

test('PartSentry: self-approved log (approver == mechanic) is never publicly checked', () => {
  const s = summarizePartSentry([
    { action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'none', approved_by: 'mech-1', mechanic_id: 'mech-1' },
  ]);
  assert.equal(s.partsentry_checked, false);
  assert.equal(s.verified_parts_count, 0);
});

test('PartSentry: pending verification reports review_required, not eligible', () => {
  const s = summarizePartSentry([
    { action_type: 'Inspected', timestamp: NOW, verification_status: 'pending', public_card_eligible: false },
  ]);
  assert.equal(s.public_status, 'review_required');
  assert.equal(s.partsentry_checked, false);
});

// ---------------------------------------------------------------------------
// Trust + verification summaries
// ---------------------------------------------------------------------------

test('trust summary emits only backend-backed badges and public-safe copy', () => {
  const vehicle = publicVehicle({ passport_verified: true, zimra_verified: true });
  const listingSummary = buildMarketplaceListingSummary({ vehicle, evidenceRows: [{ verification_status: 'verified', visibility_level: 'public_safe' }] });
  const trust = buildTrustSummary({ vehicle, listingSummary, evidenceRows: [{ verification_status: 'verified', visibility_level: 'public_safe' }], partSentryRows: [] });

  assert.ok(trust.trust_badges.includes('passport_verified'));
  assert.ok(trust.trust_badges.includes('zimra_verified'));
  assert.ok(trust.public_badge_copy.length === trust.trust_badges.length);
  assert.equal(trust.risk_status, 'clear');
  assert.equal(trust.evidence_status, 'verified');
  assert.equal(trust.partsentry_public_status, 'not_applicable');
  assert.equal('admin_explanation' in trust, false); // public audience hides admin narrative
  assert.ok(typeof trust.safe_public_copy === 'string' && trust.safe_public_copy.length > 0);
});

test('trust summary includes admin_explanation only for admin audience', () => {
  const vehicle = publicVehicle();
  const listingSummary = buildMarketplaceListingSummary({ vehicle });
  const admin = buildTrustSummary({ vehicle, listingSummary, audience: 'admin' });
  assert.ok('admin_explanation' in admin);
  assert.ok(admin.admin_explanation.includes('Governed trust state'));
});

test('trust summary maps suspicion to risk and suppresses partsentry badges', () => {
  const vehicle = publicVehicle();
  const partSentryRows = [{ action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'flagged' }];
  const listingSummary = buildMarketplaceListingSummary({ vehicle, partSentryRows });
  const trust = buildTrustSummary({ vehicle, listingSummary, partSentryRows });
  assert.equal(trust.suspicion_status, 'flagged');
  assert.equal(trust.risk_status, 'flagged');
  assert.equal(trust.partsentry_public_status, 'suppressed');
  assert.equal(trust.trust_badges.includes('partsentry_checked'), false);
  assert.ok(trust.risk_reasons.includes('parts_provenance_under_review'));
});

test('quarantined vehicle yields blocked risk status', () => {
  const vehicle = publicVehicle({ status: 'Suspended' });
  const listingSummary = buildMarketplaceListingSummary({ vehicle });
  const trust = buildTrustSummary({ vehicle, listingSummary });
  assert.equal(trust.risk_status, 'blocked');
});

test('verification summary is conservative (identity unverified by default)', () => {
  const vehicle = publicVehicle({ current_seller_type: 'Dealership', tenant: { name: 'Harare Motors', status: 'active' } });
  const listingSummary = buildMarketplaceListingSummary({ vehicle });
  const v = buildVerificationSummary({ vehicle, listingSummary });
  assert.equal(v.identity_status, 'unverified');
  assert.equal(typeof v.seller_verified, 'boolean');
  assert.equal(v.inspection_verified, false);
  assert.ok(Array.isArray(v.verification_notes_public));
});

test('deriveEvidenceStatus and deriveSuspicionLevel', () => {
  assert.equal(deriveEvidenceStatus([{ verification_status: 'verified', visibility_level: 'public_safe' }, { verification_status: 'pending', visibility_level: 'public_safe' }]), 'partial');
  assert.equal(deriveEvidenceStatus([{ verification_status: 'pending', visibility_level: 'public_safe' }]), 'review_required');
  assert.equal(deriveEvidenceStatus([]), 'none');
  assert.equal(deriveSuspicionLevel([{ suspicion_status: 'watch' }]), 'watch');
  assert.equal(deriveSuspicionLevel([{ suspicion_status: 'none' }]), 'clear');
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

test('pricing summary produces a deterministic fair band and all-in total', () => {
  const p = buildPricingSummary({ listingSummary: { price: 10000, currency: 'USD', condition_category: 'locally_used' }, listingType: 'vehicle' });
  assert.equal(p.estimate_basis, 'deterministic');
  assert.equal(p.price_confidence, 'low');
  assert.equal(p.estimated_fair_min, 8800);
  assert.equal(p.estimated_fair_max, 11200);
  assert.ok(p.estimated_total > 10000);
  assert.equal(p.export_import_estimate, undefined); // local listing -> no import components
});

test('pricing summary adds import components for import listings', () => {
  const p = buildPricingSummary({ listingSummary: { price: 10000 }, listingType: 'import_request' });
  assert.ok(p.export_import_estimate > 0);
  assert.ok(p.container_shipping_estimate > 0);
  assert.ok(p.price_warnings.some((w) => w.toLowerCase().includes('provisional')));
});

// ---------------------------------------------------------------------------
// Listing detail privacy + 404
// ---------------------------------------------------------------------------

test('listing detail returns sanitized payload (no owner_id/tenant_id) with trust summary', async () => {
  const store = {
    vehicles: [publicVehicle()],
    listing_images: [{ vin: REAL_VIN, image_url: 'https://img/1.jpg', is_primary: true, display_order: 0 }],
    vehicle_evidence: [{ vin: REAL_VIN, verification_status: 'verified', visibility_level: 'public_safe' }],
  };
  const detail = await getMarketplaceListingDetail(buildMockSupabase(store), REAL_VIN);
  assert.equal(detail.vin, REAL_VIN);
  assert.equal('owner_id' in detail, false);
  assert.equal('tenant_id' in detail, false);
  assert.equal(detail.public_status, 'public');
  assert.ok(detail.trust_summary && Array.isArray(detail.trust_summary.trust_badges));
  assert.ok(detail.verification_summary && detail.pricing_summary);
  assert.ok(detail.media.length === 1 && detail.media[0].url === 'https://img/1.jpg');
  assert.ok(detail.safety_warnings.some((w) => /Do not pay outside CarUp/.test(w)));
  assert.equal(detail.trust_summary.admin_explanation, undefined);
});

test('listing detail 404s a non-public (Sold) listing and an unknown vin', async () => {
  const store = { vehicles: [publicVehicle({ status: 'Sold' })] };
  await assert.rejects(() => getMarketplaceListingDetail(buildMockSupabase(store), REAL_VIN), /not found/i);
  await assert.rejects(() => getMarketplaceListingDetail(buildMockSupabase({ vehicles: [] }), 'NOPE'), /not found/i);
});

// ---------------------------------------------------------------------------
// Inquiries + referral emission
// ---------------------------------------------------------------------------

function spyBridge() {
  const calls = [];
  return {
    calls,
    emitMarketplaceReferralEvent: async (args) => { calls.push(args); return { recorded: true, referral_attributed: Boolean(args.referralCode) }; },
  };
}

test('inquiry: guest must supply a contact', async () => {
  const store = { vehicles: [publicVehicle()] };
  await assert.rejects(
    () => createInquiry(buildMockSupabase(store), { inquiry_type: 'vehicle_purchase_interest', listing_id: REAL_VIN }, null, { referralBridge: spyBridge() }),
    /email or phone/i
  );
});

test('inquiry: public response hides contact + emits referral event; row persists with contact', async () => {
  const store = { vehicles: [publicVehicle()], marketplace_inquiries: [] };
  const bridge = spyBridge();
  const out = await createInquiry(
    buildMockSupabase(store),
    { inquiry_type: 'vehicle_purchase_interest', listing_id: REAL_VIN, guest_email: 'b@example.com', message: 'Is it available?', referral_code: 'CARUP-X' },
    null,
    { referralBridge: bridge }
  );
  assert.equal(out.status, 'new');
  assert.equal('guest_email' in out, false);
  assert.equal('seller_id' in out, false);
  assert.equal(out.referral_attributed, true);
  assert.equal(store.marketplace_inquiries.length, 1);
  assert.equal(store.marketplace_inquiries[0].guest_email, 'b@example.com');
  assert.equal(bridge.calls.length, 1);
  assert.equal(bridge.calls[0].eventType, 'marketplace_inquiry_created');
});

test('inquiry: diaspora import request maps to import-interest event and stores NO shipment data', async () => {
  const store = { marketplace_inquiries: [] };
  const bridge = spyBridge();
  const out = await createInquiry(
    buildMockSupabase(store),
    { inquiry_type: 'import_quote_request', guest_phone: '+263772000000', message: 'Want to import a Hilux' },
    null,
    { referralBridge: bridge }
  );
  assert.equal(out.inquiry_type, 'import_quote_request');
  assert.equal(bridge.calls[0].eventType, 'marketplace_import_interest_created');
  const row = store.marketplace_inquiries[0];
  for (const forbidden of ['tracking_number', 'carrier_name', 'container_id', 'origin_port', 'destination_port']) {
    assert.equal(forbidden in row, false);
  }
});

test('inquiry: invalid inquiry_type is rejected', async () => {
  await assert.rejects(
    () => createInquiry(buildMockSupabase({}), { inquiry_type: 'hack', guest_email: 'a@b.com' }, null, { referralBridge: spyBridge() }),
    /Unsupported inquiry_type/
  );
});

test('assessInquiryRisk flags off-platform payment language', () => {
  assert.equal(assessInquiryRisk('please pay via western union'), 'watch');
  assert.equal(assessInquiryRisk('Hi, is this still available?'), 'clear');
});

// ---------------------------------------------------------------------------
// Referral bridge boundaries
// ---------------------------------------------------------------------------

test('referral bridge records an event and attributes a valid code, never minting rewards', async () => {
  const recorded = [];
  const fakeReferral = {
    validateReferralCode: async () => ({ valid: true, code_id: 'c1', campaign_id: 'k1' }),
    recordReferralEvent: async (input) => { recorded.push(input); return { id: 'evt1' }; },
  };
  const bridge = new MarketplaceReferralBridgeService({ referralService: fakeReferral });
  const res = await bridge.emitMarketplaceReferralEvent({ eventType: 'marketplace_inquiry_created', inquiryId: 'i1', listingId: REAL_VIN, referralCode: 'CARUP-X' });
  assert.equal(res.recorded, true);
  assert.equal(res.referral_attributed, true);
  assert.equal(recorded[0].subject_type, 'marketplace_inquiry');
  assert.equal(recorded[0].code_id, 'c1');
  assert.equal(recorded[0].source, 'marketplace');
});

test('referral bridge rejects unsupported event types', async () => {
  const bridge = new MarketplaceReferralBridgeService({ referralService: { recordReferralEvent: async () => ({}) } });
  const res = await bridge.emitMarketplaceReferralEvent({ eventType: 'not_a_real_event' });
  assert.equal(res.recorded, false);
  assert.equal(res.reason, 'unsupported_event_type');
});

test('referral bridge is best-effort: a failing engine never throws', async () => {
  const bridge = new MarketplaceReferralBridgeService({ referralService: { validateReferralCode: async () => { throw new Error('down'); }, recordReferralEvent: async () => { throw new Error('down'); } } });
  const res = await bridge.emitMarketplaceReferralEvent({ eventType: 'marketplace_listing_viewed', listingId: REAL_VIN, referralCode: 'X' });
  assert.equal(res.recorded, false);
  assert.equal(res.reason, 'emit_failed');
});

// ---------------------------------------------------------------------------
// Saved listings
// ---------------------------------------------------------------------------

test('save -> list -> unsave round-trips and returns sanitized summaries', async () => {
  const store = { saved_vehicles: [], vehicles: [publicVehicle()] };
  const client = buildMockSupabase(store);
  const actor = { id: 'user-1' };
  await saveListing(client, REAL_VIN, actor);
  assert.equal(store.saved_vehicles.length, 1);
  const list = await listSavedListings(client, actor);
  assert.equal(list.total, 1);
  assert.equal(list.listings[0].vin, REAL_VIN);
  assert.equal('owner_id' in list.listings[0], false);
  await unsaveListing(client, REAL_VIN, actor);
  assert.equal(store.saved_vehicles.length, 0);
});

test('saving requires authentication', async () => {
  await assert.rejects(() => saveListing(buildMockSupabase({}), REAL_VIN, null), /Authentication required/);
});

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

test('compare returns sanitized entries and drops missing vins', async () => {
  const store = { vehicles: [publicVehicle(), publicVehicle({ vin: DEALER_VIN, make: 'Ford', model: 'Ranger', price: 28000 })] };
  const res = await compareListings(buildMockSupabase(store), [REAL_VIN, DEALER_VIN, 'MISSINGVIN0000000']);
  assert.equal(res.total, 2);
  assert.ok(res.listings.every((l) => l.trust_summary && l.pricing_summary));
});

test('compare rejects more than 4 listings', async () => {
  await assert.rejects(() => compareListings(buildMockSupabase({}), ['a', 'b', 'c', 'd', 'e']), /limited to 4/);
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

const adminActor = { id: 'admin-1', role: 'admin', platformRole: 'admin' };

test('moderation: approve sets Available + writes audit; suppress requires reason', async () => {
  const store = { vehicles: [publicVehicle({ status: 'Suspended' })], trust_audit_events: [] };
  const client = buildMockSupabase(store);
  const res = await moderateListing(client, REAL_VIN, 'approve', {}, adminActor);
  assert.equal(res.status, 'Available');
  assert.equal(res.public_status, 'public');
  assert.equal(store.vehicles[0].status, 'Available');
  assert.equal(store.trust_audit_events.length, 1);
  assert.equal(store.trust_audit_events[0].event_type, 'MARKETPLACE_LISTING_APPROVED');

  await assert.rejects(() => moderateListing(client, REAL_VIN, 'suppress', {}, adminActor), /reason is required/i);
});

test('moderation requires a platform reviewer role', async () => {
  await assert.rejects(
    () => moderateListing(buildMockSupabase({ vehicles: [publicVehicle()] }), REAL_VIN, 'approve', {}, { id: 'u', role: 'owner', platformRole: 'owner' }),
    /role required/i
  );
});

test('moderation blocks a tenant-elevated effective role (no platform authority)', async () => {
  // Header-derived effectiveRole 'operator' but platform role is only 'member' -> must be rejected.
  const escalated = { id: 'u', role: 'operator', platformRole: 'member', tenantRole: 'operator', tenantId: 't1' };
  await assert.rejects(
    () => moderateListing(buildMockSupabase({ vehicles: [publicVehicle()] }), REAL_VIN, 'approve', {}, escalated),
    /role required/i
  );
});

test('deriveListingPublicStatus maps statuses', () => {
  assert.equal(deriveListingPublicStatus('Available'), 'public');
  assert.equal(deriveListingPublicStatus('Suspended'), 'suppressed');
  assert.equal(deriveListingPublicStatus('Banned'), 'rejected');
  assert.equal(deriveListingPublicStatus('Archived'), 'archived');
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

test('analytics aggregates listing statuses and is resilient to a missing inquiries table', async () => {
  const store = { vehicles: [publicVehicle(), publicVehicle({ vin: DEALER_VIN, status: 'Suspended' })] };
  const out = await getMarketplaceAnalytics(buildMockSupabase(store), adminActor);
  assert.equal(out.listings.total, 2);
  assert.equal(out.listings.public, 1);
  assert.equal(out.listings.suppressed, 1);
  assert.equal(out.inquiries.total, 0);
});

test('analytics requires a reviewer role', async () => {
  await assert.rejects(() => getMarketplaceAnalytics(buildMockSupabase({ vehicles: [] }), { role: 'owner', platformRole: 'owner' }), /role required/i);
});

// ---------------------------------------------------------------------------
// AI advisory fallback
// ---------------------------------------------------------------------------

test('AI listing draft degrades to deterministic when provider is unavailable', async () => {
  const out = await listingDraft({ make: 'Toyota', model: 'Hilux', year: 2020, price: 25000 }, { aiCall: async () => null });
  assert.equal(out.ai_status, 'ai_unavailable');
  assert.equal(out.ai_available, false);
  assert.ok(out.title.includes('Hilux'));
  assert.ok(Array.isArray(out.seller_checklist) && out.seller_checklist.length > 0);
});

test('AI listing draft uses provider output when available but keeps governed tags deterministic', async () => {
  const out = await listingDraft({ make: 'Toyota', model: 'Hilux' }, { aiCall: async () => ({ title: 'AI Title', recommended_tags: ['partsentry_checked'] }) });
  assert.equal(out.ai_status, 'ai_assisted');
  assert.equal(out.title, 'AI Title');
  assert.equal(out.recommended_tags.includes('partsentry_checked'), false); // governed tags never come from AI
});

test('deterministic share copy is always available', () => {
  const copy = deterministicShareCopy({ make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, url: 'https://carup/x' });
  assert.ok(copy.whatsapp.includes('Toyota'));
  assert.ok(copy.telegram && copy.facebook && copy.short);
});

// ---------------------------------------------------------------------------
// Review hardening regressions
// ---------------------------------------------------------------------------

test('PartSentry fail-closed: an unknown/future suspicion value suppresses all signals', () => {
  const s = summarizePartSentry([
    { action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'under_review' },
  ]);
  assert.equal(s.suppressed, true);
  assert.equal(s.partsentry_checked, false);
  assert.equal(s.public_status, 'suppressed');
});

test('PartSentry: legacy rows with absent suspicion_status are treated as non-suspicious', () => {
  const s = summarizePartSentry([
    { action_type: 'Replaced', timestamp: NOW, verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true },
  ]);
  assert.equal(s.suppressed, false);
  assert.equal(s.partsentry_checked, true);
});

test('inquiry metadata is allow-list sanitized (off-contract keys + shipment data dropped)', async () => {
  const store = { marketplace_inquiries: [] };
  await createInquiry(
    buildMockSupabase(store),
    {
      inquiry_type: 'import_quote_request',
      guest_email: 'b@example.com',
      metadata: { utm_source: 'fb', tracking_number: 'SECRET123', container_id: 'C1', guest_email: 'leak@x.com' },
    },
    null,
    { referralBridge: spyBridge() }
  );
  const meta = store.marketplace_inquiries[0].metadata;
  assert.equal(meta.utm_source, 'fb');
  assert.equal('tracking_number' in meta, false);
  assert.equal('container_id' in meta, false);
  assert.equal('guest_email' in meta, false);
});

test('listInquiriesForAdmin re-checks reviewer authority server-side', async () => {
  await assert.rejects(
    () => listInquiriesForAdmin(buildMockSupabase({ marketplace_inquiries: [] }), {}, { role: 'owner', platformRole: 'owner' }),
    /role required/i
  );
  const ok = await listInquiriesForAdmin(buildMockSupabase({ marketplace_inquiries: [] }), {}, adminActor);
  assert.ok(Array.isArray(ok));
});

test('updateInquiryStatus 404s a missing inquiry (maybeSingle, not a 500)', async () => {
  await assert.rejects(
    () => updateInquiryStatus(buildMockSupabase({ marketplace_inquiries: [] }), 'nope', 'contacted', adminActor),
    /not found/i
  );
});

test('saveListing treats a unique-violation (23505) as idempotent success', async () => {
  // Custom client whose insert resolves with a 23505 unique_violation.
  const client = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        insert() { return builder; },
        then(res) { return Promise.resolve({ data: [], error: { code: '23505', message: 'duplicate key' } }).then(res); },
      };
      return builder;
    },
  };
  const out = await saveListing(client, REAL_VIN, { id: 'user-1' });
  assert.equal(out.saved, true);
  assert.equal(out.vin, REAL_VIN);
});
