/**
 * CARUP-PAY-03B — subscription invoices with BOTH statuses kept distinct:
 *  - the provider invoice status (draft / open / paid / void …), and
 *  - the CANONICAL payment status (public.payment_transactions) — the only money authority.
 * A provider "paid" invoice is not access by itself; paid coverage is derived by CarUp.
 *
 * Responsive: a real table from `md` up; below `md` each invoice stacks into labelled rows so the
 * page never scrolls sideways and every action stays reachable.
 */
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  describePay03bBillingReason,
  describePay03bInvoiceStatus,
  describePay03bPaymentStatus,
  formatPay03bDateTime,
  formatPay03bMinor,
  humanizePay03bToken,
} from '@/lib/pay03bDisplay'
import type { Pay03bInvoice } from '@/types/pay03b'

export interface Pay03bInvoicesTableProps {
  invoices: Pay03bInvoice[]
  /** e.g. 'pay03b' → rows are `pay03b-invoice-<providerInvoiceId>`; 'pay03b-admin' for the console. */
  testIdPrefix: string
  renderAction?: (invoice: Pay03bInvoice) => ReactNode
  /** Accessible name for the table. */
  label: string
}

function MobileLabel({ children }: { children: ReactNode }) {
  return <span className="w-28 shrink-0 text-xs font-medium text-gray-500 md:hidden">{children}</span>
}

const cellClass = 'whitespace-normal align-top max-md:flex max-md:gap-2 max-md:px-1 max-md:py-1'

function paymentTone(status: string | null): string {
  if (status === 'paid') return 'border-emerald-300 bg-emerald-50 text-emerald-900'
  if (status === 'reconciliation_hold') return 'border-red-300 bg-red-50 text-red-900'
  if (status === 'refunded' || status === 'refund_pending') return 'border-slate-300 bg-slate-100 text-slate-800'
  return 'border-gray-300 bg-white text-gray-700'
}

export function Pay03bInvoicesTable({ invoices, testIdPrefix, renderAction, label }: Pay03bInvoicesTableProps) {
  return (
    <Table aria-label={label} className="max-md:block" data-testid={`${testIdPrefix}-invoices-table`}>
      <TableHeader className="max-md:hidden">
        <TableRow>
          <TableHead>Period</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Provider invoice</TableHead>
          <TableHead>CarUp payment record</TableHead>
          {renderAction ? <TableHead>Action</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody className="max-md:block">
        {invoices.map((invoice) => {
          const due = formatPay03bMinor(invoice.amountDueMinor, invoice.currency)
          const paid = formatPay03bMinor(invoice.amountPaidMinor, invoice.currency)
          const action = renderAction ? renderAction(invoice) : null
          return (
            <TableRow
              key={invoice.id}
              data-testid={`${testIdPrefix}-invoice-${invoice.providerInvoiceId}`}
              className="max-md:mb-3 max-md:block max-md:rounded-md max-md:border max-md:bg-white max-md:p-2"
            >
              <TableCell className={cellClass}>
                <MobileLabel>Period</MobileLabel>
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">
                    {formatPay03bDateTime(invoice.periodStart) ?? '—'} – {formatPay03bDateTime(invoice.periodEnd) ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500">{describePay03bBillingReason(invoice.billingReason)}</div>
                  <div className="font-mono text-[11px] text-gray-400 [overflow-wrap:anywhere]">{invoice.providerInvoiceId}</div>
                </div>
              </TableCell>
              <TableCell className={cellClass}>
                <MobileLabel>Amount</MobileLabel>
                <div className="min-w-0">
                  <div className="font-semibold tabular-nums text-gray-900" data-testid={`${testIdPrefix}-invoice-amount-${invoice.providerInvoiceId}`}>
                    {due ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500 tabular-nums">Paid: {paid ?? '—'}</div>
                </div>
              </TableCell>
              <TableCell className={cellClass}>
                <MobileLabel>Provider invoice</MobileLabel>
                <div className="min-w-0 space-y-1">
                  <Badge variant="outline" className="whitespace-normal text-left">
                    {describePay03bInvoiceStatus(invoice.providerStatus)}
                  </Badge>
                  {invoice.attemptCount > 0 ? (
                    <div className="text-xs text-gray-500">Payment attempts: {invoice.attemptCount}</div>
                  ) : null}
                  {invoice.anomaly ? (
                    <div className="flex items-start gap-1 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">Anomaly: {humanizePay03bToken(invoice.anomaly)} — does not extend access</span>
                    </div>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className={cellClass}>
                <MobileLabel>CarUp payment</MobileLabel>
                <div className="min-w-0 space-y-1">
                  <Badge
                    variant="outline"
                    className={`whitespace-normal text-left ${paymentTone(invoice.paymentStatus)}`}
                    data-testid={`${testIdPrefix}-invoice-payment-${invoice.providerInvoiceId}`}
                  >
                    {describePay03bPaymentStatus(invoice.paymentStatus)}
                  </Badge>
                  {invoice.paymentReference ? (
                    <div className="font-mono text-[11px] text-gray-400 [overflow-wrap:anywhere]">{invoice.paymentReference}</div>
                  ) : null}
                </div>
              </TableCell>
              {renderAction ? (
                <TableCell className={cellClass}>
                  <MobileLabel>Action</MobileLabel>
                  <div className="min-w-0">{action ?? <span className="text-xs text-gray-400">—</span>}</div>
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
