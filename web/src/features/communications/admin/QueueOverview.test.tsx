import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueueOverview, type QueueOverviewProps } from './QueueOverview'

function render(props: QueueOverviewProps) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueueOverview {...props} />
    </MemoryRouter>,
  )
}

describe('QueueOverview', () => {
  it('renders a deep-linkable card per queue and highlights non-empty backlogs', () => {
    const html = render({
      basePath: '/admin/communications',
      queues: [
        { value: 'unassigned', label: 'Unassigned', count: 7 },
        { value: 'awaiting_human', label: 'Needs human', count: 0 },
        { value: 'sla_breach', label: 'SLA breach', count: 3 },
      ],
    })
    expect(html).toContain('data-testid="queue-overview"')
    expect(html).toContain('data-testid="queue-card-unassigned"')
    expect(html).toContain('data-testid="queue-card-awaiting_human"')
    expect(html).toContain('data-testid="queue-card-sla_breach"')
    // Each card deep-links into the inbox filtered to that queue.
    expect(html).toContain('href="/admin/communications?filter=unassigned"')
    expect(html).toContain('href="/admin/communications?filter=sla_breach"')
    // Label + large count are shown.
    expect(html).toContain('Unassigned')
    expect(html).toContain('>7<')
    // Non-empty queues are highlighted; empty ones are not.
    expect(html).toMatch(/data-testid="queue-card-unassigned"[^>]*data-active="true"/)
    expect(html).not.toMatch(/data-testid="queue-card-awaiting_human"[^>]*data-active="true"/)
    // Header shows the total backlog (7 + 0 + 3).
    expect(html).toContain('>10<')
  })

  it('shows an empty state when no queues are configured', () => {
    const html = render({ basePath: '/admin/communications', queues: [] })
    expect(html).toContain('data-testid="queue-overview"')
    expect(html).toContain('data-testid="queue-overview-empty"')
    expect(html).toContain('No queues configured.')
    expect(html).not.toContain('data-testid="queue-card-')
  })
})
