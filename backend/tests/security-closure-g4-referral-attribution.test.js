/**
 * Security closure — G4: referral attribution forgery on the routes G1 missed.
 *
 * G1 closed `POST /api/referrals/events`, where any caller could insert an
 * arbitrary event against any tenant attributed to any user. The I14 audit found
 * the SAME forgery still open on four other referral routes, none of which has any
 * authentication gate:
 *
 *   POST /api/referrals/validate
 *   GET  /api/referrals/codes/:code
 *   POST /api/referrals/local-marketplace/intent
 *   POST /api/referrals/local-marketplace/leads
 *
 * All four build their actor with `buildActorContext`, which falls back to the
 * `x-user-id`, `x-stakeholder-role`, `x-tenant-id` and `x-actor-type` headers. That
 * builder's own doc comment says it "is a forgery channel on any public route".
 *
 * The consequence is not theoretical. `referral.code_validated` is the single
 * largest referral event type on staging, and validation events are the base of
 * every referral performance figure. A caller who can author them with a chosen
 * actor, actor type and tenant can manufacture referral activity for anybody —
 * which is precisely what I14's fraud-safe attribution requirement forbids.
 *
 * These tests assert the PROPERTY: an unauthenticated caller must not be able to
 * choose the actor, the actor type or the tenant recorded against an event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { ReferralEngineService, buildVerifiedActorContext } from '../services/referral/referralEngineService.js';
import { ACTOR_TYPES } from '../constants/referral/referralConstants.js';

const VICTIM_TENANT = 'tenant-victim';
const CODE_TENANT = 'tenant-owner-of-code';

function createService({ code = { id: 'code-1', code: 'SAVE10', tenant_id: CODE_TENANT, campaign_id: 'camp-1', status: 'ACTIVE' } } = {}) {
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
    async update(table, id, payload) { return { id, ...payload }; },
    async list() { return { rows: [] }; },
  };
  return { service: new ReferralEngineService({ repository }), inserted };
}

/** A hostile request: every forgeable header set, no real session. */
const forgedRequest = {
  headers: {
    'x-user-id': 'victim-user',
    'x-stakeholder-role': 'admin',
    'x-tenant-id': VICTIM_TENANT,
    'x-actor-type': 'admin',
  },
};

const eventsOf = (inserted) => inserted.filter((row) => row.table === 'referral_events').map((row) => row.payload);

// ── The property, stated directly ──────────────────────────────────────────

test('G4: an unauthenticated validate cannot choose the actor, actor type or tenant', async () => {
  const { service, inserted } = createService();

  // This is what the public route must hand the service: an actor derived from a
  // verified session, or anonymous. Never the headers.
  const actor = buildVerifiedActorContext(forgedRequest);
  await service.validateReferralCode({ code: 'SAVE10', channel: 'web' }, actor);

  const events = eventsOf(inserted);
  assert.ok(events.length > 0, 'a validation must still be recorded');
  for (const event of events) {
    assert.equal(event.actor_type, ACTOR_TYPES.USER, 'a caller may not claim a privileged actor type');
    assert.equal(event.actor_user_id, null, 'an unauthenticated caller is attributed to nobody');
    assert.notEqual(event.tenant_id, VICTIM_TENANT, 'a caller may not write into a tenant they named');
    assert.equal(event.tenant_id, CODE_TENANT, 'the tenant comes from the referral code row');
  }
});

test('G4: the verified builder ignores every forgeable header', () => {
  const actor = buildVerifiedActorContext(forgedRequest);
  assert.equal(actor.actor_user_id, null);
  assert.equal(actor.actor_role, null);
  assert.equal(actor.actor_tenant_id, null);
  assert.equal(actor.actor_type, ACTOR_TYPES.USER);
});

test('G4: an identity from the spoofable x-user-id fallback is not treated as proven', () => {
  const actor = buildVerifiedActorContext({
    headers: {},
    userContext: { id: 'claimed-user', role: 'admin', tenantId: VICTIM_TENANT, identityAsserted: true },
  });
  assert.equal(actor.actor_user_id, null, 'an asserted identity is not a proven one');
  assert.equal(actor.actor_tenant_id, null);
  assert.equal(actor.actor_type, ACTOR_TYPES.USER);
});

test('G4: a genuinely verified session IS attributed', async () => {
  const { service, inserted } = createService();
  const actor = buildVerifiedActorContext({
    headers: {},
    userContext: { id: 'real-user', role: 'owner', tenantId: 'tenant-real' },
  });
  await service.validateReferralCode({ code: 'SAVE10', channel: 'web' }, actor);

  const events = eventsOf(inserted);
  assert.ok(events.every((e) => e.actor_user_id === 'real-user'));
  // Even here the tenant is the code's, not the caller's: a signed-in visitor
  // validating somebody else's code does not move that code into their tenant.
  assert.ok(events.every((e) => e.tenant_id === CODE_TENANT));
});

test('G4: the tenant on a validation event is the code row, not any input', async () => {
  const { service, inserted } = createService();
  await service.validateReferralCode(
    // A caller-supplied tenant in the body must not win either.
    { code: 'SAVE10', channel: 'web', tenant_id: VICTIM_TENANT },
    buildVerifiedActorContext(forgedRequest),
  );
  for (const event of eventsOf(inserted)) {
    assert.equal(event.tenant_id, CODE_TENANT);
  }
});

// ── The routes themselves must use the verified builder ────────────────────

test('G4: no ungated referral route builds its actor from headers', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(dir, '../routes/referralRoutes.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // `createActor` is the header-reading builder. Every route that still uses it
  // must sit behind a gate that proves the caller first.
  for (const route of ["'/validate'", "'/codes/:code'", "'/local-marketplace/intent'", "'/local-marketplace/leads'"]) {
    const idx = code.indexOf(`router.post(${route}`) >= 0
      ? code.indexOf(`router.post(${route}`)
      : code.indexOf(`router.get(${route}`);
    assert.ok(idx >= 0, `route ${route} not found`);
    const block = code.slice(idx, idx + 600);
    assert.ok(
      !block.includes('createActor('),
      `${route} is ungated and must not build its actor from headers`,
    );
  }
});
