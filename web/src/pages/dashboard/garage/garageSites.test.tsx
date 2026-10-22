import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { getFeatureByRoute } from '@/config/featureRegistry'

const listGarageSites = vi.fn()
const createGarageSite = vi.fn()
const updateGarageSite = vi.fn()
const setGarageSiteStatus = vi.fn()
const listGarageWorkforce = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    listGarageSites, createGarageSite, updateGarageSite, setGarageSiteStatus, listGarageWorkforce,
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
    expect(Array.isArray(payload.opening_hours)).toBe(true)
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
