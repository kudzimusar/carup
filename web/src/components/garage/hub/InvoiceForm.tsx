import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Closeout, EstimateLineCategory, InvoiceLineInput } from '@/lib/garageBusiness'
import { FormError, INPUT_CLASS, TEXTAREA_CLASS } from './hubUi'

type LineDraft = {
  category: EstimateLineCategory
  description: string
  quantity: string
  unit_price: string
  source_kind?: InvoiceLineInput['source_kind']
  source_id?: string | null
}

const CATEGORIES: Array<{ value: EstimateLineCategory; label: string }> = [
  { value: 'labour', label: 'Labour' }, { value: 'part', label: 'Part' }, { value: 'fee', label: 'Fee' }, { value: 'other', label: 'Other' },
]
const DECIMAL = /^\d+(\.\d+)?$/

export type InvoiceDraft = {
  currency: string
  lines: InvoiceLineInput[]
  customer_note: string | null
  internal_note: string | null
  due_date: string | null
}

/**
 * Issue the invoice, starting from what the job actually recorded.
 *
 * The suggestion is a starting point the operator edits — never a commitment:
 *  - the currency is the suggested one only when the server found exactly one; otherwise it is blank and
 *    REQUIRED (and the server's notes say why);
 *  - an invoice states amounts, so every line must be priced; a suggested line the server could not price is
 *    blank and flagged, not defaulted to 0;
 *  - amounts travel as decimal strings.
 */
export function InvoiceForm({ suggestion, busy, onSubmit }: {
  suggestion: Closeout['suggested_invoice']
  busy: boolean
  /** resolves true when the server accepted it */
  onSubmit: (body: InvoiceDraft) => Promise<boolean>
}) {
  const uid = useId()
  const [currency, setCurrency] = useState(suggestion?.currency ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (suggestion?.lines ?? []).map((l) => ({
      category: l.category, description: l.description, quantity: String(l.quantity), unit_price: l.unit_price === null ? '' : String(l.unit_price),
      source_kind: l.source_kind, source_id: l.source_id ?? null,
    })),
  )
  const [customerNote, setCustomerNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  function validate(): string | null {
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) return 'Choose the invoice currency as a three-letter code, for example USD or ZWG.'
    if (lines.length === 0) return 'Add at least one line.'
    for (let i = 0; i < lines.length; i += 1) {
      const n = i + 1
      const l = lines[i]
      if (!l.description.trim()) return `Line ${n} needs a description.`
      if (!DECIMAL.test(l.quantity.trim()) || Number(l.quantity) <= 0) return `Line ${n} needs a quantity greater than zero.`
      if (l.unit_price.trim() === '') return `Line ${n} needs a price. An invoice states amounts — enter 0 only if it is genuinely free.`
      if (!DECIMAL.test(l.unit_price.trim())) return `Line ${n}: the price must be a number that is not negative.`
    }
    return null
  }

  async function submit() {
    const issue = validate()
    setProblem(issue)
    if (issue) return
    await onSubmit({
      currency: currency.trim().toUpperCase(),
      lines: lines.map((l): InvoiceLineInput => ({
        category: l.category,
        description: l.description.trim(),
        quantity: l.quantity.trim(),
        unit_price: l.unit_price.trim(),
        ...(l.source_kind ? { source_kind: l.source_kind, source_id: l.source_id ?? null } : {}),
      })),
      customer_note: customerNote.trim() || null,
      internal_note: internalNote.trim() || null,
      due_date: dueDate || null,
    })
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4" data-testid="invoice-form">
      <div>
        <p className="font-semibold">Issue the invoice</p>
        <p className="text-sm text-gray-600 mt-1">
          The lines below are suggested from what was recorded on the job. Check each one — you can change anything.
          An invoice is a document; it is not a payment.
        </p>
      </div>

      {suggestion && suggestion.notes.length > 0 && (
        <ul className="list-disc pl-5 space-y-1 text-sm text-amber-900 rounded-lg bg-amber-50 p-3" data-testid="invoice-suggestion-notes">
          {suggestion.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}

      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-currency`} className="block text-sm font-medium mb-1">Invoice currency (three-letter code)</label>
        <input
          id={`${uid}-currency`} value={currency} maxLength={3} data-testid="invoice-currency" placeholder="For example USD"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={`${INPUT_CLASS} uppercase`}
        />
        <p className="text-xs text-gray-500 mt-1">
          {suggestion?.currency
            ? 'Suggested from the recorded costs. Amounts are never converted — if you change it, re-enter every price.'
            : 'You choose it. Amounts are never converted between currencies.'}
        </p>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => {
          const n = i + 1
          const unpriced = line.unit_price.trim() === ''
          return (
            <fieldset key={i} className="rounded-lg bg-gray-50 p-3 space-y-3" data-testid="invoice-line">
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
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-price-${i}`} className="block text-sm mb-1">Unit price</label>
                <input
                  id={`${uid}-price-${i}`} inputMode="decimal" value={line.unit_price} className={INPUT_CLASS}
                  aria-invalid={unpriced} onChange={(e) => setLine(i, { unit_price: e.target.value })}
                />
                {unpriced && (
                  <p className="text-xs text-amber-800 mt-1" data-testid="invoice-line-unpriced">
                    No price was recorded for this line. Enter it yourself — it is not free unless you enter 0.
                  </p>
                )}
              </div>
              <Button
                variant="outline" className="min-h-11" disabled={busy} aria-label={`Remove invoice line ${n}`}
                onClick={() => setLines((all) => all.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" /> Remove line {n}
              </Button>
            </fieldset>
          )
        })}
        <Button
          variant="outline" className="min-h-11" disabled={busy} data-testid="add-invoice-line"
          onClick={() => setLines((all) => [...all, { category: 'other', description: '', quantity: '1', unit_price: '', source_kind: 'manual', source_id: null }])}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Add a line
        </Button>
      </div>

      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-due`} className="block text-sm font-medium mb-1">Due date (optional)</label>
        <input id={`${uid}-due`} type="date" value={dueDate} className={INPUT_CLASS} data-testid="invoice-due-date" onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${uid}-cnote`} className="block text-sm font-medium mb-1">Note to the customer (optional)</label>
        <textarea id={`${uid}-cnote`} rows={2} value={customerNote} className={TEXTAREA_CLASS} data-testid="invoice-customer-note" onChange={(e) => setCustomerNote(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${uid}-inote`} className="block text-sm font-medium mb-1">Internal note (optional)</label>
        <textarea id={`${uid}-inote`} rows={2} value={internalNote} className={TEXTAREA_CLASS} data-testid="invoice-internal-note" onChange={(e) => setInternalNote(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">Only your garage’s administrators see this.</p>
      </div>

      <FormError message={problem} testId="invoice-form-error" />

      <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="submit-invoice" onClick={submit}>
        {busy ? 'Issuing…' : 'Issue the invoice'}
      </Button>
    </div>
  )
}
