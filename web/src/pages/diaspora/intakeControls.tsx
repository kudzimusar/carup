/**
 * Shared Intake 2.0 form controls (contract §36.4).
 *
 * Both wizards — procurement and logistics — use these so a customer meets the same idiom whichever
 * door they came through, and so the rules the contract states are enforced in one place rather
 * than re-argued per screen:
 *
 *   - the deep detail is HIDDEN until asked for, so a novice never meets it;
 *   - the blank option is a real answer ("No preference / not sure"), never a silent default;
 *   - the label says "optional", never "incomplete", because a legitimately unknown answer is not
 *     a form error.
 */
import type { ReactNode } from 'react'

export const intakeFieldLabel = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-gray-600'
export const intakeControl = 'mt-1 block w-full min-w-0 border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'

/**
 * An optional section. Collapsed by default: the capability exists without the customer having to
 * walk past it.
 */
export function MoreDetail({ open, onToggle, summary, hint, children, testId }: {
  open: boolean; onToggle: () => void; summary: string; hint?: string
  children: ReactNode; testId: string
}) {
  return (
    <div className="mt-5 border-t border-gray-200 pt-4">
      <button type="button" onClick={onToggle} data-testid={testId}
              className="flex w-full min-w-0 items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-950">{summary}</span>
          <span className="block text-xs text-gray-500">
            {hint || 'Optional — it may help providers quote more accurately.'}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-orange-600">{open ? 'Hide' : 'Add'}</span>
      </button>
      {open && <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>}
    </div>
  )
}

/** A select whose blank option is a real answer. Unknown is never coerced into a default. */
export function Choice({ label, value, onChange, options, hint, testId, blankLabel }: {
  label: string; value: string; onChange: (v: string) => void
  options: Array<[string, string]>; hint?: string; testId: string; blankLabel?: string
}) {
  return (
    <label className={intakeFieldLabel}>{label}
      <select className={intakeControl} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">{blankLabel || 'No preference / not sure'}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">{hint}</span>}
    </label>
  )
}

/**
 * A set of checkboxes over a closed vocabulary — handling characteristics, content disclosures,
 * requested quote components. Nothing here is pre-ticked: an unticked box means "not stated", and
 * a ticked one is a customer DISCLOSURE, never an approval.
 */
export function ChoiceSet({ legend, note, values, onChange, options, testIdPrefix }: {
  legend: string; note?: string; values: string[]; onChange: (next: string[]) => void
  options: Array<[string, string]>; testIdPrefix: string
}) {
  return (
    <div className="sm:col-span-2">
      <p className={intakeFieldLabel}>{legend}</p>
      {note && <p className="mt-0.5 text-[10px] normal-case tracking-normal text-gray-500">{note}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(([value, label]) => (
          <label key={value} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={values.includes(value)}
                   data-testid={`${testIdPrefix}-${value}`}
                   onChange={(e) => onChange(e.target.checked
                     ? [...values, value]
                     : values.filter((v) => v !== value))} />
            <span className="min-w-0">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/** A private answer, marked as private in the UI so the customer knows where it goes. */
export function PrivateNote() {
  return (
    <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">
      Kept private — never shown to providers browsing opportunities.
    </span>
  )
}
