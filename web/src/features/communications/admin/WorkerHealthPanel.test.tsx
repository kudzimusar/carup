import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkerHealthPanel } from './WorkerHealthPanel'

describe('WorkerHealthPanel', () => {
  it('renders queue, SLA, telegram and cron health', () => {
    const html = renderToStaticMarkup(
      <WorkerHealthPanel
        health={{
          queue: { depth: 3, oldest_queued_seconds: 12, sla_breaching: 1 },
          telegram: { provider: 'telegram_bot_api', mode: 'real', available: true },
          scheduler: { job_config: { schedule: '* * * * *' }, pg_cron_available: true },
        }}
        idlePollSeconds={30}
        deliveryPollSeconds={5}
      />,
    )
    expect(html).toContain('Worker')
    expect(html).toContain('Queue depth')
    expect(html).toContain('telegram_bot_api')
    expect(html).toContain('* * * * *')
    expect(html).toContain('Auto-refreshes')
  })

  it('shows pending cron when pg_cron is not active', () => {
    const html = renderToStaticMarkup(
      <WorkerHealthPanel health={{ queue: { depth: 0 }, telegram: null, scheduler: { pg_cron_available: false } }} />,
    )
    expect(html).toContain('pending')
  })
})
