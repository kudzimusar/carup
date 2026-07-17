// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const createReferralImportRoute = vi.fn()
const getReferralImportRouteStatus = vi.fn()
const updateReferralImportRouteCapacity = vi.fn()
const createReferralImportLead = vi.fn()
const qualifyReferralImportLead = vi.fn()
const listReferralImportRoutes = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    createReferralImportRoute,
    getReferralImportRouteStatus,
    updateReferralImportRouteCapacity,
    createReferralImportLead,
    qualifyReferralImportLead,
    listReferralImportRoutes,
  }),
}))

vi.mock('@/components/referral/ReferralEventLog', () => ({
  default: () => null,
}))

vi.mock('@/components/referral/ReferralRealList', () => ({
  default: () => null,
}))

const ReferralImportRoutes = (await import('./ReferralImportRoutes')).default

vi.setConfig({ testTimeout: 15000 })

beforeEach(() => {
  vi.clearAllMocks()
  listReferralImportRoutes.mockResolvedValue({ routes: [], pagination: { limit: 50 } })
  createReferralImportRoute.mockResolvedValue({ route: { route_key: 'refv1-stage5-route' } })
  createReferralImportLead.mockResolvedValue({
    event_id: '11111111-1111-4111-8111-111111111111',
    lead: { capacity_status: 'open', waitlisted: false },
  })
  qualifyReferralImportLead.mockResolvedValue({ reward_created: true })
})

describe('ReferralImportRoutes', () => {
  it('submits server-derived import attribution fields through the admin UI', async () => {
    render(<ReferralImportRoutes />)

    fireEvent.change(screen.getByTestId('referral-import-route-origin'), { target: { value: 'Japan' } })
    fireEvent.change(screen.getByTestId('referral-import-route-destination'), { target: { value: 'Zimbabwe' } })
    fireEvent.change(screen.getByTestId('referral-import-route-flow'), { target: { value: 'vehicle_import' } })
    fireEvent.change(screen.getByTestId('referral-import-route-key-input'), { target: { value: 'refv1-stage5-vehicle' } })
    fireEvent.change(screen.getByTestId('referral-import-route-total-capacity'), { target: { value: '8' } })
    fireEvent.change(screen.getByTestId('referral-import-route-unit-label'), { target: { value: 'vehicles' } })
    fireEvent.click(screen.getByTestId('referral-import-route-create'))

    await waitFor(() => expect(createReferralImportRoute).toHaveBeenCalled())
    expect(createReferralImportRoute).toHaveBeenCalledWith(expect.objectContaining({
      route_origin: 'Japan',
      route_destination: 'Zimbabwe',
      flow_type: 'vehicle_import',
      route_key: 'refv1-stage5-vehicle',
      total_capacity_units: 8,
      unit_label: 'vehicles',
    }))

    fireEvent.change(screen.getByTestId('referral-import-lead-route-key'), { target: { value: 'refv1-stage5-container' } })
    fireEvent.change(screen.getByTestId('referral-import-lead-flow'), { target: { value: 'parts_import' } })
    fireEvent.change(screen.getByTestId('referral-import-lead-referral-code'), { target: { value: 'REFV1-STAGING-S5-CODE' } })
    fireEvent.change(screen.getByTestId('referral-import-lead-reference'), { target: { value: 'REFV1-STAGING-S5-PARTS-LEAD' } })
    fireEvent.change(screen.getByTestId('referral-import-lead-contact-user-id'), { target: { value: 'u_uat_ref_invitee_2026' } })
    fireEvent.change(screen.getByTestId('referral-import-lead-part-name'), { target: { value: 'replacement engine' } })
    fireEvent.click(screen.getByTestId('referral-import-lead-create'))

    await waitFor(() => expect(createReferralImportLead).toHaveBeenCalled())
    expect(createReferralImportLead).toHaveBeenCalledWith(expect.objectContaining({
      route_key: 'refv1-stage5-container',
      flow_type: 'parts_import',
      referral_code: 'REFV1-STAGING-S5-CODE',
      lead_reference: 'REFV1-STAGING-S5-PARTS-LEAD',
      contact: { user_id: 'u_uat_ref_invitee_2026' },
      part_request: { part_name: 'replacement engine' },
    }))

    fireEvent.change(screen.getByTestId('referral-import-qualify-lead-event-id'), { target: { value: '11111111-1111-4111-8111-111111111111' } })
    fireEvent.change(screen.getByTestId('referral-import-qualify-milestone'), { target: { value: 'parts_order_paid' } })
    fireEvent.change(screen.getByTestId('referral-import-qualify-reward-amount'), { target: { value: '10' } })
    fireEvent.change(screen.getByTestId('referral-import-qualify-referred-user-id'), { target: { value: 'u_uat_ref_invitee_2026' } })
    fireEvent.change(screen.getByTestId('referral-import-qualify-result-reference'), { target: { value: 'REFV1-STAGING-S5-PAID' } })
    fireEvent.click(screen.getByTestId('referral-import-qualify-submit'))

    await waitFor(() => expect(qualifyReferralImportLead).toHaveBeenCalled())
    expect(qualifyReferralImportLead).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        milestone: 'parts_order_paid',
        reward_amount: 10,
        referred_user_id: 'u_uat_ref_invitee_2026',
        result_reference: 'REFV1-STAGING-S5-PAID',
      })
    )
  })
})
