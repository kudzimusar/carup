/**
 * RX04-C2 — Refer & Earn, unified presentation (flag ON only; the accepted view is unchanged).
 *
 * Same reads, same handlers as the container (Referral V1, Stage-4 remediation B). Money is rendered
 * only through MoneyDisplay with the currency the server recorded: the wallet balances use the
 * wallet row's own currency, each benefit uses its transaction's currency, and a missing currency is
 * said out loud ("Currency not recorded") instead of being assumed. A failed wallet read is never
 * shown as a zero balance, and an unreadable dispute list is never shown as "no disputes".
 */
import type { ReactNode } from 'react'
import { CheckCircle2, ChevronRight, Copy, HelpCircle, Share2, ShieldAlert, Wallet, XCircle } from 'lucide-react'
import { DataState, MoneyDisplay, formatMoney } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import type { OwnerReferralDispute, ReferralWalletTransaction } from '@/types/referral'

const H2 = 'text-[17px] font-semibold tracking-[-0.01em] text-carup-text'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3'
const FIELD = `min-h-11 w-full rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 text-[14px] text-carup-text placeholder:text-carup-text-3 ${OWNER_FOCUS}`
const SMALL_BUTTON = `inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 ${OWNER_FOCUS}`

const TX_TONE: Record<string, string> = {
  paid_or_applied: 'bg-status-success-soft text-status-success',
  approved: 'bg-status-success-soft text-status-success',
  payable: 'bg-status-success-soft text-status-success',
  eligible: 'bg-status-info-soft text-status-info',
  pending: 'bg-status-warning-soft text-status-warning',
  created: 'bg-status-neutral-soft text-status-neutral',
  held: 'bg-status-warning-soft text-status-warning',
  rejected: 'bg-status-danger-soft text-status-danger',
}
const TX_LABEL: Record<string, string> = {
  paid_or_applied: 'Paid or applied',
  approved: 'Approved',
  payable: 'Payable',
  eligible: 'Eligible',
  pending: 'Pending',
  created: 'Created',
  held: 'Held',
  rejected: 'Rejected',
}
const DISPUTE_TONE: Record<string, string> = {
  open: 'bg-status-warning-soft text-status-warning',
  under_review: 'bg-status-info-soft text-status-info',
  resolved_upheld: 'bg-status-neutral-soft text-status-neutral',
  resolved_reversed: 'bg-status-success-soft text-status-success',
  closed: 'bg-status-neutral-soft text-status-neutral',
}

function txStatusLabel(status?: string | null) {
  if (!status) return 'Status not recorded'
  return TX_LABEL[status] ?? status.replaceAll('_', ' ')
}

function stamp(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** A plain-text amount for a <select> option, with the same currency honesty as MoneyDisplay. */
function amountText(amount?: number, currency?: string | null): string {
  const f = formatMoney(amount, currency)
  if (f.kind === 'value') return `${f.amountText} ${f.currency}`
  if (f.kind === 'unsupported-currency') return `${f.amountText} ${f.code}`
  if (f.kind === 'currency-not-recorded') return `${f.amountText} (currency not recorded)`
  return 'amount not recorded'
}

function optionLabel(tx: ReferralWalletTransaction): string {
  const label = tx.reason || tx.event_type || 'Referral benefit'
  const suffix = String(tx.id || '').trim().slice(-4) || 'unknown'
  return `${label} · ${amountText(tx.amount, tx.currency)} · ${txStatusLabel(tx.status)} · ${stamp(tx.created_at) ?? 'date unavailable'} · …${suffix}`
}

function Balance({ label, detail, amount, currency }: { label: string; detail: string; amount?: number; currency: string | null }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 bg-carup-bg-raised px-4 py-3 sm:block sm:rounded-card sm:p-4 sm:ring-1 sm:ring-carup-line">
      <div className="min-w-0">
        <p className={EYEBROW}>{label}</p>
        <p className="mt-0.5 text-[12px] leading-5 text-carup-text-3 sm:hidden">{detail}</p>
      </div>
      <MoneyDisplay amount={amount} currency={currency} size="lg" className="shrink-0 sm:mt-1.5" />
      <p className="mt-1 hidden text-[12px] leading-5 text-carup-text-3 sm:block">{detail}</p>
    </div>
  )
}

function Card({ id, labelledBy, children, testId }: { id?: string; labelledBy: string; children: ReactNode; testId?: string }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6" aria-labelledby={labelledBy} data-testid={testId}>
      {children}
    </section>
  )
}

export interface ReferralWalletViewProps {
  loading: boolean
  walletError: string | null
  pending?: number
  approved?: number
  settled?: number
  walletCurrency: string | null
  transactions: ReferralWalletTransaction[]
  disputesUnreadable: boolean
  disputeByTxId: Map<string, OwnerReferralDispute>
  disputeLabel: (status?: string | null) => string
  explainFor: string | null
  explainText: string | null
  code: string
  validateMsg: { ok: boolean; text: string } | null
  shareLink: string | null
  shareMsg: string | null
  disputeTxId: string
  disputeReason: string
  disputeMsg: string | null
  onRetryWallet: () => void
  onExplain: (txId: string) => void
  onCode: (value: string) => void
  onValidate: () => void
  onShare: () => void
  onCopy: () => void
  onDisputeTx: (txId: string) => void
  onDisputeReason: (value: string) => void
  onDispute: () => void
}

export function ReferralWalletView(props: ReferralWalletViewProps) {
  const { loading, walletError, transactions, disputeByTxId, walletCurrency } = props

  function disputeThis(txId: string) {
    props.onDisputeTx(txId)
    const form = document.getElementById('referral-dispute')
    if (form && typeof form.scrollIntoView === 'function') form.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6" data-testid="referrals-unified" data-presentation="rx04">
      <OwnerPageHeader
        title="Refer & Earn"
        description="The benefits you have earned by referring people to CarUp, a way to check and share a referral code, and help when a benefit looks wrong."
        meta={!loading && !walletError ? (transactions.length === 1 ? '1 referral benefit' : `${transactions.length} referral benefits`) : undefined}
        actions={<a href="#referral-share" className={OWNER_SECONDARY_ACTION}><Share2 className="h-4 w-4" aria-hidden="true" /> Share a code</a>}
      />

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Benefit wallet */}
        <Card labelledBy="referral-wallet-title" testId="referral-wallet">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
            <h2 id="referral-wallet-title" className={H2}>Benefit wallet</h2>
          </div>

          {walletError ? (
            <div className="mt-4">
              <DataState
                state="error"
                subject="Benefit wallet"
                description="Your referral wallet could not be read, so no balance is shown. This is not a zero balance."
                action={{ label: 'Try again', onClick: props.onRetryWallet }}
              />
              <details className="group mt-2 text-[12px] text-carup-text-3">
                <summary className={`flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-control font-medium text-carup-text-2 [&::-webkit-details-marker]:hidden ${OWNER_FOCUS}`}>
                  <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" aria-hidden="true" /> Technical detail for support
                </summary>
                <p className="break-words pb-1">{walletError}</p>
              </details>
            </div>
          ) : loading ? (
            <div className="mt-4"><DataState state="loading" subject="Benefit wallet" /></div>
          ) : (
            <>
              <div className="mt-4 divide-y divide-carup-line overflow-hidden rounded-card ring-1 ring-carup-line sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:ring-0">
                <Balance label="Approved" detail="Approved or payable, not yet settled" amount={props.approved} currency={walletCurrency} />
                <Balance label="Pending" detail="Waiting for approval" amount={props.pending} currency={walletCurrency} />
                <Balance label="Settled" detail="Paid out or applied" amount={props.settled} currency={walletCurrency} />
              </div>
              <p className="mt-3 text-[13px] leading-5 text-carup-text-2">
                Benefits stay pending until they are approved — they never mature from a signup alone.
              </p>

              {props.disputesUnreadable && (
                <p role="alert" className="mt-4 rounded-control border border-status-warning bg-status-warning-soft px-3 py-2.5 text-[13px] leading-5 text-carup-text" data-testid="referral-wallet-disputes-unavailable">
                  Dispute status could not be loaded, so no dispute is shown against any benefit below.
                  This is not confirmation that none is open.
                </p>
              )}

              <h3 className="mt-6 text-[15px] font-semibold text-carup-text">Your referral benefits</h3>
              {transactions.length === 0 ? (
                <div className="mt-2 rounded-card bg-carup-bg-surface px-4 py-6 text-center" data-testid="referral-wallet-empty">
                  <p className="text-[14px] font-semibold text-carup-text">No referral benefits yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] leading-5 text-carup-text-2">
                    Share your code to start earning.
                  </p>
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-carup-line">
                  {transactions.map(tx => {
                    const dispute = disputeByTxId.get(tx.id)
                    const created = stamp(tx.created_at)
                    return (
                      <li key={tx.id} data-testid={`referral-wallet-transaction-${tx.id}`} className="py-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-carup-text [overflow-wrap:anywhere]">{tx.reason || tx.event_type || 'Referral benefit'}</p>
                            <p className="mt-0.5 text-[12px] text-carup-text-3">{created ?? 'Date not recorded'}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <MoneyDisplay amount={tx.amount} currency={tx.currency} />
                            <span
                              data-testid={`referral-wallet-transaction-status-${tx.id}`}
                              className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TX_TONE[tx.status || ''] ?? 'bg-status-neutral-soft text-status-neutral'}`}
                            >
                              {txStatusLabel(tx.status)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <button type="button" onClick={() => props.onExplain(tx.id)} className={SMALL_BUTTON} aria-expanded={props.explainFor === tx.id}>
                            <HelpCircle className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Why this status?
                          </button>
                          <button type="button" onClick={() => disputeThis(tx.id)} className={SMALL_BUTTON}>
                            <ShieldAlert className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Dispute
                          </button>
                        </div>
                        {props.explainFor === tx.id && (
                          <p className="mt-2 rounded-control bg-carup-bg-surface px-3 py-2 text-[13px] leading-5 text-carup-text-2" role="status" aria-live="polite">{props.explainText}</p>
                        )}
                        {dispute && (
                          <div className="mt-2 rounded-control bg-carup-bg-surface px-3 py-2.5" data-testid={`dispute-status-${tx.id}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${DISPUTE_TONE[dispute.status || ''] ?? 'bg-status-neutral-soft text-status-neutral'}`}>
                                {props.disputeLabel(dispute.status)}
                              </span>
                              {dispute.resolved_at && <span className="text-[12px] text-carup-text-3">Resolved {stamp(dispute.resolved_at) ?? 'date unavailable'}</span>}
                              {!dispute.resolved_at && dispute.submitted_at && <span className="text-[12px] text-carup-text-3">Filed {stamp(dispute.submitted_at) ?? 'date unavailable'}</span>}
                            </div>
                            {dispute.owner_safe_resolution && <p className="mt-1.5 text-[13px] leading-5 text-carup-text-2">{dispute.owner_safe_resolution}</p>}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {/* Check and share a code */}
          <Card id="referral-share" labelledBy="referral-share-title" testId="referral-share">
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
              <h2 id="referral-share-title" className={H2}>Check &amp; share a code</h2>
            </div>
            <p className="mt-1 text-[14px] leading-6 text-carup-text-2">Enter your referral code to check it, then create a link you can share.</p>
            <label htmlFor="referral-code" className="mt-4 block text-[13px] font-semibold text-carup-text">Referral code</label>
            <input
              id="referral-code"
              value={props.code}
              onChange={event => props.onCode(event.target.value)}
              placeholder="Enter a referral code"
              autoCapitalize="characters"
              className={`${FIELD} mt-1.5`}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={props.onShare} className={OWNER_PRIMARY_ACTION}>Create share kit</button>
              <button type="button" onClick={props.onValidate} className={OWNER_SECONDARY_ACTION}>Check code</button>
            </div>
            {props.validateMsg && (
              <p role="status" className={`mt-3 flex items-start gap-1.5 text-[13px] leading-5 ${props.validateMsg.ok ? 'text-status-success' : 'text-status-danger'}`}>
                {props.validateMsg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                {props.validateMsg.text}
              </p>
            )}
            {props.shareLink && (
              <div className="mt-3 flex items-center gap-2">
                <input readOnly value={props.shareLink} aria-label="Share link" className={`${FIELD} min-w-0 flex-1 font-mono text-[12px]`} onFocus={event => event.currentTarget.select()} />
                <button type="button" onClick={props.onCopy} className={`${SMALL_BUTTON} shrink-0`}><Copy className="h-4 w-4" aria-hidden="true" /> Copy</button>
              </div>
            )}
            {props.shareMsg && <p role="status" className="mt-3 text-[13px] leading-5 text-carup-text-2">{props.shareMsg}</p>}
          </Card>

          {/* Dispute a benefit */}
          <Card id="referral-dispute" labelledBy="referral-dispute-title" testId="referral-dispute">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
              <h2 id="referral-dispute-title" className={H2}>Dispute a benefit</h2>
            </div>
            <p className="mt-1 text-[14px] leading-6 text-carup-text-2">If a held or rejected benefit looks wrong, tell us why and a reviewer will check it.</p>
            <label htmlFor="referral-dispute-transaction" className="mt-4 block text-[13px] font-semibold text-carup-text">Benefit</label>
            <select
              id="referral-dispute-transaction"
              data-testid="referral-dispute-transaction-select"
              value={props.disputeTxId}
              onChange={event => props.onDisputeTx(event.target.value)}
              className={`${FIELD} mt-1.5 text-ellipsis`}
            >
              <option value="">Select a transaction…</option>
              {transactions.map(tx => (
                <option key={tx.id} value={tx.id}>{optionLabel(tx)}</option>
              ))}
            </select>
            {walletError && (
              <p className="mt-1.5 text-[12px] leading-5 text-carup-text-3">Your benefits could not be loaded, so there are none to choose from right now.</p>
            )}
            {!walletError && !loading && transactions.length === 0 && (
              <p className="mt-1.5 text-[12px] leading-5 text-carup-text-3">You have no referral benefits to dispute.</p>
            )}
            <label htmlFor="referral-dispute-reason" className="mt-3 block text-[13px] font-semibold text-carup-text">What looks wrong?</label>
            <textarea
              id="referral-dispute-reason"
              data-testid="referral-dispute-reason"
              placeholder="Describe the issue"
              value={props.disputeReason}
              onChange={event => props.onDisputeReason(event.target.value)}
              rows={4}
              className={`${FIELD} mt-1.5 py-2.5 leading-6`}
            />
            <button type="button" data-testid="referral-dispute-submit" onClick={props.onDispute} className={`${OWNER_SECONDARY_ACTION} mt-3`}>File dispute</button>
            {props.disputeMsg && <p data-testid="referral-dispute-message" role="status" className="mt-3 text-[13px] leading-5 text-carup-text-2">{props.disputeMsg}</p>}
          </Card>
        </div>
      </div>
    </div>
  )
}
