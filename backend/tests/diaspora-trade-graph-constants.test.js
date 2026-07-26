/**
 * Phase 10 Stage 1 — Trade Graph constants + projection mapping invariants (pure, no DB).
 *
 * Guards the contract that the Stage 2 projector and the migration both depend on:
 *   - DIASPORA_TRADE_GRAPH env flag defaults OFF (fail-closed).
 *   - Every mapped event's node/edge types are within the allowlists that mirror the migration
 *     CHECK constraints (drift here = a runtime constraint violation during projection).
 *   - The mapping is data-only and deterministic; selectors are pure functions of the envelope.
 *   - No mapping entry lets AI/frontend author an edge: every edge derives from a domain event.
 *   - SafeTrade (Phase 9) entities are represented as nodes/edges.
 *
 * These assertions keep the constants file and the migration in lockstep at unit-test time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../constants/diaspora/diasporaTradeGraphConstants.js');
const {
  DIASPORA_EVENT_TYPES,
  DIASPORA_EVENT_TYPE_SET,
  TRADE_GRAPH_NODE_TYPES,
  TRADE_GRAPH_NODE_TYPE_SET,
  TRADE_GRAPH_EDGE_TYPES,
  TRADE_GRAPH_EDGE_TYPE_SET,
  EVENT_PROJECTION_MAP,
  NODE_OPERATIONS,
  EDGE_OPERATIONS,
  TRADE_GRAPH_POLICY_VERSION,
  TRADE_GRAPH_PROJECTION_VERSION,
  TRADE_GRAPH_REDACTED_FIELDS,
  isTradeGraphEnabled,
  isKnownEventType,
  isKnownNodeType,
  isKnownEdgeType,
  getProjectionMapping,
} = mod;

// ── Env flag (fail-closed) ───────────────────────────────────────────────────
test('isTradeGraphEnabled defaults OFF when env unset', () => {
  const prev = process.env.DIASPORA_TRADE_GRAPH;
  delete process.env.DIASPORA_TRADE_GRAPH;
  assert.equal(isTradeGraphEnabled(), false);
  if (prev !== undefined) process.env.DIASPORA_TRADE_GRAPH = prev;
});

test('isTradeGraphEnabled only true for explicit "true"', () => {
  const prev = process.env.DIASPORA_TRADE_GRAPH;
  process.env.DIASPORA_TRADE_GRAPH = 'TRUE';
  assert.equal(isTradeGraphEnabled(), true);
  process.env.DIASPORA_TRADE_GRAPH = '1';
  assert.equal(isTradeGraphEnabled(), false);
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  assert.equal(isTradeGraphEnabled(), false);
  if (prev === undefined) delete process.env.DIASPORA_TRADE_GRAPH;
  else process.env.DIASPORA_TRADE_GRAPH = prev;
});

// ── Versions kept in sync with the migration defaults ────────────────────────
test('policy/projection versions match migration defaults', () => {
  assert.equal(TRADE_GRAPH_POLICY_VERSION, 'trade-graph-policy-v1');
  assert.equal(TRADE_GRAPH_PROJECTION_VERSION, 'trade-graph-projection-v1');
});

// ── Enums are frozen + self-consistent ───────────────────────────────────────
test('enum objects are frozen', () => {
  assert.ok(Object.isFrozen(DIASPORA_EVENT_TYPES));
  assert.ok(Object.isFrozen(TRADE_GRAPH_NODE_TYPES));
  assert.ok(Object.isFrozen(TRADE_GRAPH_EDGE_TYPES));
  assert.ok(Object.isFrozen(EVENT_PROJECTION_MAP));
});

test('event-type set membership helpers agree with the enum', () => {
  assert.equal(DIASPORA_EVENT_TYPE_SET.size, Object.keys(DIASPORA_EVENT_TYPES).length);
  for (const v of Object.values(DIASPORA_EVENT_TYPES)) assert.ok(isKnownEventType(v));
  assert.equal(isKnownEventType('NOT_A_REAL_EVENT'), false);
  for (const v of Object.values(TRADE_GRAPH_NODE_TYPES)) assert.ok(isKnownNodeType(v));
  for (const v of Object.values(TRADE_GRAPH_EDGE_TYPES)) assert.ok(isKnownEdgeType(v));
});

// ── Mapping references only allowlisted node/edge types (mirrors migration CHECK) ──
test('every mapped event references only allowlisted node + edge types', () => {
  for (const [eventType, mapping] of Object.entries(EVENT_PROJECTION_MAP)) {
    assert.ok(isKnownEventType(eventType), `unmapped event in map: ${eventType}`);
    for (const op of mapping.nodeOperations || []) {
      assert.equal(op.operation, NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, `${eventType}: bad node op`);
      assert.ok(TRADE_GRAPH_NODE_TYPE_SET.has(op.nodeType), `${eventType}: node type ${op.nodeType} not in allowlist`);
      assert.equal(typeof op.idSelector, 'function', `${eventType}: idSelector must be a function`);
    }
    for (const op of mapping.edgeOperations || []) {
      assert.equal(op.operation, EDGE_OPERATIONS.CREATE_EDGE, `${eventType}: bad edge op`);
      assert.ok(TRADE_GRAPH_EDGE_TYPE_SET.has(op.edgeType), `${eventType}: edge type ${op.edgeType} not in allowlist`);
      assert.ok(TRADE_GRAPH_NODE_TYPE_SET.has(op.fromNodeType), `${eventType}: from type ${op.fromNodeType}`);
      assert.ok(TRADE_GRAPH_NODE_TYPE_SET.has(op.toNodeType), `${eventType}: to type ${op.toNodeType}`);
      assert.equal(typeof op.fromId, 'function', `${eventType}: fromId must be a function`);
      assert.equal(typeof op.toId, 'function', `${eventType}: toId must be a function`);
    }
  }
});

// ── Edge revocations (FIX 3): revoke events soft-delete the right edge ────────
test('FIX 3: revoke events declare SOFT_DELETE_EDGE revocations over allowlisted types', () => {
  const revokeEvents = ['STOCK_RELEASED', 'QUOTE_REJECTED', 'QUOTE_EXPIRED', 'CARGO_RESERVATION_REJECTED', 'DOCUMENT_REJECTED'];
  for (const ev of revokeEvents) {
    const mapping = getProjectionMapping(DIASPORA_EVENT_TYPES[ev]);
    assert.ok(mapping, `${ev} has a mapping`);
    assert.ok(Array.isArray(mapping.edgeRevocations) && mapping.edgeRevocations.length >= 1, `${ev} declares >=1 revocation`);
    for (const op of mapping.edgeRevocations) {
      assert.equal(op.operation, EDGE_OPERATIONS.SOFT_DELETE_EDGE, `${ev}: revocation op is SOFT_DELETE_EDGE`);
      assert.ok(TRADE_GRAPH_EDGE_TYPE_SET.has(op.edgeType), `${ev}: revoked edge type ${op.edgeType} allowlisted`);
      assert.ok(TRADE_GRAPH_NODE_TYPE_SET.has(op.fromNodeType), `${ev}: from type allowlisted`);
      assert.ok(TRADE_GRAPH_NODE_TYPE_SET.has(op.toNodeType), `${ev}: to type allowlisted`);
      assert.equal(typeof op.fromId, 'function', `${ev}: fromId selector is a function`);
      assert.equal(typeof op.toId, 'function', `${ev}: toId selector is a function`);
    }
  }
});

test('FIX 3: STOCK_RELEASED revokes the SUPPLIES edge created by STOCK_RESERVED (same endpoints)', () => {
  const reserved = getProjectionMapping(DIASPORA_EVENT_TYPES.STOCK_RESERVED);
  const released = getProjectionMapping(DIASPORA_EVENT_TYPES.STOCK_RELEASED);
  const supplies = reserved.edgeOperations.find((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.SUPPLIES);
  const revoke = released.edgeRevocations.find((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.SUPPLIES);
  assert.ok(supplies && revoke, 'both the CREATE and the SOFT_DELETE reference SUPPLIES');
  assert.equal(supplies.fromNodeType, revoke.fromNodeType);
  assert.equal(supplies.toNodeType, revoke.toNodeType);
  // Same selector keys → same endpoint resolution at projection time.
  const env = { tenantId: 't', payload: { stock_item_id: 'st-1', order_id: 'ord-1' } };
  assert.equal(supplies.fromId(env), revoke.fromId(env));
  assert.equal(supplies.toId(env), revoke.toId(env));
});

// ── Selectors are pure (deterministic) over the envelope ─────────────────────
test('node/edge selectors are pure and read tenant/payload only', () => {
  const env = {
    tenantId: 'tenant-1',
    payload: { trade_profile_id: 'tp-1', user_id: 'u-1', created_by: 'u-1', country: 'NG' },
  };
  const m = getProjectionMapping(DIASPORA_EVENT_TYPES.TRADE_PROFILE_CREATED);
  assert.ok(m);
  const nodeId1 = m.nodeOperations[0].idSelector(env);
  const nodeId2 = m.nodeOperations[0].idSelector(env);
  assert.equal(nodeId1, 'tp-1');
  assert.equal(nodeId1, nodeId2); // deterministic
  // BELONGS_TO_TENANT edge resolves its target from the envelope tenantId, never inferred.
  const tenantEdge = m.edgeOperations.find((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.BELONGS_TO_TENANT);
  assert.equal(tenantEdge.toId(env), 'tenant-1');
});

test('selectors return null for missing ids (projector then skips the op)', () => {
  const m = getProjectionMapping(DIASPORA_EVENT_TYPES.IMPORT_ORDER_CREATED);
  const emptyEnv = { tenantId: 't', payload: {} };
  assert.equal(m.nodeOperations[0].idSelector(emptyEnv), null);
  const initiated = m.edgeOperations.find((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.INITIATED_ORDER);
  assert.equal(initiated.fromId(emptyEnv), null);
});

// ── No AI/frontend authored edges; every edge derives from a domain event ────
test('AI_COMMAND mappings never create an authoritative edge type', () => {
  const created = getProjectionMapping(DIASPORA_EVENT_TYPES.AI_COMMAND_CREATED);
  for (const op of created.edgeOperations || []) {
    // The only edge AI events may project is the descriptive AI_COMMAND_FOR pointer.
    assert.equal(op.edgeType, TRADE_GRAPH_EDGE_TYPES.AI_COMMAND_FOR);
  }
});

// ── Phase 9 SafeTrade entities are represented ───────────────────────────────
test('SafeTrade transaction/milestone/dispute map to nodes + edges', () => {
  const tx = getProjectionMapping(DIASPORA_EVENT_TYPES.SAFETRADE_TRANSACTION_CREATED);
  assert.equal(tx.nodeOperations[0].nodeType, TRADE_GRAPH_NODE_TYPES.SAFETRADE_TRANSACTION);
  assert.ok(tx.edgeOperations.some((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.CONDUCTS_TRANSACTION));

  const ms = getProjectionMapping(DIASPORA_EVENT_TYPES.SAFETRADE_MILESTONE_CREATED);
  assert.equal(ms.nodeOperations[0].nodeType, TRADE_GRAPH_NODE_TYPES.SAFETRADE_MILESTONE);
  assert.ok(ms.edgeOperations.some((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.HAS_MILESTONE));

  const dp = getProjectionMapping(DIASPORA_EVENT_TYPES.SAFETRADE_DISPUTE_CREATED);
  assert.equal(dp.nodeOperations[0].nodeType, TRADE_GRAPH_NODE_TYPES.SAFETRADE_DISPUTE);
  assert.ok(dp.edgeOperations.some((e) => e.edgeType === TRADE_GRAPH_EDGE_TYPES.RAISED_DISPUTE));
});

// ── Redaction policy present for the AI boundary ─────────────────────────────
test('redaction policy masks PII + payment refs', () => {
  for (const f of ['user_email', 'phone', 'payment_ref', 'buyer_name', 'seller_name']) {
    assert.ok(TRADE_GRAPH_REDACTED_FIELDS.includes(f), `expected ${f} in redacted fields`);
  }
});

test('getProjectionMapping returns null for unmapped events', () => {
  assert.equal(getProjectionMapping('SOMETHING_ELSE'), null);
});
