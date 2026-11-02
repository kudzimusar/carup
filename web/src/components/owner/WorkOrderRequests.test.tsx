import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { VehicleWorkOrder } from '@/lib/partsentry'

/**
 * OC-5A — the custodian's decision is what makes a work order a service relationship. The panel shows
 * pending requests with Authorize / Decline, authorized ones with Revoke, and nothing actionable when the
 * requests cannot be read.
 */
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
const WorkOrderRequests = (await import('./WorkOrderRequests')).default

const order = (id: string, owner_authorization: VehicleWorkOrder['owner_authorization']): VehicleWorkOrder => ({
  id, vin: 'VIN0000000000001', status: 'In Progress', description: 'Brake service', created_at: null, owner_authorization, owner_authorized_at: null,
  organisation: { id: 't-1', name: 'Avondale Garage', type: 'garage' }, mechanic: { name: 'T. Moyo' },
})

const fetchVehicleWorkOrders = vi.fn()
const decideWorkOrderAuthorization = vi.fn()
beforeEach(() => { vi.clearAllMocks() })

const renderPanel = () => render(<WorkOrderRequests vin="VIN0000000000001" fetchVehicleWorkOrders={fetchVehicleWorkOrders} decideWorkOrderAuthorization={decideWorkOrderAuthorization} />)

describe('WorkOrderRequests', () => {
  it('a pending request offers Authorize and Decline; authorizing decides, says what it grants, and reloads', async () => {
    fetchVehicleWorkOrders.mockResolvedValueOnce([order('wo-1', 'pending')]).mockResolvedValueOnce([order('wo-1', 'authorized')])
    decideWorkOrderAuthorization.mockResolvedValue({ success: true })
    renderPanel()
    expect(await screen.findByText(/Avondale Garage — T\. Moyo/)).toBeInTheDocument()
    expect(screen.getByTestId('decline-wo-1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('authorize-wo-1'))
    await waitFor(() => expect(decideWorkOrderAuthorization).toHaveBeenCalledWith('VIN0000000000001', 'wo-1', 'authorized'))
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/may now record service/))
    expect(await screen.findByTestId('revoke-wo-1')).toBeInTheDocument()
    expect(screen.queryByTestId('authorize-wo-1')).toBeNull()
  })

  it('declined and revoked orders are not actionable and are not listed', async () => {
    fetchVehicleWorkOrders.mockResolvedValue([order('wo-d', 'declined'), order('wo-r', 'revoked')])
    renderPanel()
    expect(await screen.findByTestId('work-order-requests-empty')).toBeInTheDocument()
  })

  it('a refused decision is shown as the server\'s reason, never as success', async () => {
    fetchVehicleWorkOrders.mockResolvedValue([order('wo-1', 'pending')])
    decideWorkOrderAuthorization.mockRejectedValue(Object.assign(new Error('HTTP error! status: 403'), { status: 403, data: { error: 'Only the vehicle\'s owner decides on its work orders.' } }))
    renderPanel()
    fireEvent.click(await screen.findByTestId('authorize-wo-1'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Only the vehicle's owner/)))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('an unreadable request list shows an error and offers no decision', async () => {
    fetchVehicleWorkOrders.mockRejectedValue(Object.assign(new Error('HTTP error! status: 503'), { status: 503, data: { error: 'The vehicle could not be read.' } }))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('The vehicle could not be read.')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
