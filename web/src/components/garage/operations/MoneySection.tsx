import { formatMoney, type OperationsSummary } from '@/lib/garageBusiness'
import { HowCounted, Section } from './OperationsParts'

/**
 * Money, as recorded — per currency, one line per currency, never added or converted across them.
 *
 * Two different things are on this page and neither is the other:
 *  - "invoiced" is a document total the garage issued;
 *  - "recorded payments" are what the garage itself says it received outside CarUp, which CarUp has
 *    not processed or verified. The server's `note` and each payment line's `label` say so, and both
 *    are shown exactly as the server states them.
 */
export function MoneySection({ money }: { money: OperationsSummary['money'] }) {
  const outstandingDefinition = money.outstanding_by_currency[0]?.definition
  return (
    <Section id="money" title="Money, as recorded" intro="Amounts are shown per currency. They are never added together or converted.">
      <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 max-w-prose" data-testid="money-note">{money.note}</p>

      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <div data-testid="money-invoiced">
          <h3 className="font-medium">Invoiced in this window</h3>
          <p className="text-xs text-gray-500">Totals of the invoices the garage issued. An invoice is a document, not a payment.</p>
          {money.invoiced_by_currency.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No invoices were issued in this window.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {money.invoiced_by_currency.map((line) => (
                <li key={line.currency} className="py-2 text-sm flex flex-wrap justify-between gap-2" data-testid={`invoiced-${line.currency}`}>
                  <span className="font-semibold tabular-nums">{formatMoney(line.total, line.currency)}</span>
                  <span className="text-gray-600">{line.invoices} {line.invoices === 1 ? 'invoice' : 'invoices'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div data-testid="money-outstanding">
          <h3 className="font-medium">Outstanding on live invoices</h3>
          <p className="text-xs text-gray-500">Invoice totals less the payments the garage recorded.</p>
          {money.outstanding_by_currency.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No live invoice has a balance outstanding.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {money.outstanding_by_currency.map((line) => (
                <li key={line.currency} className="py-2 text-sm" data-testid={`outstanding-${line.currency}`}>
                  <span className="font-semibold tabular-nums">{formatMoney(line.balance, line.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <HowCounted definition={outstandingDefinition} />
        </div>

        <div data-testid="money-recorded-payments">
          <h3 className="font-medium">Payments recorded by the garage in this window</h3>
          {money.recorded_payments_by_currency.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">The garage recorded no payments in this window.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {money.recorded_payments_by_currency.map((line) => (
                <li key={line.currency} className="py-2 text-sm" data-testid={`recorded-${line.currency}`}>
                  <p className="font-semibold tabular-nums">{formatMoney(line.net_recorded, line.currency)} <span className="font-normal text-gray-600">net of reversals</span></p>
                  <p className="text-xs text-gray-600">{line.label}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div data-testid="money-estimate-vs-invoice">
          <h3 className="font-medium">Estimate compared with invoice</h3>
          {money.estimate_vs_invoice.by_currency.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No job invoiced in this window can be compared with its estimate.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {money.estimate_vs_invoice.by_currency.map((line) => (
                <li key={line.currency} className="py-2 text-sm" data-testid={`variance-${line.currency}`}>
                  <p className="font-medium">{line.currency}: {line.jobs} {line.jobs === 1 ? 'job' : 'jobs'}</p>
                  <p className="text-gray-700">Estimated {formatMoney(line.estimate_total, line.currency)}, invoiced {formatMoney(line.invoice_total, line.currency)}</p>
                  <p className="text-gray-700">Difference {formatMoney(line.difference, line.currency)}</p>
                </li>
              ))}
            </ul>
          )}
          {money.estimate_vs_invoice.not_comparable > 0 && (
            <p className="mt-1 text-sm text-gray-600">
              {money.estimate_vs_invoice.not_comparable} {money.estimate_vs_invoice.not_comparable === 1 ? 'job was' : 'jobs were'} not compared, because the estimate and the invoice are in different currencies.
            </p>
          )}
          <HowCounted definition={money.estimate_vs_invoice.definition} />
        </div>
      </div>
    </Section>
  )
}
