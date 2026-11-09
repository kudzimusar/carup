/**
 * Service Network S8 — Service Link and scoped capability contracts.
 *
 * The security claim being tested is that a scan grants NOTHING. Resolution returns a
 * role-safe context; authorization happens afterwards against the authenticated user
 * (plan §20: Scan → Resolve → Authenticate → Authorize → Act → Record). A permanent
 * QR sticker must therefore be safe to photograph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  hashCapabilityToken,
  ensureServiceLink,
  grantCapability,
  redeemCapability,
  resolveServiceLink,
  revokeCapability,
} from '../services/serviceNetwork/serviceLinkService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINLINK00001';
const CASE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const owner = { id: 'u-owner', role: 'owner' };
const stranger = { id: 'u-stranger', role: 'owner' };
const garageA = { id: 'u-garage-a', role: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-garage-b', role: 'mechanic', tenantId: TENANT_B };

function seedClient(over = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }],
    tenants: [{ id: TENANT_A, type: 'garage' }, { id: TENANT_B, type: 'garage' }],
    tenant_users: [{ tenant_id: TENANT_A, user_id: 'u-mech-1', role: 'mechanic' }],
    garage_public_profiles: [
      { tenant_id: TENANT_A, display_name: 'Harare Motors', slug: 'harare-motors', publication_status: 'published' },
    ],
    service_cases: [{ id: CASE_ID, vin: VIN, requester_user_id: 'u-owner', garage_tenant_id: TENANT_A, status: 'accepted' }],
    service_links: [],
    service_capability_grants: [],
    ...over,
  });
}

async function vehicleLink(client) {
  const { link } = await ensureServiceLink(client, owner, { resource_type: 'vehicle', resource_id: VIN });
  return link;
}

test('a permanent link is opaque and carries no private payload', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  assert.ok(link.public_token.length >= 16);
  assert.equal(link.public_token.includes(VIN), false, 'the VIN must never be the token');
  assert.equal(Object.hasOwn(link, 'resource_id'), false, 'the resource id is not part of the public link view');
  assert.equal(JSON.stringify(link).includes('u-owner'), false, 'no owner identity in the link');
});

test('links are stable — the same resource resolves to one link', async () => {
  const client = seedClient();
  const first = await ensureServiceLink(client, owner, { resource_type: 'vehicle', resource_id: VIN });
  const second = await ensureServiceLink(client, owner, { resource_type: 'vehicle', resource_id: VIN });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.link.public_token, first.link.public_token);
  assert.equal(client._tables.service_links.length, 1);
});

test('scanning while unauthenticated grants nothing but a sign-in path', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  const resolved = await resolveServiceLink(client, {}, link.public_token);

  assert.equal(resolved.access, 'authentication_required');
  assert.equal(resolved.authenticated, false);
  assert.equal(resolved.vin, undefined, 'no VIN is disclosed to an unauthenticated scanner');
  assert.equal(JSON.stringify(resolved).includes(VIN), false);
  assert.equal(JSON.stringify(resolved).includes('u-owner'), false);
});

test('a stranger who scans a windscreen sticker learns only that it is a vehicle', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  const resolved = await resolveServiceLink(client, stranger, link.public_token);

  assert.equal(resolved.access, 'limited');
  assert.equal(resolved.vin, null, 'the VIN is disclosed only to the owner');
  assert.equal(resolved.next_action, 'request_service');
  assert.equal(JSON.stringify(resolved).includes('u-owner'), false, 'no owner identity leaks');
});

test('the owner resolving their own vehicle gets the owner context', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  const resolved = await resolveServiceLink(client, owner, link.public_token);
  assert.equal(resolved.access, 'owner');
  assert.equal(resolved.vin, VIN);
  assert.equal(resolved.next_action, 'open_vehicle');
});

test('a scan carries qr source attribution onward (§20.4)', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  const resolved = await resolveServiceLink(client, owner, link.public_token);
  assert.equal(resolved.source_channel, 'qr');
});

test('a service case link tells a non-participant nothing — not even its status', async () => {
  const client = seedClient();
  const { link } = await ensureServiceLink(client, owner, { resource_type: 'service_case', resource_id: CASE_ID });

  const outsider = await resolveServiceLink(client, garageB, link.public_token);
  assert.equal(outsider.access, 'not_a_participant');
  assert.equal(outsider.status, undefined, 'case status is not disclosed to a non-participant');
  assert.equal(outsider.service_case_id, undefined);

  const participant = await resolveServiceLink(client, garageA, link.public_token);
  assert.equal(participant.access, 'participant');
  assert.equal(participant.status, 'accepted');
});

test('a practitioner link exposes governed facts only — activity is not quality (§20.3)', async () => {
  const client = seedClient();
  const { link } = await ensureServiceLink(client, garageA, { resource_type: 'practitioner', resource_id: 'u-mech-1' });
  const resolved = await resolveServiceLink(client, owner, link.public_token);

  assert.equal(resolved.access, 'public_practitioner');
  assert.equal(resolved.practitioner.affiliation.display_name, 'Harare Motors');
  assert.equal(resolved.practitioner.credential_review_state, 'not_reviewed',
    'Foundation ships no credential workflow, so nothing is claimed reviewed');
  const serialized = JSON.stringify(resolved);
  assert.equal(/rating|score|stars|quality/i.test(serialized), false, 'activity must never be presented as quality');
});

test('a revoked or unknown link is indistinguishable — the resolver is not an oracle', async () => {
  const client = seedClient();
  const link = await vehicleLink(client);
  client._tables.service_links[0].is_active = false;

  await assert.rejects(() => resolveServiceLink(client, owner, link.public_token), /not valid/);
  await assert.rejects(() => resolveServiceLink(client, owner, 'totally-made-up-token'), /not valid/);
});

test('only the resource authority may grant a capability (§21)', async () => {
  const client = seedClient();
  await assert.rejects(
    () => grantCapability(client, garageA, { purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN }),
    /Only the vehicle owner/,
    'a garage cannot grant itself access',
  );
  await assert.rejects(
    () => grantCapability(client, garageA, { purpose: 'service_case_participation', resource_type: 'service_case', resource_id: CASE_ID }),
    /Only the requester/,
  );
});

test('a capability secret is returned once and only its hash is persisted', async () => {
  const client = seedClient();
  const { token, grant } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  assert.ok(token.length >= 32);
  const stored = client._tables.service_capability_grants[0];
  assert.equal(stored.token_hash, hashCapabilityToken(token));
  assert.equal(JSON.stringify(stored).includes(token), false, 'the raw secret must never be persisted');
  assert.equal(Object.hasOwn(grant, 'token_hash'), false, 'the hash is not returned to the caller either');
  assert.ok(grant.expires_at, 'a capability always expires');
});

test('redemption is atomic and replay-safe', async () => {
  const client = seedClient();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_case_participation', resource_type: 'service_case', resource_id: CASE_ID,
  });
  const first = await redeemCapability(client, garageA, token);
  assert.equal(first.grant.resource_id, CASE_ID);
  await assert.rejects(() => redeemCapability(client, garageA, token), /not valid/, 'a replay must fail');
});

test('an expired capability cannot be redeemed', async () => {
  const client = seedClient();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  client._tables.service_capability_grants[0].expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(() => redeemCapability(client, garageA, token), /not valid/);
});

test('revocation is immediate and blocks redemption', async () => {
  const client = seedClient();
  const { token, grant } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await revokeCapability(client, owner, grant.id);
  await assert.rejects(() => redeemCapability(client, garageA, token), /not valid/);
});

test('only the granter may revoke their grant', async () => {
  const client = seedClient();
  const { grant } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await assert.rejects(() => revokeCapability(client, garageA, grant.id), /not found/i);
});

test('a forged token cannot be redeemed', async () => {
  const client = seedClient();
  await grantCapability(client, owner, { purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN });
  await assert.rejects(() => redeemCapability(client, garageA, 'forged-token-value'), /not valid/);
  // Nor can the stored hash be replayed as if it were the bearer secret.
  const stored = client._tables.service_capability_grants[0];
  await assert.rejects(() => redeemCapability(client, garageA, stored.token_hash), /not valid/);
});

test('capability purposes and resource types are closed vocabularies', async () => {
  const client = seedClient();
  await assert.rejects(
    () => grantCapability(client, owner, { purpose: 'do_anything', resource_type: 'vehicle', resource_id: VIN }),
    /purpose must be one of/,
  );
  await assert.rejects(
    () => grantCapability(client, owner, { purpose: 'service_context_read', resource_type: 'bank_account', resource_id: VIN }),
    /resource_type must be vehicle or service_case/,
  );
  await assert.rejects(
    () => ensureServiceLink(client, owner, { resource_type: 'insurance_policy', resource_id: 'x' }),
    /resource_type must be one of/,
  );
});
