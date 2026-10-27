/**
 * T11-CAP-LR01-R3 (Step H, audit WI-4) — one inbox, mounted in two shells, says whose shell it is in.
 *
 * Only the LABEL changes. Trade OS conversations are stored as `marketplace` workflows (the thread label tells them apart by
 * subject), so no existing filter isolates them: defaulting any filter inside the Trade shell would hide threads on an
 * assumption. The conversations, the filter and its default are therefore exactly the same in both shells.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const threads = [
    { id: 't-market', business_workflow: 'marketplace', thread_type: 'marketplace_inquiry', unread_count: 2, latest_message: { text: 'Is the Serena still available?' } },
    { id: 't-ship', business_workflow: 'marketplace', thread_type: 'marketplace_inquiry', subject_type: 'diaspora_logistics_request', subject_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:cp', unread_count: 0, latest_message: { text: 'Quote attached.' } },
    { id: 't-support', business_workflow: 'support', thread_type: 'support', unread_count: 0, latest_message: { text: 'Welcome to CarUp.' } },
  ]
  return {
    threads,
    api: {
      fetchCommunicationThreads: vi.fn(async () => ({ threads })),
      fetchCommunicationThread: vi.fn(async () => { throw new Error('not opened in this test') }),
      markCommunicationThreadRead: vi.fn(),
      fetchCommunicationNotifications: vi.fn(async () => ({ notifications: [] })),
      fetchCommunicationAccountActivity: vi.fn(async () => ({ activity: [] })),
      resendVerificationEmail: vi.fn(),
      fetchCommunicationPreferences: vi.fn(async () => ({ preferences: null })),
      sendCommunicationMessage: vi.fn(),
      updateCommunicationPreferences: vi.fn(),
      markCommunicationNotificationRead: vi.fn(),
      user: { id: 'u1', email: 'kingston@example.test' },
    },
    product: {
      fetchAnalytics: vi.fn(async () => ({ analytics: null })),
      fetchAiHealth: vi.fn(async () => ({ ai: { available: false } })),
      suggestReply: vi.fn(), summarize: vi.fn(), translate: vi.fn(), nextBestAction: vi.fn(),
    },
  }
})
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => h.api }))
vi.mock('@/hooks/useCommunicationProductApi', () => ({ useCommunicationProductApi: () => h.product }))

import Communications from './Communications'
import { ActiveWorkspaceContext } from '@/components/workspace'
import type { WorkspaceId } from '@/components/workspace'

const show = async (workspace: WorkspaceId | null = null) => {
  render(
    <ActiveWorkspaceContext.Provider value={workspace}>
      <Communications />
    </ActiveWorkspaceContext.Provider>,
  )
  await waitFor(() => expect(screen.getByTestId('communication-thread-t-market')).toBeInTheDocument())
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('outside the Trade shell (the owner dashboard)', () => {
  it('is the Communications inbox it always was', async () => {
    await show(null)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Communications')
    expect(screen.getByTestId('communications-subtitle')).toHaveTextContent('Your CarUp conversations across Marketplace and connected services')
  })

  it.each<WorkspaceId>(['vehicles', 'marketplace'])('a page hosted by the %s workspace is not relabelled', async (workspace) => {
    await show(workspace)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Communications')
  })
})

describe('inside the Trade & Imports shell', () => {
  it('is called Messages — the tab the user pressed — and says what is in it', async () => {
    await show('trade')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Messages')
    expect(screen.getByTestId('communications-subtitle')).toHaveTextContent('Import and shipping conversations sit alongside Marketplace enquiries')
    // It must not promise a filter that cannot deliver it.
    expect(screen.getByTestId('communications-subtitle').textContent).not.toMatch(/filter/i)
  })

  it('shows every conversation under the same default filter as the owner dashboard — nothing is hidden by the label', async () => {
    await show('trade')
    expect(screen.getByTestId('communication-filter')).toHaveValue('all')
    for (const id of ['t-market', 't-ship', 't-support']) expect(screen.getByTestId(`communication-thread-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId('communication-thread-t-ship')).toHaveTextContent('Shipping request SHIP-AAAAAAAA')
  })

  it('reads the same conversations and the same unread count as the owner dashboard', async () => {
    await show('trade')
    const inTrade = screen.getAllByTestId(/^communication-thread-/).map((el) => el.getAttribute('data-testid'))
    cleanup()
    await show(null)
    const onDashboard = screen.getAllByTestId(/^communication-thread-/).map((el) => el.getAttribute('data-testid'))
    expect(inTrade).toEqual(onDashboard)
    expect(screen.getByText('2 unread')).toBeInTheDocument()
  })
})
