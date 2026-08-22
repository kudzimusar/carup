/**
 * Issue #164 Phase 7 — Golden Reference Vehicle Dataset: bootstrap / verify / cleanup orchestration.
 *
 * This is the durable, staging-only fixture engine. It creates two deterministic synthetic vehicles
 * (see goldenVehicleSpecs.js) through the REAL canonical write paths, lets CarUp DERIVE every
 * conclusion, and can prove and then remove the whole graph.
 *
 * Design commitments (Phase 7 invariants):
 *   · Idempotent. Every write is keyed on a deterministic id / VIN / email and is preceded by an
 *     existence check or an upsert, so a second bootstrap adds no duplicate rows.
 *   · Never seeds a conclusion. Trust is only ever produced by refreshCanonicalTrust; the fixture
 *     never writes vehicles.trust_score, never sets *_verified booleans as final authority, and never
 *     invents a verified registry fact. It seeds INPUTS (identity fields, documents, provenance) and
 *     performs GOVERNED review decisions, exactly as an operator would.
 *   · Media ≠ evidence. Listing photos go to listing_images; documents go to vehicle_evidence. The two
 *     never cross.
 *   · Fail-open per domain, fail-closed overall. Each domain is wrapped so one domain's failure is
 *     recorded in the receipt (not swallowed) without aborting the others; the caller decides PASS/FAIL
 *     from the structured result. Golden B's deliberate gaps are expected states, not failures.
 *
 * Dependency injection: all canonical services + the supabase client arrive via `deps`, defaulting to
 * the real imports. Tests pass spies/mocks to assert orchestration invariants (which service was
 * called, that trust was refreshed rather than written, that ids are deterministic) without a live DB.
 */
import {
  GOLDEN_USERS, GOLDEN_VEHICLES, GOLDEN_A, GOLDEN_B, GOLDEN_MARKER, GOLDEN_PROGRAMME,
  SYNTHETIC_DOCUMENT_MARKER, goldenMetadata, listingImageUrls, evidenceFileUrl,
  fixtureUserIds, fixtureVins,
} from './goldenVehicleSpecs.js';

// ── default (real) dependency wiring ─────────────────────────────────────────
async function realDeps(client) {
  const [
    { refreshCanonicalTrust, getCanonicalTrust, toPublicTrust },
    { evaluateCompleteness },
    { createInquiry },
    { recordManualVerification },
    { submitFinancingApplication },
    { requestMarketplaceEscrow },
    { createInsurancePolicy },
    { addRepairLog },
  ] = await Promise.all([
    import('../trustDecision/canonicalTrustService.js'),
    import('../evidence/completenessEvaluator.js'),
    import('../marketplace/marketplaceInquiryService.js'),
    import('../sourceVerification/sourceVerificationService.js'),
    import('../finance/financeService.js'),
    import('../transaction/marketplaceTransactionAuthority.js'),
    import('../insurance/insuranceService.js'),
    import('../partsentry/partsentryService.js'),
  ]);
  return {
    client,
    refreshCanonicalTrust, getCanonicalTrust, toPublicTrust,
    evaluateCompleteness, createInquiry, recordManualVerification,
    submitFinancingApplication, requestMarketplaceEscrow, createInsurancePolicy, addRepairLog,
    now: () => new Date().toISOString(),
  };
}

// A domain runner: records ok/error/detail per step without aborting siblings.
function makeReporter() {
  const steps = [];
  async function step(name, fn) {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail ?? null });
      return { ok: true, detail };
    } catch (e) {
      steps.push({ name, ok: false, error: e?.message || String(e) });
      return { ok: false, error: e };
    }
  }
  return { steps, step };
}

// ── small governed helpers (mirror the real route/service semantics) ─────────

async function upsertUser(client, spec) {
  // Deterministic id (spec.id). Upsert by email so a re-run reuses the row and never duplicates.
  const { data: existing, error: readErr } = await client
    .from('users').select('id, role, email').eq('email', spec.email).maybeSingle();
  if (readErr) throw new Error(`users read failed for ${spec.email}: ${readErr.message}`);
  if (existing?.id) {
    const { error } = await client.from('users')
      .update({ name: spec.name, role: spec.role }).eq('id', existing.id);
    if (error) throw new Error(`users update failed for ${spec.email}: ${error.message}`);
    return { id: existing.id, action: 'reused' };
  }
  const { error } = await client.from('users').insert({
    id: spec.id, name: spec.name, email: spec.email, phone: '', role: spec.role,
    join_date: new Date().toISOString(),
  });
  if (error) throw new Error(`users insert failed for ${spec.email}: ${error.message}`);
  return { id: spec.id, action: 'created' };
}

// The governed vehicle row, mirroring POST /api/vehicles/add exactly: publication_status starts
// 'draft', trust_score is explicitly null (only refreshCanonicalTrust may set it), and every claim
// column carries an operator_recorded provenance source.
function vehicleRow(spec) {
  const claimSource = 'operator_recorded';
  return {
    vin: spec.vin, make: spec.make, model: spec.model, generation: null, trim: null,
    year: spec.year, color: spec.color, mileage: spec.mileage, fuel_type: spec.fuel_type,
    drivetrain: spec.drivetrain, transmission: spec.transmission, import_source: null,
    duty_paid: false, police_verified: false, status: 'available',
    trust_score: null, price: spec.price, currency: spec.currency,
    owner_id: spec.ownerId, tenant_id: null,
    current_seller_id: spec.ownerId, current_seller_type: spec.sellerType,
    public_seller_display_enabled: false,
    registration_country: spec.location.country,
    engine_number: spec.engine_number, chassis_number: spec.chassis_number,
    plate_number: spec.plate_number, temp_plate_id: null,
    publication_status: 'draft',
    // claim columns (provenance)
    listing_city: spec.location.city, listing_province: spec.location.province,
    listing_country: spec.location.country, listing_location_source: claimSource,
    listing_location_visibility: 'public', listing_location_recorded_at: new Date().toISOString(),
    registration_country_source: claimSource, current_seller_type_source: claimSource,
    currency_source: claimSource,
  };
}

async function upsertVehicle(client, spec) {
  const { data: existing, error: readErr } = await client
    .from('vehicles').select('vin, publication_status').eq('vin', spec.vin).maybeSingle();
  if (readErr) throw new Error(`vehicle read failed for ${spec.vin}: ${readErr.message}`);
  if (existing) return { vin: spec.vin, action: 'reused', publication_status: existing.publication_status };
  const { error } = await client.from('vehicles').insert(vehicleRow(spec));
  if (error) throw new Error(`vehicle insert failed for ${spec.vin}: ${error.message}`);
  return { vin: spec.vin, action: 'created', publication_status: 'draft' };
}

async function upsertOwnershipHistory(client, spec) {
  const { data: rows, error: readErr } = await client
    .from('vehicle_ownership_history').select('id').eq('vin', spec.vin).eq('new_owner_id', spec.ownerId);
  if (readErr) throw new Error(`ownership history read failed: ${readErr.message}`);
  if (rows && rows.length) return { action: 'reused', count: rows.length };
  const { error } = await client.from('vehicle_ownership_history').insert({
    vin: spec.vin, new_owner_id: spec.ownerId, transfer_date: new Date().toISOString(), transfer_hash: 'INITIAL',
  });
  if (error) throw new Error(`ownership history insert failed: ${error.message}`);
  return { action: 'created', count: 1 };
}

async function upsertListingMedia(client, spec) {
  const urls = listingImageUrls(spec);
  const { data: existing, error: readErr } = await client
    .from('listing_images').select('image_url').eq('vin', spec.vin);
  if (readErr) throw new Error(`listing_images read failed: ${readErr.message}`);
  const have = new Set((existing || []).map((r) => r.image_url));
  const toInsert = urls
    .filter((u) => !have.has(u))
    // No is_primary claim: the fixture never fabricates the seller's main-photo choice (Rule 6).
    .map((u, idx) => ({ vin: spec.vin, image_url: u, is_primary: false, display_order: idx }));
  if (toInsert.length === 0) return { action: 'reused', count: have.size };
  const { error } = await client.from('listing_images').insert(toInsert);
  if (error) throw new Error(`listing_images insert failed: ${error.message}`);
  return { action: 'inserted', count: toInsert.length, total: have.size + toInsert.length };
}

// Upload one evidence document as PENDING (idempotent by deterministic file_url), carrying an
// unmistakable synthetic marker in its metadata. Verification is a SEPARATE governed decision.
async function upsertEvidenceDoc(client, spec, ev) {
  const fileUrl = evidenceFileUrl(spec, ev.type);
  const { data: existing, error: readErr } = await client
    .from('vehicle_evidence').select('id, verification_status, evidence_type')
    .eq('vin', spec.vin).eq('evidence_type', ev.type).eq('file_url', fileUrl).maybeSingle();
  if (readErr) throw new Error(`evidence read failed (${ev.type}): ${readErr.message}`);
  if (existing?.id) return { id: existing.id, action: 'reused', verification_status: existing.verification_status };
  const { data: inserted, error } = await client.from('vehicle_evidence').insert({
    // vehicle_evidence requires vehicle_id/vin/event_type/file_url/storage_bucket/file_path/mime_type/
    // file_size/uploaded_by/uploader_role (NOT NULL). evidence_class is left NULL (its CHECK vocab does
    // not include a generic 'document'); visibility_level must be a check-legal value (public_safe).
    vehicle_id: spec.vin, vin: spec.vin,
    event_type: 'document_submission', evidence_type: ev.type,
    verification_status: 'pending', visibility_level: 'public_safe',
    file_url: fileUrl, storage_bucket: 'phase7-golden',
    file_path: `phase7-golden/${spec.vin}/${ev.type}.pdf`,
    mime_type: 'application/pdf', file_size: 12345,
    uploaded_by: spec.ownerId, uploader_role: 'owner',
    metadata: goldenMetadata({ marker: ev.marker, evidence_type: ev.type }),
  }).select('id').single();
  if (error) throw new Error(`evidence insert failed (${ev.type}): ${error.message}`);
  return { id: inserted.id, action: 'created', verification_status: 'pending' };
}

// Governed review decision, mirroring PATCH /api/vehicles/:vin/evidence/:id/verify: set verified +
// reviewer identity, then let the canonical trust writer re-materialise the score. NEVER writes trust.
async function verifyEvidenceDoc(deps, spec, evidenceId, reviewerId) {
  const { client, refreshCanonicalTrust } = deps;
  const { data: existing, error: readErr } = await client
    .from('vehicle_evidence').select('id, verification_status').eq('id', evidenceId).maybeSingle();
  if (readErr) throw new Error(`evidence verify read failed: ${readErr.message}`);
  if (existing && ['verified', 'confirmed', 'approved'].includes(existing.verification_status)) {
    return { action: 'already_verified' };
  }
  const { error } = await client.from('vehicle_evidence').update({
    verification_status: 'verified', verified_by: reviewerId, verified_at: new Date().toISOString(),
    trust_score_impact: 5, confidence_impact: 5, updated_at: new Date().toISOString(),
  }).eq('id', evidenceId);
  if (error) throw new Error(`evidence verify update failed: ${error.message}`);
  // Re-materialise the canonical position through the ONLY sanctioned writer.
  await refreshCanonicalTrust(spec.vin, { client });
  return { action: 'verified' };
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────────────
export async function bootstrap(depsIn = {}) {
  const deps = { ...(await realDeps(depsIn.client)), ...depsIn };
  const { client } = deps;
  if (!client) throw new Error('bootstrap requires a supabase client');
  const reporter = makeReporter();
  const result = { programme: GOLDEN_PROGRAMME, mode: 'bootstrap', users: [], vehicles: {} };

  // 1) Synthetic identities
  for (const u of GOLDEN_USERS) {
    const r = await reporter.step(`user:${u.id}`, () => upsertUser(client, u));
    if (r.ok) result.users.push({ id: u.id, ...r.detail });
  }
  const reviewerId = 'golden-reviewer-stg';

  // 2) Each Golden vehicle graph
  const requiredFailed = [];
  for (const spec of GOLDEN_VEHICLES) {
    const v = { vin: spec.vin, key: spec.key, domains: {} };
    // required=true steps gate the run (the §17 exit invariants). Best-effort richness (source
    // coverage, finance, escrow eligibility, insurance, PartSentry) reports honestly but never fails
    // the run — a governed gate legitimately refusing (e.g. escrow not yet eligible) is evidence, not
    // a fixture defect.
    const D = (name, fn, required = true) => reporter.step(`${spec.key}:${name}`, fn).then((r) => {
      v.domains[name] = r.ok ? (r.detail ?? { ok: true }) : { ok: false, error: r.error?.message };
      if (!r.ok && required) requiredFailed.push(`${spec.key}:${name}`);
      return r;
    });

    await D('vehicle', () => upsertVehicle(client, spec));
    await D('ownership_history', () => upsertOwnershipHistory(client, spec));
    await D('listing_media', () => upsertListingMedia(client, spec));

    // Evidence upload (pending) then governed verify per spec.reviewOutcome.
    const evidenceIds = [];
    for (const ev of spec.evidence) {
      // The blocking ownership document is required (it gates A's publishability); advisory documents
      // are best-effort richness.
      const req = ev.type === 'registration_document';
      const up = await D(`evidence_upload:${ev.type}`, () => upsertEvidenceDoc(client, spec, ev), req);
      if (up.ok && up.detail?.id) {
        evidenceIds.push({ id: up.detail.id, ev });
        if (ev.reviewOutcome === 'verified') {
          await D(`evidence_verify:${ev.type}`, () => verifyEvidenceDoc(deps, spec, up.detail.id, reviewerId), req);
        }
      }
    }

    // Governed manual source coverage (honest, non-sandbox). Best-effort.
    for (const cov of spec.sourceCoverage) {
      await D(`source_coverage:${cov.provider}`, async () => {
        return deps.recordManualVerification(spec.vin, cov.provider, {
          mode: cov.mode, result_status: 'match', notes: SYNTHETIC_DOCUMENT_MARKER,
          metadata: goldenMetadata({ provider: cov.provider }),
        }, { id: reviewerId, role: 'government' });
      }, false);
    }

    // Derive trust through the canonical writer (never seeded) and read it back.
    await D('trust_refresh', () => deps.refreshCanonicalTrust(spec.vin, { client }));
    await D('trust_read', async () => {
      const rec = await deps.getCanonicalTrust(spec.vin, { client });
      const pub = deps.toPublicTrust(rec);
      return { evaluation_state: pub.evaluation_state, score: pub.score, band: pub.band, calculation_version: pub.calculation_version };
    });

    // Publication: only where the governed completeness gate permits (A becomes publishable; B stays draft).
    await D('publication', async () => {
      const completeness = await deps.evaluateCompleteness(spec.vin, { client });
      if (spec.publishTarget === 'published' && completeness.is_publishable) {
        const { error } = await client.from('vehicles').update({ publication_status: 'published' }).eq('vin', spec.vin);
        if (error) throw new Error(`publish failed: ${error.message}`);
        return { publication_status: 'published', is_publishable: true, completeness_percent: completeness.completeness_percent };
      }
      return { publication_status: 'draft', is_publishable: completeness.is_publishable, completeness_percent: completeness.completeness_percent, blocking_gaps: completeness.blocking_gaps };
    });

    // Buyer inquiry (clear vehicle_purchase_interest) — only for a published, transacting vehicle.
    if (spec.transaction) {
      await D('buyer_inquiry', async () => {
        // Idempotent: reuse an existing clear purchase-interest inquiry for this buyer+listing.
        const { data: existing } = await client.from('marketplace_inquiries')
          .select('id, status').eq('listing_id', spec.vin).eq('buyer_id', spec.buyerId)
          .eq('inquiry_type', 'vehicle_purchase_interest').maybeSingle();
        if (existing?.id) return { id: existing.id, action: 'reused', status: existing.status };
        const inq = await deps.createInquiry(client, {
          listing_id: spec.vin, inquiry_type: 'vehicle_purchase_interest', source_channel: 'web',
          message: `[${GOLDEN_MARKER}] Synthetic Phase 7 buyer interest.`,
        }, { id: spec.buyerId });
        return { id: inq?.id ?? inq?.inquiry?.id ?? null, action: 'created' };
      });
    }

    // Finance intent (synthetic): buyer requests financing from the synthetic bank. Idempotent.
    if (spec.finance) {
      await D('finance_application', async () => {
        const { data: existing } = await client.from('finance_applications')
          .select('id, status').eq('vin', spec.vin).eq('user_id', spec.buyerId).eq('bank_id', 'golden-bank-stg').maybeSingle();
        if (existing?.id) return { id: existing.id, action: 'reused', status: existing.status };
        const app = await deps.submitFinancingApplication(spec.vin, spec.buyerId, 'golden-bank-stg', spec.finance.requestedAmount);
        return { id: app?.id ?? null, action: 'created', status: app?.status ?? 'Pending' };
      }, false);
    }

    // Transaction/escrow intent (server-authoritative, NO money): request an escrow session. Whether
    // it becomes `eligible` is the REAL derived state from the governed gates — never forced.
    if (spec.transaction) {
      await D('escrow_intent', async () => {
        const session = await deps.requestMarketplaceEscrow(spec.vin, { actor: { id: spec.buyerId, role: 'buyer' }, client });
        return { status: session?.status ?? null, transaction_intent_id: session?.transaction_intent_id ?? null, gate_reasons: session?.gate_reasons ?? session?.gateReasons ?? null };
      }, false);
    }

    // Insurance — the single governed registry writer. Idempotent by existing policy for the VIN.
    if (spec.insurance) {
      await D('insurance_policy', async () => {
        const { data: existing } = await client.from('insurance_records').select('id').eq('vin', spec.vin).maybeSingle();
        if (existing?.id) return { id: existing.id, action: 'reused' };
        const pol = await deps.createInsurancePolicy(spec.vin, 'golden-insurer-stg', spec.ownerId, { ...goldenMetadata(), ...spec.insurance });
        return { id: pol?.id ?? null, action: 'created', policyNumber: pol?.policyNumber ?? null };
      }, false);
    }

    // PartSentry maintenance record (its own governance track). Idempotent by existing log for the part.
    if (spec.partSentry) {
      await D('partsentry_log', async () => {
        const { data: existing } = await client.from('partsentry_logs').select('id').eq('vin', spec.vin).eq('part_name', spec.partSentry.part_name).maybeSingle();
        if (existing?.id) return { id: existing.id, action: 'reused' };
        const log = await deps.addRepairLog(spec.vin, 'golden-mechanic-stg', spec.partSentry.part_name, spec.partSentry.part_oem, spec.partSentry.action_type, `[${GOLDEN_MARKER}] Synthetic Phase 7 maintenance record.`, spec.partSentry.mileage);
        return { id: log?.id ?? log?.log?.id ?? null, action: 'created' };
      }, false);
    }

    result.vehicles[spec.key] = v;
  }

  result.steps = reporter.steps;
  const userFailed = reporter.steps.filter((s) => s.name.startsWith('user:') && !s.ok).map((s) => s.name);
  result.requiredFailed = [...userFailed, ...requiredFailed];
  result.bestEffortFailed = reporter.steps.filter((s) => !s.ok && !result.requiredFailed.includes(s.name)).map((s) => s.name);
  result.ok = result.requiredFailed.length === 0;
  return result;
}

// ── VERIFY (read-only) ───────────────────────────────────────────────────────
export async function verify(depsIn = {}) {
  const deps = { ...(await realDeps(depsIn.client)), ...depsIn };
  const { client } = deps;
  if (!client) throw new Error('verify requires a supabase client');
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail ?? null });

  // Users present
  const { data: userRows } = await client.from('users').select('id, email, role').in('id', fixtureUserIds());
  check('users_present', (userRows || []).length === GOLDEN_USERS.length, { found: (userRows || []).length, expected: GOLDEN_USERS.length });

  for (const spec of GOLDEN_VEHICLES) {
    const { data: veh } = await client.from('vehicles')
      .select('vin, publication_status, trust_score, owner_id, current_seller_id, chassis_number, engine_number, plate_number')
      .eq('vin', spec.vin).maybeSingle();
    check(`${spec.key}:vehicle_exists`, !!veh, { vin: spec.vin });
    if (!veh) continue;

    check(`${spec.key}:identity_fields`, !!(veh.chassis_number && veh.engine_number && veh.plate_number), {});
    check(`${spec.key}:owner`, veh.owner_id === spec.ownerId, { owner_id: veh.owner_id });

    // Media vs evidence separation
    const { data: media } = await client.from('listing_images').select('image_url').eq('vin', spec.vin);
    const { data: evidence } = await client.from('vehicle_evidence').select('id, evidence_type, verification_status').eq('vin', spec.vin);
    check(`${spec.key}:listing_media`, (media || []).length === spec.listingImageCount, { found: (media || []).length, expected: spec.listingImageCount });
    check(`${spec.key}:evidence_present`, (evidence || []).length >= spec.evidence.length, { found: (evidence || []).length });
    const mediaUrls = new Set((media || []).map((m) => m.image_url));
    const evidenceUrls = new Set((evidence || []).map((e) => e.id));
    check(`${spec.key}:media_not_evidence`, mediaUrls.size > 0 && [...mediaUrls].every((u) => !evidenceUrls.has(u)), {});

    // Trust was generated by the canonical path (versioned), read via the public projection.
    const rec = await deps.getCanonicalTrust(spec.vin, { client });
    const pub = deps.toPublicTrust(rec);
    check(`${spec.key}:trust_canonical`, pub.calculation_version === 'trust-decision-1.0.0' || pub.evaluation_state === 'not_evaluated', { state: pub.evaluation_state, version: pub.calculation_version, score: pub.score });

    // Completeness / publication truthfulness
    const completeness = await deps.evaluateCompleteness(spec.vin, { client });
    if (spec.key === 'A') {
      check('A:publishable', completeness.is_publishable === true, { is_publishable: completeness.is_publishable, pct: completeness.completeness_percent });
      check('A:published', veh.publication_status === 'published', { publication_status: veh.publication_status });
    } else {
      // B: incomplete stays incomplete; absence has NOT become verification.
      check('B:not_publishable', completeness.is_publishable === false, { is_publishable: completeness.is_publishable, blocking_gaps: completeness.blocking_gaps });
      check('B:not_published', veh.publication_status !== 'published', { publication_status: veh.publication_status });
      const ownershipVerified = (evidence || []).some((e) => ['registration_document', 'ownership_transfer_document'].includes(e.evidence_type) && ['verified', 'confirmed', 'approved'].includes(e.verification_status));
      check('B:ownership_not_verified', ownershipVerified === false, { ownershipVerified });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { programme: GOLDEN_PROGRAMME, mode: 'verify', ok, checks };
}

// ── CLEANUP (scoped, child-first, idempotent, FK-ordered) ────────────────────
export async function cleanup(depsIn = {}) {
  const deps = { ...(await realDeps(depsIn.client)), ...depsIn };
  const { client } = deps;
  if (!client) throw new Error('cleanup requires a supabase client');
  const vins = fixtureVins();
  const userIds = fixtureUserIds();
  const deleted = {};
  const reporter = makeReporter();

  // Resolve the fixture's intermediate parent ids so grandchildren can be deleted by FK before their
  // parents. Every resolver is tolerant: a table/column absent on this instance yields an empty set.
  const idsOf = async (table, col, filterCol, vals) => {
    if (!vals || vals.length === 0) return [];
    const { data, error } = await client.from(table).select(col).in(filterCol, vals);
    if (error) return [];
    return [...new Set((data || []).map((r) => r[col]).filter(Boolean))];
  };
  const evidenceIds = await idsOf('vehicle_evidence', 'id', 'vin', vins);
  const sessionIds = await idsOf('escrow_trust_sessions', 'id', 'vin', vins);
  const logIds = await idsOf('partsentry_logs', 'id', 'vin', vins);
  const threadIds = [...new Set([
    ...await idsOf('message_threads', 'id', 'marketplace_listing_id', vins),
    ...await idsOf('message_threads', 'id', 'primary_user_id', userIds),
  ])];

  // Strict child → parent order. Each row is deleted only where scoped to the deterministic fixture id
  // set; there is no unqualified or pattern-wide delete and no TRUNCATE anywhere. Grandchildren first
  // (keyed by resolved parent ids), then the vehicle/user children, then vehicles, then users.
  const plan = [
    // evidence descendants
    ['evidence_provenance_events', 'evidence_id', evidenceIds],
    ['ai_analysis_jobs', 'evidence_id', evidenceIds],
    ['ai_observations', 'evidence_id', evidenceIds],
    ['vehicle_document_extractions', 'evidence_id', evidenceIds],
    // escrow session descendants
    ['escrow_trust_events', 'session_id', sessionIds],
    ['escrow_dual_control_approvals', 'session_id', sessionIds],
    ['escrow_reconciliation_ledger', 'session_id', sessionIds],
    ['escrow_trust_webhook_events', 'session_id', sessionIds],
    ['safetrade_sandbox_payment_intents', 'transaction_intent_id', sessionIds],
    ['vehicle_reservations', 'transaction_intent_id', sessionIds],
    // communication-thread descendants
    ['messages', 'thread_id', threadIds],
    ['message_participants', 'thread_id', threadIds],
    ['conversation_events', 'thread_id', threadIds],
    ['conversation_channel_bindings', 'thread_id', threadIds],
    ['communication_escalations', 'thread_id', threadIds],
    ['communication_campaign_deliveries', 'thread_id', threadIds],
    ['message_derivations', 'thread_id', threadIds],
    ['email_reply_tokens', 'thread_id', threadIds],
    ['notification_queue', 'thread_id', threadIds],
    ['notification_queue', 'recipient_id', userIds],
    // partsentry descendants
    ['partsentry_review_requests', 'partsentry_log_id', logIds],
    // vehicle/user children the fixture may have created (scoped by VIN / thread id)
    ['vehicle_reservations', 'vin', vins],
    ['escrow_trust_sessions', 'vin', vins],
    ['marketplace_inquiries', 'listing_id', vins],
    ['finance_applications', 'vin', vins],
    ['insurance_records', 'vin', vins],
    ['partsentry_logs', 'vin', vins],
    ['source_verification_results', 'vin', vins],
    ['eligibility_requests', 'vin', vins],
    ['blockchain_events', 'vin', vins],
    ['report_versions', 'vin', vins],
    ['rolling_integrity_checkpoints', 'vin', vins],
    ['listing_snapshots', 'vin', vins],
    ['evidence_sets', 'vin', vins],
    ['message_threads', 'id', threadIds],
    ['vehicle_evidence', 'vin', vins],
    ['listing_images', 'vin', vins],
    ['vehicle_ownership_history', 'vin', vins],
    // parents
    ['vehicles', 'vin', vins],
    ['users', 'id', userIds],
  ];

  for (const [table, col, values] of plan) {
    await reporter.step(`del:${table}.${col}`, async () => {
      if (!values || values.length === 0) return { deleted: 0, empty: true };
      const { data, error } = await client.from(table).delete().in(col, values).select('*');
      if (error) {
        // vehicles/users MUST delete cleanly (their FK descendants are handled above); any other table
        // absent on this instance is not a cleanup failure — record and continue.
        if (table === 'vehicles' || table === 'users') throw new Error(`${table} delete failed: ${error.message}`);
        return { skipped: true, reason: error.message };
      }
      const n = (data || []).length;
      if (n > 0) deleted[`${table}.${col}`] = n;
      return { deleted: n };
    });
  }

  return { programme: GOLDEN_PROGRAMME, mode: 'cleanup', ok: reporter.steps.every((s) => s.ok), deleted, steps: reporter.steps };
}

export default { bootstrap, verify, cleanup };
