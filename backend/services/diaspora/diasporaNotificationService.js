import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

export async function emitDiasporaEvent(eventType, payload, tenantId = null) {
  return emitDomainEvent(null, eventType, payload, tenantId);
}

export async function queueDiasporaNotification({ recipientId, type, title, message, importOrderId = null, channels = ['IN_APP'], metadata = {} }) {
  if (!recipientId) return null;

  try {
    const { data, error } = await supabase
      .from('notification_queue')
      .insert({
        recipient_id: recipientId,
        channel: 'in_app',
        type,
        title,
        message,
        read: false,
        metadata: { ...metadata, importOrderId, channels },
      })
      .select()
      .single();

    // Do not fall back to a legacy insert that omits channel. The canonical reader filters on
    // channel='in_app'; creating an invisible row would report success while dropping the user's
    // notification from the product.
    if (error) throw error;
    return data;
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
