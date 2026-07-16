import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, RefreshCw } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ReferralEventLog from '@/components/referral/ReferralEventLog'
import ReferralRealList from '@/components/referral/ReferralRealList'
import type { ReferralEvent, ReferralDispute } from '@/types/referral'

/**
 * Admin Referral Trust Review (/admin/referrals/trust). REFERRAL trust — distinct
 * from the vehicle trust-facts queue (TrustReviewQueue.tsx). Runs risk checks,
 * decides review cases, applies wallet holds, explains benefits, resolves disputes,
 * and exports the audit trail. Holds and decisions REQUIRE a reason (enforced both
 * client-side here and by the backend). No fabricated cases — lists come from the
 * real event log.
 */

const DECISIONS = ['allow', 'hold', 'review', 'reject', 'approve'] as const
const DISPUTE_OUTCOMES = ['resolved_upheld', 'resolved_reversed'] as const

const REC_STYLES: Record<string, string> = {
  allow: 'bg-green-100 text-green-700',
  review: 'bg-blue-100 text-blue-700',
  hold: 'bg-amber-100 text-amber-700',
  reject: 'bg-red-100 text-red-700',
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
}

type DecideFn = (caseEventId: string, payload: Record<string, unknown>) => Promise<unknown>

function ReviewCaseRow({ event, decide, onDone }: { event: ReferralEvent; decide: DecideFn; onDone: () => void }) {
  const md = (event.metadata ?? {}) as Record<string, unknown>
  const [decision, setDecision] = useState<string>('allow')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const apply = useCallback(async () => {
    if (!reason.trim()) {
      setMsg('A reason is required for every decision.')
      return
    }
    setMsg(null)
    try {
      await decide(event.id, { decision, reason: reason.trim() })
      setMsg('Decision recorded.')
      onDone()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Decision failed.')
    }
  }, [decide, event.id, decision, reason, onDone])

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{str(pick(md, 'target_type'))} {str(pick(md, 'target_id'))}</p>
          <p className="text-[11px] text-gray-400 break-all">case id: {event.id}{pick(md, 'wallet_transaction_id') ? ` · tx: ${str(pick(md, 'wallet_transaction_id'))}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pick(md, 'recommendation') ? <Badge className={`text-[10px] ${REC_STYLES[str(pick(md, 'recommendation'))] || 'bg-gray-100 text-gray-700'}`}>{str(pick(md, 'recommendation'))}</Badge> : null}
          <Badge variant="outline" className="text-[10px]">{str(pick(md, 'status')) || 'open'}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={decision} onChange={(e) => setDecision(e.target.value)} className="border border-gray-200 rounded-md h-8 px-2 text-xs">
          {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <Input placeholder="reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 text-xs max-w-[220px]" />
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={apply}>Decide</Button>
      </div>
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
    </div>
  )
}

export default function ReferralTrustReview() {
  const {
    getReferralTrustRules,
    runReferralRiskCheck,
    createReferralReviewCase,
    listReferralReviewCases,
    decideReferralReviewCase,
    applyReferralWalletHold,
    explainReferralBenefit,
    createReferralDispute,
    resolveReferralDispute,
    exportReferralAudit,
    listReferralDisputes,
  } = useCarUpApi()

  const loadDisputes = useCallback(async () => {
    const res = await listReferralDisputes({ limit: 50 })
    return { items: res.disputes ?? [], pagination: res.pagination }
  }, [listReferralDisputes])

  const [rules, setRules] = useState<Record<string, unknown> | null>(null)
  const [cases, setCases] = useState<ReferralEvent[]>([])
  const [casesError, setCasesError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Risk check
  const [riskTarget, setRiskTarget] = useState('')
  const [riskTx, setRiskTx] = useState('')
  const [dupCount, setDupCount] = useState('')
  const [riskResult, setRiskResult] = useState<string | null>(null)
  const [lastRiskEventId, setLastRiskEventId] = useState<string | null>(null)

  // Wallet hold
  const [holdTx, setHoldTx] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [holdMsg, setHoldMsg] = useState<string | null>(null)

  // Benefit explain
  const [explainTx, setExplainTx] = useState('')
  const [explainText, setExplainText] = useState<string | null>(null)

  // Dispute
  const [disputeTx, setDisputeTx] = useState('')
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null)
  const [resolveId, setResolveId] = useState('')
  const [resolveOutcome, setResolveOutcome] = useState<string>('resolved_upheld')
  const [resolveReason, setResolveReason] = useState('')
  const [resolveMsg, setResolveMsg] = useState<string | null>(null)

  // Audit
  const [auditMsg, setAuditMsg] = useState<string | null>(null)

  const loadCases = useCallback(async () => {
    setLoading(true)
    setCasesError(null)
    try {
      const res = await listReferralReviewCases()
      setCases(res.review_cases ?? [])
    } catch (err) {
      setCasesError(err instanceof Error ? err.message : 'Could not load review cases.')
    } finally {
      setLoading(false)
    }
  }, [listReferralReviewCases])

  useEffect(() => {
    getReferralTrustRules().then((r) => setRules((r.rules ?? null) as Record<string, unknown> | null)).catch(() => setRules(null))
    loadCases()
  }, [getReferralTrustRules, loadCases])

  const onRisk = useCallback(async () => {
    setRiskResult('Running…')
    try {
      const res = await runReferralRiskCheck({
        ...(riskTarget.trim() ? { target_id: riskTarget.trim() } : {}),
        ...(riskTx.trim() ? { wallet_transaction_id: riskTx.trim() } : {}),
        ...(dupCount.trim() ? { metrics: { duplicate_account_count: Number(dupCount) } } : {}),
      })
      const rc = pick(res, 'risk_check')
      setRiskResult(`Recommendation: ${str(pick(rc, 'recommendation'))} · score: ${str(pick(rc, 'score'))} · critical: ${str(pick(rc, 'critical'))}`)
      setLastRiskEventId(str(pick(pick(res, 'event'), 'id')) || null)
    } catch (err) {
      setRiskResult(err instanceof Error ? err.message : 'Risk check failed.')
    }
  }, [riskTarget, riskTx, dupCount, runReferralRiskCheck])

  const onCreateCase = useCallback(async () => {
    try {
      await createReferralReviewCase({
        ...(lastRiskEventId ? { risk_check_event_id: lastRiskEventId } : {}),
        ...(riskTarget.trim() ? { target_id: riskTarget.trim() } : {}),
        ...(riskTx.trim() ? { wallet_transaction_id: riskTx.trim() } : {}),
        reason: 'Manual review from trust console.',
      })
      loadCases()
    } catch (err) {
      setCasesError(err instanceof Error ? err.message : 'Could not create review case.')
    }
  }, [lastRiskEventId, riskTarget, riskTx, createReferralReviewCase, loadCases])

  const onHold = useCallback(async () => {
    if (!holdTx.trim() || !holdReason.trim()) {
      setHoldMsg('Transaction id and a reason are required.')
      return
    }
    try {
      await applyReferralWalletHold(holdTx.trim(), { reason: holdReason.trim() })
      setHoldMsg('Wallet hold applied.')
    } catch (err) {
      setHoldMsg(err instanceof Error ? err.message : 'Could not apply hold.')
    }
  }, [holdTx, holdReason, applyReferralWalletHold])

  const onExplain = useCallback(async () => {
    if (!explainTx.trim()) {
      setExplainText('Enter a transaction id.')
      return
    }
    setExplainText('Loading…')
    try {
      const res = await explainReferralBenefit(explainTx.trim())
      setExplainText(`${str(pick(res, 'status'))}: ${str(pick(res, 'explanation'))}`)
    } catch (err) {
      setExplainText(err instanceof Error ? err.message : 'Could not explain benefit.')
    }
  }, [explainTx, explainReferralBenefit])

  const onCreateDispute = useCallback(async () => {
    if (!disputeTx.trim() || !disputeReason.trim()) {
      setDisputeMsg('Transaction id and a reason are required.')
      return
    }
    try {
      const res = await createReferralDispute({ wallet_transaction_id: disputeTx.trim(), reason: disputeReason.trim() })
      setDisputeMsg(`Dispute opened. dispute_event_id: ${str(pick(pick(res, 'event'), 'id'))}`)
    } catch (err) {
      setDisputeMsg(err instanceof Error ? err.message : 'Could not open dispute.')
    }
  }, [disputeTx, disputeReason, createReferralDispute])

  const onResolve = useCallback(async () => {
    if (!resolveId.trim() || !resolveReason.trim()) {
      setResolveMsg('dispute_event_id and a reason are required.')
      return
    }
    try {
      await resolveReferralDispute(resolveId.trim(), { status: resolveOutcome, reason: resolveReason.trim() })
      setResolveMsg('Dispute resolved.')
    } catch (err) {
      setResolveMsg(err instanceof Error ? err.message : 'Could not resolve dispute.')
    }
  }, [resolveId, resolveOutcome, resolveReason, resolveReferralDispute])

  const onExport = useCallback(async () => {
    setAuditMsg('Exporting…')
    try {
      const res = await exportReferralAudit({ limit: 200 })
      const exp = pick(res, 'export')
      setAuditMsg(`Exported ${str(pick(exp, 'count'))} events · checksum ${str(pick(exp, 'checksum')).slice(0, 16)}…`)
    } catch (err) {
      setAuditMsg(err instanceof Error ? err.message : 'Export failed.')
    }
  }, [exportReferralAudit])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Referral Trust Review</h1>
          <p className="text-gray-500">Risk checks, review cases, holds, disputes, and audit — for referral benefits</p>
        </div>
      </div>

      {rules && (
        <Card className="border-0 card-shadow">
          <CardContent className="p-6">
            <h2 className="font-semibold mb-2">Trust Rules</h2>
            <div className="text-xs text-gray-600 space-y-1">
              {Array.isArray(pick(rules, 'recommendations')) && <p><span className="font-medium">Recommendations:</span> {(pick(rules, 'recommendations') as unknown[]).map(str).join(', ')}</p>}
              {Array.isArray(pick(rules, 'review_statuses')) && <p><span className="font-medium">Review statuses:</span> {(pick(rules, 'review_statuses') as unknown[]).map(str).join(', ')}</p>}
              {Array.isArray(pick(rules, 'dispute_statuses')) && <p><span className="font-medium">Dispute statuses:</span> {(pick(rules, 'dispute_statuses') as unknown[]).map(str).join(', ')}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Risk check */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Run Risk Check</h2>
            <Input placeholder="target_id (user/code)" value={riskTarget} onChange={(e) => setRiskTarget(e.target.value)} />
            <Input placeholder="wallet_transaction_id (optional)" value={riskTx} onChange={(e) => setRiskTx(e.target.value)} />
            <Input type="number" placeholder="duplicate_account_count (optional)" value={dupCount} onChange={(e) => setDupCount(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={onRisk}>Run</Button>
              <Button variant="outline" onClick={onCreateCase} disabled={!lastRiskEventId && !riskTarget.trim() && !riskTx.trim()}>Open Review Case</Button>
            </div>
            {riskResult && <p className="text-sm text-gray-700 break-all">{riskResult}</p>}
          </CardContent>
        </Card>

        {/* Wallet hold */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Apply Wallet Hold</h2>
            <Input placeholder="wallet_transaction_id" value={holdTx} onChange={(e) => setHoldTx(e.target.value)} />
            <Input placeholder="reason (required)" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            <Button variant="outline" onClick={onHold}>Apply Hold</Button>
            {holdMsg && <p className="text-sm text-gray-600">{holdMsg}</p>}
          </CardContent>
        </Card>

        {/* Benefit explanation */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Explain Benefit</h2>
            <Input placeholder="wallet_transaction_id" value={explainTx} onChange={(e) => setExplainTx(e.target.value)} />
            <Button variant="outline" onClick={onExplain}>Explain</Button>
            {explainText && <p className="text-sm text-gray-600">{explainText}</p>}
          </CardContent>
        </Card>

        {/* Disputes */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Disputes</h2>
            <Input data-testid="referral-admin-dispute-wallet-id" placeholder="wallet_transaction_id" value={disputeTx} onChange={(e) => setDisputeTx(e.target.value)} />
            <Input data-testid="referral-admin-dispute-reason" placeholder="reason (required)" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
            <Button data-testid="referral-admin-dispute-open" variant="outline" onClick={onCreateDispute}>Open Dispute</Button>
            {disputeMsg && <p data-testid="referral-admin-dispute-message" className="text-sm text-gray-600 break-all">{disputeMsg}</p>}
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <Input data-testid="referral-resolve-dispute-id" placeholder="dispute_event_id" value={resolveId} onChange={(e) => setResolveId(e.target.value)} />
              <div className="flex gap-2">
                <select data-testid="referral-resolve-outcome" value={resolveOutcome} onChange={(e) => setResolveOutcome(e.target.value)} className="border border-gray-200 rounded-md h-9 px-2 text-sm">
                  {DISPUTE_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <Input data-testid="referral-resolve-reason" placeholder="reason (required)" value={resolveReason} onChange={(e) => setResolveReason(e.target.value)} />
              </div>
              <Button data-testid="referral-resolve-submit" variant="outline" onClick={onResolve}>Resolve Dispute</Button>
              {resolveMsg && <p data-testid="referral-resolve-message" className="text-sm text-gray-600">{resolveMsg}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Review cases */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Review Cases</h2>
            <Button size="sm" variant="outline" onClick={loadCases} disabled={loading}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </div>
          {casesError ? (
            <p className="text-sm text-red-600">{casesError}</p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-gray-500">{loading ? 'Loading…' : 'No review cases.'}</p>
          ) : (
            <div className="space-y-2">
              {cases.map((ev) => (
                <ReviewCaseRow key={ev.id} event={ev} decide={decideReferralReviewCase} onDone={loadCases} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit export */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <h2 className="font-semibold">Audit Export</h2>
          <Button variant="outline" onClick={onExport}>Export Audit Trail</Button>
          {auditMsg && <p className="text-sm text-gray-600 break-all">{auditMsg}</p>}
        </CardContent>
      </Card>

      <ReferralRealList
        title="Disputes"
        load={loadDisputes}
        emptyText="No disputes yet."
        renderRow={(d: ReferralDispute) => (
          <div key={d.dispute_event_id} data-testid={`referral-admin-dispute-row-${d.dispute_event_id}`} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
            <span className="font-mono break-all">{d.dispute_event_id}</span>
            <span className="text-gray-500 mx-2">{[d.target_type, d.target_id].filter(Boolean).join(' ')}</span>
            <span className="text-gray-400 shrink-0">{d.status}</span>
          </div>
        )}
      />
      <ReferralEventLog title="Audit activity (event log)" />
    </div>
  )
}
