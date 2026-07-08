import crypto from 'crypto';
import logger from '../../utils/logger.js';

const MAX_RECENT_RECEIPTS = 20;
const SOURCE = 'meta_whatsapp';
const ROUTE = '/api/communications/webhooks/meta/whatsapp';
const receipts = [];

function headerValue(headers = {}, name) {
  const wanted = String(name).toLowerCase();
  const found = Object.entries(headers || {}).find(([key]) => String(key).toLowerCase() === wanted);
  return found?.[1];
}

function isProductionDeployment(env = process.env) {
  return env.VERCEL_ENV === 'production'
    || env.CARUP_ENV === 'production'
    || env.CARUP_ENVIRONMENT === 'production'
    || env.CARUP_DEPLOYMENT_TARGET === 'production';
}

export function isWebhookUatDiagnosticsEnabled(env = process.env) {
  return env.CARUP_COMMUNICATION_WEBHOOK_UAT_DIAGNOSTICS === 'true' && !isProductionDeployment(env);
}

function bodyType(body) {
  if (Array.isArray(body)) return 'array';
  if (body === null) return 'null';
  return typeof body;
}

function bodyShape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body).slice(0, 12);
}

function redactWaIdLast4(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

function messageIdPrefix(value) {
  const text = String(value || '');
  return text ? text.slice(0, 14) : null;
}

function textPreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 80) : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function summarizeMetaWhatsAppWebhookBody(body = {}, { includeTextPreview = false } = {}) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const changes = entries.flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : []);
  const values = changes.map((change) => change?.value || {});
  const messages = values.flatMap((value) => Array.isArray(value?.messages) ? value.messages : []);
  const statuses = values.flatMap((value) => Array.isArray(value?.statuses) ? value.statuses : []);
  const firstMessage = messages[0] || null;
  const fieldNames = unique(changes.map((change) => change?.field));
  const eventType = messages.length > 0
    ? 'message'
    : statuses.length > 0
      ? 'status'
      : fieldNames.some((field) => String(field).includes('template'))
        ? 'template_update'
        : 'unknown';

  const summary = {
    body_type: bodyType(body),
    body_shape: bodyShape(body),
    object_field: body?.object || null,
    entry_count: entries.length,
    changes_count: changes.length,
    field_names: fieldNames,
    has_value_messages: messages.length > 0,
    has_value_statuses: statuses.length > 0,
    message_count: messages.length,
    status_count: statuses.length,
    first_message_type: firstMessage?.type || null,
    first_message_id_prefix: messageIdPrefix(firstMessage?.id),
    sender_wa_id_last4: redactWaIdLast4(firstMessage?.from || values[0]?.contacts?.[0]?.wa_id),
    detected_event_type: eventType,
  };

  if (includeTextPreview && firstMessage?.text?.body) {
    summary.inbound_text_preview = textPreview(firstMessage.text.body);
  }

  if (includeTextPreview) {
    summary.normalized_payload_summary = {
      object: summary.object_field,
      entry_ids: entries.map((entry) => String(entry?.id || '').slice(0, 12)).filter(Boolean),
      fields: fieldNames,
      messaging_product: unique(values.map((value) => value.messaging_product)),
      metadata_phone_number_id_present: values.some((value) => Boolean(value?.metadata?.phone_number_id)),
      message_types: unique(messages.map((message) => message?.type)),
      status_values: unique(statuses.map((status) => status?.status)),
      inbound_text_preview: summary.inbound_text_preview || null,
    };
  }

  return summary;
}

export function recordMetaWhatsAppWebhookReceipt({ req = {}, body = {}, env = process.env } = {}) {
  const requestId = req.requestId || req.correlationId || headerValue(req.headers, 'x-request-id') || `req-${crypto.randomUUID()}`;
  const diagnosticsEnabled = isWebhookUatDiagnosticsEnabled(env);
  const bodySummary = summarizeMetaWhatsAppWebhookBody(body, { includeTextPreview: diagnosticsEnabled });
  const item = {
    timestamp: new Date().toISOString(),
    requestId,
    correlationId: requestId,
    route: ROUTE,
    source: SOURCE,
    http_method: String(req.method || 'POST').toUpperCase(),
    processing_status: 'received',
    detected_event_type: bodySummary.detected_event_type,
    message_count: bodySummary.message_count,
    status_count: bodySummary.status_count,
    normalized_channel: 'whatsapp',
    persisted_message_id: null,
    thread_id: null,
    error_code: null,
    error_message: null,
    diagnostics_enabled: diagnosticsEnabled,
    method: String(req.method || 'POST').toUpperCase(),
    path: req.originalUrl?.split('?')[0] || req.path || ROUTE,
    x_hub_sig_256: headerValue(req.headers, 'x-hub-signature-256') ? 'present' : 'absent',
    user_agent: headerValue(req.headers, 'user-agent') || null,
    content_type: headerValue(req.headers, 'content-type') || null,
    ...bodySummary,
  };

  receipts.unshift(item);
  receipts.splice(MAX_RECENT_RECEIPTS);

  logger.info('communications.webhook', 'Meta WhatsApp webhook receipt', item);
  return item;
}

export function finalizeMetaWhatsAppWebhookReceipt(requestId, patch = {}) {
  const item = receipts.find((entry) => entry.requestId === requestId);
  if (!item) return null;
  Object.assign(item, {
    processing_status: patch.processing_status || item.processing_status,
    persisted_message_id: patch.persisted_message_id ?? item.persisted_message_id,
    thread_id: patch.thread_id ?? item.thread_id,
    error_code: patch.error_code ?? item.error_code,
    error_message: patch.error_message ? textPreview(patch.error_message) : item.error_message,
    completed_at: new Date().toISOString(),
  });
  logger.info('communications.webhook', 'Meta WhatsApp webhook receipt finalized', item);
  return item;
}

export function persistencePatchFromWebhookResult(result = {}, eventType = 'unknown') {
  const first = Array.isArray(result.results) ? result.results[0] : null;
  const hasMessage = Boolean(first?.message?.id);
  const statusOnly = eventType === 'status' && !hasMessage;
  return {
    processing_status: hasMessage ? 'processed' : statusOnly ? 'ignored' : (Number(result.count || 0) > 0 ? 'processed' : 'ignored'),
    persisted_message_id: first?.message?.id || null,
    thread_id: first?.thread?.id || null,
  };
}

export function recentMetaWhatsAppWebhookReceipts() {
  return receipts.map((item) => ({ ...item }));
}

export function clearMetaWhatsAppWebhookReceiptsForTest() {
  receipts.splice(0, receipts.length);
}
