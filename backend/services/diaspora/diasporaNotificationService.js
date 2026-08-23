import { createHash, randomUUID } from 'crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

function buildDedupeKey({ recipientId, type, importOrderId, metadata = {} }) {
  const discriminator = metadata.documentId
    || metadata.milestoneId
    || metadata.paymentMilestoneId
    || metadata.sellerId
    || metadata.quoteId
    || metadata.reservationId
    || metadata.shipmentId
    || metadata.id
    || 'event';

  const digest = createHash('sha256')
    .update([recipientId, type, importOrderId || 'none', discriminator].join('|'))
    .digest('hex');

  return `diaspora:${digest}`;
}

export function buildDiasporaNotificationRow({
  recipientId,
  type,
  title,
  message,
  importOrderId = null,
  tenantId = null,
  channels = ['IN_APP'],
  metadata = {},
  now = new Date().toISOString(),
} = {}) {
  const notificationMetadata = { ...metadata, importOrderId, channels };

  return {
    tenant_id: tenantId,
    recipient_id: recipientId,
    recipient_user_id: recipientId,
    type,
    notification_type: type,
    title,
    message,
    // Legacy notification_queue compatibility. The original table still carries this NOT NULL column.
    message_content: message,
    channel: 'IN_APP',
    payload: notificationMetadata,
    priority: 'normal',
    // Upper-case QUEUED is accepted by both the original and the expanded queue constraints.
    status: 'QUEUED',
    retry_count: 0,
    attempt_count: 0,
    max_attempts: 5,
    dedupe_key: buildDedupeKey({ recipientId, type, importOrderId, metadata }),
    scheduled_at: now,
    created_at: now,
    updated_at: now,
    read: false,
    metadata: notificationMetadata,
  };
}

function isDuplicateError(error) {
  return error?.code === '23505'
    || /duplicate key|idx_notification_queue_dedupe|dedupe/i.test(error?.message || '');
}

async function findExistingByDedupeKey(supabaseClient, dedupeKey) {
  const { data, error } = await supabaseClient
    .from('notification_queue')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function insertNotificationRow(supabaseClient, row) {
  let result = await supabaseClient
    .from('notification_queue')
    .insert(row)
    .select()
    .single();

  if (!result.error) return result.data;
  if (isDuplicateError(result.error)) {
    return findExistingByDedupeKey(supabaseClient, row.dedupe_key);
  }

  // Some historical notification_queue deployments use TEXT/UUID ids without a default.
  if (/null value.*id|violates not-null constraint/i.test(result.error.message || '')) {
    result = await supabaseClient
      .from('notification_queue')
      .insert({ id: randomUUID(), ...row })
      .select()
      .single();
    if (!result.error) return result.data;
    if (isDuplicateError(result.error)) {
      return findExistingByDedupeKey(supabaseClient, row.dedupe_key);
    }
  }

  throw result.error;
}

export async function emitDiasporaEvent(eventType, payload, tenantId = null) {
  return emitDomainEvent(null, eventType, payload, tenantId);
}

export async function queueDiasporaNotification({
  recipientId,
  type,
  title,
  message,
  importOrderId = null,
  tenantId = null,
  channels = ['IN_APP'],
  metadata = {},
}, supabaseClient = supabase) {
  if (!recipientId) return null;

  const row = buildDiasporaNotificationRow({
    recipientId,
    type,
    title,
    message,
    importOrderId,
    tenantId,
    channels,
    metadata,
  });

  try {
    return await insertNotificationRow(supabaseClient, row);
  } catch (err) {
    console.warn('⚠️ Diaspora notification queue insert skipped:', err.message);
    return null;
  }
}

export async function notifyDiasporaMilestone({ eventType, importOrder, actorId = null, title, message, metadata = {} }) {
  await emitDiasporaEvent(eventType, {
    importOrderId: importOrder?.id,
    status: importOrder?.status,
    actorId,
    title,
    message,
    ...metadata,
  }, importOrder?.tenant_id || null);

  return queueDiasporaNotification({
    recipientId: importOrder?.buyer_id || importOrder?.created_by,
    tenantId: importOrder?.tenant_id || null,
    type: eventType,
    title,
    message,
    importOrderId: importOrder?.id,
    channels: ['IN_APP', 'EMAIL_READY', 'SMS_READY', 'WHATSAPP_READY', 'PUSH_READY'],
    metadata,
  });
}

export async function listNotificationPreferences(userId) {
  const { data, error } = await supabase
    .from('diaspora_notification_preferences')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data || [];
}
