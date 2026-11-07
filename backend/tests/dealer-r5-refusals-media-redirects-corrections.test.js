/**
 * CARUP-DEALER-ONB-001-LR01-R5 — Unit & Contract Proof for:
 *  - Deterministic API refusal handling (400 / 401 / 403 / 404 / 409 / 422 / 503 / sanitized 500)
 *  - S08: Multi-prelisting directory browse & filtering by category, tier, city, and query
 *  - T42: Customer/business source correction & takedown reviewer disposition
 *  - S09: Governed duplicate reconciliation, canonical URL redirect & hostile-takeover guard
 *  - T22: Tenant-scoped dealership media gallery, ClamAV scan, rights attestation & reviewer approval
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { supabase } = await import('../db/supabase.js');
const { hashPassword } = await import('../utils/passwordAuth.js');
const {
  DEALER_SQL_REFUSAL_STATUS_MAP,
  mapDealerSqlRefusal,
  sendDealerRouteError,
} = await import('../services/dealer/dealerSqlRefusalMapper.js');
const research = await import('../services/dealer/dealerResearchService.js');
const media = await import('../services/dealer/dealerStorefrontMediaService.js');

const REVIEWER_PW = 'IndependentR5ReviewerPass2026!';
const REVIEWER_HASH = await hashPassword(REVIEWER_PW);
const reviewerActor = {
  userId: 'reviewer-r5',
  authenticationMethod: 'session',
  isVerified: true,
  platformRole: 'reviewer',
};
const ownerActor = {
  userId: 'owner-r5',
  authenticationMethod: 'session',
  isVerified: true,
  platformRole: 'member',
};

// Minimal valid 1x1 PNG binary
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_PNG_DATA_URI = `data:image/png;base64,${VALID_PNG_BASE64}`;

test('R5 API Refusal Mapper: deterministically classifies SQL exceptions into 400, 403, 404, 409, 422, and 503', () => {
  const cases = [
    ['INVALID_DEALER_PUBLICATION_DECISION', 400],
    ['RELATED_SOURCE_ID_REQUIRED', 400],
    ['SELF_GROUPING_REFUSED', 400],
    ['INVALID_CORRECTION_REVIEW_DECISION', 400],
    ['SELF_DUPLICATE_REDIRECT_REFUSED', 400],
    ['INVALID_DEALER_MEDIA_METADATA', 400],
    ['INDEPENDENT_REVIEWER_AUTHORITY_REQUIRED', 403],
    ['INDEPENDENT_GROUP_REVIEWER_REQUIRED', 403],
    ['INDEPENDENT_PUBLIC_CONTACT_REVIEWER_REQUIRED', 403],
    ['INDEPENDENT_CORRECTION_REVIEWER_REQUIRED', 403],
    ['INDEPENDENT_DUPLICATE_REVIEWER_REQUIRED', 403],
    ['INDEPENDENT_MEDIA_REVIEWER_REQUIRED', 403],
    ['DEALER_MEDIA_UPLOAD_AUTHORITY_NOT_CURRENT', 403],
    ['REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER', 403],
    ['UNKNOWN_RESEARCH_SEED', 404],
    ['CORRECTION_REQUEST_NOT_FOUND', 404],
    ['STOREFRONT_MEDIA_NOT_FOUND', 404],
    ['TENANT_VEHICLE_NOT_FOUND', 404],
    ['RESEARCH_SEED_STATE_CONFLICT', 409],
    ['PUBLICATION_ELIGIBILITY_REQUIRED', 409],
    ['CORRECTION_REQUEST_ALREADY_RESOLVED', 409],
    ['DUPLICATE_REDIRECT_ALREADY_RECORDED', 409],
    ['DUPLICATE_REDIRECT_CHAIN_REFUSED', 409],
    ['DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED', 409],
    ['CANONICAL_TARGET_MUST_BE_PUBLISHED', 409],
    ['DEALER_MEDIA_PUBLICATION_REQUIRES_ACTIVE_AUTHORITY', 409],
    ['DEALER_INQUIRY_AUTHORITY_NOT_CURRENT', 409],
    ['UNSAFE_RESEARCH_PUBLIC_FACTS', 422],
    ['UNSAFE_SOURCE_WEBSITE_URL', 422],
    ['SOURCE_ADDRESS_UNAVAILABLE_FOR_PUBLIC_REVIEW', 422],
    ['OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED', 422],
  ];
  for (const [code, expectedStatus] of cases) {
    const mapped = mapDealerSqlRefusal({ message: `ERROR: ${code}` }, 'test op');
    assert.equal(mapped.statusCode, expectedStatus, `Expected ${code} -> ${expectedStatus}`);
    assert.equal(mapped.code, code);
  }
  const appendOnly = mapDealerSqlRefusal({ message: 'Append-only table dealer_research_publication_events: UPDATE is not permitted' });
  assert.equal(appendOnly.statusCode, 403);
  assert.equal(appendOnly.code, 'IMMUTABLE_AUDIT_LEDGER_MUTATION_REFUSED');

  const uniqueConflict = mapDealerSqlRefusal({ code: '23505', message: 'duplicate key value violates unique constraint' });
  assert.equal(uniqueConflict.statusCode, 409);

  const checkConstraint = mapDealerSqlRefusal({ code: '23514', message: 'new row violates check constraint' });
  assert.equal(checkConstraint.statusCode, 422);

  const transient = mapDealerSqlRefusal({ message: 'ECONNREFUSED 127.0.0.1:5432' }, 'research review');
  assert.equal(transient.statusCode, 503);
  assert.equal(transient.code, 'DEALER_SERVICE_UNAVAILABLE');
  assert.ok(Object.keys(DEALER_SQL_REFUSAL_STATUS_MAP).length >= 100);
});

test('R5 sendDealerRouteError preserves 4xx and 503 contracts and sanitizes unexpected 500 faults without leaking SQL/PII', () => {
  function mockRes() {
    return {
      headers: {},
      statusCode: 200,
      payload: null,
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.payload = b; return this; },
    };
  }
  const r409 = mockRes();
  sendDealerRouteError(r409, () => {}, Object.assign(new Error('DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED'), {
    statusCode: 409,
    code: 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED',
  }));
  assert.equal(r409.statusCode, 409);
  assert.equal(r409.headers['Cache-Control'], 'no-store');
  assert.equal(r409.payload.code, 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED');

  const r503 = mockRes();
  sendDealerRouteError(r503, () => {}, Object.assign(new Error('research review unavailable; no state change is confirmed'), {
    statusCode: 503,
    code: 'DEALER_SERVICE_UNAVAILABLE',
  }));
  assert.equal(r503.statusCode, 503);
  assert.equal(r503.payload.code, 'DEALER_SERVICE_UNAVAILABLE');

  const r500 = mockRes();
  sendDealerRouteError(r500, () => {}, new Error('SELECT * FROM dealer_research_seed_records WHERE secret_email = "private@example.com"'));
  assert.equal(r500.statusCode, 500);
  assert.equal(r500.payload.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(!JSON.stringify(r500.payload).includes('dealer_research_seed_records'));
  assert.ok(!JSON.stringify(r500.payload).includes('private@example.com'));
});

test('S08 listPublicResearch filters multiple reviewed fictional prelistings by category, verification tier, city, and search query', async () => {
  const origFrom = supabase.from;
  const rows = [
    {
      seed_dealer_id: 'ZW-DEAL-0001',
      public_slug: 'zw-deal-0001',
      public_name: 'Synthetic Harare Approved Motors',
      public_city: 'Harare',
      public_research_category: 'Vehicle sales (research category)',
      source_attribution: 'Synthetic fixture',
      publication_status: 'PRELISTED_UNCLAIMED',
      reviewed_at: '2026-11-06T00:00:00Z',
      revision: 1,
    },
    {
      seed_dealer_id: 'ZW-DEAL-0002',
      public_slug: 'zw-deal-0002',
      public_name: 'Synthetic Bulawayo Unclaimed Auto',
      public_city: 'Bulawayo',
      public_research_category: 'Vehicle imports (research category)',
      source_attribution: 'Synthetic fixture',
      publication_status: 'PRELISTED_UNCLAIMED',
      reviewed_at: '2026-11-06T00:00:00Z',
      revision: 1,
    },
    {
      seed_dealer_id: 'ZW-DEAL-0005',
      public_slug: 'zw-deal-0005',
      public_name: 'Synthetic Harare Claimed Pending Display',
      public_city: 'Harare',
      public_research_category: 'Commercial vehicles (research category)',
      source_attribution: 'Synthetic fixture',
      publication_status: 'PRELISTED_UNCLAIMED',
      reviewed_at: '2026-11-06T00:00:00Z',
      revision: 1,
    },
  ];
  try {
    supabase.from = (table) => {
      if (table === 'dealer_research_public_profiles') {
        let filtered = [...rows];
        return {
          select() { return this; },
          eq(col, val) {
            filtered = filtered.filter((r) => r[col] === val);
            return this;
          },
          ilike(col, pattern) {
            const needle = pattern.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter((r) => String(r[col]).toLowerCase().includes(needle));
            return this;
          },
          order() { return this; },
          async range() {
            return { data: filtered, count: filtered.length, error: null };
          },
        };
      }
      if (table === 'dealer_full_storefront_current') {
        return {
          select() { return this; },
          in() { return this; },
          async limit() {
            return {
              data: [{
                seed_dealer_id: 'ZW-DEAL-0001',
                public_slug: 'zw-deal-0001',
                public_name: 'Synthetic Harare Approved Motors',
                public_city: 'Harare',
                approved_branch_snapshot: [{ branch_id: '11111111-1111-4111-8111-111111111111', name: 'Main Branch', address: '1 Synthetic Way' }],
                dealer_declared_sections: {},
                publication_reviewed_at: '2026-11-06T00:00:00Z',
              }],
              error: null,
            };
          },
        };
      }
      if (table === 'dealer_research_claim_requests') {
        return {
          select() { return this; },
          in() { return this; },
          async eq() {
            return {
              data: [{ seed_dealer_id: 'ZW-DEAL-0001' }, { seed_dealer_id: 'ZW-DEAL-0005' }],
              error: null,
            };
          },
        };
      }
      throw new Error('Unexpected table ' + table);
    };

    const all = await research.listPublicResearch({});
    assert.equal(all.entries.length, 3);
    assert.equal(all.total, 3);
    assert.equal(all.real_104_records_published_claim, false);

    const onlyApproved = await research.listPublicResearch({ tier: 'FULL_DEALER_APPROVED' });
    assert.equal(onlyApproved.entries.length, 1);
    assert.equal(onlyApproved.entries[0].seed_dealer_id, 'ZW-DEAL-0001');
    assert.equal(onlyApproved.total, 1);

    const onlyClaimedUnapproved = await research.listPublicResearch({ tier: 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED' });
    assert.equal(onlyClaimedUnapproved.entries.length, 1);
    assert.equal(onlyClaimedUnapproved.entries[0].seed_dealer_id, 'ZW-DEAL-0005');
    assert.equal(onlyClaimedUnapproved.total, 1);

    const onlyUnclaimed = await research.listPublicResearch({ tier: 'PRELISTED_UNCLAIMED' });
    assert.equal(onlyUnclaimed.entries.length, 1);
    assert.equal(onlyUnclaimed.entries[0].seed_dealer_id, 'ZW-DEAL-0002');
    assert.equal(onlyUnclaimed.total, 1);

    const importsOnly = await research.listPublicResearch({ category: 'Vehicle imports (research category)' });
    assert.equal(importsOnly.entries.length, 1);
    assert.equal(importsOnly.entries[0].seed_dealer_id, 'ZW-DEAL-0002');

    await assert.rejects(
      research.listPublicResearch({ tier: 'FAKE_TIER' }),
      (err) => err.statusCode === 400 && err.code === 'INVALID_TIER_FILTER',
    );
  } finally {
    supabase.from = origFrom;
  }
});

test('T42 reviewResearchCorrectionRequest enforces independent reviewer, password step-up, and maps SQL refusals', async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;
  const reqId = '44444444-4444-4444-8444-444444444444';
  try {
    supabase.from = (table) => {
      assert.equal(table, 'users');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: { id: reviewerActor.userId, role: 'reviewer', is_verified: true, password_hash: REVIEWER_HASH },
            error: null,
          };
        },
      };
    };
    supabase.rpc = async (name, args) => {
      assert.equal(name, 'dealer_review_research_correction_request');
      assert.equal(args.p_request_id, reqId);
      assert.equal(args.p_decision, 'RESOLVED_SUPPRESSED');
      return {
        data: {
          event_id: '55555555-5555-4555-8555-555555555555',
          request_id: reqId,
          seed_dealer_id: 'ZW-DEAL-0003',
          decision: 'RESOLVED_SUPPRESSED',
          resulting_publication_status: 'SUPPRESSED',
          public_profile_withdrawn: true,
        },
        error: null,
      };
    };

    await assert.rejects(
      research.reviewResearchCorrectionRequest(reqId, ownerActor, {
        decision: 'RESOLVED_SUPPRESSED',
        reason: 'x'.repeat(70),
        reviewer_password: REVIEWER_PW,
      }),
      (err) => err.statusCode === 403,
    );

    const resolved = await research.reviewResearchCorrectionRequest(reqId, reviewerActor, {
      decision: 'RESOLVED_SUPPRESSED',
      reason: 'Independent reviewer verified the takedown request and suppressed the public profile.',
      reviewer_password: REVIEWER_PW,
    });
    assert.equal(resolved.resulting_publication_status, 'SUPPRESSED');
    assert.equal(resolved.public_profile_withdrawn, true);
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test('S09 reconcileDuplicateResearchSeed and getPublicResearchDuplicateRedirect enforce canonical target and block duplicate claims', async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;
  try {
    await assert.rejects(
      research.reconcileDuplicateResearchSeed('ZW-DEAL-0004', reviewerActor, {
        canonical_seed_dealer_id: 'ZW-DEAL-0004',
        reason: 'x'.repeat(70),
        reviewer_password: REVIEWER_PW,
      }),
      (err) => err.statusCode === 400 && err.code === 'SELF_DUPLICATE_REDIRECT_REFUSED',
    );

    supabase.from = (table) => {
      if (table === 'dealer_research_duplicate_redirects') {
        return {
          select() { return this; },
          eq(_k, id) {
            this._id = id;
            return this;
          },
          async maybeSingle() {
            if (this._id === 'ZW-DEAL-0004') {
              return {
                data: {
                  redirect_id: '66666666-6666-4666-8666-666666666666',
                  duplicate_seed_dealer_id: 'ZW-DEAL-0004',
                  canonical_seed_dealer_id: 'ZW-DEAL-0002',
                  canonical_slug: 'zw-deal-0002',
                  reconciled_at: '2026-11-06T00:00:00Z',
                  source_custody_preserved: true,
                  legal_entity_merged: false,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
      }
      if (table === 'dealer_research_public_profiles') {
        return {
          select() { return this; },
          eq(k, v) {
            this[k] = v;
            return this;
          },
          async maybeSingle() {
            if (this.seed_dealer_id === 'ZW-DEAL-0002') {
              return {
                data: {
                  seed_dealer_id: 'ZW-DEAL-0002',
                  public_slug: 'zw-deal-0002',
                  public_name: 'Canonical Bulawayo Dealer',
                  public_city: 'Bulawayo',
                  public_research_category: 'Vehicle sales (research category)',
                  source_attribution: 'Synthetic fixture',
                  publication_status: 'PRELISTED_UNCLAIMED',
                  reviewed_at: '2026-11-06T00:00:00Z',
                  revision: 1,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
      }
      if (table === 'dealer_full_storefront_current') {
        return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
      }
      if (table === 'dealer_research_claim_requests') {
        return { select() { return this; }, in() { return this; }, async eq() { return { data: [], error: null }; } };
      }
      throw new Error('Unexpected table ' + table);
    };

    const redirect = await research.getPublicResearchDuplicateRedirect('ZW-DEAL-0004');
    assert.ok(redirect);
    assert.equal(redirect.canonical_seed_dealer_id, 'ZW-DEAL-0002');
    assert.equal(redirect.canonical_path, '/dealers/zw-deal-0002');
    assert.equal(redirect.source_custody_preserved, true);
    assert.equal(redirect.legal_entity_merged, false);

    await assert.rejects(
      research.submitResearchClaim('ZW-DEAL-0004', ownerActor, {
        claimed_scope: 'BRANCH',
        representative_relationship: 'LEGAL_OWNER',
        asserted_legal_business_name: 'Duplicate Claimant Co',
        claim_statement: 'Attempting to claim a duplicate research seed that redirects to ZW-DEAL-0002.',
      }),
      (err) => err.statusCode === 409 && err.code === 'DUPLICATE_SEED_REDIRECTED_TO_CANONICAL',
    );
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test('T22 dealerStorefrontMediaService validates image bytes, refuses OEM/logo claims, scans via ClamAV, and requires independent reviewer approval', async () => {
  const bytes = media.decodeStorefrontMediaImage(VALID_PNG_DATA_URI, 'image/png');
  assert.ok(bytes.length >= 32);

  assert.throws(
    () => media.decodeStorefrontMediaImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'image/svg+xml'),
    (err) => err.statusCode === 400 && err.code === 'INVALID_DEALER_MEDIA_FORMAT',
  );

  const resolveOwner = async () => ({
    actor_id: ownerActor.userId,
    seed_dealer_id: 'ZW-DEAL-0001',
    tenant_id: '99999999-8888-4777-8666-555555555555',
    dealer_profile_id: '88888888-7777-4666-8555-444444444444',
  });

  await assert.rejects(
    media.uploadMyStorefrontMedia(ownerActor, {
      media_category: 'SHOWROOM_EXTERIOR',
      caption: 'Showroom exterior with OEM badge',
      alt_text: 'Showroom exterior with OEM badge',
      mime_type: 'image/png',
      image_data_url: VALID_PNG_DATA_URI,
      rights_attestation: media.DEALER_MEDIA_RIGHTS_ATTESTATION,
      oem_or_brand_logo_claimed: true,
    }, { resolveOwner }),
    (err) => err.statusCode === 422 && err.code === 'OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED',
  );

  await assert.rejects(
    media.uploadMyStorefrontMedia(ownerActor, {
      media_category: 'SHOWROOM_EXTERIOR',
      caption: 'Short',
      alt_text: ' x ',
      mime_type: 'image/png',
      image_data_url: VALID_PNG_DATA_URI,
      rights_attestation: media.DEALER_MEDIA_RIGHTS_ATTESTATION,
      oem_or_brand_logo_claimed: false,
    }, { resolveOwner }),
    (err) => err.statusCode === 400 && err.code === 'ACCESSIBLE_CAPTION_AND_ALT_TEXT_REQUIRED',
  );

  const uploadedPaths = [];
  const mockDb = {
    from(table) {
      assert.equal(table, 'dealer_storefront_media_items');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'ocr-documents');
        return {
          async upload(path) {
            uploadedPaths.push(path);
            return { data: { path }, error: null };
          },
          async remove() { return { data: [], error: null }; },
        };
      },
    },
    async rpc(name, args) {
      assert.equal(name, 'dealer_record_storefront_media_upload');
      assert.equal(args.p_oem_logo_claimed, false);
      return {
        data: {
          media_id: '77777777-7777-4777-8777-777777777777',
          seed_dealer_id: 'ZW-DEAL-0001',
          tenant_id: args.p_tenant_id,
          media_category: args.p_media_category,
          review_status: 'PENDING_INDEPENDENT_REVIEW',
          logo_rights_approved: false,
          public_display_approved: false,
        },
        error: null,
      };
    },
  };

  const uploaded = await media.uploadMyStorefrontMedia(ownerActor, {
    media_category: 'SHOWROOM_EXTERIOR',
    caption: 'Harare showroom forecourt and customer reception',
    alt_text: 'Exterior view of Harare dealership showroom forecourt',
    mime_type: 'image/png',
    image_data_url: VALID_PNG_DATA_URI,
    rights_attestation: media.DEALER_MEDIA_RIGHTS_ATTESTATION,
    oem_or_brand_logo_claimed: false,
  }, { db: mockDb, resolveOwner, scan: async () => true });

  assert.equal(uploaded.review_status, 'PENDING_INDEPENDENT_REVIEW');
  assert.equal(uploaded.logo_rights_approved, false);
  assert.equal(uploaded.public_display_approved, false);
  assert.equal(uploadedPaths.length, 1);
  assert.match(uploadedPaths[0], /^dealership-media\//);
});
