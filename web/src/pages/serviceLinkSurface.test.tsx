/**
 * R8 — a scanned CarUp link must reach a usable surface, and must not become an oracle.
 *
 * THE DEFECT THIS PINS. `/api/service-links/:publicToken` resolved links correctly from the start
 * and the web app had no `/s/:token` route, so every QR code in the product opened the 404 page.
 *
 * Service Link security is NOT redesigned. These tests assert that the page renders the resolver's
 * decision faithfully and adds nothing to it: no VIN a stranger was not given, no status a
 * non-participant was not given, and no distinction between revoked, expired and never-existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ServiceLink from './ServiceLink'
import { presentLink } from '@/lib/serviceLink'

const resolveServiceLink = vi.fn()
let authUser: { id: string; active_tenant_id?: string | null } | null = null

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ resolveServiceLink }) }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: authUser }) }))

const TOKEN = 'sl_9f3a1c7d2b'
const VIN = 'SNCLOSE020359VIN1'

beforeEach(() => {
  vi.clearAllMocks()
  authUser = null
})

function open() {
  return render(
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <ServiceLink />
    </MemoryRouter>,
  )
}

// The component reads :token from the route, so it must be rendered under a matching path.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ token: TOKEN }) }
})

describe('R8 — the scan reaches a real surface', () => {
  it('an anonymous scan is a SAFE state with a way in, not an error', async () => {
    resolveServiceLink.mockResolvedValue({
      resource_type: 'vehicle', access: 'authentication_required',
      next_action: 'sign_in_to_continue', authenticated: false, source_channel: 'qr',
    })
    open()
    const result = await screen.findByTestId('service-link-result')
    expect(result.getAttribute('data-tone')).toBe('safe')
    expect(screen.getByTestId('service-link-title')).toHaveTextContent(/real CarUp link/i)
    // And it returns the person to the link after signing in, rather than dumping them on a home page.
    expect(screen.getByTestId('service-link-action').closest('a')?.getAttribute('href'))
      .toContain(`returnTo=${encodeURIComponent(`/s/${TOKEN}`)}`)
  })

  it('an anonymous scan is shown NO vehicle, case or garage detail', async () => {
    resolveServiceLink.mockResolvedValue({
      resource_type: 'vehicle', access: 'authentication_required', authenticated: false,
    })
    const { container } = open()
    await screen.findByTestId('service-link-result')
    expect(container.textContent).not.toContain(VIN)
    expect(container.textContent).not.toMatch(/registration|owner|status/i)
  })

  it('the owner of the vehicle gets the VIN and a way into it', async () => {
    authUser = { id: 'u-owner' }
    resolveServiceLink.mockResolvedValue({
      resource_type: 'vehicle', access: 'owner', vin: VIN, next_action: 'open_vehicle', authenticated: true,
    })
    open()
    await screen.findByTestId('service-link-result')
    expect(screen.getByTestId('service-link-body')).toHaveTextContent(VIN)
    expect(screen.getByTestId('service-link-action').closest('a')?.getAttribute('href'))
      .toBe(`/dashboard/garage/${VIN}`)
  })

  it('a stranger scanning a windscreen sticker never sees a VIN', async () => {
    authUser = { id: 'u-stranger' }
    // The resolver withholds the VIN for `limited`. The page must not fill the gap.
    resolveServiceLink.mockResolvedValue({
      resource_type: 'vehicle', access: 'limited', vin: null, next_action: 'request_service', authenticated: true,
    })
    const { container } = open()
    await screen.findByTestId('service-link-result')
    expect(container.textContent).not.toContain(VIN)
    expect(container.getAttribute('data-tone')).not.toBe('safe')
    expect(screen.getByTestId('service-link-result').getAttribute('data-tone')).toBe('blocked')
  })

  it('a non-participant is told it is not theirs — and is shown no status', async () => {
    authUser = { id: 'u-nosy' }
    resolveServiceLink.mockResolvedValue({
      resource_type: 'service_case', access: 'not_a_participant', next_action: 'request_access', authenticated: true,
    })
    const { container } = open()
    await screen.findByTestId('service-link-result')
    expect(screen.getByTestId('service-link-title')).toHaveTextContent(/not yours to open/i)
    expect(container.textContent).not.toMatch(/in progress|completed|accepted|requested/i)
    // Nothing to offer is better than a button that leads nowhere.
    expect(screen.queryByTestId('service-link-action')).toBeNull()
  })

  it('revoked, expired and never-existed are ONE answer — the page is not an oracle', async () => {
    for (const message of ['This link is not valid', 'Not found']) {
      resolveServiceLink.mockRejectedValue(new Error(message))
      const { unmount } = open()
      await screen.findByTestId('service-link-result')
      expect(screen.getByTestId('service-link-title')).toHaveTextContent(/not valid/i)
      // Never a hint at WHICH of the three it was.
      expect(screen.getByTestId('service-link-body').textContent).not.toMatch(/revoked|expired|used/i)
      unmount()
    }
  })

  it('a network failure is a failure, never reported as an invalid link', async () => {
    resolveServiceLink.mockRejectedValue(new Error('Failed to fetch'))
    open()
    await screen.findByTestId('service-link-result')
    expect(screen.getByTestId('service-link-title')).toHaveTextContent(/could not be checked/i)
    expect(screen.getByTestId('service-link-body')).toHaveTextContent(/not a statement that your link is invalid/i)
  })
})

describe('R8 — the two sides of a job are different products', () => {
  it('the requester goes to their requests; a garage member goes to the garage workspace', async () => {
    const link = { resource_type: 'service_case', access: 'participant', service_case_id: 'case-77', status: 'accepted' }
    expect(presentLink(link, { returnTo: '/s/x', viewerIsGarageMember: false }).action?.to)
      .toBe('/dashboard/service-requests')
    expect(presentLink(link, { returnTo: '/s/x', viewerIsGarageMember: true }).action?.to)
      .toBe('/garage/cases/case-77')
  })

  it('a mechanic link states affiliation without inventing certification', async () => {
    authUser = { id: 'u-any' }
    resolveServiceLink.mockResolvedValue({
      resource_type: 'practitioner', access: 'public_practitioner', authenticated: true,
      practitioner: {
        affiliation: { display_name: 'SN Cert Garage', slug: 'sn-cert' },
        credential_review_state: 'not_reviewed',
      },
    })
    const { container } = open()
    await screen.findByTestId('service-link-result')
    expect(screen.getByTestId('service-link-body')).toHaveTextContent('SN Cert Garage')
    expect(screen.getByTestId('service-link-body')).toHaveTextContent(/has not reviewed their qualifications/i)
    expect(container.textContent).not.toMatch(/certified|verified mechanic|vetted|rating|score/i)
  })
})

describe('R8 — the words a person reads are not the engineering names', () => {
  it('never says capability, grant, token, resource or redemption', () => {
    const cases = [
      { resource_type: 'vehicle', access: 'authentication_required' },
      { resource_type: 'vehicle', access: 'owner', vin: VIN },
      { resource_type: 'vehicle', access: 'limited', vin: null },
      { resource_type: 'service_case', access: 'participant', service_case_id: 'c-1' },
      { resource_type: 'service_case', access: 'not_a_participant' },
      { resource_type: 'practitioner', access: 'public_practitioner', practitioner: { affiliation: null } },
      { resource_type: 'something_new', access: 'owner' },
    ]
    for (const c of cases) {
      const p = presentLink(c, { returnTo: '/s/x' })
      const prose = `${p.title} ${p.body} ${p.action?.label ?? ''}`
      expect(prose, `jargon leaked for ${c.resource_type}/${c.access}`)
        .not.toMatch(/capabilit|grant|redeem|redemption|\btoken\b|\bresource\b|tenant/i)
      expect(p.title.length, 'every state must say something').toBeGreaterThan(0)
      expect(p.body.length).toBeGreaterThan(0)
    }
  })

  it('an unknown resource type is reported as unopenable, not as invalid', () => {
    const p = presentLink({ resource_type: 'future_thing', access: 'owner' }, { returnTo: '/s/x' })
    expect(p.title).toMatch(/cannot be opened here/i)
    expect(p.body).toMatch(/valid CarUp link/i)
  })
})
