/**
 * CA-K3-01 — Data & Intelligence landing (CA-UX-01 §17, CA-METRIC-01). Where management learns whether
 * a number can be trusted and what it means. Hosts the truth-state legend: every state's badge and
 * statement, with NO example values. Navigation intelligence and commercial behaviour stay separate;
 * AI/advisory output is labelled advisory and never an actual.
 */
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { MetricSlotView, TruthStateBadge } from '@/components/corporate/TruthState'
import { ProvenanceFreshness } from '@/components/corporate/ProvenanceFreshness'
import { ALL_TRUTH_STATES, TRUTH_STATES } from '@/lib/corporate/truthState'
import { NO_SOURCE, PENDING_K2B } from './shared'

export default function CorporateDataIntelligence() {
  return (
    <CorporatePage id="data-intelligence" intro="Metric definitions, sources, provenance, freshness and quality. A metric is active only when its source, semantics, window, provenance and certification are governed.">
      <Section title="Truth-state legend" description="How every Corporate figure declares what it is. Measured zero, no data, unavailable, not separable and restricted never look or read the same." testId="truth-state-legend">
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
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
                      <span className="mt-1 block font-mono text-[10px] font-normal text-slate-400">{s}</span>
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Metric Registry" testId="data-registry">
          <MetricSlotView label="Registered Corporate metrics" slot={NO_SOURCE} reason="The registry is defined (CA-METRIC-01) but not yet served to Corporate Admin." size="sm" />
        </Section>
        <Section title="Source & provenance" testId="data-provenance">
          <ProvenanceFreshness
            sourceAuthority="Operational-provenance authority (K2B) — accepted and frozen"
            provenance="pending_k2b_consumption"
            freshness="not_connected"
            sourceNote="Excluded and needs-review counts are reported by the authority itself; Corporate Admin never reclassifies rows."
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
