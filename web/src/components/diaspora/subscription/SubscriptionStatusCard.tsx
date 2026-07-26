/**
 * SubscriptionStatusCard — the tenant's current subscription at a glance.
 *
 * Shows the current plan, lifecycle status (with a color-INDEPENDENT text label), whether the plan is
 * a synthetic Free (no paid subscription), active/inactive, the current period start/end, and any
 * pending cancel-at-period-end. All facts come straight from GET /status.
 */
import { CheckCircle2, CircleSlash, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { statusLabel, formatPeriodDate } from './subscriptionHelpers'
import type { Plan, SubscriptionStatus } from '@/types'

export interface SubscriptionStatusCardProps {
  status: SubscriptionStatus | null
  plan: Plan | null
  testId?: string
}

export function SubscriptionStatusCard({ status, plan, testId = 'subscription-status-card' }: SubscriptionStatusCardProps) {
  if (!status) {
    return (
      <Card data-testid={testId}>
        <CardContent className="py-6 text-sm text-gray-500" data-testid={`${testId}-empty`}>
          No subscription status is available yet.
        </CardContent>
      </Card>
    )
  }

  const planName = plan?.name || status.planKey
  const label = statusLabel(status)
  const active = status.active

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span data-testid={`${testId}-plan-name`}>{planName}</span>
          {/* Color is decorative; the text label carries the meaning. */}
          {active ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100" data-testid={`${testId}-active-badge`}>
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Active
            </Badge>
          ) : (
            <Badge variant="outline" data-testid={`${testId}-inactive-badge`}>
              <CircleSlash className="mr-1 h-3 w-3" aria-hidden="true" /> Inactive
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between sm:block">
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium text-gray-900" data-testid={`${testId}-status`}>{label}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-gray-500">Plan</dt>
            <dd className="font-medium text-gray-900" data-testid={`${testId}-plan-key`}>{status.planKey}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-gray-500">Current period start</dt>
            <dd className="font-medium text-gray-900" data-testid={`${testId}-period-start`}>{formatPeriodDate(status.currentPeriodStart)}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-gray-500">Current period end</dt>
            <dd className="font-medium text-gray-900" data-testid={`${testId}-period-end`}>{formatPeriodDate(status.currentPeriodEnd)}</dd>
          </div>
        </dl>

        {status.synthetic && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid={`${testId}-synthetic`}>
            You are on the Free plan. No paid subscription is active for this tenant.
          </p>
        )}

        {status.cancelAtPeriodEnd && (
          <p className="flex items-center gap-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid={`${testId}-cancel-at-period-end`}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            This subscription is scheduled to cancel at the end of the current period
            {status.currentPeriodEnd ? ` (${formatPeriodDate(status.currentPeriodEnd)})` : ''}. Access continues until then.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default SubscriptionStatusCard
