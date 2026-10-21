import { describe, expect, it } from 'vitest'
import {
  INBOX_TWO_PANE_QUERY,
  resolveInboxSelection,
  unreadConversationCount,
  unreadConversationsLabel,
} from './inboxSelection'

/**
 * CARUP-MVP-STAB-01 F-017 — which conversation the owner inbox shows, and when it may open one by
 * itself. Opening a conversation marks it read, so "opened by itself" is a mutation, not cosmetics:
 * the page used to open the most recent thread on every viewport, so merely visiting Communications on
 * a phone marked that thread read.
 */
const ids = ['t1', 't2', 't3']

describe('inbox selection', () => {
  it('two panes come in at Tailwind md (768px)', () => {
    expect(INBOX_TWO_PANE_QUERY).toBe('(min-width: 768px)')
  })

  it('phone list view with no ?thread=: nothing is opened', () => {
    expect(resolveInboxSelection({ requestedId: null, threadIds: ids, threadsState: 'ready', twoPane: false }))
      .toEqual({ activeId: null, autoSelectId: null, unresolved: false })
  })

  it('two panes with no ?thread=: the most recent conversation is opened and offered for pinning', () => {
    expect(resolveInboxSelection({ requestedId: null, threadIds: ids, threadsState: 'ready', twoPane: true }))
      .toEqual({ activeId: 't1', autoSelectId: 't1', unresolved: false })
  })

  it('?thread= opens exactly that conversation on any viewport, and is never re-pinned', () => {
    for (const twoPane of [true, false]) {
      expect(resolveInboxSelection({ requestedId: 't2', threadIds: ids, threadsState: 'ready', twoPane }))
        .toEqual({ activeId: 't2', autoSelectId: null, unresolved: false })
    }
  })

  it('a ?thread= that is not in this inbox opens nothing — not even the first thread', () => {
    for (const twoPane of [true, false]) {
      expect(resolveInboxSelection({ requestedId: 'someone-elses', threadIds: ids, threadsState: 'ready', twoPane }))
        .toEqual({ activeId: null, autoSelectId: null, unresolved: true })
    }
  })

  it('nothing opens before the list has been read, or when it could not be read', () => {
    for (const threadsState of ['loading', 'failed'] as const) {
      for (const requestedId of [null, 't2']) {
        expect(resolveInboxSelection({ requestedId, threadIds: ids, threadsState, twoPane: true }))
          .toEqual({ activeId: null, autoSelectId: null, unresolved: false })
      }
    }
  })

  it('an empty inbox opens nothing', () => {
    expect(resolveInboxSelection({ requestedId: null, threadIds: [], threadsState: 'ready', twoPane: true }))
      .toEqual({ activeId: null, autoSelectId: null, unresolved: false })
  })
})

describe('the unread badge counts conversations, not messages', () => {
  it('counts threads with unread messages', () => {
    expect(unreadConversationCount([{ unread_count: 3 }, { unread_count: 0 }, { unread_count: 1 }, {}])).toBe(2)
  })

  it('says conversations, in the singular when there is one', () => {
    expect(unreadConversationsLabel(0)).toBe('0 unread conversations')
    expect(unreadConversationsLabel(1)).toBe('1 unread conversation')
    expect(unreadConversationsLabel(4)).toBe('4 unread conversations')
  })
})
