/**
 * CARUP-PAY-03B — mandatory, text-carrying labels (meaning is never carried by colour alone).
 *
 * A sandbox fixture plan must always say it is not a commercial offer, and a simulated provider must
 * always say it is not Stripe. These are the only two sanctioned spellings.
 */
import { FlaskConical, MonitorCog } from 'lucide-react'
import { PAY03B_SANDBOX_PLAN_LABEL, PAY03B_SIMULATED_PROVIDER_LABEL } from '@/lib/pay03bDisplay'

export function Pay03bSandboxLabel({ testId = 'pay03b-sandbox-label' }: { testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="inline-flex max-w-full items-start gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 [overflow-wrap:anywhere]"
    >
      <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{PAY03B_SANDBOX_PLAN_LABEL}</span>
    </span>
  )
}

export function Pay03bSimulatedLabel({ testId = 'pay03b-simulated-label' }: { testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="inline-flex max-w-full items-start gap-1 rounded-sm border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-900 [overflow-wrap:anywhere]"
    >
      <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{PAY03B_SIMULATED_PROVIDER_LABEL}</span>
    </span>
  )
}
