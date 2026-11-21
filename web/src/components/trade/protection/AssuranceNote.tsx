/**
 * RX-06 Protection — the mandatory non-custodial assurance notice, in the Trade desk style.
 *
 * The wording is the shared, load-bearing constants (config/safeTradeFlag) rendered verbatim: CarUp does
 * not hold, receive or automatically release real customer funds; live payment or escrow is not active.
 */
import { ShieldCheck } from 'lucide-react'
import { SAFETRADE_NON_CUSTODIAL_NOTICE, SAFETRADE_VERIFIED_STATES_NOTICE } from '@/config/safeTradeFlag'

export function AssuranceNote({ testId = 'trade-safetrade-assurance' }: { testId?: string }) {
  return (
    <aside
      role="note"
      aria-label="SafeTrade non-custodial assurance notice"
      data-testid={testId}
      className="flex items-start gap-3 rounded-card border border-carup-line-strong bg-carup-bg-surface p-4"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-status-info-soft text-status-info" aria-hidden="true">
        <ShieldCheck className="h-4 w-4" />
      </span>
      <div className="min-w-0 text-sm leading-6">
        <p className="font-semibold text-carup-text">Non-custodial: CarUp coordinates assurance, it does not hold money</p>
        <p className="mt-1 text-carup-text-2" data-testid={`${testId}-primary`}>{SAFETRADE_NON_CUSTODIAL_NOTICE}</p>
        <p className="mt-1 text-carup-text-2" data-testid={`${testId}-verified`}>{SAFETRADE_VERIFIED_STATES_NOTICE}</p>
      </div>
    </aside>
  )
}
