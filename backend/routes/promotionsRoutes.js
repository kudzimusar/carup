import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import referralRouter from './referralRoutes.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

let legacyWebhookServices = null;
function getLegacyWebhookServices() {
  if (!legacyWebhookServices) legacyWebhookServices = createCommunicationServices();
  return legacyWebhookServices;
}

function canonicalProviderForChannel(channel) {
  return channel === 'telegram' ? 'telegram' : 'meta';
}

// Communications 2.0 compatibility aliases.
//
// Referral historically exposed its own physical-provider webhook endpoints. Keeping
// those URLs is useful because a provider may already be configured with one of them,
// but they must no longer bypass the canonical Communications persistence/dedupe path.
// These exact routes are registered before referralRouter so WhatsApp/Telegram (and the
// future Meta social transports) resolve to the same CommunicationWebhookService used by
// /api/communications/webhooks/:provider/:channel. Referral extraction still runs from
// CommunicationInboundService after the authoritative message is persisted.
for (const channel of ['whatsapp', 'facebook', 'instagram']) {
  router.get(`/api/referrals/channels/${channel}/webhook`, asyncHandler(async (req, res) => {
    const challenge = getLegacyWebhookServices().webhookService.verifyMetaCallback(channel, req.query || {});
    res.status(200).type('text/plain').send(challenge);
  }));
}

for (const channel of ['whatsapp', 'telegram', 'facebook', 'instagram']) {
  router.post(`/api/referrals/channels/${channel}/webhook`, asyncHandler(async (req, res) => {
    const services = getLegacyWebhookServices();
    const result = await services.webhookService.handleWebhook(
      canonicalProviderForChannel(channel),
      channel,
      req.body || {},
      {
        headers: req.headers,
        query: req.query,
        rawBody: req.rawBody || '',
        actor: {
          actor_type: 'provider',
          actor_tenant_id: req.headers['x-tenant-id'] || 'platform',
          gateway_trusted: true,
          surface: channel,
        },
      },
    );
    res.status(200).json({
      ...result,
      canonical_communications_path: true,
      legacy_referral_webhook_alias: true,
    });
  }));
}

// --- PHASE 1: REFERRAL ENGINE FOUNDATION ---
router.use('/api/referrals', referralRouter);

// --- DEALER: PROMOTIONS ---
router.get('/api/promotions', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId || 'org_1';
  const { data: promotions, error } = await supabase.from('dealer_promotions').select('*').eq('organization_id', orgId);
  if (error && error.code === '42P01') return res.json([]);
  if (error) throw new DatabaseError(error.message);
  res.json(promotions || []);
}));

router.post('/api/promotions', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId || 'org_1';
  const { title, discount_amount, start_date, end_date } = req.body;
  const { data, error } = await supabase.from('dealer_promotions').insert({
    organization_id: orgId, title, discount_amount, start_date, end_date
  });
  if (error && error.code === '42P01') return res.json({ success: true, promotion: { id: 'mock', title, discount_amount, start_date, end_date } });
  if (error) throw new DatabaseError(error.message);
  res.json({ success: true, promotion: data });
}));

export default router;