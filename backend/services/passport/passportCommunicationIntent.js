export const PASSPORT_COMMUNICATION_CLASSES = Object.freeze([
  'evidence_review',
  'discrepancy',
  'trust_material_change',
  'service_maintenance',
  'compliance_due',
  'ownership_transfer',
  'marketplace_transaction',
  'safety_recall',
]);

const CLASS_SET = new Set(PASSPORT_COMMUNICATION_CLASSES);

const FORBIDDEN_TRANSPORT_KEYS = new Set([
  'channel',
  'provider',
  'email',
  'phone',
  'phone_number',
  'whatsapp',
  'telegram_chat_id',
  'sms',
  'push_token',
  'expo_push_token',
  'template_key',
]);

function assertSafePayload(value, path = 'payload') {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TRANSPORT_KEYS.has(key)) {
      throw new Error(`Passport communication intent cannot own transport field ${path}.${key}`);
    }
    assertSafePayload(child, `${path}.${key}`);
  }
}

export function buildPassportCommunicationIntent({
  lifecycle_class,
  domain_event_type,
  domain_event_id = null,
  dedupe_key = null,
  recipient_user_id,
  vin,
  subject_type = 'vehicle',
  subject_id = null,
  tenant_id = null,
  priority = 'normal',
  transactional = true,
  safe_payload = {},
} = {}) {
  if (!CLASS_SET.has(lifecycle_class)) {
    throw new Error(`Unsupported Passport communication class: ${lifecycle_class}`);
  }
  if (!domain_event_type || typeof domain_event_type !== 'string') {
    throw new Error('Passport communication intent requires canonical domain_event_type');
  }
  if (!recipient_user_id) {
    throw new Error('Passport communication intent requires recipient_user_id');
  }
  if (!vin) {
    throw new Error('Passport communication intent requires VIN');
  }
  if (!domain_event_id && !dedupe_key) {
    throw new Error('Passport communication intent requires domain_event_id or deterministic dedupe_key');
  }

  assertSafePayload(safe_payload);

  return {
    lifecycle_class,
    event: {
      event_type: domain_event_type,
      event_id: domain_event_id,
      dedupe_key,
      tenant_id,
      payload: {
        ...safe_payload,
        recipientUserId: String(recipient_user_id),
        vin: String(vin),
        subject_type,
        subject_id: subject_id ?? String(vin),
        passport_lifecycle_class: lifecycle_class,
        passport_priority: priority,
        passport_transactional: transactional !== false,
      },
    },
    routing_authority: 'communications',
    provider_selected: false,
    channel_selected: false,
    template_selected: false,
  };
}

export function assertPassportCommunicationIntent(intent) {
  if (!intent || intent.routing_authority !== 'communications') {
    throw new Error('Passport communication routing authority must remain Communications');
  }
  if (
    intent.provider_selected !== false
    || intent.channel_selected !== false
    || intent.template_selected !== false
  ) {
    throw new Error('Passport communication intent must not preselect provider/channel/template');
  }
  assertSafePayload(intent.event?.payload || {});
  return intent;
}

export default {
  PASSPORT_COMMUNICATION_CLASSES,
  buildPassportCommunicationIntent,
  assertPassportCommunicationIntent,
};
