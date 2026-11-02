import { useId } from 'react'
import type { CustomerEstimate, CustomerInvoice } from '@/lib/garageBusiness'
import EstimateCard from './EstimateCard'
import InvoiceCard from './InvoiceCard'
import type { Loadable } from './JourneyProgress'

/**
 * The estimates and invoices of ONE service request (already grouped by `service_case_id` by the page).
 *
 * Three honest states for each list: still loading, could not be loaded (never rendered as "none"),
 * and loaded. An empty list is only stated where an estimate or invoice could plausibly exist, so a
 * declined or brand-new request is not cluttered with "nothing here" lines.
 */

type Props = {
  estimates: Loadable<CustomerEstimate>
  invoices: Loadable<CustomerInvoice>
  /** The request's status when the request is on screen; `null` for records that belong to no listed request. */
  requestStatus: string | null
  onDecide: (estimateId: string, decision: 'accept' | 'decline', reason?: string) => Promise<void>
}

export default function CaseCommercial({ estimates, invoices, requestStatus, onDecide }: Props) {
  const estimatesTitleId = useId()
  const invoicesTitleId = useId()
  const status = String(requestStatus ?? '').toLowerCase()

  const orderedEstimates = [...estimates.items].sort((a, b) => b.version - a.version)
  const [currentEstimate, ...earlierEstimates] = orderedEstimates
  const orderedInvoices = [...invoices.items].sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)))

  const showNoEstimate = estimates.status === 'ready' && orderedEstimates.length === 0 && ['accepted', 'active', 'completed'].includes(status)
  const showNoInvoice = invoices.status === 'ready' && orderedInvoices.length === 0 && status === 'completed'

  const loading = estimates.status === 'loading' || invoices.status === 'loading'
  const estimatesFailed = estimates.status === 'error'
  const invoicesFailed = invoices.status === 'error'

  const nothingToSay = !loading && !estimatesFailed && !invoicesFailed
    && orderedEstimates.length === 0 && orderedInvoices.length === 0 && !showNoEstimate && !showNoInvoice
  if (nothingToSay) return null

  return (
    <div className="mt-4 space-y-4" data-testid="case-commercial">
      {loading && (
        <p role="status" className="text-sm text-gray-600" data-testid="commercial-loading">Loading estimates and invoices…</p>
      )}

      {(estimatesFailed || invoicesFailed) && (
        <p className="text-sm text-amber-800" data-testid="commercial-unavailable">
          {estimatesFailed && invoicesFailed
            ? 'Estimates and invoices are not shown for this request because they did not load. See the notice at the top of the page.'
            : estimatesFailed
              ? 'Estimates are not shown for this request because they did not load. See the notice at the top of the page.'
              : 'Invoices are not shown for this request because they did not load. See the notice at the top of the page.'}
        </p>
      )}

      {(orderedEstimates.length > 0 || showNoEstimate) && (
        <section aria-labelledby={estimatesTitleId} data-testid="estimates-section">
          <h3 id={estimatesTitleId} className="mb-2 text-sm font-semibold text-gray-900">Estimates</h3>
          {currentEstimate ? (
            <div className="space-y-3">
              <EstimateCard estimate={currentEstimate} onDecide={onDecide} />
              {earlierEstimates.length > 0 && (
                <details className="rounded-lg border bg-gray-50 p-3" data-testid="earlier-estimates">
                  <summary className="block min-h-11 cursor-pointer py-3 text-sm font-medium text-gray-800">
                    Earlier versions ({earlierEstimates.length})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {earlierEstimates.map((e) => <EstimateCard key={e.id} estimate={e} onDecide={onDecide} />)}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-600" data-testid="no-estimates">No estimate has been sent to you for this request.</p>
          )}
        </section>
      )}

      {(orderedInvoices.length > 0 || showNoInvoice) && (
        <section aria-labelledby={invoicesTitleId} data-testid="invoices-section">
          <h3 id={invoicesTitleId} className="mb-2 text-sm font-semibold text-gray-900">Invoices</h3>
          {orderedInvoices.length > 0 ? (
            <div className="space-y-3">
              {orderedInvoices.map((i) => <InvoiceCard key={i.id} invoice={i} />)}
            </div>
          ) : (
            <p className="text-sm text-gray-600" data-testid="no-invoices">The garage has not issued an invoice for this request.</p>
          )}
        </section>
      )}
    </div>
  )
}
