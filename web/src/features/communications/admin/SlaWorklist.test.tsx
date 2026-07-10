import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SlaWorklist, type SlaWorklistThread } from './SlaWorklist'

const noop = () => {}

describe('SlaWorklist', () => {
  it('renders the summary and orders threads breached → due_soon → others', () => {
    const threads: SlaWorklistThread[] = [
      { id: 'h1', title: 'Healthy thread', channel: 'email', slaState: 'healthy' },
      { id: 'b1', title: 'Breached thread', channel: 'whatsapp', slaState: 'breached', reference: 'LST-1', slaLabel: 'Overdue 10m' },
      { id: 'd1', title: 'Due thread', channel: 'telegram', slaState: 'due_soon' },
    ]
    const html = renderToStaticMarkup(
      <SlaWorklist threads={threads} counts={{ breached: 1, due_soon: 1, healthy: 1, paused: 0 }} onOpen={noop} />,
    )
    expect(html).toContain('data-testid="sla-worklist"')
    expect(html).toContain('data-testid="sla-summary"')
    expect(html).toContain('SLA worklist')

    // Row content: title + reference + channel + the SLA label (badge).
    expect(html).toContain('Breached thread')
    expect(html).toContain('LST-1')
    expect(html).toContain('Overdue 10m')
    expect(html).toContain('data-channel="whatsapp"')

    // Per-row markers.
    expect(html).toContain('data-testid="sla-row"')
    expect(html).toContain('data-sla-state="breached"')
    expect(html).toContain('data-sla-state="due_soon"')
    expect(html).toContain('data-sla-state="healthy"')

    // Ordering: breached before due_soon before the rest.
    const iBreached = html.indexOf('data-sla-state="breached"')
    const iDue = html.indexOf('data-sla-state="due_soon"')
    const iHealthy = html.indexOf('data-sla-state="healthy"')
    expect(iBreached).toBeLessThan(iDue)
    expect(iDue).toBeLessThan(iHealthy)
  })

  it('falls back to the state label when no slaLabel is given, and title-cases unknown states', () => {
    const html = renderToStaticMarkup(
      <SlaWorklist
        threads={[
          { id: 'a', title: 'No label', slaState: 'due_soon' },
          { id: 'b', title: 'Odd state', slaState: 'custom_hold' },
        ]}
        onOpen={noop}
      />,
    )
    expect(html).toContain('Due soon')
    expect(html).toContain('Custom Hold')
    expect(html).toContain('data-sla-state="custom_hold"')
  })

  it('derives the summary counts from the threads when counts are not provided', () => {
    const html = renderToStaticMarkup(
      <SlaWorklist
        threads={[
          { id: 'a', title: 'A', slaState: 'breached' },
          { id: 'b', title: 'B', slaState: 'breached' },
          { id: 'c', title: 'C', slaState: 'paused' },
        ]}
        onOpen={noop}
      />,
    )
    // Two breached derived from the threads.
    expect(html).toContain('data-testid="sla-summary-breached"')
    expect(html).toContain('data-count="2"')
    // One paused, none due-soon.
    expect(html).toMatch(/data-testid="sla-summary-paused" data-count="1"/)
    expect(html).toMatch(/data-testid="sla-summary-due_soon" data-count="0"/)
  })

  it('shows the empty state (summary still visible, no rows)', () => {
    const html = renderToStaticMarkup(<SlaWorklist threads={[]} onOpen={noop} />)
    expect(html).toContain('No threads under SLA watch.')
    expect(html).toContain('data-testid="sla-summary"')
    expect(html).not.toContain('data-testid="sla-row"')
  })

  it('shows the loading state without rows or the empty message', () => {
    const html = renderToStaticMarkup(<SlaWorklist threads={[]} onOpen={noop} loading />)
    expect(html).toContain('Loading SLA worklist…')
    expect(html).not.toContain('data-testid="sla-row"')
    expect(html).not.toContain('No threads under SLA watch.')
  })
})
