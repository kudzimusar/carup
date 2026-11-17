import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SellStart } from './SellStart'
import type { Vehicle } from '@/types'

const action = (vehicle: Vehicle) => ({ label: 'Sell this vehicle', href: `/dashboard/sell-vehicle?vin=${vehicle.vin}` })

function renderStart(props: Partial<React.ComponentProps<typeof SellStart>> = {}) {
  const onResolve = vi.fn()
  render(
    <MemoryRouter>
      <SellStart isAuthenticated={false} garageState="idle" garageVehicles={[]} hasLocalDraft={false} onResolve={onResolve} vehicleAction={action} {...props} />
    </MemoryRouter>,
  )
  return onResolve
}

describe('SellStart (RX04-D unified sell entry)', () => {
  it('leads with one VIN-first action and lets the Passport check classify the car', () => {
    const onResolve = renderStart()
    fireEvent.click(screen.getByTestId('sell-start-vin'))
    expect(onResolve).toHaveBeenCalledWith('vin_first')
  })

  it('keeps every original path reachable (known, new, sign in)', () => {
    const onResolve = renderStart()
    fireEvent.click(screen.getByTestId('sell-intent-known'))
    fireEvent.click(screen.getByTestId('sell-intent-new'))
    expect(onResolve).toHaveBeenNthCalledWith(1, 'known_vehicle')
    expect(onResolve).toHaveBeenNthCalledWith(2, 'new_vehicle')
    expect(screen.getByTestId('sell-intent-sign-in')).toHaveAttribute('href', '/login?returnTo=%2Fsell')
  })

  it('shows document scanning as coming — never as a working capability', () => {
    renderStart()
    const scan = screen.getByTestId('sell-start-scan')
    expect(scan).toHaveAttribute('data-capability-state', 'coming')
    expect(scan).toHaveTextContent('Coming to Seller Studio')
    expect(scan.querySelector('input[type="file"]')).toBeNull()
  })

  it('explains the whole flow through publication after evidence review', () => {
    renderStart()
    const how = screen.getByTestId('sell-start-how')
    expect(how).toHaveTextContent('Identify the car')
    expect(how).toHaveTextContent('After saving')
    expect(how).toHaveTextContent('Once CarUp has reviewed it, your listing can go live')
  })

  it('a signed-in owner sees Garage cars with what their Passport already carries (Trust fails closed when absent)', () => {
    const vehicle = { vin: 'VIN00000000000001', make: 'Toyota', model: 'Hilux', year: 2018, mileage: 120000, counts: { services: 3, verified_documents: 1, parts: null, active_insurance: null } } as unknown as Vehicle
    renderStart({ isAuthenticated: true, garageState: 'ready', garageVehicles: [vehicle] })
    const card = screen.getByTestId('sell-garage-vehicle-VIN00000000000001')
    expect(card).toHaveTextContent('Already on its Passport')
    expect(card).toHaveTextContent('3 service records')
    expect(card).toHaveTextContent('1 verified document')
    expect(card).toHaveTextContent('CarUp Trust: Trust assessment unavailable')
  })

  it('a Garage read failure is never presented as an empty Garage', () => {
    renderStart({ isAuthenticated: true, garageState: 'error' })
    expect(screen.getByTestId('sell-intent-garage')).toHaveTextContent('could not read your Garage')
    expect(screen.queryByText(/No car is recorded/)).toBeNull()
  })
})
