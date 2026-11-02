import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  PAYMENT_STATUS_LABEL,
  formatMoney,
  type CustomerInvoice,
  type EstimateLineCategory,
  type PaymentRecord,
} from '@/lib/garageBusiness'
import { requestDate } from '@/lib/serviceRequests'

/**
 * One invoice as the CUSTOMER sees it.
 *
 * Payment state is the server's `payment_status`, never inferred here. An issued invoice is not a
 * payment and a finished job is not a payment: the only money this card calls "recorded" is what the
 * garage entered, and the server's `payment_source_label` (it says CarUp did not process or verify it)
 * sits beside every payment and every receipt. The estimate-vs-invoice difference is the server's
 * `variance`; nothing is added, subtracted or compared in the browser.
 */

const CATEGORY_LABEL: Record<EstimateLineCategory, string> = {
  labour: 'Labour', part: 'Part', fee: 'Fee', other: 'Other',
}

const METHOD_LABEL: Record<PaymentRecord['method'], string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  card_external: 'Card (taken outside CarUp)',
  other: 'Other method',
}

const DIRECTION_LABEL = {
  same: 'same as the estimate',
  over_estimate: 'above the estimate',
  under_estimate: 'below the estimate',
} as const

const PAYMENT_TONE: Record<string, string> = {
  unpaid: 'bg-gray-100 text-gray-800 border-gray-300',
  partially_paid: 'bg-amber-100 text-amber-900 border-amber-300',
  paid: 'bg-green-100 text-green-900 border-green-300',
  voided: 'bg-red-100 text-red-900 border-red-300',
}

export default function InvoiceCard({ invoice: inv }: { invoice: CustomerInvoice }) {
  const uid = useId()
  const titleId = `${uid}-title`
  const voided = inv.status === 'voided'
  const statusLabel = voided ? 'Voided' : (PAYMENT_STATUS_LABEL[inv.payment_status] ?? 'Payment status not recorded')
  const tone = voided ? PAYMENT_TONE.voided : (PAYMENT_TONE[inv.payment_status] ?? '')

  return (
    <article className="rounded-lg border bg-white p-4" aria-labelledby={titleId} data-testid="invoice-card" data-payment-status={inv.payment_status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={titleId} className="font-semibold text-gray-900">Invoice {inv.invoice_number}</h4>
        <Badge variant="outline" className={`whitespace-normal text-left ${tone}`} data-testid="invoice-payment-status">{statusLabel}</Badge>
      </div>

      <p className="mt-1 text-xs text-gray-600">
        Issued {requestDate(inv.issued_at)}
        {' · '}
        {inv.due_date ? `Due ${requestDate(inv.due_date)}` : 'No due date recorded'}
      </p>
      {voided && (
        <p className="mt-2 text-sm text-gray-700" data-testid="invoice-voided-note">
          {inv.voided_at ? `The garage voided this invoice on ${requestDate(inv.voided_at)}.` : 'The garage voided this invoice.'}
        </p>
      )}

      {inv.lines.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">No line items are recorded on this invoice.</p>
      ) : (
        <table className="mt-3 w-full table-fixed border-collapse text-left text-xs sm:text-sm" data-testid="invoice-lines">
          <caption className="sr-only">Lines of invoice {inv.invoice_number}</caption>
          <thead>
            <tr className="border-b text-gray-600">
              <th scope="col" className="w-[34%] py-1 pr-2 font-medium">Description</th>
              <th scope="col" className="w-[12%] py-1 pr-2 text-right font-medium">Qty</th>
              <th scope="col" className="w-[27%] py-1 pr-2 text-right font-medium">Unit price</th>
              <th scope="col" className="w-[27%] py-1 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((line) => (
              <tr key={line.line_no} className="border-b align-top last:border-0">
                <td className="py-2 pr-2 break-words">
                  {line.description}
                  <span className="block text-[11px] text-gray-500">{CATEGORY_LABEL[line.category] ?? line.category}</span>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 pr-2 text-right tabular-nums break-words">{formatMoney(line.unit_price, inv.currency)}</td>
                <td className="py-2 text-right tabular-nums break-words">{formatMoney(line.line_total, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="mt-3 space-y-1 border-t pt-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="font-medium text-gray-900">Invoice total</dt>
          <dd className="font-semibold tabular-nums" data-testid="invoice-total">{formatMoney(inv.total_amount, inv.currency)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-gray-700">Payments recorded by the garage</dt>
          <dd className="tabular-nums" data-testid="invoice-recorded-amount">{formatMoney(inv.paid_amount, inv.currency)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-gray-700">Balance</dt>
          <dd className="tabular-nums" data-testid="invoice-balance">{formatMoney(inv.balance_amount, inv.currency)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-gray-600" data-testid="invoice-source-label">{inv.payment_source_label}</p>

      {inv.customer_note && (
        <p className="mt-3 border-l-2 border-gray-200 pl-3 text-sm text-gray-700" data-testid="invoice-note">
          <span className="block text-xs font-medium text-gray-500">Note from the garage</span>
          {inv.customer_note}
        </p>
      )}

      {inv.variance.state === 'comparable' && (
        <p className="mt-3 text-sm text-gray-800" data-testid="invoice-variance">
          {`Estimate ${formatMoney(inv.variance.estimate_total, inv.variance.currency)} → final invoice ${formatMoney(inv.variance.invoice_total, inv.variance.currency)} (difference ${inv.variance.difference} ${inv.variance.currency}, ${DIRECTION_LABEL[inv.variance.direction] ?? inv.variance.direction})`}
        </p>
      )}
      {inv.variance.state === 'not_comparable' && (
        <p className="mt-3 text-sm text-gray-800" data-testid="invoice-variance">
          {inv.variance.reason}
        </p>
      )}
      {inv.variance.state === 'no_estimate' && (
        <p className="mt-3 text-xs text-gray-600" data-testid="invoice-variance">
          This invoice is not linked to an estimate, so there is nothing to compare it with.
        </p>
      )}

      <section className="mt-4" aria-label={`Payments recorded for invoice ${inv.invoice_number}`} data-testid="invoice-payments">
        <h5 className="text-sm font-semibold text-gray-900">Payments</h5>
        {inv.payments.length === 0 ? (
          <p className="mt-1 text-sm text-gray-600">The garage has recorded no payments against this invoice.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {inv.payments.map((p) => (
              <li key={p.id} className="rounded-md border bg-gray-50 p-3 text-sm" data-testid="invoice-payment">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">{p.kind === 'reversal' ? 'Payment reversed by the garage' : 'Payment recorded by the garage'}</span>
                  <span className="tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                </p>
                <p className="text-xs text-gray-600">
                  {METHOD_LABEL[p.method] ?? p.method}
                  {p.reference ? ` · Reference ${p.reference}` : ''}
                  {' · '}{requestDate(p.paid_at)}
                </p>
                <p className="mt-1 text-xs text-gray-700" data-testid="payment-source-label">{p.source_label}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4" aria-label={`Receipts for invoice ${inv.invoice_number}`} data-testid="invoice-receipts">
        <h5 className="text-sm font-semibold text-gray-900">Receipts</h5>
        {inv.receipts.length === 0 ? (
          <p className="mt-1 text-sm text-gray-600">No receipts have been issued for this invoice.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {inv.receipts.map((r) => (
              <li key={r.id} className="rounded-md border bg-gray-50 p-3 text-sm" data-testid="invoice-receipt">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">Receipt {r.receipt_number}</span>
                  <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span>
                </p>
                <p className="text-xs text-gray-600">
                  {r.status === 'voided'
                    ? `Voided${r.voided_at ? ` ${requestDate(r.voided_at)}` : ''}`
                    : `Issued ${requestDate(r.issued_at)}`}
                </p>
                <p className="mt-1 text-xs text-gray-700" data-testid="receipt-source-label">{r.payment_source_label}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
