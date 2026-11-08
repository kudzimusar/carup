/**
 * CARUP-DEALER-ONB-001-LR01-R6 work package C — R5 security review #3, #5, #7, #8 (service/route layer).
 * The data-layer halves (SQL guards, ticket RPCs, step-up counters, real-publication gate) are
 * proven against PGlite and native PostgreSQL 17 in database/test/dealer_1_0_pglite_check.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { installStepUpGuardModel, createStepUpGuardModel, withStepUpGuard } from './helpers/dealerStepUpGuardModel.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dealer-local-fake';

const express = (await import('express')).default;
const { supabase } = await import('../db/supabase.js');
installStepUpGuardModel(supabase);
const { hashPassword } = await import('../utils/passwordAuth.js');
const claims = await import('../services/dealer/dealerClaimApplicationService.js');
const media = await import('../services/dealer/dealerStorefrontMediaService.js');
const full = await import('../services/dealer/dealerFullStorefrontService.js');
const lifecycle = await import('../services/dealer/dealerOperatingLifecycleService.js');
const research = await import('../services/dealer/dealerResearchService.js');
const mapper = await import('../services/dealer/dealerSqlRefusalMapper.js');
const { rateLimiter } = await import('../middleware/securityMiddleware.js');
const researchRouter = (await import('../routes/dealerResearchRoutes.js')).default;
const dealerRouter = (await import('../routes/dealerRoutes.js')).default;

const PASSWORD = 'R6-Fictional-Reviewer-StepUp-Password!';
const PASSWORD_HASH = await hashPassword(PASSWORD);
const reviewer = { userId: 'r6-reviewer', authenticationMethod: 'session', isVerified: true, platformRole: 'reviewer' };
const otherReviewer = { ...reviewer, userId: 'r6-reviewer-2' };

function usersDb(model = createStepUpGuardModel(), extra = {}) {
  const calls = { from: [], rpc: [] };
  return {
    calls,
    model,
    rpc: withStepUpGuard(async (name, args) => { calls.rpc.push([name, args]); throw new Error('Unexpected rpc ' + name); }, model),
    from(table) {
      calls.from.push(table);
      assert.equal(table, 'users');
      const id = { value: null };
      return {
        select() { return this; },
        eq(_c, v) { id.value = v; return this; },
        async maybeSingle() {
          return { data: { id: id.value, role: 'reviewer', is_verified: true, password_hash: PASSWORD_HASH }, error: null };
        },
      };
    },
    ...extra,
  };
}

// ───────────────────────── #5 per-reviewer step-up lockout ─────────────────────────
test('#5 five failed step-ups lock that reviewer for 15 minutes; the locked attempt never verifies the password', async () => {
  const db = usersDb();
  let verifications = 0;
  const verify = async (pw, hash) => { verifications += 1; return pw === PASSWORD && hash === PASSWORD_HASH; };
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(claims.requireReviewerPassword(reviewer, null, 'wrong-password-' + i, { db, verify }),
      (e) => e.statusCode === 403 && e.code === 'REAUTHENTICATION_FAILED');
  }
  assert.equal(verifications, 5);
  await assert.rejects(claims.requireReviewerPassword(reviewer, null, PASSWORD, { db, verify }),
    (e) => e.statusCode === 429 && e.code === 'REVIEWER_STEP_UP_LOCKED' && e.retryAfterSeconds === 900);
  assert.equal(verifications, 5, 'a locked reviewer is refused before any password comparison');
  // Per account: a different reviewer (same process / same IP) is unaffected.
  await assert.doesNotReject(claims.requireReviewerPassword(otherReviewer, null, PASSWORD, { db, verify }));
  assert.deepEqual(claims.REVIEWER_STEP_UP_LOCKOUT_POLICY,
    { max_unsuccessful_attempts: 5, window_minutes: 15, lockout_minutes: 15, scope: 'per_reviewer_user_id' });
});

test('#5 success paths never lock out: 4 failures then success resets; 30 consecutive successes stay open', async () => {
  const db = usersDb();
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(claims.requireReviewerPassword(reviewer, null, 'wrong-password', { db }), /REAUTHENTICATION_FAILED/);
  }
  await claims.requireReviewerPassword(reviewer, null, PASSWORD, { db });
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(claims.requireReviewerPassword(reviewer, null, 'wrong-password', { db }), /REAUTHENTICATION_FAILED/);
  }
  await claims.requireReviewerPassword(reviewer, null, PASSWORD, { db });
  for (let i = 0; i < 30; i += 1) await claims.requireReviewerPassword(reviewer, null, PASSWORD, { db });
  assert.equal(db.model.state.get(reviewer.userId).locked, false);
  assert.equal(db.model.state.get(reviewer.userId).attempts, 0);
});

test('#5 abuse: 12 parallel wrong guesses reserve at most 5 verifications; the rest get 429', async () => {
  const db = usersDb();
  let verifications = 0;
  const verify = async () => { verifications += 1; await new Promise((r) => setTimeout(r, 15)); return false; };
  const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
    claims.requireReviewerPassword(reviewer, null, 'parallel-guess', { db, verify })));
  const codes = results.map((r) => r.reason?.code);
  assert.equal(verifications, 5);
  assert.equal(codes.filter((c) => c === 'REAUTHENTICATION_FAILED').length, 5);
  assert.equal(codes.filter((c) => c === 'REVIEWER_STEP_UP_LOCKED').length, 7);
});

test('#5 the guard fails closed: an unavailable shared counter refuses with 503 and never checks the password', async () => {
  let verifications = 0;
  const verify = async () => { verifications += 1; return true; };
  for (const rpc of [
    async () => ({ data: null, error: { message: 'connection refused' } }),
    async () => { throw new Error('socket hang up'); },
    async () => ({ data: null, error: null }),
  ]) {
    const db = { ...usersDb(), rpc };
    await assert.rejects(claims.requireReviewerPassword(reviewer, null, PASSWORD, { db, verify }),
      (e) => e.statusCode === 503 && e.code === 'REVIEWER_STEP_UP_GUARD_UNAVAILABLE');
  }
  assert.equal(verifications, 0);
  // Validation that needs no password comparison does not consume an attempt.
  const db = usersDb();
  await assert.rejects(claims.requireReviewerPassword(reviewer, null, 'short', { db }), /REAUTHENTICATION_REQUIRED/);
  assert.equal(db.model.calls.length, 0);
});

test('#5 the reservation precedes the users lookup; completion reports the verified outcome', async () => {
  const db = usersDb();
  const order = [];
  const wrappedRpc = db.rpc;
  db.rpc = async (name, args) => { order.push(name + ':' + (args.p_succeeded ?? '')); return wrappedRpc(name, args); };
  const from = db.from.bind(db);
  db.from = (t) => { order.push('from:' + t); return from(t); };
  await claims.requireReviewerPassword(reviewer, null, PASSWORD, { db });
  assert.deepEqual(order, ['dealer_begin_reviewer_step_up:', 'from:users', 'dealer_complete_reviewer_step_up:true']);
});

test('#5 a 429 step-up lock is sent with Retry-After; other 4xx are unchanged', () => {
  const sent = {};
  const res = {
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { sent.status = c; return this; },
    json(b) { sent.body = b; return this; },
  };
  mapper.sendDealerRouteError(res, null, Object.assign(new Error('REVIEWER_STEP_UP_LOCKED'),
    { statusCode: 429, code: 'REVIEWER_STEP_UP_LOCKED', retryAfterSeconds: 900 }));
  assert.equal(sent.status, 429);
  assert.equal(res.headers['Retry-After'], '900');
  assert.equal(sent.body.code, 'REVIEWER_STEP_UP_LOCKED');
  const res2 = { ...res, headers: {}, set: res.set, status: res.status, json: res.json };
  mapper.sendDealerRouteError(res2, null, Object.assign(new Error('X'), { statusCode: 403, code: 'X', retryAfterSeconds: 900 }));
  assert.equal(res2.headers['Retry-After'], undefined);
});

// ───────────────────────── #7 conflict of interest → clear 403 ─────────────────────────
const COI = { message: 'DEALER_REVIEWER_CONFLICT_OF_INTEREST', code: '42501' };

test('#7 data-layer conflict of interest maps to 403 in every reviewer service, never a generic 409/503', async () => {
  assert.equal(mapper.mapDealerSqlRefusal(COI).statusCode, 403);
  assert.equal(mapper.mapDealerSqlRefusal(COI).code, 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
  assert.equal(lifecycle.mapLifecycleSqlError(COI).statusCode, 403);
  assert.equal(lifecycle.mapLifecycleSqlError(COI).code, 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
  assert.throws(() => mapper.throwIfDealerSecurityRefusal(COI),
    (e) => e.statusCode === 403 && e.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
  assert.doesNotThrow(() => mapper.throwIfDealerSecurityRefusal({ message: 'TERMINAL_CLAIM_REVIEW' }));

  // Full storefront (previously collapsed into 409 INDEPENDENT_FULL_STORE_FRONT_PUBLICATION_REFUSED).
  const oldFrom = supabase.from;
  const oldRpc = supabase.rpc;
  try {
    supabase.from = usersDb().from;
    supabase.rpc = async (name) => {
      assert.equal(name, 'dealer_review_full_storefront_publication');
      return { data: null, error: COI };
    };
    await assert.rejects(full.recordFullStorefrontPublication('ZW-DEAL-0001', reviewer, {
      disposition: 'RETRACTED', approved_branch_ids: [], approved_sections: [],
      reason: 'Conflict-of-interest probe: the reviewer is a member of the dealer tenant and must be refused here.',
      reviewer_password: PASSWORD,
    }), (e) => e.statusCode === 403 && e.message === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
    // A non-security SQL refusal keeps its previous generic mapping.
    supabase.rpc = async () => ({ data: null, error: { message: 'SEPARATE_PUBLIC_REVIEWER_REQUIRED' } });
    await assert.rejects(full.recordFullStorefrontPublication('ZW-DEAL-0001', reviewer, {
      disposition: 'RETRACTED', approved_branch_ids: [], approved_sections: [],
      reason: 'Conflict-of-interest probe: the reviewer is a member of the dealer tenant and must be refused here.',
      reviewer_password: PASSWORD,
    }), (e) => e.statusCode === 409 && e.message === 'INDEPENDENT_FULL_STORE_FRONT_PUBLICATION_REFUSED');
  } finally {
    supabase.from = oldFrom;
    supabase.rpc = oldRpc;
  }

  // Lifecycle (injected db + step-up).
  const lifeDb = {
    from(table) {
      assert.equal(table, 'dealer_approved_seed_links');
      return { select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { link_id: crypto.randomUUID(), seed_dealer_id: 'ZW-DEAL-0001',
          claimant_user_id: 'fictional-owner', operating_status: 'ACTIVE', legal_review_id: crypto.randomUUID() }, error: null }; } };
    },
    async rpc() { return { data: null, error: COI }; },
  };
  await assert.rejects(lifecycle.recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer, {
    action: 'SUSPEND', reason: 'Conflict-of-interest probe for a fictional dealer lifecycle decision.', reviewer_password: PASSWORD,
  }, { db: lifeDb, stepUp: async () => {} }), (e) => e.statusCode === 403 && e.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
});

test('#7 wiring: every reviewer service that collapses RPC errors routes them through the security mapper first', () => {
  for (const [file, generic] of [
    ['dealerClaimApplicationService.js', 'INDEPENDENT_CLAIM_REVIEW_REFUSED'],
    ['dealerComplianceApplicationService.js', 'INDEPENDENT_PRELIMINARY_REVIEW_REFUSED'],
    ['dealerLegalActivationService.js', 'LEGAL_COUNTRY_POLICY_OR_CASE_AUTHORITY_BLOCKED'],
    ['dealerLegalActivationService.js', 'CANONICAL_ACTIVATION_GATES_NOT_MET'],
    ['dealerLegalActivationService.js', 'RECONCILIATION_GATES_NOT_MET'],
    ['dealerFullStorefrontService.js', 'INDEPENDENT_FULL_STORE_FRONT_PUBLICATION_REFUSED'],
  ]) {
    const src = readFileSync(new URL('../services/dealer/' + file, import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => l.includes(`'${generic}'`));
    assert.ok(line, file + ' ' + generic);
    assert.match(line, /if\(error\)\{throwIfDealerSecurityRefusal\(error\);throw /, file + ' must map security refusals first');
  }
});

test('#2 a real-publication refusal from the data layer surfaces as 403, not a generic failure', async () => {
  assert.equal(mapper.mapDealerSqlRefusal({ message: 'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY' }).statusCode, 403);
  const oldFrom = supabase.from;
  const oldRpc = supabase.rpc;
  try {
    supabase.from = usersDb().from;
    supabase.rpc = async (name) => {
      assert.equal(name, 'dealer_record_research_publication_review');
      return { data: null, error: { message: 'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY' } };
    };
    await assert.rejects(research.reviewResearchSeed('ZW-DEAL-0042', reviewer, {
      decision: 'PRELISTED_UNCLAIMED',
      reason: 'Independent research publication review of a real researched business without an Owner policy row.',
      reviewer_password: PASSWORD,
    }), (e) => e.statusCode === 403 && e.code === 'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY');
  } finally {
    supabase.from = oldFrom;
    supabase.rpc = oldRpc;
  }
});

// ───────────────────────── #3 bounded anonymous media delivery ─────────────────────────
function png(seed) {
  const body = crypto.createHash('sha512').update(String(seed)).digest();
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), body]);
}
const IMG_A = png('a');
const IMG_B = png('b');
const SHA = (b) => crypto.createHash('sha256').update(b).digest('hex');
function viewRow(bytes, extra = {}) {
  return {
    media_id: crypto.randomUUID(), seed_dealer_id: 'ZW-DEAL-0001', branch_id: crypto.randomUUID(),
    branch_name: 'Reviewed Branch', storage_bucket: 'ocr-documents',
    storage_path: `dealership-media/${crypto.randomUUID()}/${crypto.randomUUID()}.png`,
    content_sha256: SHA(bytes), mime_type: 'image/png', media_category: 'SHOWROOM_EXTERIOR',
    caption: 'Fictional showroom forecourt', alt_text: 'Exterior of a fictional showroom',
    rights_attestation: 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO', logo_rights_approved: false,
    approved_at: '2026-11-07T00:00:00Z', ...extra,
  };
}
function mediaDb({ rows, objects, onDownload = () => {} }) {
  const calls = { limit: [], select: [], download: 0 };
  return {
    calls,
    from(table) {
      assert.equal(table, 'dealer_public_storefront_media_current');
      let filtered = rows();
      const chain = {
        select(cols) { calls.select.push(cols); return chain; },
        eq(col, val) { filtered = filtered.filter((r) => r[col] === val); return chain; },
        order() { return chain; },
        async limit(n) { calls.limit.push(n); return { data: filtered, error: null }; },
      };
      return chain;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'ocr-documents');
        return {
          async download(path) { calls.download += 1; onDownload(path); const b = objects.get(path); return b ? { data: b, error: null } : { data: null, error: { message: 'missing' } }; },
          async createSignedUrl() { throw new Error('public media must never mint signed storage URLs'); },
        };
      },
    },
  };
}

test('#3 the public gallery is metadata only: no bytes, data URIs, storage paths, signed URLs or internal ids; ≤12 items', async () => {
  const many = Array.from({ length: 30 }, (_, i) => viewRow(png('m' + i)));
  const db = mediaDb({ rows: () => many, objects: new Map() });
  media.clearPublicMediaByteCacheForTest();
  const out = await media.getPublicDealerStorefrontMedia('ZW-DEAL-0001', { db });
  assert.deepEqual(db.calls.limit, [12]);
  assert.equal(db.calls.download, 0, 'listing never downloads objects');
  assert.ok(!db.calls.select[0].includes('storage_path') && !db.calls.select[0].includes('media_id'));
  assert.equal(out.items.length, 12);
  assert.equal(out.max_items, 12);
  assert.equal(out.max_image_bytes, 4 * 1024 * 1024);
  const json = JSON.stringify(out);
  assert.ok(json.length < 12 * 1024, 'whole gallery response is a few KiB, not megabytes');
  for (const forbidden of ['data:image', 'dealership-media/', 'storage_path', 'media_id', 'signedUrl', 'branch_id', 'token=']) {
    assert.ok(!json.includes(forbidden), 'leak: ' + forbidden);
  }
  const first = out.items[0];
  assert.equal(first.media_key, many[0].content_sha256);
  assert.equal(first.image_path, `/dealership/research/ZW-DEAL-0001/media/${many[0].content_sha256}`);
  assert.equal(first.logo_rights_approved, false);
  assert.equal(out.oem_badges_or_logos_shown, false);
  // Rows that are unsafe or duplicated are dropped, never rendered.
  const tricky = [viewRow(IMG_A), viewRow(IMG_A), viewRow(IMG_B, { logo_rights_approved: true }),
    viewRow(png('x'), { content_sha256: 'not-a-sha' }), viewRow(png('y'), { mime_type: 'image/svg+xml' }),
    viewRow(png('z'), { seed_dealer_id: 'ZW-DEAL-0002' })];
  const out2 = await media.getPublicDealerStorefrontMedia('ZW-DEAL-0001', { db: { ...mediaDb({ rows: () => tricky, objects: new Map() }),
    from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() { return { data: tricky, error: null }; } }; } } });
  assert.equal(out2.items.length, 1);
});

test('#3 one image per request: integrity-checked, ≤4 MiB, cached bytes, but authorization re-checked every time', async () => {
  const rowA = viewRow(IMG_A);
  let approved = [rowA];
  const objects = new Map([[rowA.storage_path, IMG_A]]);
  const db = mediaDb({ rows: () => approved, objects });
  media.clearPublicMediaByteCacheForTest();
  const first = await media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rowA.content_sha256, { db });
  assert.ok(first.bytes.equals(IMG_A));
  assert.equal(first.mime_type, 'image/png');
  assert.equal(first.etag, `"${rowA.content_sha256}"`);
  assert.equal(first.cache_seconds, 60);
  await media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rowA.content_sha256, { db });
  assert.equal(db.calls.download, 1, 'second request is served from the bounded byte cache');
  // Withdrawn (view no longer returns it): refused at once although the bytes are cached.
  approved = [];
  await assert.rejects(media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rowA.content_sha256, { db }),
    (e) => e.statusCode === 404 && e.code === 'PUBLIC_STOREFRONT_MEDIA_NOT_FOUND');
  // Malformed keys never reach the database; another seed's key is not found.
  const before = db.calls.limit.length;
  for (const bad of ['../../etc/passwd', rowA.media_id, 'A'.repeat(64), '0'.repeat(63)]) {
    await assert.rejects(media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', bad, { db }), (e) => e.statusCode === 404);
  }
  assert.equal(db.calls.limit.length, before);
  approved = [rowA];
  await assert.rejects(media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0002', rowA.content_sha256, { db }), (e) => e.statusCode === 404);
  // Swapped or oversized storage objects are refused (never served under an approved key).
  media.clearPublicMediaByteCacheForTest();
  objects.set(rowA.storage_path, IMG_B);
  await assert.rejects(media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rowA.content_sha256, { db }),
    (e) => e.statusCode === 503 && e.code === 'PUBLIC_STOREFRONT_MEDIA_INTEGRITY_FAILED');
  const huge = Buffer.concat([IMG_A.subarray(0, 8), Buffer.alloc(4 * 1024 * 1024 + 1)]);
  const rowHuge = viewRow(huge);
  approved = [rowHuge];
  objects.set(rowHuge.storage_path, huge);
  await assert.rejects(media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rowHuge.content_sha256, { db }),
    (e) => e.statusCode === 503 && e.code === 'PUBLIC_STOREFRONT_MEDIA_INTEGRITY_FAILED');
});

test('#3 the in-process byte cache is bounded (LRU eviction under 32 MiB)', async () => {
  media.clearPublicMediaByteCacheForTest();
  const rows = [];
  const objects = new Map();
  for (let i = 0; i < 10; i += 1) {
    const b = Buffer.concat([IMG_A.subarray(0, 8), crypto.randomBytes(4 * 1024 * 1024 - 8)]);
    const r = viewRow(b);
    rows.push(r);
    objects.set(r.storage_path, b);
  }
  const db = mediaDb({ rows: () => rows, objects });
  for (const r of rows) await media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', r.content_sha256, { db });
  assert.equal(db.calls.download, 10);
  await media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rows[9].content_sha256, { db });
  assert.equal(db.calls.download, 10, 'most recent item still cached');
  await media.getPublicDealerStorefrontMediaImage('ZW-DEAL-0001', rows[0].content_sha256, { db });
  assert.equal(db.calls.download, 11, 'oldest item was evicted to respect the byte bound');
  media.clearPublicMediaByteCacheForTest();
});

async function withServer(router, fn) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { await new Promise((r) => srv.close(r)); }
}

test('#3 HTTP: gallery JSON then per-item image with cache headers, ETag/304, CORP, nosniff and a 60/min/IP cap', async () => {
  const rowA = viewRow(IMG_A);
  const objects = new Map([[rowA.storage_path, IMG_A]]);
  const db = mediaDb({ rows: () => [rowA], objects });
  const oldFrom = supabase.from;
  const oldStorage = Object.getOwnPropertyDescriptor(supabase, 'storage');
  media.clearPublicMediaByteCacheForTest();
  try {
    supabase.from = db.from;
    Object.defineProperty(supabase, 'storage', { configurable: true, value: db.storage });
    await withServer(researchRouter, async (base) => {
      const list = await fetch(base + '/api/dealership/research/ZW-DEAL-0001/media', { headers: { 'x-forwarded-for': '203.0.113.9' } });
      assert.equal(list.status, 200);
      assert.equal(list.headers.get('cache-control'), 'no-store');
      const body = await list.json();
      assert.equal(body.media.items.length, 1);
      const img = await fetch(base + '/api' + body.media.items[0].image_path);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.equal(img.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
      assert.equal(img.headers.get('etag'), `"${rowA.content_sha256}"`);
      assert.equal(img.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(Buffer.from(await img.arrayBuffer()).equals(IMG_A));
      const revalidated = await fetch(base + '/api' + body.media.items[0].image_path, { headers: { 'if-none-match': `"${rowA.content_sha256}"` } });
      assert.equal(revalidated.status, 304);
      const missing = await fetch(base + '/api/dealership/research/ZW-DEAL-0001/media/' + 'f'.repeat(64));
      assert.equal(missing.status, 404);
      // Anonymous per-IP request cap on the image endpoint (3 used above + 57 more = 60, then 429).
      for (let i = 0; i < 57; i += 1) {
        const r = await fetch(base + '/api' + body.media.items[0].image_path);
        assert.equal(r.status, 200, 'request ' + i);
        await r.arrayBuffer();
      }
      const capped = await fetch(base + '/api' + body.media.items[0].image_path);
      assert.equal(capped.status, 429);
    });
  } finally {
    supabase.from = oldFrom;
    if (oldStorage) Object.defineProperty(supabase, 'storage', oldStorage); else delete supabase.storage;
    media.clearPublicMediaByteCacheForTest();
  }
});

// ───────────────────────── #8b/#8c review queue & ticket custody bounds ─────────────────────────
const TICKET_SECRET = 'r6-test-shared-media-review-ticket-secret-0123456789';
function queueDb({ rows, issue, reviewerClaims = [], memberships = [], links = [] }) {
  const calls = { limit: [], issue: [], consume: [] };
  return {
    calls,
    from(table) {
      // R6 closure: the up-front reviewer-conflict lookup (claims held, memberships, linked seeds).
      const conflictRows = { dealer_research_claim_requests: reviewerClaims, tenant_users: memberships,
        dealer_approved_seed_links: links }[table];
      if (conflictRows) {
        const c = { select() { return c; }, eq() { return c; }, in() { return c; },
          async limit() { return { data: conflictRows, error: null }; } };
        return c;
      }
      assert.equal(table, 'dealer_storefront_media_items');
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        async limit(n) { calls.limit.push(n); return { data: rows, error: null }; },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === 'dealer_issue_storefront_media_review_ticket') {
        calls.issue.push(args);
        return issue(args, calls.issue.length);
      }
      if (name === 'dealer_consume_storefront_media_review_ticket') {
        calls.consume.push(args);
        return { data: null, error: { message: 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID' } };
      }
      throw new Error('unexpected rpc ' + name);
    },
  };
}
function queueRow(i, extra = {}) {
  return { media_id: crypto.randomUUID(), seed_dealer_id: 'ZW-DEAL-' + String(1 + (i % 3)).padStart(4, '0'),
    tenant_id: crypto.randomUUID(), branch_id: null, uploaded_by: 'owner-' + i, content_sha256: SHA(png('q' + i)),
    mime_type: 'image/png', file_bytes: 72, media_category: 'SHOWROOM_EXTERIOR', caption: 'Fictional caption ' + i,
    alt_text: 'Fictional alt text ' + i, rights_attestation: 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',
    review_status: 'PENDING_INDEPENDENT_REVIEW', created_at: '2026-11-07T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', ...extra };
}
const okIssue = (args) => ({ data: { ticket_jti: args.p_ticket_jti, seed_dealer_id: args.p_seed_dealer_id,
  operation: args.p_operation, expires_at: args.p_expires_at }, error: null });

test('#8b one queue call issues tickets for at most one 24-item page (≤48 grants), never 200', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => queueRow(i));
  const db = queueDb({ rows, issue: okIssue });
  const items = await media.listStorefrontMediaReviewQueue(reviewer, { db, secret: TICKET_SECRET });
  assert.deepEqual(db.calls.limit, [24]);
  assert.equal(media.MEDIA_REVIEW_QUEUE_PAGE_SIZE, 24);
  assert.equal(items.length, 24, 'even if storage returned more rows than requested');
  assert.equal(db.calls.issue.length, 48);
  assert.ok(items.every((x) => x.preview_ticket && x.decision_ticket && x.conflict_of_interest === false
    && x.ticket_issuance_deferred === false));
});

test('#7/#8b a conflicted row gets no tickets (queue still loads); an exhausted ticket budget defers the rest', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => queueRow(i));
  const conflictedTarget = rows[1].media_id;
  const db = queueDb({ rows, issue: (args, n) => {
    if (args.p_target_row_id === conflictedTarget) return { data: null, error: { message: 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' } };
    if (n > 7) return { data: null, error: { message: 'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT' } };
    return okIssue(args);
  } });
  const items = await media.listStorefrontMediaReviewQueue(reviewer, { db, secret: TICKET_SECRET });
  assert.equal(items.length, 6);
  assert.equal(items[0].preview_ticket !== null && items[0].decision_ticket !== null, true);
  assert.equal(items[1].conflict_of_interest, true);
  assert.equal(items[1].caption, null, 'R6 closure: no non-public caption for a conflicted reviewer');
  assert.equal(items[1].alt_text, null);
  assert.equal(items[1].rights_attestation, null);
  assert.equal(items[1].independent_reviewer_required, false);
  assert.equal(items[1].preview_ticket, null);
  assert.equal(items[1].decision_ticket, null);
  assert.ok(items[2].preview_ticket && items[3].preview_ticket);
  // Grants: 2 (row0) + 1 refused (row1) + 2 + 2 = 7 succeed, the 8th hits the cap.
  assert.equal(items[4].ticket_issuance_deferred, true);
  assert.equal(items[4].preview_ticket, null);
  assert.equal(items[5].ticket_issuance_deferred, true);
  assert.equal(db.calls.issue.length, 8, 'no further grants are attempted after the budget is exhausted');
  // Any other custody failure still fails closed.
  const broken = queueDb({ rows, issue: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
  await assert.rejects(media.listStorefrontMediaReviewQueue(reviewer, { db: broken, secret: TICKET_SECRET }),
    (e) => e.statusCode === 503 && e.code === 'STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE');
});

test('R6 closure: a conflicted row stays redacted even after the reviewer\'s grant budget is exhausted', async () => {
  media.simulateProcessRestartForTest();
  const rows = Array.from({ length: 4 }, (_, i) => queueRow(i));
  const conflictedSeed = rows[3].seed_dealer_id;
  // Budget exhausted after the first item: the grant error no longer reveals the conflict.
  const db = queueDb({ rows, reviewerClaims: [{ seed_dealer_id: conflictedSeed }],
    issue: (args, n) => (n > 2 ? { data: null, error: { message: 'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT' } } : okIssue(args)) });
  const items = await media.listStorefrontMediaReviewQueue(reviewer, { db, secret: TICKET_SECRET });
  const conflicted = items.filter((x) => x.seed_dealer_id === conflictedSeed);
  assert.ok(conflicted.length >= 1);
  for (const x of conflicted) {
    assert.equal(x.conflict_of_interest, true);
    assert.equal(x.caption, null); assert.equal(x.alt_text, null); assert.equal(x.rights_attestation, null);
    assert.equal(x.preview_ticket, null); assert.equal(x.decision_ticket, null);
  }
  assert.equal(db.calls.issue.some((a) => a.p_seed_dealer_id === conflictedSeed), false,
    'no ticket grant is even attempted for a conflicted row');
});

test('#8c ticket consumption never sends an app-supplied clock to the database', async () => {
  media.simulateProcessRestartForTest();
  const row = queueRow(0);
  const db = queueDb({ rows: [row], issue: okIssue });
  const [item] = await media.listStorefrontMediaReviewQueue(reviewer, { db, secret: TICKET_SECRET });
  await assert.rejects(media.verifyAndConsumeStorefrontMediaReviewTicket(item.preview_ticket, {
    reviewerId: reviewer.userId, seedDealerId: row.seed_dealer_id,
    expectedOperation: media.DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW, db, secret: TICKET_SECRET,
  }), /STOREFRONT_MEDIA_REVIEW_TICKET_INVALID/);
  assert.equal(db.calls.consume.length, 1);
  assert.equal(Object.hasOwn(db.calls.consume[0], 'p_now'), false);
  assert.equal(mapper.mapDealerSqlRefusal({ message: 'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT' }).statusCode, 429);
});

// ───────────────────────── #8a owner write limits ─────────────────────────
function hit(limiter, { ip, userId }) {
  return new Promise((resolve) => {
    const req = { method: 'POST', ip, originalUrl: '/api/dealer/operational-media', headers: {},
      userContext: userId ? { userId } : undefined };
    const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
    limiter(req, res, () => resolve(200));
  });
}

test('#8a account-keyed limits: per owner across IPs, independent of other owners on the same IP', async () => {
  const limiter = rateLimiter({ max: 3, windowMs: 3600000, isSensitive: true, bucket: 'r6-account-probe', keyBy: 'account' });
  const sharedIp = '198.51.100.77';
  for (let i = 0; i < 3; i += 1) assert.equal(await hit(limiter, { ip: '198.51.100.' + (10 + i), userId: 'owner-a' }), 200);
  assert.equal(await hit(limiter, { ip: '198.51.100.99', userId: 'owner-a' }), 429, 'rotating IPs does not reset an owner budget');
  for (let i = 0; i < 3; i += 1) assert.equal(await hit(limiter, { ip: sharedIp, userId: 'owner-b' }), 200);
  assert.equal(await hit(limiter, { ip: sharedIp, userId: 'owner-c' }), 200, 'another owner behind the same NAT is unaffected');
  // Without an authenticated user the key falls back to the IP (never a shared global bucket).
  const anon = rateLimiter({ max: 1, windowMs: 3600000, isSensitive: true, bucket: 'r6-account-probe-anon', keyBy: 'account' });
  assert.equal(await hit(anon, { ip: '198.51.100.1' }), 200);
  assert.equal(await hit(anon, { ip: '198.51.100.1' }), 429);
  assert.equal(await hit(anon, { ip: '198.51.100.2' }), 200);
  assert.throws(() => rateLimiter({ max: 1, windowMs: 1000, keyBy: 'route' }), /INVALID_RATE_LIMIT_KEY/);
  assert.equal(limiter.name, 'rateLimit:sensitive:3:3600000:r6-account-probe:account');
});

test('#8a wiring: every dealer workspace write route mounts an account-keyed limiter after session auth', () => {
  const expected = {
    '/api/dealer/operational-media': 'dealer-owner-upload-write',
    '/api/dealer/documents': 'dealer-owner-upload-write',
    '/api/dealer/staff-invitations': 'dealer-owner-staff-write',
    '/api/dealer/staff-invitations/:id/accept': 'dealer-owner-staff-write',
    '/api/dealer/staff-invitations/:id/revoke': 'dealer-owner-staff-write',
    '/api/dealer/staff-branch-scopes': 'dealer-owner-staff-write',
    '/api/dealer/staff-branch-scopes/:id/revoke': 'dealer-owner-staff-write',
  };
  let checked = 0;
  for (const layer of dealerRouter.stack) {
    const route = layer.route;
    if (!route || !route.path.startsWith('/api/dealer/')) continue;
    const methods = Object.keys(route.methods);
    if (!methods.some((m) => ['post', 'patch', 'put', 'delete'].includes(m))) continue;
    const names = route.stack.map((s) => s.handle.name || '');
    const idx = names.findIndex((n) => n.startsWith('rateLimit:'));
    assert.ok(idx > 0, `${methods} ${route.path} must have a limiter after authentication (${names})`);
    assert.match(names[idx], /:account$/, route.path + ' limiter is account-keyed');
    assert.ok(names[idx].includes(':' + (expected[route.path] || 'dealer-owner-workspace-write') + ':'), route.path + ' ' + names[idx]);
    assert.ok(idx < names.length - 1, route.path + ' limiter runs before the handler');
    checked += 1;
  }
  assert.equal(checked, 17);
  const queue = researchRouter.stack.find((l) => l.route?.path === '/api/admin/dealership/storefront-media/queue');
  const qNames = queue.route.stack.map((s) => s.handle.name || '');
  assert.ok(qNames.findIndex((n) => n.includes(':dealer-media-review-queue:account')) > 0);
  const image = researchRouter.stack.find((l) => l.route?.path === '/api/dealership/research/:seedId/media/:mediaKey');
  assert.ok(image.route.stack.some((s) => s.handle.name === 'rateLimit:global:60:60000:dealer-public-media-image:ip'));
});
