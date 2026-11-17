import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DealerTodayView } from './DealerTodayView'
import { buildDealerActionQueue, type DealerQueueInput } from './dealerActionQueue'

const NOW = new Date('2026-11-18T12:00:00Z')
const base: DealerQueueInput = {
  now: NOW,
  profile: { identity_status: 'verified', compliance_review_state: 'passed', active_state: 'active', restriction_state: 'none',
    suspension_state: 'none', investigation_state: 'none', expiry_date: '2026-11-27T12:00:00Z' },
  attachedClaims: [],
  branches: [{ id: 'b1', name: 'Main yard', latitude: null, longitude: null, opening_hours_text: null }],
  carryoverNeedsAttention: 0,
  inventory: { status: 'ready', entries: [] },
  enquiries: { status: 'ready', entries: [{ inquiry_id: 'q1', status: 'new', created_at: '2026-11-16T04:40:09Z', allowed_followup_status: 'contacted' }] },
  media: { status: 'ready', items: [] },
  staff: { status: 'ready', invitations: [] },
}

function view(queueInput: DealerQueueInput, over: Partial<Parameters<typeof DealerTodayView>[0]> = {}) {
  const onEditBranch = vi.fn()
  const onAddBranch = vi.fn()
  render(
    <MemoryRouter>
      <DealerTodayView
        displayName="Fictional Motors" legalName="Fictional Motors (Pvt) Ltd" chips={[{ label: 'Active', tone: 'good' }]}
        cover={null} avatar={null} publicHref="/dealers/zw-deal-0001" queue={buildDealerActionQueue(queueInput)}
        onRefresh={() => {}} busy={false}
        performance={{ status: 'ready', generatedAt: null, metrics: { buyer_enquiries: { value: 1, scope: 'Marketplace enquiries' },
          customer_rating: { value: null, status: 'DEFERRED_NEW_PRODUCT_CAPABILITY_REQUIRED' } } }}
        formatDateTime={() => ''} branches={[{ id: 'b1', name: 'Main yard', address: null, hasGps: false, hours: null, sourceLabel: null, sourceStatus: null }]}
        onEditBranch={onEditBranch} onAddBranch={onAddBranch} branchEditor={null} notice="" error=""
        compliance={[['Legal identity', 'Verified']]} claims={[]} carryover={null}
        {...over}
      />
    </MemoryRouter>,
  )
  return { onEditBranch, onAddBranch }
}

describe('RX05-B Dealer Today view', () => {
  it('leads with the action queue: urgent legal expiry first with the single primary action', () => {
    view(base)
    expect(screen.getByRole('heading', { level: 1, name: 'Fictional Motors' })).toBeInTheDocument()
    const queue = screen.getByRole('list', { name: 'Action queue' })
    const rows = within(queue).getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('data-testid', 'dealer-action-legal-expiry')
    expect(rows[0]).toHaveTextContent('Legal review expires in 9 days')
    expect(within(rows[0]).getByRole('link', { name: /open claim & compliance/i })).toHaveAttribute('href', '/dealers/claims')
    expect(screen.getByTestId('dealer-action-enquiries-new')).toHaveTextContent('1 new enquiry waiting for first contact')
    expect(screen.getByTestId('dealer-action-media-missing')).toHaveTextContent('Add your cover and profile images')
  })

  it('opens the in-place branch editor from a suggestion, never a navigation', async () => {
    const { onEditBranch } = view(base)
    const suggestions = screen.getByRole('list', { name: 'Suggestions' })
    await userEvent.click(within(suggestions).getByRole('button', { name: /edit branch/i }))
    expect(onEditBranch).toHaveBeenCalledWith('b1')
  })

  it('does not claim an all-clear when a read failed', () => {
    view({ ...base, profile: { ...base.profile, expiry_date: '2027-06-01T12:00:00Z' },
      branches: [{ id: 'b1', name: 'Main yard', latitude: 1, longitude: 1, opening_hours_text: 'Mon–Fri' }],
      enquiries: { status: 'unavailable', entries: [] },
      inventory: { status: 'ready', entries: [{ vin: 'V', make: null, model: null, year: null, recorded_marketplace_publication_state: 'published' }] },
      media: { status: 'ready', items: [
        { media_category: 'COMPANY_COVER_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: null },
        { media_category: 'COMPANY_PROFILE_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: null }] } })
    expect(screen.queryByTestId('dealer-action-queue-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('dealer-action-enquiries-unread')).toHaveTextContent('Enquiries could not be checked')
    expect(within(screen.getByTestId('dealer-action-areas')).getByText('Enquiries').closest('li')).toHaveAttribute('data-state', 'unavailable')
  })

  it('shows an honest empty state that names what was checked', () => {
    view({ ...base, profile: { ...base.profile, expiry_date: '2027-06-01T12:00:00Z' },
      branches: [{ id: 'b1', name: 'Main yard', latitude: 1, longitude: 1, opening_hours_text: 'Mon–Fri' }],
      enquiries: { status: 'ready', entries: [] },
      inventory: { status: 'ready', entries: [{ vin: 'V', make: null, model: null, year: null, recorded_marketplace_publication_state: 'published' }] },
      media: { status: 'ready', items: [
        { media_category: 'COMPANY_COVER_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: null },
        { media_category: 'COMPANY_PROFILE_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: null }] } })
    const empty = screen.getByTestId('dealer-action-queue-empty')
    expect(empty).toHaveTextContent('Nothing needs your attention right now')
    expect(empty).toHaveTextContent('Checked: legal & compliance, enquiries, inventory, images, branches, staff.')
  })

  it('labels capabilities that do not exist yet instead of showing a number', () => {
    view(base)
    expect(screen.getByTestId('dealer-today-not-measured')).toHaveTextContent('Not measured yet: Customer rating. Nothing is estimated in their place.')
  })

  it('says a private image preview is awaiting review', () => {
    view(base, { cover: { url: 'blob:x', alt: '', pending: true } })
    expect(screen.getByTestId('dealer-today-image-pending')).toHaveTextContent('Your cover image is awaiting independent review — only you can see it.')
  })
})
