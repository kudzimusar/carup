import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * PATCH /api/mechanic/work-orders/:id existed on the backend
 * (backend/routes/workOrdersRoutes.js — status: 'In Progress'|'Completed'|'Cancelled',
 * optional total_cost) but no client ever called it, so a work order could never be
 * completed or cancelled from the UI. The row actions must call updateMechanicWorkOrder
 * with the DB-legal status values and the FULL DB id (never the shortened display id).
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
  useCarUpApi: () => ({ fetchMechanicWorkOrders, createMechanicWorkOrder, updateMechanicWorkOrder, loading: false }),
}))

const WorkOrders = (await import('./WorkOrders')).default

// Full DB id — the PATCH route resolves by this, so the UI must never send a truncated one.
const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const inProgressOrder = {
  id: ORDER_ID,
  vin: 'JTD123456789',
  customer_name: 'John Doe',
  issue_description: 'Brake pads worn',
  status: 'In Progress',
  created_at: '2026-08-01T09:00:00Z',
  mechanic_id: 'mech-1234',
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMechanicWorkOrders.mockResolvedValue([inProgressOrder])
  updateMechanicWorkOrder.mockResolvedValue({ success: true, workOrder: { ...inProgressOrder, status: 'Completed' } })
})

describe('WorkOrders completion and cancellation actions', () => {
  it("completes an order via PATCH with the DB-legal 'Completed' status and the entered total_cost", async () => {
    render(<WorkOrders />)

    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.change(screen.getByTestId(`workorder-cost-input-${ORDER_ID}`), { target: { value: '450' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))

    await waitFor(() =>
      expect(updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Completed', total_cost: 450 }),
    )
    expect(toastSuccess).toHaveBeenCalled()
    // Optimistic UI is re-synced from the backend after the PATCH.
    await waitFor(() => expect(fetchMechanicWorkOrders).toHaveBeenCalledTimes(2))
  })

  it('completes without total_cost when the optional input is left empty', async () => {
    render(<WorkOrders />)

    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))

    await waitFor(() =>
      expect(updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Completed' }),
    )
  })

  it("cancels an order via PATCH with the DB-legal 'Cancelled' status", async () => {
    render(<WorkOrders />)

    fireEvent.click(await screen.findByTestId(`workorder-cancel-${ORDER_ID}`))

    await waitFor(() =>
      expect(updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Cancelled' }),
    )
  })

  it('rejects a negative total_cost client-side without calling the API', async () => {
    render(<WorkOrders />)

    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.change(screen.getByTestId(`workorder-cost-input-${ORDER_ID}`), { target: { value: '-5' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Total cost must be a non-negative number'))
    expect(updateMechanicWorkOrder).not.toHaveBeenCalled()
  })

  it('surfaces an update failure honestly and restores the row state', async () => {
    updateMechanicWorkOrder.mockRejectedValue(new Error('Work order not found'))
    render(<WorkOrders />)

    fireEvent.click(await screen.findByTestId(`workorder-cancel-${ORDER_ID}`))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Work order not found'))
    expect(toastSuccess).not.toHaveBeenCalled()
    // The optimistic transition is rolled back — the row is actionable again.
    expect(await screen.findByTestId(`workorder-complete-${ORDER_ID}`)).toBeTruthy()
    // No refresh happened on failure; the initial load remains the only fetch.
    expect(fetchMechanicWorkOrders).toHaveBeenCalledTimes(1)
  })

  it('offers no actions on terminal rows', async () => {
    fetchMechanicWorkOrders.mockResolvedValue([{ ...inProgressOrder, status: 'Completed' }])
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-row-${ORDER_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`workorder-actions-${ORDER_ID}`)).toBeNull()
    expect(screen.queryByTestId(`workorder-complete-${ORDER_ID}`)).toBeNull()
    expect(screen.queryByTestId(`workorder-cancel-${ORDER_ID}`)).toBeNull()
  })

  it("renders the Phase-4 `description` column as the service text, not the placeholder", async () => {
    // POST /mechanic/work-orders stores the create form's issue text in the `description`
    // column (backend/routes/workOrdersRoutes.js), so app-created rows carry ONLY that field.
    fetchMechanicWorkOrders.mockResolvedValue([
      { ...inProgressOrder, issue_description: undefined, description: 'Replace timing belt' },
    ])
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByText('Replace timing belt')).toBeTruthy())
    expect(screen.queryByText('General Service')).toBeNull()
  })

  it('filters to cancelled orders via the cancelled filter button', async () => {
    fetchMechanicWorkOrders.mockResolvedValue([
      inProgressOrder,
      { ...inProgressOrder, id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', status: 'Cancelled' },
    ])
    render(<WorkOrders />)

    await waitFor(() => expect(screen.getByTestId(`workorder-row-${ORDER_ID}`)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    expect(screen.queryByTestId(`workorder-row-${ORDER_ID}`)).toBeNull()
    expect(screen.getByTestId('workorder-row-b2c3d4e5-f6a7-8901-bcde-f23456789012')).toBeTruthy()
  })
})
