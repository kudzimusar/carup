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
