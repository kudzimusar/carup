import { useEffect, useState } from 'react'
import { ShieldCheck, FlaskConical, FileCheck2, UserCheck, AlertTriangle, ShieldAlert, HelpCircle, CircleSlash, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { SourceCoverageEntry, SourceProvider, SourceCoverageStatus } from '@/types'

const PROVIDER_LABELS: Record<SourceProvider, { name: string; what: string }> = {
  zimra: { name: 'ZIMRA', what: 'Customs & import duty' },
  cvr: { name: 'CVR', what: 'Registration & ownership' },
  zinara: { name: 'ZINARA', what: 'Road licensing' },
  vid: { name: 'VID', what: 'Roadworthiness inspection' },
  cid: { name: 'CID', what: 'Police / stolen check' },
}
const ALL_PROVIDERS: SourceProvider[] = ['zimra', 'cvr', 'zinara', 'vid', 'cid']

// Honest, source-specific status presentation. A sandbox demonstration is NEVER shown as
// a live government confirmation; unavailable/no-record are never shown as clear.
const STATUS_UI: Record<SourceCoverageStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  source_connected:      { label: 'Source confirmed',      cls: 'bg-green-100 text-green-800 border-green-300', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  partner_file_reviewed: { label: 'Partner file reviewed', cls: 'bg-teal-100 text-teal-800 border-teal-300', icon: <FileCheck2 className="w-3.5 h-3.5" /> },
  carup_manual_reviewed: { label: 'CarUp manual review',   cls: 'bg-blue-100 text-blue-800 border-blue-300', icon: <UserCheck className="w-3.5 h-3.5" /> },
  sandbox_demonstration: { label: 'Sandbox demo (not live)', cls: 'bg-purple-100 text-purple-800 border-purple-300', icon: <FlaskConical className="w-3.5 h-3.5" /> },
  conflict_under_review: { label: 'Conflict — under review', cls: 'bg-amber-100 text-amber-900 border-amber-300', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  risk_flagged:          { label: 'Risk flagged',           cls: 'bg-red-100 text-red-800 border-red-300', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  no_record_found:       { label: 'No record found',        cls: 'bg-gray-100 text-gray-600 border-gray-300', icon: <CircleSlash className="w-3.5 h-3.5" /> },
  source_unavailable:    { label: 'Source unavailable',     cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: <HelpCircle className="w-3.5 h-3.5" /> },
  pending:               { label: 'Not yet checked',        cls: 'bg-gray-50 text-gray-400 border-gray-200', icon: <Clock className="w-3.5 h-3.5" /> },
}

function statusFor(entry: SourceCoverageEntry | undefined): SourceCoverageStatus {
  return entry?.coverage_status || 'pending'
}

export function SourceCoveragePanel({ vin, initialData }: { vin: string; initialData?: SourceCoverageEntry[] }) {
  const { fetchVehicleSourceCoverage } = useCarUpApi()
  const [data, setData] = useState<SourceCoverageEntry[] | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)

  useEffect(() => {
    if (initialData) return
    let cancelled = false
    setLoading(true)
    fetchVehicleSourceCoverage(vin)
      .then((r) => { if (!cancelled) setData(r.coverage || []) })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vin, fetchVehicleSourceCoverage, initialData])

  if (loading) {
    return (
      <Card className="border-0 card-shadow" data-testid="source-coverage-loading">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-56" /></CardHeader>
        <CardContent className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent>
      </Card>
    )
  }

  const byProvider: Partial<Record<SourceProvider, SourceCoverageEntry>> = {}
  for (const e of data || []) byProvider[e.provider] = e
  const anySandbox = (data || []).some((e) => e.coverage_status === 'sandbox_demonstration')

  return (
    <Card className="border-0 card-shadow" data-testid="source-coverage-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-orange-500" />
          Government & partner source checks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {ALL_PROVIDERS.map((p) => {
          const st = statusFor(byProvider[p])
          const ui = STATUS_UI[st]
          return (
            <div key={p} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0" data-testid={`source-row-${p}`}>
              <div>
                <span className="font-medium text-sm text-gray-800">{PROVIDER_LABELS[p].name}</span>
                <span className="text-xs text-gray-400 ml-2">{PROVIDER_LABELS[p].what}</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded border inline-flex items-center gap-1 ${ui.cls}`}>
                {ui.icon}{ui.label}
              </span>
            </div>
          )
        })}
        {anySandbox && (
          <p className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded p-2 mt-2">
            Some results above are <strong>sandbox demonstrations</strong> for this preview environment —
            they are not live government API confirmations.
          </p>
        )}
        <p className="text-xs text-gray-400 pt-1">
          CarUp shows each source separately and never presents an unchecked or sandbox source as confirmed.
        </p>
      </CardContent>
    </Card>
  )
}
