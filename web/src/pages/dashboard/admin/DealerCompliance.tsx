import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, Ban, RotateCcw, ShieldCheck } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errorMessage'
import StepUpPrompt from '@/components/auth/StepUpPrompt'
import { isStepUpRequired } from '@/lib/stepUp'

export interface DealerProfile {
  id: string
  legal_name?: string
  trading_name?: string
  identity_status: string
  business_evidence_status: string
  compliance_review_state: string
  active_state: string
  restriction_state: string
  suspension_state: string
  investigation_state: string
  listing_limit?: number
}

// The eight statuses are shown SEPARATELY — never collapsed into one "verified dealer" flag.
const STATUS_FIELDS: Array<[keyof DealerProfile, string]> = [
  ['identity_status', 'Identity'], ['business_evidence_status', 'Business evidence'],
  ['compliance_review_state', 'Compliance review'], ['active_state', 'Active'],
  ['restriction_state', 'Restriction'], ['suspension_state', 'Suspension'],
  ['investigation_state', 'Investigation'],
]
function tone(v: string): string {
  if (['verified', 'passed', 'active', 'complete'].includes(v)) return 'bg-green-100 text-green-800'
  if (['suspended', 'failed', 'rejected', 'under_investigation', 'restricted'].includes(v)) return 'bg-red-100 text-red-800'
  if (['pending', 'in_review', 'incomplete'].includes(v)) return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-600'
}

export function DealerComplianceCard({ dealer, onDecision, busy }: { dealer: DealerProfile; onDecision: (id: string, decision: string) => void; busy: boolean }) {
  return (
    <Card className="border-0 card-shadow" data-testid="dealer-compliance-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-purple-500" />
            <span className="font-medium">{dealer.legal_name || dealer.trading_name || `Dealer ${dealer.id}`}</span>
          </div>
          <div className="flex gap-2">
            {dealer.suspension_state !== 'suspended' ? (
              <Button size="sm" variant="outline" className="border-red-300 text-red-700" disabled={busy} onClick={() => onDecision(dealer.id, 'suspend')}>
                <Ban className="w-3.5 h-3.5 mr-1" /> Suspend
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="border-green-300 text-green-700" disabled={busy} onClick={() => onDecision(dealer.id, 'reinstate')}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reinstate
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision(dealer.id, 'restrict')}>Restrict</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FIELDS.map(([k, label]) => (
            <span key={k as string} className={`text-xs px-2 py-0.5 rounded ${tone(String(dealer[k] ?? ''))}`} data-testid={`dealer-status-${k as string}`}>
              {label}: {String(dealer[k] ?? '—').replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DealerCompliance() {
  const { fetchDealers, recordDealerDecision } = useCarUpApi()
  const [dealers, setDealers] = useState<DealerProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [pendingStepUp, setPendingStepUp] = useState<{ retry: () => Promise<void> } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetchDealers(); setDealers((r.dealers || []) as DealerProfile[]) }
    catch (err) { toast.error(getErrorMessage(err)) }
    finally { setLoading(false) }
  }, [fetchDealers])
  // Initial load without a synchronous set-state-in-effect (loading starts true).
  useEffect(() => {
    let cancelled = false
    fetchDealers()
      .then((r) => { if (!cancelled) setDealers((r.dealers || []) as DealerProfile[]) })
      .catch((err) => { if (!cancelled) toast.error(getErrorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchDealers])

  /**
   * A dealer decision is a SENSITIVE action: `requireAuthenticationAssurance` has guarded
   * `/api/admin/dealers/:id/decision` since O2-X3, and until now this page had no way to satisfy
   * it. The reviewer pressed Approve, got STEP_UP_REQUIRED back, and saw a toast telling them so
   * with nothing they could do about it.
   */
  const onDecision = async (id: string, decision: string) => {
    setBusy(id)
    try {
      await recordDealerDecision(id, { decision, reason: `Admin ${decision}` })
      toast.success(`Dealer ${decision}`)
      setPendingStepUp(null)
      await load()
    } catch (err) {
      if (isStepUpRequired(err)) {
        // Deferred, not refused — so it is not reported as a failed decision, and confirming
        // retries the decision the reviewer actually asked for.
        setPendingStepUp({ retry: () => onDecision(id, decision) })
        return
      }
      toast.error(getErrorMessage(err))
    }
    finally { setBusy(null) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-purple-500" /> Dealer compliance</h1>
        <p className="text-gray-500 text-sm">Eight separate compliance statuses per dealer. Decisions are append-only; suspension blocks publication and escrow.</p>
      </div>
      {pendingStepUp && (
        <StepUpPrompt
          reason="Recording a dealer compliance decision changes what that business may do on CarUp, so CarUp asks you to confirm your password first."
          onConfirmed={() => { const again = pendingStepUp.retry; setPendingStepUp(null); void again() }}
          onCancel={() => setPendingStepUp(null)}
        />
      )}

      {loading ? [1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)
        : dealers.length === 0 ? <Card className="border-0 card-shadow"><CardContent className="py-10 text-center text-gray-400">No dealer profiles yet.</CardContent></Card>
        : dealers.map(d => <DealerComplianceCard key={d.id} dealer={d} onDecision={onDecision} busy={busy === d.id} />)}
    </div>
  )
}
