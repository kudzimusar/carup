import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { MarketplaceTrustSummary, MarketplaceVerificationSummary } from '@/types'

/**
 * Renders the BACKEND-GENERATED trust summary. The frontend never invents badges — it displays only
 * what the backend supplied in trust_summary.trust_badges / public_badge_copy. Risk and PartSentry
 * states are surfaced exactly as governed server-side.
 */
export function TrustSummaryPanel({
  trust,
  verification,
}: {
  trust: MarketplaceTrustSummary
  verification?: MarketplaceVerificationSummary
}) {
  const riskTone =
    trust.risk_status === 'blocked'
      ? 'border-red-200 bg-red-50 text-red-800'
      : trust.risk_status === 'flagged'
      ? 'border-orange-200 bg-orange-50 text-orange-800'
      : trust.risk_status === 'watch'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800'

  const partsentryLabel: Record<string, string> = {
    eligible: 'PartSentry checked',
    review_required: 'PartSentry under review',
    suppressed: 'PartSentry signals suppressed',
    ineligible: 'PartSentry not public-eligible',
    not_applicable: 'No PartSentry data',
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="marketplace-trust-summary">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-orange-500" />
        <h3 className="text-sm font-semibold text-gray-900">Trust summary</h3>
      </div>

      {trust.risk_status !== 'clear' && (
        <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${riskTone}`} data-testid="marketplace-risk-banner">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{trust.safe_public_copy}</span>
        </div>
      )}

      {trust.public_badge_copy.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {trust.public_badge_copy.map((copy) => (
            <Badge
              key={copy}
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
              data-testid="marketplace-trust-badge"
            >
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {copy}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-gray-500">No public trust badges yet for this listing.</p>
      )}

      {trust.risk_status === 'clear' && (
        <p className="mb-3 text-xs text-gray-600">{trust.safe_public_copy}</p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <TrustRow label="PartSentry" value={partsentryLabel[trust.partsentry_public_status] || trust.partsentry_public_status} testid="marketplace-partsentry-status" />
        <TrustRow label="Evidence" value={trust.evidence_status.replace(/_/g, ' ')} />
        <TrustRow label="Passport" value={trust.vehicle_passport_available ? 'Available' : 'Not available'} />
        <TrustRow label="Suspicion" value={trust.suspicion_status} />
      </div>

      {verification && verification.verification_notes_public.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700">
            <Info className="h-3.5 w-3.5 text-blue-500" /> Verification
          </div>
          <ul className="space-y-1">
            {verification.verification_notes_public.map((note, i) => (
              <li key={i} className="flex items-start gap-1 text-xs text-gray-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TrustRow({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1.5" data-testid={testid}>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium capitalize text-gray-800">{value}</span>
    </div>
  )
}
