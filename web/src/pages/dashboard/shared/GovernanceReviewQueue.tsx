import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react'
import type { GovernanceReviewItem, GovernanceTaskType, GovernanceDecision, GovernanceTargetType } from '@/types'

// Master plan §11.4 decision verbs. Trust is NEVER changed here — the backend records a
// governed decision; trust changes flow only through the governed trust-change path.
const DECISIONS: { value: GovernanceDecision; label: string; tone: 'default' | 'destructive' | 'secondary' }[] = [
  { value: 'confirm', label: 'Confirm', tone: 'default' },
  { value: 'reject', label: 'Reject', tone: 'destructive' },
  { value: 'amend', label: 'Amend', tone: 'secondary' },
  { value: 'request_more', label: 'Request more', tone: 'secondary' },
  { value: 'inconclusive', label: 'Inconclusive', tone: 'secondary' },
  { value: 'escalate', label: 'Escalate', tone: 'secondary' },
]

const TASK_TABS: { value: 'all' | GovernanceTaskType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'temporal_finding', label: 'Temporal' },
  { value: 'disclosure_conflict', label: 'Disclosure' },
  { value: 'vehicle_identity', label: 'Identity' },
  { value: 'evidence_verification', label: 'Evidence' },
]

const REVIEWER_ROLES = ['admin', 'government', 'reviewer']

export default function GovernanceReviewQueue() {
  const { user, loading: authLoading } = useAuth()
  const { fetchReviewQueue, submitGovernanceDecision } = useCarUpApi()
  const [tab, setTab] = useState<'all' | GovernanceTaskType>('all')
  const [items, setItems] = useState<GovernanceReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const role = String(user?.role || '').toLowerCase()
  const authorized = REVIEWER_ROLES.includes(role)

  // Fetch on mount + tab change without synchronous setState in the effect
  // (react-hooks/set-state-in-effect): updates happen only in async continuations.
  // The spinner is driven by `loading` (initialised true; set true again on tab change
  // inside the Tabs onValueChange event handler, where setState is permitted).
  useEffect(() => {
    if (!authorized) return
    let mounted = true
    fetchReviewQueue(tab === 'all' ? undefined : tab)
      .then((res) => { if (mounted) setItems(res.queue || []) })
      .catch((e) => { if (mounted) toast.error(`Failed to load review queue: ${(e as Error).message}`) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [authorized, tab, fetchReviewQueue])

  const keyOf = (it: GovernanceReviewItem) => `${it.target_type}:${it.target_id}`

  const decide = async (it: GovernanceReviewItem, decision: GovernanceDecision) => {
    const k = keyOf(it)
    setBusy(k)
    try {
      await submitGovernanceDecision({
        targetType: it.target_type as GovernanceTargetType,
        targetId: it.target_id,
        vin: it.vin,
        decision,
        notes: notes[k] || null,
      })
      toast.success(`Decision recorded: ${decision}`)
      setItems((prev) => prev.filter((x) => keyOf(x) !== k))
    } catch (e) {
      toast.error(`Decision failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const heading = useMemo(() => `Governance review queue${items.length ? ` (${items.length})` : ''}`, [items.length])

  if (authLoading) return <div className="p-6 text-muted-foreground">Loading…</div>
  if (!authorized) {
    return (
      <Card className="m-6">
        <CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
          <AlertTriangle className="h-4 w-4" aria-hidden /> You do not have reviewer access to this queue.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-xl font-semibold">{heading}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Confirm, reject, amend, request more, mark inconclusive, or escalate AI/temporal/disclosure
        findings, ambiguous identity, and pending evidence. Decisions are audited; trust scores are
        never changed here.
      </p>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as 'all' | GovernanceTaskType); setLoading(true) }}>
        <TabsList>
          {TASK_TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading queue…</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground">Nothing pending review. 🎉</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Pending items</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col">VIN</TableHead>
                  <TableHead scope="col">Summary</TableHead>
                  <TableHead scope="col">Severity</TableHead>
                  <TableHead scope="col">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const k = keyOf(it)
                  return (
                    <TableRow key={k}>
                      <TableCell><Badge variant="secondary">{it.task_type.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{it.vin || '—'}</TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-sm">{it.summary || '(no summary)'}</div>
                        <Textarea
                          aria-label={`Reviewer notes for ${k}`}
                          placeholder="Reviewer notes (optional)"
                          className="mt-2 h-16 text-xs"
                          value={notes[k] || ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell>
                        {it.severity ? <Badge variant={it.severity === 'high' || it.severity === 'critical' ? 'destructive' : 'outline'}>{it.severity}</Badge> : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {DECISIONS.map((d) => (
                            <Button key={d.value} size="sm" variant={d.tone === 'default' ? 'default' : d.tone === 'destructive' ? 'destructive' : 'secondary'}
                              disabled={busy === k} onClick={() => decide(it, d.value)}>
                              {d.label}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
