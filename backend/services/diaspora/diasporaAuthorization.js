import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../utils/errors.js';

export const PLATFORM_REVIEW_ROLES = new Set([
  'platform_admin',
  'super_admin',
  'government',
  'government_reviewer',
  'reviewer',
]);

export const TENANT_ADMIN_ROLES = new Set([
  'admin',
  'administrator',
  'tenant_admin',
]);

// Platform-level admins (server-derived platformRole only — never the requested/header role).
export const PLATFORM_ADMIN_ROLES = new Set([
  'admin',
  'platform_admin',
  'super_admin',
]);

const INACTIVE_PARTICIPANT_STATES = new Set([
  'cancelled',
  'deleted',
  'inactive',
  'rejected',
  'removed',
  'revoked',
  'suspended',
]);

const BUYER_TRANSITION_STATUSES = new Set([
  IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING,
  IMPORT_ORDER_STATUSES.FLAGGED_FOR_REVIEW,
  IMPORT_ORDER_STATUSES.CANCELLED,
]);

const PARTICIPANT_TRANSITION_STATUSES = new Set([
  IMPORT_ORDER_STATUSES.QUOTE_ISSUED,
  IMPORT_ORDER_STATUSES.SELLER_ASSIGNED,
  IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING,
  IMPORT_ORDER_STATUSES.CONTAINER_BOOKED,
  IMPORT_ORDER_STATUSES.READY_FOR_LOADING,
  IMPORT_ORDER_STATUSES.LOADED,
  IMPORT_ORDER_STATUSES.SHIPPED,
  IMPORT_ORDER_STATUSES.ARRIVED_AT_BORDER,
  IMPORT_ORDER_STATUSES.FLAGGED_FOR_REVIEW,
]);

export function normalizeId(value) {
  return value === undefined || value === null ? null : String(value);
}

export function requireUserContext(userContext = {}) {
  const id = normalizeId(userContext.id ?? userContext.userId ?? userContext.actorId);
  if (!id) {
    throw new UnauthorizedError('Diaspora Trade access requires an authenticated user context');
  }

  return {
    ...userContext,
    id,
    userId: id,
    role: userContext.role ?? userContext.tenantRole ?? userContext.platformRole ?? 'member',
    platformRole: userContext.platformRole ?? userContext.platform_role ?? null,
    tenantRole: userContext.tenantRole ?? userContext.tenant_role ?? null,
    tenantId: normalizeId(userContext.tenantId ?? userContext.tenant_id),
  };
}

export function isPlatformReviewer(userContext = {}) {
  return PLATFORM_REVIEW_ROLES.has(String(userContext.platformRole ?? userContext.platform_role ?? '').toLowerCase());
}

// Trusted platform admin, derived only from the server-resolved platformRole.
export function isPlatformAdmin(userContext = {}) {
  return PLATFORM_ADMIN_ROLES.has(String(userContext.platformRole ?? userContext.platform_role ?? '').toLowerCase());
}

/**
 * Who may approve/reject a cargo reservation: a trusted platform admin/reviewer, or a tenant admin
 * of the reservation's tenant. Buyers (order owners) cannot. Uses server-derived roles only — the
 * client x-stakeholder-role is never trusted here.
 */
export function canReviewReservation(reservation = {}, userContext = {}) {
  return isPlatformAdmin(userContext) || isPlatformReviewer(userContext) || isTenantAdminForRecord(reservation, userContext);
}

export function assertCanReviewReservation(reservation = {}, userContext = {}) {
  if (!canReviewReservation(reservation, userContext)) {
    throw new ForbiddenError('You are not authorized to review this Diaspora cargo reservation');
  }
}

/** The reservation owner (the buyer who created it) or a reviewer/admin may cancel it. */
export function canCancelReservation(reservation = {}, userContext = {}) {
  const userId = normalizeId(userContext.id ?? userContext.userId);
  const isOwner = [reservation.buyer_id, reservation.created_by].some((c) => normalizeId(c) === userId);
  return isOwner || canReviewReservation(reservation, userContext);
}

export function assertCanCancelReservation(reservation = {}, userContext = {}) {
  if (!canCancelReservation(reservation, userContext)) {
    throw new ForbiddenError('You are not authorized to cancel this Diaspora cargo reservation');
  }
}

/**
 * Official logistics lifecycle mutations (creating/transitioning containers, creating shipments,
 * advancing shipment stage) are restricted to trusted platform admins/reviewers, or a tenant admin
 * of the affected record's tenant. Buyers (order owners) are never granted this. Uses server-derived
 * roles only — the client x-stakeholder-role is never trusted here.
 */
export function canManageLogistics(record = {}, userContext = {}) {
  return isPlatformAdmin(userContext) || isPlatformReviewer(userContext) || isTenantAdminForRecord(record, userContext);
}

export function assertCanManageLogistics(record = {}, userContext = {}) {
  if (!canManageLogistics(record, userContext)) {
    throw new ForbiddenError('You are not authorized to manage Diaspora shipment logistics');
  }
}

export function isTenantAdminForRecord(record = {}, userContext = {}) {
  const role = String(userContext.tenantRole ?? userContext.tenant_role ?? '').toLowerCase();
  const userTenantId = normalizeId(userContext.tenantId ?? userContext.tenant_id);
  const recordTenantId = normalizeId(record.tenant_id ?? record.tenantId);
  return TENANT_ADMIN_ROLES.has(role) && Boolean(userTenantId && recordTenantId && userTenantId === recordTenantId);
}

export function isOrderOwner(order = {}, userContext = {}) {
  const userId = normalizeId(userContext.id ?? userContext.userId);
  return [
    order.buyer_id,
    order.buyerId,
    order.owner_id,
    order.ownerId,
    order.user_id,
    order.userId,
    order.created_by,
    order.createdBy,
    order.updated_by,
    order.updatedBy,
  ].some((candidate) => normalizeId(candidate) === userId);
}

export function isAssignedParticipant(participants = [], userContext = {}) {
  const userId = normalizeId(userContext.id ?? userContext.userId);
  return participants.some((participant) => {
    const participantUserId = normalizeId(participant.user_id ?? participant.userId ?? participant.participant_id ?? participant.participantId);
    const verificationStatus = String(participant.verification_status ?? participant.status ?? 'active').toLowerCase();
    return participantUserId === userId
      && !participant.deleted_at
      && !INACTIVE_PARTICIPANT_STATES.has(verificationStatus);
  });
}

export function canReadImportOrder(order, participants = [], userContext = {}) {
  if (!order) return false;
  if (isPlatformReviewer(userContext)) return true;
  if (isTenantAdminForRecord(order, userContext)) return true;
  if (isOrderOwner(order, userContext)) return true;
  return isAssignedParticipant(participants, userContext);
}

export function assertCanReadImportOrder(order, participants = [], userContext = {}) {
  if (!canReadImportOrder(order, participants, userContext)) {
    throw new ForbiddenError('You do not have access to this Diaspora Trade import order');
  }
}

export function assertImportOrderIdRequired(importOrderId, userContext = {}) {
  if (!importOrderId && !isPlatformReviewer(userContext)) {
    throw new ValidationError('importOrderId is required for Diaspora Trade document access');
  }
}

export function canReadTradeDocument(document = {}, order = null, participants = [], userContext = {}) {
  if (!document) return false;
  if (isPlatformReviewer(userContext)) return true;
  if (isTenantAdminForRecord(document, userContext)) return true;
  if (normalizeId(document.uploaded_by ?? document.uploadedBy) === normalizeId(userContext.id ?? userContext.userId)) return true;
  return canReadImportOrder(order, participants, userContext);
}

export function assertCanReadTradeDocument(document, order, participants, userContext = {}) {
  if (!canReadTradeDocument(document, order, participants, userContext)) {
    throw new ForbiddenError('You do not have access to this Diaspora Trade document');
  }
}

export function canTransitionImportOrderForContext(order, participants = [], nextStatus, userContext = {}) {
  if (!canReadImportOrder(order, participants, userContext)) return false;
  if (isPlatformReviewer(userContext)) return true;
  if (isTenantAdminForRecord(order, userContext)) return true;
  if (isOrderOwner(order, userContext)) return BUYER_TRANSITION_STATUSES.has(nextStatus);
  if (isAssignedParticipant(participants, userContext)) return PARTICIPANT_TRANSITION_STATUSES.has(nextStatus);
  return false;
}

export function assertCanTransitionImportOrder(order, participants, nextStatus, userContext = {}) {
  if (!canTransitionImportOrderForContext(order, participants, nextStatus, userContext)) {
    throw new ForbiddenError('You are not authorized to perform this Diaspora Trade transition');
  }
}

/**
 * Subscription MANAGEMENT (checkout / portal / change-plan / cancel) is restricted to trusted
 * subscription managers — billing is a tenant-level financial control, not a per-record operation:
 *   - a platform admin / super-admin (PLATFORM_ADMIN_ROLES) may manage any tenant's subscription; OR
 *   - a tenant admin (TENANT_ADMIN_ROLES) acting on their OWN tenant may manage that tenant's
 *     subscription.
 * Ordinary tenant members (buyer/seller/dealer/mechanic/bank/manager/…) AND platform/government
 * reviewers are READ-ONLY: a reviewer must not change or cancel billing merely because they can
 * review other records. Server-derived roles only — the client x-stakeholder-role and any
 * client-submitted tenant id are never trusted; the auth middleware already rejects an x-tenant-id
 * without a verified tenant_users membership, so userContext.tenantId is a confirmed-membership tenant.
 * Cross-tenant management is denied (the target tenant must equal the caller's own tenant unless
 * platform admin).
 */
export function canManageSubscription(userContext = {}, tenantId = null) {
  const target = normalizeId(tenantId);
  if (!target) return false;
  if (isPlatformAdmin(userContext)) return true;
  const tenantRole = String(userContext.tenantRole ?? userContext.tenant_role ?? '').toLowerCase();
  const userTenantId = normalizeId(userContext.tenantId ?? userContext.tenant_id);
  return Boolean(userTenantId && userTenantId === target) && TENANT_ADMIN_ROLES.has(tenantRole);
}

export function assertCanManageSubscription(userContext = {}, tenantId = null) {
  const ctx = requireUserContext(userContext);
  if (!normalizeId(tenantId)) {
    throw new ValidationError('A tenant context is required to manage a subscription');
  }
  if (!canManageSubscription(ctx, tenantId)) {
    throw new ForbiddenError('You are not authorized to manage this tenant subscription', {
      code: 'SUBSCRIPTION_MANAGEMENT_FORBIDDEN',
      requiredRole: 'tenant admin or platform admin',
    });
  }
}

export function redactTradeDocumentStorage(document) {
  if (!document) return document;
  const {
    storage_path: storagePath,
    storagePath: camelStoragePath,
    private_storage_path: privateStoragePath,
    privateStoragePath: camelPrivateStoragePath,
    ...safeDocument
  } = document;

  void storagePath;
  void camelStoragePath;
  void privateStoragePath;
  void camelPrivateStoragePath;

  return safeDocument;
}
