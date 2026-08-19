import express from 'express';
import { supabase } from '../../db/supabase.js';

const router = express.Router();

router.get('/rates', async (_req, res) => {
  try {
    const { data: rates, error } = await supabase
      .from('currency_rates')
      .select('*')
      .order('last_updated', { ascending: false });

    if (error) throw error;
    return res.json(rates);
  } catch (err) {
    console.error('Error fetching currency rates:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve currency rates' });
  }
});

// Issue #164 Phase 6: this historical callback path is retired. Transaction state is handled only
// by the canonical provider reconciliation boundary; stale callers receive an explicit terminal
// response and cannot create ledger rows or emit transaction-state events here.
router.post('/webhook/:gateway', (_req, res) => {
  return res.status(410).json({
    applied: false,
    reason: 'legacy_gateway_webhook_retired',
    code: 'LEGACY_GATEWAY_WEBHOOK_DISABLED',
  });
});

export default router;
