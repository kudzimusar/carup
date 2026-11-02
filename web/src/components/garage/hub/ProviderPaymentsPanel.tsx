import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney, type GarageInvoice } from '@/lib/garageBusiness'
import { dateTimeLabel } from '@/lib/garageWorkspace'
import { DISCREPANCY_LABEL, PROVIDER_STATE_TONE, type ProviderPayment } from '@/lib/pay04GaragePayments'
import { FormError, INPUT_CLASS, type HubRun } from './hubUi'

/**
 * CARUP-PAY-04 — what the invoice's money is made of, for the garage.
 *
 * Three different facts, side by side and never merged: what the garage RECORDED as received off-platform, what the
 * garage's payment PROVIDER confirmed, and what is IN FLIGHT with the provider (not counted). Every figure is the
 * server's; nothing is added up here.
 */
export function InvoiceMoneyBreakdown({ invoice }: { invoice: GarageInvoice }) {
  const m = invoice.money
  if (!m) return null
  return (
    <dl className="grid gap-3 sm:grid-cols-3 text-sm rounded-lg border border-gray-200 p-3" data-testid="invoice-money-breakdown">
      <div>
        <dt className="text-gray-500">Recorded by the garage</dt>
        <dd data-testid="money-declared">{formatMoney(m.declared_paid, invoice.currency)}</dd>
      </div>
      <div>
        <dt className="text-gray-500">Confirmed by the garage’s payment provider</dt>
        <dd data-testid="money-provider">{formatMoney(m.provider_paid, invoice.currency)}</dd>
      </div>
      <div>
        <dt className="text-gray-500">In progress with the provider (not counted)</dt>
        <dd data-testid="money-in-flight">{formatMoney(m.provider_reserved, invoice.currency)}</dd>
      </div>
    </dl>
  )
}

function ReasonAction({ testId, label, hint, submitLabel, minLength, busy, onSubmit, onClose }: {
  testId: string
  label: string
  hint: string
  submitLabel: string
  minLength: number
  busy: boolean
  onSubmit: (reason: string) => Promise<boolean>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3" data-testid={testId}>
      <label htmlFor={`${testId}-reason`} className="block text-sm font-medium">{label}</label>
      <input id={`${testId}-reason`} value={reason} className={INPUT_CLASS} data-testid={`${testId}-reason`} onChange={(e) => setReason(e.target.value)} />
      <p className="text-xs text-gray-600">{hint}</p>
      <FormError message={problem} testId={`${testId}-error`} />
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-700/30" disabled={busy} data-testid={`${testId}-submit`}
          onClick={async () => {
            if (reason.trim().length < minLength) { setProblem(`Give a reason of at least ${minLength} characters.`); return }
            setProblem(null)
            if (await onSubmit(reason.trim())) onClose()
          }}
        >
          {submitLabel}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Keep it as it is</Button>
      </div>
    </div>
  )
}

function PaymentRow({ payment, currency, canAct, busy, run }: {
  payment: ProviderPayment
  currency: string
  canAct: boolean
  busy: boolean
  run: HubRun
}) {
  const { refundGarageProviderPayment, reconcileGarageProviderPayment, cancelGarageProviderPayment } = useCarUpApi()
  const [open, setOpen] = useState<'refund' | 'stop' | null>(null)
  const discrepancies = payment.open_discrepancies ?? []
  return (
    <li className="p-3 text-sm" data-testid="provider-payment-row" data-state={payment.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">Payment through the provider: {formatMoney(payment.amount, payment.currency || currency)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`whitespace-normal text-left ${PROVIDER_STATE_TONE[payment.state] ?? ''}`} data-testid="provider-payment-state">
              {payment.state_label}
            </Badge>
            {payment.simulated && <Badge variant="outline" data-testid="provider-payment-simulated">Simulated provider (test)</Badge>}
          </div>
          <p className="text-xs text-gray-500">Started {dateTimeLabel(payment.initiated_at)}</p>
          <p className="text-xs text-gray-600" data-testid="provider-payment-source">{payment.source_label}</p>
          {discrepancies.map((d) => (
            <p key={d.id} className="text-xs text-red-800" data-testid="provider-payment-discrepancy">
              Under review: {DISCREPANCY_LABEL[d.type] ?? d.type}{d.amount ? ` (${formatMoney(d.amount, payment.currency)})` : ''}. CarUp operations has been alerted.
            </p>
          ))}
        </div>
        {canAct && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline" className="min-h-11" disabled={busy} data-testid="provider-payment-reconcile"
              onClick={() => run('closeout', () => reconcileGarageProviderPayment(payment.id), 'Checked with the payment provider.')}
            >
              Check with the provider
            </Button>
            {payment.state === 'confirmed' && (
              <Button variant="outline" className="min-h-11" disabled={busy} data-testid="provider-payment-refund" onClick={() => setOpen(open === 'refund' ? null : 'refund')}>
                Refund
              </Button>
            )}
            {payment.state === 'awaiting_provider' && (
              <Button variant="outline" className="min-h-11" disabled={busy} data-testid="provider-payment-stop" onClick={() => setOpen(open === 'stop' ? null : 'stop')}>
                Stop this checkout
              </Button>
            )}
          </div>
        )}
      </div>
      {open === 'refund' && (
        <ReasonAction
          testId="provider-refund-form" label="Why are you refunding this payment?" minLength={10} busy={busy}
          hint="The full amount goes back to the customer through the provider. It stops counting on the invoice at once and its receipt is voided."
          submitLabel="Refund the full amount" onClose={() => setOpen(null)}
          onSubmit={(reason) => run('closeout', () => refundGarageProviderPayment(payment.id, reason), 'Refund sent to the provider. The invoice shows what the provider confirmed.')}
        />
      )}
      {open === 'stop' && (
        <ReasonAction
          testId="provider-stop-form" label="Why stop this checkout?" minLength={3} busy={busy}
          hint="Nothing has been paid. Stopping releases the amount it was holding on the invoice."
          submitLabel="Stop the checkout" onClose={() => setOpen(null)}
          onSubmit={(reason) => run('closeout', () => cancelGarageProviderPayment(payment.id, reason), 'Checkout stopped.')}
        />
      )}
    </li>
  )
}

/** The provider side of one invoice: payments through the garage's own provider merchant and their receipts. */
export function ProviderPaymentsPanel({ invoice, canAct, busy, run }: {
  invoice: GarageInvoice
  canAct: boolean
  busy: boolean
  run: HubRun
}) {
  if (!invoice.provider_payments_supported) return null
  const payments = invoice.provider_payments ?? []
  const receipts = invoice.provider_receipts ?? []
  if (payments.length === 0 && receipts.length === 0) return null
  return (
    <div className="space-y-3" data-testid="provider-payments">
      <div>
        <h4 className="text-sm font-semibold">Payments through the garage’s payment provider</h4>
        <p className="text-xs text-gray-600">{invoice.provider_source_label}</p>
      </div>
      {payments.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="provider-payment-list">
          {payments.map((p) => <PaymentRow key={p.id} payment={p} currency={invoice.currency} canAct={canAct && invoice.status === 'issued'} busy={busy} run={run} />)}
        </ul>
      )}
      {receipts.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="provider-receipts">
          {receipts.map((r) => (
            <li key={r.id} className="p-3 text-sm" data-testid="provider-receipt-row">
              <p className="font-medium">Receipt {r.receipt_number}: {formatMoney(r.amount, r.currency)}{r.status === 'voided' ? ' (voided)' : ''}</p>
              <p className="text-xs text-gray-500">{r.status === 'voided' && r.voided_at ? `Voided ${dateTimeLabel(r.voided_at)}` : `Issued ${dateTimeLabel(r.issued_at)}`}</p>
              <p className="text-xs text-gray-600" data-testid="provider-receipt-source">{r.payment_source_label}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
