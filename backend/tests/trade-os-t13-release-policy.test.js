/**
 * T13 — SafeTrade release-policy convergence.
 *
 * Historically every release was judged as if it were the FINAL release: a deposit could not be
 * released until the goods had arrived, cleared and been confirmed delivered. The policy is now
 * milestone-specific. Fulfilment facts are read from their frozen owners (T8 documents, T11 movement,
 * T12 customs) and only for the milestones they gate. SafeTrade's own assurance — held funds,
 * reconciliation, compliance, disputes, security holds, reviewer actor, live-payment firewall and
 * high-risk maker-checker — still applies to EVERY release.
 *
 * Every positive control below is paired with the refusal it guards, so a check that blocks
 * everything cannot pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;

const FIXED_TS = '2026-09-26T12:00:00.000Z';
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { SAFETRADE_RPCS } = await import('./helpers/diasporaSafeTradeRpcReference.js');
const policy = await import('../services/diaspora/safetrade/diasporaSafeTradeReleasePolicyService.js');
const { recordMilestone } = await import('../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js');
const { SAFETRADE_ACTIVE_DISPUTE_STATUSES } = await import('../services/diaspora/safetrade/diasporaSafeTradeDisputeService.js');
const { SAFETRADE_MILESTONE_TYPES } = await import('../constants/diaspora/diasporaSafeTradeConstants.js');
const { projectSafeTradeMoneyTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeMoneyTruthService.js');

const { evaluateRelease, releaseRequirementsFor, SAFETRADE_RELEASE_CLASSES: RC, MILESTONE_RELEASE_POLICY } = policy;
const reviewer = { id: 'rev-1', userId: 'rev-1', platformRole: 'reviewer', role: 'reviewer' };
const buyer = { id: 'buyer-1', userId: 'buyer-1', platformRole: 'owner', role: 'owner', tenantId: 'tenant-A' };

/** A LOW-risk transaction (total 1000) with one HELD milestone of the given type; compliance approved. */
function seed({ type = 'DEPOSIT', total = 1000, releaseTrigger = 'REVIEWER_APPROVAL', txnStatus = 'PAYMENT_HELD', txnMetadata = {} } = {}) {
  return createMockSupabase({
    diaspora_safetrade_transactions: [{
      id: 'st-1', tenant_id: 'tenant-A', import_order_id: 'ord-1', buyer_id: 'buyer-1', seller_id: 'seller-1',
      currency: 'USD', total_amount: total, status: txnStatus, payment_provider: 'sandbox', live_payment: false,
      metadata: { safetrade: {}, ...txnMetadata }, created_by: 'buyer-1',
    }],
    diaspora_safetrade_milestones: [{
      id: 'm-1', transaction_id: 'st-1', import_order_id: 'ord-1', tenant_id: 'tenant-A', milestone_type: type,
      release_trigger: releaseTrigger, sequence: 0, amount: total, currency: 'USD', status: 'HELD', provider_reference: 'sbx_1',
    }],
    diaspora_compliance_reviews: [{ id: 'cr-1', import_order_id: 'ord-1', status: 'APPROVED' }],
    diaspora_trade_documents: [],
    // T8's governed vocabulary: one type that needs a reviewer's verdict, one that does not.
    trade_document_types: [
      { id: 'tdt-1', code: 'COMMERCIAL_INVOICE', display_name: 'Commercial invoice', verification_required: true, deleted_at: null },
      { id: 'tdt-2', code: 'PACKING_PHOTOS', display_name: 'Packing photos', verification_required: false, deleted_at: null },
    ],
    diaspora_trade_document_verifications: [],
    vehicle_government_documents: [],
    diaspora_shipments: [],
    diaspora_customs_cases: [],
    diaspora_customs_events: [],
    diaspora_safetrade_disputes: [],
    diaspora_safetrade_release_evaluations: [],
    diaspora_safetrade_operations: [],
    diaspora_import_audit_log: [],
  }, { rpc: { ...DIASPORA_RPCS, ...SAFETRADE_RPCS } });
}

const evalM = (client, actor = reviewer, milestoneId = 'm-1') => evaluateRelease(client, { safeTradeId: 'st-1', milestoneId, actorContext: actor, evaluatedAt: FIXED_TS });
const codes = (v) => v.blockers.map((b) => b.code).sort();

/** A current T8 document; `verdict` records a reviewer's verdict the way T8's verify/reject routes do. */
function addDoc(c, { verdict = 'VERIFIED', verdictAt = '2026-09-10T00:00:00.000Z', ...over } = {}) {
  const docs = c._rows('diaspora_trade_documents');
  const doc = { id: `d-${docs.length}`, import_order_id: 'ord-1', document_type: 'COMMERCIAL_INVOICE', verification_status: verdict || 'UPLOADED', deleted_at: null, superseded_at: null, ...over };
  docs.push(doc);
  if (verdict) addVerdict(c, doc.id, verdict, verdictAt);
  return doc;
}
const addVerdict = (c, docId, status, at = '2026-09-10T00:00:00.000Z') => c._rows('diaspora_trade_document_verifications').push({ id: `v-${c._rows('diaspora_trade_document_verifications').length}`, trade_document_id: docId, verification_status: status, verified_by: 'rev-1', verified_at: at, created_at: at, deleted_at: null });
const setShipment = (c, status) => c._rows('diaspora_shipments').push({ id: `sh-${status}`, import_order_id: 'ord-1', status });
function addCustomsEvent(c, event_type, source_kind) {
  if (!c._rows('diaspora_customs_cases').length) c._rows('diaspora_customs_cases').push({ id: 'cc-1', import_order_id: 'ord-1', subject_type: 'import_order', subject_id: 'ord-1', status: 'OPEN' });
  c._rows('diaspora_customs_events').push({ id: `ce-${c._rows('diaspora_customs_events').length}`, case_id: 'cc-1', event_type, source_kind, assertion_class: source_kind === 'CARUP_OBSERVATION' ? 'CARUP_OBSERVED' : 'ATTRIBUTED', event_time: '2026-09-20T10:00:00.000Z' });
}
const confirmDelivery = (c) => { c._rows('diaspora_safetrade_transactions')[0].metadata.safetrade.deliveryConfirmed = true; };
function allFinalFacts(c) {
  addDoc(c); setShipment(c, 'ARRIVED'); addCustomsEvent(c, 'RELEASE_EVIDENCE_RECEIVED', 'AUTHORITY_DOCUMENT'); confirmDelivery(c);
}

// ── Early ────────────────────────────────────────────────────────────────────

test('EARLY: a held deposit is releasable with no shipment, no customs, no delivery and no documents', async () => {
  const v = await evalM(seed({ type: 'DEPOSIT' }));
  assert.equal(v.releaseClass, RC.EARLY);
  assert.deepEqual(v.blockers, [], `unexpected blockers: ${codes(v)}`);
  assert.equal(v.eligible, true);
});

test('the historical global gate is what a milestone-less evaluation still gets (FINAL, fail-closed)', async () => {
  const v = await evalM(seed({ type: 'DEPOSIT' }), reviewer, null);
  assert.equal(v.releaseClass, RC.FINAL);
  assert.deepEqual(codes(v), ['DELIVERY_NOT_CONFIRMED', 'DESTINATION_RELEASE_NOT_EVIDENCED', 'DOCUMENTS_NOT_VERIFIED', 'SHIPMENT_MILESTONE_NOT_REACHED']);
});

test('EARLY still carries every SafeTrade assurance gate', async () => {
  // not held
  const notHeld = seed({ type: 'DEPOSIT' }); notHeld._rows('diaspora_safetrade_milestones')[0].status = 'PENDING';
  assert.ok(codes(await evalM(notHeld)).includes('PAYMENT_NOT_HELD'));
  // compliance flagged
  const flagged = seed({ type: 'DEPOSIT' }); flagged._rows('diaspora_compliance_reviews')[0].status = 'FLAGGED';
  assert.ok(codes(await evalM(flagged)).includes('COMPLIANCE_NOT_APPROVED'));
  // security hold
  const held = seed({ type: 'DEPOSIT', txnMetadata: { safetrade: { securityHold: true } } });
  assert.ok(codes(await evalM(held)).includes('SECURITY_HOLD'));
  // live provider while live payment is off
  const live = seed({ type: 'DEPOSIT' }); live._rows('diaspora_safetrade_transactions')[0].payment_provider = 'stripe';
  assert.ok(codes(await evalM(live)).includes('LIVE_PAYMENT_DISABLED'));
  // unreconciled
  const drift = seed({ type: 'DEPOSIT' }); drift._rows('diaspora_safetrade_milestones')[0].amount = 900;
  assert.ok(codes(await evalM(drift)).includes('TOTALS_UNRECONCILED'));
});

test('a release trigger can ADD a requirement to an early milestone, never remove one', async () => {
  const c = seed({ type: 'DEPOSIT', releaseTrigger: 'ON_DELIVERY_CONFIRMED_REVIEWED' });
  assert.deepEqual(codes(await evalM(c)), ['DELIVERY_NOT_CONFIRMED']);
  confirmDelivery(c);
  assert.equal((await evalM(c)).eligible, true);
  const docs = seed({ type: 'DEPOSIT', releaseTrigger: 'ON_DOCUMENTS_VERIFIED_REVIEWED' });
  assert.deepEqual(codes(await evalM(docs)), ['DOCUMENTS_NOT_VERIFIED']);
});

// ── Intermediate ─────────────────────────────────────────────────────────────

test('INTERMEDIATE shipment milestone: documents + IN_TRANSIT; arrival, customs and delivery are irrelevant', async () => {
  const c = seed({ type: 'SHIPMENT' });
  addDoc(c); setShipment(c, 'BOOKED');
  assert.deepEqual(codes(await evalM(c)), ['SHIPMENT_MILESTONE_NOT_REACHED'], 'BOOKED is not in transit');
  setShipment(c, 'IN_TRANSIT');
  const v = await evalM(c);
  assert.equal(v.releaseClass, RC.INTERMEDIATE);
  assert.equal(v.eligible, true, `blockers: ${codes(v)}`);
});

test('INTERMEDIATE: a shipment in EXCEPTION proves no progress', async () => {
  const c = seed({ type: 'SHIPMENT' });
  addDoc(c); setShipment(c, 'EXCEPTION');
  assert.deepEqual(codes(await evalM(c)), ['SHIPMENT_MILESTONE_NOT_REACHED']);
});

test('INTERMEDIATE progress milestone needs current verified T8 documents only', async () => {
  const c = seed({ type: 'PROGRESS' });
  assert.deepEqual(codes(await evalM(c)), ['DOCUMENTS_NOT_VERIFIED']);
  addDoc(c);
  assert.equal((await evalM(c)).eligible, true);
});

test('INTERMEDIATE customs-duty milestone needs a DOCUMENT-backed assessment — not arrival, not release, not payment evidence', async () => {
  const c = seed({ type: 'CUSTOMS_DUTY' });
  addDoc(c);
  addCustomsEvent(c, 'PAYMENT_EVIDENCE_RECEIVED', 'AUTHORITY_DOCUMENT');
  assert.deepEqual(codes(await evalM(c)), ['CUSTOMS_ASSESSMENT_NOT_EVIDENCED'], 'customs PAYMENT evidence satisfies nothing in SafeTrade');
  addCustomsEvent(c, 'ASSESSMENT_EVIDENCE_RECEIVED', 'AGENT_REPORT');
  assert.deepEqual(codes(await evalM(c)), ['CUSTOMS_ASSESSMENT_NOT_EVIDENCED'], 'an agent\'s word is not a document');
  addCustomsEvent(c, 'ASSESSMENT_EVIDENCE_RECEIVED', 'AUTHORITY_DOCUMENT');
  const v = await evalM(c);
  assert.equal(v.eligible, true, `blockers: ${codes(v)}`);
});

// ── Final ────────────────────────────────────────────────────────────────────

for (const type of ['RELEASE', 'DELIVERY']) {
  test(`FINAL ${type}: every fact present releases; each missing fact fails closed on its own`, async () => {
    const full = seed({ type }); allFinalFacts(full);
    const ok = await evalM(full);
    assert.equal(ok.releaseClass, RC.FINAL);
    assert.equal(ok.eligible, true, `blockers: ${codes(ok)}`);

    const noArrival = seed({ type }); addDoc(noArrival); setShipment(noArrival, 'IN_TRANSIT'); addCustomsEvent(noArrival, 'RELEASE_EVIDENCE_RECEIVED', 'AUTHORITY_DOCUMENT'); confirmDelivery(noArrival);
    assert.deepEqual(codes(await evalM(noArrival)), ['SHIPMENT_MILESTONE_NOT_REACHED']);

    const reportedOnly = seed({ type }); addDoc(reportedOnly); setShipment(reportedOnly, 'ARRIVED'); addCustomsEvent(reportedOnly, 'RELEASE_EVIDENCE_RECEIVED', 'AGENT_REPORT'); confirmDelivery(reportedOnly);
    assert.deepEqual(codes(await evalM(reportedOnly)), ['DESTINATION_RELEASE_NOT_EVIDENCED'], 'a reported release is not an evidenced one');

    const observedNotConfirmed = seed({ type }); addDoc(observedNotConfirmed); setShipment(observedNotConfirmed, 'ARRIVED'); addCustomsEvent(observedNotConfirmed, 'RELEASE_EVIDENCE_RECEIVED', 'AUTHORITY_DOCUMENT'); addCustomsEvent(observedNotConfirmed, 'DELIVERY_OBSERVED', 'CARUP_OBSERVATION');
    assert.deepEqual(codes(await evalM(observedNotConfirmed)), ['DELIVERY_NOT_CONFIRMED'], 'a CarUp delivery observation is not the buyer\'s acknowledgement');
  });
}

test('FINAL: an unknown or REFUND milestone type is treated as FINAL', async () => {
  assert.equal(releaseRequirementsFor({ milestone_type: 'REFUND' }).releaseClass, RC.FINAL);
  assert.equal(releaseRequirementsFor({ milestone_type: 'SOMETHING_NEW' }).releaseClass, RC.FINAL);
  assert.equal(releaseRequirementsFor(null).releaseClass, RC.FINAL);
});

// ── Frozen authorities: read, never manufactured ─────────────────────────────

// ── T8 authority: record + governed type + reviewer verdict ─────────────────

test('T8: a document whose type requires verification and has no verdict BLOCKS', async () => {
  const c = seed({ type: 'PROGRESS' });
  addDoc(c, { verdict: null });
  const v = await evalM(c);
  assert.deepEqual(codes(v), ['DOCUMENTS_NOT_VERIFIED']);
  assert.match(v.blockers[0].message, /need a reviewer's verdict/);
});

test('T8: a reviewer VERIFIED verdict PASSES', async () => {
  const c = seed({ type: 'PROGRESS' });
  addDoc(c, { verdict: 'VERIFIED' });
  const v = await evalM(c);
  assert.equal(v.eligible, true, `blockers: ${codes(v)}`);
});

test('T8: a supplied document whose type does not require verification is NOT blocked', async () => {
  const c = seed({ type: 'PROGRESS' });
  addDoc(c, { document_type: 'PACKING_PHOTOS', verdict: null });
  const v = await evalM(c);
  assert.equal(v.eligible, true, `blockers: ${codes(v)}`);
  // …and the same unreviewed file under a type that DOES require a verdict blocks: the type decides.
  const strict = seed({ type: 'PROGRESS' });
  addDoc(strict, { document_type: 'COMMERCIAL_INVOICE', verdict: null });
  assert.deepEqual(codes(await evalM(strict)), ['DOCUMENTS_NOT_VERIFIED']);
});

test('T8: OCR/extraction is never verification — OCR_EXTRACTED, or even a VERIFIED status column, without a verdict blocks', async () => {
  const ocr = seed({ type: 'PROGRESS' });
  addDoc(ocr, { verdict: null, verification_status: 'OCR_EXTRACTED', ocr_document_id: 'ocr-1' });
  assert.deepEqual(codes(await evalM(ocr)), ['DOCUMENTS_NOT_VERIFIED']);
  // The document row's status column is not the verdict record.
  const columnOnly = seed({ type: 'PROGRESS' });
  addDoc(columnOnly, { verdict: null, verification_status: 'VERIFIED' });
  assert.deepEqual(codes(await evalM(columnOnly)), ['DOCUMENTS_NOT_VERIFIED']);
});

test('T8: a superseded VERIFIED version does not bless its replacement', async () => {
  const c = seed({ type: 'PROGRESS' });
  const old = addDoc(c, { verdict: 'VERIFIED', superseded_at: '2026-09-11T00:00:00Z' });
  addDoc(c, { verdict: null, version: 2, supersedes_document_id: old.id });
  assert.deepEqual(codes(await evalM(c)), ['DOCUMENTS_NOT_VERIFIED'], 'the verdict belongs to the version it was given on');
  // Once the replacement itself is verified, it passes.
  addVerdict(c, 'd-1', 'VERIFIED');
  assert.equal((await evalM(c)).eligible, true);

  // The converse: a rejected version that has been REPLACED no longer speaks for the transaction.
  const corrected = seed({ type: 'PROGRESS' });
  const bad = addDoc(corrected, { verdict: 'REJECTED', superseded_at: '2026-09-11T00:00:00Z' });
  addDoc(corrected, { verdict: 'VERIFIED', version: 2, supersedes_document_id: bad.id });
  const v = await evalM(corrected);
  assert.equal(v.eligible, true, `only the CURRENT version counts; blockers: ${codes(v)}`);
});

test('T8: legacy vehicle_government_documents neither satisfies nor vetoes the gate', async () => {
  const legacyOnly = seed({ type: 'PROGRESS' });
  legacyOnly._rows('vehicle_government_documents').push({ id: 'vg-1', import_order_id: 'ord-1', verification_status: 'VERIFIED' });
  assert.deepEqual(codes(await evalM(legacyOnly)), ['DOCUMENTS_NOT_VERIFIED'], 'the legacy table cannot satisfy');

  const legacyOpen = seed({ type: 'PROGRESS' });
  addDoc(legacyOpen, { verdict: 'VERIFIED' });
  legacyOpen._rows('vehicle_government_documents').push({ id: 'vg-1', import_order_id: 'ord-1', verification_status: 'PENDING' });
  legacyOpen._rows('vehicle_government_documents').push({ id: 'vg-2', import_order_id: 'ord-1', verification_status: 'REJECTED' });
  const v = await evalM(legacyOpen);
  assert.equal(v.eligible, true, `the legacy table cannot veto either; blockers: ${codes(v)}`);
});

test('T8: a REJECTED verdict BLOCKS — even for a type that needs no verification, and even after an earlier VERIFIED', async () => {
  const c = seed({ type: 'PROGRESS' });
  addDoc(c, { verdict: 'REJECTED' });
  const v = await evalM(c);
  assert.deepEqual(codes(v), ['DOCUMENTS_NOT_VERIFIED']);
  assert.match(v.blockers[0].message, /rejected/);

  const lenient = seed({ type: 'PROGRESS' });
  addDoc(lenient, { document_type: 'PACKING_PHOTOS', verdict: 'REJECTED' });
  assert.deepEqual(codes(await evalM(lenient)), ['DOCUMENTS_NOT_VERIFIED']);

  // The LATEST verdict is the verdict.
  const reversed = seed({ type: 'PROGRESS' });
  addDoc(reversed, { verdict: 'VERIFIED', verdictAt: '2026-09-10T00:00:00.000Z' });
  addVerdict(reversed, 'd-0', 'REJECTED', '2026-09-12T00:00:00.000Z');
  assert.deepEqual(codes(await evalM(reversed)), ['DOCUMENTS_NOT_VERIFIED']);
});

test('T8: one open document among verified ones still blocks; no documents at all blocks; an ungoverned type is held to a verdict', async () => {
  const mixed = seed({ type: 'PROGRESS' });
  addDoc(mixed, { verdict: 'VERIFIED' });
  addDoc(mixed, { verdict: null });
  assert.deepEqual(codes(await evalM(mixed)), ['DOCUMENTS_NOT_VERIFIED']);

  const none = seed({ type: 'PROGRESS' });
  assert.match((await evalM(none)).blockers[0].message, /No current trade document/);

  const ungoverned = seed({ type: 'PROGRESS' });
  addDoc(ungoverned, { document_type: 'SOMETHING_T8_DOES_NOT_KNOW', verdict: null });
  assert.deepEqual(codes(await evalM(ungoverned)), ['DOCUMENTS_NOT_VERIFIED']);
});

test('an evaluation writes NOTHING — no T8/T11/T12 fact, no milestone, no transaction, no dispute', async () => {
  const c = seed({ type: 'RELEASE' });
  addDoc(c, { verdict: null }); setShipment(c, 'IN_TRANSIT');
  const tables = ['diaspora_trade_documents', 'diaspora_trade_document_verifications', 'trade_document_types', 'vehicle_government_documents', 'diaspora_shipments', 'diaspora_customs_cases', 'diaspora_customs_events', 'diaspora_safetrade_milestones', 'diaspora_safetrade_transactions', 'diaspora_safetrade_disputes', 'diaspora_safetrade_release_evaluations', 'diaspora_safetrade_operations', 'diaspora_import_audit_log'];
  const before = JSON.stringify(tables.map((t) => c._rows(t)));
  const v = await evalM(c);
  assert.equal(v.eligible, false);
  assert.equal(JSON.stringify(tables.map((t) => c._rows(t))), before, 'the policy engine must be read-only');
});

// ── Disputes ─────────────────────────────────────────────────────────────────

test('DISPUTE: an active dispute record blocks an otherwise releasable deposit, even if the transaction status lags', async () => {
  const c = seed({ type: 'DEPOSIT' });
  assert.equal((await evalM(c)).eligible, true, 'positive control');
  c._rows('diaspora_safetrade_disputes').push({ id: 'dp-1', transaction_id: 'st-1', milestone_id: null, status: 'UNDER_REVIEW' });
  assert.ok(codes(await evalM(c)).includes('ACTIVE_DISPUTE'));
});

test('DISPUTE: a DISPUTED transaction blocks every class; a resolved dispute does not', async () => {
  for (const type of ['DEPOSIT', 'SHIPMENT', 'RELEASE']) {
    const c = seed({ type, txnStatus: 'DISPUTED' });
    assert.ok(codes(await evalM(c)).includes('ACTIVE_DISPUTE'), `${type} must be blocked`);
  }
  const resolved = seed({ type: 'DEPOSIT' });
  resolved._rows('diaspora_safetrade_disputes').push({ id: 'dp-2', transaction_id: 'st-1', status: 'RESOLVED' });
  assert.equal((await evalM(resolved)).eligible, true);
});

test('the engine\'s active-dispute statuses are exactly the dispute service\'s', async () => {
  for (const status of SAFETRADE_ACTIVE_DISPUTE_STATUSES) {
    const c = seed({ type: 'DEPOSIT' });
    c._rows('diaspora_safetrade_disputes').push({ id: `dp-${status}`, transaction_id: 'st-1', status });
    assert.ok(codes(await evalM(c)).includes('ACTIVE_DISPUTE'), `${status} must block`);
  }
});

// ── Maker-checker and actor authority ────────────────────────────────────────

test('MAKER-CHECKER: a HIGH-risk deposit still needs a recorded reviewer approval, however early', async () => {
  const c = seed({ type: 'DEPOSIT', total: 30000 });
  const v = await evalM(c);
  assert.equal(v.riskTier, 'HIGH');
  assert.deepEqual(codes(v), ['REVIEWER_APPROVAL_REQUIRED']);
  // An evaluation row with no evaluator does not bless it.
  c._rows('diaspora_safetrade_release_evaluations').push({ id: 'ev-x', transaction_id: 'st-1', milestone_id: 'm-1', eligible: true, requires_reviewer: true, evaluated_by: null, evaluated_at: FIXED_TS });
  assert.deepEqual(codes(await evalM(c)), ['REVIEWER_APPROVAL_REQUIRED']);
  c._rows('diaspora_safetrade_release_evaluations').push({ id: 'ev-y', transaction_id: 'st-1', milestone_id: 'm-1', eligible: true, requires_reviewer: true, evaluated_by: 'rev-2', evaluated_at: '2026-09-26T13:00:00.000Z' });
  assert.equal((await evalM(c)).eligible, true, 'positive control: a reviewed approval record clears it');
});

test('ACTOR: a non-reviewer can neither evaluate nor execute a release, even of an early milestone', async () => {
  const c = seed({ type: 'DEPOSIT' });
  assert.ok(codes(await evalM(c, buyer)).includes('ACTOR_NOT_AUTHORIZED'));
  await assert.rejects(
    () => recordMilestone(c, { transactionId: 'st-1', milestoneId: 'm-1', operation: 'RELEASE', userContext: buyer, req: { fixedTimestamp: FIXED_TS } }),
    (err) => { assert.equal(err.details?.code, 'REVIEWER_REQUIRED'); return true; },
  );
});

// ── Money truth ──────────────────────────────────────────────────────────────

test('MONEY: eligible:true is permission, not money — the milestone is still HELD and nothing is released', async () => {
  const c = seed({ type: 'DEPOSIT' });
  const v = await evalM(c);
  assert.equal(v.eligible, true);
  const [milestone] = c._rows('diaspora_safetrade_milestones');
  assert.equal(milestone.status, 'HELD');
  assert.equal(c._rows('diaspora_safetrade_operations').length, 0, 'no provider operation was dispatched');
  const truth = projectSafeTradeMoneyTruth({ transaction: c._rows('diaspora_safetrade_transactions')[0], milestones: c._rows('diaspora_safetrade_milestones'), operations: [] });
  assert.equal(truth.milestonePlan.heldAmount, 1000, 'the money is still held');
  assert.equal(truth.milestonePlan.releasedAmount, 0, 'release approval is not funds released');
  assert.equal(truth.provider.ledgerAppliedCount, 0);
  assert.equal(truth.firewalls.customsPaymentEvidenceIsSettlement, false);
  assert.equal(truth.settlementFx, null);
});

// ── Policy pins ──────────────────────────────────────────────────────────────

test('every schema milestone type is classified; REFUND deliberately falls to FINAL', () => {
  for (const type of Object.values(SAFETRADE_MILESTONE_TYPES)) {
    if (type === 'REFUND') { assert.equal(MILESTONE_RELEASE_POLICY[type], undefined); continue; }
    assert.ok(MILESTONE_RELEASE_POLICY[type], `${type} must be classified`);
  }
  assert.deepEqual(releaseRequirementsFor({ milestone_type: 'DEPOSIT' }).requires, []);
  assert.deepEqual(releaseRequirementsFor({ milestone_type: 'RELEASE' }).requires.sort(), ['DELIVERY_CONFIRMED', 'DESTINATION_RELEASE_EVIDENCED', 'DOCUMENTS_VERIFIED', 'SHIPMENT_ARRIVED']);
});
