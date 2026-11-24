/**
 * RX06-EXIT02-LR01 (C2.3) — Subject-linked Communications thread context (unified presentation).
 * Projects only server-recorded thread subject identifiers; never fabricates links or dead routes.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resolveThreadSubject } from '@/components/owner/assist/CommunicationsView'

vi.setConfig({ testTimeout: 30_000 })

const api = {
  fetchCommunicationThreads: vi.fn(),
  fetchCommunicationThread: vi.fn(),
  markCommunicationThreadRead: vi.fn(),
  fetchCommunicationNotifications: vi.fn(),
  fetchCommunicationAccountActivity: vi.fn(),
  resendVerificationEmail: vi.fn(),
  fetchCommunicationPreferences: vi.fn(),
  sendCommunicationMessage: vi.fn(),
  updateCommunicationPreferences: vi.fn(),
  markCommunicationNotificationRead: vi.fn(),
  user: { id: 'owner-1', email: 'owner@example.test' },
}
const productApi = {
  fetchAnalytics: vi.fn(),
  fetchAiHealth: vi.fn(),
  suggestReply: vi.fn(),
  summarize: vi.fn(),
  translate: vi.fn(),
  nextBestAction: vi.fn(),
}

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/hooks/useCommunicationProductApi', () => ({ useCommunicationProductApi: () => productApi }))
vi.mock('@/components/communications/CommunicationMultimodalComposer', () => ({ CommunicationMultimodalComposer: () => null }))
vi.mock('@/components/communications/CommunicationMessagePartView', () => ({ CommunicationMessagePartView: () => null }))

async function renderUnified(flagValue: boolean = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = flagValue ? true : undefined
  const Communications = (await import('./Communications')).default
  return render(
    <MemoryRouter>
      <Communications />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  api.fetchCommunicationAccountActivity.mockResolvedValue({ activity: [] })
  api.fetchCommunicationPreferences.mockResolvedValue({ preferences: null })
  api.markCommunicationThreadRead.mockResolvedValue({ success: true })
  productApi.fetchAnalytics.mockResolvedValue({ analytics: null })
  productApi.fetchAiHealth.mockResolvedValue({ ai: { available: false } })
})

afterAll(() => {
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
})

describe('resolveThreadSubject — pure subject projection', () => {
  it('links marketplace_listing_id to /marketplace/:id', () => {
    expect(resolveThreadSubject({ id: 't-1', marketplace_listing_id: 'veh-101' })).toEqual({
      label: 'Listing veh-101',
      href: '/marketplace/veh-101',
      actionLabel: 'Open listing',
    })
  })

  it('links import_order subject_type + subject_id to /diaspora/imports/:id', () => {
    expect(resolveThreadSubject({ id: 't-2', subject_type: 'import_order', subject_id: 'ord-1' })).toEqual({
      label: 'Import order ord-1',
      href: '/diaspora/imports/ord-1',
      actionLabel: 'Open import order',
    })
  })

  it('links work_order subject_type + subject_id to /dashboard/service-history', () => {
    expect(resolveThreadSubject({ id: 't-3', subject_type: 'work_order', subject_id: 'wo-1' })).toEqual({
      label: 'Work order wo-1',
      href: '/dashboard/service-history',
      actionLabel: 'Open service history',
    })
  })

  it('shows plain reference without dead link for unsupported subject_type, financing_application_id, or escrow_id', () => {
    expect(resolveThreadSubject({ id: 't-4', subject_type: 'insurance_claim', subject_id: 'clm-1' })).toEqual({
      label: 'Insurance claim clm-1',
      href: null,
      actionLabel: null,
    })
    expect(resolveThreadSubject({ id: 't-5', financing_application_id: 'fin-9' })).toEqual({
      label: 'Finance application fin-9',
      href: null,
      actionLabel: null,
    })
    expect(resolveThreadSubject({ id: 't-6', escrow_id: 'esc-4' })).toEqual({
      label: 'Escrow esc-4',
      href: null,
      actionLabel: null,
    })
  })

  it('returns null when the server recorded no subject, listing, financing or escrow id', () => {
    expect(resolveThreadSubject({ id: 't-7', business_workflow: 'marketplace' })).toBeNull()
    expect(resolveThreadSubject(null)).toBeNull()
  })
})

describe('Communications — C2.3 subject-linked thread context & S1 touch targets', () => {
  it('renders recorded import-order subject link, filters inbox by subject_id, and enforces 44px mobile mark-read/link targets', async () => {
    const importThread = {
      id: 'thread-imp',
      business_workflow: 'diaspora',
      subject_type: 'import_order',
      subject_id: 'ord-7788',
      participant_role: 'buyer',
      primary_channel: 'in_app',
      unread_count: 1,
      latest_message: { id: 'm-1', text: 'Vessel departed Yokohama.', created_at: '2026-11-20T09:00:00.000Z' },
    }
    const claimThread = {
      id: 'thread-clm',
      business_workflow: 'insurance',
      subject_type: 'insurance_claim',
      subject_id: 'clm-501',
      participant_role: 'policyholder',
      primary_channel: 'in_app',
      unread_count: 0,
      latest_message: { id: 'm-2', text: 'Assessor assigned.', created_at: '2026-11-20T10:00:00.000Z' },
    }
    const plainThread = {
      id: 'thread-plain',
      business_workflow: 'support',
      participant_role: 'owner',
      primary_channel: 'in_app',
      unread_count: 0,
      latest_message: { id: 'm-3', text: 'General question.', created_at: '2026-11-20T11:00:00.000Z' },
    }
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [importThread, claimThread, plainThread] })
    api.fetchCommunicationThread.mockImplementation(async (id: string) => {
      if (id === 'thread-imp') {
        return {
          thread: importThread,
          participants: [{ id: 'p-1', display_name: 'Logistics Desk', is_self: false }],
          messages: [{ id: 'm-1', text: 'Vessel departed Yokohama.', author: { display_name: 'Logistics Desk', is_self: false }, channel: 'in_app' }],
        }
      }
      if (id === 'thread-clm') {
        return {
          thread: claimThread,
          participants: [{ id: 'p-2', display_name: 'Claims Desk', is_self: false }],
          messages: [{ id: 'm-2', text: 'Assessor assigned.', author: { display_name: 'Claims Desk', is_self: false }, channel: 'in_app' }],
        }
      }
      return {
        thread: plainThread,
        participants: [{ id: 'p-3', display_name: 'Support', is_self: false }],
        messages: [{ id: 'm-3', text: 'General question.', author: { display_name: 'Support', is_self: false }, channel: 'in_app' }],
      }
    })

    await renderUnified(true)

    expect(await screen.findByTestId('communication-list-subject-thread-imp')).toHaveTextContent('Import order ord-7788')
    expect(screen.getByTestId('communication-list-subject-thread-clm')).toHaveTextContent('Insurance claim clm-501')
    expect(screen.queryByTestId('communication-list-subject-thread-plain')).toBeNull()

    // Filter by subject_id in unified inbox search
    const searchInput = screen.getByPlaceholderText(/Search conversations/i)
    fireEvent.change(searchInput, { target: { value: 'ord-7788' } })
    expect(screen.getByTestId('communication-thread-thread-imp')).toBeInTheDocument()
    expect(screen.queryByTestId('communication-thread-thread-clm')).toBeNull()
    fireEvent.change(searchInput, { target: { value: '' } })

    // Open import-order thread: shows subject + link + 44px mobile controls, without auto-marking read
    fireEvent.click(screen.getByTestId('communication-thread-thread-imp'))
    const subjectBox = await screen.findByTestId('communication-thread-subject')
    expect(subjectBox).toHaveTextContent('Import order ord-7788')
    const subjectLink = screen.getByTestId('communication-thread-subject-link')
    expect(subjectLink).toHaveAttribute('href', '/diaspora/imports/ord-7788')
    expect(subjectLink.className).toContain('min-h-11')
    const markReadBtn = screen.getByTestId('communication-mark-read')
    expect(markReadBtn.className).toContain('min-h-11')
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalled()

    // Open insurance_claim thread: shows truthful reference text with NO dead link
    fireEvent.click(screen.getByTestId('communication-thread-thread-clm'))
    expect(await screen.findByTestId('communication-thread-subject')).toHaveTextContent('Insurance claim clm-501')
    expect(screen.queryByTestId('communication-thread-subject-link')).toBeNull()

    // Open plain thread: no invented subject banner
    fireEvent.click(screen.getByTestId('communication-thread-thread-plain'))
    expect(await screen.findByText('General question.')).toBeInTheDocument()
    expect(screen.queryByTestId('communication-thread-subject')).toBeNull()
  })

  it('flags OFF: legacy Communications page is unchanged and renders no unified subject banner', async () => {
    const importThread = {
      id: 'thread-imp',
      business_workflow: 'diaspora',
      subject_type: 'import_order',
      subject_id: 'ord-7788',
      participant_role: 'buyer',
      primary_channel: 'in_app',
      unread_count: 1,
      latest_message: { id: 'm-1', text: 'Vessel departed Yokohama.', created_at: '2026-11-20T09:00:00.000Z' },
    }
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [importThread] })
    api.fetchCommunicationThread.mockResolvedValue({
      thread: importThread,
      participants: [],
      messages: [{ id: 'm-1', text: 'Vessel departed Yokohama.', channel: 'in_app' }],
    })
    await renderUnified(false)
    expect(screen.queryByTestId('communications-unified')).toBeNull()
    expect(screen.queryByTestId('communication-thread-subject')).toBeNull()
  })
})
