/**
 * CA-K3-01 — Operations landing (Business Operations plane; CA-UX-01 §15). Named queues only — no
 * overall operations health score. Each queue opens its existing operational surface; Corporate Admin
 * creates no generic mutation authority and copies no decision control here.
 */
import { CorporatePage, OperateLinks, Section } from '@/components/corporate/CorporatePage'
import { TruthStateBadge } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { presentSlot } from '@/lib/corporate/truthState'
import { K2B_PENDING_REASON, PENDING_K2B } from './shared'

const QUEUES = [
  { domain: 'Marketplace moderation', owner: 'Marketplace Operations' },
  { domain: 'Communications', owner: 'Customer Operations' },
  { domain: 'Garage onboarding', owner: 'Service Network' },
  { domain: 'Dealer compliance', owner: 'Compliance' },
  { domain: 'Trade / logistics', owner: 'Trade Operations' },
] as const
const MEASURES = ['Waiting', 'Aging', 'Throughput', 'Exceptions'] as const

export default function CorporateOperations() {
  return (
    <CorporatePage id="operations" intro="Cross-business-unit operating view over the workflows each unit owns. Queue counts are shown per named queue, never summed into one number.">
      <Section title="Queue summary by domain" description="A read failure is reported as such — it is never an empty queue." testId="operations-queues">
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Operational queues by domain and measure</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">Domain</th>
                {MEASURES.map((m) => <th key={m} scope="col" className="px-3 py-2 font-medium">{m}</th>)}
                <th scope="col" className="px-3 py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {QUEUES.map((q) => (
                <tr key={q.domain} className="border-b border-slate-100 last:border-b-0" data-testid="operations-queue-row">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium text-slate-900">{q.domain}</th>
                  {MEASURES.map((m) => {
                    const p = presentSlot(PENDING_K2B, `${q.domain} ${m}`)
                    return <td key={m} className="px-3 py-2.5" aria-label={p.accessibleText}><TruthStateBadge state={p.state} badge={p.badge} /></td>
                  })}
                  <td className="px-3 py-2.5 text-xs text-slate-600">{q.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">{K2B_PENDING_REASON}</p>
      </Section>
      <Section title="Work the queues" description="Decisions are made on the existing operational surfaces, which remain the authority for every action." testId="operations-operate">
        <OperateLinks links={OPERATE_LINKS.operations} from="business_operations" title="Operate — queues on the current operational Admin" />
      </Section>
    </CorporatePage>
  )
}
