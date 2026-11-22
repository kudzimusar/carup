/**
 * RX-06 Account — the unified plan & entitlements desk (/diaspora/subscription).
 *
 * Presentation only. Plans, the tenant's status, effective entitlements and metered usage are the page
 * container's own reads (DiasporaSubscription); the sandbox billing actions are its own handlers.
 * Truth rules: plans and entitlements exactly as returned (no price exists in the catalogue, so none is
 * shown); billing is a sandbox and every control says so; a rate limit is never "not permitted"; a
 * missing tenant is its own state; a failed usage read is never "no usage".
 */
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, ExternalLink, Loader2, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_DANGER, WS_FIELD, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { SANDBOX_BILLING_NOTICE } from '@/config/subscriptionFlag'
import {
  canManageSubscriptionUi, classifyEntitlement, currentPlan, formatPeriodDate, humanizeFeatureKey, orderedPlans,
  statusLabel as subscriptionStatusLabel, toUsageView,
} from '@/components/diaspora/subscription/subscriptionHelpers'
import { buildLoginRedirect } from '@/lib/returnTo'
import type { Plan, StructuredEntitlementDenial } from '@/types'
import { DeskHeader, DeskPanel, DeskState, Fact, InlineConfirm, SegmentedTabs, SourceChip, TabPanel } from '@/components/trade/sourcing/TradeDesk'
import { BillingOperationsDesk } from './BillingOperationsDesk'
import { DENIAL_TITLE, featureParts, groupFeatureKeys, planFailure, type SubscriptionDeskModel } from './subscriptionDesk'

function Frame({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-plan" data-presentation="trade-desk">{children}</div>
}

function SandboxStrip() {
  return (
    <p className="flex items-start gap-2 rounded-control border border-status-warning bg-status-warning-soft px-3 py-2.5 text-sm leading-6 text-carup-text" data-testid="trade-plan-sandbox">
      <CreditCard className="mt-1 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
      <span><strong className="font-semibold">Sandbox billing.</strong> {SANDBOX_BILLING_NOTICE}</span>
    </p>
  )
}

export function SubscriptionDeskView({ model }: { model: SubscriptionDeskModel }) {
  const header = (
    <DeskHeader
      eyebrow="Trade · Account"
      title="Plan & entitlements"
      description="Your tenant’s plan, what it includes as the server resolves it, and what you have used this period. No plan in this catalogue carries a price, and no real payment can be taken here."
      meta={<StatusChip tone="warning" testId="trade-plan-sandbox-chip">Sandbox billing · live payments off</StatusChip>}
    />
  )

  if (!model.flagEnabled) {
    return (
      <Frame>
        {header}
        <DeskState kind="unavailable" title="Plan & entitlements is not switched on in this environment" testId="trade-plan-unavailable">
          An administrator can enable it. Nothing was loaded and no billing provider was contacted.
        </DeskState>
      </Frame>
    )
  }
  if (model.authLoading) return <Frame>{header}<DeskState kind="loading" title="Checking your access…" testId="trade-plan-auth-loading" /></Frame>
  if (!model.signedIn) {
    return (
      <Frame>
        {header}
        <DeskState kind="signin" title="Sign in to see your plan" action={<Link to={buildLoginRedirect('/diaspora/subscription')} className={WS_PRIMARY}>Sign in</Link>} testId="trade-plan-signin">
          Plans, entitlements and usage belong to a signed-in trader’s tenant.
        </DeskState>
      </Frame>
    )
  }

  const failure = planFailure(model.loadError, model.loadFailure)
  const loading = model.loading || !model.answered
  const plan = currentPlan(model.plans, model.status)
  const featureMap = model.entitlements?.entitlements ?? {}
  const featureKeys = Object.keys(featureMap)

  return (
    <Frame>
      {header}
      <SandboxStrip />

      {loading && <DeskState kind="loading" title="Loading your plan…" testId="trade-plan-loading" />}

      {!loading && failure && <PlanFailureState model={model} kind={failure} />}

      {!loading && !failure && (
        <>
          <section aria-labelledby="trade-plan-current-h" className="rounded-card border border-carup-line-strong bg-carup-bg-raised p-4 sm:p-5" data-testid="trade-plan-current">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Current plan</p>
                <h2 id="trade-plan-current-h" className="mt-1 text-2xl font-bold tracking-[-0.02em] text-carup-text" data-testid="trade-plan-current-name">{plan?.name || model.status?.planKey || 'Not recorded'}</h2>
                {plan?.description && <p className="mt-1 max-w-xl text-sm leading-6 text-carup-text-2">{plan.description}</p>}
              </div>
              {model.status && (
                <StatusChip tone={model.status.active ? 'info' : 'neutral'} testId="trade-plan-current-status">
                  {subscriptionStatusLabel(model.status)}{model.status.active ? ' · active' : ' · not active'}
                </StatusChip>
              )}
            </div>
            {model.status ? (
              <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-carup-line pt-3 sm:grid-cols-4">
                <Fact label="Plan key" value={model.status.planKey} mono />
                <Fact label="Period start" value={model.status.currentPeriodStart ? formatPeriodDate(model.status.currentPeriodStart) : null} />
                <Fact label="Period end" value={model.status.currentPeriodEnd ? formatPeriodDate(model.status.currentPeriodEnd) : null} />
                <Fact label="Billing mode" value="Sandbox" source={<SourceChip>No live provider</SourceChip>} />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-carup-text-3">No subscription status is recorded yet.</p>
            )}
            {model.status?.synthetic && <p className="mt-3 rounded-control bg-carup-bg-surface px-3 py-2 text-xs leading-5 text-carup-text-2" data-testid="trade-plan-synthetic">You are on the Free plan. No paid subscription is active for this tenant.</p>}
            {model.status?.cancelAtPeriodEnd && (
              <p className="mt-3 rounded-control bg-status-warning-soft px-3 py-2 text-xs leading-5 text-carup-text" data-testid="trade-plan-cancel-at-end">
                Scheduled to cancel at the end of the current period{model.status.currentPeriodEnd ? ` (${formatPeriodDate(model.status.currentPeriodEnd)})` : ''}. Access continues until then.
              </p>
            )}
          </section>

          <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:items-start">
            <DeskPanel title="What your plan includes" eyebrow="Resolved by the server" testId="trade-plan-entitlements">
              {model.entitlements && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-carup-text-2" data-testid="trade-plan-entitlements-plan">
                  <span className="font-semibold text-carup-text">{model.entitlements.planName || model.entitlements.planKey}</span>
                  {model.entitlements.tier && <span>· {model.entitlements.tier}</span>}
                  {model.entitlements.status && <span>· {model.entitlements.status}</span>}
                  {model.entitlements.source === 'config' && <SourceChip testId="trade-plan-entitlements-source">Resolved from the catalogue fallback</SourceChip>}
                </p>
              )}
              {model.entitlementsUnreadable && featureKeys.length > 0 && (
                <p className="mb-3 text-xs text-carup-text-2" data-testid="trade-plan-entitlements-stale">The latest entitlements read failed; these are from the last successful read.</p>
              )}
              {featureKeys.length === 0 && model.entitlementsUnreadable ? (
                <DeskState compact kind="failed" title="Entitlements could not be loaded" onRetry={model.onRetry} testId="trade-plan-entitlements-failed">
                  The entitlement read failed. This page shows nothing rather than a guess.
                </DeskState>
              ) : featureKeys.length === 0 ? (
                <DeskState compact kind="empty" title="Entitlement details are not available right now" testId="trade-plan-entitlements-empty">
                  The server returned no entitlement map for your tenant. This page will not guess one.
                </DeskState>
              ) : (
                <div className="space-y-4">
                  {groupFeatureKeys(featureKeys).map((group) => (
                    <div key={group.area}>
                      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-carup-text-3">{group.label}</h3>
                      <ul className="mt-1 divide-y divide-carup-line">
                        {group.keys.map((key) => {
                          const cell = classifyEntitlement(key, featureMap[key])
                          return (
                            <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="trade-plan-entitlement-row" data-kind={cell.kind}>
                              <span className="min-w-0 text-carup-text-2 [overflow-wrap:anywhere]">{featureParts(key).capability}</span>
                              <span className={cell.kind === 'unavailable' ? 'text-carup-text-3' : 'font-semibold text-carup-text'}>{cell.label}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs leading-5 text-carup-text-3">Whether a limit is enforced is decided by the server when you act.</p>
            </DeskPanel>

            <UsagePanel model={model} />
          </div>

          {model.isManager ? <ManageBilling model={model} /> : (
            <DeskState compact kind="denied" title="Billing changes are made by tenant administrators" testId="trade-plan-readonly">
              Your account ({model.role || 'no role'}) can review the plan, entitlements and usage here. The server checks every billing request again.
            </DeskState>
          )}
          {model.isManager && <BillingOperationsDesk />}
        </>
      )}

      {!loading && (!failure || failure === 'tenant' || failure === 'plan') && model.plans.length > 0 && (
        <PlanCatalogue plans={model.plans} currentPlanKey={failure ? null : model.status?.planKey ?? null} />
      )}
      {!loading && !failure && model.plans.length === 0 && (
        <DeskState kind="empty" title="No plans are offered right now" testId="trade-plan-catalogue-empty">The server returned an empty plan catalogue.</DeskState>
      )}
    </Frame>
  )
}

function DenialFacts({ denial }: { denial: StructuredEntitlementDenial }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {denial.requestedOperation && <div className="flex gap-1"><dt className="font-semibold text-carup-text">Requested:</dt><dd>{denial.requestedOperation}</dd></div>}
      {denial.requiredFeature && <div className="flex gap-1"><dt className="font-semibold text-carup-text">Requires:</dt><dd>{humanizeFeatureKey(denial.requiredFeature)}</dd></div>}
      {denial.currentPlan && <div className="flex gap-1"><dt className="font-semibold text-carup-text">Current plan:</dt><dd>{denial.currentPlan}</dd></div>}
      {denial.requiredPlan && <div className="flex gap-1"><dt className="font-semibold text-carup-text">Upgrade to:</dt><dd>{denial.requiredPlan}</dd></div>}
      {denial.remaining !== null && denial.remaining !== undefined && <div className="flex gap-1"><dt className="font-semibold text-carup-text">Remaining:</dt><dd>{denial.remaining}</dd></div>}
    </dl>
  )
}

function PlanFailureState({ model, kind }: { model: SubscriptionDeskModel; kind: NonNullable<ReturnType<typeof planFailure>> }) {
  if (kind === 'limited') {
    return (
      <DeskState kind="limited" title="Too many requests right now" onRetry={model.onRetry} retryLabel="Retry now" testId="trade-plan-failed">
        The shared request limit was reached, so your plan could not be read. This is not a permission problem. Nothing is retried automatically — wait about a minute, then retry.
      </DeskState>
    )
  }
  if (kind === 'tenant') {
    return (
      <DeskState kind="tenant" title="Your account is not linked to a trading tenant" testId="trade-plan-tenant">
        A plan, its entitlements and usage belong to a tenant, and the server found none for this account. The plans CarUp offers are listed below as the catalogue returns them; none is marked as yours.
      </DeskState>
    )
  }
  if (kind === 'unavailable') {
    return <DeskState kind="unavailable" title="Plan & entitlements is not available on this server" testId="trade-plan-failed">The server answered “not found” (404). This is not a report that you have no plan.</DeskState>
  }
  if (kind === 'denied') {
    return <DeskState kind="denied" title="The server refused to show this tenant’s plan to your account" testId="trade-plan-failed">This is a permission answer (403), not an outage.</DeskState>
  }
  if (kind === 'plan' && model.loadError) {
    return (
      <DeskState kind="denied" title={DENIAL_TITLE[model.loadError.category]} testId="trade-plan-denial">
        {model.loadError.message}
        <DenialFacts denial={model.loadError} />
      </DeskState>
    )
  }
  return (
    <DeskState kind="failed" title="Your plan could not be loaded" onRetry={model.onRetry} testId="trade-plan-failed">
      {model.loadError?.message ?? 'The service could not be reached.'} This is not a report that you have no plan.
    </DeskState>
  )
}

function UsagePanel({ model }: { model: SubscriptionDeskModel }) {
  if (model.usageUnreadable) {
    return (
      <DeskPanel title="Usage this period" testId="trade-plan-usage">
        <DeskState compact kind="failed" title="Your metered usage could not be loaded" onRetry={model.onRetry} testId="trade-plan-usage-unreadable">
          This is not a report of zero usage.
        </DeskState>
      </DeskPanel>
    )
  }
  const entries = Array.isArray(model.usage?.usage) ? model.usage!.usage : []
  return (
    <DeskPanel
      title="Usage this period"
      testId="trade-plan-usage"
      actions={model.usage?.periodStart ? <span className="text-xs text-carup-text-3" data-testid="trade-plan-usage-period">Since {formatPeriodDate(model.usage.periodStart)}</span> : undefined}
    >
      {entries.length === 0 ? (
        <DeskState compact kind="empty" title="No metered usage this period" testId="trade-plan-usage-empty">Metered features (such as bulk imports) are counted here as you use them.</DeskState>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const v = toUsageView(entry)
            return (
              <li key={v.featureKey} className="rounded-control border border-carup-line p-3" data-testid="trade-plan-usage-row" data-available={v.available ? 'true' : 'false'} data-unlimited={v.unlimited ? 'true' : 'false'}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-carup-text">{featureParts(v.featureKey).areaLabel} · {featureParts(v.featureKey).capability}</p>
                  {v.reserved > 0 && <span className="text-xs text-carup-text-3">{v.reserved} reserved</span>}
                </div>
                <p className="mt-1 text-xs text-carup-text-2">{v.statusText}</p>
                {v.available && !v.unlimited && (
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-carup-bg-surface-2"
                    role="progressbar"
                    aria-valuenow={v.percentUsed ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${v.featureName}: ${v.used} of ${v.limit} used`}
                  >
                    <div className="h-full rounded-full bg-carup-action" style={{ width: `${v.percentUsed ?? 0}%` }} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </DeskPanel>
  )
}

type ConfirmKind = null | 'change-plan' | 'cancel'

function ManageBilling({ model }: { model: SubscriptionDeskModel }) {
  const plans = orderedPlans(model.plans)
  const firstTarget = plans.find((p) => p.planKey !== model.status?.planKey)?.planKey || plans[0]?.planKey || ''
  const [selected, setSelected] = useState('')
  const [pending, setPending] = useState<null | 'checkout' | 'portal' | 'change-plan' | 'cancel'>(null)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const id = useId()
  const target = selected || firstTarget
  const targetName = plans.find((p) => p.planKey === target)?.name || target
  const busy = pending !== null

  async function run(kind: NonNullable<typeof pending>, fn: () => void | Promise<void>) {
    if (busy) return
    setPending(kind)
    try { await fn() } finally { setPending(null); setConfirm(null) }
  }

  if (!canManageSubscriptionUi(model.role)) return null

  return (
    <DeskPanel eyebrow="Tenant administrator · sandbox" title="Manage billing" testId="trade-plan-manage">
      <p className="mb-4 text-sm leading-6 text-carup-text-2">{SANDBOX_BILLING_NOTICE}</p>
      {model.actionDenial && (
        <div className="mb-4">
          <DeskState compact kind={model.actionDenial.category === 'network-or-server-failure' ? 'failed' : 'denied'} title={DENIAL_TITLE[model.actionDenial.category]} onRetry={model.actionDenial.retryable ? model.onRetry : undefined} testId="trade-plan-action-denial">
            {model.actionDenial.message}
            <DenialFacts denial={model.actionDenial} />
          </DeskState>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite" data-testid="trade-plan-outcome-live">{model.outcome || ''}</p>
      {model.outcome && <p className="mb-4 rounded-control border border-status-info bg-status-info-soft px-3 py-2.5 text-sm text-carup-text" data-testid="trade-plan-outcome">{model.outcome}</p>}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-end">
        <div className="min-w-0">
          <label htmlFor={`${id}-plan`} className={WS_LABEL}>Target plan</label>
          <select id={`${id}-plan`} className={WS_FIELD} value={target} onChange={(e) => setSelected(e.target.value)} disabled={busy} data-testid="trade-plan-target">
            {plans.map((p) => <option key={p.planKey} value={p.planKey}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          <button type="button" className={WS_PRIMARY} disabled={busy || !target} onClick={() => void run('checkout', () => model.onCheckout(target))} data-testid="trade-plan-checkout">
            {pending === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
            Start sandbox checkout
          </button>
          <button type="button" className={WS_SECONDARY} disabled={busy || !target} onClick={() => setConfirm('change-plan')} data-testid="trade-plan-change">Change plan…</button>
          <button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => void run('portal', model.onPortal)} data-testid="trade-plan-portal">
            {pending === 'portal' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
            Open sandbox billing portal
          </button>
          <button type="button" className={WS_DANGER} disabled={busy || !model.status || model.status.cancelAtPeriodEnd} onClick={() => setConfirm('cancel')} data-testid="trade-plan-cancel">Cancel at period end…</button>
        </div>
      </div>
      {confirm === 'change-plan' && (
        <div className="mt-4">
          <InlineConfirm
            title={`Request a change to ${targetName}?`}
            testId="trade-plan-change-confirm"
            confirm={<button type="button" className={WS_PRIMARY} disabled={busy} onClick={() => void run('change-plan', () => model.onChangePlan(target))} data-testid="trade-plan-change-confirm-yes">{pending === 'change-plan' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Request change</button>}
            cancel={<button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => setConfirm(null)}>Keep current plan</button>}
          >
            The change goes through the sandbox billing provider. No real payment is collected.
          </InlineConfirm>
        </div>
      )}
      {confirm === 'cancel' && (
        <div className="mt-4">
          <InlineConfirm
            tone="danger"
            title="Cancel the subscription at the end of this period?"
            testId="trade-plan-cancel-confirm"
            confirm={<button type="button" className={WS_DANGER} disabled={busy} onClick={() => void run('cancel', () => model.onCancel(true))} data-testid="trade-plan-cancel-confirm-yes">{pending === 'cancel' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Schedule cancellation</button>}
            cancel={<button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => setConfirm(null)}>Keep subscription</button>}
          >
            It is not cancelled immediately: access continues until the period ends. Sandbox only — no real payment or refund moves.
          </InlineConfirm>
        </div>
      )}
    </DeskPanel>
  )
}

function PlanCatalogue({ plans, currentPlanKey }: { plans: Plan[]; currentPlanKey: string | null }) {
  const ordered = orderedPlans(plans)
  const keys = [...new Set(ordered.flatMap((p) => Object.keys(p.entitlements || {})))]
  const groups = groupFeatureKeys(keys)
  const [phonePlan, setPhonePlan] = useState(ordered.find((p) => p.planKey === currentPlanKey)?.planKey ?? ordered[0]?.planKey ?? '')
  const shown = ordered.find((p) => p.planKey === phonePlan) ?? ordered[0]
  return (
    <section aria-labelledby="trade-plan-catalogue-h" className="space-y-3" data-testid="trade-plan-catalogue">
      <div>
        <h2 id="trade-plan-catalogue-h" className="text-base font-semibold text-carup-text">Plans offered</h2>
        <p className="mt-1 text-sm leading-6 text-carup-text-2">{ordered.length} plans, exactly as the catalogue returns them. No plan carries a price here, and none can be bought for real from this page.</p>
      </div>

      {/* Desktop: one matrix, plans as columns. */}
      <div className="relative hidden overflow-x-auto rounded-card border border-carup-line bg-carup-bg-raised lg:block">
        <table className="w-full min-w-[880px] text-left text-sm" data-testid="trade-plan-matrix">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b border-carup-line">
              <th scope="col" className="w-64 px-4 py-3 text-xs font-semibold text-carup-text-3">Capability</th>
              {ordered.map((p) => (
                <th key={p.planKey} scope="col" className={cn('px-3 py-3 align-bottom', p.planKey === currentPlanKey && 'bg-carup-bg-surface')} data-plan-key={p.planKey} aria-current={p.planKey === currentPlanKey ? 'true' : undefined}>
                  {p.planKey === currentPlanKey && <span className="mb-1 block"><StatusChip tone="info">Your plan</StatusChip></span>}
                  <span className="block font-semibold text-carup-text">{p.name}</span>
                  <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-3">{p.description}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.area} className="border-b border-carup-line last:border-b-0">
              <tr>
                <th scope="colgroup" colSpan={ordered.length + 1} className="bg-carup-bg-surface px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{group.label}</th>
              </tr>
              {group.keys.map((key) => (
                <tr key={key} className="border-t border-carup-line first:border-t-0">
                  <th scope="row" className="px-4 py-2 font-normal text-carup-text-2">{featureParts(key).capability}</th>
                  {ordered.map((p) => {
                    const has = Object.prototype.hasOwnProperty.call(p.entitlements || {}, key)
                    const cell = has ? classifyEntitlement(key, p.entitlements[key]) : null
                    return (
                      <td key={p.planKey} className={cn('px-3 py-2', p.planKey === currentPlanKey && 'bg-carup-bg-surface')} data-kind={cell?.kind ?? 'absent'}>
                        {!cell ? <span className="text-carup-text-3">Not listed</span>
                          : cell.kind === 'unavailable' ? <span className="inline-flex items-center gap-1 text-carup-text-3"><Minus className="h-3.5 w-3.5" aria-hidden="true" /><span>Not included</span></span>
                          : <span className="font-semibold text-carup-text">{cell.label}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Phones and tablets: one plan at a time. */}
      <div className="space-y-3 lg:hidden">
        <SegmentedTabs
          idBase="trade-plan-phone"
          label="Plans"
          value={shown?.planKey ?? ''}
          onChange={setPhonePlan}
          tabs={ordered.map((p) => ({ key: p.planKey, label: p.planKey === currentPlanKey ? `${p.name} · yours` : p.name }))}
          testId="trade-plan-phone-tabs"
        />
        {shown && (
          <TabPanel idBase="trade-plan-phone" tabKey={shown.planKey}>
            <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid="trade-plan-phone-card" data-plan-key={shown.planKey}>
              <p className="font-semibold text-carup-text">{shown.name}</p>
              <p className="mt-0.5 text-sm leading-6 text-carup-text-2">{shown.description}</p>
              <div className="mt-3 space-y-3">
                {groupFeatureKeys(Object.keys(shown.entitlements || {})).map((group) => (
                  <div key={group.area}>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{group.label}</h3>
                    <ul className="mt-1 divide-y divide-carup-line">
                      {group.keys.map((key) => {
                        const cell = classifyEntitlement(key, shown.entitlements[key])
                        return (
                          <li key={key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                            <span className="min-w-0 text-carup-text-2">{featureParts(key).capability}</span>
                            <span className={cell.kind === 'unavailable' ? 'text-carup-text-3' : 'font-semibold text-carup-text'}>{cell.label}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </TabPanel>
        )}
      </div>
    </section>
  )
}
