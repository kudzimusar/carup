/**
 * T7.6 — how a conversation names the trade it is about.
 *
 * Lives in its own module because a module that exports a component may export nothing else: Fast
 * Refresh cannot tell the two apart, and the lint regression gate catches the mistake before the
 * dev loop silently stops reloading.
 *
 * The trade reference itself is shared with the native Inbox (OC-NATIVE-FINAL-02-R1 P2-A), so a
 * sourcing request, shipping request or container sailing is named the same way on both.
 */
import { tradeReference } from '@shared/communication/tradeThreadReference'

export { tradeReference }

export interface LabelledThread {
  subject_type?: string
  subject_id?: string
  business_workflow?: string
  conversation_type?: string
  thread_type?: string
}

export function threadLabel(thread: LabelledThread): string {
  const trade = tradeReference(thread)
  if (trade) return trade
  if (thread.business_workflow === 'marketplace' || thread.thread_type === 'marketplace_inquiry') return 'Marketplace conversation'
  return (thread.business_workflow || thread.conversation_type || thread.thread_type || 'Conversation').replaceAll('_', ' ')
}
