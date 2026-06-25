import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Clock, AlertCircle, FileWarning, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Link } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { VehicleCompleteness, EvidenceRequirement, EvidenceRequirementStatus } from '@/types'

const STATUS_CONFIG: Record<EvidenceRequirementStatus, { label: string; icon: React.ReactNode; className: string }> = {
  verified: {
    label: 'Verified',
    icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
    className: 'text-green-700 bg-green-50 border-green-200',
  },
  present: {
    label: 'Uploaded',
    icon: <CheckCircle2 className="w-4 h-4 text-blue-600" />,
    className: 'text-blue-700 bg-blue-50 border-blue-200',
  },
  pending: {
    label: 'Under review',
    icon: <Clock className="w-4 h-4 text-amber-600" />,
    className: 'text-amber-700 bg-amber-50 border-amber-200',
  },
  missing: {
    label: 'Required — missing',
    icon: <XCircle className="w-4 h-4 text-red-500" />,
    className: 'text-red-700 bg-red-50 border-red-200',
  },
  rejected: {
    label: 'Rejected — resubmit',
    icon: <XCircle className="w-4 h-4 text-red-600" />,
    className: 'text-red-700 bg-red-50 border-red-200',
  },
  expired: {
    label: 'Expired',
    icon: <AlertCircle className="w-4 h-4 text-orange-500" />,
    className: 'text-orange-700 bg-orange-50 border-orange-200',
  },
  not_applicable: {
    label: 'Not required',
    icon: <CheckCircle2 className="w-4 h-4 text-gray-400" />,
    className: 'text-gray-500 bg-gray-50 border-gray-200',
  },
}

function RequirementRow({ req }: { req: EvidenceRequirement }) {
  const cfg = STATUS_CONFIG[req.status]
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0" data-testid="requirement-row">
      <div className="flex items-center gap-2">
        {cfg.icon}
        <span className="text-sm font-medium text-gray-800">{req.label}</span>
        {req.is_blocking && req.status === 'missing' && (
          <Badge variant="outline" className="text-xs border-red-300 text-red-600 py-0">blocks publish</Badge>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${cfg.className}`}>
        {cfg.label}
      </span>
    </div>
  )
}

interface Props {
  vin: string
  /** Allow parent to skip the fetch if completeness data is already available */
  initialData?: VehicleCompleteness
  className?: string
}

export function VehicleCompletenessPanel({ vin, initialData, className = '' }: Props) {
  const { fetchVehicleCompleteness } = useCarUpApi()
  const [data, setData] = useState<VehicleCompleteness | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialData) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchVehicleCompleteness(vin)
      .then(result => { if (!cancelled) setData(result) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vin, fetchVehicleCompleteness, initialData])

  if (loading) {
    return (
      <Card className={`border-0 card-shadow ${className}`} data-testid="completeness-panel-loading">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-3 w-full" />
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={`border-0 card-shadow ${className}`} data-testid="completeness-panel-error">
        <CardContent className="py-6 flex items-center gap-2 text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm">Could not load requirements: {error}</span>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const blockingReqs = data.requirements.filter(r => r.is_blocking)
  const advisoryReqs = data.requirements.filter(r => !r.is_blocking)

  return (
    <Card className={`border-0 card-shadow ${className}`} data-testid="completeness-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-orange-500" />
            Publication requirements
          </CardTitle>
          {data.is_publishable ? (
            <Badge className="bg-green-600 text-white text-xs">Ready to publish</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-400 text-amber-700 text-xs">Draft — not yet publishable</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Completeness bar */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-500">Completeness</span>
            <span className="text-xs font-semibold text-gray-700">{data.completeness_percent}%</span>
          </div>
          <Progress value={data.completeness_percent} className="h-2" />
        </div>

        {/* Blocking gaps callout */}
        {data.blocking_gaps.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
            <p className="font-semibold text-red-800 mb-1">Publication is blocked</p>
            <ul className="list-disc list-inside text-red-700 space-y-0.5">
              {data.blocking_gaps.map(gap => <li key={gap}>{gap}</li>)}
            </ul>
          </div>
        )}

        {/* Pending advisory */}
        {data.pending_gaps.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <p className="font-semibold text-amber-800 mb-1">Awaiting review</p>
            <p className="text-amber-700">
              {data.pending_gaps.join(', ')} — submitted and under review. Publication will advance once approved.
            </p>
          </div>
        )}

        {/* Required (blocking) documents */}
        {blockingReqs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Required for publication</p>
            <div className="border border-gray-200 rounded-lg overflow-hidden px-3">
              {blockingReqs.map(req => <RequirementRow key={req.key} req={req} />)}
            </div>
          </div>
        )}

        {/* Advisory (non-blocking) documents */}
        {advisoryReqs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recommended documents</p>
            <div className="border border-gray-100 rounded-lg overflow-hidden px-3 bg-gray-50/50">
              {advisoryReqs.map(req => <RequirementRow key={req.key} req={req} />)}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button asChild className="bg-orange-500 hover:bg-orange-600 flex-1">
            <Link to={`/dashboard/vehicles/${encodeURIComponent(data.vin)}/evidence`}>
              Upload documents <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link to="/dashboard">View my garage</Link>
          </Button>
        </div>

        <p className="text-xs text-gray-400 text-center">
          Publication status: <span className="font-medium">{data.publication_status.replace(/_/g, ' ')}</span>
          {' · '}VIN: {data.vin}
        </p>
      </CardContent>
    </Card>
  )
}
