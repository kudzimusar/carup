import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const listGarageMembers = vi.fn()
const listGarageWorkforce = vi.fn()
const listGarageSites = vi.fn()
const listGarageDepartments = vi.fn()
const createGarageDepartment = vi.fn()
const createGarageWorkforceProfile = vi.fn()
const upsertGarageWorkforceProfile = vi.fn()
const setGarageWorkforceStatus = vi.fn()
const setGarageWorkforceBranches = vi.fn()
const replaceGarageWorkforceSkills = vi.fn()
const addGarageWorkforceCertification = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    listGarageMembers, listGarageWorkforce, listGarageSites, listGarageDepartments,
    createGarageDepartment, createGarageWorkforceProfile, upsertGarageWorkforceProfile,
    setGarageWorkforceStatus, setGarageWorkforceBranches, replaceGarageWorkforceSkills,
    addGarageWorkforceCertification,
  }),
}))

const { default: GarageWorkforce } = await import('./GarageWorkforce')

const MEMBER = {
  membershipId: 'm1', userId: 'mech-1', displayName: 'Tariro', email: 't@example.invalid',
  role: 'mechanic', joinedAt: '2026-10-01',
}
const SITE = { id: 's1', branch_code: 'CENTRAL-01', name: 'Central', is_active: true }

beforeEach(() => {
  vi.clearAllMocks()
  listGarageMembers.mockResolvedValue({ members: [MEMBER] })
  listGarageWorkforce.mockResolvedValue({ workforce: [] })
  listGarageSites.mockResolvedValue({ sites: [SITE] })
  listGarageDepartments.mockResolvedValue({ departments: [{ id: 'd1', name: 'Workshop', is_active: true }] })
  createGarageDepartment.mockResolvedValue({})
  createGarageWorkforceProfile.mockResolvedValue({ profile: { user_id: 'mech-1' } })
  upsertGarageWorkforceProfile.mockResolvedValue({})
  setGarageWorkforceStatus.mockResolvedValue({})
  setGarageWorkforceBranches.mockResolvedValue({})
  replaceGarageWorkforceSkills.mockResolvedValue({})
  addGarageWorkforceCertification.mockResolvedValue({})
})

describe('Garage Workforce product truth', () => {
  it('keeps a failed authority read distinct from an empty workforce', async () => {
    listGarageWorkforce.mockRejectedValue(new Error('unavailable'))
    render(<GarageWorkforce />)
    expect(await screen.findByTestId('workforce-error')).toHaveTextContent(/does not mean this garage has no staff/i)
    expect(screen.queryByTestId('workforce-members-empty')).toBeNull()
  })

  it('creates operational metadata only for an already-returned Garage member', async () => {
    render(<GarageWorkforce />)
    const member = await screen.findByTestId('workforce-member')
    fireEvent.click(member)
    fireEvent.change(screen.getByTestId('staff-code'), { target: { value: 'tech-001' } })
    fireEvent.change(screen.getByTestId('primary-site'), { target: { value: 's1' } })
    fireEvent.change(screen.getByLabelText('Skills / specialties'), { target: { value: 'Brakes, Diagnostics' } })
    fireEvent.click(screen.getByRole('button', { name: /Create workforce profile/i }))

    await waitFor(() => expect(createGarageWorkforceProfile).toHaveBeenCalledTimes(1))
    const payload = createGarageWorkforceProfile.mock.calls[0][0]
    expect(payload.user_id).toBe('mech-1')
    expect(payload.staff_code).toBe('TECH-001')
    expect(payload.tenant_id).toBeUndefined()

    await waitFor(() => expect(setGarageWorkforceBranches).toHaveBeenCalledWith('mech-1', {
      primary_branch_id: 's1', additional_branch_ids: [],
    }))
    expect(replaceGarageWorkforceSkills).toHaveBeenCalledWith('mech-1', ['Brakes', 'Diagnostics'])
  })

  it('states explicitly that workforce metadata does not replace membership authority', async () => {
    render(<GarageWorkforce />)
    await screen.findByTestId('workforce-member')
    expect(screen.getByText(/Membership controls Garage access/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot create a user or membership/i)).toBeInTheDocument()
  })
})
