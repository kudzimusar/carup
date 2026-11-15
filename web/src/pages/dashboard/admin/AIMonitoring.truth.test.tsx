import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

/**
 * RX-02 TI-06 — AI Monitoring must not present fixed figures as live operations data.
 *
 * On main the four KPI tiles were literals ('24.5K', '1.2s', '97.2%', '142') and both charts were
 * drawn from hard-coded series; only the model-status list read /api/admin/health. No endpoint
 * measures request volume, latency, accuracy or sessions, so those tiles and charts must say
 * "Not measured" rather than show numbers.
 */
vi.setConfig({ testTimeout: 30_000 })

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks. Stubbed so the page renders
// both before (charts) and after (not-measured states) the fix — the assertions decide, not a crash.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
}

const fetchServerHealth = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchServerHealth }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const AIMonitoring = (await import('./AIMonitoring')).default

const FABRICATED = ['24.5K', '1.2s', '97.2%', '142']
const TILES = ['Total Requests', 'Avg Response Time', 'Accuracy', 'Active Sessions']

beforeEach(() => { vi.clearAllMocks() })

describe('admin AIMonitoring — unmeasured operations figures (TI-06)', () => {
  it('renders no fabricated KPI and labels every unsourced tile "Not measured"', async () => {
    fetchServerHealth.mockResolvedValue([])
    render(<AIMonitoring />)
    await waitFor(() => expect(fetchServerHealth).toHaveBeenCalled())

    const page = document.body.textContent || ''
    for (const value of FABRICATED) expect(page, value).not.toContain(value)
    for (const label of TILES) {
      const tile = screen.getByTestId(`ai-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`)
      expect(within(tile).getByText(label)).toBeInTheDocument()
      expect(within(tile).getByText('Not measured')).toBeInTheDocument()
      expect(tile.textContent).not.toMatch(/\d/)
    }
  })

  it('replaces both hard-coded chart series with a not-measured state', async () => {
    fetchServerHealth.mockResolvedValue([])
    render(<AIMonitoring />)
    await waitFor(() => expect(fetchServerHealth).toHaveBeenCalled())

    const states = screen.getAllByTestId('data-state').filter(node => node.getAttribute('data-state') === 'not-measured')
    expect(states.map(node => node.textContent)).toEqual([
      expect.stringContaining('Request volume'),
      expect.stringContaining('Accuracy trend'),
    ])
  })

  it('a model with no recorded accuracy shows "Not measured", never 0%', async () => {
    fetchServerHealth.mockResolvedValue([{ name: 'Gutu', status: 'Operational' }])
    render(<AIMonitoring />)
    await screen.findByText('Gutu')
    expect(screen.queryByText('0%')).toBeNull()
    const row = screen.getByTestId('ai-model-Gutu')
    expect(within(row).getByText('Not measured')).toBeInTheDocument()
  })

  it('a model with a recorded accuracy still shows it', async () => {
    fetchServerHealth.mockResolvedValue([{ name: 'Gutu', status: 'Operational', accuracy: 91 }])
    render(<AIMonitoring />)
    expect(await screen.findByText('91%')).toBeInTheDocument()
  })
})
