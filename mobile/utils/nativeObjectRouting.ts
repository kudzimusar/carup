export type NativeCanonicalObjectType =
  | 'conversation'
  | 'vehicle'
  | 'marketplace_listing';

export interface NativeCanonicalObjectRoute {
  type: NativeCanonicalObjectType;
  id: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCanonicalId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  if (!id || id.length > 200) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(id)) return null;
  return id;
}

export function canonicalObjectRoute(
  type: NativeCanonicalObjectType,
  value: unknown,
): NativeCanonicalObjectRoute | null {
  const id = safeCanonicalId(value);
  return id ? { type, id } : null;
}

export function nativeCanonicalObjectHref(route: NativeCanonicalObjectRoute): string {
  const id = encodeURIComponent(route.id);
  if (route.type === 'conversation') return `/inbox/${id}`;
  return `/vehicle/${id}`;
}

export function canonicalObjectRouteFromThread(thread: unknown): NativeCanonicalObjectRoute | null {
  const value = record(thread);
  if (!value) return null;
  return (
    canonicalObjectRoute('marketplace_listing', value.marketplace_listing_id)
    || null
  );
}

function explicitObjectRoute(value: Record<string, unknown>): NativeCanonicalObjectRoute | null {
  const rawType = typeof value.object_type === 'string'
    ? value.object_type.trim().toLowerCase()
    : '';
  const objectId = value.object_id ?? value.id;
  if (rawType === 'conversation') return canonicalObjectRoute('conversation', objectId);
  if (rawType === 'vehicle') return canonicalObjectRoute('vehicle', objectId);
  if (rawType === 'marketplace_listing') return canonicalObjectRoute('marketplace_listing', objectId);
  return null;
}

/**
 * Convert only canonical identifiers into Native navigation.
 *
 * Display copy (title/message/summary) is intentionally ignored: routing must
 * never be inferred by parsing human-readable text.
 */
export function canonicalObjectRouteFromCommunicationNotification(
  notification: unknown,
): NativeCanonicalObjectRoute | null {
  const root = record(notification);
  if (!root) return null;
  const payload = record(root.payload) || root;
  const safePayload = record(payload.safe_payload);

  const threadId =
    root.thread_id
    ?? payload.thread_id
    ?? safePayload?.thread_id;
  const conversation = canonicalObjectRoute('conversation', threadId);
  if (conversation) return conversation;

  const explicit =
    explicitObjectRoute(root)
    || explicitObjectRoute(payload)
    || (safePayload ? explicitObjectRoute(safePayload) : null);
  if (explicit) return explicit;

  const listingId =
    root.marketplace_listing_id
    ?? payload.marketplace_listing_id
    ?? payload.listing_id
    ?? payload.listingId
    ?? payload.vin
    ?? safePayload?.marketplace_listing_id
    ?? safePayload?.listing_id
    ?? safePayload?.listingId
    ?? safePayload?.vin;

  return canonicalObjectRoute('marketplace_listing', listingId);
}
