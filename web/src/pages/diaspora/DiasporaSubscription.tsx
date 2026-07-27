/**
 * DiasporaSubscription — Phase 8 orchestrator page.
 *
 * Flag-gated (fail closed): when VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED !== 'true' the page renders an
 * explicit unavailable state and fetches nothing. When ON, it loads plans/status/entitlements/usage,
 * shows the status card + plan comparison + usage dashboard, and (for trusted managers only) the
 * sandbox billing actions. The backend stays authoritative — a management 403 is surfaced through the
 * reusable EntitlementDenialPanel. Reuses existing layout/design primitives; no redesign.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CreditCard, Loader2, Lock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { subscriptionUiEnabled } from '@/config/subscriptionFlag'
import { SubscriptionStatusCard } from '@/components/diaspora/subscription/SubscriptionStatusCard'
import { PlanComparison } from '@/components/diaspora/subscription/PlanComparison'
import { UsageDashboard } from '@/components/diaspora/subscription/UsageDashboard'
import { SubscriptionActions } from '@/components/diaspora/subscription/SubscriptionActions'
import BillingOperationsPanel from '@/components/diaspora/subscription/BillingOperationsPanel'
import { EntitlementDenialPanel } from '@/components/diaspora/subscription/EntitlementDenialPanel'
import { currentPlan, canManageSubscriptionUi } from '@/components/diaspora/subscription/subscriptionHelpers'
import { parseEntitlementDenial } from '@/components/diaspora/subscription/entitlementDenial'
import type { Plan, SubscriptionStatus, EffectiveEntitlements, UsageResponse, StructuredEntitlementDenial } from '@/types'

export default function DiasporaSubscription() {
  const flagEnabled = subscriptionUiEnabled()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  const role = (user?.role || '').toLowerCase()
  const isManager = canManageSubscriptionUi(role)

  const [plans, setPlans] = useState<Plan[]>([])
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [, setEntitlements] = useState<EffectiveEntitlements>({})
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<StructuredEntitlementDenial | null>(null)
  const [actionDenial, setActionDenial] = useState<StructuredEntitlementDenial | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const canView = flagEnabled && isAuthenticated

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setLoadError(null)
    try {
      // Plans + status are the page's backbone; entitlements + usage enrich it.
      const [planList, statusRes] = await Promise.all([
        api.getDiasporaSubscriptionPlans(),
        api.getDiasporaSubscriptionStatus(),
      ])
      setPlans(planList)
      setStatus(statusRes)
      // Best-effort enrichments — a failure here must not blank the whole page (partial state).
      try { setEntitlements(await api.getDiasporaEntitlements()) } catch { /* keep prior */ }
      try { setUsage(await api.getDiasporaUsage()) } catch { setUsage(null) }
    } catch (err) {
      setLoadError(parseEntitlementDenial(err, { requestedOperation: 'load subscription' }))
    } finally {
      setLoading(false)
    }
  }, [api, canView])

  // Depend on stable primitives, not on `load`.
  //
  // `useCarUpApi()` returns a FRESH OBJECT on every render, so `load` — a useCallback keyed on
  // `[api, canView]` — also changes identity on every render. Depending on it here made the effect
  // re-fire after each of its own setState calls: load → setState → render → new api → new load →
  // effect → load, unbounded. On the deployed staging candidate that held the page permanently in its
  // "Loading subscription…" state while issuing subscription requests continuously.
  //
  // Caught by the DEPLOYED browser matrix (spec 36 asserts no surface is left permanently loading),
  // not by any local test: the loop needs real network latency to be observable, and jsdom resolves
  // mocked promises too fast for the spinner ever to be sampled.
  //
  // Same defect PR #130 fixed on DiasporaTradeProfile and the Drive lane fixed on
  // DiasporaDriveConnections. The sibling pages carry this comment for the identical reason.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView])

  // ── Sandbox action handlers (manager-only UI; backend authoritative) ──
  const wrapAction = useCallback(
    (operation: string, requiredFeature: string | undefined, fn: () => Promise<unknown>, successMsg: string) =>
      async () => {
        setActionDenial(null)
        setOutcome(null)
        try {
          await fn()
          setOutcome(successMsg)
          await load() // re-sync authoritative state from the backend
        } catch (err) {
          setActionDenial(
            parseEntitlementDenial(err, {
              requestedOperation: operation,
              requiredFeature,
              currentPlan: status?.planKey,
            }),
          )
        }
      },
    [load, status],
  )

  const handleCheckout = useCallback(
    (planKey: string) => wrapAction('start checkout', undefined, () => api.createDiasporaCheckout(planKey), 'Sandbox checkout session created. No real payment was collected.')(),
    [api, wrapAction],
  )
  const handlePortal = useCallback(
    () => wrapAction('open billing portal', undefined, () => api.createDiasporaBillingPortal(), 'Sandbox billing portal session created. No live billing provider was activated.')(),
    [api, wrapAction],
  )
  const handleChangePlan = useCallback(
    (planKey: string) => wrapAction('change plan', undefined, () => api.changeDiasporaPlan(planKey), 'Plan change requested through the sandbox provider. No real payment was collected.')(),
    [api, wrapAction],
  )
  const handleCancel = useCallback(
    (atPeriodEnd: boolean) => wrapAction('cancel subscription', undefined, () => api.cancelDiasporaSubscription(atPeriodEnd), 'Cancellation scheduled at period end through the sandbox provider. Access continues until then.')(),
    [api, wrapAction],
  )

  // ── Flag OFF: fail closed with an explicit unavailable state. ──
  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="subscription-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>Subscription management is not available</AlertTitle>
          <AlertDescription>
            Subscription management is not available in this environment. It can be enabled by an administrator.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-orange-600" data-testid="subscription-auth-loading">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="subscription-signin-required">
        <Alert className="border-amber-200 bg-amber-50">
          <Lock className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>Sign in to view your diaspora subscription.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const planForStatus = currentPlan(plans, status)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8" data-testid="subscription-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950">
            <CreditCard className="h-6 w-6 text-orange-600" aria-hidden="true" /> Subscription
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Your tenant plan, effective entitlements and metered usage. Billing runs in sandbox mode only.
          </p>
        </div>
        <Button asChild variant="outline"><Link to="/diaspora">Diaspora home</Link></Button>
      </header>

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-orange-700" data-testid="subscription-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading subscription…
        </p>
      )}

      {/* Load failure (incl. missing-tenant-context) — safe, structured. */}
      {loadError && (
        <div className="mt-4" data-testid="subscription-load-error">
          <EntitlementDenialPanel denial={loadError} onRetry={loadError.retryable ? () => void load() : undefined} testId="subscription-load-denial" />
        </div>
      )}

      {!loadError && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <SubscriptionStatusCard status={status} plan={planForStatus} />
            <UsageDashboard usage={usage} />
          </div>

          <div className="space-y-6">
            {isManager ? (
              <>
                {actionDenial && (
                  <EntitlementDenialPanel
                    denial={actionDenial}
                    onRetry={actionDenial.retryable ? () => void load() : undefined}
                    testId="subscription-action-denial"
                  />
                )}
                <SubscriptionActions
                  plans={plans}
                  status={status}
                  outcome={outcome}
                  onCheckout={handleCheckout}
                  onPortal={handlePortal}
                  onChangePlan={handleChangePlan}
                  onCancel={handleCancel}
                />
                {/* Operator health. Manager-only here and re-gated server-side; the panel removes
                    itself on a 403 rather than rendering a misleading empty state. */}
                <BillingOperationsPanel />
              </>
            ) : (
              <Alert className="border-slate-200 bg-slate-50" data-testid="subscription-readonly">
                <AlertTriangle className="h-4 w-4 text-slate-700" aria-hidden="true" />
                <AlertTitle>Read-only</AlertTitle>
                <AlertDescription>
                  Billing changes are limited to tenant administrators. You can review your plan, entitlements and usage here.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      )}

      {!loadError && (
        <div className="mt-8">
          <PlanComparison plans={plans} currentPlanKey={status?.planKey ?? null} />
        </div>
      )}
    </div>
  )
}
