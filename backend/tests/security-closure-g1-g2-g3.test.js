/**
 * Security closure — G1, G2, G3.
 *
 * Three pre-existing holes found during the CarUp Intelligence I0 audit. Each was
 * a way for a caller to author or read state that was not theirs:
 *
 *   G1 (P0) — POST /api/referrals/events was unauthenticated AND unconstrained:
 *             any caller could insert an arbitrary event_type against any tenant,
 *             attribute it to any user, and backdate it. That made the entire
 *             referral/attribution ledger forgeable.
 *   G2 (P1) — GET /api/organizations/:id/users had no auth at all and returned
 *             every staff member's name, email and avatar for any organization id.
 *   G3 (P1) — referral operator routes preferred a caller-supplied tenant_id over
 *             the verified one, behind a role list that includes plain `dealer`.
 *
 * These tests are written against the PROPERTIES, not the wording: a caller must
 * not be able to forge actor/tenant/attribution, read another organization, or
 * widen tenant scope with a query parameter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  ReferralEngineService,
  buildVerifiedActorContext,
  PUBLIC_REFERRAL_EVENT_TYPES,
} from '../services/referral/referralEngineService.js';
import { REFERRAL_EVENT_TYPES, ACTOR_TYPES } from '../constants/referral/referralConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// ── Test double: records exactly what would be persisted ───────────────────

const VICTIM_TENANT = 'tenant-victim';
const CODE_TENANT = 'tenant-owner-of-code';

function createService({ code = { id: 'code-1', code: 'SAVE10', tenant_id: CODE_TENANT, campaign_id: 'camp-1' } } = {}) {
  const inserted = [];
  const repository = {
    async findOne(table, filters) {
      if (table === 'referral_events') return null;
      if (!code) return null;
      return String(filters?.code || '').toUpperCase() === String(code.code).toUpperCase() ? code : null;
    },
    async insert(table, payload) {
      inserted.push({ table, payload });
      return { id: 'evt-1', ...payload };
    },
    async list() { return { rows: [] }; },
  };
  const service = new ReferralEngineService({ repository });
  return { service, inserted };
}

/** A hostile request: every forgeable header set, no real session. */
const forgedRequest = {
  headers: {
    'x-user-id': 'victim-user',
    'x-stakeholder-role': 'admin',
    'x-tenant-id': VICTIM_TENANT,
    'x-actor-type': 'system',
  },
};

// ── G1: the actor context a public path may trust ──────────────────────────

test('G1: a verified actor context ignores every forgeable header', () => {
  const actor = buildVerifiedActorContext(forgedRequest);
  assert.equal(actor.actor_user_id, null, 'x-user-id must not become an actor');
  assert.equal(actor.actor_role, null, 'x-stakeholder-role must not become a role');
  assert.equal(actor.actor_tenant_id, null, 'x-tenant-id must not become a tenant');
  // `system` would falsely claim CarUp generated the event; an unidentified human
  // is a `user` with no id, which is what the header claim must NOT be able to change.
  assert.equal(actor.actor_type, ACTOR_TYPES.USER,
    'x-actor-type must not decide the actor type');
});

test('G1: a real session is honoured; an ASSERTED identity is not', () => {
  const proven = buildVerifiedActorContext({ headers: {}, userContext: { id: 'real-user', tenantId: 'tenant-real' } });
  assert.equal(proven.actor_user_id, 'real-user');
  assert.equal(proven.actor_tenant_id, 'tenant-real');

  // identityAsserted marks the spoofable x-user-id fallback.
  const asserted = buildVerifiedActorContext({
    headers: {}, userContext: { id: 'victim-user', identityAsserted: true },
  });
  assert.equal(asserted.actor_user_id, null);
});

// ── G1: only a small public vocabulary is reportable ───────────────────────

test('G1: the public allowlist covers link/QR/barcode and nothing consequential', () => {
  assert.deepEqual([...PUBLIC_REFERRAL_EVENT_TYPES].sort(), [
    REFERRAL_EVENT_TYPES.BARCODE_SCANNED,
    REFERRAL_EVENT_TYPES.LINK_OPENED,
    REFERRAL_EVENT_TYPES.QR_SCANNED,
  ].sort());
  // Nothing that asserts a business outcome, a reward, or another party's state.
  for (const forbidden of [
    REFERRAL_EVENT_TYPES.WALLET_TRANSACTION_CREATED,
    REFERRAL_EVENT_TYPES.COUPON_REDEEMED,
    REFERRAL_EVENT_TYPES.CAMPAIGN_CREATED,
  ]) {
    assert.ok(!PUBLIC_REFERRAL_EVENT_TYPES.has(forbidden), `${forbidden} must not be publicly reportable`);
  }
});

test('G1: a privileged event type is refused from a public caller', async () => {
  const { service, inserted } = createService();
  await assert.rejects(
    () => service.recordPublicReferralEvent(
      { event_type: REFERRAL_EVENT_TYPES.WALLET_TRANSACTION_CREATED, code: 'SAVE10' },
      forgedRequest,
    ),
    (error) => /not publicly reportable/.test(error.message),
  );
  assert.equal(inserted.length, 0, 'nothing may be written for a refused type');
});

test('G1: an arbitrary made-up event type is refused', async () => {
  const { service, inserted } = createService();
  await assert.rejects(
    () => service.recordPublicReferralEvent({ event_type: 'referral.i_won_a_reward', code: 'SAVE10' }, {}),
  );
  assert.equal(inserted.length, 0);
});

// ── G1: tenant and attribution are server-derived ──────────────────────────

test('G1: tenant comes from the referral CODE, never from the caller', async () => {
  const { service, inserted } = createService();
  await service.recordPublicReferralEvent({
    event_type: REFERRAL_EVENT_TYPES.LINK_OPENED,
    code: 'SAVE10',
    // Every one of these is a hostile claim.
    tenant_id: VICTIM_TENANT,
    code_id: 'code-someone-elses',
    campaign_id: 'campaign-someone-elses',
    actor_user_id: 'victim-user',
    actor_type: 'system',
  }, forgedRequest);

  assert.equal(inserted.length, 1);
  const { payload } = inserted[0];
  assert.equal(payload.tenant_id, CODE_TENANT, 'the code owns the tenant');
  assert.notEqual(payload.tenant_id, VICTIM_TENANT);
  assert.equal(payload.code_id, 'code-1', 'code_id is the looked-up row, not the claim');
  assert.equal(payload.campaign_id, 'camp-1');
  assert.equal(payload.actor_user_id, null, 'an anonymous caller stays anonymous');
});

test('G1: a caller cannot backdate its own activity', async () => {
  const { service, inserted } = createService();
  const before = new Date().toISOString();
  await service.recordPublicReferralEvent({
    event_type: REFERRAL_EVENT_TYPES.QR_SCANNED,
    code: 'SAVE10',
    occurred_at: '2020-01-01T00:00:00.000Z',
  }, {});
  const { payload } = inserted[0];
  assert.ok(payload.occurred_at >= before, 'occurred_at is the server clock');
  assert.notEqual(payload.occurred_at, '2020-01-01T00:00:00.000Z');
});

test('G1: an unknown referral code produces no event at all', async () => {
  const { service, inserted } = createService();
  await assert.rejects(
    () => service.recordPublicReferralEvent({ event_type: REFERRAL_EVENT_TYPES.LINK_OPENED, code: 'NOSUCHCODE' }, {}),
  );
  assert.equal(inserted.length, 0, 'with no code there is no tenant to attribute to');
});

test('G1: a missing code is refused rather than defaulted to the platform tenant', async () => {
  const { service, inserted } = createService();
  await assert.rejects(() => service.recordPublicReferralEvent({ event_type: REFERRAL_EVENT_TYPES.LINK_OPENED }, {}));
  assert.equal(inserted.length, 0);
});

test('G1: a verified session IS attributed, and to the real user', async () => {
  const { service, inserted } = createService();
  await service.recordPublicReferralEvent(
    { event_type: REFERRAL_EVENT_TYPES.LINK_OPENED, code: 'SAVE10', actor_user_id: 'victim-user' },
    { headers: {}, userContext: { id: 'genuine-user' } },
  );
  const { payload } = inserted[0];
  assert.equal(payload.actor_user_id, 'genuine-user');
  assert.equal(payload.actor_type, ACTOR_TYPES.USER);
});

test('G1: public metadata is bounded, so the ledger is not a free-text channel', async () => {
  const { service, inserted } = createService();
  await service.recordPublicReferralEvent({
    event_type: REFERRAL_EVENT_TYPES.LINK_OPENED,
    code: 'SAVE10',
    metadata: {
      surface: 'listing_card',
      note: 'alice@example.com +263771234567',
      injected: { nested: 'payload' },
    },
  }, {});
  const { payload } = inserted[0];
  assert.deepEqual(payload.metadata, { surface: 'listing_card' });
  assert.ok(!JSON.stringify(payload.metadata).includes('@'), 'no contact detail may reach the ledger');
});

test('G1: an out-of-vocabulary channel falls back rather than being stored', async () => {
  const { service, inserted } = createService();
  await service.recordPublicReferralEvent({
    event_type: REFERRAL_EVENT_TYPES.LINK_OPENED, code: 'SAVE10', channel: 'privileged_internal',
  }, {});
  assert.notEqual(inserted[0].payload.channel, 'privileged_internal');
});

test('G1: the route is rate-limited and no longer takes an unconstrained body', () => {
  const src = read('backend/routes/referralRoutes.js');
  const block = src.split("router.post('/events'")[1].split('}));')[0];
  assert.match(block, /referralPublicEventLimiter/, 'a public write path must be bounded per IP');
  assert.match(block, /optionalAuth\(\)/);
  assert.match(block, /recordPublicReferralEvent\(req\.body, req\)/);
  assert.ok(!block.includes("x-actor-type"), 'the actor type header must no longer reach the ledger');
  assert.ok(!block.includes('recordReferralEvent('), 'the unconstrained writer must not be reachable publicly');
});

// ── G2: organization staff are not a public directory ──────────────────────

test('G2: the staff route requires authentication', () => {
  const src = read('backend/server.js');
  const block = src.split("app.get('/api/organizations/:id/users'")[1].split('});')[0];
  assert.match(block, /authorizeRole\(\)/, 'the route had NO auth middleware at all');
});

test('G2: the staff route proves organization membership', () => {
  const src = read('backend/server.js');
  const block = src.split("app.get('/api/organizations/:id/users'")[1].split('});')[0];
  assert.match(block, /assertOrganizationMembership\(req, id\)/);
});

test('G2: membership means platform admin OR verified tenant membership', () => {
  const src = read('backend/server.js');
  const helper = src.split('async function assertOrganizationMembership')[1].split('\n}')[0];
  assert.match(helper, /platform_admin/);
  assert.match(helper, /tenant_users/);
  assert.match(helper, /You do not belong to this organization/);
});

test('G2: the staff projection no longer publishes email addresses', () => {
  const src = read('backend/server.js');
  const block = src.split("app.get('/api/organizations/:id/users'")[1].split('});')[0];
  assert.match(block, /users!inner\(name, avatar\)/);
  assert.ok(!/users!inner\([^)]*email/.test(block), 'staff email must not be returned');
  assert.ok(!/\.select\(`?\s*\*/.test(block), 'a star select would re-publish whatever the table gains next');
});

test('G2: the sibling branches route is closed the same way', () => {
  const src = read('backend/server.js');
  const block = src.split("app.get('/api/organizations/:id/branches'")[1].split('});')[0];
  assert.match(block, /authorizeRole\(\)/);
  assert.match(block, /assertOrganizationMembership\(req, id\)/);
});

// ── G3: a query parameter can never widen tenant access ────────────────────

test('G3: no referral route still prefers a caller-supplied tenant', () => {
  const src = read('backend/routes/referralRoutes.js');
  assert.ok(!src.includes('req.query.tenant_id || req.userContext'),
    'the caller-first tenant pattern must be gone everywhere');
});

test('G3: every operator listing resolves its tenant server-side', () => {
  const src = read('backend/routes/referralRoutes.js');
  // Seven widening sites were found by the audit; all must now go through one rule.
  const uses = (src.match(/resolveOperatorTenantScope\(req\)/g) || []).length;
  assert.ok(uses >= 7, `expected every widening site to use the resolver, found ${uses}`);
});

test('G3: a non-admin operator with no verified tenant is REFUSED, not given every tenant', () => {
  const src = read('backend/routes/referralRoutes.js');
  const fn = src.split('function resolveOperatorTenantScope')[1].split('\n}')[0];
  assert.match(fn, /isPlatformAdmin/);
  assert.match(fn, /ForbiddenError/,
    'falling through to undefined removed the filter and returned every tenant to a plain dealer');
  // The non-admin path begins after the admin block closes; it must never touch
  // the query string.
  const nonAdminBranch = fn.split('const verified = ctx.tenantId')[1];
  assert.ok(!nonAdminBranch.includes('req.query'),
    'a query parameter must not be read at all on the non-admin path');
});

test('G3: a platform admin may narrow with tenant_id but a dealer cannot', () => {
  const src = read('backend/routes/referralRoutes.js');
  const fn = src.split('function resolveOperatorTenantScope')[1].split('\n}')[0];
  // Admin path reads the query (to NARROW); the non-admin path returns the verified tenant.
  assert.match(fn, /if \(isPlatformAdmin\(ctx\)\)[\s\S]*req\.query\?\.tenant_id/);
  assert.match(fn, /const verified = ctx\.tenantId/);
  assert.match(fn, /return verified;/);
});

test('G3: a non-admin cannot read another user\'s disputes by naming them', () => {
  const src = read('backend/routes/referralRoutes.js');
  const block = src.split("router.get('/trust/disputes'")[1].split('}));')[0];
  assert.match(block, /isPlatformAdmin\(req\.userContext \|\| \{\}\)/);
  assert.match(block, /req\.userContext\?\.id/);
});

test('G3: OPERATOR_ROLES still includes non-platform roles, so the boundary must hold in code', () => {
  const src = read('backend/routes/referralRoutes.js');
  const line = src.split('const OPERATOR_ROLES')[1].split(';')[0];
  // This is the reason the fix matters: the gate itself is deliberately broad.
  assert.match(line, /'dealer'/);
});
