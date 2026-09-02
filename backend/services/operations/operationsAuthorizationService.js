/**
 * Operations authorization policy — Operations Control Plane M5.
 *
 * The FIRST bounded server-side capability layer. It exists to stop expanding
 * raw "admin means everything" authority: new and modified Operations paths
 * authorize against named capabilities instead of sprinkling more role checks,
 * while existing platform roles map onto capabilities for compatibility (no
 * all-at-once RBAC rewrite — manual §21).
 *
 * Rules encoded here (G2/G4, manual §8):
 *  - capabilities derive from the SERVER-derived platform/base role, never from
 *    the client-selected effective role: a tenant/portal header selection can
 *    never grant global Operations authority (the marketplaceModerationService
 *    anti-escalation pattern, generalized);
 *  - platform_admin / super_admin hold the full compatibility set (deliberate
 *    M5.5/M5.6 mapping) — they are backend-recognized platform authority even
 *    though the shared frontend UserRole cannot represent them yet;
 *  - government holds exactly the reviewer capabilities its existing routes
 *    already exercised (evidence verify/reject, classification correction,
 *    seller-authority review, private vehicle read) — nothing broader;
 *  - consequential capabilities require a PROVEN session: the x-user-id
 *    fallback identity is refused outright.
 *
 * Persistent per-user capability grants are deliberately NOT introduced in this
 * slice (M8 decides); this module is the single seam where a persistent model
 * would later plug in.
 */

export const OPERATIONS_CAPABILITIES = Object.freeze({
  VEHICLE_READ_PRIVATE: 'operations.vehicle.read_private',
  VEHICLE_EVIDENCE_REVIEW: 'operations.vehicle_evidence.review',
  VEHICLE_EVIDENCE_CLASSIFY: 'operations.vehicle_evidence.classify',
  SELLER_AUTHORITY_REVIEW: 'operations.seller_authority.review',
});

const ALL_VEHICLE_OPERATIONS = Object.freeze([
  OPERATIONS_CAPABILITIES.VEHICLE_READ_PRIVATE,
  OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW,
  OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_CLASSIFY,
  OPERATIONS_CAPABILITIES.SELLER_AUTHORITY_REVIEW,
]);

/** Compatibility mapping: server-derived platform/base role → capability set. */
const ROLE_CAPABILITY_MAP = Object.freeze({
  admin: ALL_VEHICLE_OPERATIONS,
  platform_admin: ALL_VEHICLE_OPERATIONS,
  super_admin: ALL_VEHICLE_OPERATIONS,
  government: ALL_VEHICLE_OPERATIONS,
});

/**
 * The role that GRANTS operations capability. Deliberately the server-derived
 * platform/base identity — NEVER userContext.role (effectiveRole), which can be
 * steered by the x-stakeholder-role header within tenant bounds.
 */
export function operationsGrantingRole(userContext = {}) {
  return userContext.platformRole || userContext.baseRole || null;
}

export function capabilitiesForContext(userContext = {}) {
  const grantingRole = operationsGrantingRole(userContext);
  return ROLE_CAPABILITY_MAP[grantingRole] || [];
}

export function hasOperationsCapability(userContext, capability) {
  return capabilitiesForContext(userContext).includes(capability);
}

export function isProvenSession(userContext = {}) {
  return Boolean(userContext.id) && userContext.authenticationMethod !== 'x-user-id-fallback';
}

/**
 * Express middleware factory. Compose AFTER authorizeRole() (which builds
 * req.userContext); this layer answers the CAPABILITY question and, by default,
 * demands a proven session.
 */
export function requireOperationsCapability(capability, { requireProven = true } = {}) {
  return (req, res, next) => {
    const userContext = req.userContext;
    if (!userContext?.id) {
      return res.status(401).json({ error: 'Authentication required.', code: 'OPERATIONS_UNAUTHENTICATED' });
    }
    if (requireProven && !isProvenSession(userContext)) {
      return res.status(403).json({
        error: 'This Operations action requires a proven session.',
        code: 'OPERATIONS_PROVEN_SESSION_REQUIRED',
      });
    }
    if (!hasOperationsCapability(userContext, capability)) {
      return res.status(403).json({
        error: `Forbidden. This action requires the '${capability}' capability.`,
        code: 'OPERATIONS_CAPABILITY_REQUIRED',
        capability,
      });
    }
    return next();
  };
}

/**
 * Server-derived allowed actions for the Vehicle Operations workspace DTO.
 * The UI renders what the server says — it never grants (G2). There is
 * deliberately NO action here for arbitrary Trust mutation, ZIMRA/CVR
 * assertion, or admin auto-publish (manual §20 action rules).
 */
export function allowedVehicleOperationsActions(userContext = {}) {
  const actions = [];
  if (hasOperationsCapability(userContext, OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW)) {
    actions.push('evidence.verify', 'evidence.reject');
  }
  if (hasOperationsCapability(userContext, OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_CLASSIFY)) {
    actions.push('evidence.correct_classification');
  }
  if (hasOperationsCapability(userContext, OPERATIONS_CAPABILITIES.SELLER_AUTHORITY_REVIEW)) {
    actions.push('seller_authority.review');
  }
  return actions;
}

export default {
  OPERATIONS_CAPABILITIES,
  operationsGrantingRole,
  capabilitiesForContext,
  hasOperationsCapability,
  isProvenSession,
  requireOperationsCapability,
  allowedVehicleOperationsActions,
};
