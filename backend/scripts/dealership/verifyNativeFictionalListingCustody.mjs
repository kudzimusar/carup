/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2 / R5 — SQL custody for physical phase SIX (dealer VIN listing +
 * T22 media gallery) and, with --after-suspension, phase SEVEN (suspension/revocation + S08 + T42 + S09).
 * Read-only; disposable loopback database only. Proves what the real browser wrote, not what a test
 * asserted about itself.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { assertLocalDatabase } from './importResearchSeed.mjs';

const url = assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const purl = new URL(url);
assert.equal(purl.pathname, '/carup_dealer_isolated_ci');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(purl.hostname));
for (const k of ['CARUP_DEALER_RESEARCH_XLSX', 'DEALER_SEED_DATABASE_URL', 'SUPABASE_URL']) {
  assert.equal(process.env[k], undefined, 'unsafe environment ' + k);
}
const f = JSON.parse(readFileSync(process.env.DEALER_BROWSER_FIXTURE_JSON, 'utf8'));
assert.equal(f.listing_phase_provenance, 'CI_ONLY_FICTIONAL_DEALER_STOCK_NOT_A_REAL_VEHICLE');
const afterSuspension = process.argv.includes('--after-suspension');
const VIN = f.listing_vin;
const owner = f.actors.claimant.id;
const db = new pg.Client({ connectionString: url, ssl: false, application_name: 'carup-dealer-r4-listing-custody' });
await db.connect();
try {
  const link = (await db.query(`SELECT tenant_id, claimant_user_id, operating_status, dealer_profile_id
      FROM dealer_approved_seed_links WHERE seed_dealer_id = $1`, [f.seed])).rows[0];
  assert.equal(link.claimant_user_id, owner);
  const v = (await db.query(`SELECT vin, tenant_id::text AS tenant_id, owner_id, current_seller_id,
      current_seller_type, current_seller_type_source, status, publication_status, price::int AS price, currency,
      currency_source, registration_status, registration_status_source, listing_location_source,
      listing_country, chassis_number, engine_number FROM vehicles WHERE vin = $1`, [VIN])).rows[0];
  assert.ok(v, 'browser-created VIN exists');
  assert.equal(v.tenant_id, String(link.tenant_id));
  assert.equal(v.owner_id, null, 'dealer stock never acquires a private owner');
  assert.equal(v.current_seller_id, owner, 'approved owner is the governed seller');
  assert.equal(v.current_seller_type, 'Dealer');
  for (const k of ['current_seller_type_source', 'currency_source', 'registration_status_source', 'listing_location_source']) {
    assert.equal(v[k], 'dealer_declared', k);
  }
  assert.deepEqual([v.price, v.currency, v.status, v.registration_status, v.listing_country],
    [18500, 'USD', 'Available', 'customs_cleared_cvr_pending', 'ZW']);
  assert.equal(v.publication_status, afterSuspension ? 'publishable' : 'published');
  const branch = (await db.query(`SELECT b.dealer_id FROM dealer_vehicle_branch_assignments a
      JOIN dealer_branches b ON b.id = a.branch_id WHERE a.vin = $1`, [VIN])).rows;
  assert.equal(branch.length, 1);
  assert.equal(branch[0].dealer_id, link.dealer_profile_id, 'branch belongs to the approved dealer');
  const evidence = (await db.query(`SELECT evidence_class, evidence_subtype, verification_status, uploaded_by,
      uploader_role, verified_by, visibility_level, storage_bucket FROM vehicle_evidence WHERE vin = $1`, [VIN])).rows;
  assert.equal(evidence.length, 1);
  assert.deepEqual(evidence[0], { evidence_class: 'registration', evidence_subtype: 'registration_book',
    verification_status: 'verified', uploaded_by: owner, uploader_role: 'dealer',
    verified_by: f.actors.vehicle_reviewer.id, visibility_level: 'restricted', storage_bucket: 'ocr-documents' });
  const reviewerMember = (await db.query(`SELECT count(*)::int AS n FROM tenant_users WHERE user_id = $1`,
    [f.actors.vehicle_reviewer.id])).rows[0].n;
  assert.equal(reviewerMember, 0, 'the vehicle reviewer holds no dealership membership');
  const storage = (await db.query(`SELECT count(*)::int AS n FROM storage.objects
      WHERE bucket_id = 'ocr-documents' AND name LIKE $1`, [VIN + '/%'])).rows[0].n;
  assert.equal(storage, 1, 'the document bytes exist in real private Storage');

  // R5 T22 custody: owner-uploaded showroom photo, independent reviewer approval, consumed tickets, and private storage object
  const mediaItems = (await db.query(`SELECT media_id::text, seed_dealer_id, tenant_id::text, uploaded_by,
      media_category, caption, alt_text, rights_attestation, logo_rights_approved, review_status
      FROM dealer_storefront_media_items WHERE seed_dealer_id = $1`, [f.seed])).rows;
  assert.equal(mediaItems.length, 1, 'one browser-uploaded storefront media item');
  assert.equal(mediaItems[0].tenant_id, String(link.tenant_id));
  assert.equal(mediaItems[0].uploaded_by, owner);
  assert.equal(mediaItems[0].logo_rights_approved, false);
  assert.equal(mediaItems[0].review_status, 'APPROVED_PUBLIC_DISPLAY');
  const mediaEvents = (await db.query(`SELECT reviewer_user_id AS reviewer_id, decision, logo_rights_approved
      FROM dealer_storefront_media_review_events WHERE seed_dealer_id = $1`, [f.seed])).rows;
  assert.deepEqual(mediaEvents, [{
    reviewer_id: f.actors.reviewer.id,
    decision: 'APPROVED_PUBLIC_DISPLAY',
    logo_rights_approved: false,
  }]);
  const consumedTickets = (await db.query(`SELECT operation FROM dealer_storefront_media_review_tickets
      WHERE seed_dealer_id = $1 AND reviewer_id = $2 AND consumed_at IS NOT NULL ORDER BY operation`,
    [f.seed, f.actors.reviewer.id])).rows;
  assert.deepEqual(consumedTickets.map((r) => r.operation), ['STOREFRONT_MEDIA_DECISION', 'STOREFRONT_MEDIA_PREVIEW']);
  const mediaStorage = (await db.query(`SELECT count(*)::int AS n FROM storage.objects
      WHERE bucket_id = 'ocr-documents' AND name LIKE $1`, ['dealership-media/' + link.tenant_id + '/%'])).rows[0].n;
  assert.equal(mediaStorage, 1, 'storefront media binary exists in private Storage');

  const inquiries = (await db.query(`SELECT buyer_id, seller_id, seller_tenant_id, status, risk_status
      FROM marketplace_inquiries WHERE listing_id = $1 ORDER BY created_at`, [VIN])).rows;
  assert.equal(inquiries.length, 1, 'exactly one buyer enquiry (post-suspension attempt was refused)');
  assert.deepEqual(inquiries[0], { buyer_id: f.actors.vehicle_buyer.id, seller_id: owner,
    seller_tenant_id: String(link.tenant_id), status: 'qualified', risk_status: 'clear' });
  const progress = (await db.query(`SELECT previous_status, next_status FROM dealer_canonical_inquiry_progress_events e
      JOIN marketplace_inquiries i ON i.id = e.inquiry_id WHERE i.listing_id = $1 ORDER BY e.created_at`, [VIN])).rows;
  assert.deepEqual(progress.map((p) => p.previous_status + '>' + p.next_status), ['new>contacted', 'contacted>qualified']);
  const outbox = (await db.query(`SELECT status FROM domain_events WHERE event_type = 'marketplace.inquiry.created'
      AND payload->>'listingId' = $1`, [VIN])).rows;
  assert.deepEqual(outbox.map((o) => o.status), ['pending'], 'one canonical outbox event, never delivered (no worker/provider)');
  const events = (await db.query(`SELECT event_type, reason_code, affected_listings FROM dealer_listing_authority_events
      WHERE tenant_id = $1 ORDER BY created_at`, [link.tenant_id])).rows;
  assert.equal(events[0].event_type, 'LISTING_CANDIDATE_PREPARED');
  const receipt = {
    fictional_only: true, vin: VIN, governed_seller: 'APPROVED_OWNER', facts_source: 'dealer_declared',
    evidence: 'registration/registration_book verified by independent non-member admin',
    storage_objects: storage, media_storage_objects: mediaStorage, media_review_events: mediaEvents.length,
    consumed_media_tickets: consumedTickets.map((r) => r.operation),
    buyer_enquiries: inquiries.length, enquiry_final_status: inquiries[0].status,
    progress_events: progress.length, outbox_events_pending_undelivered: outbox.length,
    publication_status: v.publication_status, link_operating_status: link.operating_status,
  };
  if (afterSuspension) {
    assert.equal(link.operating_status, 'SUSPENDED');
    const withdrawal = events.filter((e) => e.event_type === 'PUBLIC_LISTINGS_WITHDRAWN');
    assert.deepEqual(withdrawal, [{ event_type: 'PUBLIC_LISTINGS_WITHDRAWN', reason_code: 'OPERATING_LINK_SUSPENDED', affected_listings: 1 }]);
    const now = (await db.query(`SELECT dealer_tenant_listing_authority_current($1::uuid) AS current,
        (SELECT count(*)::int FROM dealer_storefront_public_listing_vins($2, 12)) AS storefront_vins,
        (SELECT count(*)::int FROM dealer_public_storefront_media_current WHERE seed_dealer_id = $2) AS public_media_items,
        (SELECT status FROM tenants WHERE id = $1::uuid) AS tenant_status`, [link.tenant_id, f.seed])).rows[0];
    assert.deepEqual(now, { current: false, storefront_vins: 0, public_media_items: 0, tenant_status: 'suspended' });

    // R5 T42 custody: ZW-DEAL-0003 correction resolved as RESOLVED_SUPPRESSED and withdrawn from PRELISTED_UNCLAIMED
    const corrReview = (await db.query(`SELECT seed_dealer_id, reviewer_user_id AS reviewer_id, decision, resulting_publication_status
        FROM dealer_research_correction_review_events WHERE seed_dealer_id = 'ZW-DEAL-0003'`)).rows;
    assert.deepEqual(corrReview, [{
      seed_dealer_id: 'ZW-DEAL-0003',
      reviewer_id: f.actors.reviewer.id,
      decision: 'RESOLVED_SUPPRESSED',
      resulting_publication_status: 'SUPPRESSED',
    }]);
    const suppressedProfile = (await db.query(`SELECT publication_status FROM dealer_research_public_profiles
        WHERE seed_dealer_id = 'ZW-DEAL-0003'`)).rows[0];
    assert.equal(suppressedProfile?.publication_status, 'SUPPRESSED', 'T42 suppressed profile marked SUPPRESSED');

    // R5 S09 custody: ZW-DEAL-0004 reconciled as duplicate of canonical ZW-DEAL-0002
    const redirects = (await db.query(`SELECT duplicate_seed_dealer_id, canonical_seed_dealer_id, canonical_slug, reviewer_user_id AS reviewer_id
        FROM dealer_research_duplicate_redirects WHERE duplicate_seed_dealer_id = 'ZW-DEAL-0004'`)).rows;
    assert.deepEqual(redirects, [{
      duplicate_seed_dealer_id: 'ZW-DEAL-0004',
      canonical_seed_dealer_id: 'ZW-DEAL-0002',
      canonical_slug: 'zw-deal-0002',
      reviewer_id: f.actors.reviewer.id,
    }]);
    const dupProfile = (await db.query(`SELECT publication_status FROM dealer_research_public_profiles
        WHERE seed_dealer_id = 'ZW-DEAL-0004'`)).rows[0];
    assert.equal(dupProfile?.publication_status, 'DUPLICATE', 'S09 duplicate profile marked DUPLICATE');

    Object.assign(receipt, {
      withdrawal_event: withdrawal[0],
      authority_current_after: false,
      storefront_vins_after: 0,
      public_media_items_after: 0,
      t42_correction_review: corrReview[0],
      s09_duplicate_redirect: redirects[0],
    });
  } else {
    assert.equal(link.operating_status, 'ACTIVE');
    const storefront = (await db.query(`SELECT vin FROM dealer_storefront_public_listing_vins($1, 12)`, [f.seed])).rows;
    assert.deepEqual(storefront.map((r) => r.vin), [VIN]);
    const publicMedia = (await db.query(`SELECT count(*)::int AS n FROM dealer_public_storefront_media_current WHERE seed_dealer_id = $1`, [f.seed])).rows[0].n;
    assert.equal(publicMedia, 1, '1 approved public media item while authority and storefront are active');
  }
  const file = afterSuspension ? 'web/test-results/fictional-native-dealer-suspension-custody.json'
    : 'web/test-results/fictional-native-vin-listing-custody.json';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(afterSuspension
    ? 'DEALER_NATIVE_FICTIONAL_SUSPENSION_CUSTODY PASS: revocation withdrew the 1 public dealer listing + media (OPERATING_LINK_SUSPENDED), authority not current, tenant suspended, 0 storefront VINs, 0 public media, T42 suppression + S09 duplicate redirect custody verified'
    : 'DEALER_NATIVE_FICTIONAL_LISTING_CUSTODY PASS: owner governed seller, dealer_declared facts, owned branch, independent non-member document review, real private Storage objects (vehicle + media), T22 media approved + tickets consumed, published, 1 buyer enquiry qualified via 2 audited transitions, outbox pending undelivered');
} finally {
  await db.end();
}
