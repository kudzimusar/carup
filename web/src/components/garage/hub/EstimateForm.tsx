import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EstimateDraftInput, EstimateLineCategory, GarageEstimate } from '@/lib/garageBusiness'
import { FormError, INPUT_CLASS, TEXTAREA_CLASS } from './hubUi'

type LineDraft = { category: EstimateLineCategory; description: string; quantity: string; unit_price: string }

const CATEGORIES: Array<{ value: EstimateLineCategory; label: string }> = [
  { value: 'labour', label: 'Labour' },
  { value: 'part', label: 'Part' },
  { value: 'fee', label: 'Fee' },
  { value: 'other', label: 'Other' },
]

const DECIMAL = /^\d+(\.\d+)?$/
const blankLine = (): LineDraft => ({ category: 'labour', description: '', quantity: '1', unit_price: '' })

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Prepare (create) or edit a draft estimate.
 *
 * Truth rules this form enforces before anything is sent:
 *  - the currency is typed by the operator — there is NO default currency;
 *  - a blank price is "Not recorded" (sent as null), and 0 is "free" — they are never conflated;
 *  - amounts travel as decimal STRINGS, never as floats.
 * Everything else (totals, whether a line may be unpriced when sending) is the server's to decide.
 */
export function EstimateForm({ mode, estimate, busy, onSubmit, onCancel }: {
  mode: 'create' | 'edit'
  estimate: GarageEstimate | null
  busy: boolean
  /** resolves true when the server accepted it (the parent then closes the form) */
  onSubmit: (body: EstimateDraftInput) => Promise<boolean>
  onCancel: () => void
}) {
  const uid = useId()
  const source = mode === 'edit' ? estimate : null
  const [currency, setCurrency] = useState(source?.currency ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() =>
    source && source.lines.length
      ? source.lines.map((l) => ({ category: l.category, description: l.description, quantity: l.quantity, unit_price: l.unit_price ?? '' }))
      : [blankLine()],
  )
  const [customerNote, setCustomerNote] = useState(source?.customer_note ?? '')
  const [internalNote, setInternalNote] = useState(source?.internal_note ?? '')
  const [validUntil, setValidUntil] = useState(toLocalInput(source?.valid_until))
  const [problem, setProblem] = useState<string | null>(null)

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  function validate(): string | null {
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      return 'Enter the currency as a three-letter code, for example USD or ZWG. There is no default currency.'
    }
    for (let i = 0; i < lines.length; i += 1) {
      const n = i + 1
      const l = lines[i]
      if (!l.description.trim()) return `Line ${n} needs a description.`
      if (!DECIMAL.test(l.quantity.trim()) || Number(l.quantity) <= 0) return `Line ${n} needs a quantity greater than zero.`
      if (l.unit_price.trim() !== '' && !DECIMAL.test(l.unit_price.trim())) {
        return `Line ${n}: the price must be a number that is not negative. Leave it blank if it is not recorded yet.`
      }
    }
    if (validUntil && Number.isNaN(new Date(validUntil).getTime())) return 'The validity date is not a valid date and time.'
    return null
  }

  async function submit() {
    const issue = validate()
    setProblem(issue)
    if (issue) return
    const body: EstimateDraftInput = {
      currency: currency.trim().toUpperCase(),
      lines: lines.map((l) => ({
        category: l.category,
        description: l.description.trim(),
        quantity: l.quantity.trim(),
        // blank = not recorded (null); "0" = explicitly free
        unit_price: l.unit_price.trim() === '' ? null : l.unit_price.trim(),
      })),
      customer_note: customerNote.trim() || null,
      internal_note: internalNote.trim() || null,
      valid_until: validUntil ? new Date(validUntil).toISOString() : null,
    }
    if (mode === 'edit') body.expected_updated_at = estimate?.updated_at ?? null
    await onSubmit(body)
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4" data-testid="estimate-form">
      <p className="font-medium">{mode === 'edit' ? 'Edit the draft estimate' : 'Prepare an estimate'}</p>

      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-currency`} className="block text-sm font-medium mb-1">Currency (three-letter code)</label>
        <input
          id={`${uid}-currency`} value={currency} maxLength={3} data-testid="estimate-currency" placeholder="For example USD"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={`${INPUT_CLASS} uppercase`}
        />
        <p className="text-xs text-gray-500 mt-1">You choose it. Amounts are never converted between currencies.</p>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => {
          const n = i + 1
          return (
            <fieldset key={i} className="rounded-lg bg-gray-50 p-3 space-y-3" data-testid="estimate-line">
              <legend className="text-sm font-medium px-1">Line {n}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${uid}-cat-${i}`} className="block text-sm mb-1">Kind of line</label>
                  <select
                    id={`${uid}-cat-${i}`} value={line.category} className={INPUT_CLASS}
                    onChange={(e) => setLine(i, { category: e.target.value as EstimateLineCategory })}
                  >
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${uid}-qty-${i}`} className="block text-sm mb-1">Quantity</label>
                  <input
                    id={`${uid}-qty-${i}`} inputMode="decimal" value={line.quantity} className={INPUT_CLASS}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${uid}-desc-${i}`} className="block text-sm mb-1">Description</label>
                <input
                  id={`${uid}-desc-${i}`} value={line.description} className={INPUT_CLASS} maxLength={300}
                  placeholder="For example: front brake pads, fitted"
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-price-${i}`} className="block text-sm mb-1">Unit price</label>
                <input
                  id={`${uid}-price-${i}`} inputMode="decimal" value={line.unit_price} className={INPUT_CLASS}
                  placeholder="Blank = not recorded yet"
                  onChange={(e) => setLine(i, { unit_price: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Leave blank if you have no price yet — that is “not recorded”, not free. Enter 0 only if it is genuinely free.</p>
              </div>
              <Button
                variant="outline" className="min-h-11" disabled={busy} aria-label={`Remove line ${n}`} data-testid="remove-line"
                onClick={() => setLines((all) => all.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" /> Remove line {n}
              </Button>
            </fieldset>
          )
        })}
        <Button
          variant="outline" className="min-h-11" disabled={busy} data-testid="add-line"
          onClick={() => setLines((all) => [...all, blankLine()])}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Add a line
        </Button>
      </div>

      <div>
        <label htmlFor={`${uid}-cnote`} className="block text-sm font-medium mb-1">Note to the customer (optional)</label>
        <textarea
          id={`${uid}-cnote`} rows={2} value={customerNote} data-testid="estimate-customer-note" className={TEXTAREA_CLASS}
          onChange={(e) => setCustomerNote(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${uid}-inote`} className="block text-sm font-medium mb-1">Internal note (optional)</label>
        <textarea
          id={`${uid}-inote`} rows={2} value={internalNote} data-testid="estimate-internal-note" className={TEXTAREA_CLASS}
          onChange={(e) => setInternalNote(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1">Only your garage’s administrators see this. The customer never does.</p>
      </div>
      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-valid`} className="block text-sm font-medium mb-1">Valid until (optional)</label>
        <input
          id={`${uid}-valid`} type="datetime-local" value={validUntil} data-testid="estimate-valid-until" className={INPUT_CLASS}
          onChange={(e) => setValidUntil(e.target.value)}
        />
      </div>

      <FormError message={problem} testId="estimate-form-error" />

      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="submit-estimate" onClick={submit}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save the draft' : 'Save as a draft'}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} data-testid="cancel-estimate-form" onClick={onCancel}>
          Close without saving
        </Button>
      </div>
      <p className="text-xs text-gray-500">A draft is visible only to your garage. The customer sees nothing until you send it.</p>
    </div>
  )
}
