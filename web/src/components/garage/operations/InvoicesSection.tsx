import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PAYMENT_STATUS_LABEL, formatMoney, type Decimal, type GarageInvoice } from '@/lib/garageBusiness'
import { Section, whenText } from './OperationsParts'

export type InvoiceStatusFilter = 'all' | 'issued' | 'voided'

export type InvoicesPayload = {
  invoices: GarageInvoice[]
  /** the server returns only the most recent 200 invoices; true means older ones were left out */
  truncated: boolean
  summary: {
    issued: number
    unpaid: number
    partially_paid: number
    paid: number
    outstanding_by_currency: Array<{ currency: string; balance: Decimal | null }>
  }
}

/**
 * The garage's invoices. Payment state is the server's `payment_status` — derived from the payments the
 * garage recorded — and wherever a payment figure appears, the server's `payment_source_label` appears
 * with it: those payments were recorded by the garage and CarUp has neither processed nor verified them.
 * Each row opens the service case it belongs to.
 */
export function InvoicesSection({ state, data, error, status, onStatusChange, onRetry }: {
  state: 'loading' | 'ready' | 'error'
  data: InvoicesPayload | null
  error: string | null
  status: InvoiceStatusFilter
  onStatusChange: (next: InvoiceStatusFilter) => void
  onRetry: () => void
}) {
  const sourceLabel = data?.invoices.find((i) => i.payment_source_label)?.payment_source_label ?? null
  return (
    <Section id="invoices" title="Invoices" intro="Each invoice opens its service case. Payment states come from the payments the garage recorded.">
      <div className="max-w-xs">
        <label htmlFor="invoice-status-filter" className="block text-sm font-medium mb-1">Invoice status</label>
        <select id="invoice-status-filter" className="w-full min-h-11 rounded-md border px-3" value={status} onChange={(e) => onStatusChange(e.target.value as InvoiceStatusFilter)}>
          <option value="all">All invoices</option>
          <option value="issued">Issued</option>
          <option value="voided">Voided</option>
        </select>
      </div>

      {state === 'loading' && (
        <div className="mt-4 flex items-center gap-3" role="status">
          <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm">Loading invoices…</span>
        </div>
      )}

      {state === 'error' && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="invoices-error">
          <p className="font-medium">Invoices could not be loaded</p>
          {error && <p>{error}</p>}
          <p>This is a loading problem, not a statement that there are no invoices.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={onRetry}>Try again</Button>
        </div>
      )}

      {state === 'ready' && data && (
        <>
          {data.truncated === true && (
            <div role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="invoices-truncated">
              This list shows only the most recent 200 invoices and may be partial. The counts below are for the invoices in this list only, not for every invoice the garage has issued.
            </div>
          )}
          <div className="mt-4" data-testid="invoice-summary">
            <h3 className="font-medium">Counts for the list below</h3>
            <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-gray-500">Issued invoices</dt><dd className="font-semibold tabular-nums" data-testid="invoice-count-issued">{data.summary.issued}</dd></div>
              <div><dt className="text-gray-500">{PAYMENT_STATUS_LABEL.unpaid}</dt><dd className="font-semibold tabular-nums" data-testid="invoice-count-unpaid">{data.summary.unpaid}</dd></div>
              <div><dt className="text-gray-500">{PAYMENT_STATUS_LABEL.partially_paid}</dt><dd className="font-semibold tabular-nums" data-testid="invoice-count-partial">{data.summary.partially_paid}</dd></div>
              <div><dt className="text-gray-500">{PAYMENT_STATUS_LABEL.paid}</dt><dd className="font-semibold tabular-nums" data-testid="invoice-count-paid">{data.summary.paid}</dd></div>
            </dl>
            {data.summary.outstanding_by_currency.length > 0 && (
              <div className="mt-2 text-sm" data-testid="invoice-outstanding">
                <p className="text-gray-500">Outstanding on issued invoices, per currency</p>
                <ul>
                  {data.summary.outstanding_by_currency.map((line) => (
                    <li key={line.currency} className="font-semibold tabular-nums">{formatMoney(line.balance, line.currency)}</li>
                  ))}
                </ul>
              </div>
            )}
            {sourceLabel && <p className="mt-2 text-xs text-gray-600" data-testid="invoice-source-label">{sourceLabel}</p>}
          </div>

          {data.invoices.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600" data-testid="invoices-empty">No invoices match this filter.</p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-200 border-y border-gray-200" data-testid="invoice-list">
              {data.invoices.map((inv) => {
                const paymentsShown = inv.payment_status !== 'unpaid'
                return (
                  <li key={inv.id}>
                    <Link to={`/garage/cases/${inv.service_case_id}`} className="block py-3 hover:bg-gray-50" data-testid="invoice-row">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{inv.invoice_number}</p>
                          <p className="text-xs text-gray-500">
                            {inv.status === 'voided' ? 'Voided invoice' : 'Issued'} {whenText(inv.status === 'voided' && inv.voided_at ? inv.voided_at : inv.issued_at)}
                            {inv.due_date ? `, due ${whenText(inv.due_date)}` : ''}
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums">{formatMoney(inv.total_amount, inv.currency)}</p>
                      </div>
                      <p className="mt-1 text-sm">{PAYMENT_STATUS_LABEL[inv.payment_status] ?? inv.payment_status}</p>
                      {paymentsShown && inv.status === 'issued' && (
                        <p className="text-sm text-gray-700">
                          Recorded payments {formatMoney(inv.paid_amount, inv.currency)}, balance {formatMoney(inv.balance_amount, inv.currency)}
                        </p>
                      )}
                      {inv.status === 'issued' && !paymentsShown && (
                        <p className="text-sm text-gray-700">Balance {formatMoney(inv.balance_amount, inv.currency)}</p>
                      )}
                      {paymentsShown && inv.status === 'issued' && inv.payment_source_label && <p className="text-xs text-gray-600">{inv.payment_source_label}</p>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </Section>
  )
}
