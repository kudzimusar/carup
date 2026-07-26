/**
 * SafeTradeMilestones — the escrow-milestone plan, framed as SANDBOX SIMULATION.
 *
 * Shows each milestone's label, amount + currency, sandbox held/released/refunded SIMULATION status,
 * required evidence categories and reviewer requirement. It NEVER states CarUp holds or releases real
 * funds: every money state is explicitly a sandbox simulation. Money actions are not rendered here —
 * they live in SafeTradeActions and are gated by the server available-actions projection.
 */
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatMoney,
  milestoneStatusLabel,
  milestoneHeldTotal,
} from './safeTradeHelpers'
import { SAFETRADE_SANDBOX_LABEL } from '@/config/safeTradeFlag'
import type { SafeTradeMilestone } from '@/types'

export interface SafeTradeMilestonesProps {
  milestones: SafeTradeMilestone[]
  currency?: string
  testId?: string
}

export function SafeTradeMilestones({ milestones, currency = 'USD', testId = 'safetrade-milestones' }: SafeTradeMilestonesProps) {
  const total = milestoneHeldTotal(milestones)

  return (
    <Card data-testid={testId} aria-label="SafeTrade milestones">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Milestones</CardTitle>
          <span className="text-xs text-gray-500" data-testid={`${testId}-total`}>
            Plan total {formatMoney(total, currency)}
          </span>
        </div>
        <p className="text-xs text-gray-500" data-testid={`${testId}-sandbox`}>{SAFETRADE_SANDBOX_LABEL}</p>
      </CardHeader>
      <CardContent>
        {milestones.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid={`${testId}-empty`}>No milestones have been defined for this case yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100" role="list">
            {milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`${testId}-row`} data-milestone-status={m.status}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {humanizeType(m.milestone_type)} <span className="text-xs text-gray-400">#{m.sequence}</span>
                  </p>
                  {Array.isArray(m.evidence_requirements) && m.evidence_requirements.length > 0 && (
                    <p className="text-xs text-gray-500" data-testid={`${testId}-evidence`}>
                      Evidence: {m.evidence_requirements.join(', ')}
                    </p>
                  )}
                  {m.release_trigger && (
                    <p className="text-xs text-gray-400">Release: {humanizeType(m.release_trigger)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900" data-testid={`${testId}-amount`}>{formatMoney(m.amount, m.currency || currency)}</span>
                  <Badge variant="secondary" data-testid={`${testId}-status`}>{milestoneStatusLabel(m.status)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function humanizeType(t: string | null | undefined): string {
  if (!t) return '—'
  return String(t)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export default SafeTradeMilestones
