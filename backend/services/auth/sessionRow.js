import crypto from 'crypto';

/**
 * Build a `user_sessions` insert row.
 *
 * The production user_sessions table carries legacy NOT NULL columns (`id`, `active_role`,
 * `created_at`) that have no database default, ALONGSIDE the token-based columns (`token`,
 * `is_valid`) the auth middleware uses. If those legacy columns are omitted the insert fails a
 * NOT NULL constraint, the session is never persisted, and the returned token then 401s on every
 * authenticated request ("Unauthorized. Session is invalid or expired."). This helper guarantees
 * they are always populated.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.activeRole - role to record on the session (legacy active_role column)
 * @param {string} args.token      - the session token the client will present
 * @param {string} args.expiresAt  - ISO timestamp string
 * @param {object} [args.req]      - express request (for ip / user-agent)
 * @param {string|null} [args.tenantId]
 */
export function buildSessionRow({ userId, activeRole, token, expiresAt, req = null, tenantId = null, authMethod = 'password' }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    active_role: activeRole,
    active_organization_id: tenantId,
    token,
    ip_address: req?.ip || '127.0.0.1',
    user_agent: req?.headers?.['user-agent'] ?? null,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    is_valid: true,
    // O2-X3 assurance columns: HOW the session was established is a server-side fact — the
    // step-up columns start empty and are stamped only by the step-up endpoint.
    auth_method: authMethod,
  };
}
