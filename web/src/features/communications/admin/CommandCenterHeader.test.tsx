import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandCenterHeader } from './CommandCenterHeader'

describe('CommandCenterHeader', () => {
  it('shows the operational pills and worker/telegram/cron health', () => {
    const html = renderToStaticMarkup(
      <CommandCenterHeader
        openCount={5}
        unassigned={2}
        overdue={1}
        deadLetterCount={0}
        health={{
          queue: { depth: 3, oldest_queued_seconds: 12, sla_breaching: 1, sla_threshold_seconds: 60 },
          telegram: { provider: 'telegram_bot_api', mode: 'real', available: true },
          scheduler: { job_config: { schedule: '* * * * *' }, pg_cron_available: true },
        }}
      />,
    )
    expect(html).toContain('Open')
    expect(html).toContain('Unassigned')
    expect(html).toContain('SLA breach')
    expect(html).toContain('Telegram')
    expect(html).toContain('real')
    expect(html).toContain('Cron')
    expect(html).toContain('* * * * *')
  })

  it('renders a skeleton while worker health loads', () => {
    const html = renderToStaticMarkup(<CommandCenterHeader openCount={0} unassigned={0} overdue={0} deadLetterCount={0} health={null} />)
    expect(html).not.toContain('Telegram')
  })
})
