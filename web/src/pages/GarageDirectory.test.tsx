import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageDirectory from './GarageDirectory'

/**
 * Service Network S1 — the Garage Directory's truth contract.
 *
 * This page previously rendered invented garages (fabricated names, ratings, opening hours,
 * phone numbers and a green "Verified" check). It now reads the governed registry, and these
 * tests lock the properties that made the old page dishonest:
 *
 *   - a failed load is reported as a FAILURE, never as "no garages listed" — the two states
 *     make opposite claims about the world;
 *   - nothing is rendered that the API did not return (no ratings, no hours, no verified badge);
 *   - an empty published registry still shows the honest empty state.
 */
const originalFetch = global.fetch

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch
}

describe('GarageDirectory', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it('renders published garages returned by the governed registry', async () => {
    mockFetchOnce({
      garages: [{
        slug: 'harare-motors',
        display_name: 'Harare Motors',
        description: 'Independent workshop.',
        location_city: 'Harare',
        location_province: 'Harare',
        service_categories: ['engine', 'brakes'],
        contact_policy: 'in_app_only',
        public_phone: null,
        verification_dimensions: {},
        public_media: [],
        published_at: '2026-09-01T00:00:00.000Z',
      }],
      total: 1,
    })

    render(<MemoryRouter><GarageDirectory /></MemoryRouter>)

    expect(await screen.findByText('Harare Motors')).toBeTruthy()
    expect(screen.getByText('Engine')).toBeTruthy()
    expect(screen.getByText('Brakes')).toBeTruthy()
    expect(screen.queryByTestId('garage-directory-empty')).toBeNull()
    expect(screen.queryByTestId('garage-directory-error')).toBeNull()
  })

  it('never renders a rating, opening hours or a verification badge', async () => {
    mockFetchOnce({
      garages: [{
        slug: 'harare-motors',
        display_name: 'Harare Motors',
        description: null,
        location_city: 'Harare',
        location_province: null,
        service_categories: ['engine'],
        contact_policy: 'in_app_only',
        public_phone: null,
        verification_dimensions: {},
        public_media: [],
        published_at: '2026-09-01T00:00:00.000Z',
      }],
      total: 1,
    })

    const { container } = render(<MemoryRouter><GarageDirectory /></MemoryRouter>)
    await screen.findByText('Harare Motors')

    const text = container.textContent || ''
    expect(/verified/i.test(text)).toBe(false)
    expect(/\bopen(ing)?\b.*\b(hours|today)\b/i.test(text)).toBe(false)
    expect(/★|\b\d\.\d\s*(stars?|rating)\b/i.test(text)).toBe(false)
    expect(/book service/i.test(text)).toBe(false)
  })

  it('shows the honest empty state when the registry has no published garages', async () => {
    mockFetchOnce({ garages: [], total: 0 })
    render(<MemoryRouter><GarageDirectory /></MemoryRouter>)
    expect(await screen.findByTestId('garage-directory-empty')).toBeTruthy()
    expect(screen.getByText(/No garages listed yet/i)).toBeTruthy()
  })

  it('reports a failed load as a failure, NOT as an empty directory', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    render(<MemoryRouter><GarageDirectory /></MemoryRouter>)

    expect(await screen.findByTestId('garage-directory-error')).toBeTruthy()
    // The critical distinction: it must NOT claim the directory is empty.
    expect(screen.queryByTestId('garage-directory-empty')).toBeNull()
    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    })
  })

  it('treats a non-OK response as a failure too', async () => {
    mockFetchOnce({}, false, 500)
    render(<MemoryRouter><GarageDirectory /></MemoryRouter>)
    expect(await screen.findByTestId('garage-directory-error')).toBeTruthy()
    expect(screen.queryByTestId('garage-directory-empty')).toBeNull()
  })
})
