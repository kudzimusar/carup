import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Scale, Loader2 } from 'lucide-react'
import type { Dispute, PublicSafeDispute } from '@/types'

// Disputes & corrections surface (master plan §11.6). Owners/dealers can raise a dispute
// against a finding; everyone sees a public-safe, neutral status. Never accusatory.
const RAISE_ROLES = ['owner', 'dealer', 'admin']

function isPublicSafe(d: Dispute | PublicSafeDispute): d is PublicSafeDispute {
  return (d as PublicSafeDispute).public_state !== undefined
}

export default function DisputePanel({ vin }: { vin: string }) {
  const { user } = useAuth()
  const { fetchVehicleDisputes, submitDispute } = useCarUpApi()
  const [disputes, setDisputes] = useState<Array<Dispute | PublicSafeDispute>>([])
  const [loading, setLoading] = useState(true)
  const [subjectType, setSubjectType] = useState('temporal_finding')
  const [subjectId, setSubjectId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const role = String(user?.role || '').toLowerCase()
  const canRaise = !!user && RAISE_ROLES.includes(role)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchVehicleDisputes(vin)
      setDisputes(res.disputes || [])
    } catch {
      // disputes are best-effort on the buyer surface; stay quiet on auth-gated empties
      setDisputes([])
    } finally {
      setLoading(false)
    }
  }, [fetchVehicleDisputes, vin])

  useEffect(() => { void load() }, [load])

  const raise = async () => {
    if (!subjectId.trim()) { toast.error('Enter the finding/subject id you are disputing.'); return }
    setBusy(true)
    try {
      await submitDispute({ vin, subjectType, subjectId: subjectId.trim(), reason: reason.trim() || null })
      toast.success('Dispute submitted for independent review.')
      setSubjectId(''); setReason('')
      await load()
    } catch (e) {
      toast.error(`Could not submit dispute: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" aria-hidden /> Disputes &amp; corrections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</div>
        ) : disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No disputes recorded for this vehicle.</p>
        ) : (
          <ul className="space-y-2">
            {disputes.map((d, i) => (
              <li key={(d as Dispute).id || i} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.subject_type.replace(/_/g, ' ')}</span>
                  <Badge variant="outline">{String(d.status)}</Badge>
                </div>
                {isPublicSafe(d) && d.public_summary && <p className="mt-1 text-muted-foreground">{d.public_summary}</p>}
                {d.created_at && <p className="mt-1 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</p>}
              </li>
            ))}
          </ul>
        )}

        {canRaise && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Raise a dispute</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="Subject type" className="h-9 rounded-md border bg-background px-2 text-sm" value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
                <option value="temporal_finding">Temporal finding</option>
                <option value="disclosure_conflict">Disclosure conflict</option>
                <option value="vehicle_evidence">Evidence</option>
              </select>
              <Input aria-label="Subject id" placeholder="Finding / evidence id" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
            </div>
            <Textarea aria-label="Dispute reason" placeholder="Why are you disputing this? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-20" />
            <Button size="sm" disabled={busy} onClick={raise}>{busy ? 'Submitting…' : 'Submit dispute'}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
