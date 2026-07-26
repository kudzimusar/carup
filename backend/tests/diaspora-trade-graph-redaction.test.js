/**
 * Phase 10 — Gate T10 ADVERSARIAL REDACTION + AI-PAYLOAD CAPTURE tests (pure, no DB, no network).
 *
 * These tests harden the single redaction boundary that protects PII / participant identifiers /
 * payment refs / addresses / private paths before anything leaves a graph read path or reaches the AI
 * adapter. They are deliberately adversarial: PII is buried in deeply NESTED objects, ARRAYS of objects,
 * arrays-of-arrays, and under alias / mixed-case keys — the exact shapes a top-level-only redactor would
 * leak.
 *
 *   REQUIRED TEST 1 — Adversarial nested/array/alias redaction over the shared helper
 *     (diasporaTradeGraphRedaction.redactData / redactMetadata). Asserts NO seeded raw value survives for
 *     a non-admin / AI caller at ANY depth, inside arrays, or under mixed-case alias keys; that the
 *     structural shape is preserved; that recursion is bounded + cycle-safe; and — as a NEGATIVE CONTROL —
 *     that a top-level-ONLY redactor (recursion disabled) WOULD leak the same depth-N value (so the
 *     recursion in the source is provably load-bearing, not incidental).
 *
 *   REQUIRED TEST 2 — Capture the EXACT object handed to the AI adapter from the real
 *     diasporaTradeIntelligenceService.structuredContextForAi(...), deep-serialize the WHOLE payload
 *     (JSON.stringify), and assert NONE of the seeded raw participant ids / emails / phones / addresses /
 *     document ids appear anywhere in the serialized string — only PARTICIPANT:<token> / [REDACTED] /
 *     [REGION] tokens remain. PII is seeded at multiple depths and inside arrays.
 *
 * Time is fixed (FIXED_TS via context.now); no test depends on Date.now().
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
// db/supabase.js (transitively imported via diasporaServiceUtils) throws at import without these.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_TRADE_GRAPH = 'true';

const FIXED_TS = '2026-06-21T14:00:00.000Z';

const { createGraphPgMock, resetGraphIds } = await import('./helpers/diasporaTradeGraphRpcReference.js');
const {
  redactData,
  redactMetadata,
  participantToken,
} = await import('../services/diaspora/tradegraph/diasporaTradeGraphRedaction.js');
const {
  TRADE_GRAPH_PARTICIPANT_ID_FIELDS,
  TRADE_GRAPH_REDACTION_TOKEN,
  TRADE_GRAPH_REGION_TOKEN,
} = await import('../constants/diaspora/diasporaTradeGraphConstants.js');
const { DiasporaTradeIntelligenceService } = await import('../services/diaspora/tradegraph/diasporaTradeIntelligenceService.js');

const T_A = '00000000-0000-4000-9000-00000000000a';
const evId = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const intel = () => new DiasporaTradeIntelligenceService();

// Server-derived roles (NEVER a client flag): a non-admin tenant member, a platform admin, the AI boundary
// (treated as least-privilege — no platform role at all, so it is masked exactly like a non-admin member).
const member = { id: 'member-1', platformRole: null, tenantRole: 'member', tenantId: T_A };
const admin = { id: 'admin-1', platformRole: 'platform_admin', tenantRole: 'admin', tenantId: T_A };
const aiCaller = { id: 'ai-1', platformRole: null, tenantRole: null, tenantId: T_A };

beforeEach(() => resetGraphIds());
afterEach(() => { process.env.DIASPORA_TRADE_GRAPH = 'true'; });

// ── A bank of raw secrets the policy must NEVER emit to a non-admin / AI. Each is a recognizable,
//    high-entropy sentinel so a substring scan of the serialized output is unambiguous. ──
const RAW = Object.freeze({
  email: 'victim.RAW@example.com',
  buyerName: 'Jane RAW Doe',
  sellerName: 'Acme RAW Traders Ltd',
  phone: '+15550009999',
  address: '12 RAWStreet, Lagos Nigeria 100001',
  paymentRef: 'PR-RAW-SECRET-7788',
  escrowRef: 'ESCROW-RAW-4242',
  accountNumber: 'ACCT-RAW-99887766',
  privatePath: '/private/RAW/secret/file.pdf',
  driveUrl: 'https://drive.example.com/RAW/abc123',
  documentId: 'DOC-RAW-IDENTIFIER-555',     // seeded under a participant-id-classified key (document refs)
  sellerId: 'sell-RAW-0001',
  buyerId: 'buy-RAW-0002',
  userId: 'user-RAW-0003',
  coordinatorId: 'coord-RAW-0004',
  tradeProfileId: 'tp-RAW-0005',
  uploadedBy: 'uploader-RAW-0006',
});

/** Every raw sentinel value, for a single absent/leak sweep. */
const ALL_RAW_VALUES = Object.values(RAW);

/**
 * Build an adversarial attribute bag that hides PII in every awkward place a top-level-only redactor would
 * miss: (a) deep nesting, (b) arrays of objects, (c) arrays-of-arrays, (d) alias / MIXED-CASE keys.
 * Each PII value is keyed by a name that IS in the redaction policy (REDACTED / PARTICIPANT_ID /
 * REGION_ONLY) — only its CASING / DEPTH / ARRAY position is adversarial.
 */
function adversarialData() {
  return {
    // (d) mixed-case + alias keys at the top level (case-insensitive policy must still catch them).
    Email: RAW.email,
    Buyer_Name: RAW.buyerName,
    PAYMENT_REF: RAW.paymentRef,
    Address: RAW.address,
    // (a) deeply nested object — PII several levels down.
    profile: {
      contact: {
        details: {
          phone: RAW.phone,
          seller_name: RAW.sellerName,
          Seller_Id: RAW.sellerId,            // mixed-case participant id, depth 3
        },
      },
      storage_path: RAW.privatePath,
    },
    // (b) array of objects — each element carries PII.
    participants: [
      { buyer_id: RAW.buyerId, role: 'buyer' },
      { user_id: RAW.userId, coordinator_id: RAW.coordinatorId },
      { uploaded_by: RAW.uploadedBy, document_id: RAW.documentId, escrow_reference: RAW.escrowRef },
    ],
    // (c) array-of-arrays — PII two array levels deep.
    matrix: [
      [{ account_number: RAW.accountNumber }],
      [[{ drive_file_url: RAW.driveUrl, trade_profile_id: RAW.tradeProfileId }]],
    ],
    // a benign value at the leaf to prove non-classified scalars pass through unchanged.
    keepThis: 'NON_SENSITIVE_OK',
  };
}

/** Recursively collect every string leaf in an object/array (to scan redacted output for leaks). */
function collectStrings(value, acc = []) {
  if (value == null) return acc;
  if (typeof value === 'string') { acc.push(value); return acc; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, acc); return acc; }
  if (typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, acc); return acc; }
  return acc;
}

/**
 * NEGATIVE-CONTROL redactor: the PRE-FIX, TOP-LEVEL-ONLY policy. It masks only top-level classified keys
 * and PASSES NESTED objects/arrays through verbatim — exactly the bypass the recursive source fixes. Used
 * to prove a depth-N / in-array PII value LEAKS iff recursion is disabled (so the real recursion is
 * load-bearing). Mirrors the classification but deliberately does NOT descend.
 */
function topLevelOnlyRedact(data) {
  const REDACTED_LC = new Set([
    'user_email', 'email', 'buyer_name', 'seller_name', 'full_name', 'phone',
    'payment_ref', 'payment_reference', 'escrow_reference', 'account_number',
    'credential_reference', 'private_path', 'storage_path', 'drive_file_url', 'internal_notes',
  ]);
  const PARTICIPANT_LC = new Set(TRADE_GRAPH_PARTICIPANT_ID_FIELDS.map((f) => f.toLowerCase()));
  const REGION_LC = new Set(['address', 'origin_city', 'destination_city']);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const lk = k.toLowerCase();
    if (REDACTED_LC.has(lk)) { out[k] = TRADE_GRAPH_REDACTION_TOKEN; continue; }
    if (PARTICIPANT_LC.has(lk)) { out[k] = TRADE_GRAPH_REDACTION_TOKEN; continue; }
    if (REGION_LC.has(lk)) { out[k] = TRADE_GRAPH_REGION_TOKEN; continue; }
    out[k] = v; // ← NO recursion: nested/array PII passes through RAW (the bug we are guarding against).
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// REQUIRED TEST 1 — ADVERSARIAL NESTED / ARRAY / ALIAS REDACTION
// ═════════════════════════════════════════════════════════════════════════════

test('T1: NO raw PII survives redactData for a non-admin caller — nested, arrays, arrays-of-arrays, mixed-case', () => {
  const out = redactData(adversarialData(), member);
  const serialized = JSON.stringify(out);
  // Sweep EVERY seeded raw value: none may appear anywhere in the redacted output (string scan).
  for (const raw of ALL_RAW_VALUES) {
    assert.ok(!serialized.includes(raw), `raw value leaked through redaction: ${raw}`);
  }
  // Also assert per-leaf (not just substring): every string leaf is either a token or a known benign value.
  for (const leaf of collectStrings(out)) {
    const isToken = leaf === TRADE_GRAPH_REDACTION_TOKEN
      || leaf.startsWith(TRADE_GRAPH_REGION_TOKEN)
      || leaf === 'NON_SENSITIVE_OK' || leaf === 'buyer' || leaf === 'ok';
    assert.ok(isToken || !ALL_RAW_VALUES.includes(leaf), `unexpected raw leaf survived: ${leaf}`);
  }
});

test('T1: AI boundary (least-privilege caller) is masked identically to a non-admin member', () => {
  const out = redactData(adversarialData(), aiCaller);
  const serialized = JSON.stringify(out);
  for (const raw of ALL_RAW_VALUES) {
    assert.ok(!serialized.includes(raw), `raw value reached the AI boundary: ${raw}`);
  }
});

test('T1: structural shape is preserved — objects/arrays keep their positions, only leaf values masked', () => {
  const out = redactData(adversarialData(), member);
  // Nested object preserved with masked leaves.
  assert.equal(out.profile.contact.details.phone, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.profile.contact.details.seller_name, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.profile.contact.details.Seller_Id, TRADE_GRAPH_REDACTION_TOKEN, 'mixed-case participant id masked');
  assert.equal(out.profile.storage_path, TRADE_GRAPH_REDACTION_TOKEN);
  // Array of objects preserved (length + positions) with masked participant ids.
  assert.equal(out.participants.length, 3, 'array length preserved');
  assert.equal(out.participants[0].buyer_id, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.participants[0].role, 'buyer', 'non-classified sibling preserved');
  assert.equal(out.participants[2].document_id, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.participants[2].escrow_reference, TRADE_GRAPH_REDACTION_TOKEN);
  // Array-of-arrays preserved (nesting depth + positions) with masked leaves.
  assert.equal(out.matrix[0][0].account_number, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.matrix[1][0][0].drive_file_url, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(out.matrix[1][0][0].trade_profile_id, TRADE_GRAPH_REDACTION_TOKEN);
  // Region keys coarsened to a token, never a raw substring.
  assert.ok(String(out.Address).startsWith(TRADE_GRAPH_REGION_TOKEN));
  assert.ok(!String(out.Address).includes('Lagos'), 'no raw address substring echoed');
  // Non-sensitive scalar passes through unchanged.
  assert.equal(out.keepThis, 'NON_SENSITIVE_OK');
});

test('T1: a platform admin/reviewer sees raw participant ids (role-aware) but PII/payment/path are STILL masked for everyone', () => {
  const out = redactData(adversarialData(), admin);
  // Participant ids (ADMIN_ONLY but tokenized for non-admins) are raw for an admin.
  assert.equal(out.participants[0].buyer_id, RAW.buyerId, 'admin sees raw participant id');
  assert.equal(out.profile.contact.details.Seller_Id, RAW.sellerId, 'admin sees nested raw participant id');
  assert.equal(out.matrix[1][0][0].trade_profile_id, RAW.tradeProfileId, 'admin sees deep raw participant id');
  // BUT pure PII / payment refs / private paths are masked for EVERYONE (fail-safe, even admins).
  assert.equal(out.Email, TRADE_GRAPH_REDACTION_TOKEN, 'email masked even for admin');
  assert.equal(out.PAYMENT_REF, TRADE_GRAPH_REDACTION_TOKEN, 'payment ref masked even for admin');
  assert.equal(out.profile.contact.details.phone, TRADE_GRAPH_REDACTION_TOKEN, 'nested phone masked even for admin');
  assert.equal(out.profile.storage_path, TRADE_GRAPH_REDACTION_TOKEN, 'private path masked even for admin');
});

test('T1: redactMetadata applies the SAME recursive policy as redactData (edge.metadata path)', () => {
  const out = redactMetadata(adversarialData(), member);
  const serialized = JSON.stringify(out);
  for (const raw of ALL_RAW_VALUES) {
    assert.ok(!serialized.includes(raw), `raw value leaked through edge metadata redaction: ${raw}`);
  }
});

test('T1: recursion is BOUNDED + CYCLE-SAFE — a self-referential payload is masked, never hangs or overflows', () => {
  // A cycle MUST NOT cause infinite recursion; beyond the depth bound the subtree fails safe to the token.
  const cyclic = { email: RAW.email, child: {} };
  cyclic.child.parent = cyclic; // self-reference
  cyclic.child.email = RAW.email; // a classified key one level down; would leak if recursion bailed unmasked
  const out = redactData(cyclic, member);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes(RAW.email), 'cyclic payload did not leak the seeded PII');
  assert.equal(out.email, TRADE_GRAPH_REDACTION_TOKEN, 'top-level classified key masked despite the cycle');

  // A payload nested deeper than the bound: the over-bound subtree is dropped to the token (fail-safe),
  // so any PII it contained cannot escape raw.
  let deep = { email: RAW.email };
  for (let i = 0; i < 30; i += 1) deep = { wrap: deep, phone: RAW.phone };
  const deepOut = redactData(deep, member);
  assert.ok(!JSON.stringify(deepOut).includes(RAW.email), 'over-bound deep PII does not escape raw');
});

test('T1 (NEGATIVE CONTROL): with recursion DISABLED, the same depth-N / in-array PII LEAKS (recursion is load-bearing)', () => {
  // Prove the bypass exists if you only mask top-level keys: the negative-control redactor leaks the exact
  // values the recursive source masks. This is the failure the source's recursion fixes.
  const leaky = topLevelOnlyRedact(adversarialData());
  const leakySerialized = JSON.stringify(leaky);
  // Nested + in-array PII LEAKS through the top-level-only redactor …
  assert.ok(leakySerialized.includes(RAW.phone), 'control: nested phone leaks without recursion');
  assert.ok(leakySerialized.includes(RAW.sellerId), 'control: nested participant id leaks without recursion');
  assert.ok(leakySerialized.includes(RAW.buyerId), 'control: in-array participant id leaks without recursion');
  assert.ok(leakySerialized.includes(RAW.accountNumber), 'control: array-of-array PII leaks without recursion');

  // … while the REAL recursive source masks those very same values (depth N leaks IFF recursion is off).
  const safe = redactData(adversarialData(), member);
  const safeSerialized = JSON.stringify(safe);
  for (const raw of [RAW.phone, RAW.sellerId, RAW.buyerId, RAW.accountNumber]) {
    assert.ok(leakySerialized.includes(raw) && !safeSerialized.includes(raw),
      `value ${raw} leaks without recursion but is masked WITH it (recursion is load-bearing)`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REQUIRED TEST 2 — CAPTURE THE EXACT AI-ADAPTER PAYLOAD; ASSERT NO RAW PII ANYWHERE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Seed a BUYER_ORDER node + a 1-hop neighborhood whose node.data AND edge.metadata carry PII at multiple
 * depths and inside arrays, directly in the graph mock store (we are testing the redaction boundary of the
 * AI-context builder, not the projector). The participant node neighbor (SELLER) carries a raw entity_id
 * that must be pseudonymized in the surfaced payload.
 */
function seedAiContextGraph() {
  const { client, store } = createGraphPgMock();
  const orderNodeId = '00000000-0000-4001-8000-000000000001';
  const sellerNodeId = '00000000-0000-4001-8000-000000000002';
  const edgeId = '00000000-0000-4002-8000-000000000003';

  store.trade_graph_nodes.push({
    id: orderNodeId, tenant_id: T_A, node_type: 'BUYER_ORDER', entity_type: 'BUYER_ORDER',
    entity_id: 'ord-1', is_current: true, is_valid: true, confidence: 1.0,
    data: {
      status: 'IMPORT_REQUESTED',
      buyer_id: RAW.buyerId,                          // top-level participant id
      buyer_name: RAW.buyerName,                      // top-level PII
      Email: RAW.email,                               // mixed-case PII
      address: RAW.address,                           // region-coarsened
      contact: { phone: RAW.phone, escrow_reference: RAW.escrowRef }, // nested PII
      documents: [                                    // array of objects with PII
        { document_id: RAW.documentId, uploaded_by: RAW.uploadedBy, storage_path: RAW.privatePath },
      ],
      audit_trail: [[{ account_number: RAW.accountNumber }]], // array-of-arrays PII
    },
    projection_version: 'v1', source_event_ref: evId(1), created_at: FIXED_TS, deleted_at: null, updated_at: FIXED_TS,
  });
  // A participant SELLER neighbor whose raw entity_id (a person/profile id) must be tokenized in the output.
  store.trade_graph_nodes.push({
    id: sellerNodeId, tenant_id: T_A, node_type: 'SELLER', entity_type: 'SELLER',
    entity_id: RAW.sellerId, is_current: true, is_valid: true, confidence: 1.0,
    data: { seller_name: RAW.sellerName, coordinator_id: RAW.coordinatorId, profile: { user_id: RAW.userId } },
    projection_version: 'v1', source_event_ref: evId(2), created_at: FIXED_TS, deleted_at: null, updated_at: FIXED_TS,
  });
  store.trade_graph_edges.push({
    id: edgeId, tenant_id: T_A, source_node_id: sellerNodeId, target_node_id: orderNodeId,
    edge_type: 'QUOTED_ON', source_event_ref: evId(2), is_valid: true, confidence: 0.9,
    policy_version: 'p1', valid_from: FIXED_TS, valid_until: null, created_at: FIXED_TS,
    deleted_at: null, updated_at: FIXED_TS,
    metadata: { drive_file_url: RAW.driveUrl, nested: { payment_ref: RAW.paymentRef }, refs: [{ trade_profile_id: RAW.tradeProfileId }] },
  });
  return { client, store, orderNodeId, sellerNodeId };
}

test('T2: the EXACT AI-adapter payload (structuredContextForAi) contains NO raw PII anywhere when serialized', async () => {
  const { client } = seedAiContextGraph();
  // Capture the EXACT object the AI boundary (diasporaAiCommandService) would receive.
  const aiPayload = await intel().structuredContextForAi(T_A, 'ord-1', {
    pgClient: client, now: FIXED_TS, userContext: aiCaller,
  });
  // Deep-serialize the WHOLE payload (order + every neighbor node.data + every edge.metadata + redactions).
  const serialized = JSON.stringify(aiPayload);

  // Assert EVERY seeded raw secret is ABSENT from the serialized payload (participant ids, emails, phones,
  // addresses, document ids, payment refs, private paths, drive urls, names).
  for (const raw of ALL_RAW_VALUES) {
    assert.ok(!serialized.includes(raw), `raw PII reached the AI adapter payload: ${raw}`);
  }

  // Only sanctioned tokens remain for the masked identity surfaces:
  //  - the SELLER neighbor's raw entity_id is pseudonymized to PARTICIPANT:<token> (stable, non-reversible).
  const expectedSellerToken = participantToken(RAW.sellerId);
  assert.ok(serialized.includes(expectedSellerToken), 'seller entity_id surfaced as a PARTICIPANT token');
  assert.ok(!serialized.includes(RAW.sellerId), 'raw seller id never appears');
  //  - redaction + region tokens are present (the policy actually fired on the seeded PII).
  assert.ok(serialized.includes(TRADE_GRAPH_REDACTION_TOKEN), '[REDACTED] token present');
  assert.ok(serialized.includes(TRADE_GRAPH_REGION_TOKEN), '[REGION] token present');

  // The AI boundary contract is asserted on the captured payload (read-only, no edge authorship).
  assert.deepEqual(aiPayload.aiBoundary, { readOnly: true, mutatesState: false, createsEdges: false });
});

test('T2: PII seeded at multiple depths + inside arrays is masked in the order node AND the neighbor + edge', async () => {
  const { client } = seedAiContextGraph();
  const aiPayload = await intel().structuredContextForAi(T_A, 'ord-1', {
    pgClient: client, now: FIXED_TS, userContext: aiCaller,
  });
  // Order node: nested + array + array-of-array PII all masked.
  const od = aiPayload.order.data;
  assert.equal(od.buyer_name, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(od.Email, TRADE_GRAPH_REDACTION_TOKEN);
  assert.ok(String(od.address).startsWith(TRADE_GRAPH_REGION_TOKEN));
  assert.equal(od.contact.phone, TRADE_GRAPH_REDACTION_TOKEN, 'nested phone masked');
  assert.equal(od.contact.escrow_reference, TRADE_GRAPH_REDACTION_TOKEN, 'nested escrow ref masked');
  assert.equal(od.documents[0].document_id, TRADE_GRAPH_REDACTION_TOKEN, 'in-array document id masked');
  assert.equal(od.documents[0].storage_path, TRADE_GRAPH_REDACTION_TOKEN, 'in-array private path masked');
  assert.equal(od.audit_trail[0][0].account_number, TRADE_GRAPH_REDACTION_TOKEN, 'array-of-array PII masked');

  // The neighbor (SELLER) node + the edge metadata are redacted too.
  const seller = aiPayload.neighbors.find((n) => n.node.nodeType === 'SELLER');
  assert.ok(seller, 'seller neighbor present');
  assert.equal(seller.node.entityId, participantToken(RAW.sellerId), 'neighbor participant entityId pseudonymized');
  assert.equal(seller.node.data.seller_name, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(seller.node.data.profile.user_id, TRADE_GRAPH_REDACTION_TOKEN, 'nested neighbor participant id masked');
  assert.equal(seller.edge.metadata.drive_file_url, TRADE_GRAPH_REDACTION_TOKEN);
  assert.equal(seller.edge.metadata.nested.payment_ref, TRADE_GRAPH_REDACTION_TOKEN, 'nested edge-metadata PII masked');
  assert.equal(seller.edge.metadata.refs[0].trade_profile_id, TRADE_GRAPH_REDACTION_TOKEN, 'in-array edge-metadata id masked');
});

test('T2 (negative control): a platform admin DOES receive raw participant ids in the AI-shaped context, proving the masking above is role-driven', async () => {
  const { client } = seedAiContextGraph();
  const adminPayload = await intel().structuredContextForAi(T_A, 'ord-1', {
    pgClient: client, now: FIXED_TS, userContext: admin,
  });
  // Admin sees raw participant ids (role-aware) — this is what makes the non-admin masking meaningful.
  assert.equal(adminPayload.order.data.buyer_id, RAW.buyerId, 'admin sees raw participant id in node data');
  const seller = adminPayload.neighbors.find((n) => n.node.nodeType === 'SELLER');
  assert.equal(seller.node.entityId, RAW.sellerId, 'admin sees the raw seller entity_id (not the token)');
  // But pure PII (names/emails/payment/paths) stays masked even for the admin (fail-safe).
  assert.equal(adminPayload.order.data.buyer_name, TRADE_GRAPH_REDACTION_TOKEN, 'PII masked even for admin');
});
