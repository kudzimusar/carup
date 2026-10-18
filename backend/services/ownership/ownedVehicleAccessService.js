import { UnauthorizedError } from '../../utils/errors.js';

const EXISTING_OWNER_WORKSPACE_ROLES = new Set([
  'owner',
  'dealer',
  'admin',
  'platform_admin',
  'super_admin',
]);

function normalize(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

/**
 * Dependency B closure.
 *
 * Legal Vehicle ownership is a relationship fact (vehicles.owner_id), not an account role.
 * The existing /api/vehicles/me surface historically also serves the current Seller workspace for
 * owner/dealer/admin contexts. Preserve that compatibility, but a different base/effective role
 * (notably buyer) may enter this endpoint ONLY through exact canonical owner_id equality.
 *
 * Consequential ownership access requires a real session. A development x-user-id assertion must
 * never become ownership authority.
 */
export function resolveMyVehiclesScope(userContext = {}) {
  const userId = String(userContext.id || userContext.userId || '').trim();
  if (!userId) throw new UnauthorizedError('Authenticated session identity is required to read owned vehicles.');
  if (userContext.authenticationMethod !== 'session') {
    throw new UnauthorizedError('Owned-vehicle access requires a real session identity.');
  }

  const effectiveRole = normalize(userContext.effectiveRole || userContext.role);
  const platformRole = normalize(userContext.platformRole || userContext.baseRole || userContext.role);
  const preserveSellerWorkspace =
    EXISTING_OWNER_WORKSPACE_ROLES.has(effectiveRole)
    || EXISTING_OWNER_WORKSPACE_ROLES.has(platformRole);

  return {
    userId,
    preserveSellerWorkspace,
  };
}

export function applyMyVehiclesScope(query, userContext = {}) {
  const scope = resolveMyVehiclesScope(userContext);
  if (scope.preserveSellerWorkspace) {
    return query.or(`owner_id.eq.${scope.userId},current_seller_id.eq.${scope.userId}`);
  }
  return query.eq('owner_id', scope.userId);
}

/** Canonical legal ownership proof. current_seller_id is deliberately ignored. */
export function isLegalOwnerBySession(vehicle = {}, userContext = {}) {
  const scope = resolveMyVehiclesScope(userContext);
  return String(vehicle.owner_id || '') === scope.userId;
}

export default {
  resolveMyVehiclesScope,
  applyMyVehiclesScope,
  isLegalOwnerBySession,
};
