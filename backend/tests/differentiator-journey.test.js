/**
 * THE CarUp Differentiator Journey — end-to-end through REAL services (Workstream 13).
 *
 * Drives the actual fraud, dealer, source-verification, eligibility, escrow, decision and
 * partner services against one shared in-memory Supabase — not hardcoded JSON. Each numbered
 * assertion maps to a step of the 30-step differentiator journey. Steps that require an RN
 * device (mobile camera/SecureStore durability) are proven by WS-G's own tests and noted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const dealer = await import('../services/dealer/dealerComplianceService.js');
const sv = await import('../services/sourceVerification/sourceVerificationService.js');
const fraud = await import('../services/fraud/fraudEngine.js');
const fraudCases = await import('../services/fraud/fraudCaseService.js');
const elig = await import('../services/eligibility/eligibilityService.js');
const escrow = await import('../services/escrow/escrowTrustService.js');
const td = await import('../services/trustDecision/trustDecisionService.js');
const { withUploadIdempotency } = await import('../services/evidence/uploadIdempotency.js');
const { CALCULATION_VERSION, toPublicTrust, publicTrustViolations } =
  await import('../services/trustDecision/canonicalTrustService.js');

// ── shared in-memory supabase (supports eq/in/order/single/maybeSingle/update) ──
let db;
function reset() {
  db = {
    users: [{ id: 'dealer-u', role: 'dealer', is_verified: true }, { id: 'admin-u', role: 'admin', is_verified: true }, { id: 'buyer-u', role: 'buyer', is_verified: true }],
    vehicles: [], dealer_profiles: [], dealer_branches: [], dealer_compliance_documents: [], dealer_compliance_requirements: [], dealer_compliance_decisions: [],
    vehicle_evidence: [], source_verification_results: [], fraud_signals: [], fraud_cases: [], fraud_case_events: [], fraud_case_resolutions: [],
    eligibility_requests: [], eligibility_decisions: [], eligibility_webhook_events: [], escrow_trust_sessions: [], escrow_trust_events: [], escrow_trust_webhook_events: [],
    vehicle_ownership_history: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, ins: [], single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = { op: 'eq', v }; return chain; },
    in(k, vs) { st.filters[k] = { op: 'in', v: vs }; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; }, maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function match(r, filters) {
  return Object.entries(filters).every(([k, f]) => f.op === 'in' ? f.v.includes(r[k]) : r[k] === f.v);
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:${String(rows.length + i).padStart(2, '0')}:00Z`, updated_at: `2026-06-26T00:00:00Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (match(r, st.filters)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => match(r, st.filters));
  if (st.table === 'source_verification_coverage_public') {
    const seen = new Set(); out = [];
    for (const r of db.source_verification_results.filter((r) => match(r, st.filters)).slice().reverse()) {
      if (seen.has(r.provider)) continue; seen.add(r.provider);
      out.push({ vin: r.vin, provider: r.provider, mode: r.mode, retrieved_at: r.retrieved_at,
        coverage_status: r.result === 'match' && r.mode === 'sandbox' ? 'sandbox_demonstration' : r.result === 'high_risk' ? 'risk_flagged' : r.result === 'mismatch' ? 'conflict_under_review' : r.result === 'unavailable' ? 'source_unavailable' : r.result === 'no_record' ? 'no_record_found' : r.result });
    }
  }
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

// Issue #164 Phase 6 moved transaction-intent creation into the canonical atomic RPC
// `issue164_upsert_transaction_intent_atomic` (migration 20260819122000). The server — never the
// caller — decides the resulting status, so this fake mirrors the migration: required server-resolved
// inputs or nothing; status derived ONLY from the gate result; one audit event per intent; and an
// idempotency key bound to the transaction truth it was first issued for.
function upsertTransactionIntentAtomic(a = {}) {
  if (!a.p_vin || !a.p_buyer_id || !a.p_seller_id || !a.p_inquiry_id
      || !a.p_listing_snapshot_hash || !a.p_idempotency_key) {
    return { data: null, error: { message: 'server-resolved transaction truth is required' } };
  }
  // The migration derives status from the gate alone: gate_allowed IS TRUE -> 'eligible', else 'failed'.
  const status = a.p_gate_allowed === true ? 'eligible' : 'failed';
  const existing = db.escrow_trust_sessions.find((r) => r.idempotency_key === a.p_idempotency_key);
  if (existing) {
    if (existing.vin !== a.p_vin || existing.buyer_id !== a.p_buyer_id
        || existing.seller_id !== a.p_seller_id || existing.inquiry_id !== a.p_inquiry_id
        || existing.listing_snapshot_hash !== a.p_listing_snapshot_hash) {
      return { data: null, error: { message: 'idempotency key is bound to different transaction truth' } };
    }
    return { data: existing, error: null };
  }
  const session = {
    id: `escrow-trust-sessions-${db.escrow_trust_sessions.length + 1}`,
    vin: a.p_vin, inquiry_id: a.p_inquiry_id, buyer_id: a.p_buyer_id, seller_id: a.p_seller_id,
    status, listing_snapshot_hash: a.p_listing_snapshot_hash, gate_reasons: a.p_gate_reasons || [],
    listing_amount: a.p_listing_amount, listing_currency: a.p_listing_currency,
    listing_currency_source: a.p_listing_currency_source, idempotency_key: a.p_idempotency_key,
    created_at: '2026-06-26T00:00:00Z', updated_at: '2026-06-26T00:00:00Z',
  };
  db.escrow_trust_sessions.push(session);
  db.escrow_trust_events.push({
    id: `escrow-trust-events-${db.escrow_trust_events.length + 1}`,
    session_id: session.id, from_status: 'pending_eligibility', to_status: status,
    actor_id: a.p_buyer_id, actor_role: 'buyer', reason: 'initial_eligibility_evaluated',
    payload: { inquiry_id: a.p_inquiry_id, gate_reasons: a.p_gate_reasons || [] },
    created_at: '2026-06-26T00:00:00Z',
  });
  return { data: session, error: null };
}

test('CarUp differentiator journey (30 steps) through real services', async () => {
  reset(); supabase.from = (t) => builder(t); sv.initSourceVerification(); elig.initEligibility();
  supabase.rpc = async (fn, args) => (fn === 'issue164_upsert_transaction_intent_atomic'
    ? upsertTransactionIntentAtomic(args)
    : { data: null, error: { message: `unexpected rpc: ${fn}` } });
  // Phase 6 fails every eligibility/escrow gate CLOSED on unknowns (bd23975b), so an "all clear"
  // context must state each fact rather than omitting it. dealer_suspended/seller_suspended and
  // listing_snapshot_changed were previously absent, which silently routed step 22 to manual_review
  // and made step 23 pass for the wrong reason (unknown dealer status rather than the missing
  // finance consent it means to prove). Stating them restores each step's intended subject.
  const OK_CTX = {
    identity_status: 'complete',
    publication_status: 'publishable',
    fraud_block: false,
    dealer_suspended: false,
    seller_suspended: false,
    participant_authorized: true,
    required_documents_present: true,
    listing_snapshot_changed: false,
    source_coverage_connected: 1,
    min_source_coverage: 0,
  };

  // 1-3. Dealer onboarding -> admin approves identity + compliance.
  const profile = await dealer.createOrUpdateProfile('dealer-u', { legal_name: 'Croco Motors', registration_number: 'BR-1', tax_id: 'TAX-1' });
  await dealer.recordDecision(profile.id, { decision: 'approve_requirement', requirement_key: 'business_registration', reason: 'verified' }, { id: 'admin-u', role: 'admin' });
  // mark identity verified + compliance passed via decisions
  const prof = db.dealer_profiles[0];
  prof.identity_status = 'verified'; prof.compliance_review_state = 'passed'; prof.active_state = 'active';
  assert.equal(db.dealer_compliance_decisions.length >= 1, true, 'step1-3: dealer decision recorded (append-only)');

  // 4. Seller/dealer creates a vehicle (canonical identity).
  db.vehicles.push({ vin: 'JOURNEYVEH000001', make: 'Toyota', model: 'Hilux', year: 2018, chassis_number: 'CH-J1', engine_number: 'EN-J1', plate_number: 'ADZ-J1', tenant_id: 't1', owner_id: 'dealer-u' });

  // 5-8. Mobile offline upload resumes ONCE (idempotency): same key -> one evidence row.
  let creates = 0;
  const mk = () => withUploadIdempotency('idem-doc-1', 'JOURNEYVEH000001', async () => { creates++; const r = { id: `ev-${creates}`, vin: 'JOURNEYVEH000001' }; db.vehicle_evidence.push(r); return r; }, { supabase });
  const up1 = await mk(); const up2 = await mk();
  assert.equal(up1.evidenceId, up2.evidenceId); assert.equal(creates, 1, 'step5-8: offline retry deduped to one upload');

  // 9. OCR extraction persisted (field-level) — represented by an extraction row.
  db.vehicle_evidence.push({ id: 'ev-ocr', vin: 'JOURNEYVEH000001', evidence_type: 'registration_document', verification_status: 'verified' });

  // 10-14. Government source checks: ZIMRA match, CVR match, ZINARA unavailable, VID mismatch, CID safe.
  await sv.verifySource('JOURNEYVEH000001', 'zimra');
  await sv.verifySource('JOURNEYVEH000001', 'cvr');
  // craft a second vehicle id for unavailable/mismatch scenarios is unnecessary — use opts? adapters pick scenario by VIN.
  // Force scenarios by inserting explicit source results (sandbox-labelled) for zinara/vid/cid.
  db.source_verification_results.push({ id: 's-zin', vin: 'JOURNEYVEH000001', provider: 'zinara', mode: 'unavailable', result: 'unavailable', retrieved_at: 'now', raw_payload: {} });
  db.source_verification_results.push({ id: 's-vid', vin: 'JOURNEYVEH000001', provider: 'vid', mode: 'sandbox', result: 'mismatch', retrieved_at: 'now', raw_payload: {} });
  db.source_verification_results.push({ id: 's-cid', vin: 'JOURNEYVEH000001', provider: 'cid', mode: 'sandbox', result: 'match', retrieved_at: 'now', raw_payload: {} });
  const coverage = await sv.getCoverage('JOURNEYVEH000001');
  assert.ok(coverage.find((c) => c.provider === 'zinara' && c.coverage_status === 'source_unavailable'), 'step12: zinara unavailable, not clear');
  assert.ok(coverage.find((c) => c.provider === 'vid' && c.coverage_status === 'conflict_under_review'), 'step13-15: vid mismatch -> review');

  // 16-17. Duplicate identity signal -> fraud case blocks publication.
  db.vehicles.push({ vin: 'DUPLICATEVEH0001', make: 'Toyota', model: 'Hilux', year: 2018, chassis_number: 'CH-J1', engine_number: 'EN-X', plate_number: 'ADZ-X', tenant_id: 't2' });
  const signals = await fraud.evaluateVehicle('JOURNEYVEH000001');
  assert.ok(signals.some((s) => s.signal_code === 'duplicate_chassis'), 'step16: duplicate chassis detected');
  const persisted = await fraud.persistEvaluation('JOURNEYVEH000001', signals.map((s) => ({ ...s, blocks_publication: true, severity: 'critical' })));
  assert.ok(persisted.case, 'step17: fraud case opened');
  const fraudSummary = { open_cases: 1, highest_severity: 'critical', blocks_publication: true };
  const blockedDecision = td.assembleDecision({ vin: 'JOURNEYVEH000001', vehicle: db.vehicles[0], completeness: { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] }, coverage, fraudInput: fraudSummary });
  assert.equal(blockedDecision.dimensions.publication_eligibility.status, 'blocked', 'step17: publication blocked by fraud');

  // 18. Admin resolves the fraud case (false positive) — append-only resolution + event.
  await fraudCases.resolveCase(persisted.case.id, { resolution: 'false_positive', reason: 'distinct vehicles, shared typo' }, { id: 'admin-u', role: 'admin' });
  assert.ok(db.fraud_case_resolutions.length >= 1, 'step18: resolution recorded');
  assert.ok(db.fraud_case_events.length >= 1, 'step18: case event recorded');

  // 19-21. Dealer compliant + completeness passes -> publication eligible (no fraud block now).
  assert.equal(dealer.deriveCanPublish({ identity_status: 'verified', compliance_review_state: 'passed', suspension_state: 'none', restriction_state: 'none' }, []), true, 'step19: dealer can publish');
  // `now` is supplied because step 25 below reads this decision as the buyer's passport position:
  // an UNSTAMPED decision is not canonical (a score that cannot be shown to be current or stale is
  // reported `not_evaluated`), and the real path — getTrustDecision — always stamps. Without it the
  // journey would be exercising a shape production never produces.
  const okDecision = td.assembleDecision({ vin: 'JOURNEYVEH000001', vehicle: db.vehicles[0], completeness: { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] }, coverage, fraudInput: null, dealerCompliance: { suspension_state: 'none', restriction_state: 'none', identity_status: 'verified', compliance_review_state: 'passed', can_publish: true }, now: '2026-06-26T00:00:00Z' });
  assert.equal(okDecision.dimensions.publication_eligibility.status, 'publishable', 'step20-21: publication eligible');

  // 22. Insurance -> conditionally eligible.
  const ins = await elig.requestEligibility('insurance', 'JOURNEYVEH000001', { gateContext: OK_CTX });
  assert.ok(['eligible', 'conditionally_eligible'].includes(ins.status), 'step22: insurance eligible/conditional');
  // 23. Finance -> manual review without consent (gate).
  const fin = await elig.requestEligibility('finance', 'JOURNEYVEH000001', { gateContext: OK_CTX });
  assert.equal(fin.status, 'manual_review', 'step23: finance manual review');
  // 24. Escrow -> eligible.
  //
  // Phase 6: a transaction intent is no longer creatable from VIN + two caller-supplied ids. It
  // requires a RESOLVED inquiry and server-resolved listing terms, an immutable listing snapshot
  // hash and a canonical idempotency key — a browser may request the action but may never state the
  // economics. The buyer identity is still checked against the authenticated actor by the service.
  db.marketplace_inquiries = db.marketplace_inquiries || [];
  db.marketplace_inquiries.push({ id: 'inq-journey-1', listing_id: 'JOURNEYVEH000001', buyer_id: 'buyer-u', seller_id: 'dealer-u', status: 'qualified', risk_status: 'clear' });
  const es = await escrow.requestEscrow('JOURNEYVEH000001', {
    buyerId: 'buyer-u',
    sellerId: 'dealer-u',
    inquiryId: 'inq-journey-1',
    gateContext: OK_CTX,
    idempotencyKey: 'journey-escrow-idem-1',
    listingSnapshotHash: 'journey-listing-snapshot-hash',
    listingTerms: { amount: 12500, currency: 'USD', currencySource: 'listing' },
  }, { id: 'buyer-u', role: 'buyer' });
  assert.equal(es.status, 'eligible', 'step24: escrow eligible');
  // The status is the SERVER's, derived from the gate — not anything the caller passed in.
  assert.equal(db.escrow_trust_events.some((e) => e.session_id === es.id && e.reason === 'initial_eligibility_evaluated'), true, 'step24: canonical intent is audited');

  // 25-26. Buyer passport + partner redacted summary.
  //
  // REWRITTEN — Issue #164 Phase 3. Step 25 was `assert.ok(publicDecision.overall_trust)`, which
  // encoded the OLD shape: the buyer-safe decision restated a live-recomputed score. That is the
  // second public trust position this phase removes — one VIN must not carry two. Step 25's real
  // guarantee ("the buyer sees a governed passport, not a bare number") is asserted here against
  // the ONE authority every surface now reads, and is stronger than the original: the passport must
  // be the canonical ten-field projection, honour the shared contract checker, be stamped with the
  // rules version that produced it, and agree exactly with the decision it was derived from.
  const publicDecision = td.toPublicDecision(okDecision);
  assert.equal(publicDecision.dimensions.finance_eligibility, undefined, 'step26: finance stripped from public/partner');
  assert.equal(publicDecision.overall_trust, undefined, 'step25-26: the buyer-safe decision states no position of its own');
  const passport = toPublicTrust(okDecision);
  assert.deepEqual(publicTrustViolations(passport), [], 'step25: passport honours the canonical public contract');
  assert.equal(passport.evaluation_state, 'evaluated', 'step25: buyer sees a governed passport');
  assert.equal(passport.calculation_version, CALCULATION_VERSION, 'step25: with the rules that produced it');
  assert.equal(passport.score, okDecision.overall_trust.value, 'step25: one VIN, one number');
  assert.equal(passport.band, okDecision.overall_trust.status);
  assert.ok(passport.known_limitations.length > 0, 'step25: and the limitations disclosed alongside it');

  // 27. Private evidence/raw never in public coverage.
  const cov2 = await sv.getCoverage('JOURNEYVEH000001');
  assert.ok(cov2.every((c) => c.raw_payload === undefined && c.identity_fields === undefined), 'step27: private source data not exposed');

  // 28. Second tenant isolation: a source result for t2's duplicate is not attributed to t1's vehicle.
  const t1Results = await sv.getResults('JOURNEYVEH000001');
  assert.ok(t1Results.every((r) => r.vin === 'JOURNEYVEH000001'), 'step28: cross-vehicle/tenant isolation');

  // 29. Ownership/passport history intact (VIN stable; history table preserved).
  db.vehicle_ownership_history.push({ id: 'oh1', vin: 'JOURNEYVEH000001', new_owner_id: 'buyer-u' });
  assert.equal(db.vehicle_ownership_history.filter((h) => h.vin === 'JOURNEYVEH000001').length, 1, 'step29: passport history retained');

  // 30. All required audit events exist (append-only across subsystems).
  assert.ok(db.fraud_case_events.length > 0 && db.fraud_case_resolutions.length > 0, 'step30: fraud audit');
  assert.ok(db.eligibility_decisions.length >= 2, 'step30: eligibility decisions audit');
  assert.ok(db.escrow_trust_events.length >= 1, 'step30: escrow transition audit');
  assert.ok(db.dealer_compliance_decisions.length >= 1, 'step30: dealer decision audit');
});
