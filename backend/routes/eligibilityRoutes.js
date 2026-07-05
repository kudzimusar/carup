/**
 * Insurance + Finance eligibility routes — Workstreams D/E.
 *
 *   POST /api/vehicles/:vin/insurance/eligibility      request insurance eligibility
 *   GET  /api/vehicles/:vin/insurance/eligibility      latest insurance status
 *   POST /api/vehicles/:vin/finance/eligibility        request finance eligibility (consent required)
 *   GET  /api/vehicles/:vin/finance/eligibility        latest finance status (privileged/owner only)
 *   POST /api/eligibility/:capability/webhook          provider webhook (signed, replay-protected)
 *
 * Finance applicant data is private — never returned to buyers or the Partner API.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { initEligibility, requestEligibility, getLatestStatus, getRequests, ingestWebhook } from '../services/eligibility/eligibilityService.js';
import { buildEligibilityFlags } from '../services/eligibility/eligibilityFlags.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';

const router = express.Router();
initEligibility(buildEligibilityFlags());

// Derive gate inputs from the unified trust decision so eligibility respects identity,
// fraud, publication and source coverage consistently.
async function gateContextFor(vin) {
  try {
    const d = await getTrustDecision(vin);
    return {
      identity_status: d.dimensions.identity.status,
      fraud_block: d.dimensions.fraud_risk.status === 'high',
      publication_status: d.dimensions.publication_eligibility.value,
      source_coverage_connected: d.dimensions.source_coverage.connected ?? 0,
      min_source_coverage: 0,
    };
  } catch {
    return { identity_status: 'incomplete' }; // fail-closed if the decision can't be computed
  }
}

function eligibilityHandlers(capability, extra = {}) {
  return {
    request: async (req, res, next) => {
      try {
        const ctx = await gateContextFor(req.params.vin);
        if (extra.dealerSuspended) ctx.dealer_suspended = req.body?.dealer_suspended === true;
        const request = await requestEligibility(capability, req.params.vin, {
          requestedBy: req.userContext?.userId,
          idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotency_key,
          consentReference: req.body?.consent_reference,
          gateContext: ctx,
        });
        res.status(201).json({ request });
      } catch (err) {
        if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
        if (/unknown capability/.test(err.message)) return res.status(400).json({ error: err.message });
        next(err);
      }
    },
    status: async (req, res, next) => {
      try { res.json({ status: await getLatestStatus(capability, req.params.vin), history: await getRequests(capability, req.params.vin) }); }
      catch (err) { next(err); }
    },
  };
}

const insurance = eligibilityHandlers('insurance');
const finance = eligibilityHandlers('finance', { dealerSuspended: true });

// Insurance — seller/dealer/admin request; status readable by owner/dealer/admin/reviewer.
router.post('/api/vehicles/:vin/insurance/eligibility', authorizeRole(['owner', 'dealer', 'admin', 'reviewer']), insurance.request);
router.get('/api/vehicles/:vin/insurance/eligibility', authorizeRole(['owner', 'dealer', 'admin', 'reviewer']), insurance.status);

// Finance — applicant (owner/dealer) requests with consent; status is PRIVATE (owner/admin only).
router.post('/api/vehicles/:vin/finance/eligibility', authorizeRole(['owner', 'dealer', 'admin']), finance.request);
router.get('/api/vehicles/:vin/finance/eligibility', authorizeRole(['owner', 'dealer', 'admin']), finance.status);

// Provider webhook — no role auth; verified by signature + replay window + idempotency.
router.post('/api/eligibility/:capability/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), async (req, res, next) => {
  try {
    const result = await ingestWebhook(req.params.capability, {
      providerId: req.headers['x-provider-id'] || `${req.params.capability}_sandbox`,
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'],
      timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'],
      body: req.body,
    });
    res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  } catch (err) { next(err); }
});

export default router;
