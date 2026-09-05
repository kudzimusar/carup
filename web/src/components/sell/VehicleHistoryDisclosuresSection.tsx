import { ShieldQuestion } from 'lucide-react'
import {
  ACCIDENT_DISCLOSURE_STATES,
  ACCIDENT_STATE_LABELS,
  FINANCE_DISCLOSURE_STATES,
  FINANCE_STATE_LABELS,
  FINANCE_TYPES,
  FINANCE_TYPE_LABELS,
  INSURANCE_DISCLOSURE_STATES,
  INSURANCE_STATE_LABELS,
  type AccidentDisclosure,
  type AccidentEvent,
  type FinanceDisclosure,
  type FinanceType,
  type InsuranceDisclosure,
} from '@/lib/vehicleHistoryDisclosures'

/**
 * Vehicle History & Obligations — the Seller's structured accident / insurance / finance
 * disclosures (DESIGN.md §11.7, master plan F18–F20, T21).
 *
 * Contract rules this component embodies:
 *  - NOTHING is preselected. An unanswered question stays null and every read surface renders it
 *    as "not recorded" — absence is never presented or stored as "No".
 *  - The options are the closed vocabulary the backend accepts, nothing else.
 *  - These are Seller statements: the copy says so, and no wording implies verification.
 *  - Private banking terms are never asked for (M17): no balance, rate or account fields exist.
 */

const ACCIDENT_EVENT_FIELD_META: { key: keyof AccidentEvent; label: string; placeholder?: string }[] = [
  { key: 'approx_date', label: 'Approximate date', placeholder: 'e.g. 2023 or 2023-06' },
  { key: 'mileage', label: 'Mileage at the time (if known)' },
  { key: 'damage_area', label: 'Damaged area', placeholder: 'e.g. front-left wing' },
  { key: 'severity', label: 'Severity (your words)', placeholder: 'e.g. light panel damage' },
  { key: 'insurer_involved', label: 'Insurer involved?', placeholder: 'e.g. yes — claim lodged' },
  { key: 'police_report_state', label: 'Police report', placeholder: 'e.g. filed / none' },
  { key: 'repair_state', label: 'Repair state', placeholder: 'e.g. fully repaired' },
  { key: 'repairer', label: 'Repairer / garage (if known)' },
]

interface Props {
  accident: AccidentDisclosure | null
  insurance: InsuranceDisclosure | null
  finance: FinanceDisclosure | null
  onAccidentChange: (value: AccidentDisclosure | null) => void
  onInsuranceChange: (value: InsuranceDisclosure | null) => void
  onFinanceChange: (value: FinanceDisclosure | null) => void
  idPrefix: string
  disabled?: boolean
}

function RadioRow({
  id, name, label, checked, onSelect, disabled, testId,
}: {
  id: string; name: string; label: string; checked: boolean
  onSelect: () => void; disabled?: boolean; testId: string
}) {
  return (
    <label htmlFor={id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm transition ${checked ? 'border-orange-400 bg-orange-50 font-bold text-slate-950' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="h-4 w-4 accent-orange-600"
        data-testid={testId}
      />
      <span>{label}</span>
    </label>
  )
}

function DetailInput({
  id, label, value, onChange, placeholder, disabled, testId,
}: {
  id: string; label: string; value: string; onChange: (value: string) => void
  placeholder?: string; disabled?: boolean; testId?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={200}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
        data-testid={testId}
      />
    </div>
  )
}

export function VehicleHistoryDisclosuresSection({
  accident, insurance, finance,
  onAccidentChange, onInsuranceChange, onFinanceChange,
  idPrefix, disabled,
}: Props) {
  const events = accident?.state === 'yes' ? (accident.events ?? []) : []

  const setEvent = (index: number, key: keyof AccidentEvent, value: string) => {
    const next = events.map((event, i) => (i === index ? { ...event, [key]: value } : event))
    onAccidentChange({ state: 'yes', events: next })
  }

  return (
    <section className="rounded-3xl border border-slate-200 p-5 sm:p-6" data-testid="vehicle-history-disclosures">
      <div className="flex items-center gap-3">
        <ShieldQuestion className="h-5 w-5 text-orange-600" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-black">Vehicle history &amp; obligations</h3>
          <p className="text-xs text-slate-500">
            Your answers are recorded as seller statements, kept separate from any insurer, police, garage or
            lender evidence. A question you skip stays “not recorded” — it is never shown as “No”.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {/* ── Accident / collision history ─────────────────────────────────────────── */}
        <fieldset data-testid="history-accident-disclosure">
          <legend className="text-xs font-black uppercase tracking-wide text-slate-600">
            Has this vehicle been in an accident or collision?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {ACCIDENT_DISCLOSURE_STATES.map(state => (
              <RadioRow
                key={state}
                id={`${idPrefix}-accident-${state}`}
                name={`${idPrefix}-accident-state`}
                label={ACCIDENT_STATE_LABELS[state]}
                checked={accident?.state === state}
                onSelect={() => onAccidentChange(state === 'yes' ? { state, events: accident?.events } : { state })}
                disabled={disabled}
                testId={`history-accident-state-${state}`}
              />
            ))}
          </div>

          {accident?.state === 'yes' && (
            <div className="mt-4 space-y-4" data-testid="history-accident-events">
              {events.map((event, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-700">Accident event {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => onAccidentChange({ state: 'yes', events: events.filter((_, i) => i !== index) })}
                      disabled={disabled}
                      className="min-h-9 rounded-lg px-2 text-xs font-bold text-slate-500 hover:text-red-600"
                      data-testid={`history-accident-remove-event-${index}`}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {ACCIDENT_EVENT_FIELD_META.map(({ key, label, placeholder }) => (
                      <DetailInput
                        key={key}
                        id={`${idPrefix}-accident-event-${index}-${key}`}
                        label={label}
                        value={event[key] ?? ''}
                        onChange={value => setEvent(index, key, value)}
                        placeholder={placeholder}
                        disabled={disabled}
                        testId={index === 0 ? `history-accident-event-${key}` : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {events.length < 10 && (
                <button
                  type="button"
                  onClick={() => onAccidentChange({ state: 'yes', events: [...events, {}] })}
                  disabled={disabled}
                  className="min-h-11 rounded-xl border border-dashed border-slate-300 px-4 text-xs font-bold text-slate-600 transition hover:border-orange-400 hover:text-orange-700"
                  data-testid="history-accident-add-event"
                >
                  + Add accident details
                </button>
              )}
              <p className="text-[11px] leading-4 text-slate-500">
                Accident, insurer-claim and repair photos belong in the vehicle’s history evidence, not the
                listing gallery — you can add them from the vehicle’s evidence workspace after saving.
              </p>
            </div>
          )}
        </fieldset>

        {/* ── Current insurance ────────────────────────────────────────────────────── */}
        <fieldset data-testid="history-insurance-disclosure">
          <legend className="text-xs font-black uppercase tracking-wide text-slate-600">
            Is the vehicle currently insured?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {INSURANCE_DISCLOSURE_STATES.map(state => (
              <RadioRow
                key={state}
                id={`${idPrefix}-insurance-${state}`}
                name={`${idPrefix}-insurance-state`}
                label={INSURANCE_STATE_LABELS[state]}
                checked={insurance?.state === state}
                onSelect={() => onInsuranceChange(state === 'insured' ? { state, insurer_name: insurance?.insurer_name } : { state })}
                disabled={disabled}
                testId={`history-insurance-state-${state}`}
              />
            ))}
          </div>
          {insurance?.state === 'insured' && (
            <div className="mt-3 max-w-sm">
              <DetailInput
                id={`${idPrefix}-insurance-insurer`}
                label="Insurer (optional)"
                value={insurance.insurer_name ?? ''}
                onChange={value => onInsuranceChange({ state: 'insured', insurer_name: value })}
                disabled={disabled}
                testId="history-insurance-insurer-name"
              />
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Your statement — CarUp shows confirmed cover separately when an insurer record exists.
              </p>
            </div>
          )}
        </fieldset>

        {/* ── Existing finance / lease / lender interest ───────────────────────────── */}
        <fieldset data-testid="history-finance-disclosure">
          <legend className="text-xs font-black uppercase tracking-wide text-slate-600">
            Does the vehicle have finance, a lease or another lender interest?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {FINANCE_DISCLOSURE_STATES.map(state => (
              <RadioRow
                key={state}
                id={`${idPrefix}-finance-${state}`}
                name={`${idPrefix}-finance-state`}
                label={FINANCE_STATE_LABELS[state]}
                checked={finance?.state === state}
                onSelect={() => onFinanceChange({
                  state,
                  ...(state === 'none_known' || state === 'unknown'
                    ? {}
                    : { finance_type: finance?.finance_type, lender_name: finance?.lender_name }),
                })}
                disabled={disabled}
                testId={`history-finance-state-${state}`}
              />
            ))}
          </div>
          {finance && finance.state !== 'none_known' && finance.state !== 'unknown' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="history-finance-details">
              <div>
                <label htmlFor={`${idPrefix}-finance-type`} className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Finance type (if known)
                </label>
                <select
                  id={`${idPrefix}-finance-type`}
                  value={finance.finance_type ?? ''}
                  onChange={e => onFinanceChange({
                    ...finance,
                    finance_type: (e.target.value || undefined) as FinanceType | undefined,
                  })}
                  disabled={disabled}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                  data-testid="history-finance-type"
                >
                  <option value="">Not specified</option>
                  {FINANCE_TYPES.map(financeType => (
                    <option key={financeType} value={financeType}>{FINANCE_TYPE_LABELS[financeType]}</option>
                  ))}
                </select>
              </div>
              <DetailInput
                id={`${idPrefix}-finance-lender`}
                label="Lender / provider (optional)"
                value={finance.lender_name ?? ''}
                onChange={value => onFinanceChange({ ...finance, lender_name: value })}
                disabled={disabled}
                testId="history-finance-lender-name"
              />
            </div>
          )}
          <p className="mt-2 text-[11px] leading-4 text-slate-500" data-testid="history-finance-privacy-note">
            CarUp never asks for balances, repayment amounts, rates or account numbers here — those stay
            between you and your lender. Active finance does not block listing; settlement or lender
            clearance is handled at ownership transfer.
          </p>
        </fieldset>
      </div>
    </section>
  )
}
