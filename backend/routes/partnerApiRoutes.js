/**
 * Partner API v1 — Workstream 9.
 *
 * Versioned, scoped, audited, redacted read API for approved external consumers. Every
 * endpoint requires an API key with the matching scope. Responses contain only permitted,
 * buyer/partner-safe data — never raw provider payloads, private owner PII, or internal
 * reviewer notes.
 *
 *   GET /api/partner/v1/ping                              scope: none (key only)
 *   GET /api/partner/v1/vehicles/:vin/identity           scope: vehicle:identity
 *   GET /api/partner/v1/vehicles/:vin/trust-summary      scope: vehicle:trust
 *   GET /api/partner/v1/vehicles/:vin/source-coverage    scope: vehicle:sources
 *   GET /api/partner/v1/vehicles/:vin/fraud-summary      scope: fraud:read_summary
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { requirePartnerScope } from '../middleware/partnerAuth.js';
import { getTrustDecision, toPublicDecision } from '../services/trustDecision/trustDecisionService.js';
import { getCoverage } from '../services/sourceVerification/sourceVerificationService.js';
import { requestEligibility, getLatestStatus } from '../services/eligibility/eligibilityService.js';
import { listSessionsForVin } from '../services/escrow/escrowTrustService.js';
import { getBuyerSafeSummary } from '../services/dealer/dealerComplianceService.js';

const router = express.Router();
const BASE = '/api/partner/v1';

// Build eligibility gate context from the unified decision (consistent with internal routes).
async function partnerGateContext(vin) {
  try {
    const d = await getTrustDecision(vin);
    return {
      identity_status: d.dimensions.identity.status,
      fraud_block: d.dimensions.fraud_risk.status === 'high',
      publication_status: d.dimensions.publication_eligibility.value,
      source_coverage_connected: d.dimensions.source_coverage.connected ?? 0,
      min_source_coverage: 0,
    };
  } catch { return { identity_status: 'incomplete' }; }
}

router.get(`${BASE}/ping`, requirePartnerScope(null), (req, res) => {
  res.json({ ok: true, partner: req.partner?.name, ts: new Date().toISOString() });
});

// Vehicle identity — canonical identity fields only. No owner PII.
router.get(`${BASE}/vehicles/:vin/identity`, requirePartnerScope('vehicle:identity'), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('vin, make, model, year, plate_number')
      .eq('vin', req.params.vin)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'vehicle not found' });
    // Explicit allowlist projection — never pass the raw row through (defense in depth).
    res.json({ identity: { vin: data.vin, make: data.make, model: data.model, year: data.year, plate_number: data.plate_number ?? null } });
  } catch (err) { next(err); }
});

// Trust summary — buyer/partner-safe unified decision (private dimensions stripped).
router.get(`${BASE}/vehicles/:vin/trust-summary`, requirePartnerScope('vehicle:trust'), async (req, res, next) => {
  try {
    const decision = await getTrustDecision(req.params.vin);
    res.json({ trust: toPublicDecision(decision) });
  } catch (err) { next(err); }
});

// Source coverage — status + mode per registry. No identity fields, no raw payloads.
router.get(`${BASE}/vehicles/:vin/source-coverage`, requirePartnerScope('vehicle:sources'), async (req, res, next) => {
  try {
    const coverage = await getCoverage(req.params.vin);
    res.json({ coverage: coverage.map((c) => ({ provider: c.provider, mode: c.mode, coverage_status: c.coverage_status, retrieved_at: c.retrieved_at })) });
  } catch (err) { next(err); }
});

// Fraud/risk summary — derived risk dimension only, no internal signal detail.
router.get(`${BASE}/vehicles/:vin/fraud-summary`, requirePartnerScope('fraud:read_summary'), async (req, res, next) => {
  try {
    const decision = await getTrustDecision(req.params.vin);
    const fr = decision.dimensions.fraud_risk;
    const sc = decision.dimensions.source_conflicts;
    res.json({ risk: { fraud_status: fr.status, conflicts: sc.status, open_cases: fr.open_cases ?? 0, reason_codes: fr.reason_codes } });
  } catch (err) { next(err); }
});

// Unified trust decision — redacted public projection (private dims stripped).
router.get(`${BASE}/vehicles/:vin/decision`, requirePartnerScope('trust:read'), async (req, res, next) => {
  try {
    res.json({ decision: toPublicDecision(await getTrustDecision(req.params.vin)) });
  } catch (err) { next(err); }
});

// Dealer compliance summary — buyer/partner-safe (no private documents/contacts/notes).
router.get(`${BASE}/dealers/:id/summary`, requirePartnerScope('dealer:read_summary'), async (req, res, next) => {
  try {
    const summary = await getBuyerSafeSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'dealer not found' });
    res.json({ dealer: summary });
  } catch (err) { next(err); }
});

// Insurance eligibility — request + status (status only; no applicant PII).
router.post(`${BASE}/vehicles/:vin/insurance`, requirePartnerScope('insurance:request'), async (req, res, next) => {
  try {
    const ctx = await partnerGateContext(req.params.vin);
    const request = await requestEligibility('insurance', req.params.vin, {
      requestedBy: `partner:${req.partner?.id}`, idempotencyKey: req.headers['idempotency-key'], gateContext: ctx,
    });
    res.status(201).json({ request: { vin: request.vin, capability: request.capability, status: request.status, mode: request.mode, conditions: request.conditions } });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});
router.get(`${BASE}/vehicles/:vin/insurance`, requirePartnerScope('insurance:read'), async (req, res, next) => {
  try {
    const s = await getLatestStatus('insurance', req.params.vin);
    res.json({ insurance: { vin: req.params.vin, status: s.status, mode: s.mode || null, conditions: s.conditions || [] } });
  } catch (err) { next(err); }
});

// Finance eligibility — request + STATUS ONLY. Never returns applicant/credit data.
router.post(`${BASE}/vehicles/:vin/finance`, requirePartnerScope('finance:request'), async (req, res, next) => {
  try {
    const ctx = await partnerGateContext(req.params.vin);
    const request = await requestEligibility('finance', req.params.vin, {
      requestedBy: `partner:${req.partner?.id}`, idempotencyKey: req.headers['idempotency-key'],
      consentReference: req.body?.consent_reference, gateContext: ctx,
    });
    res.status(201).json({ request: { vin: request.vin, capability: 'finance', status: request.status, mode: request.mode } });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});
router.get(`${BASE}/vehicles/:vin/finance`, requirePartnerScope('finance:read'), async (req, res, next) => {
  try {
    const s = await getLatestStatus('finance', req.params.vin);
    // Status only — no conditions detail, no applicant data.
    res.json({ finance: { vin: req.params.vin, status: s.status } });
  } catch (err) { next(err); }
});

// Escrow eligibility/status — latest session status only.
router.get(`${BASE}/vehicles/:vin/escrow`, requirePartnerScope('escrow:read'), async (req, res, next) => {
  try {
    const sessions = await listSessionsForVin(req.params.vin);
    const latest = sessions[0];
    res.json({ escrow: latest ? { vin: req.params.vin, status: latest.status } : { vin: req.params.vin, status: 'not_requested' } });
  } catch (err) { next(err); }
});

export default router;
