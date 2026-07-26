/**
 * SafeTradeAssuranceNotice — the MANDATORY non-custodial assurance banner.
 *
 * Rendered verbatim on every SafeTrade surface (list + detail). The exact wording is load-bearing and
 * asserted by unit + e2e tests. It must NEVER claim CarUp holds, receives or automatically releases
 * real customer funds, nor represent CarUp as a bank / escrow custodian / regulated payment provider /
 * customs authority / delivery guarantor. SafeTrade is assurance coordination + sandbox payment-state
 * simulation only.
 */
import { ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  SAFETRADE_NON_CUSTODIAL_NOTICE,
  SAFETRADE_VERIFIED_STATES_NOTICE,
} from '@/config/safeTradeFlag'

export interface SafeTradeAssuranceNoticeProps {
  testId?: string
}

export function SafeTradeAssuranceNotice({ testId = 'safetrade-assurance-notice' }: SafeTradeAssuranceNoticeProps) {
  return (
    <Alert
      className="border-slate-200 bg-slate-50"
      role="note"
      aria-label="SafeTrade non-custodial assurance notice"
      data-testid={testId}
    >
      <ShieldCheck className="h-4 w-4 text-slate-700" aria-hidden="true" />
      <AlertTitle>How SafeTrade works (non-custodial)</AlertTitle>
      <AlertDescription>
        <p data-testid={`${testId}-primary`}>{SAFETRADE_NON_CUSTODIAL_NOTICE}</p>
        <p className="mt-2" data-testid={`${testId}-verified`}>{SAFETRADE_VERIFIED_STATES_NOTICE}</p>
      </AlertDescription>
    </Alert>
  )
}

export default SafeTradeAssuranceNotice
