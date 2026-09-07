/**
 * Service Network S3 — Marketplace and Communications convergence contracts.
 *
 * Proves the seams stay consume-only and truthful:
 *   - the marketplace bridge opens a Service Case from a garage_service_request
 *     WITHOUT rewriting inquiry status (a lead pipeline is not a case lifecycle)
 *     and without overloading seller semantics for routing;
 *   - routing is governed, not guessed: an inquiry with no target garage is refused;
 *   - replay is idempotent — the same inquiry returns the same case;
 *   - conversation binding uses the EXISTING canonical workflow service (no second
 *     messages table, Invariant 6) and is idempotent;
 *   - a Communications failure returns a recoverable receipt and never erases or
 *     rolls back the authoritative Service Case (plan §15.5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  SERVICE_CASE_SUBJECT_TYPE,
  SERVICE_CASE_WORKFLOW,
  bindServiceCaseConversation,
  bridgeInquiryToServiceCase,
} from '../services/serviceNetwork/serviceCaseBridgeService.js';
import { requestServiceCase } from '../services/serviceNetwork/serviceCaseService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const VIN = 'VINCASE0001';
const owner = { id: 'u-owner', role: 'owner' };
const operator = { id: 'u-operator', role: 'admin' };
const noEmit = { emitDomainEvent: async () => ({ id: 'evt' }) };

function seedClient(inquiries = [], extra = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }],
    tenants: [{ id: TENANT_A, name: 'Harare Motors', type: 'garage', status: 'active' }],
    garage_public_profiles: [
      { tenant_id: TENANT_A, slug: 'harare-motors', display_name: 'Harare Motors', publication_status: 'published' },
    ],
    marketplace_inquiries: inquiries,
    service_cases: [],
    service_case_events: [],
    ...extra,
  });
}

const serviceInquiry = (over = {}) => ({
  id: 'inq-1',
  listing_id: VIN,
  listing_type: 'vehicle',
  buyer_id: 'u-owner',
  seller_id: null,
  seller_tenant_id: null,
  inquiry_type: 'garage_service_request',
  message: 'Brakes grinding',
  source_channel: 'qr',
  status: 'new',
  target_provider_tenant_id: TENANT_A,
  metadata: {},
  ...over,
});

test('a garage_service_request inquiry opens a Service Case routed to the target garage', async () => {
  const client = seedClient([serviceInquiry()]);
  const result = await bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit);

  assert.equal(result.created, true);
  assert.equal(result.case.garage_tenant_id, TENANT_A, 'routed by target_provider_tenant_id');
  assert.equal(result.case.source_inquiry_id, 'inq-1');
  assert.equal(result.case.vin, VIN);
  assert.equal(result.case.status, 'requested');
  assert.equal(result.case.requester_user_id, 'u-owner', 'the requester is the buyer, not the bridging operator');
  assert.equal(result.case.source_channel, 'qr', 'marketplace source attribution is carried, not invented');
});

test('the bridge does not rewrite marketplace inquiry status', async () => {
  const client = seedClient([serviceInquiry()]);
  await bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit);
  assert.equal(client._tables.marketplace_inquiries[0].status, 'new',
    'the lead pipeline stays Marketplace authority');
});

test('the bridge never overloads seller semantics for routing', async () => {
  const client = seedClient([serviceInquiry()]);
  await bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit);
  const inquiry = client._tables.marketplace_inquiries[0];
  assert.equal(inquiry.seller_id, null, 'seller_id is untouched');
  assert.equal(inquiry.seller_tenant_id, null, 'seller_tenant_id is untouched');
});

test('routing is governed, not guessed — no target garage means no Service Case', async () => {
  const client = seedClient([serviceInquiry({ target_provider_tenant_id: null })]);
  await assert.rejects(
    () => bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit),
    /no target garage recorded/,
  );
  assert.equal(client._tables.service_cases.length, 0);
});

test('a non-service inquiry is refused', async () => {
  const client = seedClient([serviceInquiry({ inquiry_type: 'vehicle_purchase_interest' })]);
  await assert.rejects(
    () => bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit),
    /is not a service request/,
  );
});

test('replaying the same inquiry is idempotent', async () => {
  const client = seedClient([serviceInquiry()]);
  const first = await bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit);
  const replay = await bridgeInquiryToServiceCase(client, operator, 'inq-1', noEmit);

  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.case.id, first.case.id);
  assert.equal(client._tables.service_cases.length, 1, 'a replay never opens a second case');
});

test('conversation binding goes through the canonical workflow service', async () => {
  const client = seedClient();
  const { case: c } = await requestServiceCase(client, owner,
    { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);

  const calls = [];
  const workflowService = {
    ensureBusinessConversation: async (input) => {
      calls.push(input);
      return { thread: { id: 'thread-1' }, created: true };
    },
  };
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], { workflowService });

  assert.equal(bound.bound, true);
  assert.equal(bound.thread_id, 'thread-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].business_workflow, SERVICE_CASE_WORKFLOW, 'reuses the canonical garage workflow');
  assert.equal(calls[0].subject_type, SERVICE_CASE_SUBJECT_TYPE);
  assert.equal(calls[0].subject_id, c.id, 'the case id is the conversation subject');
  assert.equal(calls[0].tenant_id, TENANT_A);
  assert.deepEqual(calls[0].participants.map((p) => p.stakeholder_role), ['vehicle_owner', 'garage']);
  assert.equal(client._tables.service_cases[0].conversation_thread_id, 'thread-1');
});

test('conversation binding is idempotent — an already-bound case rebinds nothing', async () => {
  const client = seedClient();
  await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  client._tables.service_cases[0].conversation_thread_id = 'thread-existing';

  let called = 0;
  const workflowService = { ensureBusinessConversation: async () => { called += 1; return { thread: { id: 'thread-new' } }; } };
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], { workflowService });

  assert.equal(called, 0, 'no second conversation is created');
  assert.equal(bound.thread_id, 'thread-existing');
  assert.equal(bound.created, false);
});

test('a Communications failure returns a recoverable receipt and never erases the case', async () => {
  const client = seedClient();
  await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  const before = JSON.stringify(client._tables.service_cases[0]);

  const workflowService = {
    ensureBusinessConversation: async () => { throw new Error('communications provider unavailable'); },
  };
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], { workflowService });

  assert.equal(bound.bound, false, 'failure is reported, not pretended away');
  assert.match(bound.reason, /communications provider unavailable/);
  assert.equal(JSON.stringify(client._tables.service_cases[0]), before, 'the case is untouched');
  assert.equal(client._tables.service_cases.length, 1);
});

test('with Communications entirely absent the case still stands', async () => {
  const client = seedClient();
  await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], {});
  assert.equal(bound.bound, false);
  assert.equal(bound.reason, 'communications_unavailable');
  assert.equal(client._tables.service_cases.length, 1);
});

test('the reused workflow is a real canonical workflow, not an invented one', async () => {
  // Guards the S3 reconciliation: 'garage' must remain a declared workflow with the
  // vehicle_owner+garage contract, or the binding would 400 at runtime.
  const { CommunicationStakeholderContractService } = await import(
    '../services/communication/communicationStakeholderContractService.js');
  const svc = new CommunicationStakeholderContractService({});
  const contract = svc.contractFor(SERVICE_CASE_WORKFLOW);
  assert.deepEqual(contract.required_roles ?? contract.requiredRoles, ['vehicle_owner', 'garage']);
});
