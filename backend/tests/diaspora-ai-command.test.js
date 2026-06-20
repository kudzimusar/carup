/**
 * Phase 5 backend tests — AI command pipeline: risk tiers, confirmation/approval gates, duplicate
 * fingerprint, low-confidence/ambiguity review, tenant/role isolation, execution re-validation, and
 * the hard guarantee that AI never directly mutates stock/payment/compliance and high-risk stays
 * blocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const ai = await import('../services/diaspora/diasporaAiCommandService.js');

const user = { id: 'u-1', userId: 'u-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const otherUser = { id: 'u-2', userId: 'u-2', role: 'dealer', platformRole: 'dealer', tenantId: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function client(extra = {}) {
  return createMockSupabase({
    diaspora_ai_commands: [],
    diaspora_import_orders: [],
    diaspora_stock_items: [],
    diaspora_stock_ledger: [],
    diaspora_import_audit_log: [],
    ...extra,
  });
}

test('low-risk command creates a DRAFT and executes to a draft record only', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'Create demand for a Toyota part' }, user, { supabaseClient: c });
  assert.equal(command.risk_level, 'LOW');
  assert.equal(command.execution_status, 'DRAFT');
  const { result } = await ai.executeAiCommand(command.id, user, { supabaseClient: c });
  assert.equal(result.type, 'buyer_order_draft');
  // a buyer order draft now exists, but no published/final state
  const orders = c._rows('diaspora_import_orders');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].metadata.draft, true);
});

test('medium-risk command cannot execute before confirmation', async () => {
  const c = client({ diaspora_stock_items: [{ id: 'stk-1', part_name: 'X', created_by: 'u-1', quantity_on_hand: 10, quantity_reserved: 0 }] });
  const { command } = await ai.createAiCommand({ rawCommand: 'reserve stock stk-1 5 units' }, user, { supabaseClient: c });
  assert.equal(command.risk_level, 'MEDIUM');
  assert.equal(command.execution_status, 'AWAITING_CONFIRMATION');
  await assert.rejects(() => ai.executeAiCommand(command.id, user, { supabaseClient: c }), /requires confirmation/i);
  await ai.confirmAiCommand(command.id, user, { supabaseClient: c });
  const { result } = await ai.executeAiCommand(command.id, user, { supabaseClient: c });
  assert.equal(result.type, 'stock_reservation');
  // reservation went through the LEDGER (not a direct quantity write)
  assert.equal(c._rows('diaspora_stock_ledger').length, 1);
  assert.equal(Number(c._rows('diaspora_stock_items')[0].quantity_reserved), 5);
});

test('high-risk command stays blocked even after approval', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'approve compliance for ord-1' }, user, { supabaseClient: c });
  assert.equal(command.risk_level, 'HIGH');
  assert.equal(command.execution_status, 'AWAITING_APPROVAL');
  assert.equal(command.approval_status, 'PENDING');
  await ai.approveAiCommand(command.id, reviewer, { supabaseClient: c });
  await assert.rejects(() => ai.executeAiCommand(command.id, reviewer, { supabaseClient: c }), /high-risk ai execution is disabled/i);
  const stored = await ai.getAiCommand(command.id, reviewer, { supabaseClient: c });
  assert.equal(stored.execution_status, 'BLOCKED');
});

test('AI cannot release escrow / approve compliance (high-risk blocked, no domain mutation)', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'release escrow for ord-9' }, user, { supabaseClient: c });
  assert.equal(command.risk_level, 'HIGH');
  await assert.rejects(() => ai.executeAiCommand(command.id, user, { supabaseClient: c }), /disabled|high-risk/i);
});

test('AI cannot override the stock ledger (high-risk blocked)', async () => {
  const c = client({ diaspora_stock_items: [{ id: 'stk-1', part_name: 'X', created_by: 'u-1', quantity_on_hand: 10, quantity_reserved: 0 }] });
  const { command } = await ai.createAiCommand({ rawCommand: 'override stock stk-1 set stock to 999' }, user, { supabaseClient: c });
  assert.equal(command.risk_level, 'HIGH');
  await assert.rejects(() => ai.executeAiCommand(command.id, user, { supabaseClient: c }), /high-risk/i);
  // stock unchanged
  assert.equal(Number(c._rows('diaspora_stock_items')[0].quantity_on_hand), 10);
});

test('duplicate command fingerprint does not create a second command', async () => {
  const c = client();
  const first = await ai.createAiCommand({ rawCommand: 'add note follow up tomorrow' }, user, { supabaseClient: c });
  const second = await ai.createAiCommand({ rawCommand: 'add note follow up tomorrow' }, user, { supabaseClient: c });
  assert.equal(second.duplicate, true);
  assert.equal(first.command.id, second.command.id);
  assert.equal(c._rows('diaspora_ai_commands').length, 1);
});

test('low confidence / unknown intent becomes NEEDS_REVIEW and cannot execute', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'xyzzy something undefined' }, user, { supabaseClient: c });
  assert.equal(command.execution_status, 'NEEDS_REVIEW');
  await assert.rejects(() => ai.executeAiCommand(command.id, user, { supabaseClient: c }), /needs human review/i);
});

test('ambiguous required-entity command is flagged and blocked', async () => {
  const c = client();
  // RESERVE_STOCK requires targetId + quantity; here neither is present
  const { command } = await ai.createAiCommand({ rawCommand: 'reserve stock please' }, user, { supabaseClient: c });
  assert.equal(command.metadata.ambiguous, true);
  assert.equal(command.execution_status, 'NEEDS_REVIEW');
});

test('unauthorized role cannot confirm or approve another user command', async () => {
  const c = client({ diaspora_stock_items: [{ id: 'stk-1', part_name: 'X', created_by: 'u-1', quantity_on_hand: 10, quantity_reserved: 0 }] });
  const { command } = await ai.createAiCommand({ rawCommand: 'reserve stock stk-1 2 units' }, user, { supabaseClient: c });
  await assert.rejects(() => ai.confirmAiCommand(command.id, otherUser, { supabaseClient: c }), /access|requester|reviewer/i);
  const high = await ai.createAiCommand({ rawCommand: 'verify document doc-1' }, user, { supabaseClient: c });
  await assert.rejects(() => ai.approveAiCommand(high.command.id, otherUser, { supabaseClient: c }), /access|reviewer|admin/i);
});

test('tenant isolation: a user cannot read another user command', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'add note hello' }, user, { supabaseClient: c });
  await assert.rejects(() => ai.getAiCommand(command.id, otherUser, { supabaseClient: c }), /access/i);
});

test('execution is idempotent', async () => {
  const c = client();
  const { command } = await ai.createAiCommand({ rawCommand: 'add note remember this' }, user, { supabaseClient: c });
  const first = await ai.executeAiCommand(command.id, user, { supabaseClient: c });
  assert.equal(first.command.execution_status, 'EXECUTED');
  const replay = await ai.executeAiCommand(command.id, user, { supabaseClient: c });
  assert.equal(replay.idempotentReplay, true);
});

test('audit events exist for create, confirm and execute', async () => {
  const c = client({ diaspora_stock_items: [{ id: 'stk-1', part_name: 'X', created_by: 'u-1', quantity_on_hand: 10, quantity_reserved: 0 }] });
  const { command } = await ai.createAiCommand({ rawCommand: 'reserve stock stk-1 1 unit' }, user, { supabaseClient: c });
  await ai.confirmAiCommand(command.id, user, { supabaseClient: c });
  await ai.executeAiCommand(command.id, user, { supabaseClient: c });
  const audits = c._rows('diaspora_import_audit_log').map((a) => a.action);
  assert.ok(audits.includes('AI_COMMAND_CREATED'));
  assert.ok(audits.includes('AI_COMMAND_CONFIRMED'));
  assert.ok(audits.includes('AI_COMMAND_EXECUTED'));
});
