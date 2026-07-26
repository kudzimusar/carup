/**
 * UsageDashboard — point-in-time metered usage from GET /usage for the current period.
 *
 * For each feature: name, used, reserved, limit, remaining, and the period. Distinguishes unlimited
 * and unavailable states TRUTHFULLY. Progress is accessible: the meter carries aria-valuenow/min/max
 * AND a redundant TEXT label (never color-only), and is reduced-motion safe (no animated transition).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPeriodDate, toUsageView, type UsageView } from './subscriptionHelpers'
import type { UsageResponse } from '@/types'

export interface UsageDashboardProps {
  usage: UsageResponse | null
  testId?: string
}

function UsageMeter({ view }: { view: UsageView }) {
  const pct = view.percentUsed ?? 0
  return (
    <div
      className="rounded-md border border-gray-200 p-3"
      data-testid="usage-row"
      data-feature-key={view.featureKey}
      data-available={view.available ? 'true' : 'false'}
      data-unlimited={view.unlimited ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900" data-testid="usage-feature-name">{view.featureName}</p>
        {view.reserved > 0 && (
          <span className="text-xs text-gray-500" data-testid="usage-reserved">{view.reserved} reserved</span>
        )}
      </div>

      {/* Color-independent status text — the single source of meaning for sighted + AT users. */}
      <p className="mt-1 text-xs text-gray-700" data-testid="usage-status-text">{view.statusText}</p>

      {view.available && !view.unlimited && (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 motion-reduce:transition-none"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${view.featureName}: ${view.used} of ${view.limit} used`}
          data-testid="usage-progress"
        >
          <div
            className="h-full rounded-full bg-orange-500 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {view.unlimited && view.available && (
        <p className="mt-2 text-xs font-medium text-green-700" data-testid="usage-unlimited">Unlimited on your plan</p>
      )}
      {!view.available && (
        <p className="mt-2 text-xs font-medium text-gray-500" data-testid="usage-unavailable">Not available on your plan</p>
      )}
    </div>
  )
}

export function UsageDashboard({ usage, testId = 'usage-dashboard' }: UsageDashboardProps) {
  if (!usage || !Array.isArray(usage.usage) || usage.usage.length === 0) {
    return (
      <Card data-testid={testId}>
        <CardContent className="py-6 text-sm text-gray-500" data-testid={`${testId}-empty`}>
          No metered usage to report for the current period.
        </CardContent>
      </Card>
    )
  }

  const views = usage.usage.map(toUsageView)

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span>Usage this period</span>
          <span className="text-xs font-normal text-gray-500" data-testid={`${testId}-period`}>
            Since {formatPeriodDate(usage.periodStart)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {views.map((view) => (
          <UsageMeter key={view.featureKey} view={view} />
        ))}
      </CardContent>
    </Card>
  )
}

export default UsageDashboard
