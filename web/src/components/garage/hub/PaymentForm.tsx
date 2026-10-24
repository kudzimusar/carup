import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { newIdempotencyKey, type GarageInvoice, type PaymentRecord } from '@/lib/garageBusiness'
import { PAYMENT_METHOD_LABEL } from '@/lib/garageWorkspace'
import { FormError, INPUT_CLASS, type HubRun } from './hubUi'

const DECIMAL = /^\d+(\.\d+)?$/
const METHODS = Object.keys(PAYMENT_METHOD_LABEL) as Array<PaymentRecord['method']>

/**
 * The day the money was received, as an instant. A date in the future is refused here; "today" is sent as
 * now, because midnight UTC of today can still be ahead of the clock in some timezones.
 */
function paidAtFromDate(value: string): { iso: string | null; problem: string | null } {
  if (!value) return { iso: null, problem: null }
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return { iso: null, problem: 'The date is not valid.' }
  const noon = new Date(y, m - 1, d, 12, 0, 0)
  const now = new Date()
  if (noon.getTime() <= now.getTime()) return { iso: noon.toISOString(), problem: null }
  const sameDay = noon.getFullYear() === now.getFullYear() && noon.getMonth() === now.getMonth() && noon.getDate() === now.getDate()
  if (sameDay) return { iso: now.toISOString(), problem: null }
  return { iso: null, problem: 'The date money was received cannot be in the future.' }
}

/**
 * Record money the garage received OUTSIDE CarUp.
 *
 * CarUp does not take, hold or verify this money; the form says so beside the button. The idempotency key is
 * generated once when the form opens, so a double-click or a retry after a network failure records ONE
 * payment, not two. The currency is the invoice's own and is not typed.
 */
export function PaymentForm({ invoice, busy, run, onDone }: {
  invoice: GarageInvoice
  busy: boolean
  run: HubRun
  onDone: () => void
}) {
  const { recordGaragePayment } = useCarUpApi()
  const uid = useId()
  const [key] = useState(() => newIdempotencyKey())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentRecord['method'] | ''>('')
  const [reference, setReference] = useState('')
  const [paidDate, setPaidDate] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  async function submit() {
    if (!DECIMAL.test(amount.trim()) || Number(amount) <= 0) { setProblem('Enter the amount that was received, as a number greater than zero.'); return }
    if (!method) { setProblem('Choose how it was received.'); return }
    const when = paidAtFromDate(paidDate)
    if (when.problem) { setProblem(when.problem); return }
    setProblem(null)
    const ok = await run('closeout', () => recordGaragePayment(invoice.id, {
      amount: amount.trim(),
      method,
      reference: reference.trim() || null,
      paid_at: when.iso,
      idempotency_key: key,
    }), 'Recorded as received. CarUp has not verified it.')
    if (ok) onDone()
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4" data-testid="payment-form">
      <p className="font-semibold">Record a payment</p>
      <p className="text-sm rounded-lg bg-amber-50 p-3 text-amber-900" data-testid="payment-unverified-note">
        This records money the garage received <strong>outside CarUp</strong>. CarUp does not take, hold or verify the
        payment — the garage is stating that it happened.
      </p>

      <p className="text-sm text-gray-700">Currency: <span className="font-medium">{invoice.currency}</span> (the invoice’s currency — amounts are never converted)</p>

      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-amount`} className="block text-sm font-medium mb-1">Amount received</label>
        <input
          id={`${uid}-amount`} inputMode="decimal" value={amount} className={INPUT_CLASS} data-testid="payment-amount"
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-method`} className="block text-sm font-medium mb-1">How it was received</label>
        <select
          id={`${uid}-method`} value={method} className={INPUT_CLASS} data-testid="payment-method"
          onChange={(e) => setMethod(e.target.value as PaymentRecord['method'] | '')}
        >
          <option value="">Choose a method</option>
          {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
        </select>
      </div>
      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-ref`} className="block text-sm font-medium mb-1">Reference (optional)</label>
        <input
          id={`${uid}-ref`} value={reference} maxLength={120} className={INPUT_CLASS} data-testid="payment-reference"
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div className="sm:max-w-xs">
        <label htmlFor={`${uid}-date`} className="block text-sm font-medium mb-1">Date received (optional)</label>
        <input
          id={`${uid}-date`} type="date" value={paidDate} className={INPUT_CLASS} data-testid="payment-date"
          onChange={(e) => setPaidDate(e.target.value)}
        />
      </div>

      <FormError message={problem} testId="payment-form-error" />

      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="submit-payment" onClick={submit}>
          {busy ? 'Saving…' : 'Record this payment'}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} data-testid="close-payment-form" onClick={onDone}>Close</Button>
      </div>
    </div>
  )
}
