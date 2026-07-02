/**
 * Offline upload-queue drain worker — Workstream G.
 *
 * Drains ready items from the durable upload queue to the backend evidence endpoint,
 * sending the queue item's idempotency key in the `Idempotency-Key` header so a retried
 * upload (after restart/reconnect) is deduped server-side (withUploadIdempotency). Each
 * item is marked uploaded or failed (failure schedules an exponential-backoff retry).
 *
 * The actual file bytes are referenced by `localFileRef`; the resolver is injected so this
 * module stays testable without React Native (in tests we pass an in-memory resolver).
 */
import { useUploadQueueStore, type UploadQueueItem } from '../store/uploadQueueStore';

export interface DrainDeps {
  /** Resolve a queued item's stored payload (e.g. a base64 data URI) for upload. */
  resolvePayload: (item: UploadQueueItem) => Promise<string | null>;
  /** POST one item; returns the created/looked-up backend evidence id, or throws. */
  uploadOne: (item: UploadQueueItem, payload: string) => Promise<string>;
  now?: () => number;
}

/** Build an uploader bound to a base URL + auth token, sending the idempotency header. */
export function makeHttpUploader(baseUrl: string, token: string | null) {
  return async (item: UploadQueueItem, payload: string): Promise<string> => {
    const res = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(item.vin)}/evidence/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Server-side dedupe key — the SAME capture never creates a duplicate evidence row.
        'Idempotency-Key': item.idempotencyKey,
        ...(token ? { 'x-session-token': token } : {}),
      },
      body: JSON.stringify({
        evidence_type: item.evidenceType,
        evidenceType: item.evidenceType,
        base64Data: payload,
        idempotency_key: item.idempotencyKey,
        page_order: item.pageOrder ?? 0,
      }),
    });
    if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return data?.id || data?.evidence?.id || item.idempotencyKey;
  };
}

/**
 * Drain all currently-ready items. Returns a summary. Safe to call repeatedly (idempotent
 * server-side); items not yet due (backoff) are skipped.
 */
export async function drainUploadQueue(deps: DrainDeps): Promise<{ uploaded: number; failed: number; skipped: number }> {
  const store = useUploadQueueStore.getState();
  const ready = store.dequeueReady(deps.now ? deps.now() : undefined);
  let uploaded = 0, failed = 0, skipped = 0;
  for (const item of ready) {
    store.markUploading(item.localId);
    try {
      const payload = await deps.resolvePayload(item);
      if (!payload) { store.markFailed(item.localId, 'payload_unavailable'); failed++; continue; }
      const evidenceId = await deps.uploadOne(item, payload);
      store.markUploaded(item.localId, evidenceId);
      uploaded++;
    } catch (err: any) {
      store.markFailed(item.localId, err?.message || 'upload_error');
      failed++;
    }
  }
  return { uploaded, failed, skipped };
}

export default { drainUploadQueue, makeHttpUploader };
