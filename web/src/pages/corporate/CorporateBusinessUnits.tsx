/**
 * CA-K3-01 — Business Units landing (CA-UX-01 §12, CA-ORG-01, CA-BU-01). The four accepted management
 * Business Units (stable IDs), compared in one matrix. Legal status is not asserted; labels stay
 * provisional and future splits stay open where the Owner Decision Register says so (CA-K3-01-R1).
 * Finance is blocked in every row; nothing is summed into a synthetic score.
 */
import { CorporatePage, OperateLinks, Section } from '@/components/corporate/CorporatePage'
import { TruthStateBadge } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { presentSlot, type MetricSlot } from '@/lib/corporate/truthState'
import { BUSINESS_UNITS, CA_FIN_REASON, K2B_PENDING_REASON, PENDING_FIN, PENDING_K2B } from './shared'

const COLUMNS: Array<{ label: string; slot: MetricSlot }> = [
  { label: 'Demand', slot: PENDING_K2B },
  { label: 'Supply / capacity', slot: PENDING_K2B },
  { label: 'Throughput', slot: PENDING_K2B },
  { label: 'Backlog', slot: PENDING_K2B },
  { label: 'Risk', slot: PENDING_K2B },
  { label: 'Finance', slot: PENDING_FIN },
]

export default function CorporateBusinessUnits() {
  return (
    <CorporatePage
      id="business-units"
      intro="The four accepted management Business Units. They are management constructs for comparison — not legal entities or subsidiaries, and not P&L owners. Their management labels remain provisional (OD-CABU-001), and possible future splits remain open Owner decisions (OD-CABU-002 to 006)."
    >
      <Section
        title="Business unit comparison"
        description="One row per accepted management Business Unit. No combined score; inquiries, work orders and trade orders are never summed as transactions."
        testId="bu-comparison"
      >
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Business unit comparison by measure and truth state</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">Business unit</th>
                {COLUMNS.map((c) => <th key={c.label} scope="col" className="px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {BUSINESS_UNITS.map((bu) => (
                <tr key={bu.id} className="border-b border-slate-100 align-top last:border-b-0" data-testid="bu-row">
                  <th scope="row" className="px-3 py-3 text-left">
                    <span className="block font-semibold text-slate-900">{bu.name}</span>
                    <span className="block text-[11px] font-normal text-slate-500" data-testid="bu-status">Accepted management BU · provisional label · legal status not asserted</span>
                    <span className="mt-1 block text-[11px] font-normal text-slate-500">{bu.departments.join(' · ')}</span>
                  </th>
                  {COLUMNS.map((c) => {
                    const p = presentSlot(c.slot, `${bu.name} ${c.label}`)
                    return (
                      <td key={c.label} className="px-3 py-3" aria-label={p.accessibleText} data-truth-state={p.state}>
                        <TruthStateBadge state={p.state} badge={p.badge} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1 text-xs text-slate-500">
          <li><span className="font-medium text-slate-700">Pending provenance:</span> {K2B_PENDING_REASON}</li>
          <li><span className="font-medium text-slate-700">Pending finance authority:</span> {CA_FIN_REASON}</li>
        </ul>
      </Section>
      <OperateLinks links={OPERATE_LINKS['business-units']} from="corporate_intelligence" />
    </CorporatePage>
  )
}
