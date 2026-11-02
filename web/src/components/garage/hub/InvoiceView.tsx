import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  formatMoney, newIdempotencyKey, PAYMENT_STATUS_LABEL, type CaseHub, type GarageInvoice, type PaymentRecord,
} from '@/lib/garageBusiness'
import { categoryLabel, dateTimeLabel, isAllowed, PAYMENT_METHOD_LABEL, whenLabel } from '@/lib/garageWorkspace'
import { FormError, INPUT_CLASS, type HubRun } from './hubUi'
import { PaymentForm } from './PaymentForm'

/** One reason, one stable key: reversing the same payment twice by retrying cannot happen. */
function ReasonForm({ testId, label, hint, submitLabel, busy, onSubmit, onClose }: {
  testId: string
  label: string
  hint: string
  submitLabel: string
  busy: boolean
  onSubmit: (reason: string, key: string) => Promise<boolean>
  onClose: () => void
}) {
  const [key] = useState(() => newIdempotencyKey())
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3" data-testid={testId}>
      <label htmlFor={`${testId}-reason`} className="block text-sm font-medium">{label}</label>
      <input
        id={`${testId}-reason`} value={reason} className={INPUT_CLASS} data-testid={`${testId}-reason`}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-gray-600">{hint}</p>
      <FormError message={problem} testId={`${testId}-error`} />
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid={`${testId}-submit`}
          onClick={async () => {
            if (!reason.trim()) { setProblem('Give a reason.'); return }
            setProblem(null)
            const ok = await onSubmit(reason.trim(), key)
            if (ok) onClose()
          }}
        >
          {submitLabel}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Keep it as it is</Button>
      </div>
    </div>
  )
}

/**
 * An issued (or voided) invoice with the payments the garage has RECORDED against it.
 *
 * Wording is the server's: the payment state is `payment_status`, every payment and receipt carries its
 * source label (recorded by the garage, not processed or verified by CarUp), and nothing here says "paid"
 * except as that labelled state. The figures are shown, never recomputed.
 */
export function InvoiceView({ hub, invoice, busy, run }: {
  hub: CaseHub
  invoice: GarageInvoice
  busy: boolean
  run: HubRun
}) {
  const { voidGarageInvoice, reverseGaragePayment } = useCarUpApi()
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [reversing, setReversing] = useState<string | null>(null)

  const live = invoice.status === 'issued'
  const canRecord = live && isAllowed(hub, 'record_payment')
  const canVoid = live && isAllowed(hub, 'void_invoice')
  const canReverse = live && isAllowed(hub, 'reverse_payment')
  const reversedIds = new Set(invoice.payments.filter((p) => p.kind === 'reversal' && p.reverses_payment_id).map((p) => p.reverses_payment_id))

  const paymentTitle = (p: PaymentRecord) => (p.kind === 'reversal' ? 'Reversal of a recorded payment' : 'Payment recorded')

  return (
    <div className="space-y-4" data-testid="invoice">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold" data-testid="invoice-number">Invoice {invoice.invoice_number}</h3>
        <Badge variant="outline" data-testid="invoice-status">{live ? 'Issued' : 'Voided'}</Badge>
      </div>
      <p className="text-xs text-gray-500">
        Issued {dateTimeLabel(invoice.issued_at)}
        {invoice.due_date ? ` · due ${whenLabel(invoice.due_date)}` : ''}
        {invoice.voided_at ? ` · voided ${dateTimeLabel(invoice.voided_at)}` : ''}
      </p>
      {!live && invoice.void_reason && <p className="text-sm" data-testid="invoice-void-reason">Reason it was voided: {invoice.void_reason}</p>}

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="invoice-lines">
        {invoice.lines.map((l) => (
          <li key={l.line_no} className="p-3 text-sm flex flex-wrap justify-between gap-2" data-testid="invoice-line-row">
            <span className="min-w-0 break-words">
              <span className="font-medium">{l.description}</span>
              <span className="block text-xs text-gray-500">
                {categoryLabel(l.category)} · quantity {l.quantity} × {formatMoney(l.unit_price, invoice.currency)}
              </span>
            </span>
            <span>{formatMoney(l.line_total, invoice.currency)}</span>
          </li>
        ))}
      </ul>

      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-gray-500">Invoice total</dt>
          <dd className="font-semibold" data-testid="invoice-total">{formatMoney(invoice.total_amount, invoice.currency)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Recorded as received</dt>
          <dd data-testid="invoice-paid-amount">{formatMoney(invoice.paid_amount, invoice.currency)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Balance left on the invoice</dt>
          <dd data-testid="invoice-balance">{formatMoney(invoice.balance_amount, invoice.currency)}</dd>
        </div>
      </dl>

      <div>
        <p className="text-sm font-medium" data-testid="invoice-payment-status">{PAYMENT_STATUS_LABEL[invoice.payment_status]}</p>
        <p className="text-xs text-gray-600" data-testid="payment-source-label">{invoice.payment_source_label}</p>
      </div>

      {invoice.payments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Payments recorded by the garage</h4>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="payments">
            {invoice.payments.map((p) => (
              <li key={p.id} className="p-3 text-sm" data-testid="payment-row" data-kind={p.kind}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{paymentTitle(p)}: {formatMoney(p.amount, p.currency)}</p>
                    <p className="text-xs text-gray-500">
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · reference ${p.reference}` : ''} · recorded as received {dateTimeLabel(p.paid_at)}
                    </p>
                    {p.reason && <p className="text-xs text-gray-600">Reason: {p.reason}</p>}
                    <p className="text-xs text-gray-600 mt-1" data-testid="payment-source">{p.source_label}</p>
                    {p.kind === 'payment' && reversedIds.has(p.id) && <p className="text-xs text-amber-700">This payment has been reversed.</p>}
                  </div>
                  {canReverse && p.kind === 'payment' && !reversedIds.has(p.id) && (
                    <Button
                      variant="outline" className="min-h-11" disabled={busy} data-testid="reverse-payment"
                      onClick={() => setReversing((cur) => (cur === p.id ? null : p.id))}
                    >
                      Reverse
                    </Button>
                  )}
                </div>
                {canReverse && reversing === p.id && (
                  <ReasonForm
                    testId="reverse-payment-form" label="Why is this payment being reversed?"
                    hint="A reversal is recorded beside the original; nothing is deleted. CarUp does not move any money."
                    submitLabel="Reverse this payment" busy={busy} onClose={() => setReversing(null)}
                    onSubmit={(reason, key) => run('closeout', () => reverseGaragePayment(p.id, { reason, idempotency_key: key }), 'Payment reversed on the record.')}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {invoice.receipts.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Receipts</h4>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="receipts">
            {invoice.receipts.map((r) => (
              <li key={r.id} className="p-3 text-sm" data-testid="receipt-row">
                <p className="font-medium">
                  Receipt {r.receipt_number}: {formatMoney(r.amount, r.currency)}
                  {r.status === 'voided' ? ' (voided)' : ''}
                </p>
                <p className="text-xs text-gray-500">Issued {dateTimeLabel(r.issued_at)}</p>
                <p className="text-xs text-gray-600" data-testid="receipt-source">{r.payment_source_label}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRecord && (
        paying ? (
          <PaymentForm invoice={invoice} busy={busy} run={run} onDone={() => setPaying(false)} />
        ) : (
          <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="record-payment" onClick={() => setPaying(true)}>
            Record a payment
          </Button>
        )
      )}

      {canVoid && (
        <div>
          <Button variant="outline" className="min-h-11" disabled={busy} data-testid="void-invoice" onClick={() => setVoiding((v) => !v)}>
            Void this invoice
          </Button>
          {voiding && (
            <ReasonForm
              testId="void-invoice-form" label="Why is this invoice being voided?"
              hint="A voided invoice stays on record as voided. You can issue a new one afterwards."
              submitLabel="Void this invoice" busy={busy} onClose={() => setVoiding(false)}
              onSubmit={(reason) => run('closeout', () => voidGarageInvoice(invoice.id, reason), 'Invoice voided.')}
            />
          )}
        </div>
      )}
    </div>
  )
}
