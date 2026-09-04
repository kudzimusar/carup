import { BadgeCheck, Database, FileSearch, ShieldCheck } from 'lucide-react'
import type { EvidenceSourcesResponse, EvidenceTaxonomyResponse } from '@/types'

export type HistoryEvidencePlanState = 'now' | 'later'
export type HistoryEvidencePlan = Record<string, HistoryEvidencePlanState>

const CLASS_COPY: Record<string, { title: string; description: string }> = {
  import: {
    title: 'Import & customs history',
    description: 'Export-yard, shipping, customs entry, duty/clearance and import-inspection records.',
  },
  auction: {
    title: 'Auction & source-market history',
    description: 'Auction sheets, grades, damage diagrams, mileage readings and source listing records.',
  },
  accident: {
    title: 'Accident, police & insurer records',
    description: 'Incident photos, police reports, insurer assessments, tow records and damage findings.',
  },
  repair: {
    title: 'Repair & body-work history',
    description: 'Before/during/after records, invoices, parts lists, structural repairs and mechanic certification.',
  },
  inspection: {
    title: 'Inspection & roadworthiness',
    description: 'Mechanical/chassis inspections, roadworthiness, emissions, tyres/brakes and odometer readings.',
  },
  ownership_transfer: {
    title: 'Ownership & transfer history',
    description: 'Registration/logbook evidence, sale agreements, transfer records and mileage/condition at handover.',
  },
  dealer_listing: {
    title: 'Previous listing & price history',
    description: 'Prior advert photos, seller descriptions, advertised mileage/condition, price history and source date.',
  },
  current_condition: {
    title: 'Current condition evidence',
    description: 'Exterior, interior, engine bay, underbody, tyres, dashboard, odometer, identifiers and current defects.',
  },
}

function humanClass(code: string) {
  return CLASS_COPY[code]?.title ?? code.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function statePillClass(state?: HistoryEvidencePlanState) {
  if (state === 'now') return 'bg-emerald-100 text-emerald-700'
  if (state === 'later') return 'bg-slate-200 text-slate-600'
  return 'bg-white text-slate-400 ring-1 ring-slate-200'
}

function actionClass(selected: boolean, selectedClass: string, hoverClass: string) {
  return selected
    ? 'rounded-xl px-3 py-2 text-xs font-black transition ' + selectedClass
    : 'rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition ' + hoverClass
}

export function VehicleHistoryCoveragePanel({
  taxonomy,
  sources,
  plan,
  onPlanChange,
  loading = false,
}: {
  taxonomy: EvidenceTaxonomyResponse | null
  sources: EvidenceSourcesResponse | null
  plan: HistoryEvidencePlan
  onPlanChange: (evidenceClass: string, state: HistoryEvidencePlanState) => void
  loading?: boolean
}) {
  const classes = taxonomy?.classes ?? []
  const planned = Object.values(plan)
  const readyNow = planned.filter(value => value === 'now').length
  const addLater = planned.filter(value => value === 'later').length
  const sourceRows = (sources?.sources ?? []).filter(source => source.active)

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6" data-testid="seller-history-coverage">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-orange-600" />
            <h3 className="text-base font-black">Vehicle history & source coverage</h3>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Optional now. Tell CarUp what records you already have, or leave them for later. If this VIN already has a CarUp
            Passport, existing governed history can be reused instead of asking you to re-enter it.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Evidence preparation</p>
          <p className="mt-1 text-lg font-black">{readyNow} ready now · {addLater} later</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Preparation only — not a Trust score.</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-orange-600" />
          <div>
            <p className="text-xs font-black text-slate-900">Government & partner source checks</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              CarUp can combine seller uploads with governed sources when a source is available. Source availability and authority
              are shown explicitly; a configured sandbox is never presented as a live government integration.
            </p>
          </div>
        </div>
        {sourceRows.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sourceRows.map(source => (
              <span key={source.id} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                {source.display_name}{source.verification_status !== 'verified' ? ' · ' + source.verification_status : ''}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Source registry unavailable in this preview. Seller evidence can still be added after account creation.</p>
        )}
        <div className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-[11px] leading-5 text-orange-950">
          <strong>ZIMRA papers:</strong> customs entry and duty / clearance documents belong to the canonical <em>Import</em> evidence class.
          Upload support does not imply a live direct ZIMRA connection.
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {loading && classes.length === 0 ? (
          <div className="lg:col-span-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Loading CarUp&apos;s evidence catalog…</div>
        ) : classes.map(group => {
          const meta = CLASS_COPY[group.evidence_class]
          const state = plan[group.evidence_class]
          return (
            <details key={group.evidence_class} className="group rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{humanClass(group.evidence_class)}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{meta?.description}</p>
                  </div>
                  <span className={'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ' + statePillClass(state)}>
                    {state === 'now' ? 'Have records' : state === 'later' ? 'Add later' : 'Optional'}
                  </span>
                </div>
              </summary>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {group.subtypes.map(subtype => (
                    <span key={subtype.subtype_code} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                      {subtype.label}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onPlanChange(group.evidence_class, 'now')}
                    aria-pressed={state === 'now'}
                    className={actionClass(state === 'now', 'bg-emerald-600 text-white', 'hover:ring-emerald-300')}
                  >
                    <BadgeCheck className="mr-1.5 inline h-3.5 w-3.5" /> I have records
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlanChange(group.evidence_class, 'later')}
                    aria-pressed={state === 'later'}
                    className={actionClass(state === 'later', 'bg-slate-700 text-white', 'hover:ring-slate-300')}
                  >
                    Add after account
                  </button>
                </div>
              </div>
            </details>
          )
        })}
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#0b1625] p-4 text-white">
        <FileSearch className="mt-0.5 h-5 w-5 flex-none text-orange-400" />
        <div>
          <p className="text-xs font-black">What can contribute to the vehicle story?</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            Import/customs records, auction history, ownership transfers, police/accident records, insurer assessments,
            repair invoices and parts, inspections, odometer readings, prior listings/price history and current-condition evidence.
            Only governed evidence can strengthen a verified claim.
          </p>
        </div>
      </div>
    </section>
  )
}
