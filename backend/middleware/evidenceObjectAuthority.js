/**
 * Evidence object authority (OC-4A) — "may this caller read THIS evidence record's chain of custody,
 * and which projection of it?".
 *
 * Before this module `GET /api/vehicles/:vin/evidence/:evidenceId/provenance` asked only "is the caller
 * signed in?": any authenticated account (and every registered account is an 'owner') could read the
 * provenance of any evidence record, under any VIN in the path — the route never read `:vin` at all.
 *
 * Composed from the ONE vehicle rule, `resolveVehicleObjectAuthority` (owner, current seller,
 * organizational tenant, platform-wide roles) — never a second definition of ownership — plus the two
 * relationships an evidence record adds:
 *   - PAIRING: the evidence must belong to the VIN in the path;
 *   - ASSOCIATION: the principal who submitted the evidence (`vehicle_evidence.uploaded_by`) may read
 *     its custody chain — e.g. a mechanic who is not in the vehicle's organizational tenant.
 * Platform evidence-review roles (admin family, government, reviewer) are admitted platform-wide and
 * receive role-specific projections (provenanceService.toProvenanceProjection).
 *
 * The AUDIENCE is decided by the PLATFORM role (users.role), never by a tenant-derived effective role:
 * a tenant membership must not unlock a platform projection.
 *
 * ONE REFUSAL. Unknown evidence, evidence of another VIN, evidence of a VIN the caller has no
 * relationship to, a malformed id and a failed lookup all answer the same 403 with the same body, so
 * the endpoint is not an existence oracle for evidence ids or VINs. FAIL CLOSED: a read error is never
 * an absent restriction.
 */
import { supabase } from '../db/supabase.js';
import { resolveVehicleObjectAuthority } from './vehicleObjectAuthority.js';

export const PROVENANCE_AUDIENCES = Object.freeze({
  PARTICIPANT: 'participant',
  REVIEWER: 'reviewer',
  GOVERNMENT: 'government',
  ADMIN: 'admin',
});

const ADMIN_PLATFORM_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EVIDENCE_REFUSAL = Object.freeze({ error: 'Forbidden. You do not have access to this evidence record.' });

/** The projection a caller's PLATFORM role entitles them to; everyone else is a participant. */
export function provenanceAudienceFor(userContext) {
  const platformRole = String(userContext?.platformRole || '').trim().toLowerCase();
  if (ADMIN_PLATFORM_ROLES.has(platformRole)) return PROVENANCE_AUDIENCES.ADMIN;
  if (platformRole === 'government') return PROVENANCE_AUDIENCES.GOVERNMENT;
  if (platformRole === 'reviewer') return PROVENANCE_AUDIENCES.REVIEWER;
  return PROVENANCE_AUDIENCES.PARTICIPANT;
}

/**
 * Returns { allowed, audience, reason }. `reason` is for tests and logs; it never reaches the caller.
 */
export async function resolveEvidenceObjectAuthority(vin, evidenceId, userContext, { client = supabase } = {}) {
  const userId = userContext?.id || userContext?.userId;
  if (!userId) return { allowed: false, audience: null, reason: 'no_identity' };
  if (!vin || !evidenceId || !UUID.test(String(evidenceId))) return { allowed: false, audience: null, reason: 'malformed' };

  const { data: evidence, error } = await client
    .from('vehicle_evidence')
    .select('id, vin, uploaded_by')
    .eq('id', evidenceId)
    .maybeSingle();
  if (error) return { allowed: false, audience: null, reason: 'lookup_failed' };
  if (!evidence) return { allowed: false, audience: null, reason: 'not_found' };
  if (evidence.vin !== vin) return { allowed: false, audience: null, reason: 'pairing_mismatch' };

  const audience = provenanceAudienceFor(userContext);
  if (audience !== PROVENANCE_AUDIENCES.PARTICIPANT) return { allowed: true, audience, reason: null };

  const vehicle = await resolveVehicleObjectAuthority(vin, userContext);
  if (vehicle.allowed) return { allowed: true, audience, reason: null };
  if (vehicle.reason === 'lookup_failed') return { allowed: false, audience: null, reason: 'lookup_failed' };

  if (evidence.uploaded_by && evidence.uploaded_by === userId) return { allowed: true, audience, reason: null };
  return { allowed: false, audience: null, reason: 'not_scoped' };
}

/** Express form. Mount AFTER `authorizeSessionRole()`; sets `req.evidenceAccess = { audience }`. */
export function requireEvidenceObjectAuthority({ vinParam = 'vin', evidenceParam = 'evidenceId' } = {}) {
  return async (req, res, next) => {
    try {
      const { allowed, audience } = await resolveEvidenceObjectAuthority(req.params?.[vinParam], req.params?.[evidenceParam], req.userContext);
      if (!allowed) return res.status(403).json(EVIDENCE_REFUSAL);
      req.evidenceAccess = { audience };
      return next();
    } catch {
      return res.status(403).json(EVIDENCE_REFUSAL);
    }
  };
}

export default { PROVENANCE_AUDIENCES, EVIDENCE_REFUSAL, provenanceAudienceFor, resolveEvidenceObjectAuthority, requireEvidenceObjectAuthority };
