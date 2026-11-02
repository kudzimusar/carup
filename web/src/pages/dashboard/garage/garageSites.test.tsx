import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { getFeatureByRoute } from '@/config/featureRegistry'

const listGarageSites = vi.fn()
const createGarageSite = vi.fn()
const updateGarageSite = vi.fn()
const setGarageSiteStatus = vi.fn()
const setGarageSiteManager = vi.fn()
const listGarageWorkforce = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    listGarageSites, createGarageSite, updateGarageSite, setGarageSiteStatus, setGarageSiteManager, listGarageWorkforce,
  }),
}))

const { default: GarageSites } = await import('./GarageSites')

beforeEach(() => {
  vi.clearAllMocks()
  listGarageSites.mockResolvedValue({ sites: [] })
  listGarageWorkforce.mockResolvedValue({ workforce: [] })
  createGarageSite.mockResolvedValue({ site: { id: 's1' } })
  updateGarageSite.mockResolvedValue({})
  setGarageSiteStatus.mockResolvedValue({})
  setGarageSiteManager.mockResolvedValue({})
})

describe('Garage Sites product truth', () => {
  it('renders a genuine empty state only after a successful empty read', async () => {
    render(<GarageSites />)
    expect(await screen.findByTestId('sites-empty')).toHaveTextContent(/No operating sites/)
  })

  it('does not turn a failed read into an empty Garage', async () => {
    listGarageSites.mockRejectedValue(new Error('network'))
    render(<GarageSites />)
    expect(await screen.findByTestId('sites-error')).toHaveTextContent(/does not mean your garage has no sites/i)
    expect(screen.queryByTestId('sites-empty')).toBeNull()
  })

  it('creates a site without ever sending an authoritative tenant id', async () => {
    render(<GarageSites />)
    await screen.findByTestId('sites-empty')
    fireEvent.change(screen.getByLabelText('Branch code'), { target: { value: 'north-01' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'North Workshop' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '10 Enterprise Road' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Harare' } })
    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: 'zw' } })
    fireEvent.click(screen.getByRole('button', { name: /Create site/i }))
    await waitFor(() => expect(createGarageSite).toHaveBeenCalledTimes(1))
    const payload = createGarageSite.mock.calls[0][0]
    expect(payload.branch_code).toBe('NORTH-01')
    expect(payload.country_code).toBe('ZW')
    expect(payload.tenant_id).toBeUndefined()
    expect(payload.opening_hours).toEqual([])
  })

  it('records opening hours only when the operator explicitly records them', async () => {
    render(<GarageSites />)
    await screen.findByTestId('sites-empty')
    fireEvent.change(screen.getByLabelText('Branch code'), { target: { value: 'south-01' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'South Workshop' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '20 Enterprise Road' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Harare' } })
    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: 'zw' } })
    fireEvent.change(screen.getByLabelText('Mon hours status'), { target: { value: 'open' } })
    fireEvent.change(screen.getByLabelText('Mon opening time'), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText('Mon closing time'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('Sun hours status'), { target: { value: 'closed' } })
    fireEvent.click(screen.getByRole('button', { name: /Create site/i }))

    await waitFor(() => expect(createGarageSite).toHaveBeenCalledTimes(1))
    const hours = createGarageSite.mock.calls[0][0].opening_hours
    expect(hours).toEqual([
      { day_of_week: 0, is_closed: true },
      { day_of_week: 1, is_closed: false, opens_at: '09:00', closes_at: '18:00' },
    ])
  })

  it('routes an edited manager responsibility through the dedicated audited endpoint', async () => {
    listGarageSites.mockResolvedValue({
      sites: [{
        id: 's1', branch_code: 'CENTRAL-01', name: 'Central', address_public: '1 Road',
        location_city: 'Harare', location_province: null, country_code: 'ZW',
        phone: null, email: null, whatsapp: null, timezone: 'Africa/Harare',
        is_active: true, is_primary: true, is_public: false, manager_user_id: null,
        opening_hours: [],
      }],
    })
    listGarageWorkforce.mockResolvedValue({
      workforce: [{ user_id: 'u-manager', employment_status: 'active', staff_code: 'STAFF-1', user: { name: 'Manager One' } }],
    })
    render(<GarageSites />)
    await screen.findByText('Central')
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }))
    fireEvent.change(screen.getByLabelText('Manager'), { target: { value: 'u-manager' } })
    fireEvent.click(screen.getByRole('button', { name: /Save site/i }))

    await waitFor(() => expect(updateGarageSite).toHaveBeenCalledTimes(1))
    expect(updateGarageSite.mock.calls[0][1].manager_user_id).toBeUndefined()
    await waitFor(() => expect(setGarageSiteManager).toHaveBeenCalledWith('s1', 'u-manager'))
  })
})

describe('OPS01 routes are selected-Garage admin surfaces', () => {
  const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined }
  for (const route of ['/garage/sites', '/garage/workforce']) {
    it(`${route} has no platform-role authority`, () => {
      const feature = getFeatureByRoute(route)
      expect(feature?.roles).toEqual([])
      expect(feature?.tenantTypes).toEqual(['garage'])
      expect(feature?.tenantRoles).toEqual(['admin'])
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', activeTenant: { type: 'garage', role: 'admin' } }).kind).toBe('render')
      expect(evaluateRouteAccess({ ...base, route, role: 'admin', activeTenant: null }).kind).toBe('redirect')
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', activeTenant: { type: 'garage', role: 'mechanic' } }).kind).toBe('redirect')
    })
  }
})
