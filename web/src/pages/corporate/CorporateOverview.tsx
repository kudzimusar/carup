/**
 * CA-K3-01 — Corporate Overview: the visual hierarchy only (CA-UX-01 §11, sections A–I). No live
 * number appears: no Corporate source path is yet certified, so every slot states why it is blocked.
 * Strategic blocked slots stay visible with their reason; nothing is filled to look complete.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { MetricSlotView } from '@/components/corporate/TruthState'
import { ProvenanceFreshness } from '@/components/corporate/ProvenanceFreshness'
import { BUSINESS_UNITS, CA_FIN_REASON, K2B_PENDING_REASON, NO_SOURCE, NO_SOURCE_REASON, PENDING_FIN, PENDING_K2B } from './shared'

function DestinationLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-[40px] items-center gap-1 rounded text-sm font-medium text-slate-800 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500">
      {children} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  )
}

export default function CorporateOverview() {
  return (
    <CorporatePage
      id="overview"
      intro="The company-wide view. In this foundation release no Corporate metric source is certified yet, so every position below states its truth instead of showing a number."
    >
      <Section label="A" title="Executive state" description="At most a handful of high-confidence positions. None is certified for Corporate use yet." testId="overview-state-band">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricSlotView label="Operational accounts (not customers)" slot={PENDING_K2B} reason={K2B_PENDING_REASON} size="lg" />
          <MetricSlotView label="Published Marketplace listings" slot={PENDING_K2B} reason={K2B_PENDING_REASON} size="lg" />
          <MetricSlotView label="Marketplace inquiries" slot={PENDING_K2B} reason={K2B_PENDING_REASON} size="lg" />
          <MetricSlotView label="Named review queues awaiting work" slot={PENDING_K2B} reason="Shown per queue, never summed into one risk number. Source path not yet certified." size="lg" />
        </div>
      </Section>

      <Section label="B" title="Business unit landscape" description="The four proposed management units. They are management constructs, not legal entities." testId="overview-bu-landscape">
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          {BUSINESS_UNITS.map((bu) => (
            <div key={bu.id} className="grid grid-cols-1 gap-3 border-b border-slate-100 p-3 last:border-b-0 md:grid-cols-[minmax(0,14rem)_1fr]">
              <div>
                <p className="text-sm font-semibold text-slate-900">{bu.name}</p>
                <p className="text-[11px] text-slate-500">Proposed BU · legal status unknown</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <MetricSlotView label="Demand" slot={PENDING_K2B} size="sm" />
                <MetricSlotView label="Throughput" slot={PENDING_K2B} size="sm" />
                <MetricSlotView label="Finance" slot={PENDING_FIN} size="sm" />
              </div>
            </div>
          ))}
        </div>
        <DestinationLink to="/corporate/business-units">Compare Business Units</DestinationLink>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section label="C" title="Demand & growth picture" description="Each demand signal stays separately named. Accounts are not customers; inquiries are not sales." testId="overview-demand">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricSlotView label="Recorded searches" slot={PENDING_K2B} size="sm" />
            <MetricSlotView label="Unmet recorded search demand (zero results)" slot={PENDING_K2B} size="sm" />
            <MetricSlotView label="Trade requests" slot={PENDING_K2B} size="sm" />
            <MetricSlotView label="Service requests" slot={PENDING_K2B} size="sm" />
          </div>
          <DestinationLink to="/corporate/growth">Open Customers & Growth</DestinationLink>
        </Section>

        <Section label="E" title="Operations state" description="Backlog, throughput and cycle time per named queue. No overall operations health score." testId="overview-operations">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricSlotView label="Queue backlog" slot={PENDING_K2B} size="sm" />
            <MetricSlotView label="Cycle time" slot={NO_SOURCE} size="sm" reason={NO_SOURCE_REASON} />
          </div>
          <DestinationLink to="/corporate/operations">Open Operations (Business Operations plane)</DestinationLink>
        </Section>

        <Section label="D" title="Finance position" testId="overview-finance">
          <StatementPanel tone="blocked">Corporate accounting system of record not yet established.</StatementPanel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricSlotView label="Recognized revenue" slot={PENDING_FIN} size="sm" />
            <MetricSlotView label="Gross profit" slot={PENDING_FIN} size="sm" />
            <MetricSlotView label="Cash" slot={PENDING_FIN} size="sm" />
            <MetricSlotView label="Receivables / payables" slot={PENDING_FIN} size="sm" reason={CA_FIN_REASON} />
          </div>
          <DestinationLink to="/corporate/finance">Open Finance</DestinationLink>
        </Section>

        <Section label="F" title="Trust / Risk / Compliance" description="Named queues and their aging — never one combined trust percentage." testId="overview-trust">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricSlotView label="Verification backlog" slot={PENDING_K2B} size="sm" />
            <MetricSlotView label="Evidence backlog" slot={PENDING_K2B} size="sm" />
          </div>
          <DestinationLink to="/corporate/trust-risk">Open Trust / Risk / Compliance</DestinationLink>
        </Section>
      </div>

      <Section label="G" title="Geography" description="Shown only when an authoritative geography type is selected. None is available yet." testId="overview-geography">
        <MetricSlotView label="Geographic view" slot={NO_SOURCE} reason="No governed geography dimension exists for Corporate scope yet; geography is never inferred from addresses or trade corridors." size="sm" />
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricSlotView label="Reports due" slot={NO_SOURCE} size="sm" />
            <MetricSlotView label="Access reviews due" slot={NO_SOURCE} size="sm" />
          </div>
        </Section>
      </div>
    </CorporatePage>
  )
}
