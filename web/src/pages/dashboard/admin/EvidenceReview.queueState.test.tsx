/**
 * RX03-P2 (TI-13 / MP01 §22.8) — a refused or failed evidence-queue read must never render as an
 * empty queue with zero counts. The independent dealership reviewer reaches this workbench from the
 * reviewer rail; vehicle-evidence decisions stay admin/government-only on the server (403).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

function mockQueue(impl: () => Promise<unknown>) {
  vi.doMock('@/hooks/useCarUpApi', () => ({
    useCarUpApi: () => ({
      fetchEvidenceReviewQueue: impl,
      approveEvidence: vi.fn(),
      rejectEvidence: vi.fn(),
    }),
  }))
}
async function renderPage() {
  vi.resetModules()
  const { default: EvidenceReview } = await import('./EvidenceReview')
  return render(<MemoryRouter><EvidenceReview /></MemoryRouter>)
}
afterEach(() => vi.doUnmock('@/hooks/useCarUpApi'))

describe('EvidenceReview queue state truth', () => {
  it('403 shows a restricted notice, unknown counts and no "No pending evidence items" claim', async () => {
    mockQueue(() => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })))
    await renderPage()
    expect(await screen.findByTestId('evidence-review-forbidden')).toBeInTheDocument()
    expect(screen.queryByText(/No pending evidence items/)).toBeNull()
    expect(screen.getAllByText('Unknown')).toHaveLength(3)
  })

  it('a server failure shows "unknown, not zero" instead of an empty queue', async () => {
    mockQueue(() => Promise.reject(Object.assign(new Error('boom'), { status: 500 })))
    await renderPage()
    expect(await screen.findByTestId('evidence-review-load-failed')).toHaveTextContent('unknown, not zero')
    expect(screen.queryByText(/No pending evidence items/)).toBeNull()
  })

  it('a genuinely empty queue still says so, with zero counts', async () => {
    mockQueue(() => Promise.resolve([]))
    await renderPage()
    expect(await screen.findByText('No pending evidence items')).toBeInTheDocument()
    expect(screen.queryByTestId('evidence-review-forbidden')).toBeNull()
    expect(screen.queryByText('Unknown')).toBeNull()
  })
})
