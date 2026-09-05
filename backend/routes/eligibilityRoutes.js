/**
 * Insurance + Finance eligibility routes.
 * Every gate is server-derived from the canonical Trust decision; request bodies may provide a
 * consent reference but cannot assert identity, fraud, publication or dealer-compliance truth.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { requireVehicleObjectAuthority } from '../middleware/vehicleObjectAuthority.js';
import {
  initEligibility,
  requestEligibility,
  getLatestStatus,
  getRequests,
  ingestWebhook,
} from '../services/eligibility/eligibilityService.js';
import { buildEligibilityFlags } from '../services/eligibility/eligibilityFlags.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';

const router = express.Router();
initEligibility(buildEligibilityFlags());

async function gateContextFor(vin) {
  try {
    const d = await getTrustDecision(vin);
    const dealerStatus = d.dimensions.dealer_compliance?.status || null;
    const fraudStatus = d.dimensions.fraud_risk?.status || null;
    return {
      identity_status: d.dimensions.identity?.status || null,
      fraud_block: fraudStatus === 'high' ? true : fraudStatus === 'clear' ? false : null,
      publication_status:
        d.dimensions.publication_eligibility?.status
        || d.dimensions.publication_eligibility?.value
        || null,
      dealer_suspended: dealerStatus === 'suspended'
        ? true
        : dealerStatus && dealerStatus !== 'not_evaluated' ? false : null,
      source_coverage_connected: d.dimensions.source_coverage?.connected ?? null,
      // At least one governed connected source is the minimum for provider auto-routing. Zero
      // remains a truthful manual-review case rather than an automatic sandbox approval.
      min_source_coverage: 1,
    };
  } catch {
    // Fail closed: every unresolved dimension stays unknown and evaluateGates routes accordingly.
    return {
      identity_status: null,
      fraud_block: null,
      publication_status: null,
      dealer_suspended: null,
      source_coverage_connected: null,
      min_source_coverage: 1,
    };
  }
}

function eligibilityHandlers(capability) {
  return {
    request: async (req, res, next) => {
      try {
        const ctx = await gateContextFor(req.params.vin);
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
        return next(err);
      }
    },
    status: async (req, res, next) => {
      try {
        return res.json({
          status: await getLatestStatus(capability, req.params.vin),
          history: await getRequests(capability, req.params.vin),
        });
      } catch (err) {
        return next(err);
      }
    },
  };
}

const insurance = eligibilityHandlers('insurance');
const finance = eligibilityHandlers('finance');

// OBJECT SCOPE on all four. These handlers never read req.userContext for anything but
// `requestedBy`, so role authority was the ONLY gate and it admits every registered account.
router.post('/api/vehicles/:vin/insurance/eligibility', authorizeRole(['owner', 'dealer', 'admin', 'reviewer']), requireVehicleObjectAuthority(), insurance.request);
router.get('/api/vehicles/:vin/insurance/eligibility', authorizeRole(['owner', 'dealer', 'admin', 'reviewer']), requireVehicleObjectAuthority(), insurance.status);
router.post('/api/vehicles/:vin/finance/eligibility', authorizeRole(['owner', 'dealer', 'admin']), requireVehicleObjectAuthority(), finance.request);
router.get('/api/vehicles/:vin/finance/eligibility', authorizeRole(['owner', 'dealer', 'admin']), requireVehicleObjectAuthority(), finance.status);

router.post('/api/eligibility/:capability/webhook', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}), async (req, res, next) => {
  try {
    const result = await ingestWebhook(req.params.capability, {
      providerId: req.headers['x-provider-id'] || `${req.params.capability}_sandbox`,
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'],
      timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'],
      body: req.body,
    });
    return res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
