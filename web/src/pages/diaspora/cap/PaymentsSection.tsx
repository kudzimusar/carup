import { Wallet } from 'lucide-react'
import type { JourneyNotComposed, JourneyPayments } from '@/hooks/useTradeLogisticsApi'
import { shortDate } from '../journeyDisplay'
import { CapSection, Unshown } from './ui'

const moneyText = (amount: number | null, currency: string | null) => {
  if (amount === null || amount === undefined) return 'Amount not recorded'
  // An amount with no currency is not a price: say so rather than invent a currency.
  return currency ? `${currency} ${amount.toLocaleString()}` : `${amount.toLocaleString()} (currency not recorded)`
}

/**
 * Payments, from the milestones that exist and nothing else. "No payment is recorded for this purchase." is a sentence about the record; it is not
 * a statement that nothing was paid, and nothing here is inferred from a document, from ownership or from a listing price.
 */
export function PaymentsSection({ payments }: { payments: JourneyPayments | JourneyNotComposed | undefined }) {
  if (!payments || payments.availability === 'not_yet_composed') return null
  const icon = <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (payments.availability !== 'composed') {
    return <CapSection id="cap-payments" title="Payments" icon={icon}><Unshown availability={payments.availability} note={payments.note} testId="cap-payments-unshown" /></CapSection>
  }
  return (
    <CapSection id="cap-payments" title="Payments" icon={icon}>
      {payments.milestones.length ? (
        <ul className="mt-3 space-y-2" data-testid="cap-payments-list">
          {payments.milestones.map((m, i) => (
            <li key={`${m.type}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
              <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{m.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} — {moneyText(m.amount, m.currency)}</p>
              <p className="min-w-0 break-words text-xs text-slate-600">{m.status.replace(/_/g, ' ').toLowerCase()}{m.due_date ? ` · due ${shortDate(m.due_date)}` : ''}{m.confirmed_at ? ` · confirmed ${shortDate(m.confirmed_at)}` : ''}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="cap-payments-none">{payments.note}</p>
      )}
      <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-payments-disclaimer">{payments.disclaimer}</p>
    </CapSection>
  )
}
