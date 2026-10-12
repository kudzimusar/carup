/**
 * CC-REPLY-CHANNEL-01 — the Command Center replies on a channel the thread can actually reach.
 *
 * The page used to send `selected.primary_channel || 'in_app'`. The OC-LAUNCH frozen thread began
 * in-app (primary_channel = in_app) and the customer then wrote on WhatsApp, so an agent's reply was
 * queued in-app and never reached the customer. This suite renders the REAL page at the deep link
 * and asserts on the payload handed to the existing admin reply endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

type Detail = {
  thread: Record<string, unknown>
  messages: Record<string, unknown>[]
  identities: Record<string, unknown>[]
}

const THREAD_ID = '61acc236-aaab-4d27-815c-9062f9c99f05'
let detail: Detail
const adminReply = vi.fn()

const inbound = (channel: string, at: string, text = 'hello') => ({ id: `${channel}-${at}`, direction: 'inbound', channel, status: 'received', content_text: text, created_at: at })

function threadDetail(over: Partial<Detail> = {}): Detail {
  return {
    thread: { id: THREAD_ID, status: 'open', primary_channel: 'in_app', primary_user_id: 'u-buyer', assigned_team: 'support', ...(over.thread || {}) },
    messages: over.messages || [inbound('in_app', '2026-08-12T07:59:35Z'), inbound('whatsapp', '2026-10-12T09:42:48Z', 'CARUP-WA-R15-20261012-E7777E')],
    identities: over.identities || [{ id: 'ci-wa', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', consent_status: 'implied_transactional', verified: true }],
  }
}

const ok = <T,>(value: T) => vi.fn(async () => value)
// ONE stable object: the page memoises callbacks on these functions; a fresh object per render loops.
const api = {
  user: { id: 'admin-1', role: 'admin' },
  fetchAdminCommunicationThreads: ok({ threads: [], counts: null, page: { next_cursor: null } }),
  fetchCommunicationDeadLetters: ok({ notifications: [] }),
  fetchAdminCommunicationMetrics: ok({}),
  fetchAdminCommunicationThread: vi.fn(async () => ({ ...detail, participants: [], escalations: [], linked_identities: [], delivery_attempts: [], preferences: null })),
  markAdminCommunicationThreadRead: ok({ ok: true }),
  fetchAdminCommunicationThreadAudit: ok({ events: [] }),
  fetchCommunicationAudit: ok({ events: [] }),
  fetchCommunicationSlaPolicies: ok({ policies: [] }),
  fetchCommunicationWorkerHealth: ok(null),
  fetchCommunicationProviders: ok({ channels: [] }),
  sendCommunicationProviderSmokeTest: ok({}),
  adminReplyCommunicationThread: adminReply,
  assignCommunicationThread: ok({}),
  escalateCommunicationThread: ok({}),
  resolveCommunicationThread: ok({}),
  reopenCommunicationThread: ok({}),
  pauseCommunicationThreadSla: ok({}),
  resumeCommunicationThreadSla: ok({}),
  retryCommunicationDeadLetter: ok({}),
  cancelCommunicationDeadLetter: ok({}),
  fetchCommunicationRecovery: ok({ categories: {}, counts: {} }),
  bulkRetryCommunicationRecovery: ok({}),
  requeueCommunicationDeadLetter: ok({}),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const AdminCommunications = (await import('./Communications')).default

async function openFrozenThread(over: Partial<Detail> = {}) {
  detail = threadDetail(over)
  render(
    <MemoryRouter initialEntries={[`/admin/communications/inbox/${THREAD_ID}`]}>
      <Routes><Route path="/admin/communications/inbox/:threadId" element={<AdminCommunications />} /></Routes>
    </MemoryRouter>,
  )
  const composer = await screen.findByTestId('reply-composer-sticky')
  await waitFor(() => expect(within(composer).getByTestId('reply-target')).toBeInTheDocument())
  return composer
}

async function send(composer: HTMLElement, text: string) {
  fireEvent.change(within(composer).getByRole('textbox'), { target: { value: text } })
  fireEvent.click(within(composer).getByRole('button', { name: /Send reply|Add internal note/ }))
  await waitFor(() => expect(adminReply).toHaveBeenCalledTimes(1))
  return adminReply.mock.calls[0] as [string, Record<string, unknown>]
}

beforeEach(() => {
  adminReply.mockReset()
  adminReply.mockResolvedValue({ message: { id: 'm-new', status: 'queued' }, notification: { id: 1, status: 'queued' } })
})

describe('Command Center reply channel (CC-REPLY-CHANNEL-01)', () => {
  it('mixed in-app + WhatsApp thread: defaults to WhatsApp and sends channel "whatsapp"', async () => {
    const composer = await openFrozenThread()
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'whatsapp'))
    expect(within(composer).getByText(/Reply via/)).toHaveTextContent('WhatsApp')
    const [threadId, payload] = await send(composer, 'Thanks — we have your message.')
    expect(threadId).toBe(THREAD_ID)
    expect(payload).toMatchObject({ message: 'Thanks — we have your message.', channel: 'whatsapp', internal: false })
    expect(payload.client_message_id).toEqual(expect.any(String))
  })

  it('mixed in-app + Telegram thread: defaults to Telegram', async () => {
    const composer = await openFrozenThread({
      identities: [{ id: 'ci-tg', channel: 'telegram', consent_status: 'implied_transactional' }],
      messages: [inbound('in_app', '2026-10-01T00:00:00Z'), inbound('telegram', '2026-10-02T00:00:00Z')],
    })
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'telegram'))
    const [, payload] = await send(composer, 'On it.')
    expect(payload.channel).toBe('telegram')
  })

  it('an explicit channel pick changes the API payload', async () => {
    const composer = await openFrozenThread()
    const group = await within(composer).findByRole('radiogroup', { name: 'Reply channel' })
    fireEvent.click(within(group).getByRole('radio', { name: /In-app/i }))
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'in_app'))
    const [, payload] = await send(composer, 'Replying in the app instead.')
    expect(payload.channel).toBe('in_app')
  })

  it('channels the thread cannot reach are never offered', async () => {
    const composer = await openFrozenThread({
      identities: [
        { id: 'ci-wa', channel: 'whatsapp', consent_status: 'implied_transactional' },
        { id: 'ci-tg', channel: 'telegram', consent_status: 'opted_out' },
      ],
    })
    const group = await within(composer).findByRole('radiogroup', { name: 'Reply channel' })
    const offered = within(group).getAllByRole('radio').map((r) => r.getAttribute('data-channel-option'))
    expect(offered).toEqual(['whatsapp', 'in_app'])
  })

  it('an in-app-only thread still replies in-app, with no selector', async () => {
    const composer = await openFrozenThread({ identities: [], messages: [inbound('in_app', '2026-10-01T00:00:00Z')] })
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'in_app'))
    expect(within(composer).queryByRole('radiogroup')).toBeNull()
    const [, payload] = await send(composer, 'Hello in the app.')
    expect(payload.channel).toBe('in_app')
  })

  it('an internal note stays internal and keeps the thread channel label', async () => {
    const composer = await openFrozenThread()
    fireEvent.click(within(composer).getByRole('switch', { name: 'Internal note (not sent to the user)' }))
    await waitFor(() => expect(within(composer).queryByRole('radiogroup')).toBeNull())
    const [, payload] = await send(composer, 'Customer confirmed by phone.')
    expect(payload).toMatchObject({ internal: true, channel: 'in_app' })
  })

  it('a refused (422) reply preserves the draft and shows the error', async () => {
    adminReply.mockRejectedValueOnce(Object.assign(new Error('No deliverable communication recipient found for admin reply.'), { requestId: 'req-422' }))
    const composer = await openFrozenThread()
    await send(composer, 'Keep this draft.')
    await within(composer).findByText('No deliverable communication recipient found for admin reply.')
    expect(within(composer).getByRole('textbox')).toHaveValue('Keep this draft.')
    expect(within(composer).getByText(/draft was preserved/)).toBeInTheDocument()
    expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'whatsapp')
  })
})
