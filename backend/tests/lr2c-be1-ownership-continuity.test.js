import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveMyVehiclesScope,
  applyMyVehiclesScope,
  isLegalOwnerBySession,
} from '../services/ownership/ownedVehicleAccessService.js';

const session = (overrides = {}) => ({
  id: 'account-a',
  userId: 'account-a',
  role: 'buyer',
  effectiveRole: 'buyer',
  baseRole: 'buyer',
  platformRole: 'buyer',
  authenticationMethod: 'session',
  ...overrides,
});

function queryRecorder() {
  const calls = [];
  const query = {
    eq(column, value) { calls.push(['eq', column, value]); return query; },
    or(expression) { calls.push(['or', expression]); return query; },
  };
  return { query, calls };
}

test('BE1 legal owner: buyer role is authorized by exact session owner_id relationship', () => {
  const scope = resolveMyVehiclesScope(session());
  assert.equal(scope.userId, 'account-a');
  assert.equal(scope.preserveSellerWorkspace, false);

  const recorder = queryRecorder();
  applyMyVehiclesScope(recorder.query, session());
  assert.deepEqual(recorder.calls, [['eq', 'owner_id', 'account-a']]);
  assert.equal(isLegalOwnerBySession({ owner_id: 'account-a', current_seller_id: null }, session()), true);
});

test('BE1 legal owner: Account A cannot read Account B ownership by relationship', () => {
  assert.equal(isLegalOwnerBySession({ owner_id: 'account-b', current_seller_id: null }, session()), false);
});

test('BE1 legal owner: current seller relationship is not legal ownership', () => {
  assert.equal(isLegalOwnerBySession({ owner_id: 'account-b', current_seller_id: 'account-a' }, session()), false);
  const recorder = queryRecorder();
  applyMyVehiclesScope(recorder.query, session());
  assert.deepEqual(recorder.calls, [['eq', 'owner_id', 'account-a']]);
});

test('BE1 legal owner: x-user-id fallback cannot authorize consequential ownership access', () => {
  assert.throws(
    () => resolveMyVehiclesScope(session({ authenticationMethod: 'x-user-id-fallback' })),
    /real session identity/i,
  );
});

test('BE1 legal owner: no account-role escalation is required for ownership fact', () => {
  const buyer = session({ role: 'buyer', platformRole: 'buyer' });
  assert.equal(isLegalOwnerBySession({ owner_id: 'account-a' }, buyer), true);
  assert.equal(buyer.role, 'buyer');
});

test('BE1 compatibility: existing owner/dealer workspace may still include current-seller relationship', () => {
  const recorder = queryRecorder();
  applyMyVehiclesScope(recorder.query, session({ role: 'owner', effectiveRole: 'owner', baseRole: 'owner', platformRole: 'owner' }));
  assert.deepEqual(recorder.calls, [['or', 'owner_id.eq.account-a,current_seller_id.eq.account-a']]);
});

test('BE1 server route uses session-only auth and server-derived user identity', () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.get('/api/vehicles/me'");
  const end = source.indexOf("// GET /api/vehicles/saved", start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /authorizeSessionRole\(\[\]\)/);
  assert.match(route, /applyMyVehiclesScope\(vehicleQuery, req\.userContext\)/);
  assert.doesNotMatch(route, /req\.body[^\n]*owner/i);
  assert.doesNotMatch(route, /req\.query[^\n]*owner/i);
  assert.doesNotMatch(route, /req\.headers\[['\"]x-user-id['\"]\]/i);
});

test('BE1 Dependency A: accepted schema has no durable transaction-intent field on ownership transfer', () => {
  const ownershipMigration = readFileSync(
    new URL('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql', import.meta.url),
    'utf8',
  );
  const createStart = ownershipMigration.indexOf('CREATE TABLE IF NOT EXISTS public.vehicle_ownership_transfers');
  const createEnd = ownershipMigration.indexOf(');', createStart);
  const tableDefinition = ownershipMigration.slice(createStart, createEnd + 2);
  assert.doesNotMatch(tableDefinition, /transaction_intent_id/i);

  const beginStart = ownershipMigration.indexOf('CREATE OR REPLACE FUNCTION public.passport_begin_ownership_transfer_atomic');
  const beginEnd = ownershipMigration.indexOf('RETURNS public.vehicle_ownership_transfers', beginStart);
  const signature = ownershipMigration.slice(beginStart, beginEnd);
  assert.doesNotMatch(signature, /transaction_intent/i);
});

test('BE1 Dependency A: transfer domain event carries transfer/VIN but no transaction-intent lineage', () => {
  const ownershipMigration = readFileSync(
    new URL('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql', import.meta.url),
    'utf8',
  );
  const eventStart = ownershipMigration.indexOf("'vehicle.ownership.transfer_started'");
  const eventEnd = ownershipMigration.indexOf('RETURN v_created', eventStart);
  const eventBlock = ownershipMigration.slice(eventStart, eventEnd);
  assert.match(eventBlock, /'transferId',v_created\.id/);
  assert.match(eventBlock, /'vin',p_vin/);
  assert.doesNotMatch(eventBlock, /transaction_intent/i);
});

test('BE1 governance: completion and registry authority remain unchanged', () => {
  const service = readFileSync(new URL('../services/passport/passportOwnershipTransferService.js', import.meta.url), 'utf8');
  assert.match(service, /toState === 'complete' && !GOVERNANCE_ROLES\.has\(identity\.role\)/);
  assert.match(service, /Completion requires registryAuthority and completionReference/);
  assert.match(service, /passport_transition_ownership_transfer_atomic/);
});
