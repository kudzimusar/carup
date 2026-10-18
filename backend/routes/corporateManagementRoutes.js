/**
 * CA-OWNER-02 — the Corporate management read models.
 *
 *   GET /api/corporate/management/:area   area ∈ overview | operations | trust | finance | growth | platform | data-sources | report
 *
 * Session-only (authorizeSessionRole refuses the x-user-id fallback). Each area needs the frozen Corporate admission decision
 * AND the one capability its destination names (corporateReadAccess.js) — a read model is never wider than admission.
 * Read-only: no write, no secret, aggregates only; every response is a decision about this session and is never cached by a
 * browser or an intermediary. Governance is always read for the actor.
 *
 * CA-OWNER-02-R3 (D3): ONE staging snapshot serves every area. It is fresh for 60 s; after that the LAST VALID snapshot is
 * served at once while one background refresh runs (kept alive past the response by the runtime), and a snapshot older than
 * 10 minutes is never served. Each answer's `snapshot` block says how old it is and whether a refresh is running, and every
 * figure keeps its own as-of time — a cached figure never looks fresher than it is.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { authorizeCorporateRead, CORPORATE_READ_CONTRACT } from '../services/corporate/management/corporateReadAccess.js';
import { AREA_CAPABILITY, AREAS_NEEDING_GOVERNANCE, areaPayload, computeSnapshot } from '../services/corporate/management/managementReadModel.js';
import { readGovernanceFacts } from '../services/corporate/management/governanceFacts.js';
import { environmentFromHost } from '../services/corporate/management/platformFacts.js';
import { createSnapshotCache, runtimeKeepAlive } from '../services/corporate/management/managementSnapshotCache.js';

const router = express.Router();

const snapshots = createSnapshotCache({
  compute: (host) => computeSnapshot(supabase, { now: new Date(), host: host || null }),
  ttlMs: 60_000,
  maxStaleMs: 600_000,
  keepAlive: runtimeKeepAlive,
});

/** Test seam: forget the snapshot (each test world must not see a previous world's figures). */
export function resetCorporateManagementSnapshot() { snapshots.reset(); }

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
    // CA-OWNER-02-R3 (D3): the governance record is read for THIS request at THIS request's time — never at the shared
    // snapshot's, which may be minutes old while it is served during a refresh (the projection decides "ACTIVE and inside
    // its effective window" at the time it is given) — and alongside the snapshot rather than after it.
    const requestedAt = new Date();
    const [{ value: snapshot, meta }, governanceRead] = await Promise.all([
      snapshots.get(String(req.hostname || '')),
      AREAS_NEEDING_GOVERNANCE.includes(area) ? readGovernanceFacts(supabase, { now: requestedAt, actorUserId: req.userContext.id }) : null,
    ]);
    const governance = governanceRead ? governanceRead.facts : [];
    const grantCapabilities = [...(gate.grant.capabilities || []), ...(gate.grant.governance_capabilities || [])];
    return res.status(200).json({
      contract: CORPORATE_READ_CONTRACT,
      decision: 'granted',
      read_only: true,
      area,
      generated_at: snapshot.now.toISOString(),
      snapshot: {
        generated_at: meta.generatedAt.toISOString(),
        age_seconds: Math.round(meta.ageMs / 1000),
        stale: meta.stale,
        refreshing: meta.refreshing,
      },
      environment: environmentFromHost(req.hostname),
      ...areaPayload(area, snapshot, { governance, grantCapabilities }),
    });
  } catch {
    return res.status(503).json(UNAVAILABLE);
  }
});

export default router;
