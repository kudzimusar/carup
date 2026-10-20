/**
 * CA-OWNER-02 — Platform (Platform & Security plane; CA-UX-01 §20), read from the server's management read model.
 *
 * Technical governance only: build identity, environment, database consistency, session authority, the outbound kill switch,
 * the communications scheduler, providers and backlogs — each a Technical fact with its source and read time. No revenue,
 * customer growth, BU scorecard or business "health score" here, and platform authority does not imply Finance, People or
 * identity access. What has no source (uptime, certification sessions) says so.
 */
import { CorporatePage, OperateLinks, Section } from '@/components/corporate/CorporatePage'
import { EnvironmentNote, FactRows, ManagementStatus } from '@/components/corporate/ManagementFacts'
import { MetricSlotView } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { useManagementArea } from '@/lib/corporate/useManagementArea'
import { NO_SOURCE } from './shared'

const DELIVERY_IDS = new Set(['communications.notification.dead_letter', 'platform.outbox.backlog', 'platform.ledger_intent.backlog'])
const SESSION_IDS = new Set(['platform.certification_sessions'])

export default function CorporatePlatform() {
  const { result, retry, revalidating } = useManagementArea('platform')
  const data = result.status === 'ok' ? result.payload : null
  const runtime = data ? data.facts.filter((f) => !DELIVERY_IDS.has(f.id) && !SESSION_IDS.has(f.id)) : []
  const delivery = data ? data.facts.filter((f) => DELIVERY_IDS.has(f.id)) : []
  const sessions = data ? data.facts.filter((f) => SESSION_IDS.has(f.id)) : []
  return (
    <CorporatePage id="platform" intro="The technical platform: features, providers, AI/model operations, technical communications delivery, runtime and security. Nothing on this page is a measure of business performance.">
      {!data && <ManagementStatus result={result} onRetry={retry} />}
      {data && (
        <>
          <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} snapshot={data.snapshot} revalidating={revalidating} />
          <Section title="Runtime & security" description="This API deployment, read live." testId="platform-runtime">
            <FactRows facts={runtime} caption="Runtime and security facts" />
          </Section>
          <Section title="Delivery & backlogs" description="Work the platform has not finished. Dead letters are delivery failures, not customer outcomes." testId="platform-delivery">
            <FactRows facts={delivery} caption="Delivery and backlog facts" />
          </Section>
          <Section title="Communication providers" description="Configuration state as the runtime reports it. Secrets and endpoints are never shown." testId="platform-providers">
            {data.providers && data.providers.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500" tabIndex={0} role="region" aria-label="Communication providers and their configuration state">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Communication providers and their configuration state</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-3 py-2 font-medium">Channel</th>
                      <th scope="col" className="px-3 py-2 font-medium">Provider</th>
                      <th scope="col" className="px-3 py-2 font-medium">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.map((p) => (
                      <tr key={`${p.channel}-${p.provider}`} className="border-b border-slate-100 last:border-b-0" data-testid="provider-row">
                        <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900">{p.channel}</th>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{p.provider || '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-700">{p.status}{p.available ? ' · available' : ' · not available'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <MetricSlotView label="Communication providers" slot={{ state: 'UNKNOWN_AUTHORITY' }} reason="The runtime did not report its providers." size="sm" />
            )}
          </Section>
          <Section title="Sessions" testId="platform-sessions">
            <FactRows facts={sessions} caption="Session facts" />
          </Section>
        </>
      )}
      <Section title="Not measured" testId="platform-not-measured">
        <MetricSlotView label="Platform uptime / availability" slot={NO_SOURCE} reason="No governed availability source exists; seeded server-health rows are not uptime." size="sm" className="border-sky-100" />
      </Section>
      <OperateLinks links={OPERATE_LINKS.platform} from="platform_security" title="Administer — existing Platform & Security surfaces" />
    </CorporatePage>
  )
}
