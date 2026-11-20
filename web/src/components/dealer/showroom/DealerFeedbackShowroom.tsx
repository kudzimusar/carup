/**
 * RX05-A — the unified (showroom) presentation of /dealers/feedback. The page container keeps the
 * canonical transaction read, the eligibility rules (canSubmit) and the private case POST. This view
 * never shows stars, never calls a case a review and never implies a verified purchase.
 */
import { Link } from 'react-router-dom'
import { EyeOff, Lock, MessageSquareWarning, RotateCcw, ShieldOff, Wallet } from 'lucide-react'
import { dealerDateTime } from '@/lib/dealerDates'
import { cn } from '@/lib/utils'
import { humanizeStatus } from './dealerShowroomModel'
import { ACTION_PRIMARY, ACTION_SECONDARY, CARD, EYEBROW, FIELD, HINT, LABEL, Notice, SkeletonBlock, StatusChip, TEXTAREA, TEXT_LINK } from './ShowroomPrimitives'

export type FeedbackCaseType = 'BUYER_COMPLAINT' | 'REVIEW_CANDIDATE'

export interface FeedbackTransaction {
  transaction_id: string
  seed_dealer_id: string
  canonical_status: string
  can_submit_review_candidate: boolean
}

export interface FeedbackCase {
  case_id: string
  seed_dealer_id: string
  case_type: FeedbackCaseType
  submitted_at: string
}

export interface DealerFeedbackShowroomProps {
  signedIn: boolean
  loading: boolean
  entries: FeedbackTransaction[] | null
  cases: FeedbackCase[] | null
  selected: string
  onSelect: (transactionId: string) => void
  transaction: FeedbackTransaction | undefined
  type: FeedbackCaseType
  onType: (value: FeedbackCaseType) => void
  rating: number
  onRating: (value: number) => void
  statement: string
  onStatement: (value: string) => void
  canSubmit: boolean
  saving: boolean
  notice: string
  error: string
  onSubmit: () => void
  onRetry: () => void
}

const PROMISES: Array<[typeof Lock, string]> = [
  [Lock, 'Seen only by you and independent CarUp reviewers'],
  [EyeOff, 'Never published as stars or a public review'],
  [Wallet, 'Opens no escrow dispute, refund or payment change'],
]

export function DealerFeedbackShowroom(props: DealerFeedbackShowroomProps) {
  const { signedIn, loading, entries, cases, transaction, type } = props
  const statementLength = props.statement.trim().length
  return (
    <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-feedback-showroom" data-presentation="showroom">
      <div className="mx-auto w-full max-w-[1040px] px-4 pb-16 pt-6 sm:px-6 lg:pt-10">
        <Link to="/dealers" className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center text-sm')}>Dealer directory</Link>
        <header className="mt-4">
          <p className={EYEBROW}>Private buyer case</p>
          <h1 className="mt-2 text-[clamp(1.75rem,3.4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">Private buyer feedback and complaints</h1>
          <p className="mt-4 max-w-3xl text-[15px] leading-7 text-carup-text-2">
            Only transactions actually linked to your authenticated account and a canonical
            dealership appear here. Submitting a case does not verify a purchase, publish
            stars, open an escrow dispute, authorize refunds or change any payment.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {PROMISES.map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-2.5 rounded-card bg-carup-bg-surface p-3.5 text-[13px] leading-5 text-carup-text-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />{text}
              </li>
            ))}
          </ul>
        </header>

        <div className="mt-10 space-y-6">
          {!signedIn ? (
            <section className={cn(CARD, 'flex flex-col gap-4 p-6 sm:flex-row sm:items-center')} role="alert">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-carup-bg-surface text-carup-text-2" aria-hidden="true"><Lock className="h-5 w-5" /></span>
              <p className="min-w-0 flex-1 text-[15px] leading-6">Sign in to access only your own transaction-linked private cases.</p>
              <Link className={ACTION_PRIMARY} to="/login">Sign in</Link>
            </section>
          ) : loading ? (
            <div>
              <SkeletonBlock className="h-40 w-full" />
              <p role="status" className="mt-3 text-sm text-carup-text-2">Checking your canonical transaction history…</p>
            </div>
          ) : (
            <>
              {props.error && (
                <div>
                  <Notice tone="danger" role="alert">{props.error}</Notice>
                  {!entries && (
                    <button type="button" onClick={props.onRetry} className={cn(ACTION_SECONDARY, 'mt-3')} data-testid="dealer-feedback-retry">
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />Try again
                    </button>
                  )}
                </div>
              )}
              {props.notice && <Notice tone="info" role="status">{props.notice}</Notice>}

              {entries && entries.length === 0 && (
                <section className={cn(CARD, 'flex gap-4 p-6')}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-carup-bg-surface text-carup-text-3" aria-hidden="true"><ShieldOff className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h2 className="font-semibold">No eligible dealership transaction record found</h2>
                    <p className="mt-2 text-sm leading-6 text-carup-text-2">
                      This is not proof you have no purchases. The canonical transaction source
                      could not link an eligible dealership transaction to this account.
                      A general listing correction is handled separately and cannot become a verified review.
                    </p>
                  </div>
                </section>
              )}

              {transaction && (
                <section className={cn(CARD, 'space-y-6 p-5 sm:p-8')} aria-labelledby="feedback-form-heading">
                  <h2 id="feedback-form-heading" className="text-xl font-semibold tracking-[-0.015em]">Submit a private case</h2>
                  <div>
                    <label htmlFor="buyer-dealer-transaction" className={LABEL}>Your canonical dealership transaction</label>
                    <select id="buyer-dealer-transaction" className={FIELD} value={props.selected} onChange={event => props.onSelect(event.target.value)}>
                      {entries?.map(row => (
                        <option value={row.transaction_id} key={row.transaction_id}>
                          {row.seed_dealer_id} · {row.transaction_id} · {row.canonical_status}
                        </option>
                      ))}
                    </select>
                    <p className={cn(HINT, 'text-status-warning')}>
                      A canonical status, including sandbox release, is not independent proof of a
                      completed real-world purchase or a verified public review.
                    </p>
                  </div>
                  <fieldset>
                    <legend className={LABEL}>Case type</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ['BUYER_COMPLAINT', 'Private buyer complaint', 'Something went wrong with this dealership transaction.', true],
                        ['REVIEW_CANDIDATE', 'Unverified review candidate (never a public rating)', 'A private, unverified account of your experience for independent review.', transaction.can_submit_review_candidate],
                      ] as Array<[FeedbackCaseType, string, string, boolean]>).map(([value, title, body, enabled]) => (
                        <label
                          key={value}
                          className={cn(
                            'flex min-h-11 cursor-pointer gap-3 rounded-card p-4 ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-carup-focus',
                            type === value ? 'bg-carup-action-soft ring-carup-action' : 'bg-carup-bg-raised ring-carup-line hover:bg-carup-bg-surface',
                            !enabled && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <input type="radio" name="feedback-kind" value={value} className="mt-1 h-4 w-4 shrink-0 accent-carup-action"
                            disabled={!enabled} checked={type === value} onChange={() => props.onType(value)} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{title}</span>
                            <span className="mt-0.5 block text-[13px] leading-5 text-carup-text-2">{body}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {type === 'REVIEW_CANDIDATE' && (
                    <div className="max-w-xs">
                      <label htmlFor="candidate-rating" className={LABEL}>Proposed rating — for independent private review only</label>
                      <select id="candidate-rating" className={FIELD} value={props.rating} onChange={event => props.onRating(Number(event.target.value))}>
                        <option value={0}>Select 1–5</option>
                        {[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="buyer-case-description" className={LABEL}>Your account of the issue (40–2,000 characters)</label>
                    <textarea id="buyer-case-description" className={cn(TEXTAREA, 'min-h-36')} minLength={40} maxLength={2000} value={props.statement} onChange={event => props.onStatement(event.target.value)} />
                    <p className={HINT} aria-live="polite">{statementLength < 40 ? `${40 - statementLength} more characters needed` : `${statementLength} of 2,000 characters`}</p>
                  </div>
                  <button type="button" disabled={!props.canSubmit} onClick={props.onSubmit} className={ACTION_PRIMARY}>
                    {props.saving ? 'Submitting privately…' : 'Submit private buyer case'}
                  </button>
                </section>
              )}

              {/* Cases are listed only after the canonical read succeeded; a failed read never says "none". */}
              {cases && <section className={cn(CARD, 'p-5 sm:p-8')} aria-labelledby="feedback-cases-heading">
                <h2 id="feedback-cases-heading" className="text-xl font-semibold tracking-[-0.015em]">Your recorded cases</h2>
                {cases.length === 0 ? (
                  <p className="mt-3 text-sm text-carup-text-2">No private cases have been submitted.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-carup-line">
                    {cases.map(row => (
                      <li key={row.case_id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            <MessageSquareWarning className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
                            {humanizeStatus(row.case_type)} · {row.seed_dealer_id}
                          </p>
                          <p className="mt-1 break-all text-[13px] text-carup-text-2">Receipt: {row.case_id}</p>
                          <p className="text-[13px] text-carup-text-3">Submitted {dealerDateTime(row.submitted_at)}</p>
                        </div>
                        <StatusChip tone="neutral" className="self-start">Private case; independent finding pending or recorded separately</StatusChip>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 border-t border-carup-line pt-4 text-xs text-carup-text-3">Public verified review count and score are not inferred from private cases.</p>
              </section>}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
