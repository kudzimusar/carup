/**
 * OC-5D — a caller exactly as the auth middleware builds one after verifying an explicit active
 * organisation (backend/services/auth/activeTenantContext.js). Service Network decides "which garage
 * acts" from `activeTenant` only (serviceAuthority.requireGarageTenant), so a test context carrying a
 * bare `tenantId` — #197's shape — no longer acts for any garage, by design.
 */
export function garageCtx({ id, tenantId = null, tenantRole = 'admin', type = 'garage', platformRole = 'owner', name = null } = {}) {
  return {
    id,
    userId: id,
    role: platformRole,
    platformRole,
    effectiveRole: platformRole,
    tenantId,
    tenantRole: tenantId ? tenantRole : null,
    activeTenant: tenantId
      ? { id: String(tenantId), name, type, status: 'active', role: tenantRole, usable: true, metadataUnavailable: false }
      : null,
    tenantContext: tenantId ? 'selected' : 'none',
    authenticationMethod: 'session',
  };
}
