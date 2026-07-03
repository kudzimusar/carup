/**
 * Provider platform admin / health console — Full Activation.
 *
 * The operator interface over the shared provider control-plane: register providers, view
 * health/incidents/activation history, change activation mode, flip kill switches, and drive
 * reconciliation. Admin/government only. No secret values are ever accepted or returned
 * (only credential *references*).
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import {
  upsertProvider, setActivationMode, setKillSwitch, recordHealth, openIncident,
  listProviders, ALL_MODES,
} from '../services/providerPlatform/providerRegistry.js';
import { listOpenMismatches, resolveMismatch } from '../services/providerPlatform/reconciliationService.js';

const router = express.Router();
const ADMIN = ['admin', 'government'];

router.get('/api/admin/providers', authorizeRole(ADMIN), async (req, res, next) => {
  try { res.json({ providers: await listProviders({ capability_type: req.query.capability_type }), modes: ALL_MODES }); }
  catch (err) { next(err); }
});

router.post('/api/admin/providers', authorizeRole(ADMIN), async (req, res, next) => {
  try { res.status(201).json({ provider: await upsertProvider(req.body || {}, { id: req.userContext?.userId }) }); }
  catch (err) {
    if (/secret|required|invalid capability/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/api/admin/providers/:id/activation', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const p = await setActivationMode(req.params.id, req.body?.mode, { reason: req.body?.reason, actor: { id: req.userContext?.userId, role: req.userContext?.role } });
    res.json({ provider: p });
  } catch (err) {
    if (/invalid mode|requires contract|not found/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/api/admin/providers/:id/kill-switch', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const p = await setKillSwitch(req.params.id, req.body?.enabled === true, { reason: req.body?.reason, actor: { id: req.userContext?.userId, role: req.userContext?.role } });
    res.json({ provider: p });
  } catch (err) { next(err); }
});

router.get('/api/admin/providers/:id/health', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const [{ data: checks }, { data: incidents }, { data: history }, { data: attempts }] = await Promise.all([
      supabase.from('provider_health_checks').select('*').eq('provider_id', req.params.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('provider_incidents').select('*').eq('provider_id', req.params.id).order('opened_at', { ascending: false }).limit(20),
      supabase.from('provider_activation_history').select('*').eq('provider_id', req.params.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('provider_request_attempts').select('outcome, mode, created_at').eq('provider_id', req.params.id).order('created_at', { ascending: false }).limit(50),
    ]);
    res.json({ health_checks: checks || [], incidents: incidents || [], activation_history: history || [], recent_attempts: attempts || [] });
  } catch (err) { next(err); }
});

router.post('/api/admin/providers/:id/health-check', authorizeRole(ADMIN), async (req, res, next) => {
  try { await recordHealth(req.params.id, req.body?.status || 'unknown', { latency_ms: req.body?.latency_ms, detail: req.body?.detail }); res.json({ ok: true }); }
  catch (err) { next(err); }
});

router.post('/api/admin/providers/:id/incidents', authorizeRole(ADMIN), async (req, res, next) => {
  try { res.status(201).json({ incident: await openIncident(req.params.id, { severity: req.body?.severity || 'medium', summary: req.body?.summary || 'incident', actor: { id: req.userContext?.userId } }) }); }
  catch (err) { next(err); }
});

router.get('/api/admin/providers/:id/reconciliation/mismatches', authorizeRole(ADMIN), async (req, res, next) => {
  try { res.json({ mismatches: await listOpenMismatches(req.params.id) }); } catch (err) { next(err); }
});

router.patch('/api/admin/reconciliation/mismatches/:id', authorizeRole(ADMIN), async (req, res, next) => {
  try { res.json({ mismatch: await resolveMismatch(req.params.id, req.body?.resolution, { actor: { id: req.userContext?.userId } }) }); }
  catch (err) {
    if (/invalid resolution/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
