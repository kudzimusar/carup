/**
 * PlanComparison — renders the plan catalog from GET /plans (NO hardcoded catalog).
 *
 * For each plan: name, description, and every entitlement TRUTHFULLY classified — unavailable vs
 * included (capability) vs metered monthly quota vs fixed cap. Plans are shown in the API's
 * sortOrder. The current plan is identified from GET /status and marked with a color-INDEPENDENT
 * "Current plan" badge (meaning is in the text, never color alone).
 */
import { Check, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  orderedPlans,
  planEntitlementCells,
  humanizeFeatureKey,
  type EntitlementCell,
} from './subscriptionHelpers'
import type { Plan } from '@/types'

export interface PlanComparisonProps {
  plans: Plan[]
  currentPlanKey: string | null
  testId?: string
}

function EntitlementRow({ cell }: { cell: EntitlementCell }) {
  const unavailable = cell.kind === 'unavailable'
  return (
    <li
      className="flex items-start justify-between gap-2 border-b border-gray-100 py-1 last:border-0"
      data-testid="plan-entitlement"
      data-feature-key={cell.featureKey}
      data-kind={cell.kind}
    >
      <span className="flex items-start gap-1 text-gray-700">
        {unavailable ? (
          <Minus className="mt-0.5 h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        ) : (
          <Check className="mt-0.5 h-3.5 w-3.5 text-green-600" aria-hidden="true" />
        )}
        {humanizeFeatureKey(cell.featureKey)}
      </span>
      {/* Truthful, color-independent label (e.g. "Not included", "Included", "25 / month", "Up to 250"). */}
      <span className={unavailable ? 'text-gray-400' : 'font-medium text-gray-900'} data-testid="plan-entitlement-label">
        {cell.label}
      </span>
    </li>
  )
}

export function PlanComparison({ plans, currentPlanKey, testId = 'plan-comparison' }: PlanComparisonProps) {
  const ordered = orderedPlans(plans)

  if (ordered.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500" data-testid={`${testId}-empty`}>
        No subscription plans are available right now.
      </div>
    )
  }

  return (
    <section aria-labelledby="plan-comparison-heading" data-testid={testId}>
      <h2 id="plan-comparison-heading" className="text-lg font-semibold text-gray-950">Plans</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="list">
        {ordered.map((plan) => {
          const isCurrent = currentPlanKey === plan.planKey
          return (
            <Card
              key={plan.planKey}
              role="listitem"
              className={isCurrent ? 'border-orange-300 ring-1 ring-orange-200' : ''}
              data-testid="plan-card"
              data-plan-key={plan.planKey}
              data-current={isCurrent ? 'true' : 'false'}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span data-testid="plan-card-name">{plan.name}</span>
                  {isCurrent && (
                    <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid="plan-current-badge">
                      Current plan
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription data-testid="plan-card-description">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-xs">
                  {planEntitlementCells(plan.entitlements).map((cell) => (
                    <EntitlementRow key={cell.featureKey} cell={cell} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

export default PlanComparison
