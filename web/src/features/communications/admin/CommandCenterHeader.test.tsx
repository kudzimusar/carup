import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandCenterHeader } from './CommandCenterHeader'
import type { MetricsTruth } from '../conversationTruth'

const HEALTH = {
  queue: { depth: 3, oldest_queued_seconds: 12, sla_breaching: 1, sla_threshold_seconds: 60 },
  telegram: { provider: 'telegram_bot_api', mode: 'real', available: true },
  scheduler: { job_config: { schedule: '* * * * *' }, pg_cron_available: true },
}

const TRUTH: MetricsTruth = {
  available: true,
  total_open: 654,
  operational: { open: 4, awaiting_reply: 2, overdue: 1, live: 1, no_individual_assignee: 3, oldest_awaiting_since: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  needs_review: { open: 3, awaiting_reply: 1, overdue: 1, live: 0, no_individual_assignee: 3, oldest_awaiting_since: null },
  non_operational_open: 647,
  by_category: { operational: 4, needs_review: 3, certification: 600, automation: 40, historical: 7 },
  view_counts: { all: 654, active: 7, operational: 4, needs_review: 3, certification: 600, automation: 40, historical: 7 },
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('CommandCenterHeader (CA-OWNER-02 H2: the strip reads truth)', () => {
  it('shows operational work, needs-review apart, the filtered-out records, and worker/telegram/cron health', () => {
    const html = renderToStaticMarkup(<CommandCenterHeader truth={TRUTH} deadLetterCount={49} health={HEALTH} />)
    const t = text(html)
    expect(html).toContain('data-testid="cc-operational"')
    expect(t).toMatch(/Open 4/)
    expect(t).toMatch(/Awaiting reply 2/)
    expect(t).toMatch(/Overdue 1/)
    expect(t).toMatch(/No individual assignee 3/)
    expect(t).toMatch(/Oldest waiting 5h ago/)
    expect(html).toContain('data-testid="cc-needs-review"')
    expect(t).toMatch(/Needs provenance review 3 open · 1 awaiting reply/)
    expect(html).toContain('data-testid="cc-filtered-out"')
    expect(t).toMatch(/647 filtered out of the working inbox/)
    // Worker / provider health is unchanged.
    expect(html).toContain('SLA breach')
    expect(html).toContain('Telegram')
    expect(html).toContain('real')
    expect(html).toContain('Cron')
    expect(html).toContain('* * * * *')
  })

  it('never shows the legacy raw thread counts (654 open / 653 overdue)', () => {
    const t = text(renderToStaticMarkup(<CommandCenterHeader truth={TRUTH} deadLetterCount={49} health={HEALTH} />))
    expect(t).not.toMatch(/Open 654/)
    expect(t).not.toMatch(/Unassigned/)
  })

  it('labels dead-letter as a technical delivery figure, with its newest date', () => {
    const t = text(renderToStaticMarkup(<CommandCenterHeader truth={TRUTH} deadLetterCount={49} deadLetterLatestAt={new Date(Date.now() - 2 * 3_600_000).toISOString()} health={HEALTH} />))
    expect(t).toMatch(/Delivery dead-letters 49/)
    expect(t).toMatch(/newest 2h ago/)
  })

  it('shows "unavailable" — never 0 — when the truth could not be computed', () => {
    const html = renderToStaticMarkup(<CommandCenterHeader truth={{ available: false }} deadLetterCount={0} health={HEALTH} />)
    const t = text(html)
    expect(html).toContain('data-testid="cc-truth-unavailable"')
    expect(t).toMatch(/Conversation figures unavailable/)
    expect(html).not.toContain('data-testid="cc-operational"')
    expect(t).not.toMatch(/Overdue 0|Open 0/)
  })

  it('renders skeletons while the figures and worker health load', () => {
    const html = renderToStaticMarkup(<CommandCenterHeader truth={null} deadLetterCount={null} health={null} />)
    expect(html).toContain('data-testid="cc-truth-loading"')
    expect(html).not.toContain('Telegram')
    expect(text(html)).not.toMatch(/Overdue \d/)
  })
})
