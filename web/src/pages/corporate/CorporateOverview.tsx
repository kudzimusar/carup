/**
 * CA-K3-01 — Corporate Overview: the visual hierarchy only (CA-UX-01 §11, sections A–I). No live
 * number appears: no Corporate source path is yet certified, so every position states its truth.
 * Strategic blocked slots stay visible with their reason; nothing is filled to look complete, and each
 * state is explained once per section rather than repeated on every slot.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { CompactSlotList, MetricSlotView, StateFootnotes, TruthStateBadge } from '@/components/corporate/TruthState'
import { ProvenanceFreshness } from '@/components/corporate/ProvenanceFreshness'
import { presentSlot, type MetricSlot } from '@/lib/corporate/truthState'
import { BUSINESS_UNITS, K2B_PENDING_REASON, NO_SOURCE, PENDING_FIN, PENDING_K2B } from './shared'

function DestinationLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-[40px] items-center gap-1 rounded text-sm font-medium text-slate-800 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500">
      {children} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  )
}

const BU_MEASURES: Array<{ label: string; slot: MetricSlot }> = [
  { label: 'Demand', slot: PENDING_K2B },
  { label: 'Throughput', slot: PENDING_K2B },
  { label: 'Finance', slot: PENDING_FIN },
]

export default function CorporateOverview() {
  return (
    <CorporatePage
      id="overview"
      intro="The company-wide view. In this foundation release no Corporate metric source is certified yet, so every position below states its truth instead of showing a number."
    >
      <Section label="A" title="Executive state" description="At most a handful of high-confidence positions. None is certified for Corporate use yet." testId="overview-state-band">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricSlotView label="Operational accounts (not customers)" slot={PENDING_K2B} size="lg" />
          <MetricSlotView label="Published Marketplace listings" slot={PENDING_K2B} size="lg" />
          <MetricSlotView label="Marketplace inquiries" slot={PENDING_K2B} size="lg" />
          <MetricSlotView label="Named review queues awaiting work" slot={PENDING_K2B} size="lg" reason="Shown per queue, never summed into one risk number." />
        </div>
        <p className="text-xs text-slate-500">{K2B_PENDING_REASON}</p>
      </Section>

      <Section label="B" title="Business unit landscape" description="The four proposed management units — management constructs, not legal entities." testId="overview-bu-landscape">
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Business unit landscape by measure and truth state</caption>
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">Business unit</th>
                {BU_MEASURES.map((m) => <th key={m.label} scope="col" className="px-3 py-2 font-medium">{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {BUSINESS_UNITS.map((bu) => (
                <tr key={bu.id} className="flex flex-col gap-1.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0 sm:table-row sm:px-0 sm:py-0">
                  <th scope="row" className="text-left sm:px-3 sm:py-2.5">
                    <span className="block font-semibold text-slate-900">{bu.name}</span>
                    <span className="block text-[11px] font-normal text-slate-500">Proposed · legal status unknown</span>
                  </th>
                  {BU_MEASURES.map((m) => {
                    const p = presentSlot(m.slot, `${bu.name} ${m.label}`)
                    return (
                      <td key={m.label} className="flex items-center justify-between gap-2 sm:table-cell sm:px-3 sm:py-2.5" aria-label={p.accessibleText} data-truth-state={p.state}>
                        <span className="text-xs text-slate-500 sm:hidden">{m.label}</span>
                        <TruthStateBadge state={p.state} badge={p.badge} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <StateFootnotes states={['PENDING_K2B_CONSUMPTION', 'PENDING_CA_FIN']} />
        </div>
        <DestinationLink to="/corporate/business-units">Compare Business Units</DestinationLink>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section label="C" title="Demand & growth picture" description="Each demand signal stays separately named. Accounts are not customers; inquiries are not sales." testId="overview-demand">
          <CompactSlotList caption="Demand signals" items={[
            { label: 'Recorded searches', slot: PENDING_K2B },
            { label: 'Unmet recorded search demand (zero results)', slot: PENDING_K2B },
            { label: 'Trade requests', slot: PENDING_K2B },
            { label: 'Service requests', slot: PENDING_K2B },
          ]} />
          <DestinationLink to="/corporate/growth">Open Customers & Growth</DestinationLink>
        </Section>

        <Section label="E" title="Operations state" description="Backlog, throughput and cycle time per named queue. No overall operations health score." testId="overview-operations">
          <CompactSlotList caption="Operations state" items={[
            { label: 'Queue backlog (per named queue)', slot: PENDING_K2B },
            { label: 'Throughput', slot: PENDING_K2B },
            { label: 'Cycle time', slot: NO_SOURCE },
          ]} />
          <DestinationLink to="/corporate/operations">Open Operations (Business Operations plane)</DestinationLink>
        </Section>

        <Section label="D" title="Finance position" testId="overview-finance">
          <StatementPanel tone="blocked">Corporate accounting system of record not yet established.</StatementPanel>
          <CompactSlotList caption="Finance position" items={[
            { label: 'Recognized revenue', slot: PENDING_FIN },
            { label: 'Gross profit', slot: PENDING_FIN },
            { label: 'Cash', slot: PENDING_FIN },
            { label: 'Receivables / payables', slot: PENDING_FIN },
          ]} />
          <DestinationLink to="/corporate/finance">Open Finance</DestinationLink>
        </Section>

        <Section label="F" title="Trust / Risk / Compliance" description="Named queues and their aging — never one combined trust percentage." testId="overview-trust">
          <CompactSlotList caption="Trust, risk and compliance queues" items={[
            { label: 'Verification backlog', slot: PENDING_K2B },
            { label: 'Evidence backlog', slot: PENDING_K2B },
            { label: 'Fraud cases (open and investigating)', slot: PENDING_K2B },
          ]} />
          <DestinationLink to="/corporate/trust-risk">Open Trust / Risk / Compliance</DestinationLink>
        </Section>
      </div>

      <Section label="G" title="Geography" description="Shown only when an authoritative geography type is selected. None is available yet; geography is never inferred from addresses or trade corridors." testId="overview-geography">
        <CompactSlotList caption="Geography" items={[{ label: 'Geographic view', slot: NO_SOURCE }]} />
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section label="H" title="Data quality & provenance" testId="overview-data-quality">
          <ProvenanceFreshness
            sourceAuthority="Operational-provenance authority (K2B) — accepted and frozen"
            freshness="not_connected"
            provenance="pending_k2b_consumption"
            sourceNote="No Corporate source path consumes the authority yet; excluded and needs-review populations will be shown here as the authority reports them."
          />
          <DestinationLink to="/corporate/data-intelligence">Open Data & Intelligence</DestinationLink>
        </Section>
        <Section label="I" title="Management actions" testId="overview-actions">
          <CompactSlotList caption="Management actions" items={[
            { label: 'Reports due', slot: NO_SOURCE },
            { label: 'Access reviews due', slot: NO_SOURCE },
            { label: 'Data source failures', slot: NO_SOURCE },
          ]} />
        </Section>
      </div>
    </CorporatePage>
  )
}
