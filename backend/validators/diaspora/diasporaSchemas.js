import { DIASPORA_DOCUMENT_TYPES } from '../../constants/diaspora/diasporaDocumentTypes.js';
import { ValidationError } from '../../utils/errors.js';

export function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === '');
  if (missing.length > 0) {
    throw new ValidationError(`Missing required field(s): ${missing.join(', ')}`, { missing });
  }
}

export function validateEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new ValidationError(`Invalid ${fieldName}. Expected one of: ${allowedValues.join(', ')}`, { fieldName, value });
  }
}

export function validateImportOrderPayload(payload) {
  requireFields(payload, ['order_type', 'origin_country', 'destination_country']);
  validateEnum(payload.order_type, ['vehicle', 'parts', 'mixed'], 'order_type');
  return payload;
}

// user_id is intentionally NOT required here: self-service callers create their own profile and the
// server derives user_id from the authenticated context (diasporaTradeProfileService.createTradeProfile);
// only a platform admin/reviewer may supply a different user_id to seed a profile on someone's behalf.
export function validateTradeProfilePayload(payload) {
  requireFields(payload, ['country', 'city', 'role_type']);
  validateEnum(payload.role_type, ['buyer', 'seller', 'exporter', 'agent', 'dealer', 'company', 'coordinator'], 'role_type');
  return payload;
}

export function validateTradeDocumentPayload(payload) {
  requireFields(payload, ['document_type']);
  validateEnum(payload.document_type, DIASPORA_DOCUMENT_TYPES, 'document_type');
  return payload;
}

export function validateContainerPayload(payload) {
  requireFields(payload, [
    'origin_country',
    'origin_city',
    'destination_country',
    'destination_city',
    'departure_date',
    'booking_deadline',
    'container_type',
    'total_capacity_volume',
  ]);
  return payload;
}

export function validateReservationPayload(payload) {
  requireFields(payload, ['container_id', 'import_order_id', 'cargo_type', 'estimated_volume']);
  validateEnum(payload.cargo_type, ['vehicle', 'parts', 'mixed', 'other'], 'cargo_type');
  return payload;
}

export function validateShipmentPayload(payload) {
  requireFields(payload, ['import_order_id']);
  return payload;
}

// A payment milestone is a non-custodial reference record (the buyer/seller declaring that an
// off-platform payment step happened or is due) — CarUp never moves money for this legacy path.
// See diaspora_safetrade_milestones for the fail-closed sandbox-only escrow overlay, a separate
// system with its own atomic RPC.
export function validatePaymentMilestonePayload(payload) {
  requireFields(payload, ['milestone_type', 'amount']);
  validateEnum(payload.milestone_type, ['DEPOSIT', 'BALANCE_DUE', 'SHIPPING_FEE', 'CUSTOMS_DUTY', 'FINAL_PAYMENT', 'OTHER'], 'milestone_type');
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('amount must be a positive number', { amount: payload.amount });
  }
  if (payload.status) {
    validateEnum(payload.status, ['PENDING', 'CONFIRMED', 'FAILED', 'WAIVED', 'CANCELLED'], 'status');
  }
  return payload;
}
