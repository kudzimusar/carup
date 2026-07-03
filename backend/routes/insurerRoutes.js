/**
 * Licensed-Insurer provider routes — Vehicle Trust OS Full Activation (canonical doc §84–99).
 *
 *   POST /api/vehicles/:vin/insurer/consent        record an owner consent grant (returns consentRef)
 *   POST /api/vehicles/:vin/insurer/eligibility    request insurer eligibility (consent + gates)
 *   GET  /api/vehicles/:vin/insurer/eligibility    latest insurer status (public projection)
 *   POST /api/insurer/webhook                       signed insurer webhook (async decision)
 *   POST /api/admin/insurer/providers               onboard/update an insurer profile (admin)
 *   GET  /api/admin/insurer/providers               insurer provider-health board (admin)
 *   GET  /api/admin/insurer/vehicles/:vin/decisions full decision history for support (admin)
 *
 * Privacy: the public GET returns only the underwriting-free projection. The admin decision
 * history is the ONLY route that returns the full append-only ledger, and it is admin-gated.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';
import {
  requestInsurerEligibility, getInsurerStatus, getInsurerDecisionHistory,
  recordConsent, registerInsurerProfile, listInsurerProviders, ingestInsurerWebhook,
  INSURER_WEBHOOK_PROVIDER,
} from '../services/insurance/insurerWorkflow.js';

const router = express.Router();

// Derive gate inputs from the unified trust decision (identity/fraud/publication/dealer/source),
// consistent with eligibilityRoutes. Fail-closed if the decision cannot be computed.
async function gateContextFor(vin) {
  try {
    const d = await getTrustDecision(vin);
    return {
      identity_status: d.dimensions.identity.status,
      fraud_block: d.dimensions.fraud_risk.status === 'high',
      publication_status: d.dimensions.publication_eligibility.value,
      dealer_suspended: d.dimensions.dealer?.suspended === true,
      source_coverage_connected: d.dimensions.source_coverage.connected ?? 0,
      min_source_coverage: 0,
    };
  } catch {
    return { identity_status: 'incomplete' };
  }
}

// ── owner/dealer: consent + request + status ────────────────────────────────────

router.post('/api/vehicles/:vin/insurer/consent',
  authorizeRole(['owner', 'dealer', 'admin']),
  async (req, res, next) => {
    try {
      const consent = await recordConsent(req.params.vin, {
        userId: req.userContext?.userId,
        insurerProfileId: req.body?.insurer_profile_id,
        scope: req.body?.scope,
        consentVersion: req.body?.consent_version,
      });
      res.status(201).json({ consent_ref: consent.id, granted_at: consent.granted_at });
    } catch (err) {
      if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
      next(err);
    }
  });

router.post('/api/vehicles/:vin/insurer/eligibility',
  authorizeRole(['owner', 'dealer', 'admin']),
  async (req, res, next) => {
    try {
      const gateContext = await gateContextFor(req.params.vin);
      const result = await requestInsurerEligibility(req.params.vin, {
        consentRef: req.body?.consent_reference || req.headers['x-consent-ref'],
        insurerProfileId: req.body?.insurer_profile_id,
        gateContext,
        requestedBy: req.userContext?.userId,
        idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotency_key,
        scenario: req.body?.scenario,               // sandbox/UAT scenario driver only
        async: req.body?.async === true,
      });
      // Return ONLY the underwriting-free public projection to the caller.
      res.status(201).json({ status: result.public });
    } catch (err) {
      if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
      next(err);
    }
  });

router.get('/api/vehicles/:vin/insurer/eligibility',
  authorizeRole(['owner', 'dealer', 'admin', 'reviewer']),
  async (req, res, next) => {
    try { res.json({ status: await getInsurerStatus(req.params.vin) }); }
    catch (err) { next(err); }
  });

// ── provider webhook — no role auth; verified by HMAC signature + replay + idempotency ──
router.post('/api/insurer/webhook',
  express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }),
  async (req, res, next) => {
    try {
      const result = await ingestInsurerWebhook({
        providerId: req.headers['x-provider-id'] || INSURER_WEBHOOK_PROVIDER,
        payloadString: req.rawBody || JSON.stringify(req.body || {}),
        signature: req.headers['x-signature'],
        timestamp: req.headers['x-timestamp'],
        idempotencyKey: req.headers['idempotency-key'],
        body: req.body,
      });
      // 200 applied · 202 accepted-but-not-applied (valid sig, dup/missing) · 401 bad signature
      res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
    } catch (err) { next(err); }
  });

// ── admin: onboarding + health + support ─────────────────────────────────────────
router.post('/api/admin/insurer/providers',
  authorizeRole(['admin']),
  async (req, res, next) => {
    try {
      const profile = await registerInsurerProfile(req.body || {}, { id: req.userContext?.userId });
      res.status(201).json({ insurer: profile });
    } catch (err) {
      if (/required|must be insurance|not registered|secret/i.test(err.message)) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

router.get('/api/admin/insurer/providers',
  authorizeRole(['admin']),
  async (_req, res, next) => {
    try { res.json({ providers: await listInsurerProviders() }); }
    catch (err) { next(err); }
  });

router.get('/api/admin/insurer/vehicles/:vin/decisions',
  authorizeRole(['admin']),
  async (req, res, next) => {
    try { res.json({ decisions: await getInsurerDecisionHistory(req.params.vin) }); }
    catch (err) { next(err); }
  });

export default router;
