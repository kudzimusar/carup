import { ValidationError, ForbiddenError } from '../../utils/errors.js';
import { SUPPORTED_CHANNELS } from './referralChannelGatewayService.js';

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function extractInteractiveText(message = {}) {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.button?.payload) return message.button.payload;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.button_reply?.id) return message.interactive.button_reply.id;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.interactive?.list_reply?.id) return message.interactive.list_reply.id;
  if (message.image?.caption) return message.image.caption;
  if (message.video?.caption) return message.video.caption;
  if (message.document?.caption) return message.document.caption;
  return '';
}

function normalizeGenericMessage(channel, body = {}) {
  return {
    channel,
    text: body.text || body.message || body.caption || body.query || '',
    sender_id: body.sender_id || body.user_id || body.from || body.chat_id || null,
    conversation_id: body.conversation_id || body.thread_id || body.session_id || body.chat_id || null,
    thread_id: body.thread_id || body.conversation_id || body.session_id || body.chat_id || null,
    session_id: body.session_id || body.conversation_id || body.thread_id || body.chat_id || null,
    message_id: body.message_id || body.mid || body.id || null,
    referral_code: body.referral_code || body.code || null,
    start_payload: body.start_payload || null,
    consent: cleanObject(body.consent),
    source: body.source || channel,
    payload: cleanObject(body.payload || body),
  };
}

export function verifyMetaWebhookChallenge(query = {}, env = process.env) {
  const mode = query['hub.mode'] || query.hub_mode;
  const token = query['hub.verify_token'] || query.hub_verify_token;
  const challenge = query['hub.challenge'] || query.hub_challenge;
  const expected = env.CARUP_META_WEBHOOK_VERIFY_TOKEN || env.CARUP_CHANNEL_WEBHOOK_SECRET;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return String(challenge);
  }
  throw new ForbiddenError('Meta webhook verification failed.');
}

export function isValidTelegramWebhookSecret(headers = {}, env = process.env) {
  const expected = env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN || env.CARUP_CHANNEL_WEBHOOK_SECRET;
  const supplied = headers['x-telegram-bot-api-secret-token'];
  return Boolean(expected && supplied && supplied === expected);
}

export function parseTelegramUpdate(update = {}) {
  const message = update.message || update.edited_message || update.channel_post || update.business_message || update.callback_query?.message || {};
  const callbackData = update.callback_query?.data || null;
  const text = firstDefined(callbackData, message.text, message.caption, '');
  const startPayload = typeof text === 'string' && text.startsWith('/start ') ? text.slice(7).trim() : null;
  return [normalizeGenericMessage(SUPPORTED_CHANNELS.TELEGRAM, {
    text,
    start_payload: startPayload,
    sender_id: firstDefined(update.callback_query?.from?.id, message.from?.id, message.sender_chat?.id),
    conversation_id: firstDefined(message.chat?.id, update.callback_query?.message?.chat?.id),
    thread_id: firstDefined(message.message_thread_id, message.chat?.id),
    chat_id: firstDefined(message.chat?.id, update.callback_query?.message?.chat?.id),
    message_id: firstDefined(message.message_id, update.callback_query?.id, update.update_id),
    source: 'telegram_webhook',
    payload: update,
  })];
}

export function parseWhatsAppWebhook(body = {}) {
  const messages = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        messages.push(normalizeGenericMessage(SUPPORTED_CHANNELS.WHATSAPP, {
          text: extractInteractiveText(message),
          sender_id: message.from,
          conversation_id: firstDefined(message.context?.id, message.from, value.metadata?.phone_number_id),
          thread_id: firstDefined(message.context?.id, message.from),
          message_id: message.id,
          source: 'whatsapp_webhook',
          payload: { entry_id: entry.id, field: change.field, metadata: value.metadata, contact: value.contacts?.[0], message },
        }));
      }
    }
  }
  if (messages.length === 0 && (body.text || body.message || body.sender_id)) {
    messages.push(normalizeGenericMessage(SUPPORTED_CHANNELS.WHATSAPP, body));
  }
  return messages;
}

export function parseMetaMessagingWebhook(body = {}, channel = SUPPORTED_CHANNELS.FACEBOOK) {
  const messages = [];
  for (const entry of body.entry || []) {
    for (const item of entry.messaging || []) {
      const text = firstDefined(item.message?.text, item.postback?.payload, item.message?.quick_reply?.payload, '');
      messages.push(normalizeGenericMessage(channel, {
        text,
        sender_id: item.sender?.id,
        conversation_id: firstDefined(item.thread_id, item.sender?.id),
        thread_id: firstDefined(item.thread_id, item.sender?.id),
        message_id: firstDefined(item.message?.mid, item.postback?.mid, item.timestamp),
        source: `${channel}_webhook`,
        payload: { entry_id: entry.id, time: entry.time, messaging: item },
      }));
    }
  }
  if (messages.length === 0 && (body.text || body.message || body.sender_id)) {
    messages.push(normalizeGenericMessage(channel, body));
  }
  return messages;
}

export function parseChannelPayload(channel, body = {}) {
  if (Array.isArray(body?.messages)) return body.messages.map((message) => normalizeGenericMessage(channel, message));
  if (channel === SUPPORTED_CHANNELS.WHATSAPP) return parseWhatsAppWebhook(body);
  if (channel === SUPPORTED_CHANNELS.TELEGRAM) return parseTelegramUpdate(body);
  if (channel === SUPPORTED_CHANNELS.FACEBOOK || channel === SUPPORTED_CHANNELS.INSTAGRAM) return parseMetaMessagingWebhook(body, channel);
  return [normalizeGenericMessage(channel, body)];
}

export function buildChannelWebhookReply(channel, processed = {}) {
  const text = processed.reply || 'CarUp received your message.';
  const conversationId = processed.metadata?.conversation_id || null;
  if (channel === SUPPORTED_CHANNELS.TELEGRAM) {
    return { method: 'sendMessage', chat_id: conversationId, text };
  }
  if (channel === SUPPORTED_CHANNELS.WHATSAPP) {
    return { messaging_product: 'whatsapp', to: processed.metadata?.sender_id || conversationId, type: 'text', text: { body: text } };
  }
  if (channel === SUPPORTED_CHANNELS.FACEBOOK || channel === SUPPORTED_CHANNELS.INSTAGRAM) {
    return { recipient: { id: processed.metadata?.sender_id || conversationId }, message: { text } };
  }
  return { text, conversation_id: conversationId };
}

export async function processParsedChannelMessages(channel, body, channelGateway, actor) {
  const parsedMessages = parseChannelPayload(channel, body);
  if (parsedMessages.length === 0) throw new ValidationError('No processable channel messages found.');
  const results = [];
  for (const message of parsedMessages) {
    const processed = await channelGateway.processInbound(channel, message, actor);
    results.push({ ...processed, outbound_payload: buildChannelWebhookReply(channel, processed) });
  }
  return { success: true, channel, count: results.length, results };
}
