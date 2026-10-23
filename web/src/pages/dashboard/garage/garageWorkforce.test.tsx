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

  it('keeps new workforce classification and start date unset until the operator supplies them', async () => {
    render(<GarageWorkforce />)
    fireEvent.click(await screen.findByTestId('workforce-member'))

    const classification = screen.getByLabelText(/Classification/i)
    const startDate = screen.getByLabelText(/Start date/i)
    expect(classification).toHaveValue('')
    expect(startDate).toHaveValue('')

    fireEvent.change(screen.getByTestId('staff-code'), { target: { value: 'tech-001' } })
    fireEvent.change(screen.getByTestId('primary-site'), { target: { value: 's1' } })

    fireEvent.submit(screen.getByTestId('workforce-profile-form'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Select an employment classification/i)
    expect(createGarageWorkforceProfile).not.toHaveBeenCalled()

    fireEvent.change(classification, { target: { value: 'contractor' } })
    fireEvent.submit(screen.getByTestId('workforce-profile-form'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter the workforce start date/i)
    expect(createGarageWorkforceProfile).not.toHaveBeenCalled()

    fireEvent.change(startDate, { target: { value: '2026-09-01' } })
    fireEvent.submit(screen.getByTestId('workforce-profile-form'))

    await waitFor(() => expect(createGarageWorkforceProfile).toHaveBeenCalledTimes(1))
    const payload = createGarageWorkforceProfile.mock.calls[0][0]
    expect(payload).toMatchObject({
      user_id: 'mech-1',
      staff_code: 'TECH-001',
      employment_classification: 'contractor',
      start_date: '2026-09-01',
    })
    expect(payload.tenant_id).toBeUndefined()
  })

  it('creates operational metadata only for an already-returned Garage member', async () => {
    render(<GarageWorkforce />)
    const member = await screen.findByTestId('workforce-member')
    fireEvent.click(member)
    fireEvent.change(screen.getByTestId('staff-code'), { target: { value: 'tech-001' } })
    fireEvent.change(screen.getByLabelText(/Classification/i), { target: { value: 'employee' } })
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByTestId('primary-site'), { target: { value: 's1' } })
    fireEvent.change(screen.getByLabelText(/Skills \/ specialties/i), { target: { value: 'Brakes, Diagnostics' } })
    fireEvent.click(screen.getByRole('button', { name: /Create workforce profile/i }))

    await waitFor(() => expect(createGarageWorkforceProfile).toHaveBeenCalledTimes(1))
    const payload = createGarageWorkforceProfile.mock.calls[0][0]
    expect(payload.user_id).toBe('mech-1')
    expect(payload.staff_code).toBe('TECH-001')
    expect(payload.employment_classification).toBe('employee')
    expect(payload.start_date).toBe('2026-10-01')
    expect(payload.tenant_id).toBeUndefined()

    await waitFor(() => expect(setGarageWorkforceBranches).toHaveBeenCalledWith('mech-1', {
      primary_branch_id: 's1', additional_branch_ids: [],
    }))
    expect(replaceGarageWorkforceSkills).toHaveBeenCalledWith('mech-1', ['Brakes', 'Diagnostics'])
    expect(setGarageWorkforceStatus).toHaveBeenCalledWith('mech-1', 'active')
  })

  it('keeps an existing staff code visible but immutable in the operator UI', async () => {
    listGarageWorkforce.mockResolvedValue({
      workforce: [{
        id: 'p1', tenant_id: 't1', user_id: 'mech-1', staff_code: 'TECH-001',
        job_title: 'Technician', employment_classification: 'employee', employment_status: 'active',
        start_date: '2026-10-01', end_date: null, department_id: null, internal_notes: null,
        user: { id: 'mech-1', name: 'Tariro', email: 't@example.invalid' },
        department: null, branch_assignments: [{ branch_id: 's1', is_primary: true }], skills: [], certifications: [],
      }],
    })
    render(<GarageWorkforce />)
    fireEvent.click(await screen.findByTestId('workforce-member'))
    const staffCode = screen.getByTestId('staff-code')
    expect(staffCode).toHaveValue('TECH-001')
    expect(staffCode).toBeDisabled()
    expect(screen.getByLabelText(/Classification/i)).toHaveValue('employee')
    expect(screen.getByLabelText(/Start date/i)).toHaveValue('2026-10-01')
  })

  it('prepares an inactive mechanic for reactivation before allowing a new site assignment', async () => {
    listGarageWorkforce.mockResolvedValue({
      workforce: [{
        id: 'p1', tenant_id: 't1', user_id: 'mech-1', staff_code: 'TECH-001',
        job_title: 'Technician', employment_classification: 'employee', employment_status: 'inactive',
        start_date: '2026-10-01', end_date: null, department_id: null, internal_notes: null,
        user: { id: 'mech-1', name: 'Tariro', email: 't@example.invalid' },
        department: null, branch_assignments: [], skills: [], certifications: [],
      }],
    })
    render(<GarageWorkforce />)
    fireEvent.click(await screen.findByTestId('workforce-member'))
    fireEvent.click(screen.getByRole('button', { name: /Prepare reactivation/i }))
    await waitFor(() => expect(setGarageWorkforceStatus).toHaveBeenCalledWith('mech-1', 'pending'))
    expect(setGarageWorkforceBranches).not.toHaveBeenCalled()
  })

  it('states explicitly that workforce metadata does not replace membership authority', async () => {
    render(<GarageWorkforce />)
    await screen.findByTestId('workforce-member')
    expect(screen.getByText(/Membership controls Garage access/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot create a user or membership/i)).toBeInTheDocument()
  })
})
