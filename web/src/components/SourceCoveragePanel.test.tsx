import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SourceCoveragePanel } from './SourceCoveragePanel'
import type { SourceCoverageEntry } from '@/types'

function render(coverage: SourceCoverageEntry[]) {
  return renderToStaticMarkup(<SourceCoveragePanel vin="TESTVIN0000000001" initialData={coverage} />)
}

describe('SourceCoveragePanel', () => {
  it('renders a row for all five registries even when none checked', () => {
    const html = render([])
    for (const p of ['zimra', 'cvr', 'zinara', 'vid', 'cid']) {
      expect(html).toContain(`data-testid="source-row-${p}"`)
    }
  })

  it('shows "Not yet checked" for providers with no result', () => {
    const html = render([])
    expect(html).toContain('Not yet checked')
  })

  it('labels a sandbox result as a demonstration, NOT a live confirmation', () => {
    const html = render([
      { vin: 'TESTVIN0000000001', provider: 'zimra', mode: 'sandbox', coverage_status: 'sandbox_demonstration', retrieved_at: null },
    ])
    expect(html).toContain('Sandbox demo (not live)')
    expect(html).toContain('not live government API confirmations')
    expect(html).not.toContain('Source confirmed')
  })

  it('shows a live connected source as confirmed', () => {
    const html = render([
      { vin: 'TESTVIN0000000001', provider: 'cvr', mode: 'live', coverage_status: 'source_connected', retrieved_at: '2026-06-26T00:00:00Z' },
    ])
    expect(html).toContain('Source confirmed')
  })

  it('shows conflict and risk states distinctly', () => {
    const html = render([
      { vin: 'TESTVIN0000000001', provider: 'cvr', mode: 'sandbox', coverage_status: 'conflict_under_review', retrieved_at: null },
      { vin: 'TESTVIN0000000001', provider: 'cid', mode: 'sandbox', coverage_status: 'risk_flagged', retrieved_at: null },
    ])
    expect(html).toContain('Conflict — under review')
    expect(html).toContain('Risk flagged')
  })

  it('shows unavailable and no-record as distinct from confirmed', () => {
    const html = render([
      { vin: 'TESTVIN0000000001', provider: 'zinara', mode: 'unavailable', coverage_status: 'source_unavailable', retrieved_at: null },
      { vin: 'TESTVIN0000000001', provider: 'vid', mode: 'sandbox', coverage_status: 'no_record_found', retrieved_at: null },
    ])
    expect(html).toContain('Source unavailable')
    expect(html).toContain('No record found')
    expect(html).not.toContain('Source confirmed')
  })

  it('always shows the honesty disclaimer', () => {
    const html = render([])
    expect(html).toContain('never presents an unchecked or sandbox source as confirmed')
  })
})
