/**
 * Regulated-lender (finance) provider workflow routes — Full Activation (canonical §101-113).
 *
 *   POST /api/vehicles/:vin/finance/consent               record applicant consent (owner/dealer/admin)
 *   POST /api/vehicles/:vin/finance/lender/eligibility     request lender eligibility (owner/dealer/admin, consent required)
 *   GET  /api/vehicles/:vin/finance/lender/status          PRIVATE latest status + history (applicant/admin only)
 *   POST /api/vehicles/:vin/finance/consent/:id/deletion   applicant erasure/retention request (owner/admin)
 *   GET  /api/vehicles/:vin/finance/availability           COARSE public availability (no applicant/credit data)
 *   POST /api/finance/lender/webhook                       async lender webhook (signed + replay + idempotent)
 *   GET  /api/admin/finance/lender/decisions               admin reconciliation/support view
 *
 * PRIVACY: applicant/credit/decision detail is NEVER returned to buyers, dealers-at-large or
 * the Partner API. Only the coarse availability endpoint is public.
 */
import express from 'express';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { requireVehicleObjectAuthority } from '../middleware/vehicleObjectAuthority.js';
import { supabase } from '../db/supabase.js';
import {
  recordApplicantConsent, requestApplicantDeletion, requestLenderEligibility,
  ingestLenderWebhook, getLenderStatus, getLenderHistory, financeAvailabilityPublic,
  FINANCE_WEBHOOK_PROVIDER_ID,
} from '../services/finance/lenderWorkflow.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';
import {
  loadMarketplaceTransactionVehicle,
  resolveMarketplaceSellerSuspension,
} from '../services/transaction/marketplaceTransactionAuthority.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isPrivileged = (role) => role === 'admin' || role === 'government';

// Object-level authorization: a caller with the global 'owner' role may only touch a VIN they
// actually own. Admin/government bypass. Returns true if allowed.
async function ownsVehicleOrPrivileged(req) {
  const role = req.userContext?.role;
  if (isPrivileged(role)) return true;
  const userId = req.userContext?.userId;
  if (!userId) return false;
  const { data } = await supabase.from('vehicles').select('owner_id').eq('vin', req.params.vin).maybeSingle();
  return !!data && data.owner_id === userId;
}

// Derive ALL gate inputs from server-owned canonical facts. Missing seller/dealer posture remains
// unknown and eligibilityContract routes it to manual review; the browser cannot assert that a
// seller/dealer is clear merely by omitting or forging a request field.
async function gateContextFor(vin) {
  try {
    const [d, vehicle] = await Promise.all([
      getTrustDecision(vin),
      loadMarketplaceTransactionVehicle(vin),
    ]);
    const dealerSuspended = await resolveMarketplaceSellerSuspension(vehicle);
    return {
      identity_status: d.dimensions.identity.status,
      fraud_block: d.dimensions.fraud_risk.status === 'high'
        ? true
        : d.dimensions.fraud_risk.status === 'clear' ? false : null,
      publication_status: d.dimensions.publication_eligibility.value,
      dealer_suspended: dealerSuspended,
      source_coverage_connected: d.dimensions.source_coverage.connected ?? null,
      min_source_coverage: 0,
    };
  } catch {
    return {
      identity_status: 'incomplete',
      fraud_block: null,
      publication_status: null,
      dealer_suspended: null,
      source_coverage_connected: null,
      min_source_coverage: 0,
    };
  }
}

// Record applicant consent — required before requesting lender eligibility.
// OBJECT SCOPE. Role alone admits every registered account (public registration creates all of
// them as 'owner'), so without this a stranger could record consent against any vin and then drive
// a real lender call off it.
router.post('/api/vehicles/:vin/finance/consent',
  authorizeRole(['owner', 'dealer', 'admin']),
  requireVehicleObjectAuthority(),
  asyncHandler(async (req, res) => {
    const consent = await recordApplicantConsent(req.params.vin, req.userContext?.userId, {
      consentVersion: req.body?.consent_version || 'consent-v1',
      scope: req.body?.scope || {},
      tenantId: req.userContext?.tenantId,
    });
    // Return only the reference + non-sensitive metadata.
    res.status(201).json({ consent_ref: consent.id, vin: consent.vin, consent_version: consent.consent_version, granted_at: consent.granted_at });
  }));

// Request lender eligibility (consent required; gates enforced; lender called via framework).
router.post('/api/vehicles/:vin/finance/lender/eligibility',
  authorizeRole(['owner', 'dealer', 'admin']),
  requireVehicleObjectAuthority(),
  asyncHandler(async (req, res) => {
    try {
      const gateContext = await gateContextFor(req.params.vin);
      const out = await requestLenderEligibility(req.params.vin, {
        applicantConsentRef: req.body?.consent_ref || req.headers['x-consent-ref'],
        gateContext,
        requestedBy: req.userContext?.userId,
        idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotency_key,
        providerKey: req.body?.provider_key,
        jurisdiction: req.body?.jurisdiction,
      });
      // Response carries the decision outcome (private to the applicant/admin caller) — no credit data.
      res.status(201).json({
        outcome: out.decision.outcome,
        status: out.request.status,
        conditions: out.decision.conditions || [],
        validity_until: out.decision.validity_until || null,
        provider_reference: out.decision.provider_reference || null,
        gated: out.gated || false,
        provider_called: out.providerCalled,
      });
    } catch (err) {
      if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

// PRIVATE status — the VEHICLE OWNER or admin/government only. Role alone is not enough: an
// 'owner'-role caller must own THIS vin (object-level authorization).
router.get('/api/vehicles/:vin/finance/lender/status',
  authorizeRole(['owner', 'admin', 'government']),
  asyncHandler(async (req, res) => {
    if (!(await ownsVehicleOrPrivileged(req))) {
      return res.status(403).json({ error: 'forbidden: not the vehicle owner' });
    }
    res.json({
      status: await getLenderStatus(req.params.vin),
      history: await getLenderHistory(req.params.vin),
    });
  }));

// Applicant erasure/retention request (right-to-erasure). The consent's own applicant or admin —
// a caller cannot file erasure against a consent ref that is not theirs.
router.post('/api/vehicles/:vin/finance/consent/:id/deletion',
  authorizeRole(['owner', 'admin', 'government']),
  asyncHandler(async (req, res) => {
    try {
      if (!isPrivileged(req.userContext?.role)) {
        const { data: consent } = await supabase.from('finance_consents').select('applicant_user_id').eq('id', req.params.id).maybeSingle();
        if (!consent) return res.status(404).json({ error: 'consent not found' });
        if (consent.applicant_user_id !== req.userContext?.userId) {
          return res.status(403).json({ error: 'forbidden: not the consent owner' });
        }
      }
      const out = await requestApplicantDeletion(req.params.id, { actor: req.userContext?.userId });
      res.json({ deletion_requested_at: out.deletion_requested_at, consent_ref: out.consent.id });
    } catch (err) {
      if (/consent not found/.test(err.message)) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

// COARSE public availability — safe for the public passport / Partner API. No applicant data.
router.get('/api/vehicles/:vin/finance/availability',
  optionalAuth(),
  asyncHandler(async (req, res) => {
    res.json(await financeAvailabilityPublic(req.params.vin, { jurisdiction: req.query.jurisdiction }));
  }));

// Async lender webhook — no role auth; verified by signature + replay window + idempotency.
router.post('/api/finance/lender/webhook',
  express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }),
  asyncHandler(async (req, res) => {
    const result = await ingestLenderWebhook({
      providerId: req.headers['x-provider-id'] || FINANCE_WEBHOOK_PROVIDER_ID,
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'],
      timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'],
      body: req.body,
    });
    res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  }));

// Admin reconciliation/support — full private decision ledger for oversight.
router.get('/api/admin/finance/lender/decisions',
  authorizeRole(['admin', 'government']),
  asyncHandler(async (req, res) => {
    let query = supabase.from('finance_provider_decisions').select('*').order('created_at', { ascending: false }).limit(200);
    if (req.query.vin) query = supabase.from('finance_provider_decisions').select('*').eq('vin', req.query.vin).order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ decisions: data || [] });
  }));

export default router;
