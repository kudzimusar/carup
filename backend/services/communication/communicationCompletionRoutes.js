import crypto from 'crypto';
import { authorizeRole } from '../../middleware/authMiddleware.js';
import { resolveWorkerSecret } from './communicationConfigurationValidator.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function actorFromReq(req) {
  return {
    id: req.userContext?.id || req.headers['x-user-id'] || null,
    userId: req.userContext?.id || req.headers['x-user-id'] || null,
    role: req.userContext?.effectiveRole || req.userContext?.role || null,
    tenantId: req.userContext?.tenantId || req.headers['x-tenant-id'] || null,
  };
}

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireWorkerSecret(req, res) {
  const expected = resolveWorkerSecret();
  const supplied = req.headers['x-communication-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied || !safeEqual(supplied, expected)) {
    res.status(401).json({ error: 'Unauthorized communication worker request.' });
    return false;
  }
  return true;
}

/**
 * Register the final Communications 2.0 product-capability routes onto the existing
 * canonical router. This module intentionally reuses the same services/repository,
 * message_threads/messages/message_parts, notification worker and provider adapters.
 */
export function registerCommunicationCompletionRoutes(router, services) {
  router.get('/api/communications/capabilities', authorizeRole([]), asyncHandler(async (_req, res) => {
    res.json({
      phases: { core: true, marketplace: true, templates: true, analytics: true, ai_multimodal: true, stakeholder_workflows: true, campaigns: true },
      stakeholder_workflows: services.stakeholderService?.listContracts?.() || [],
      media: services.mediaService?.health?.() || { available: false },
      ai: services.aiRuntimeService?.health?.() || { available: false },
      physical_provider_acceptance_required: true,
    });
  }));

  router.post('/api/internal/communications/workflows/:workflow/ensure', asyncHandler(async (req, res) => {
    if (!requireWorkerSecret(req, res)) return;
    if (!services.stakeholderService) return res.status(503).json({ error: 'Stakeholder Communications contract is unavailable.' });
    const result = await services.stakeholderService.ensureReferenceFlow({
      ...(req.body || {}),
      workflow: req.params.workflow,
      business_workflow: req.params.workflow,
    });
    res.status(201).json(result);
  }));

  router.post('/api/communications/threads/:id/media/prepare', authorizeRole([]), asyncHandler(async (req, res) => {
    if (!services.mediaService) return res.status(503).json({ error: 'Communication media is unavailable.' });
    const upload = await services.mediaService.prepareUpload(req.params.id, actorFromReq(req), req.body || {});
    res.status(201).json({ upload });
  }));

  router.post('/api/communications/threads/:id/media/commit', authorizeRole([]), asyncHandler(async (req, res) => {
    if (!services.mediaService) return res.status(503).json({ error: 'Communication media is unavailable.' });
    const result = await services.mediaService.commitUpload(req.params.id, actorFromReq(req), req.body || {});
    res.status(201).json(result);
  }));

  router.post('/api/communications/threads/:id/media/location', authorizeRole([]), asyncHandler(async (req, res) => {
    if (!services.mediaService) return res.status(503).json({ error: 'Communication media is unavailable.' });
    const result = await services.mediaService.sendMessage(req.params.id, actorFromReq(req), {
      channel: 'in_app',
      message_type: 'multimodal',
      client_message_id: req.body?.client_message_id || null,
      parts: [{
        part_type: 'location',
        metadata: {
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          label: req.body?.label || null,
        },
      }],
    });
    res.status(201).json(result);
  }));

  router.get('/api/communications/threads/:id/media/:partId/access', authorizeRole([]), asyncHandler(async (req, res) => {
    if (!services.mediaService) return res.status(503).json({ error: 'Communication media is unavailable.' });
    const access = await services.mediaService.createSignedPartUrl(req.params.partId, actorFromReq(req), {
      expiresIn: req.query.expires_in,
    });
    res.json({ access });
  }));

  router.post('/api/communications/threads/:id/ai/intent', authorizeRole([]), asyncHandler(async (req, res) => {
    const derivation = await services.aiRuntimeService.detectIntent(req.params.id, actorFromReq(req), {
      source_message_id: req.body?.source_message_id || null,
    });
    res.status(201).json({ derivation });
  }));

  router.post('/api/communications/threads/:id/ai/entities', authorizeRole([]), asyncHandler(async (req, res) => {
    const derivation = await services.aiRuntimeService.extractEntities(req.params.id, actorFromReq(req), {
      source_message_id: req.body?.source_message_id || null,
    });
    res.status(201).json({ derivation });
  }));

  router.post('/api/communications/threads/:id/ai/next-action', authorizeRole([]), asyncHandler(async (req, res) => {
    const derivation = await services.aiRuntimeService.nextBestAction(req.params.id, actorFromReq(req));
    res.status(201).json({ derivation, auto_executed: false, requires_human_review: true });
  }));

  router.post('/api/communications/threads/:id/ai/media/:partId', authorizeRole([]), asyncHandler(async (req, res) => {
    const derivation = await services.aiRuntimeService.analyzeMedia(req.params.id, actorFromReq(req), { part_id: req.params.partId });
    res.status(201).json({ derivation, source_artifact_unchanged: true });
  }));

  router.get('/api/admin/communications/campaigns', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    res.json({ campaigns: await services.campaignService.listCampaigns({ tenantId: req.userContext?.tenantId || null, limit: req.query.limit }) });
  }));

  router.post('/api/admin/communications/campaigns', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    const campaign = await services.campaignService.createCampaign(req.body || {}, actorFromReq(req));
    res.status(201).json({ campaign });
  }));

  router.post('/api/admin/communications/campaigns/:id/approve', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    const campaign = await services.campaignService.approveCampaign(req.params.id, actorFromReq(req));
    res.json({ campaign });
  }));

  router.post('/api/admin/communications/campaigns/:id/execute', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    const result = await services.campaignService.executeCampaign(req.params.id, actorFromReq(req));
    res.json({ result });
  }));

  router.post('/api/admin/communications/campaigns/:id/conversions', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    const delivery = await services.campaignService.recordConversion(req.params.id, req.body || {});
    res.status(201).json({ delivery });
  }));

  router.get('/api/admin/communications/campaigns/:id/report', authorizeRole(['admin']), asyncHandler(async (req, res) => {
    res.json({ report: await services.campaignService.report(req.params.id) });
  }));
}
