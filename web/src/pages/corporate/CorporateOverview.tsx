/**
 * CA-OWNER-02 — Corporate Overview: the actionable company view, read from the server's management read model.
 *
 * Order is the management order (CA-OWNER-02 §L): what needs a decision → the business and operational position → risk,
 * exceptions and queues → platform health → recent change; data quality and what cannot be shown yet stay visible lower down.
 * Every figure states its source, as-of time, scope and truth state; a figure that could not be read says so and is never 0.
 */
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { NEEDS_ATTENTION_ANCHOR } from '@/lib/corporate/managementReadStatus'
import { CorporatePage, Section } from '@/components/corporate/CorporatePage'
import { StateFootnotes, TruthStateBadge } from '@/components/corporate/TruthState'
import { AttentionList, EnvironmentNote, FactGrid, FactRows, ManagementStatus, QueueCard, UnavailableMeasures } from '@/components/corporate/ManagementFacts'
import { formatAsOf } from '@/lib/corporate/factFormat'
import { useManagementArea } from '@/lib/corporate/useManagementArea'
import { presentSlot, type MetricSlot } from '@/lib/corporate/truthState'
import { BUSINESS_UNITS, BU_NOT_ATTRIBUTED, PENDING_FIN } from './shared'

function DestinationLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-[44px] items-center gap-1 rounded text-sm font-medium text-slate-800 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500">
      {children} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  )
}

const BU_MEASURES: Array<{ label: string; slot: MetricSlot }> = [
  { label: 'Demand', slot: BU_NOT_ATTRIBUTED },
  { label: 'Throughput', slot: BU_NOT_ATTRIBUTED },
  { label: 'Finance', slot: PENDING_FIN },
]

function BusinessUnitLandscape() {
  return (
    <Section title="Business unit landscape" description="The four accepted management Business Units — management constructs, not legal entities. Labels remain provisional. Live figures above are company-wide: no record carries an accepted business-unit attribution yet, so none is split by unit." testId="overview-bu-landscape">
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
                  <span className="block text-[11px] font-normal text-slate-500" data-testid="bu-status">Accepted management BU · legal status not asserted</span>
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
        <StateFootnotes states={['UNAVAILABLE_NOT_SEPARABLE', 'PENDING_CA_FIN']} />
      </div>
      <DestinationLink to="/corporate/business-units">Compare Business Units</DestinationLink>
    </Section>
  )
}

export default function CorporateOverview() {
  const { result, retry, revalidating } = useManagementArea('overview')
  const data = result.status === 'ok' ? result.payload : null
  const { hash } = useLocation()
  // CA-OWNER-02-R3 (D1): the header's "Open Needs attention" lands on the section once the figures are on screen.
  useEffect(() => {
    if (!data || hash !== `#${NEEDS_ATTENTION_ANCHOR}`) return
    document.getElementById(NEEDS_ATTENTION_ANCHOR)?.scrollIntoView?.({ block: 'start' })
  }, [data, hash])

  return (
    <CorporatePage
      id="overview"
      intro="The company-wide view, read live from CarUp's own records. What needs a decision comes first; every figure says where it came from, when it was read and what it covers."
    >
      {!data && <ManagementStatus result={result} onRetry={retry} />}
      {data && (
        <>
          <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} snapshot={data.snapshot} revalidating={revalidating} />

          <Section label="1" title="Needs attention" description="Ordered by kind, then by how long work has waited. Each item names the rule that put it here and the operational surface where it is worked." testId="overview-attention" anchorId={NEEDS_ATTENTION_ANCHOR}>
            <AttentionList items={data.attention} />
          </Section>

          <Section label="2" title="Business & operational position" description="Corporate governance records, then live marketplace, trade and service activity. Accounts are not customers; inquiries are not sales." testId="overview-position">
            <FactGrid facts={data.sections.governance} size="lg" className="xl:grid-cols-2" />
            <FactGrid facts={data.sections.business} />
          </Section>

          <Section label="3" title="Risk, exceptions & queues" description="Customer conversations and every named review queue, separately — never one combined risk or trust score." testId="overview-queues">
            <FactRows facts={data.sections.communications} caption="Customer conversations" />
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Named queues">
              {data.sections.queues.map((q) => <QueueCard key={q.id} queue={q} />)}
            </ul>
            <div className="flex flex-wrap gap-x-6">
              <DestinationLink to="/corporate/operations">Open Operations</DestinationLink>
              <DestinationLink to="/corporate/trust-risk">Open Trust / Risk / Compliance</DestinationLink>
            </div>
          </Section>

          <Section label="4" title="Platform health" description="Technical facts about this deployment — not business performance." testId="overview-platform">
            <FactRows facts={data.sections.platform} caption="Platform health" />
            <DestinationLink to="/corporate/platform">Open Platform</DestinationLink>
          </Section>

          <Section label="5" title="Recent change" description="What arrived in the last seven days, each over its own stated window." testId="overview-recent">
            <FactGrid facts={data.sections.recent} size="sm" />
            <DestinationLink to="/corporate/growth">Open Customers & Growth</DestinationLink>
          </Section>

          <BusinessUnitLandscape />

          <Section label="6" title="Data quality & sources" testId="overview-data">
            <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" data-testid="overview-data-summary">
              Of the measures registered for Corporate Admin, <strong className="tabular-nums">{data.sections.data.usable}</strong> read from a live source,{' '}
              <strong className="tabular-nums">{data.sections.data.degraded}</strong> could not be read completely and{' '}
              <strong className="tabular-nums">{data.sections.data.unavailable}</strong> have no authority or source yet.
              <span className="mt-1 block text-[11px] text-slate-500">Source: Corporate metric &amp; source registry projection · As of {formatAsOf(data.generatedAt)}</span>
            </p>
            <DestinationLink to="/corporate/data-intelligence">Open Data & Intelligence</DestinationLink>
          </Section>

          <Section label="7" title="Not available yet" description="Kept visible because they matter. Each is unavailable — not zero — for the reason given." testId="overview-unavailable">
            <UnavailableMeasures items={data.unavailable} />
          </Section>
        </>
      )}
      {!data && <BusinessUnitLandscape />}
    </CorporatePage>
  )
}
