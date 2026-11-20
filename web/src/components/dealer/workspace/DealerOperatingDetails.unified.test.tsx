/**
 * RX05-C — /dealers/operating-details unified Dealer OS view. Proves the three photo states are
 * explicit and separate (private upload → awaiting independent review → approved & public), that an
 * unreviewed photo is never green or grouped as public, that thumbnails reuse PrivateMediaThumb and are
 * labelled private, that #dealer-profile-images keeps its anchor, and that branches are server data.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
  mediaDown: false,
  workspaceDown: false,
}))
const auth = vi.hoisted(() => ({ user: { id: 'fictional-owner', role: 'member' }, token: 'synthetic-session' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async (request: { path: string; options?: { method?: string; body?: string } }) => {
    const method = request.options?.method || 'GET'
    fx.requests.push({ path: request.path, method, body: request.options?.body ? JSON.parse(request.options.body) : null })
    if (request.path === '/dealer/operational-declarations' && method === 'GET') {
      return { declarations: { sections: [], owner_scope: 'x', publication_approval: false, verified_complaint_count: null, measured_sales_revenue: null,
        latest: { BUYER_ASSURANCE: { version: 1, values: { inspection_rights: 'Fictional inspection terms' }, recorded_at: '2026-11-01', private_declaration_only: true, public_approved: false } } } }
    }
    if (request.path === '/dealer/operational-workspace') {
      if (fx.workspaceDown) throw Object.assign(new Error('HTTP 503'), { status: 503 })
      return { workspace: { operational: true, recorded_tenant_member_count: 2, vehicle_listing_authority: false,
        branches: [{ id: 'b1', dealer_id: 'd', name: 'FICTIONAL HARARE YARD', address: 'Test Lot 1 (not a real address)', created_at: '2026-10-01' }] } }
    }
    if (request.path === '/dealer/operational-media' && method === 'GET') {
      if (fx.mediaDown) throw Object.assign(new Error('HTTP 503'), { status: 503 })
      const item = (id: string, category: string, review_status: string, public_display_approved = false) => ({
        media_id: id, seed_dealer_id: 's', branch_id: null, mime_type: 'image/png', file_bytes: 1, media_category: category,
        caption: 'Caption ' + id, alt_text: 'Alt ' + id, rights_attestation: 'x', logo_rights_approved: false,
        review_status, public_display_approved, created_at: '2026-11-01' })
      return { media: { seed_dealer_id: 's', tenant_id: 't', categories: [], required_rights_attestation: 'x', oem_or_brand_logo_uploads_permitted: false,
        items: [
          item('m-profile-pending', 'COMPANY_PROFILE_IMAGE', 'PENDING_INDEPENDENT_REVIEW'),
          item('m-cover-public', 'COMPANY_COVER_IMAGE', 'APPROVED_PUBLIC_DISPLAY', true),
          item('m-yard-rejected', 'SHOWROOM_EXTERIOR', 'REJECTED'),
        ] } }
    }
    throw Error('Unexpected request ' + method + ' ' + request.path)
  },
}))

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/DealerOperatingDetails')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}
const fetchSpy = vi.fn()
beforeEach(() => {
  fx.requests = []; fx.mediaDown = false; fx.workspaceDown = false
  // PrivateMediaThumb's own owner-session fetch; refused here so no image bytes exist in the test.
  fetchSpy.mockReset().mockResolvedValue({ ok: false, status: 404 })
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.unstubAllGlobals() })

describe('DealerOperatingDetails — unified Dealer OS view', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByRole('heading', { name: 'Operate your verified dealership' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-ws-operating')).toBeNull()
  })

  it('makes the three photo states explicit and never shows an unreviewed photo as public', async () => {
    await mount()
    const section = await screen.findByTestId('dealer-owner-media-section')
    expect(section).toHaveAttribute('id', 'dealer-profile-images')
    const stages = within(section).getByTestId('dealer-ws-media-stages')
    expect(stages).toHaveTextContent('Uploaded privately')
    expect(stages).toHaveTextContent('Awaiting independent review')
    expect(stages).toHaveTextContent('Approved for public display')
    // A reviewer approval is not a visibility claim: the public read also needs an approved storefront.
    expect(stages).toHaveTextContent('only while your full storefront is approved too')
    expect(stages).not.toHaveTextContent('Approved & public')

    const pending = within(section).getByTestId('dealer-owner-media-item-m-profile-pending')
    expect(pending).toHaveAttribute('data-stage', 'review')
    expect(within(pending).getByTestId('dealer-ws-media-status-m-profile-pending')).toHaveAttribute('data-tone', 'warning')
    expect(within(pending).getByText('Awaiting independent review · only you can see it')).toBeInTheDocument()
    expect(within(pending).getByText('Not public')).toBeInTheDocument()
    // The pending photo is NOT in the public group.
    expect(within(within(section).getByTestId('dealer-ws-media-group-public')).queryByTestId('dealer-owner-media-item-m-profile-pending')).toBeNull()

    const approved = within(section).getByTestId('dealer-owner-media-item-m-cover-public')
    expect(approved).toHaveAttribute('data-stage', 'public')
    expect(within(approved).getByTestId('dealer-ws-media-status-m-cover-public')).toHaveAttribute('data-tone', 'success')

    const rejected = within(section).getByTestId('dealer-owner-media-item-m-yard-rejected')
    expect(within(rejected).getByTestId('dealer-ws-media-status-m-yard-rejected')).toHaveTextContent('Not approved')
    // Only the approved+public photo is green.
    expect(within(section).getByTestId('dealer-ws-media-group-review').querySelectorAll('[data-tone="success"]')).toHaveLength(0)
    expect(within(section).getByTestId('dealer-ws-media-group-other').querySelectorAll('[data-tone="success"]')).toHaveLength(0)
  })

  it('previews only the current company images, privately, through PrivateMediaThumb', async () => {
    await mount()
    await screen.findByTestId('dealer-owner-media-section')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const urls = fetchSpy.mock.calls.map(c => String(c[0])).sort()
    expect(urls).toEqual([
      'http://127.0.0.1:3001/api/dealer/operational-media/company-image/cover',
      'http://127.0.0.1:3001/api/dealer/operational-media/company-image/profile',
    ])
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ headers: { 'x-user-id': 'fictional-owner' }, cache: 'no-store' })
    expect(screen.getAllByText('Private copy')).toHaveLength(2)
    // The facility photo has no preview at all.
    expect(within(screen.getByTestId('dealer-owner-media-item-m-yard-rejected')).queryByText('Private copy')).toBeNull()
  })

  it('keeps upload gated on file, attestation, caption and alt text', async () => {
    await mount()
    fireEvent.click(await screen.findByTestId('dealer-ws-upload-toggle'))
    const upload = screen.getByTestId('dealer-media-upload-button')
    expect(upload).toBeDisabled()
    fireEvent.change(document.querySelector('#dealer-media-caption')!, { target: { value: 'Fictional forecourt' } })
    fireEvent.change(document.querySelector('#dealer-media-alt')!, { target: { value: 'Fictional forecourt view' } })
    fireEvent.click(document.querySelector('#dealer-media-rights-attestation')!)
    expect(upload).toBeDisabled() // still no file
    expect(fx.requests.filter(r => r.method === 'POST')).toHaveLength(0)
  })

  it('lists server-recorded branches as private, and policies with their recorded versions', async () => {
    await mount()
    expect(await screen.findByTestId('dealer-ws-branch-b1')).toHaveTextContent('Private · not public-approved')
    expect(screen.getByTestId('dealer-ws-policy-BUYER_ASSURANCE')).toHaveTextContent('Version 1')
    expect(screen.getByTestId('dealer-ws-policy-BUSINESS_OVERVIEW')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('dealer-ws-policy-BUSINESS_OVERVIEW')).toHaveAttribute('aria-pressed', 'true')
  })

  it('says a failed media read is not proof of no photos, and retries', async () => {
    fx.mediaDown = true
    await mount()
    const error = await screen.findByTestId('dealer-ws-media-error')
    expect(error).toHaveTextContent('not proof that you have no photos')
    expect(screen.queryByTestId('dealer-ws-media-empty')).toBeNull()
    fx.mediaDown = false
    fireEvent.click(within(error).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-owner-media-item-m-cover-public')).toBeInTheDocument()
  })

  it('an unavailable workspace offers a retry instead of a blank page', async () => {
    fx.workspaceDown = true
    await mount()
    const denied = await screen.findByTestId('dealer-ws-operating-denied')
    expect(denied).toHaveTextContent('A source listing or approved ownership claim alone is insufficient.')
    fx.workspaceDown = false
    fireEvent.click(within(denied).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-ws-branch-b1')).toBeInTheDocument()
  })
})
