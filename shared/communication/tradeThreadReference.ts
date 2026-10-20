/**
 * T7.6 — how a conversation names the trade it is about. Shared by the web and native clients
 * (OC-NATIVE-FINAL-02-R1 P2-A), so both name the same thread the same way.
 *
 * Every Trade OS thread is a `marketplace` / `marketplace_inquiry` flow, so without this a customer with
 * a sourcing request, a shipping request and a container booking in flight saw three identical rows.
 * The reference is derived from `subject_id`, which the thread API already sends — the same
 * deterministic short form the domain services write into their metadata. For these flows
 * `subject_id` is `<objectId>:<counterpartyId>`, so the object is the part before the colon.
 */
export interface TradeLabelledThread {
  subject_type?: string | null;
  subject_id?: string | null;
}

const TRADE_SUBJECTS: Record<string, { noun: string; prefix: string }> = {
  diaspora_rfq: { noun: 'Sourcing request', prefix: 'RFQ' },
  diaspora_logistics_request: { noun: 'Shipping request', prefix: 'SHIP' },
  diaspora_container_booking: { noun: 'Container sailing', prefix: 'SAIL' },
};

export function tradeReference(thread: TradeLabelledThread): string | null {
  const spec = TRADE_SUBJECTS[String(thread.subject_type || '')];
  if (!spec) return null;
  const objectId = String(thread.subject_id || '').split(':')[0].replace(/-/g, '');
  if (!objectId) return spec.noun;
  return `${spec.noun} ${spec.prefix}-${objectId.slice(0, 8).toUpperCase()}`;
}
