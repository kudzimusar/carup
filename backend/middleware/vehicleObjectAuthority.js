/**
 * Vehicle object-level authority — ONE definition of "may this caller act on THIS vin?".
 *
 * Role authorization answers a different question: "is this caller a kind of user who may do this
 * at all?". Every provider-capability route under `/api/vehicles/:vin/...` needs both answers, and
 * before this module only one of eleven asked the second one — `ownsVehicleOrPrivileged` lived in
 * lenderRoutes.js and was applied to the GET status route alone.
 *
 * That gap was not theoretical. Public registration creates every account with role 'owner'
 * ("Public registration cannot assign a role; accounts are created as 'owner'"), so
 * `authorizeRole(['owner','dealer','admin'])` admits every registered user. Any account could
 * therefore record consent against a stranger's VIN, trigger a real provider eligibility call and
 * read the lender/insurer decision back for a vehicle it had no relationship to.
 *
 * SCOPE RULE. Deliberately the SAME rule `loadScopedVehicle` applies in vehiclesRoutes.js — owner,
 * current seller, or organizational tenant — rather than a second, narrower definition of vehicle
 * ownership. `current_seller_id` is the canonical seller identity in this codebase (never `owner_id`
 * alone), so an owner-only check would have refused the dealer whose listing it actually is, and a
 * tenant-only check would have refused the private owner. Admin and government keep platform-wide
 * authority, which is the entire point of those roles.
 *
 * FAIL CLOSED. A vehicle that cannot be read, or a caller with no resolved identity, is refused.
 * A read error is never treated as an absent restriction.
 */
import { supabase } from '../db/supabase.js';

const PLATFORM_WIDE_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government']);

/** Whether the caller's role carries platform-wide vehicle authority. */
export function hasPlatformWideVehicleAuthority(userContext) {
  return PLATFORM_WIDE_ROLES.has(userContext?.role)
    || PLATFORM_WIDE_ROLES.has(userContext?.platformRole);
}

/**
 * Resolve whether `userContext` may act on `vin`.
 * Returns { allowed, reason } — `reason` is for the refusal body, never for the caller to branch on.
 */
export async function resolveVehicleObjectAuthority(vin, userContext) {
  if (hasPlatformWideVehicleAuthority(userContext)) return { allowed: true, reason: null };

  const userId = userContext?.id || userContext?.userId;
  if (!userId) return { allowed: false, reason: 'no_identity' };
  if (!vin) return { allowed: false, reason: 'no_vin' };

  const { data, error } = await supabase
    .from('vehicles')
    .select('owner_id, current_seller_id, tenant_id')
    .eq('vin', vin)
    .maybeSingle();

  // A failed read is NOT an absent restriction. Returning "allowed" here would turn a transient
  // database error into a platform-wide authorization bypass.
  if (error) return { allowed: false, reason: 'lookup_failed' };
  if (!data) return { allowed: false, reason: 'not_found' };

  const isOwner = Boolean(data.owner_id) && data.owner_id === userId;
  const isCurrentSeller = Boolean(data.current_seller_id) && data.current_seller_id === userId;
  const isTenantScoped = Boolean(data.tenant_id) && data.tenant_id === userContext?.tenantId;

  if (isOwner || isCurrentSeller || isTenantScoped) return { allowed: true, reason: null };
  return { allowed: false, reason: 'not_scoped' };
}

/**
 * Express middleware form. Mount AFTER the route's `authorizeRole`, so role authority is decided
 * first and this decides object authority — the two questions stay separate and both are asked.
 */
export function requireVehicleObjectAuthority({ param = 'vin' } = {}) {
  return async (req, res, next) => {
    try {
      const { allowed, reason } = await resolveVehicleObjectAuthority(req.params?.[param], req.userContext);
      if (allowed) return next();
      // 'not_found' is answered with the same 403 as 'not_scoped' on purpose: a caller with no
      // relationship to a VIN must not learn from the status code whether that VIN exists.
      return res.status(403).json({
        error: 'Forbidden. You do not have owner, current-seller, or organizational scope over this vehicle.',
        reason,
      });
    } catch (err) {
      return res.status(403).json({ error: 'Forbidden. Vehicle authority could not be established.', reason: 'lookup_failed' });
    }
  };
}
