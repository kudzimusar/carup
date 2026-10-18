/**
 * CA-K3-01 — Data & Intelligence landing (CA-UX-01 §17, CA-METRIC-01). Where management learns whether
 * a number can be trusted and what it means. Hosts the truth-state legend: every state's badge and
 * statement, with NO example values. Navigation intelligence and commercial behaviour stay separate;
 * AI/advisory output is labelled advisory and never an actual.
 */
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { MetricSlotView, TruthStateBadge } from '@/components/corporate/TruthState'
import { ProvenanceFreshness } from '@/components/corporate/ProvenanceFreshness'
import { ManagementStatus, formatAsOf } from '@/components/corporate/ManagementFacts'
import { useManagementArea } from '@/lib/corporate/useManagementArea'
import type { RegistryRow } from '@/lib/corporate/management'
import { ALL_TRUTH_STATES, TRUTH_STATES } from '@/lib/corporate/truthState'
import { PENDING_K2B } from './shared'

const REGISTRY_LABEL = 'Metric and source registry'

function RegistryTable({ rows }: { rows: readonly RegistryRow[] }) {
  return (
    <div
      className="overflow-x-auto rounded-md border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
      tabIndex={0}
      role="region"
      aria-label={REGISTRY_LABEL}
      data-testid="registry-scroll-region"
    >
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <caption className="sr-only">{REGISTRY_LABEL}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 font-medium">Measure</th>
            <th scope="col" className="px-3 py-2 font-medium">State</th>
            <th scope="col" className="px-3 py-2 font-medium">Source</th>
            <th scope="col" className="px-3 py-2 font-medium">As of</th>
            <th scope="col" className="px-3 py-2 font-medium">Provenance</th>
            <th scope="col" className="px-3 py-2 font-medium">May be used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const badge = r.state === 'TECHNICAL_OPERATIONAL' ? (r.kind === 'technical' ? 'Technical' : 'Operational') : undefined
            return (
              <tr key={r.id} className="border-b border-slate-100 align-top last:border-b-0" data-testid="registry-row" data-measure-id={r.id} data-usable={r.usable ? 'true' : 'false'} data-truth-state={r.state}>
                <th scope="row" className="px-3 py-2 text-left">
                  <span className="block font-medium text-slate-900">{r.label}</span>
                  <span className="block font-mono text-[10px] font-normal text-slate-600">{r.id}</span>
                </th>
                <td className="px-3 py-2"><TruthStateBadge state={r.state} badge={badge} /></td>
                <td className="max-w-[240px] px-3 py-2 text-xs text-slate-700">{r.source ?? 'No source'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{formatAsOf(r.asOf) ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-700">{r.provenance}</td>
                <td className="max-w-[280px] px-3 py-2 text-xs text-slate-700">
                  <span className="font-medium text-slate-900">{r.usable ? 'Yes — live operational read' : 'No'}</span>
                  {r.reason && <span className="mt-0.5 block text-slate-600">{r.reason}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function CorporateDataIntelligence() {
  const { result, retry } = useManagementArea('data-sources')
  const registry = result.status === 'ok' ? { status: 'ok' as const, payload: result.payload } : { status: 'other' as const, result, retry }
  return (
    <CorporatePage id="data-intelligence" intro="Metric definitions, sources, provenance, freshness and quality. A metric is active only when its source, semantics, window, provenance and certification are governed.">
      <Section title="Truth-state legend" description="How every Corporate figure declares what it is. Measured zero, no data, unavailable, not separable and restricted never look or read the same." testId="truth-state-legend">
        {/* CA-K3-01-R3 D-4: at narrow widths this table scrolls horizontally, so its scroll region is a
            focusable, labelled region (keyboard users can reach and scroll it). The caption stays. */}
        <div
          className="overflow-x-auto rounded-md border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
          tabIndex={0}
          role="region"
          aria-label="Truth states, what each shows, and what each means"
          data-testid="legend-scroll-region"
        >
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">Truth states, what each shows, and what each means</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">State</th>
                <th scope="col" className="px-3 py-2 font-medium">Shows</th>
                <th scope="col" className="px-3 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ALL_TRUTH_STATES.map((s) => {
                const spec = TRUTH_STATES[s]
                return (
                  <tr key={s} className="border-b border-slate-100 align-top last:border-b-0" data-testid="legend-row" data-truth-state={s}>
                    <th scope="row" className="px-3 py-2 text-left">
                      <TruthStateBadge state={s} />
                      <span className="mt-1 block font-mono text-[10px] font-normal text-slate-600" data-testid="legend-state-id">{s}</span>
                    </th>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {spec.statement ?? (spec.rendersValue === 'yes' ? (s === 'MEASURED_ZERO' ? 'The number 0, from a complete read' : 'A governed value') : '')}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{spec.meaning}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Metric & source registry"
        description="Every measure Corporate Admin serves, and every measure it deliberately does not: where it comes from, its state and read time, how provenance applies, and whether it may be used. Live rows are operational reads — none is certified as a Corporate business Actual."
        testId="data-registry"
      >
        {registry.status === 'ok' ? <RegistryTable rows={registry.payload.registry} /> : <ManagementStatus result={registry.result} onRetry={registry.retry} />}
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Source & provenance" testId="data-provenance">
          <ProvenanceFreshness
            sourceAuthority="Operational-provenance authority (K2B) — accepted and frozen"
            provenance="pending_k2b_consumption"
            freshness={registry.status === 'ok' ? 'current' : 'unavailable'}
            sourceNote="Corporate read models apply the K2B classifier to each record and report the excluded and needs-review counts exactly as the authority returns them; Corporate Admin never reclassifies rows. This consumption is not yet certified."
          />
        </Section>
        <Section title="Navigation Intelligence" description="Rendered routes and discoverability — not users, and never merged with commercial behaviour." testId="data-navigation">
          <MetricSlotView label="Navigation event coverage" slot={PENDING_K2B} reason="A window that reaches the source row cap is degraded and its rankings are not certifiable." size="sm" />
        </Section>
        <Section title="Commercial behaviour" description="Marketplace and commercial events, kept separate from navigation." testId="data-commercial">
          <MetricSlotView label="Commercial event coverage" slot={PENDING_K2B} size="sm" />
        </Section>
      </div>

      <Section title="Advisory / AI intelligence" description="Separately labelled. Advisory output never becomes an actual and never fills an unavailable figure." testId="data-advisory">
        <StatementPanel>
          <span className="inline-flex flex-wrap items-center gap-2"><TruthStateBadge state="ADVISORY" /> No advisory output is shown on Corporate pages in this release.</span>
        </StatementPanel>
      </Section>
    </CorporatePage>
  )
}
