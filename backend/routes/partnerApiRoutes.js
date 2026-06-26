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
 *   GET /api/partner/v1/vehicles/:vin/fraud-summary      scope: vehicle:risk
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { requirePartnerScope } from '../middleware/partnerAuth.js';
import { getTrustDecision, toPublicDecision } from '../services/trustDecision/trustDecisionService.js';
import { getCoverage } from '../services/sourceVerification/sourceVerificationService.js';

const router = express.Router();
const BASE = '/api/partner/v1';

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
router.get(`${BASE}/vehicles/:vin/fraud-summary`, requirePartnerScope('vehicle:risk'), async (req, res, next) => {
  try {
    const decision = await getTrustDecision(req.params.vin);
    const fr = decision.dimensions.fraud_risk;
    const sc = decision.dimensions.source_conflicts;
    res.json({ risk: { fraud_status: fr.status, conflicts: sc.status, reason_codes: fr.reason_codes } });
  } catch (err) { next(err); }
});

export default router;
