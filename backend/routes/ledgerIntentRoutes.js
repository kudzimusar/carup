/**
 * The ledger-intent drain (OC-5A). A domain mutation that committed with a ledger intent gets its
 * event recorded inline, and again when its client retries; this route records whatever is still
 * pending — after a ledger outage, for example — for a scheduler or an operator.
 *
 * Machine-to-machine: authenticated by a shared secret (LEDGER_INTENT_WORKER_SECRET, or the platform's
 * CRON_SECRET as a bearer token), exempt from CSRF for that reason only. With no secret configured it
 * refuses everything — it is never open.
 */
import express from 'express';
import crypto from 'crypto';
import { drainLedgerIntents, countUnrecordedLedgerIntents } from '../services/blockchain/ledgerIntentService.js';

const router = express.Router();

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isLedgerWorkerRequestAuthorized(req, env = process.env) {
  const secrets = [env.LEDGER_INTENT_WORKER_SECRET, env.CRON_SECRET].map((value) => String(value || '').trim()).filter(Boolean);
  const supplied = req.headers['x-ledger-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return Boolean(supplied) && secrets.some((secret) => safeEqual(supplied, secret));
}

async function processLedgerIntents(req, res) {
  if (!isLedgerWorkerRequestAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized ledger worker request.' });
  }
  const limit = Math.min(Math.max(Number(req.body?.limit ?? req.query?.limit) || 10, 1), 50);
  try {
    const { claimed, results } = await drainLedgerIntents({ limit });
    const recorded = results.filter((result) => result.status === 'recorded').length;
    return res.json({
      success: true,
      claimed,
      recorded,
      still_pending: claimed - recorded,
      backlog: await countUnrecordedLedgerIntents(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'ledger_intent_drain_failed', message: String(error?.message || error).slice(0, 300) });
  }
}

router.get('/api/internal/ledger-intents/process', processLedgerIntents);
router.post('/api/internal/ledger-intents/process', processLedgerIntents);

export default router;
