/**
 * CA-OWNER-02 — the Corporate management read models.
 *
 *   GET /api/corporate/management/:area   area ∈ overview | operations | trust | finance | growth | platform | data-sources | report
 *
 * Session-only (authorizeSessionRole refuses the x-user-id fallback). Each area needs the frozen Corporate admission decision
 * AND the one capability its destination names (corporateReadAccess.js) — a read model is never wider than admission.
 * Read-only: no write, no secret, aggregates only; every response is a decision about this session and is never cached by a
 * browser or an intermediary. The staging snapshot behind the areas lives for a few seconds so a page change does not re-read
 * every source; governance is always read for the actor.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { authorizeCorporateRead, CORPORATE_READ_CONTRACT } from '../services/corporate/management/corporateReadAccess.js';
import { AREA_CAPABILITY, AREAS_NEEDING_GOVERNANCE, areaPayload, computeSnapshot } from '../services/corporate/management/managementReadModel.js';
import { readGovernanceFacts } from '../services/corporate/management/governanceFacts.js';
import { environmentFromHost } from '../services/corporate/management/platformFacts.js';

const router = express.Router();

// One staging snapshot serves every area for a minute. Every figure carries its own as-of time, so a cached figure never
// looks fresher than it is; a slow technical source (the scheduler-health RPC scans cron history) is paid once a minute,
// not on every page.
const SNAPSHOT_TTL_MS = 60_000;
let cached = null; // { key, at, promise }

function snapshotFor(host) {
  const key = String(host || '');
  const fresh = cached && cached.key === key && Date.now() - cached.at < SNAPSHOT_TTL_MS;
  if (!fresh) {
    const entry = { key, at: Date.now(), promise: computeSnapshot(supabase, { now: new Date(), host }) };
    entry.promise.catch(() => { if (cached === entry) cached = null; });
    cached = entry;
  }
  return cached.promise;
}

/** Test seam: forget the snapshot (each test world must not see a previous world's figures). */
export function resetCorporateManagementSnapshot() { cached = null; }

const UNAVAILABLE = Object.freeze({
  contract: CORPORATE_READ_CONTRACT, decision: 'unavailable', code: 'CORPORATE_MANAGEMENT_UNAVAILABLE',
  error: 'The Corporate management read model could not be built right now. Nothing is shown.',
});

router.get('/api/corporate/management/:area', authorizeSessionRole([]), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const area = String(req.params.area || '');
  const capability = AREA_CAPABILITY[area];
  if (!capability) return res.status(404).json({ contract: CORPORATE_READ_CONTRACT, decision: 'denied', code: 'CORPORATE_MANAGEMENT_UNKNOWN_AREA', error: 'Unknown Corporate management area.' });

  const gate = await authorizeCorporateRead(req.userContext, capability);
  if (!gate.allowed) return res.status(gate.status).json(gate.body);

  try {
    const snapshot = await snapshotFor(req.hostname);
    const governance = AREAS_NEEDING_GOVERNANCE.includes(area)
      ? (await readGovernanceFacts(supabase, { now: snapshot.now, actorUserId: req.userContext.id })).facts
      : [];
    const grantCapabilities = [...(gate.grant.capabilities || []), ...(gate.grant.governance_capabilities || [])];
    return res.status(200).json({
      contract: CORPORATE_READ_CONTRACT,
      decision: 'granted',
      read_only: true,
      area,
      generated_at: snapshot.now.toISOString(),
      environment: environmentFromHost(req.hostname),
      ...areaPayload(area, snapshot, { governance, grantCapabilities }),
    });
  } catch {
    return res.status(503).json(UNAVAILABLE);
  }
});

export default router;
