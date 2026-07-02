/**
 * Partner client administration — Workstream 9 (admin portal API).
 *
 *   POST   /api/admin/partners            create a partner client (returns the key ONCE)
 *   GET    /api/admin/partners            list partner clients (no key hashes)
 *   PATCH  /api/admin/partners/:id/revoke revoke a client
 *   GET    /api/admin/partners/:id/requests  recent request audit for a client
 *
 * Admin/government only. The plaintext API key is returned exactly once at creation.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { createPartnerClient, listPartnerClients, revokePartnerClient } from '../services/partner/partnerAuthService.js';

const router = express.Router();
const ADMIN = ['admin', 'government'];

router.post('/api/admin/partners', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const { name, scopes, tenant_id, rate_limit_per_min, contact_email } = req.body || {};
    const { client, apiKey } = await createPartnerClient({
      name, scopes, tenant_id, rate_limit_per_min, contact_email,
      created_by: req.userContext?.userId,
    });
    // The plaintext key is shown ONCE here and never stored or returned again.
    res.status(201).json({ client, api_key: apiKey, notice: 'Store this API key now — it will not be shown again.' });
  } catch (err) {
    if (/name is required/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/api/admin/partners', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    res.json({ partners: await listPartnerClients() });
  } catch (err) { next(err); }
});

router.patch('/api/admin/partners/:id/revoke', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    res.json({ client: await revokePartnerClient(req.params.id) });
  } catch (err) { next(err); }
});

router.get('/api/admin/partners/:id/requests', authorizeRole(ADMIN), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('partner_api_requests')
      .select('*')
      .eq('client_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ requests: data || [] });
  } catch (err) { next(err); }
});

export default router;
