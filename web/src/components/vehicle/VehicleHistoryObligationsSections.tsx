import { Car, FileQuestion, Landmark, ShieldQuestion } from 'lucide-react'
import {
  ACCIDENT_STATE_LABELS,
  FINANCE_STATE_LABELS,
  FINANCE_TYPE_LABELS,
  INSURANCE_STATE_LABELS,
  type VehicleHistoryDisclosuresBlock,
} from '@/lib/vehicleHistoryDisclosures'

export type { VehicleHistoryDisclosuresBlock }

/**
 * Vehicle Detail §14 items 9–11 (K17–K19): Accident, damage & repair history · Insurance state ·
 * Finance, lease & title obligations.
 *
 * One component serves Buyer Preview and the public Marketplace identically (K20) — it renders
 * only the projected `history_disclosures` block, which is the same for every audience.
 *
 * Truth rules baked in (L27, INV-17):
 *   - the Seller's statement is labelled seller-stated and never dressed as verification;
 *   - an unanswered topic renders "Not recorded" — never "no accident" / "not insured" /
 *     "finance clear";
 *   - the governed half of each section states its own honest state ("appears in the history &
 *     evidence sections" / "no connected source") instead of borrowing the seller's words;
 *   - an active lender interest is presented as a transfer condition, not a reason to hide the
 *     listing (R23 posture).
 */

const ACCIDENT_EVENT_LABELS: Record<string, string> = {
  approx_date: 'Approximate date',
  mileage: 'Mileage at the time',
  damage_area: 'Damaged area',
  severity: 'Severity (seller-stated)',
  insurer_involved: 'Insurer involved',
  police_report_state: 'Police report',
  repair_state: 'Repair state',
  repairer: 'Repairer / garage',
}

function SellerStatedBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800">
      Seller-stated
    </span>
  )
}

function NotRecorded({ topic }: { topic: string }) {
  return (
    <p className="text-sm text-slate-500" data-testid={`history-${topic}-not-recorded`}>
      Not recorded — the seller has not answered this question. Absence of an answer is not a
      clean-history claim.
    </p>
  )
}

export function VehicleHistoryObligationsSections({
  disclosures,
}: {
  disclosures: VehicleHistoryDisclosuresBlock | null | undefined
}) {
  const accident = disclosures?.accident ?? null
  const insurance = disclosures?.insurance ?? null
  const finance = disclosures?.finance ?? null

  return (
    <section className="space-y-4" data-testid="vehicle-history-obligations">
      {/* ── 9. Accident, damage & repair history ─────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white p-5 sm:p-6" data-testid="detail-accident-history-section">
        <div className="flex flex-wrap items-center gap-2">
          <Car className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Accident, damage &amp; repair history</h2>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <SellerStatedBadge />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Seller’s declaration</span>
            </div>
            {accident ? (
              <div className="mt-1.5" data-testid="history-accident-statement">
                <p className="text-sm font-bold text-slate-900">{ACCIDENT_STATE_LABELS[accident.state]}</p>
                {accident.state === 'yes' && (accident.events?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-2">
                    {accident.events!.map((event, index) => (
                      <li key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid={`history-accident-event-${index}`}>
                        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                          {Object.entries(event).map(([key, value]) => (
                            <div key={key} className="flex gap-1.5">
                              <dt className="font-bold text-slate-500">{ACCIDENT_EVENT_LABELS[key] ?? key}:</dt>
                              <dd className="text-slate-700">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="mt-1.5"><NotRecorded topic="accident" /></div>
            )}
          </div>
          <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500" data-testid="history-accident-governed-state">
            Governed accident and repair evidence — insurer assessments, police reports, repair
            records with their source provenance — appears in the Vehicle History and Evidence
            sections of this page when it exists. A seller statement is never converted into
            verified evidence, and missing records are not proof of a clean history.
          </p>
        </div>
      </div>

      {/* ── 10. Insurance state ──────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white p-5 sm:p-6" data-testid="detail-insurance-section">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Insurance</h2>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <SellerStatedBadge />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Seller’s declaration</span>
            </div>
            {insurance ? (
              <p className="mt-1.5 text-sm font-bold text-slate-900" data-testid="history-insurance-statement">
                {INSURANCE_STATE_LABELS[insurance.state]}
                {insurance.insurer_name ? <span className="font-normal text-slate-600"> — {insurance.insurer_name} (seller-stated)</span> : null}
              </p>
            ) : (
              <div className="mt-1.5"><NotRecorded topic="insurance" /></div>
            )}
          </div>
          <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500" data-testid="history-insurance-governed-state">
            Insurer-confirmed cover: no connected insurer source for this vehicle. A seller saying
            “insured” never becomes provider confirmation; when a governed insurer record exists it
            is shown separately here.
          </p>
        </div>
      </div>

      {/* ── 11. Finance, lease & title obligations ───────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white p-5 sm:p-6" data-testid="detail-finance-obligations-section">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Finance, lease &amp; title obligations</h2>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <SellerStatedBadge />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Seller’s declaration</span>
            </div>
            {finance ? (
              <div className="mt-1.5" data-testid="history-finance-statement">
                <p className="text-sm font-bold text-slate-900">{FINANCE_STATE_LABELS[finance.state]}</p>
                {(finance.finance_type || finance.lender_name) && (
                  <p className="mt-0.5 text-xs text-slate-600">
                    {finance.finance_type ? FINANCE_TYPE_LABELS[finance.finance_type] : null}
                    {finance.finance_type && finance.lender_name ? ' · ' : null}
                    {finance.lender_name ? `${finance.lender_name} (seller-stated)` : null}
                  </p>
                )}
                {(finance.state === 'active' || finance.state === 'settlement_pending') && (
                  <p className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900" data-testid="history-finance-transfer-condition">
                    An active lender interest does not prevent viewing or inquiring about this
                    listing. Settlement or lender clearance is required before ownership transfer
                    can complete.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-1.5"><NotRecorded topic="finance" /></div>
            )}
          </div>
          <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500" data-testid="history-finance-governed-state">
            Lender-confirmed obligation state: no connected lender source for this vehicle. Exact
            balances, repayment amounts, rates and account identifiers are private and are never
            shown here.
          </p>
        </div>
      </div>

      <p className="flex items-start gap-2 px-1 text-[11px] leading-4 text-slate-400">
        <FileQuestion className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        Seller declarations above are statements by the seller, recorded with their listing. CarUp
        compares them with governed evidence where sources exist; reviewed discrepancies appear in
        the Disclosure Review section.
      </p>
    </section>
  )
}
