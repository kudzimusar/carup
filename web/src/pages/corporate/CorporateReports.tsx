/**
 * CA-K3-01 — Reports landing (CA-UX-01 §19). Establishes the report families and the governed
 * lifecycle. No report is generated or faked; no approval backend is implied. Generation is not
 * publication, and preparer, reviewer, approver and publisher may be different people.
 */
import { Ban, ChevronRight } from 'lucide-react'
import { CorporatePage, Section } from '@/components/corporate/CorporatePage'
import { CompactSlotList, TruthStateBadge } from '@/components/corporate/TruthState'
import { NO_SOURCE } from './shared'

const FAMILIES = [
  { name: 'Daily Operations', cadence: 'Daily' },
  { name: 'Weekly BU Review', cadence: 'Weekly' },
  { name: 'Monthly Executive Review', cadence: 'Monthly' },
  { name: 'Quarterly Board / Strategy', cadence: 'Quarterly' },
  { name: 'Compliance / Risk', cadence: 'Periodic' },
  { name: 'Ad-hoc governed report', cadence: 'On request' },
] as const
const LIFECYCLE = ['Draft', 'Generated', 'In Review', 'Approved', 'Published'] as const
// Accepted CA-REPORT-01 §7 exception / terminal states. Withdrawal is NOT among the available states:
// it stays disabled while Owner decision OD-CAREPORT-038 is unresolved (§7.10, fail-closed).
const EXCEPTIONS = ['Returned for Correction', 'Rejected', 'Superseded', 'Restated', 'Generation Failed'] as const
const WITHDRAWAL_OWNER_DECISION = 'OD-CAREPORT-038'

export default function CorporateReports() {
  return (
    <CorporatePage id="reports" intro="Management cadence and the governed report lifecycle. No report has been generated in this release.">
      <Section title="Due, in review and awaiting approval" testId="reports-strip">
        <CompactSlotList caption="Report workload" items={[
          { label: 'Reports due', slot: NO_SOURCE },
          { label: 'In review', slot: NO_SOURCE },
          { label: 'Awaiting approval', slot: NO_SOURCE },
        ]} />
      </Section>
      <Section title="Report lifecycle" description="Each step is a separate authority. Generation is not publication." testId="reports-lifecycle">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Report lifecycle stages">
          {LIFECYCLE.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800">{s}</span>
              {i < LIFECYCLE.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500" data-testid="report-exception-states">Exception and terminal states: {EXCEPTIONS.join(' · ')}.</p>
        <p
          className="inline-flex flex-wrap items-center gap-2 rounded border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
          data-testid="report-withdrawal-policy"
          aria-disabled="true"
        >
          <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
            <Ban className="h-3 w-3" aria-hidden="true" /> Disabled
          </span>
          <span><span className="font-medium text-slate-700 line-through decoration-slate-400">Withdrawn</span> — disabled pending Owner policy ({WITHDRAWAL_OWNER_DECISION}). Withdrawal is not an available transition.</span>
        </p>
      </Section>
      <Section title="Report families" testId="reports-families">
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {FAMILIES.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid="report-family">
              <span>
                <span className="block text-sm font-medium text-slate-900">{f.name}</span>
                <span className="block text-xs text-slate-500">{f.cadence}</span>
              </span>
              <TruthStateBadge state="NO_DATA" badge="No reports yet" />
            </li>
          ))}
        </ul>
      </Section>
    </CorporatePage>
  )
}
