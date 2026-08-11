import { randomUUID } from 'crypto';
import { nowIso, normalizeChannel } from './communicationUtils.js';

const DEFAULT_BUCKET = 'carup-communication-media';
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PARTS_PER_MESSAGE = 12;
const STORED_TYPES = new Set(['image', 'audio', 'video', 'document']);
const SUPPORTED_PART_TYPES = new Set([
  'text', 'image', 'audio', 'video', 'document', 'location', 'contact',
  'structured_card', 'button', 'quick_reply', 'quote', 'system_event',
]);

function safeFileName(value = 'artifact') {
  const raw = String(value || 'artifact').trim().replace(/[\\/]+/g, '-');
  const cleaned = raw.replace(/[^a-zA-Z0-9._ -]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
  return (cleaned || 'artifact').slice(-160);
}

function partTypeForMime(mime = '') {
  const type = String(mime || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'document';
}

function actorUserId(actor = {}) {
  return actor.id || actor.userId || actor.actor_user_id || null;
}

function directionForParticipant(participant = {}) {
  const role = participant.stakeholder_role || participant.role || 'participant';
  return ['buyer', 'requester', 'customer'].includes(role) ? 'inbound' : 'outbound';
}

function storagePath(threadId, participantId, artifactId, fileName) {
  return `${threadId}/${participantId}/${artifactId}-${safeFileName(fileName)}`;
}

function splitStoragePath(path) {
  const pieces = String(path || '').split('/').filter(Boolean);
  const name = pieces.pop() || '';
  return { prefix: pieces.join('/'), name };
}

function normalizeStructuredPart(input = {}) {
  const partType = String(input.part_type || input.type || '').trim().toLowerCase();
  if (!SUPPORTED_PART_TYPES.has(partType)) {
    const error = new Error(`Unsupported communication message part: ${partType || 'unknown'}.`);
    error.statusCode = 400;
    throw error;
  }
  if (partType === 'location') {
    const latitude = Number(input.metadata?.latitude ?? input.latitude);
    const longitude = Number(input.metadata?.longitude ?? input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Location message parts require valid latitude and longitude.');
      error.statusCode = 400;
      throw error;
    }
    return {
      part_type: partType,
      text_content: input.text_content || null,
      metadata: { ...(input.metadata || {}), latitude, longitude },
    };
  }
  return {
    part_type: partType,
    text_content: input.text_content || input.text || null,
    storage_key: input.storage_key || null,
    source_url: null,
    mime_type: input.mime_type || null,
    size_bytes: input.size_bytes == null ? null : Number(input.size_bytes),
    sha256: input.sha256 || null,
    original: input.original !== false,
    derived_from_part_id: input.derived_from_part_id || null,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {},
  };
}

export class CommunicationMediaService {
  constructor({ repository, conversationService, threadService, storageClient = null, bucket = DEFAULT_BUCKET, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.repository = repository;
    this.conversationService = conversationService;
    this.threadService = threadService;
    this.storageClient = storageClient || repository?.client || null;
    this.bucket = bucket || DEFAULT_BUCKET;
    this.maxBytes = Number(maxBytes || DEFAULT_MAX_BYTES);
  }

  health() {
    return {
      available: Boolean(this.storageClient?.storage?.from),
      bucket: this.bucket,
      private: true,
      max_bytes: this.maxBytes,
    };
  }

  assertStoredArtifact({ fileName, mimeType, sizeBytes }) {
    const size = Number(sizeBytes);
    if (!fileName || !String(fileName).trim()) {
      const error = new Error('file_name is required for communication media.');
      error.statusCode = 400;
      throw error;
    }
    if (!mimeType || !String(mimeType).trim()) {
      const error = new Error('mime_type is required for communication media.');
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(size) || size <= 0 || size > this.maxBytes) {
      const error = new Error(`Communication media must be between 1 byte and ${this.maxBytes} bytes.`);
      error.statusCode = 400;
      throw error;
    }
  }

  async prepareUpload(threadId, actor = {}, input = {}) {
    if (!this.storageClient?.storage?.from) {
      const error = new Error('Communication media storage is not configured.');
      error.statusCode = 503;
      error.code = 'communication_media_storage_unavailable';
      throw error;
    }
    const { participant } = await this.conversationService.assertParticipantAccess(threadId, actor, 'send');
    const fileName = safeFileName(input.file_name || input.fileName);
    const mimeType = String(input.mime_type || input.mimeType || '').trim().toLowerCase();
    const sizeBytes = Number(input.size_bytes ?? input.sizeBytes);
    this.assertStoredArtifact({ fileName, mimeType, sizeBytes });
    const artifactId = randomUUID();
    const path = storagePath(threadId, participant.id, artifactId, fileName);
    const { data, error } = await this.storageClient.storage.from(this.bucket).createSignedUploadUrl(path);
    if (error || !data?.token) {
      const failure = new Error(`Could not prepare private communication upload: ${error?.message || 'signed upload unavailable'}`);
      failure.statusCode = 503;
      failure.code = 'communication_media_upload_unavailable';
      throw failure;
    }
    return {
      artifact_id: artifactId,
      bucket: this.bucket,
      path,
      token: data.token,
      signed_url: data.signedUrl || data.signedURL || null,
      part_type: partTypeForMime(mimeType),
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      private: true,
    };
  }

  async assertUploadedObject(path, expectedSize = null, expectedMime = null) {
    if (!this.storageClient?.storage?.from) return null;
    const { prefix, name } = splitStoragePath(path);
    const { data, error } = await this.storageClient.storage.from(this.bucket).list(prefix, { search: name, limit: 10 });
    if (error) {
      const failure = new Error(`Could not verify communication media upload: ${error.message}`);
      failure.statusCode = 503;
      throw failure;
    }
    const object = (data || []).find((row) => row.name === name) || null;
    if (!object) {
      const failure = new Error('Uploaded communication media was not found in private storage.');
      failure.statusCode = 409;
      failure.code = 'communication_media_upload_missing';
      throw failure;
    }
    const storedSize = Number(object.metadata?.size ?? object.metadata?.contentLength ?? 0);
    if (Number.isFinite(Number(expectedSize)) && Number(expectedSize) > 0 && storedSize > 0 && storedSize !== Number(expectedSize)) {
      const failure = new Error('Uploaded communication media size does not match the prepared artifact.');
      failure.statusCode = 409;
      failure.code = 'communication_media_size_mismatch';
      throw failure;
    }
    const storedMime = String(object.metadata?.mimetype || object.metadata?.contentType || '').toLowerCase();
    if (expectedMime && storedMime && storedMime !== String(expectedMime).toLowerCase()) {
      const failure = new Error('Uploaded communication media MIME type does not match the prepared artifact.');
      failure.statusCode = 409;
      failure.code = 'communication_media_mime_mismatch';
      throw failure;
    }
    return object;
  }

  async sendMessage(threadId, actor = {}, input = {}) {
    const { thread, participant } = await this.conversationService.assertParticipantAccess(threadId, actor, 'send');
    const rawParts = Array.isArray(input.parts) ? input.parts : [];
    const text = String(input.message ?? input.text ?? '').trim();
    if (!text && rawParts.length === 0) {
      const error = new Error('A communication message requires text or at least one message part.');
      error.statusCode = 400;
      throw error;
    }
    if (rawParts.length > MAX_PARTS_PER_MESSAGE) {
      const error = new Error(`A communication message may contain at most ${MAX_PARTS_PER_MESSAGE} parts.`);
      error.statusCode = 400;
      throw error;
    }

    const clientMessageId = input.client_message_id || null;
    if (clientMessageId) {
      const existing = await this.repository.findOne('messages', { thread_id: thread.id, client_message_id: clientMessageId }).catch(() => null);
      if (existing) {
        const parts = await this.repository.list('message_parts', { message_id: existing.id }).catch(() => []);
        return { thread, message: existing, parts, deliveries: [], idempotent_replay: true };
      }
    }

    const normalizedParts = rawParts.map(normalizeStructuredPart);
    for (const part of normalizedParts) {
      if (STORED_TYPES.has(part.part_type) && !part.storage_key) {
        const error = new Error(`${part.part_type} message parts must reference a committed private storage object.`);
        error.statusCode = 400;
        throw error;
      }
    }

    const role = participant.stakeholder_role || participant.role || 'participant';
    const direction = directionForParticipant(participant);
    const message = await this.threadService.recordMessage(thread, {
      direction,
      message_type: input.message_type || (normalizedParts.length ? 'multimodal' : 'text'),
      sender_participant_id: participant.id,
      sender_user_id: actorUserId(actor),
      channel: normalizeChannel(input.channel) || 'in_app',
      provider: null,
      client_message_id: clientMessageId,
      in_reply_to_message_id: input.reply_to_message_id || null,
      content_text: text || null,
      content_json: {
        original_authoritative: true,
        ai_derived: false,
        author_role: role,
        business_workflow: thread.business_workflow || thread.thread_type,
        has_media: normalizedParts.some((part) => STORED_TYPES.has(part.part_type)),
        part_count: normalizedParts.length,
        ...(input.content && typeof input.content === 'object' && !Array.isArray(input.content) ? input.content : {}),
      },
      status: 'queued',
      human_approved: true,
      thread_status: 'open',
    });

    const parts = [];
    for (let index = 0; index < normalizedParts.length; index += 1) {
      const part = normalizedParts[index];
      parts.push(await this.repository.insert('message_parts', {
        message_id: message.id,
        part_index: index,
        ...part,
        created_at: nowIso(),
      }));
    }

    await this.repository.updateById('message_threads', thread.id, {
      last_outbound_at: direction === 'outbound' ? message.created_at : thread.last_outbound_at || null,
      last_inbound_at: direction === 'inbound' ? message.created_at : thread.last_inbound_at || null,
      funnel_stage: thread.funnel_stage || 'conversation',
    });
    const deliveries = await this.conversationService.routeMessage(thread, participant, message);
    await this.conversationService.recordAnalytics({
      threadId: thread.id,
      messageId: message.id,
      participantId: participant.id,
      eventType: direction === 'outbound' ? 'stakeholder_first_response' : 'message_received',
      workflow: thread.business_workflow || thread.thread_type,
      funnelStage: thread.funnel_stage || 'conversation',
      metadata: { author_role: role, delivery_count: deliveries.length, part_types: parts.map((part) => part.part_type) },
    });
    return { thread, message, parts, deliveries };
  }

  async commitUpload(threadId, actor = {}, input = {}) {
    const { participant } = await this.conversationService.assertParticipantAccess(threadId, actor, 'send');
    const artifactId = String(input.artifact_id || input.artifactId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(artifactId)) {
      const error = new Error('A valid artifact_id is required to commit communication media.');
      error.statusCode = 400;
      throw error;
    }
    const fileName = safeFileName(input.file_name || input.fileName);
    const mimeType = String(input.mime_type || input.mimeType || '').trim().toLowerCase();
    const sizeBytes = Number(input.size_bytes ?? input.sizeBytes);
    this.assertStoredArtifact({ fileName, mimeType, sizeBytes });
    const path = storagePath(threadId, participant.id, artifactId, fileName);
    await this.assertUploadedObject(path, sizeBytes, mimeType);
    return this.sendMessage(threadId, actor, {
      message: input.caption || '',
      channel: 'in_app',
      message_type: 'multimodal',
      client_message_id: `media:${artifactId}`,
      content: { capture: input.capture || null },
      parts: [{
        part_type: partTypeForMime(mimeType),
        storage_key: path,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        sha256: input.sha256 || null,
        original: true,
        metadata: { original_name: fileName, capture: input.capture || null, private: true },
      }],
    });
  }

  async resolvePart(partId, actor = {}, permission = 'read') {
    const part = await this.repository.findOne('message_parts', { id: partId });
    if (!part) {
      const error = new Error('Communication media not found.');
      error.statusCode = 404;
      throw error;
    }
    const message = await this.repository.findOne('messages', { id: part.message_id });
    if (!message) {
      const error = new Error('Communication media not found.');
      error.statusCode = 404;
      throw error;
    }
    const access = await this.conversationService.assertParticipantAccess(message.thread_id, actor, permission);
    return { part, message, ...access };
  }

  async createSignedPartUrl(partId, actor = {}, { expiresIn = 300 } = {}) {
    if (!this.storageClient?.storage?.from) {
      const error = new Error('Communication media storage is not configured.');
      error.statusCode = 503;
      throw error;
    }
    const { part } = await this.resolvePart(partId, actor, 'read');
    if (!part.storage_key) {
      const error = new Error('This communication message part has no stored artifact.');
      error.statusCode = 400;
      throw error;
    }
    const ttl = Math.max(30, Math.min(Number(expiresIn || 300), 3600));
    const { data, error } = await this.storageClient.storage.from(this.bucket).createSignedUrl(part.storage_key, ttl);
    if (error || !data?.signedUrl) {
      const failure = new Error(`Could not create private communication media access: ${error?.message || 'signed URL unavailable'}`);
      failure.statusCode = 503;
      throw failure;
    }
    return { part_id: part.id, url: data.signedUrl, expires_in: ttl, private: true };
  }

  async downloadPartBytes(partId, actor = {}) {
    if (!this.storageClient?.storage?.from) {
      const error = new Error('Communication media storage is not configured.');
      error.statusCode = 503;
      throw error;
    }
    const resolved = await this.resolvePart(partId, actor, 'read');
    if (!resolved.part.storage_key) {
      const error = new Error('This communication message part has no stored artifact.');
      error.statusCode = 400;
      throw error;
    }
    const { data, error } = await this.storageClient.storage.from(this.bucket).download(resolved.part.storage_key);
    if (error || !data) {
      const failure = new Error(`Could not read private communication media: ${error?.message || 'download unavailable'}`);
      failure.statusCode = 503;
      throw failure;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > this.maxBytes) {
      const failure = new Error('Communication media exceeds the configured AI/read limit.');
      failure.statusCode = 413;
      throw failure;
    }
    return { ...resolved, buffer };
  }
}
