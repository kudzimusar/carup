/**
 * CA-K3-AUTH-01 — the server-side Corporate Admin access decision.
 *
 * The ONE place that decides whether a request may open the read-only Corporate Admin workspace. The
 * browser presents this decision; it can no longer manufacture it (before this slice the Corporate
 * shell admitted on the browser's own `/admin` route decision — CA-CERT-AUTH-001 / CA-CERT-UX-003).
 *
 * LEGACY ADMIN COMPATIBILITY BRIDGE (CA-RBAC-01 Phase 0 → Phase 2 seam):
 *
 *   The only accepted authority is the caller's SERVER-DERIVED platform role (`users.role`, read by
 *   authorizeRole from a validated session) being one of the legacy platform-administrator roles —
 *   `admin`, `platform_admin`, `super_admin`. That maps to one fixed, READ-ONLY grant.
 *
 *   It is NOT a Corporate membership, NOT target Corporate RBAC, NOT executive, Finance, People-private
 *   or record authority, and NOT unrestricted. There is no Corporate membership store yet; when one
 *   exists, this evaluator is where it plugs in.
 *
 * What can never produce a grant: authentication alone; an identity asserted by the x-user-id header
 * rather than proven by a session; a tenant role or a selected / asserted organisation; the
 * x-stakeholder-role header; a job title; anything the client says about itself.
 */

/** The legacy platform-administrator roles the compatibility bridge recognises. Nothing else. */
export const CORPORATE_COMPATIBILITY_PLATFORM_ROLES = Object.freeze(['admin', 'platform_admin', 'super_admin']);

export const CORPORATE_GRANT_SOURCE = 'legacy_admin_compatibility_bridge';

export const CORPORATE_ACCESS_CONTRACT = 'carup.corporate_access.v1';

/**
 * The read-only capabilities of the ten Corporate destinations (CA-RBAC-01 §6
 * `<plane>.<domain>.<resource>.<action>`). Kept in step with web/src/config/corporate/navigation.ts by
 * a parity test; every one ends in `.read`.
 */
export const CORPORATE_COMPATIBILITY_READ_CAPABILITIES = Object.freeze([
  'corporate.overview.read',
  'corporate.business_unit.read',
  'corporate.finance.summary.read',
  'corporate.growth.aggregate.read',
  'corporate.customer.aggregate.read',
  'corporate.operations.queue.read',
  'corporate.operations.summary.read',
  'corporate.risk.aggregate.read',
  'corporate.metric.registry.read',
  'corporate.data.quality.read',
  'corporate.intelligence.aggregate.read',
  'corporate.people.aggregate.read',
  'corporate.people.access.read',
  'corporate.report.read',
  'platform.health.read',
  'platform.feature.read',
]);

export const CORPORATE_GRANT_EXPLANATION =
  'Access via the legacy Admin compatibility bridge (platform administrator). This is not a Corporate '
  + 'membership or a permission assignment; read-only navigation only. Every operational action keeps '
  + 'its own server authorization.';

const DENIAL = Object.freeze({
  unauthenticated: { status: 401, code: 'CORPORATE_SESSION_REQUIRED', error: 'Unauthorized. Corporate Admin requires an authenticated session.' },
  not_admitted: { status: 403, code: 'CORPORATE_ACCESS_DENIED', error: 'Forbidden. This account has no Corporate Admin authority.' },
});

function deny(kind) {
  const d = DENIAL[kind];
  return { allowed: false, status: d.status, body: { decision: 'denied', code: d.code, error: d.error, contract: CORPORATE_ACCESS_CONTRACT } };
}

/**
 * Decide from the context authorizeSessionRole established. Reads ONLY `authenticationMethod` and the
 * platform role taken from `users.role` — never `effectiveRole` (which a verified tenant can lend),
 * `tenantRole`, `activeTenant`, `requestedRole` or any header.
 */
export function evaluateCorporateAccess(userContext) {
  // Defence in depth: the route already refuses the header fallback, but the evaluator does not rely
  // on being mounted correctly — an asserted identity is never Corporate authority.
  if (!userContext?.id || userContext.authenticationMethod !== 'session') return deny('unauthenticated');

  const platformRole = typeof userContext.platformRole === 'string' ? userContext.platformRole.toLowerCase() : null;
  if (!platformRole || !CORPORATE_COMPATIBILITY_PLATFORM_ROLES.includes(platformRole)) return deny('not_admitted');

  return {
    allowed: true,
    status: 200,
    body: {
      contract: CORPORATE_ACCESS_CONTRACT,
      decision: 'granted',
      grant: {
        source: CORPORATE_GRANT_SOURCE,
        read_only: true,
        capabilities: [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES],
        explanation: CORPORATE_GRANT_EXPLANATION,
      },
    },
  };
}
