/**
 * T7.6 — how a conversation names the trade it is about.
 *
 * Lives in its own module because a module that exports a component may export nothing else: Fast
 * Refresh cannot tell the two apart, and the lint regression gate catches the mistake before the
 * dev loop silently stops reloading.
 */

export interface LabelledThread {
  subject_type?: string
  subject_id?: string
  business_workflow?: string
  conversation_type?: string
  thread_type?: string
}

/**
 * Every Trade OS thread is a `marketplace` / `marketplace_inquiry` flow, so a customer with a
 * sourcing request, a shipping request and a container booking in flight saw three identical rows
 * reading "Marketplace conversation" and could not tell which was which.
 *
 * The reference is derived from `subject_id`, which the thread API already sends — the same
 * deterministic short form the domain services write into their metadata (metadata itself is not
 * exposed to the client). For these flows `subject_id` is `<objectId>:<counterpartyId>`, so the
 * object is the part before the colon.
 */
const TRADE_SUBJECTS: Record<string, { noun: string; prefix: string }> = {
  diaspora_rfq: { noun: 'Sourcing request', prefix: 'RFQ' },
  diaspora_logistics_request: { noun: 'Shipping request', prefix: 'SHIP' },
  diaspora_container_booking: { noun: 'Container sailing', prefix: 'SAIL' },
}

export function tradeReference(thread: LabelledThread): string | null {
  const spec = TRADE_SUBJECTS[String(thread.subject_type || '')]
  if (!spec) return null
  const objectId = String(thread.subject_id || '').split(':')[0].replace(/-/g, '')
  if (!objectId) return spec.noun
  return `${spec.noun} ${spec.prefix}-${objectId.slice(0, 8).toUpperCase()}`
}

export function threadLabel(thread: LabelledThread): string {
  const trade = tradeReference(thread)
  if (trade) return trade
  if (thread.business_workflow === 'marketplace' || thread.thread_type === 'marketplace_inquiry') return 'Marketplace conversation'
  return (thread.business_workflow || thread.conversation_type || thread.thread_type || 'Conversation').replaceAll('_', ' ')
}
