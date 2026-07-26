/**
 * SafeTradeEligibilityPanel — renders the explainable eligibility verdict (GET /:id/eligibility).
 *
 * Shows eligible/blocked plus each blocker's role-safe category, message and remediation. It surfaces
 * verification / document / compliance / shipment / reviewer requirements as COARSE categories only —
 * never internal risk scores, raw evidence references, private PII, storage paths or another party's
 * private fields. The risk tier (when present on a release verdict for a privileged role) is shown as
 * a coarse label only.
 */
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { blockerCategory } from './safeTradeHelpers'
import type { SafeTradeEligibilityVerdict, SafeTradeReleaseEvaluation, SafeTradeBlocker } from '@/types'

export interface SafeTradeEligibilityPanelProps {
  verdict: SafeTradeEligibilityVerdict | null
  /** Optional release verdict (privileged reviewers) — surfaces the coarse risk tier only. */
  releaseVerdict?: SafeTradeReleaseEvaluation | null
  /** Only privileged reviewers should see the risk tier; default false. */
  showRiskTier?: boolean
  testId?: string
}

export function SafeTradeEligibilityPanel({
  verdict,
  releaseVerdict = null,
  showRiskTier = false,
  testId = 'safetrade-eligibility',
}: SafeTradeEligibilityPanelProps) {
  if (!verdict) return null
  const blockers = verdict.blockers || []

  return (
    <Card data-testid={testId} aria-label="SafeTrade eligibility">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Eligibility</CardTitle>
          {verdict.eligible ? (
            <Badge variant="default" data-testid={`${testId}-status`} data-eligible="true">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Eligible
            </Badge>
          ) : (
            <Badge variant="destructive" data-testid={`${testId}-status`} data-eligible="false">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showRiskTier && releaseVerdict?.riskTier && (
          <p className="mb-3 text-xs text-gray-600" data-testid={`${testId}-risk-tier`}>
            Release risk tier: <span className="font-medium">{releaseVerdict.riskTier}</span>
            {releaseVerdict.requiresApproval ? ' · reviewer approval required' : ''}
          </p>
        )}

        {verdict.eligible ? (
          <p className="text-sm text-gray-600">All checks pass for this case.</p>
        ) : (
          <ul className="space-y-3" role="list" data-testid={`${testId}-blockers`}>
            {blockers.map((b, i) => (
              <BlockerRow key={`${b.code}-${i}`} blocker={b} testId={`${testId}-blocker`} />
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-gray-400">
          Policy {verdict.policyVersion} · evaluated {formatTimestamp(verdict.evaluatedAt)}
        </p>
      </CardContent>
    </Card>
  )
}

function BlockerRow({ blocker, testId }: { blocker: SafeTradeBlocker; testId: string }) {
  return (
    <li className="rounded-md border border-amber-200 bg-amber-50 p-3" data-testid={testId} data-code={blocker.code}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">{blockerCategory(blocker.code)}</Badge>
      </div>
      <p className="mt-1 text-sm text-gray-800">{blocker.message}</p>
      {blocker.remediation && (
        <p className="mt-1 text-xs text-gray-600" data-testid={`${testId}-remediation`}>
          What to do: {blocker.remediation}
        </p>
      )}
    </li>
  )
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default SafeTradeEligibilityPanel
