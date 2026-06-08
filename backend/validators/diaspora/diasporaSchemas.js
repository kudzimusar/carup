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

export function validateTradeProfilePayload(payload) {
  requireFields(payload, ['user_id', 'country', 'city', 'role_type']);
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
