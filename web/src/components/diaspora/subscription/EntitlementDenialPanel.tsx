/**
 * EntitlementDenialPanel — REUSABLE, SAFE presentation of a structured entitlement denial.
 *
 * Distinguishes every denial category and shows only safe, user-facing facts: the requested
 * operation, required feature, current plan, reason, remaining quota (when provided), upgrade
 * eligibility and retry guidance. It NEVER renders db details, stack traces, internal tenant ids,
 * raw provider errors or secrets — the `message` it shows is always one of our own category summaries
 * (see entitlementDenial.ts), and it ignores any unexpected fields.
 */
import { AlertTriangle, ArrowUpCircle, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { humanizeFeatureKey } from './subscriptionHelpers'
import type { StructuredEntitlementDenial, EntitlementDenialCategory } from '@/types'

const CATEGORY_TITLE: Record<EntitlementDenialCategory, string> = {
  'feature-unavailable-on-plan': 'Feature not in your plan',
  'quota-exhausted': 'Usage limit reached',
  'inactive-subscription': 'Subscription not active',
  'tenant-context-missing': 'No tenant selected',
  'external-activation-unavailable': 'Action temporarily unavailable',
  'ordinary-authorization-failure': 'Not permitted',
  'network-or-server-failure': 'Could not reach the service',
}

export interface EntitlementDenialPanelProps {
  denial: StructuredEntitlementDenial
  /** Optional retry handler — only offered when the denial is retryable. */
  onRetry?: () => void
  /** Optional upgrade handler — only offered when the denial is upgrade-eligible. */
  onUpgrade?: () => void
  testId?: string
}

export function EntitlementDenialPanel({ denial, onRetry, onUpgrade, testId = 'entitlement-denial' }: EntitlementDenialPanelProps) {
  const title = CATEGORY_TITLE[denial.category]
  return (
    <Alert
      className="border-amber-200 bg-amber-50"
      role="alert"
      aria-live="polite"
      data-testid={testId}
      data-denial-category={denial.category}
    >
      <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p data-testid={`${testId}-message`}>{denial.message}</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-gray-700 sm:grid-cols-2">
          {denial.requestedOperation && (
            <div className="flex gap-1">
              <dt className="font-medium">Requested:</dt>
              <dd data-testid={`${testId}-operation`}>{denial.requestedOperation}</dd>
            </div>
          )}
          {denial.requiredFeature && (
            <div className="flex gap-1">
              <dt className="font-medium">Requires:</dt>
              <dd data-testid={`${testId}-feature`}>{humanizeFeatureKey(denial.requiredFeature)}</dd>
            </div>
          )}
          {denial.currentPlan && (
            <div className="flex gap-1">
              <dt className="font-medium">Current plan:</dt>
              <dd data-testid={`${testId}-current-plan`}>{denial.currentPlan}</dd>
            </div>
          )}
          {denial.requiredPlan && (
            <div className="flex gap-1">
              <dt className="font-medium">Upgrade to:</dt>
              <dd data-testid={`${testId}-required-plan`}>{denial.requiredPlan}</dd>
            </div>
          )}
          {denial.remaining !== null && denial.remaining !== undefined && (
            <div className="flex gap-1">
              <dt className="font-medium">Remaining:</dt>
              <dd data-testid={`${testId}-remaining`}>{denial.remaining}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {denial.upgradeEligible && onUpgrade && (
            <Button size="sm" variant="outline" onClick={onUpgrade} data-testid={`${testId}-upgrade`}>
              <ArrowUpCircle className="mr-1 h-4 w-4" aria-hidden="true" /> View upgrade options
            </Button>
          )}
          {denial.retryable && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} data-testid={`${testId}-retry`}>
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> Try again
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

export default EntitlementDenialPanel
