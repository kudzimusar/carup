import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { ScanLine, AlertTriangle, Loader2 } from 'lucide-react'
import type { VehicleDocumentExtraction, ExtractionMatchStatus, ExtractionReviewStatus } from '@/types'

// Phase 12 — OCR extraction review. Surfaces backend extractions per evidence item with
// per-field confidence, identity match_status and the human review decision. An AI-extracted
// value is shown as ADVISORY ("extracted, pending review") — never as an official verified fact —
// and reviewing only sets review_status (the original extracted content is immutable).
const REVIEWER_ROLES = ['admin', 'government', 'reviewer']

const MATCH_TONE: Record<ExtractionMatchStatus, 'destructive' | 'secondary' | 'outline'> = {
  mismatch: 'destructive', missing_reference: 'secondary', inconclusive: 'secondary', match: 'outline',
}
const REVIEW_TONE: Record<ExtractionReviewStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  confirmed: 'default', rejected: 'destructive', amended: 'secondary', waived: 'secondary', pending: 'outline',
}
const DECISIONS: { value: Exclude<ExtractionReviewStatus, 'pending'>; label: string }[] = [
  { value: 'confirmed', label: 'Confirm' },
  { value: 'rejected', label: 'Reject' },
  { value: 'amended', label: 'Amend' },
  { value: 'waived', label: 'Waive' },
]

function pct(c: number | null): string {
  return typeof c === 'number' ? `${Math.round(c * 100)}%` : '—'
}

export default function ExtractionReviewPanel({ vin, evidenceId }: { vin: string; evidenceId?: string }) {
  const { user } = useAuth()
  const { fetchVehicleExtractions, reviewVehicleExtraction } = useCarUpApi()
  const [rows, setRows] = useState<VehicleDocumentExtraction[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ mismatch: number; pending: number }>({ mismatch: 0, pending: 0 })

  const role = String(user?.role || '').toLowerCase()
  const canReview = REVIEWER_ROLES.includes(role)

  const load = useCallback(async () => {
    // setState only in async continuations (react-hooks/set-state-in-effect); loading starts true.
    try {
      const res = await fetchVehicleExtractions(vin, { evidenceId })
      setRows(res.extractions || [])
      setCounts({ mismatch: res.mismatch_count || 0, pending: res.pending_review_count || 0 })
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fetchVehicleExtractions, vin, evidenceId])

  useEffect(() => {
    let mounted = true
    fetchVehicleExtractions(vin, { evidenceId })
      .then((res) => { if (mounted) { setRows(res.extractions || []); setCounts({ mismatch: res.mismatch_count || 0, pending: res.pending_review_count || 0 }) } })
      .catch(() => { if (mounted) setRows([]) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [fetchVehicleExtractions, vin, evidenceId])

  const decide = async (ext: VehicleDocumentExtraction, decision: Exclude<ExtractionReviewStatus, 'pending'>) => {
    setBusy(ext.id)
    try {
      const reason = decision === 'rejected' && ext.match_status === 'mismatch' ? (ext.mismatch_reason || 'Identity mismatch confirmed by reviewer') : undefined
      const res = await reviewVehicleExtraction(vin, ext.id, { review_status: decision, mismatch_reason: reason })
      setRows((cur) => cur.map((r) => (r.id === ext.id ? res.extraction : r)))
      toast.success(`Extraction ${decision}`)
      await load()
    } catch (e) {
      toast.error(`Review failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading OCR extractions…</div>
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No OCR extractions for this evidence yet.</p>
  }

  return (
    <div className="space-y-2" data-testid="extraction-review-panel">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ScanLine className="h-4 w-4" aria-hidden /> OCR extractions
        {counts.mismatch > 0 && (
          <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {counts.mismatch} mismatch</span>
        )}
        {counts.pending > 0 && <span className="text-muted-foreground">· {counts.pending} pending</span>}
      </div>
      <p className="text-xs text-muted-foreground">Extracted values are advisory until reviewed — never shown to buyers as official verified facts.</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Field</TableHead>
              <TableHead scope="col">Extracted</TableHead>
              <TableHead scope="col">Expected (vehicle)</TableHead>
              <TableHead scope="col">Confidence</TableHead>
              <TableHead scope="col">Match</TableHead>
              <TableHead scope="col">Review</TableHead>
              {canReview && <TableHead scope="col">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((ext) => (
              <TableRow key={ext.id}>
                <TableCell className="font-medium">{ext.field_name}</TableCell>
                <TableCell className="font-mono text-xs">{ext.normalized_value || ext.raw_value || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{ext.expected_value || '—'}</TableCell>
                <TableCell>{pct(ext.confidence)}</TableCell>
                <TableCell><Badge variant={MATCH_TONE[ext.match_status] || 'outline'}>{ext.match_status.replace(/_/g, ' ')}</Badge></TableCell>
                <TableCell><Badge variant={REVIEW_TONE[ext.review_status] || 'outline'}>{ext.review_status}</Badge></TableCell>
                {canReview && (
                  <TableCell>
                    {ext.review_status === 'pending' ? (
                      <div className="flex flex-wrap gap-1">
                        {DECISIONS.map((d) => (
                          <Button key={d.value} size="sm"
                            variant={d.value === 'confirmed' ? 'default' : d.value === 'rejected' ? 'destructive' : 'secondary'}
                            disabled={busy === ext.id} onClick={() => decide(ext, d.value)}>
                            {d.label}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{ext.reviewed_by ? 'reviewed' : '—'}</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
