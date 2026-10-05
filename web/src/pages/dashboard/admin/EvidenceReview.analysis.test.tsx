import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * OC-5B — the reviewer sees what the analysis WAS. A confidence percentage appears only for an analysis
 * a provider actually executed; a simulation, a queued job or an analysis that never ran (no provider
 * configured) shows no number, and nothing frames it as a "fraud scan".
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const item = (id: string, ai_analysis: Record<string, unknown>) => ({
  id, vin: `VIN-${id}`, evidence_type: 'damage_photo', file_url: null, verification_status: 'pending', uploader_role: 'owner',
  uploaded_at: '2026-10-04T00:00:00Z', event_type: 'inspection', checksum: 'sha256:abc', trust_score_impact: 0, linked_registry_event_id: null,
  metadata: { ai_analysis },
})
const queue = [
  item('not-run', { ai_status: 'ai_not_configured', execution: 'not_run', provider: null, confidence: null, risk_score: null, recommended_action: 'inspect', reviewer_summary: 'No AI analysis: nothing examined this image.' }),
  item('simulated', { ai_status: 'ai_simulated', execution: 'simulated', provider: 'simulated', confidence: 0, risk_score: null, recommended_action: 'inspect', reviewer_summary: 'Simulated analysis only.' }),
  item('executed', { ai_status: 'ai_low_confidence', execution: 'provider_executed', provider: 'cloudflare', confidence: 0.82, risk_score: 0.2, recommended_action: 'inspect', reviewer_summary: 'Provider reading.' }),
]
// Every other call a child panel makes (extractions, …) answers an empty list.
const api = new Proxy({ fetchEvidenceReviewQueue: vi.fn().mockResolvedValue(queue) } as Record<string, unknown>, {
  get: (target, key: string) => (key in target ? target[key] : (target[key] = vi.fn().mockResolvedValue([]))),
})
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
const EvidenceReview = (await import('./EvidenceReview')).default

describe('EvidenceReview — analysis truthfulness (OC-5B)', () => {
  it('shows a confidence only for a provider-executed analysis; "not run" and "simulated" show none', async () => {
    const { container } = render(<MemoryRouter><EvidenceReview /></MemoryRouter>)
    expect(await screen.findByText('Not run — no AI provider configured')).toBeInTheDocument()
    expect(screen.getByText('No measured confidence')).toBeInTheDocument()
    expect(screen.getByText('Confidence: 82%')).toBeInTheDocument()
    expect(screen.getAllByText(/^Confidence: /)).toHaveLength(1)
    const text = container.textContent || ''
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('Fraud Scan')
    expect(screen.getAllByText('AI-assisted analysis (advisory)')).toHaveLength(3)
  })
})
