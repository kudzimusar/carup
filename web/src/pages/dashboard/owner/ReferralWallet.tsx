import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Gift, Wallet, Share2, Copy, ShieldAlert, CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { ReferralWalletTransaction, OwnerReferralDispute } from '@/types/referral'

/**
 * Owner "Refer & Earn" surface (Phase B). Owner-scoped, read-mostly:
 * - wallet benefit status (pending vs approved shown separately)
 * - referral code validation
 * - per-channel share kit (no manual URL copying)
 * - benefit explanation for held/pending transactions
 * - file a dispute
 * - read-only catalog of safe agent tools
 *
 * Every call goes through useCarUpApi (auto identity headers + CSRF). No admin
 * actions and no backend changes — uses existing endpoints only.
 */

const STATUS_STYLES: Record<string, string> = {
  paid_or_applied: 'bg-green-100 text-green-700',
  approved: 'bg-green-100 text-green-700',
  payable: 'bg-emerald-100 text-emerald-700',
  eligible: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  created: 'bg-gray-100 text-gray-700',
  held: 'bg-orange-100 text-orange-700',
  rejected: 'bg-red-100 text-red-700',
}

function statusClass(status?: string): string {
  return STATUS_STYLES[status || ''] || 'bg-gray-100 text-gray-700'
}

const DISPUTE_STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  under_review: 'bg-blue-100 text-blue-700',
  resolved_upheld: 'bg-gray-200 text-gray-700',
  resolved_reversed: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
}

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Dispute submitted',
  under_review: 'Dispute under review',
  resolved_upheld: 'Dispute resolved — upheld',
  resolved_reversed: 'Dispute resolved — reversed',
  closed: 'Dispute closed',
}

function disputeStatusClass(status?: string | null): string {
  return DISPUTE_STATUS_STYLES[status || ''] || 'bg-gray-100 text-gray-600'
}

function disputeStatusLabel(status?: string | null): string {
  return DISPUTE_STATUS_LABELS[status || ''] || 'Dispute recorded'
}

function money(amount?: number, currency?: string | null): string {
  if (typeof amount !== 'number') return '—'
  return `${currency ? `${currency} ` : '$'}${amount.toLocaleString()}`
}

export default function ReferralWallet() {
  const {
    getReferralWallet,
    validateReferralCode,
    createReferralChannelShareKit,
    explainReferralBenefit,
    createReferralDispute,
    getOwnerReferralDisputes,
  } = useCarUpApi()
  const { user } = useAuth()
  const userId = user?.id

  const [pending, setPending] = useState<number | undefined>(undefined)
  const [approved, setApproved] = useState<number | undefined>(undefined)
  const [settled, setSettled] = useState<number | undefined>(undefined)
  const [transactions, setTransactions] = useState<ReferralWalletTransaction[]>([])
  const [walletError, setWalletError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [code, setCode] = useState('')
  const [validateMsg, setValidateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

  const [explainFor, setExplainFor] = useState<string | null>(null)
  const [explainText, setExplainText] = useState<string | null>(null)

  const [disputeTxId, setDisputeTxId] = useState<string>('')
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null)
  const [disputes, setDisputes] = useState<OwnerReferralDispute[]>([])

  const loadWallet = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setWalletError(null)
    try {
      const res = await getReferralWallet(userId)
      const w = res.wallet
      setPending(w?.pending_balance)
      // "Approved" = claimable but not yet settled (approved + payable buckets).
      setApproved((w?.approved_balance ?? 0) + (w?.payable_balance ?? 0))
      setSettled(w?.paid_or_applied_balance)
      setTransactions(res.transactions ?? [])
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Could not load your referral wallet.')
    } finally {
      setLoading(false)
    }
  }, [getReferralWallet, userId])

  const loadDisputes = useCallback(async () => {
    try {
      const res = await getOwnerReferralDisputes()
      setDisputes(Array.isArray(res.disputes) ? res.disputes : [])
    } catch {
      // Non-fatal: the dispute panel degrades to empty; wallet/validate/share stay functional.
      setDisputes([])
    }
  }, [getOwnerReferralDisputes])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (active) await loadWallet()
    })
    return () => {
      active = false
    }
  }, [loadWallet])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (active) await loadDisputes()
    })
    return () => {
      active = false
    }
  }, [loadDisputes])

  const onValidate = useCallback(async () => {
    if (!code.trim()) {
      setValidateMsg({ ok: false, text: 'Enter a referral code first.' })
      return
    }
    try {
      const res = await validateReferralCode({ code: code.trim(), channel: 'web' })
      setValidateMsg(
        res.valid
          ? { ok: true, text: 'This referral code is valid.' }
          : { ok: false, text: res.reason ? String(res.reason) : 'This referral code is not valid.' }
      )
    } catch (err) {
      setValidateMsg({ ok: false, text: err instanceof Error ? err.message : 'Validation failed.' })
    }
  }, [code, validateReferralCode])

  const onShare = useCallback(async () => {
    if (!code.trim()) {
      setShareMsg('Enter your referral code to generate a share kit.')
      return
    }
    setShareMsg(null)
    setShareLink(null)
    try {
      const res = await createReferralChannelShareKit('web', { code: code.trim(), user_id: userId })
      // prepareShareKit returns the link under `copy.link`; fall back defensively.
      const copy = res.copy as { link?: unknown } | undefined
      const link =
        typeof copy?.link === 'string'
          ? copy.link
          : typeof res.share_url === 'string'
          ? res.share_url
          : typeof res.deep_link === 'string'
          ? res.deep_link
          : null
      if (link) {
        setShareLink(link)
      } else {
        setShareMsg('Share kit generated. See your campaign manager for the shareable assets.')
      }
    } catch (err) {
      setShareMsg(err instanceof Error ? err.message : 'Could not generate a share kit.')
    }
  }, [code, createReferralChannelShareKit, userId])

  const onCopy = useCallback(() => {
    if (shareLink) {
      navigator.clipboard?.writeText(shareLink).then(
        () => setShareMsg('Link copied.'),
        () => setShareMsg('Copy failed — select and copy manually.')
      )
    }
  }, [shareLink])

  const onExplain = useCallback(
    async (txId: string) => {
      setExplainFor(txId)
      setExplainText('Loading…')
      try {
        const res = await explainReferralBenefit(txId)
        setExplainText(
          typeof res.explanation === 'string' ? res.explanation : 'This benefit is being processed. No further detail is available yet.'
        )
      } catch (err) {
        setExplainText(err instanceof Error ? err.message : 'Could not load the explanation.')
      }
    },
    [explainReferralBenefit]
  )

  const onDispute = useCallback(async () => {
    if (!disputeTxId.trim() || !disputeReason.trim()) {
      setDisputeMsg('Choose a transaction and describe the issue.')
      return
    }
    try {
      await createReferralDispute({ wallet_transaction_id: disputeTxId.trim(), reason: disputeReason.trim() })
      setDisputeMsg('Dispute filed. A reviewer will look into it.')
      setDisputeReason('')
      // Refetch so the owner immediately sees the submitted dispute (and, after admin action, its resolution).
      await loadDisputes()
    } catch (err) {
      setDisputeMsg(err instanceof Error ? err.message : 'Could not file the dispute.')
    }
  }, [disputeTxId, disputeReason, createReferralDispute, loadDisputes])

  const disputeByTxId = useMemo(() => {
    const map = new Map<string, OwnerReferralDispute>()
    for (const d of disputes) {
      if (!d.wallet_transaction_id) continue
      // Keep the most recent dispute per transaction (API returns newest-first).
      if (!map.has(d.wallet_transaction_id)) map.set(d.wallet_transaction_id, d)
    }
    return map
  }, [disputes])

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Gift className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Refer &amp; Earn</h1>
          <p className="text-gray-500">Your referral benefits, sharing, and dispute history</p>
        </div>
      </div>

      {/* Wallet */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold">Benefit Wallet</h2>
          </div>
          {walletError ? (
            <p className="text-sm text-red-600">{walletError}</p>
          ) : loading ? (
            <p className="text-sm text-gray-500">Loading your wallet…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Approved</p>
                  <p className="text-xl font-bold text-green-600">{money(approved)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
                  <p className="text-xl font-bold text-amber-600">{money(pending)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Settled</p>
                  <p className="text-xl font-bold">{money(settled)}</p>
                </div>
              </div>

              {transactions.length === 0 ? (
                <p className="text-sm text-gray-500">No referral benefits yet. Share your code to start earning — benefits stay pending until they are approved (they never mature from signup alone).</p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div key={tx.id} data-testid={`referral-wallet-transaction-${tx.id}`} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{tx.reason || tx.event_type || 'Referral benefit'}</p>
                          <p className="text-xs text-gray-400">{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold">{money(tx.amount, tx.currency)}</span>
                          <Badge data-testid={`referral-wallet-transaction-status-${tx.id}`} className={`text-[10px] ${statusClass(tx.status)}`}>{tx.status || 'unknown'}</Badge>
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => onExplain(tx.id)}>
                            <HelpCircle className="w-3 h-3 mr-1" />Why?
                          </Button>
                        </div>
                      </div>
                      {explainFor === tx.id && (
                        <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2">{explainText}</p>
                      )}
                      {disputeByTxId.get(tx.id) && (() => {
                        const d = disputeByTxId.get(tx.id) as OwnerReferralDispute
                        return (
                          <div className="mt-2 rounded-md bg-gray-50 p-2" data-testid={`dispute-status-${tx.id}`}>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] ${disputeStatusClass(d.status)}`}>{disputeStatusLabel(d.status)}</Badge>
                              {d.resolved_at && (
                                <span className="text-[11px] text-gray-400">Resolved {new Date(d.resolved_at).toLocaleString()}</span>
                              )}
                              {!d.resolved_at && d.submitted_at && (
                                <span className="text-[11px] text-gray-400">Filed {new Date(d.submitted_at).toLocaleString()}</span>
                              )}
                            </div>
                            {d.owner_safe_resolution && (
                              <p className="mt-1 text-[11px] text-gray-600">{d.owner_safe_resolution}</p>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Validate + Share */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold">Validate &amp; Share a Code</h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Enter a referral code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="sm:max-w-xs"
            />
            <Button variant="outline" onClick={onValidate}>Validate</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onShare}>Create Share Kit</Button>
          </div>
          {validateMsg && (
            <p className={`text-sm flex items-center gap-1 ${validateMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
              {validateMsg.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {validateMsg.text}
            </p>
          )}
          {shareLink && (
            <div className="flex items-center gap-2">
              <Input readOnly value={shareLink} className="sm:max-w-md text-xs" />
              <Button size="sm" variant="outline" onClick={onCopy}><Copy className="w-3 h-3 mr-1" />Copy</Button>
            </div>
          )}
          {shareMsg && <p className="text-sm text-gray-600">{shareMsg}</p>}
        </CardContent>
      </Card>

      {/* Dispute */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold">Dispute a Benefit</h2>
          </div>
          <p className="text-xs text-gray-500">If a held or rejected benefit looks wrong, tell us why and a reviewer will check it.</p>
          <select
            data-testid="referral-dispute-transaction-select"
            value={disputeTxId}
            onChange={(e) => setDisputeTxId(e.target.value)}
            className="w-full sm:max-w-xs border border-gray-200 rounded-md h-9 px-3 text-sm"
          >
            <option value="">Select a transaction…</option>
            {transactions.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {(tx.reason || tx.event_type || tx.id)} — {tx.status}
              </option>
            ))}
          </select>
          <Textarea
            data-testid="referral-dispute-reason"
            placeholder="Describe the issue"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            className="sm:max-w-md"
          />
          <Button data-testid="referral-dispute-submit" variant="outline" onClick={onDispute}>File Dispute</Button>
          {disputeMsg && <p data-testid="referral-dispute-message" className="text-sm text-gray-600">{disputeMsg}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
