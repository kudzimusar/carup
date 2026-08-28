/**
 * Institutional portal — CarUp Intelligence I15.
 *
 * The duty estimator is the only thing on this page that ever talked to a server,
 * and its fabricated seed was hiding a real defect: the API returns VAT under
 * `breakdown.vat`, so the first genuine calculation left the top-level field
 * undefined. The page only looked correct because the invented seed had the field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import GovernmentDashboard from './GovernmentDashboard'

const fetchZimraDuty = vi.fn()
const fetchGovernmentProvenance = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchZimraDuty, fetchGovernmentProvenance }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const renderPage = () => render(<MemoryRouter><GovernmentDashboard /></MemoryRouter>)

beforeEach(() => {
  fetchZimraDuty.mockReset()
  fetchGovernmentProvenance.mockReset()
  fetchGovernmentProvenance.mockRejectedValue(new Error('not under test here'))
})

describe('nothing is asserted before a calculation runs', () => {
  it('shows no duty figure on load', async () => {
    renderPage()
    expect(await screen.findByTestId('duty-estimate-idle')).toBeInTheDocument()
    expect(screen.queryByTestId('duty-estimate-result')).toBeNull()
    expect(fetchZimraDuty).not.toHaveBeenCalled()
  })

  it('says the estimate is not an assessment, before the inputs', async () => {
    renderPage()
    expect(await screen.findByTestId('duty-estimate-basis')).toHaveTextContent(/not an assessment/i)
    expect(screen.getByTestId('duty-estimate-basis')).toHaveTextContent(/not connected to any revenue authority/i)
  })
})

describe('a real calculation renders the real response shape', () => {
  it('reads VAT from the breakdown rather than the top level', async () => {
    // Exactly what the API returns: VAT lives under `breakdown`.
    fetchZimraDuty.mockResolvedValue({
      vehiclePrice: 10000,
      vehicleAge: 9,
      breakdown: { customsDuty: 4000, surtax: 3500, vat: 2625 },
      totalDuty: 10125,
      percentageOfValue: 101.3,
    })
    renderPage()
    await userEvent.click(await screen.findByTestId('calculate-duty'))

    await waitFor(() => expect(screen.getByTestId('duty-estimate-result')).toBeInTheDocument())
    expect(screen.getByTestId('duty-total')).toHaveTextContent('$10,125')
    expect(screen.getByTestId('duty-vat')).toHaveTextContent('$2,625')
    expect(screen.getByTestId('duty-percent')).toHaveTextContent('101.3%')
  })

  it('says a missing figure is not reported rather than crashing', async () => {
    fetchZimraDuty.mockResolvedValue({ totalDuty: 500, percentageOfValue: 5, breakdown: {} })
    renderPage()
    await userEvent.click(await screen.findByTestId('calculate-duty'))
    await waitFor(() => expect(screen.getByTestId('duty-vat')).toHaveTextContent(/not reported/i))
  })

  it('a failed calculation shows no figure at all', async () => {
    fetchZimraDuty.mockRejectedValue(new Error('down'))
    renderPage()
    await userEvent.click(await screen.findByTestId('calculate-duty'))
    await waitFor(() => expect(screen.getByTestId('duty-estimate-failed')).toBeInTheDocument())
    expect(screen.queryByTestId('duty-estimate-result')).toBeNull()
  })
})

describe('no national or officer claim survives', () => {
  it('renders no registry totals, officer log or enforcement banner', async () => {
    renderPage()
    await screen.findByTestId('duty-estimate-idle')
    const page = document.body.textContent || ''
    for (const claim of ['1.2M', 'Chihuri', 'fully enforced', 'CBZ', 'Monthly Registrations']) {
      expect(page).not.toContain(claim)
    }
  })
})
