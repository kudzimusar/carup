/**
 * RX-06 Trade — the SafeTrade operations console (unified presentation of
 * /diaspora/safetrade/operations): queue → case → action, the RX-05 reviewer-workbench grammar.
 *
 *   ink desk header with ONE backlog pulse line · sandbox / LIVE_PAYMENT-off line (always visible)
 *   queues: approvals awaiting a second approver · operations awaiting confirmation · undeliverable events
 *   case: identity facts → evidence → decision (only what the server allows, each behind an explicit
 *   confirm step) → audit (only what the read returned)
 *
 * Fed by DiasporaSafeTradeOperations' own reads and its own `act` handler. A failed, refused (403),
 * missing (404) or rate-limited (429) queue is said in its own words and is NEVER drawn as "none
 * waiting" or "everything reconciled". No decision is automatic and no amount is real money.
 */
import { SignInLink } from '@/components/trade/core/SignInLink'
import { useId, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react'
import {
  REVIEW_FIELD, REVIEW_HINT, REVIEW_LABEL, REVIEW_PRIMARY, REVIEW_SECONDARY,
  ReviewAuditTrail, ReviewCaseBody, ReviewCaseHeader, ReviewDecisionPanel, ReviewNoCase, ReviewQueueItem, ReviewQueueTabs,
  ReviewSection, ReviewWorkbenchGrid, type ReviewAuditEntry, type ReviewFact,
} from '@/components/dealer/review/ReviewCaseFile'
import { SAFETRADE_NON_CUSTODIAL_NOTICE } from '@/config/safeTradeFlag'
import { formatAge, outboxHealth } from '@/pages/diaspora/safeTradeOperationsHelpers'
import { DeskHeader, DeskNotice, DeskPulse, DeskState, Provenance, ReadFailureState } from '@/components/trade/seller/DeskPrimitives'
import { DESK_DANGER, DESK_INK_SECONDARY, DESK_PRIMARY } from '@/components/trade/seller/deskStyles'
import { humanize, money, plural, when, type ReadFailure } from '@/components/trade/seller/deskFormat'
import type { SafeTradeApproval, SafeTradeOperation, SafeTradeOutboxDeadLetter } from '@/types'
import {
  approvalBlockedForViewer, opsQueueState, requesterLabel, type OpsConsoleModel, type OpsQueueKey, type OpsQueueState,
} from './opsConsole'

const PAGE = 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8'
const CONFIRM_BOX = 'space-y-3 rounded-control bg-carup-bg-surface p-3 ring-1 ring-carup-line-strong'

const QUEUES: ReadonlyArray<{ id: OpsQueueKey; label: string; what: string }> = [
  { id: 'approvals', label: 'Approvals', what: 'Approvals waiting' },
  { id: 'confirmation', label: 'Confirmation', what: 'The reconciliation queue' },
  { id: 'undeliverable', label: 'Undeliverable', what: 'Undeliverable events' },
]

/** What a failed queue read must never be mistaken for. */
const NOT_A_CLEAN_RESULT: Record<OpsQueueKey, string> = {
  approvals: 'This is not a report that none are waiting.',
  confirmation: 'Reconciliation is unverified. This is not a report that everything is reconciled.',
  undeliverable: 'This is not a report that there are none.',
}

export function OpsConsoleView({ model }: { model: OpsConsoleModel }) {
  const [tab, setTab] = useState<OpsQueueKey>('approvals')
  const [picked, setPicked] = useState<Record<OpsQueueKey, string | null>>({ approvals: null, confirmation: null, undeliverable: null })
  const [confirmDrain, setConfirmDrain] = useState(false)

  if (!model.flagEnabled) {
    return (
      <div className={PAGE}>
        <DeskState kind="unavailable" testId="ops-unavailable" title="SafeTrade operations are not available in this environment">
          The SafeTrade interface is switched off here, so this console reads nothing. An administrator can enable it.
        </DeskState>
      </div>
    )
  }
  if (model.authLoading) {
    return <div className={PAGE}><DeskState kind="loading" testId="ops-loading" title="Opening the operations console…" /></div>
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" testId="ops-signin" title="Sign in to open the operations console"
          action={<SignInLink className={DESK_PRIMARY}>Sign in</SignInLink>}>
          SafeTrade operations are for CarUp reviewers and administrators.
        </DeskState>
      </div>
    )
  }
  if (!model.isReviewer) {
    return (
      <div className={PAGE}>
        <DeskState kind="denied" testId="ops-denied" title="Reviewer access required">
          The SafeTrade operations console is limited to reviewers and administrators. This account is signed in as{' '}
          <strong className="text-carup-text">{humanize(model.role, 'an unrecognised role')}</strong>; nothing was read.
        </DeskState>
      </div>
    )
  }

  const lists = { approvals: model.approvals, confirmation: model.queue, undeliverable: model.deadLetters }
  const failureOf: Record<OpsQueueKey, ReadFailure | null> = {
    approvals: model.failures.approvals, confirmation: model.failures.queue, undeliverable: model.failures.deadLetters,
  }
  const stateOf = (k: OpsQueueKey): OpsQueueState => opsQueueState(model.loading, model.loadedOnce, failureOf[k], lists[k].length)
  const tabState = stateOf(tab)
  const items: Array<{ id: string }> = lists[tab]
  const selectedId = items.find((i) => i.id === picked[tab])?.id ?? items[0]?.id ?? null
  const health = outboxHealth(model.backlog)
  const busyDrain = model.busyId === 'drain'

  return (
    <div className={PAGE} data-testid="ops-console">
      <div role="status" aria-live="polite" className="sr-only" data-testid="ops-announcer">
        {model.loading ? 'Loading SafeTrade operations'
          : model.failures.approvals ? 'Approvals could not be read'
            : `${plural(model.approvals.length, 'approval')} awaiting review`}
      </div>

      <DeskHeader testId="ops-header" eyebrow="Trade · Operations" title="SafeTrade operations"
        description="Decisions waiting for a second human, money operations the provider has not confirmed, and events that could not be delivered. Nothing on this console happens automatically."
        actions={(
          <>
            <button type="button" className={DESK_INK_SECONDARY} onClick={model.onRefresh} disabled={model.loading} data-testid="ops-refresh">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> {model.loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {model.isPlatformAdmin && (
              <button type="button" className={DESK_INK_SECONDARY} onClick={() => setConfirmDrain(true)} disabled={busyDrain} data-testid="ops-drain-open">
                <Clock className="h-4 w-4" aria-hidden="true" /> {busyDrain ? 'Draining…' : 'Drain now…'}
              </button>
            )}
          </>
        )}
        pulse={<BacklogPulse model={model} />}
      />

      <div className="mt-4 flex flex-col gap-2 rounded-card border border-status-warning bg-status-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="ops-sandbox-line">
        <Provenance kind="sandbox" testId="ops-sandbox-chip" />
        <p className="text-sm leading-6 text-carup-text">
          LIVE_PAYMENT is off. Every amount on this console is a sandbox payment-state simulation — no real money is held, moved or released.
        </p>
      </div>

      <div className="mt-4 space-y-3 empty:hidden">
        {model.failures.backlog && (
          <ReadFailureState failure={model.failures.backlog} what="The event backlog" onRetry={model.onRefresh} compact testId="ops-backlog-failed" />
        )}
        {health === 'warn' && model.backlog && (
          <DeskNotice tone="warning" testId="ops-outbox-stalled">
            <strong>Events are not being delivered.</strong> The oldest queued event has been waiting {formatAge(model.backlog.oldestPendingAgeSeconds)}. The drainer may have stopped.
          </DeskNotice>
        )}
        {health === 'error' && model.backlog && (
          <DeskNotice tone="warning" testId="ops-outbox-dead">
            <strong>{plural(model.backlog.deadLettered, 'event')} exhausted {model.backlog.deadLettered === 1 ? 'its' : 'their'} retries.</strong> They are listed under Undeliverable.
          </DeskNotice>
        )}
        {confirmDrain && model.isPlatformAdmin && (
          <div className={CONFIRM_BOX} data-testid="ops-drain-confirm">
            <p className="text-sm font-semibold text-carup-text">Drain the event backlog now?</p>
            <p className="text-sm leading-6 text-carup-text-2">CarUp delivers the next batch of queued events immediately — the same work the scheduled drainer does. Run it after fixing whatever stopped delivery. The server re-checks that you are a platform administrator.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={REVIEW_PRIMARY + ' sm:w-auto'} data-testid="ops-drain-confirm-go"
                onClick={() => { setConfirmDrain(false); model.onDrain() }}>Drain now</button>
              <button type="button" className={REVIEW_SECONDARY} onClick={() => setConfirmDrain(false)}>Cancel</button>
            </div>
          </div>
        )}
        {model.notice && (
          <DeskNotice tone={model.outcome?.tone === 'bad' ? 'danger' : 'info'} testId="ops-notice">
            {model.notice}
            {model.outcome?.tone === 'bad' && model.outcome.serverMessage ? <> The server said: “{model.outcome.serverMessage}”</> : null}
          </DeskNotice>
        )}
        {model.lastDrain && (
          <DeskNotice testId="ops-drain-receipt">
            Last drain, as reported by the server: {model.lastDrain.claimed} claimed · {model.lastDrain.dispatched} dispatched · {model.lastDrain.failed} failed · {model.lastDrain.deadLettered} dead-lettered · {model.lastDrain.noHandler} without a handler.
          </DeskNotice>
        )}
      </div>

      <div className="mt-6">
        <ReviewWorkbenchGrid testId="ops-workbench" caseLabel="Selected case"
          queue={(
            <OpsQueuePanel
              tab={tab}
              onTab={setTab}
              tabs={QUEUES.map((q) => {
                const s = stateOf(q.id)
                return { id: q.id, label: q.label, count: s === 'ready' || s === 'empty' ? lists[q.id].length : null }
              })}
              state={tabState}
              failure={failureOf[tab]}
              onRetry={model.onRefresh}
            >
              {tab === 'approvals' && model.approvals.map((a) => (
                <ReviewQueueItem key={a.id} testId={`ops-queue-item-${a.id}`} selected={selectedId === a.id}
                  onSelect={() => setPicked((p) => ({ ...p, approvals: a.id }))}
                  title={`${humanize(a.decision_type)} · ${money(a.amount, a.currency) ?? 'amount not recorded'}`}
                  status={a.state} meta={[`${humanize(a.risk_level)} risk`, `Requested by ${requesterLabel(a.requested_by, model.viewerId)}`]}
                  since={a.requested_at} sinceLabel="Requested"
                  flag={approvalBlockedForViewer(a) ? 'You requested this — another reviewer decides' : undefined} />
              ))}
              {tab === 'confirmation' && model.queue.map((op) => (
                <ReviewQueueItem key={op.id} testId={`ops-queue-item-${op.id}`} selected={selectedId === op.id}
                  onSelect={() => setPicked((p) => ({ ...p, confirmation: op.id }))}
                  title={`${humanize(op.operation)} · ${money(op.amount, op.currency) ?? 'amount not recorded'}`}
                  status={op.state} meta={[`${humanize(op.provider, 'Provider not recorded')} · ${plural(op.attempts ?? 0, 'attempt')}`]}
                  since={op.requested_at} sinceLabel="Requested"
                  flag={op.userState && !op.userState.settled ? 'Not settled' : undefined} />
              ))}
              {tab === 'undeliverable' && model.deadLetters.map((dl) => (
                <ReviewQueueItem key={dl.id} testId={`ops-queue-item-${dl.id}`} selected={selectedId === dl.id}
                  onSelect={() => setPicked((p) => ({ ...p, undeliverable: dl.id }))}
                  title={humanize(dl.event_type)} status={dl.status} meta={[plural(dl.attempts ?? 0, 'attempt')]}
                  since={dl.created_at} sinceLabel="Queued" />
              ))}
            </OpsQueuePanel>
          )}>
          <CaseColumn model={model} tab={tab} state={tabState} selectedId={selectedId} />
        </ReviewWorkbenchGrid>
      </div>

      <p className="mt-6 text-xs leading-5 text-carup-text-2" data-testid="ops-noncustodial">{SAFETRADE_NON_CUSTODIAL_NOTICE}</p>
    </div>
  )
}

/* ───────────────────────── header pulse ───────────────────────── */

function BacklogPulse({ model }: { model: OpsConsoleModel }) {
  const b = model.backlog
  if (model.failures.backlog) return <DeskPulse testId="ops-backlog-pulse" scope="Event backlog not loaded" items={[]} />
  if (!b) return <DeskPulse testId="ops-backlog-pulse" scope={model.loading ? 'Reading the event backlog…' : 'Event backlog not reported'} items={[]} />
  return (
    <DeskPulse testId="ops-backlog-pulse" scope="Event backlog" items={[
      { label: 'pending', value: b.pending, testId: 'ops-backlog-pending' },
      { label: 'retrying', value: b.retrying, testId: 'ops-backlog-retrying' },
      { label: 'dead-lettered', value: b.deadLettered, testId: 'ops-backlog-dead' },
      { label: 'oldest waiting', value: b.oldestPendingAgeSeconds == null ? 'not reported' : formatAge(b.oldestPendingAgeSeconds), testId: 'ops-backlog-oldest' },
    ]} />
  )
}

/* ───────────────────────── queue column ───────────────────────── */

function OpsQueuePanel({ tab, onTab, tabs, state, failure, onRetry, children }: {
  tab: OpsQueueKey
  onTab: (id: OpsQueueKey) => void
  tabs: Array<{ id: OpsQueueKey; label: string; count: number | null }>
  state: OpsQueueState
  failure: ReadFailure | null
  onRetry: () => void
  children: ReactNode
}) {
  const q = QUEUES.find((x) => x.id === tab)!
  return (
    <section aria-label="Operations queues" data-testid="ops-queue" data-queue={tab} data-queue-state={state}
      className="overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
      <div className="border-b border-carup-line px-4 py-3">
        <h2 className="text-sm font-semibold text-carup-text">Queues</h2>
      </div>
      <ReviewQueueTabs tabs={tabs} active={tab} onChange={onTab} label="Operations queues" />
      <p className="border-b border-carup-line px-4 py-2.5 text-xs leading-5 text-carup-text-2" data-testid="ops-queue-intro">
        {tab === 'approvals' && 'High-risk releases and refunds wait here for a second reviewer. Your organisation only.'}
        {tab === 'confirmation' && 'Operations the payment provider has not yet confirmed against our ledger. These are not failures — do not retry them here.'}
        {tab === 'undeliverable' && 'Events that exhausted their delivery retries. Payloads are never shown.'}
      </p>
      {state === 'loading' && <p role="status" className="px-4 py-5 text-sm text-carup-text-2" data-testid="ops-queue-loading">Loading the queue…</p>}
      {state === 'failed' && failure && (
        <div className="space-y-2 p-3" data-testid={`ops-queue-failed-${tab}`} data-failure={failure.kind}>
          <ReadFailureState failure={failure} what={q.what} compact
            onRetry={failure.kind === 'failed' || failure.kind === 'limited' ? onRetry : undefined} />
          <p className="px-1 text-xs font-semibold leading-5 text-carup-text">{NOT_A_CLEAN_RESULT[tab]}</p>
        </div>
      )}
      {state === 'empty' && (
        <div className="px-4 py-6" data-testid={`ops-queue-empty-${tab}`}>
          <CheckCircle2 className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-carup-text">
            {tab === 'approvals' ? 'No approvals are waiting.' : tab === 'confirmation' ? 'Everything is reconciled.' : 'No undeliverable events.'}
          </p>
          <p className="mt-1 text-sm leading-6 text-carup-text-2">The read succeeded and returned none. Nothing was approved or retried automatically.</p>
        </div>
      )}
      {state === 'ready' && (
        <ul aria-label={q.what} className="divide-y divide-carup-line lg:max-h-[70vh] lg:overflow-y-auto">{children}</ul>
      )}
    </section>
  )
}

/* ───────────────────────── case column ───────────────────────── */

function CaseColumn({ model, tab, state, selectedId }: { model: OpsConsoleModel; tab: OpsQueueKey; state: OpsQueueState; selectedId: string | null }) {
  if (state === 'loading') return <ReviewNoCase title="Loading the queue…" />
  if (state === 'failed') {
    return <ReviewNoCase title="No case is open while this queue is unavailable." body={NOT_A_CLEAN_RESULT[tab]} />
  }
  if (state === 'empty') {
    return (
      <ReviewNoCase
        title={tab === 'approvals' ? 'There is no approval to decide.' : tab === 'confirmation' ? 'There is no operation awaiting confirmation.' : 'There is no undeliverable event.'}
        body="When one arrives it opens here, with its facts, its evidence and only the actions the server allows."
      />
    )
  }
  if (tab === 'approvals') {
    const a = model.approvals.find((x) => x.id === selectedId)
    return a ? <ApprovalCase key={a.id} a={a} model={model} /> : null
  }
  if (tab === 'confirmation') {
    const op = model.queue.find((x) => x.id === selectedId)
    return op ? <OperationCase key={op.id} op={op} /> : null
  }
  const dl = model.deadLetters.find((x) => x.id === selectedId)
  return dl ? <DeadLetterCase key={dl.id} dl={dl} model={model} /> : null
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs [overflow-wrap:anywhere]">{children}</span>
}

function ApprovalCase({ a, model }: { a: SafeTradeApproval; model: OpsConsoleModel }) {
  const [step, setStep] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const ids = useId()
  const blocked = approvalBlockedForViewer(a)
  const busy = model.busyId === a.id
  const amount = money(a.amount, a.currency)
  const facts: ReviewFact[] = [
    { label: 'Decision', value: humanize(a.decision_type) },
    { label: 'Risk', value: humanize(a.risk_level) },
    { label: 'Amount · sandbox', value: amount ?? 'Not recorded' },
    { label: 'Requested', value: when(a.requested_at) ?? 'Not recorded' },
    { label: 'Requested by', value: requesterLabel(a.requested_by, model.viewerId) },
    { label: 'Expires', value: when(a.expires_at) ?? 'No expiry recorded' },
    { label: 'Transaction', value: a.transaction_id ? <Mono>{a.transaction_id}</Mono> : 'Not recorded' },
    { label: 'Milestone', value: a.milestone_id ? <Mono>{a.milestone_id}</Mono> : 'Not linked' },
    { label: 'Approval', value: <Mono>{a.id}</Mono> },
  ]
  const audit: ReviewAuditEntry[] = [
    { id: 'requested', title: 'Approval requested', at: a.requested_at, actor: requesterLabel(a.requested_by, model.viewerId), detail: a.requested_reason ?? undefined },
  ]
  return (
    <div className="space-y-4" data-testid={`ops-case-${a.id}`}>
      <ReviewCaseHeader testId="ops-case-header" eyebrow="Approval awaiting a second approver"
        title={`${humanize(a.decision_type)} · ${amount ?? 'amount not recorded'}`} status={a.state} facts={facts}>
        <p className="mt-3"><Provenance kind="sandbox" testId="ops-case-sandbox" label="Sandbox amount · LIVE_PAYMENT off" /></p>
      </ReviewCaseHeader>
      <ReviewCaseBody
        evidence={(
          <>
            <ReviewSection title="Why it was requested" provenance="reviewer" provenanceLabel="Written by the requesting reviewer">
              <p className="text-sm leading-6 text-carup-text" data-testid="ops-approval-reason">{a.requested_reason ?? 'No reason was recorded with the request.'}</p>
            </ReviewSection>
            <ReviewSection title="Maker-checker" description="A high-risk release or refund needs two different people: the reviewer who requested it, and a second reviewer who approves it. The server refuses a requester's own approval." />
          </>
        )}
        decision={(
          <ReviewDecisionPanel title="Second approval" ariaLabel={`Decision for approval ${a.id}`}
            description="Approve or reject this request. Each needs your explicit confirmation."
            requirements={[
              { label: 'Decided by a reviewer other than the requester', met: !blocked },
              { label: 'Still pending (the server re-checks expiry and whether someone else already acted)', met: String(a.state).toLowerCase() === 'pending' },
            ]}
            footnote="No decision on this console is automatic. Approving records your approval as the second reviewer; it does not move real money."
            submit={blocked ? (
              <div className="space-y-2">
                <p id={`${ids}-blocked`} className="rounded-control bg-status-warning-soft p-3 text-sm leading-6 text-status-warning" data-testid={`ops-approval-self-blocked-${a.id}`}>
                  You requested this decision, so a different reviewer must approve it (maker-checker). Rejection is not offered to the requester here either.
                </p>
                <button type="button" className={REVIEW_PRIMARY} disabled aria-describedby={`${ids}-blocked`} data-testid={`ops-approve-start-${a.id}`}>Approve</button>
              </div>
            ) : step === 'idle' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className={REVIEW_PRIMARY} disabled={busy} onClick={() => setStep('approve')} data-testid={`ops-approve-start-${a.id}`}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve…
                </button>
                <button type="button" className={REVIEW_SECONDARY} disabled={busy} onClick={() => setStep('reject')} data-testid={`ops-reject-start-${a.id}`}>
                  <XCircle className="h-4 w-4" aria-hidden="true" /> Reject…
                </button>
              </div>
            ) : step === 'approve' ? (
              <div className={CONFIRM_BOX} data-testid={`ops-approve-confirm-box-${a.id}`}>
                <p className="text-sm font-semibold text-carup-text">Confirm your approval</p>
                <p className="text-sm leading-6 text-carup-text-2">
                  You are approving a sandbox {humanize(a.decision_type).toLowerCase()} of {amount ?? 'an unrecorded amount'} as the second reviewer.
                </p>
                <div>
                  <label htmlFor={`${ids}-notes`} className={REVIEW_LABEL}>Notes <span className="font-normal text-carup-text-3">(optional — recorded with your approval)</span></label>
                  <textarea id={`${ids}-notes`} className={`${REVIEW_FIELD} min-h-20`} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid={`ops-approve-notes-${a.id}`} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" className={REVIEW_PRIMARY} disabled={busy} data-testid={`ops-approve-confirm-${a.id}`}
                    onClick={() => { setStep('idle'); model.onApprove(a.id, notes) }}>{busy ? 'Recording…' : 'Confirm approval'}</button>
                  <button type="button" className={REVIEW_SECONDARY} onClick={() => setStep('idle')}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className={CONFIRM_BOX} data-testid={`ops-reject-confirm-box-${a.id}`}>
                <p className="text-sm font-semibold text-carup-text">Confirm the rejection</p>
                <p className="text-sm leading-6 text-carup-text-2">The request is closed as rejected; the release or refund does not proceed from it.</p>
                <div>
                  <label htmlFor={`${ids}-reason`} className={REVIEW_LABEL}>Reason <span className="font-normal text-carup-text-3">(optional — recorded with the rejection)</span></label>
                  <textarea id={`${ids}-reason`} className={`${REVIEW_FIELD} min-h-20`} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`ops-reject-reason-${a.id}`} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" className={DESK_DANGER} disabled={busy} data-testid={`ops-reject-confirm-${a.id}`}
                    onClick={() => { setStep('idle'); model.onReject(a.id, reason) }}>{busy ? 'Recording…' : 'Confirm rejection'}</button>
                  <button type="button" className={REVIEW_SECONDARY} onClick={() => setStep('idle')}>Cancel</button>
                </div>
              </div>
            )}
          />
        )}
        audit={<ReviewAuditTrail entries={audit} empty="Nothing recorded." note="Only what the approvals queue returned. A decided approval leaves this queue." />}
      />
    </div>
  )
}

function OperationCase({ op }: { op: SafeTradeOperation }) {
  const amount = money(op.amount, op.currency)
  const facts: ReviewFact[] = [
    { label: 'Operation', value: humanize(op.operation) },
    { label: 'State', value: humanize(op.state) },
    { label: 'Amount · sandbox', value: amount ?? 'Not recorded' },
    { label: 'Provider', value: humanize(op.provider, 'Not recorded') },
    { label: 'Provider reference', value: op.provider_ref ? <Mono>{op.provider_ref}</Mono> : 'Not recorded' },
    { label: 'Provider status', value: op.provider_status ? humanize(op.provider_status) : 'Not reported' },
    { label: 'Attempts', value: String(op.attempts ?? 0) },
    { label: 'Next attempt', value: when(op.next_attempt_at) ?? 'None scheduled' },
    { label: 'Last error code', value: op.last_error_code ? <Mono>{op.last_error_code}</Mono> : 'None recorded' },
    { label: 'Transaction', value: op.transaction_id ? <Mono>{op.transaction_id}</Mono> : 'Not recorded' },
    { label: 'Milestone', value: op.milestone_id ? <Mono>{op.milestone_id}</Mono> : 'Not linked' },
    { label: 'Operation id', value: <Mono>{op.id}</Mono> },
  ]
  const audit: ReviewAuditEntry[] = []
  if (op.requested_at) audit.push({ id: 'requested', title: 'Operation requested', at: op.requested_at })
  if (op.dispatched_at) audit.push({ id: 'dispatched', title: 'Sent to the provider', at: op.dispatched_at })
  if (op.confirmed_at) audit.push({ id: 'confirmed', title: 'Confirmed by the provider', at: op.confirmed_at })
  return (
    <div className="space-y-4" data-testid={`ops-case-${op.id}`}>
      <ReviewCaseHeader testId="ops-case-header" eyebrow="Money operation awaiting confirmation"
        title={`${humanize(op.operation)} · ${amount ?? 'amount not recorded'}`} status={op.state} facts={facts}>
        <p className="mt-3"><Provenance kind="sandbox" testId="ops-case-sandbox" label="Sandbox amount · LIVE_PAYMENT off" /></p>
      </ReviewCaseHeader>
      <ReviewCaseBody
        evidence={(
          <>
            <ReviewSection title="Where it stands" provenance="server" provenanceLabel="Reported by CarUp's server">
              {op.userState
                ? (
                  <>
                    <p className="text-sm leading-6 text-carup-text" data-testid="ops-operation-message">{op.userState.userMessage}</p>
                    <p className="text-xs font-semibold text-carup-text-2" data-testid="ops-operation-settled">{op.userState.settled ? 'The server reports this operation as settled.' : 'Not settled. There is no path from unresolved to success on this console.'}</p>
                  </>
                )
                : <p className="text-sm text-carup-text-2">The server did not describe this operation's state.</p>}
            </ReviewSection>
            {op.last_error && (
              <ReviewSection title="Last error" provenance="server" provenanceLabel="As returned">
                <p className="font-mono text-xs leading-5 text-carup-text [overflow-wrap:anywhere]">{op.last_error}</p>
              </ReviewSection>
            )}
          </>
        )}
        decision={(
          <section aria-label="Nothing to decide" className="space-y-2 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line-strong sm:p-5" data-testid="ops-operation-no-action">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">Decision</p>
            <h3 className="text-lg font-semibold text-carup-text">Nothing to decide here</h3>
            <p className="text-sm leading-6 text-carup-text-2">These are not failures — do not retry them here. Reconciliation confirms each operation against the provider; this console offers no action on an unconfirmed operation.</p>
          </section>
        )}
        audit={<ReviewAuditTrail entries={audit} empty="No timestamps were returned for this operation." note="Only the timestamps the reconciliation queue returned." />}
      />
    </div>
  )
}

function DeadLetterCase({ dl, model }: { dl: SafeTradeOutboxDeadLetter; model: OpsConsoleModel }) {
  const [confirming, setConfirming] = useState(false)
  const busy = model.busyId === dl.id
  const facts: ReviewFact[] = [
    { label: 'Event type', value: <Mono>{dl.event_type}</Mono> },
    { label: 'Status', value: humanize(dl.status) },
    { label: 'Attempts', value: String(dl.attempts ?? 0) },
    { label: 'Queued', value: when(dl.created_at) ?? 'Not recorded' },
    { label: 'Next attempt', value: when(dl.next_attempt_at) ?? 'None scheduled' },
    { label: 'Transaction', value: dl.transaction_id ? <Mono>{dl.transaction_id}</Mono> : 'Not recorded' },
    { label: 'Milestone', value: dl.milestone_id ? <Mono>{dl.milestone_id}</Mono> : 'Not linked' },
    { label: 'Event id', value: <Mono>{dl.id}</Mono> },
  ]
  const audit: ReviewAuditEntry[] = dl.created_at ? [{ id: 'queued', title: 'Event queued for delivery', at: dl.created_at }] : []
  return (
    <div className="space-y-4" data-testid={`ops-case-${dl.id}`}>
      <ReviewCaseHeader testId="ops-case-header" eyebrow="Undeliverable event" title={humanize(dl.event_type)} status={dl.status} facts={facts} />
      <ReviewCaseBody
        evidence={(
          <>
            <ReviewSection title="Last delivery error" provenance="server" provenanceLabel="As returned">
              <p className="font-mono text-xs leading-5 text-carup-text [overflow-wrap:anywhere]" data-testid="ops-dead-error">{dl.last_error ?? 'No error text was recorded.'}</p>
            </ReviewSection>
            <ReviewSection title="Payload" description={dl.payloadWithheldReason || 'Payloads are never returned to this console.'} />
          </>
        )}
        decision={model.isPlatformAdmin ? (
          <ReviewDecisionPanel title="Retry delivery" ariaLabel={`Retry delivery for event ${dl.id}`}
            description="Re-queue this event once the cause of the failure is fixed. The server refuses if it is no longer dead-lettered."
            footnote="Nothing is retried automatically from this console. The server re-checks that you are a platform administrator."
            submit={confirming ? (
              <div className={CONFIRM_BOX} data-testid={`ops-replay-confirm-box-${dl.id}`}>
                <p className="text-sm font-semibold text-carup-text">Re-queue this event for delivery?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" className={REVIEW_PRIMARY} disabled={busy} data-testid={`ops-replay-confirm-${dl.id}`}
                    onClick={() => { setConfirming(false); model.onReplay(dl.id) }}>{busy ? 'Re-queuing…' : 'Confirm retry'}</button>
                  <button type="button" className={REVIEW_SECONDARY} onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className={REVIEW_PRIMARY} disabled={busy} onClick={() => setConfirming(true)} data-testid={`ops-replay-start-${dl.id}`}>
                Retry delivery…
              </button>
            )}
          />
        ) : (
          <section aria-label="Retry delivery" className="space-y-2 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5" data-testid={`ops-replay-not-offered-${dl.id}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">Decision</p>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-carup-text"><AlertTriangle className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Retry delivery is not offered to you</h3>
            <p className={REVIEW_HINT}>Retrying an undeliverable event is for platform administrators only — the server re-checks. Ask one once the cause is fixed.</p>
          </section>
        )}
        audit={<ReviewAuditTrail entries={audit} empty="No timestamp was returned for this event." note="Only what the undeliverable-events read returned." />}
      />
    </div>
  )
}
