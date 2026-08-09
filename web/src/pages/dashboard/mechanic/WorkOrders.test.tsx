import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * DB-contract audit: PATCH /api/mechanic/work-orders/:id exists (workOrdersRoutes.js —
 * status: 'In Progress' | 'Completed' | 'Cancelled', optional non-negative total_cost) but no
 * client path called it, so work orders could never be completed or cancelled. The page must now
 * offer per-row Complete / Cancel actions that call the hook with the REAL DB id and DB-LEGAL
 * status values, then re-fetch the authoritative rows.
 */

const fetchMechanicWorkOrders = vi.fn()
const createMechanicWorkOrder = vi.fn()
const updateMechanicWorkOrder = vi.fn()

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMechanicWorkOrders,
    createMechanicWorkOrder,
    updateMechanicWorkOrder,
    loading: false,
  }),
}))

const WorkOrders = (await import('./WorkOrders')).default

// A realistic DB row: uuid id (display id truncates it), DB CHECK status vocabulary.
const RAW_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const DISPLAY_ID = RAW_ID.substring(0, 11).toUpperCase()
const openOrder = {
  id: RAW_ID,
  vin: 'JTD1234567890',
  customer_name: 'John Doe',
  description: 'Brake pads',
  status: 'In Progress',
  created_at: '2026-08-01T09:00:00Z',
  mechanic_id: 'mech-9f31',
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMechanicWorkOrders.mockResolvedValue([openOrder])
  updateMechanicWorkOrder.mockResolvedValue({ success: true, workOrder: { ...openOrder, status: 'Completed' } })
})

describe('WorkOrders per-row status actions (DB PATCH contract)', () => {
  it('cancels an order via the hook with the REAL DB id and the DB-legal "Cancelled" status', async () => {
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-cancel-${DISPLAY_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`workorder-cancel-${DISPLAY_ID}`))

    await waitFor(() => expect(updateMechanicWorkOrder).toHaveBeenCalledWith(RAW_ID, { status: 'Cancelled' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    // Authoritative refresh after the action (initial load + post-action re-fetch).
    expect(fetchMechanicWorkOrders).toHaveBeenCalledTimes(2)
  })

  it('completes an order with an optional total_cost using the DB-legal "Completed" status', async () => {
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`))

    const costInput = await screen.findByTestId(`workorder-total-cost-input-${DISPLAY_ID}`)
    fireEvent.change(costInput, { target: { value: '120.5' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${DISPLAY_ID}`))

    await waitFor(() =>
      expect(updateMechanicWorkOrder).toHaveBeenCalledWith(RAW_ID, { status: 'Completed', total_cost: 120.5 }),
    )
    expect(fetchMechanicWorkOrders).toHaveBeenCalledTimes(2)
  })

  it('omits total_cost entirely when the completion cost is left blank', async () => {
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`))
    fireEvent.click(await screen.findByTestId(`workorder-confirm-complete-${DISPLAY_ID}`))

    await waitFor(() => expect(updateMechanicWorkOrder).toHaveBeenCalledWith(RAW_ID, { status: 'Completed' }))
  })

  it('rejects a negative total_cost client-side without calling the API', async () => {
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`workorder-complete-${DISPLAY_ID}`))
    fireEvent.change(await screen.findByTestId(`workorder-total-cost-input-${DISPLAY_ID}`), { target: { value: '-5' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${DISPLAY_ID}`))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(updateMechanicWorkOrder).not.toHaveBeenCalled()
  })

  it('surfaces a failed PATCH honestly — error toast, no success claim', async () => {
    updateMechanicWorkOrder.mockRejectedValue(new Error('Work order not found'))
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-cancel-${DISPLAY_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`workorder-cancel-${DISPLAY_ID}`))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Work order not found'))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('offers no status actions on already-terminal rows', async () => {
    fetchMechanicWorkOrders.mockResolvedValue([
      { ...openOrder, status: 'Completed' },
    ])
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-row-${DISPLAY_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`workorder-complete-${DISPLAY_ID}`)).toBeNull()
    expect(screen.queryByTestId(`workorder-cancel-${DISPLAY_ID}`)).toBeNull()
  })
})
