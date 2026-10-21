/**
 * CARUP-MVP-STAB-01 F-017 — which conversation the owner inbox shows.
 *
 * The selected conversation lives in the URL (`?thread=<id>`), so it can be linked to, survives a
 * reload and is what Back clears. Opening a conversation marks it read, so the inbox may open one BY
 * ITSELF only when the list and the conversation are both visible (two panes, from Tailwind `md`).
 * On a phone the list is the whole screen and nothing is opened — or marked read — until the person
 * chooses a conversation. The page used to open the most recent thread on every viewport, so
 * visiting Communications on a phone marked that thread read.
 *
 * A `?thread=` that is not in this inbox opens nothing (not the first thread instead): the person
 * asked for a particular conversation, and silently showing — and marking read — a different one
 * would be wrong twice.
 */

/** Tailwind `md`. The layout classes and this query must change at the same width. */
export const INBOX_TWO_PANE_QUERY = '(min-width: 768px)'

export type ThreadsReadState = 'loading' | 'ready' | 'failed'

export interface InboxSelectionInput {
  /** `?thread=` from the URL, or null. */
  requestedId: string | null
  /** The inbox's threads, in list order (the backend sorts the most recent first). */
  threadIds: readonly string[]
  threadsState: ThreadsReadState
  /** Whether the list and the conversation are both on screen. */
  twoPane: boolean
}

export interface InboxSelection {
  /** The conversation shown — and so marked read — or null for the list alone. */
  activeId: string | null
  /** The first thread, to be pinned into the URL, when two panes are visible and none was asked for. */
  autoSelectId: string | null
  /** `?thread=` named a conversation that is not in this inbox. */
  unresolved: boolean
}

export function resolveInboxSelection({ requestedId, threadIds, threadsState, twoPane }: InboxSelectionInput): InboxSelection {
  // Until the list has been read there is nothing to check a request against.
  if (threadsState !== 'ready') return { activeId: null, autoSelectId: null, unresolved: false }
  if (requestedId) {
    const known = threadIds.includes(requestedId)
    return { activeId: known ? requestedId : null, autoSelectId: null, unresolved: !known }
  }
  const first = twoPane ? threadIds[0] ?? null : null
  return { activeId: first, autoSelectId: first, unresolved: false }
}

/** Conversations with at least one unread message — the badge counts conversations, not messages. */
export function unreadConversationCount(threads: ReadonlyArray<{ unread_count?: number | null }>): number {
  return threads.filter((thread) => Number(thread.unread_count || 0) > 0).length
}

export function unreadConversationsLabel(count: number): string {
  return `${count} unread ${count === 1 ? 'conversation' : 'conversations'}`
}
