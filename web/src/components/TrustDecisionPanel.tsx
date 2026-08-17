import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { TrustDecision, TrustDimension } from '@/types'

// Buyer-safe presentation of the unified trust decision. Each dimension is shown
// SEPARATELY (never collapsed into one "verified"). Private dimensions (e.g. finance)
// are already stripped server-side; we defensively skip them here too.
const DIMENSION_LABELS: Record<string, string> = {
  identity: 'Vehicle identity',
  evidence_completeness: 'Document completeness',
  evidence_confidence: 'Evidence confidence',
  source_coverage: 'Government source coverage',
  source_conflicts: 'Source conflicts',
  fraud_risk: 'Fraud / risk',
  dealer_compliance: 'Dealer compliance',
  publication_eligibility: 'Publication',
  insurance_eligibility: 'Insurance availability',
  escrow_eligibility: 'Escrow availability',
}
const HIDDEN_FROM_BUYER = new Set(['finance_eligibility'])

const GOOD = new Set(['complete', 'publishable', 'eligible', 'clear', 'compliant', 'no_conflicts', 'source_connected'])
const BAD = new Set(['conflict', 'blocked', 'not_eligible', 'high', 'suspended', 'conflicts_present', 'failed'])
const WARN = new Set(['incomplete', 'watch', 'manual_review', 'conditionally_eligible', 'potentially_eligible', 'restricted', 'demonstration_only', 'partial_coverage'])

function toneClass(status: string): string {
  if (GOOD.has(status)) return 'text-green-700 bg-green-50 border-green-200'
  if (BAD.has(status)) return 'text-red-700 bg-red-50 border-red-200'
  if (WARN.has(status)) return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'not_evaluated') return 'text-gray-400 bg-gray-50 border-gray-200'
  return 'text-gray-600 bg-gray-50 border-gray-200'
}

function DimensionRow({ name, dim }: { name: string; dim: TrustDimension }) {
  const label = DIMENSION_LABELS[name] || name.replace(/_/g, ' ')
  const display = dim.status === 'not_evaluated' ? 'Not evaluated' : String(dim.value ?? dim.status).replace(/_/g, ' ')
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0" data-testid={`decision-row-${name}`}>
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${toneClass(dim.status)}`}>{display}</span>
    </div>
  )
}

export function TrustDecisionPanel({ vin, initialData }: { vin: string; initialData?: TrustDecision }) {
  const { fetchVehicleTrustDecision } = useCarUpApi()
  const [data, setData] = useState<TrustDecision | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)

  useEffect(() => {
    if (initialData) return
    let cancelled = false
    fetchVehicleTrustDecision(vin)
      .then((r) => { if (!cancelled) setData(r.decision) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vin, fetchVehicleTrustDecision, initialData])

  if (loading) {
    return (
      <Card className="border-0 card-shadow" data-testid="trust-decision-loading">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-52" /></CardHeader>
        <CardContent className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent>
      </Card>
    )
  }
  if (!data) return null

  // This panel EXPLAINS the trust position through its dimensions; it does not state it. The single
  // public statement is the canonical projection rendered by the page. Restating a score here put
  // two answers on one screen — "50 · moderate" beside "Not evaluated" for the same VIN — because
  // this figure came from a live recompute while every other surface reads the materialized cache.
  return (
    <Card className="border-0 card-shadow" data-testid="trust-decision-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          <span>What this is based on</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(data.dimensions)
          .filter(([k]) => !HIDDEN_FROM_BUYER.has(k))
          .map(([k, dim]) => <DimensionRow key={k} name={k} dim={dim} />)}
        {data.known_limitations.length > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
            <p className="font-semibold mb-1">Known limitations</p>
            <ul className="list-disc list-inside space-y-0.5">
              {data.known_limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
        <p className="text-xs text-gray-400 pt-1">Each signal is shown separately. CarUp never collapses these into a single "verified" badge. Version {data.calculation_version}.</p>
      </CardContent>
    </Card>
  )
}
