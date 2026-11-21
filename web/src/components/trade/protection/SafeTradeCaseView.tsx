/**
 * RX-06 Protection — the unified SafeTrade case (/diaspora/safetrade/:id): object header, next move,
 * then the evidence — overview & eligibility, the derived timeline, the sandbox milestone plan, disputes
 * and every server-returned action.
 *
 * Reads are the page container's own (DiasporaSafeTradeDetail: case, timeline, eligibility, milestones,
 * disputes, available actions, each best-effort section tracked as unreadable). The timeline is
 * deriveTimeline() over the authoritative state + audit events; action permission is the server's
 * available-actions projection only, with its disabled reasons. SafeTrade is non-custodial and a
 * sandbox simulation: totals are "declared", never "held", and the assurance notice is always shown.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Ban, Check, Circle, CircleDot, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { SAFETRADE_SANDBOX_LABEL } from '@/config/safeTradeFlag'
import {
  SAFETRADE_LIFECYCLE_PHASES, actionLabel, blockerCategory, deriveTimeline, designStateOf, formatMoney, milestoneStatusLabel,
  milestoneTotalsByCurrency, partySafeLabel, stateLabel, type SafeTradePhaseStatus,
} from '@/components/diaspora/safetrade/safeTradeHelpers'
import { buildLoginRedirect } from '@/lib/returnTo'
import type { SafeTradeEligibilityVerdict, SafeTradeMilestone, SafeTradeTimelineEvent, SafeTradeTransaction } from '@/types'
import { DeskHeader, DeskPanel, DeskState, Fact, NextMove, RefCode, SegmentedTabs, SourceChip, StickyMove, TabPanel } from '@/components/trade/sourcing/TradeDesk'
import { formatDateTime, formatDay, humanizeCode, plural, shortRef } from '@/components/trade/sourcing/deskKit'
import { AssuranceNote } from './AssuranceNote'
import { RunnerConfirm, RunnerOutcome, SafeTradeActionDeck } from './SafeTradeActionDeck'
import { SafeTradeDisputeDesk } from './SafeTradeDisputeDesk'
import {
  activeDisputeCount, caseFatalKind, caseNextMove, caseTone, operableActions, type SafeTradeCaseModel,
} from './safeTradeDesk'
import { useSafeTradeActionRunner } from './useSafeTradeActionRunner'

type CaseTab = 'overview' | 'timeline' | 'milestones' | 'disputes' | 'actions'

function Frame({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-safetrade-case" data-presentation="trade-desk">{children}</div>
}

const BACK = <Link to="/diaspora/safetrade" className={WS_SECONDARY}>All cases</Link>

export function SafeTradeCaseView({ model }: { model: SafeTradeCaseModel }) {
  const runner = useSafeTradeActionRunner(model.caseId, model.onReload)
  const [tab, setTab] = useState<CaseTab>('overview')

  if (!model.flagEnabled) {
    return (
      <Frame>
        <DeskHeader eyebrow="Trade · Protection" title="SafeTrade case" />
        <DeskState kind="unavailable" title="SafeTrade is not switched on in this environment" testId="trade-safetrade-case-unavailable">An administrator can enable it. Nothing was loaded.</DeskState>
      </Frame>
    )
  }
  if (model.authLoading || (model.loading && !model.hasLoaded)) {
    return <Frame><DeskState kind="loading" title="Loading this SafeTrade case…" testId="trade-safetrade-case-loading" /></Frame>
  }
  if (!model.signedIn) {
    return (
      <Frame>
        <DeskHeader eyebrow="Trade · Protection" title="SafeTrade case" />
        <DeskState kind="signin" title="Sign in to open this case" action={<Link to={buildLoginRedirect(`/diaspora/safetrade/${encodeURIComponent(model.caseId)}`)} className={WS_PRIMARY}>Sign in</Link>} testId="trade-safetrade-case-signin">
          A case is shown only to its buyer, its seller and CarUp reviewers.
        </DeskState>
      </Frame>
    )
  }
  if (model.fatal) return <Frame><CaseFatal model={model} /></Frame>
  if (!model.txn) return <Frame><DeskState kind="loading" title="Loading this SafeTrade case…" /></Frame>

  const txn = model.txn
  const state = designStateOf(txn)
  const actionsUnreadable = model.unreadable.has('actions')
  const move = caseNextMove(txn, model.actions, { actionsUnreadable, isReviewer: model.isReviewer })
  const permittedCount = operableActions(model.actions).filter((a) => a.permitted).length
  const disputeCount = model.disputes.length
  const runnerPanelsOnTop = tab !== 'actions'

  return (
    <Frame>
      <DeskHeader
        eyebrow="Trade · Protection · SafeTrade case"
        title={<>Case <span className="font-mono text-[0.72em] font-semibold text-carup-text-2" title={txn.id}>{shortRef(txn.id)}</span></>}
        meta={(
          <>
            <StatusChip tone={caseTone(txn)} testId="trade-safetrade-case-state">{stateLabel(state)}</StatusChip>
            <StatusChip tone="warning" testId="trade-safetrade-case-sandbox">{txn.live_payment ? 'Live payment flag recorded' : 'Sandbox simulation · live payment off'}</StatusChip>
          </>
        )}
        actions={(
          <>
            {BACK}
            <button type="button" className={WS_SECONDARY} onClick={() => void model.onReload()} aria-busy={model.loading} data-testid="trade-safetrade-case-refresh">
              {model.loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {model.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        )}
      />

      <AssuranceNote />

      <NextMove
        testId="trade-safetrade-case-next"
        title={move.title}
        usuallyWith={move.usuallyWith}
        after={move.after}
        action={move.primary ? (
          <button type="button" className={WS_PRIMARY} disabled={runner.pending !== null} onClick={() => runner.start(move.primary!)} data-testid="trade-safetrade-case-next-action">
            {runner.pending === move.primary.actionKey && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {actionLabel(move.primary)}
          </button>
        ) : (
          <button type="button" className={WS_SECONDARY} onClick={() => setTab('actions')}>See every action and why</button>
        )}
      />
      {runnerPanelsOnTop && (
        <div className="space-y-3">
          <RunnerOutcome runner={runner} testId="trade-safetrade-case-runner" />
          <RunnerConfirm runner={runner} testId="trade-safetrade-case-runner" />
        </div>
      )}

      <div className="space-y-3">
        <SegmentedTabs<CaseTab>
          idBase="trade-safetrade-case"
          label="Case sections"
          value={tab}
          onChange={setTab}
          testId="trade-safetrade-case-tabs"
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'timeline', label: 'Timeline' },
            { key: 'milestones', label: 'Milestones', count: model.unreadable.has('milestones') ? null : model.milestones.length },
            { key: 'disputes', label: 'Disputes', count: model.unreadable.has('disputes') ? null : disputeCount },
            { key: 'actions', label: 'Actions', count: actionsUnreadable ? null : permittedCount },
          ]}
        />
        <TabPanel idBase="trade-safetrade-case" tabKey={tab}>
          {tab === 'overview' && <Overview txn={txn} viewerId={model.viewerId} eligibility={model.eligibility} eligibilityUnreadable={model.unreadable.has('eligibility')} activeDisputes={activeDisputeCount(model.disputes)} />}
          {tab === 'timeline' && <TimelineRail txn={txn} events={model.timeline} unreadable={model.unreadable.has('timeline')} />}
          {tab === 'milestones' && <MilestoneLedger milestones={model.milestones} currency={txn.currency} unreadable={model.unreadable.has('milestones')} />}
          {tab === 'disputes' && (
            <SafeTradeDisputeDesk
              transactionId={txn.id}
              disputes={model.disputes}
              actions={model.actions}
              viewerId={model.viewerId}
              isReviewer={model.isReviewer}
              unreadable={model.unreadable.has('disputes')}
              onDone={model.onReload}
            />
          )}
          {tab === 'actions' && <SafeTradeActionDeck actions={model.actions} runner={runner} unreadable={actionsUnreadable} />}
        </TabPanel>
      </div>

      <StickyMove active={Boolean(move.primary) && !runner.confirm} label="Next move on this case" testId="trade-safetrade-case-sticky">
        <p className="w-16 shrink-0 text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-carup-text-3">Next move</p>
        {move.primary && (
          <button type="button" className={cn(WS_PRIMARY, 'min-w-0 flex-1')} disabled={runner.pending !== null} onClick={() => runner.start(move.primary!)} data-testid="trade-safetrade-case-sticky-action">
            {runner.pending === move.primary.actionKey ? <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="truncate">{actionLabel(move.primary)}</span>
          </button>
        )}
      </StickyMove>
    </Frame>
  )
}

function CaseFatal({ model }: { model: SafeTradeCaseModel }) {
  const kind = caseFatalKind(model.fatal?.kind ?? 'error', model.fatalFailure)
  const header = <DeskHeader eyebrow="Trade · Protection" title="SafeTrade case" />
  if (kind === 'session') return <>{header}<DeskState kind="signin" title="Your session has expired" action={<><Link to="/login" className={WS_PRIMARY} data-testid="trade-safetrade-case-signin-link">Sign in</Link>{BACK}</>} testId="trade-safetrade-case-fatal">Sign in again to view this case. Nothing on it has changed.</DeskState></>
  if (kind === 'unavailable') return <>{header}<DeskState kind="unavailable" title="SafeTrade is not switched on for this server" action={BACK} testId="trade-safetrade-case-fatal">The server answered that SafeTrade is not enabled (404).</DeskState></>
  if (kind === 'notfound') return <>{header}<DeskState kind="empty" title="This SafeTrade case was not found" action={BACK} testId="trade-safetrade-case-fatal">Check the link. A case you are not part of may also not be visible to you.</DeskState></>
  if (kind === 'forbidden') return <>{header}<DeskState kind="denied" title="You do not have access to this SafeTrade case" action={BACK} testId="trade-safetrade-case-fatal">Only the case’s buyer, its seller and CarUp reviewers can open it. The server refused this account (403).</DeskState></>
  if (kind === 'tenant') return <>{header}<DeskState kind="tenant" title="A tenant context is required to view this case" action={BACK} testId="trade-safetrade-case-fatal">Your account carries no trading tenant, and the server scopes cases by tenant.</DeskState></>
  if (kind === 'limited') return <>{header}<DeskState kind="limited" title="Too many requests right now" onRetry={() => void model.onReload()} retryLabel="Retry now" action={BACK} testId="trade-safetrade-case-fatal">The shared request limit was reached. Nothing is retried automatically — wait about a minute, then retry.</DeskState></>
  return <>{header}<DeskState kind="failed" title="This SafeTrade case could not be loaded" onRetry={() => void model.onReload()} action={BACK} testId="trade-safetrade-case-fatal">Nothing on the case has changed. Please retry.</DeskState></>
}

function Overview({ txn, viewerId, eligibility, eligibilityUnreadable, activeDisputes }: {
  txn: SafeTradeTransaction
  viewerId: string | null
  eligibility: SafeTradeEligibilityVerdict | null
  eligibilityUnreadable: boolean
  activeDisputes: number
}) {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:items-start">
      <DeskPanel title="The trade" testId="trade-safetrade-case-facts">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label="Declared total" value={formatMoney(txn.total_amount, txn.currency)} source={<SourceChip>Declared on the case · not held by CarUp</SourceChip>} testId="trade-safetrade-case-total" />
          <Fact label="Linked import order" value={<span className="flex flex-wrap items-center gap-x-2"><RefCode value={txn.import_order_id} label="Import order" className="text-carup-text" /><Link to={`/diaspora/imports/${encodeURIComponent(txn.import_order_id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-carup-action underline-offset-4 hover:underline">Open order</Link></span>} />
          <Fact label="Buyer" value={partySafeLabel(txn, txn.buyer_id ?? txn.created_by ?? null, viewerId)} testId="trade-safetrade-case-buyer" />
          <Fact label="Seller" value={partySafeLabel(txn, txn.seller_id ?? null, viewerId)} testId="trade-safetrade-case-seller" />
          <Fact label="Payment mode" value={txn.live_payment ? 'Live payment flag recorded' : 'Sandbox simulation'} source={<SourceChip>{txn.payment_provider ? `Provider: ${humanizeCode(txn.payment_provider)}` : 'Provider not recorded'}</SourceChip>} />
          <Fact label="Policy version" value={txn.policy_version || null} mono />
          <Fact label="Opened" value={formatDay(txn.created_at ?? null)} />
          <Fact label="Last updated" value={formatDateTime(txn.updated_at ?? txn.created_at ?? null)} />
        </dl>
        {activeDisputes > 0 && <p className="mt-4 rounded-control bg-status-warning-soft px-3 py-2 text-sm text-carup-text">{plural(activeDisputes, 'dispute is', 'disputes are')} open on this case. The server blocks the steps they affect until a reviewer resolves them.</p>}
      </DeskPanel>
      <EligibilityBlock verdict={eligibility} unreadable={eligibilityUnreadable} />
    </div>
  )
}

function EligibilityBlock({ verdict, unreadable }: { verdict: SafeTradeEligibilityVerdict | null; unreadable: boolean }) {
  if (unreadable) {
    return (
      <DeskPanel title="Eligibility" testId="trade-safetrade-case-eligibility">
        <DeskState compact kind="failed" title="Eligibility could not be loaded" testId="trade-safetrade-case-eligibility-unreadable">This is not a report that the case is eligible — or that it is not.</DeskState>
      </DeskPanel>
    )
  }
  if (!verdict) {
    return <DeskPanel title="Eligibility" testId="trade-safetrade-case-eligibility"><p className="text-sm text-carup-text-3">No eligibility verdict was returned.</p></DeskPanel>
  }
  const blockers = verdict.blockers || []
  return (
    <DeskPanel
      title="Eligibility"
      testId="trade-safetrade-case-eligibility"
      actions={verdict.eligible
        ? <StatusChip tone="success" testId="trade-safetrade-case-eligibility-status">All checks pass</StatusChip>
        : <StatusChip tone="warning" testId="trade-safetrade-case-eligibility-status">{plural(blockers.length, 'blocker')}</StatusChip>}
    >
      {verdict.eligible ? (
        <p className="text-sm text-carup-text-2">Every eligibility check passes for this case.</p>
      ) : (
        <ul className="space-y-2" data-testid="trade-safetrade-case-blockers">
          {blockers.map((b, i) => (
            <li key={`${b.code}-${i}`} className="rounded-control border border-carup-line bg-carup-bg-surface p-3" data-code={b.code}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{blockerCategory(b.code)}</p>
              <p className="mt-1 text-sm text-carup-text">{b.message}</p>
              {b.remediation && <p className="mt-1 text-xs text-carup-text-2"><span className="font-semibold text-carup-text">What to do: </span>{b.remediation}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-carup-text-3">Policy {verdict.policyVersion} · evaluated {formatDateTime(verdict.evaluatedAt) ?? 'at a time not recorded'}</p>
    </DeskPanel>
  )
}

const PHASE_TEXT: Record<SafeTradePhaseStatus, string> = { completed: 'Completed', current: 'Current', blocked: 'Blocked', unavailable: 'Not yet reached' }
const HAPPY = SAFETRADE_LIFECYCLE_PHASES.slice(0, 11)

function PhaseIcon({ status }: { status: SafeTradePhaseStatus }) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5" aria-hidden="true" />
  if (status === 'current') return <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
  if (status === 'blocked') return <Ban className="h-3.5 w-3.5" aria-hidden="true" />
  return <Circle className="h-3 w-3" aria-hidden="true" />
}

function TimelineRail({ txn, events, unreadable }: { txn: SafeTradeTransaction; events: SafeTradeTimelineEvent[]; unreadable: boolean }) {
  const phases = deriveTimeline(designStateOf(txn), events)
  const happy = phases.filter((p) => HAPPY.includes(p.state))
  const exceptions = phases.filter((p) => !HAPPY.includes(p.state))
  const row = (p: (typeof phases)[number], last: boolean) => (
    <li key={p.state} className="relative flex gap-3" data-testid="trade-safetrade-phase" data-state={p.state} data-status={p.status} aria-current={p.status === 'current' ? 'step' : undefined}>
      <div className="flex flex-col items-center" aria-hidden="true">
        <span
          className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2',
            p.status === 'completed' ? 'border-carup-text bg-carup-text text-carup-bg-raised'
              : p.status === 'current' ? 'border-transparent text-carup-raw-ink'
                : p.status === 'blocked' ? 'border-status-danger bg-status-danger-soft text-status-danger'
                  : 'border-carup-line-strong text-carup-text-3')}
          style={p.status === 'current' ? { background: 'var(--carup-raw-orange-signal)' } : undefined}
        >
          <PhaseIcon status={p.status} />
        </span>
        {!last && <span className={cn('w-0.5 flex-1', p.status === 'completed' ? 'bg-carup-text' : 'bg-carup-line')} />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-sm', p.status === 'unavailable' ? 'text-carup-text-2' : 'font-semibold text-carup-text')}>{p.label}</span>
          <span className="text-xs text-carup-text-3" data-testid="trade-safetrade-phase-status">{PHASE_TEXT[p.status]}</span>
        </p>
        {p.timestamp && (
          <p className="mt-0.5 text-xs text-carup-text-3" data-testid="trade-safetrade-phase-time">
            Recorded {formatDateTime(p.timestamp) ?? p.timestamp}{p.source ? ` · source: ${p.source}` : ''}
          </p>
        )}
      </div>
    </li>
  )
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start" data-testid="trade-safetrade-timeline">
      <DeskPanel title="Lifecycle" eyebrow="Derived from the recorded state and events">
        {unreadable && <p className="mb-3 rounded-control bg-status-warning-soft px-3 py-2 text-xs text-carup-text" data-testid="trade-safetrade-timeline-unreadable">The event history could not be loaded, so recorded times are missing below. The current state is still the server’s.</p>}
        <ol aria-label="SafeTrade lifecycle">{happy.map((p, i) => row(p, i === happy.length - 1))}</ol>
      </DeskPanel>
      <DeskPanel title="Exceptions" eyebrow="Disputes, suspensions, cancellations and refunds">
        <ol aria-label="SafeTrade exception states">{exceptions.map((p, i) => row(p, i === exceptions.length - 1))}</ol>
        <p className="mt-3 text-xs leading-5 text-carup-text-3">A stage reads completed only when the server recorded it or the case is already past it. Shipment, compliance, delivery and release appear only when the corresponding CarUp workflow verifies them.</p>
      </DeskPanel>
    </div>
  )
}

function MilestoneLedger({ milestones, currency, unreadable }: { milestones: SafeTradeMilestone[]; currency: string; unreadable: boolean }) {
  if (unreadable) {
    return <DeskState kind="failed" title="The milestone plan could not be loaded" testId="trade-safetrade-milestones-unreadable">This case may well have milestones. No plan total is shown, because a total of zero would claim an empty plan.</DeskState>
  }
  const { totals, unpriced } = milestoneTotalsByCurrency(milestones, currency)
  return (
    <DeskPanel
      title="Milestone plan"
      testId="trade-safetrade-milestones"
      actions={<span className="text-xs font-semibold text-carup-text-2" data-testid="trade-safetrade-milestones-total">{totals.length === 0 ? 'Plan total not recorded' : `Plan total ${totals.map((t) => formatMoney(t.amount, t.currency)).join(' + ')}`}</span>}
    >
      <p className="mb-3 rounded-control bg-status-warning-soft px-3 py-2 text-xs leading-5 text-carup-text" data-testid="trade-safetrade-milestones-sandbox">{SAFETRADE_SANDBOX_LABEL}</p>
      {milestones.length === 0 ? (
        <DeskState compact kind="empty" title="No milestones have been defined for this case yet" testId="trade-safetrade-milestones-empty">A milestone plan splits the declared total into steps, each released only when its trigger is recorded — as a simulation.</DeskState>
      ) : (
        <ol className="divide-y divide-carup-line">
          {[...milestones].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" data-testid="trade-safetrade-milestone-row" data-milestone-status={m.status}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-carup-text"><span className="mr-1.5 font-mono text-xs text-carup-text-3">#{m.sequence}</span>{humanizeCode(m.milestone_type)}</p>
                {Array.isArray(m.evidence_requirements) && m.evidence_requirements.length > 0 && <p className="mt-0.5 text-xs text-carup-text-2">Evidence: {m.evidence_requirements.map((e) => humanizeCode(e)).join(', ')}</p>}
                {m.release_trigger && <p className="mt-0.5 text-xs text-carup-text-3">Released on: {humanizeCode(m.release_trigger)}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums text-carup-text">{formatMoney(m.amount, m.currency || currency)}</p>
                <StatusChip tone="warning" className="mt-1">{milestoneStatusLabel(m.status)}</StatusChip>
              </div>
            </li>
          ))}
        </ol>
      )}
      {unpriced > 0 && <p className="mt-3 text-xs text-carup-text-3" data-testid="trade-safetrade-milestones-unpriced">{plural(unpriced, 'milestone')} with no recorded amount {unpriced === 1 ? 'is' : 'are'} excluded from the total.</p>}
    </DeskPanel>
  )
}
