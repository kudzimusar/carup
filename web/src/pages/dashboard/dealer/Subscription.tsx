/**
 * CARUP-PAY-03B — Dealer "Plan & Billing" (/dealer/subscription).
 *
 * Truth rules this page must never break:
 *  - A paid catalogue plan has no approved commercial price: it reads "Not yet available" (with the
 *    governance blocker) or "Request a quote". Only a free tier reads "Free".
 *  - A sandbox fixture plan (visible only here, only in a sandbox runtime) is always labelled
 *    "Sandbox test plan — not a commercial offer"; a simulated provider is always labelled as not Stripe.
 *  - Reviewed terms ≠ a provider payment ≠ access. Access comes only from `entitlements.access`
 *    (periods CarUp confirmed as paid with the provider) — never from a subscription status, and never
 *    from returning from the provider page.
 *  - A failed read renders an error (role="alert"), never an empty plan or invoice list.
 *  - Every write carries an Idempotency-Key generated once per reviewed intent and reused on retry; no
 *    POST is ever re-sent automatically.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Pay03bInvoicesTable } from '@/components/pay03b/Pay03bInvoicesTable'
import { Pay03bSandboxLabel, Pay03bSimulatedLabel } from '@/components/pay03b/Pay03bLabels'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { createPay03bIdempotencyKey } from '@/lib/pay03bApi'
import { redirectToPay03bProvider } from '@/lib/pay03bRedirect'
import {
  PAY03B_LISTING_CAPACITY_KEY,
  PAY03B_RECONCILIATION_HOLD_TEXT,
  PAY03B_REDIRECT_NOTICE,
  PAY03B_RELOAD_PLAN_CODES,
  PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL,
  describePay03bAccessReason,
  describePay03bCancellationPolicy,
  describePay03bChangePolicy,
  describePay03bEntitlementKey,
  describePay03bError,
  describePay03bRefundPolicy,
  describePay03bSubscriptionStatus,
  formatPay03bDateTime,
  formatPay03bInterval,
  formatPay03bMinor,
  humanizePay03bToken,
  isPay03bSubscriptionChangeable,
  isPay03bSubscriptionLive,
  pay03bAllowedChangeModes,
  pay03bCommercialKind,
  pay03bProviderLabel,
  type Pay03bErrorDescription,
} from '@/lib/pay03bDisplay'
import type {
  Pay03bAcknowledgedTerms,
  Pay03bCancelMode,
  Pay03bChangePreview,
  Pay03bChangeResult,
  Pay03bCheckoutRequest,
  Pay03bCheckoutResponse,
  Pay03bDealerOverview,
  Pay03bPlan,
  Pay03bPlanChangeMode,
  Pay03bSubscription,
} from '@/types/pay03b'

type ReturnState = 'returned' | 'cancelled' | null
type VerifyOutcome = 'idle' | 'checking' | 'confirmed' | 'pending'

interface TermsIntent {
  plan: Pay03bPlan
  key: string
}

interface ConfirmIntent {
  mode: Pay03bCancelMode
  key: string
}

const termsIntentId = (planId: string) => `checkout:${planId}`
const cancelIntentId = (mode: Pay03bCancelMode) => `cancel:${mode}`
const changeIntentId = (planId: string, mode: Pay03bPlanChangeMode) => `change:${planId}:${mode}`

function planAmount(plan: Pick<Pay03bPlan, 'amountMinor' | 'currency' | 'currencyScale'>): string | null {
  return formatPay03bMinor(plan.amountMinor, plan.currency, plan.currencyScale)
}

/** The governed terms exactly as shown; null when a sandbox plan is missing any of them (fail closed). */
function acknowledgedTermsFor(plan: Pay03bPlan): Pay03bAcknowledgedTerms | null {
  if (typeof plan.amountMinor !== 'number' || !plan.currency || !plan.billingInterval || typeof plan.intervalCount !== 'number') {
    return null
  }
  return {
    planVersion: plan.planVersion,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    intervalCount: plan.intervalCount,
  }
}

function ErrorText({ error, testId }: { error: Pay03bErrorDescription; testId: string }) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 [overflow-wrap:anywhere]"
    >
      <p>{error.message}</p>
      {error.code ? <p className="mt-1 font-mono text-xs text-red-700">{error.code}</p> : null}
    </div>
  )
}

function StatusTile({ title, testId, tone = 'neutral', children }: {
  title: string
  testId: string
  tone?: 'neutral' | 'positive' | 'warning'
  children: ReactNode
}) {
  const toneClass = tone === 'positive'
    ? 'border-emerald-200 bg-emerald-50/60'
    : tone === 'warning' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-white'
  return (
    <div className={`min-w-0 rounded-lg border p-4 ${toneClass}`} data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <div className="mt-1 min-w-0 space-y-1 [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ plan card

interface PlanCardProps {
  plan: Pay03bPlan
  isCurrent: boolean
  canSubscribe: boolean
  changeModes: Pay03bPlanChangeMode[] | null
  onSubscribe: (plan: Pay03bPlan) => void
  onChange: (plan: Pay03bPlan) => void
}

function PlanCard({ plan, isCurrent, canSubscribe, changeModes, onSubscribe, onChange }: PlanCardProps) {
  const kind = pay03bCommercialKind(plan)
  const amount = kind === 'sandbox' ? planAmount(plan) : null
  const interval = formatPay03bInterval(plan.billingInterval, plan.intervalCount)
  const entitlementEntries = Object.entries(plan.entitlements || {})
  return (
    <article
      className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-white p-4 ${isCurrent ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-200'}`}
      data-testid={`pay03b-plan-${plan.planCode}`}
      aria-current={isCurrent ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-950 [overflow-wrap:anywhere]">{plan.displayName}</h3>
          <p className="font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">{plan.planCode} · version {plan.planVersion}</p>
        </div>
        {isCurrent ? (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid={`pay03b-plan-current-${plan.planCode}`}>
            Current plan
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2" data-testid={`pay03b-plan-status-${plan.planCode}`}>
        {kind === 'sandbox' ? (
          <>
            <Pay03bSandboxLabel />
            <p className="text-2xl font-bold tabular-nums text-gray-950" data-testid={`pay03b-plan-amount-${plan.planCode}`}>
              {amount ?? 'Amount not set'}
              {interval ? <span className="ml-1 text-sm font-normal text-gray-500">{interval}</span> : null}
            </p>
            <p className="text-xs text-gray-600">
              A test amount for sandbox checkout only — not a price CarUp offers.
              {plan.currency ? ` Currency: ${plan.currency}.` : ''}
            </p>
            {plan.simulated ? <Pay03bSimulatedLabel /> : <p className="text-xs text-gray-600">Provider: {PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL}</p>}
          </>
        ) : kind === 'free' ? (
          <>
            <p className="text-2xl font-bold text-gray-950">Free</p>
            <p className="text-xs text-gray-600">Baseline for every dealership — no subscription or payment needed.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-gray-950">{kind === 'request_quote' ? 'Request a quote' : 'Not yet available'}</p>
            <p
              className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900"
              data-testid={`pay03b-plan-blocker-${plan.planCode}`}
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <strong>{plan.blockerClass ?? 'Governance'}:</strong>{' '}
                {plan.blockerReason ?? 'No approved commercial terms exist for this plan yet.'}
              </span>
            </p>
          </>
        )}
      </div>

      {entitlementEntries.length > 0 ? (
        <ul className="space-y-1 text-sm text-gray-700">
          {entitlementEntries.map(([key, value]) => (
            <li key={key} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{describePay03bEntitlementKey(key, value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.trialDays ? <p className="text-xs text-gray-600">Includes an approved trial of {plan.trialDays} days.</p> : null}
      {plan.graceDays ? (
        <p className="text-xs text-gray-600">If a renewal payment fails, access continues for an approved grace period of {plan.graceDays} days.</p>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {canSubscribe ? (
          <Button
            className="h-auto min-h-9 whitespace-normal bg-orange-500 text-white hover:bg-orange-600"
            onClick={() => onSubscribe(plan)}
            data-testid={`pay03b-subscribe-${plan.planCode}`}
          >
            Review terms &amp; subscribe
          </Button>
        ) : null}
        {changeModes && changeModes.length > 0 ? (
          <Button
            variant="outline"
            className="h-auto min-h-9 whitespace-normal"
            onClick={() => onChange(plan)}
            data-testid={`pay03b-change-plan-${plan.planCode}`}
          >
            Change to this plan
          </Button>
        ) : null}
        {changeModes && changeModes.length === 0 ? (
          <p className="text-xs text-gray-500" data-testid={`pay03b-change-not-allowed-${plan.planCode}`}>
            Your current plan’s terms do not allow changing to this plan.
          </p>
        ) : null}
        {kind === 'request_quote' ? (
          <Button variant="outline" asChild className="h-auto min-h-9 whitespace-normal">
            <Link to="/contact" data-testid={`pay03b-request-quote-${plan.planCode}`}>Contact CarUp for a quote</Link>
          </Button>
        ) : null}
      </div>
    </article>
  )
}

// ------------------------------------------------------------------------------------------ terms review

interface TermsReviewDialogProps {
  intent: TermsIntent
  continuingPaidThrough: string | null
  onClose: () => void
  onAttempt: (intentId: string, key: string) => void
  onDone: (intentId: string) => void
  onTermsChanged: (error: Pay03bErrorDescription) => void
  createCheckout: (body: Pay03bCheckoutRequest, idempotencyKey: string) => Promise<Pay03bCheckoutResponse>
}

function TermsReviewDialog({
  intent, continuingPaidThrough, onClose, onAttempt, onDone, onTermsChanged, createCheckout,
}: TermsReviewDialogProps) {
  const { plan, key } = intent
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const activeRef = useRef(true)
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  const terms = acknowledgedTermsFor(plan)
  const amount = planAmount(plan)
  const interval = formatPay03bInterval(plan.billingInterval, plan.intervalCount)

  const confirm = async () => {
    if (busy || !terms) return
    setBusy(true)
    setError(null)
    onAttempt(termsIntentId(plan.id), key)
    try {
      const res = await createCheckout({ planId: plan.id, acknowledgedTerms: terms }, key)
      if (!activeRef.current) return
      if (res.checkoutUrl) {
        redirectToPay03bProvider(res.checkoutUrl)
        return
      }
      onDone(termsIntentId(plan.id))
      setError({
        code: null,
        status: null,
        message: `This checkout is no longer open (provider status: ${humanizePay03bToken(res.checkoutStatus)}). Close this review and refresh to see the current state.`,
      })
      setBusy(false)
    } catch (err) {
      if (!activeRef.current) return
      const described = describePay03bError(err, 'Checkout could not be started.')
      if (described.code && PAY03B_RELOAD_PLAN_CODES.has(described.code)) {
        onDone(termsIntentId(plan.id))
        onTermsChanged(described)
        return
      }
      setError(described)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-terms-dialog">
        <DialogHeader>
          <DialogTitle>Review subscription terms</DialogTitle>
          <DialogDescription>
            Reviewing these terms charges nothing. Payment happens at the provider, and access starts only after CarUp
            confirms that payment with the provider.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 text-sm text-gray-800">
          <div className="space-y-2">
            <p className="font-semibold text-gray-950 [overflow-wrap:anywhere]">{plan.displayName}</p>
            <p className="font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">{plan.planCode} · version {plan.planVersion}</p>
            <div className="flex flex-wrap gap-2">
              <Pay03bSandboxLabel testId="pay03b-terms-sandbox-label" />
              {plan.simulated ? <Pay03bSimulatedLabel testId="pay03b-terms-simulated-label" /> : null}
            </div>
          </div>

          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-gray-500">Amount</dt>
            <dd className="font-semibold tabular-nums" data-testid="pay03b-terms-amount">{amount ?? 'Not set'}</dd>
            <dt className="text-gray-500">Currency</dt>
            <dd data-testid="pay03b-terms-currency">{plan.currency ?? 'Not set'}</dd>
            <dt className="text-gray-500">Billing</dt>
            <dd data-testid="pay03b-terms-interval">{interval ? `Charged ${interval}` : 'Not set'}</dd>
            <dt className="text-gray-500">Renewal</dt>
            <dd>
              Renews automatically {interval ?? ''} until cancelled. Each renewal is charged by the provider; CarUp grants
              the next period only after confirming that payment.
            </dd>
            <dt className="text-gray-500">Provider</dt>
            <dd data-testid="pay03b-terms-provider">{pay03bProviderLabel({ simulated: plan.simulated })}</dd>
          </dl>

          <div className="space-y-1">
            <p className="font-semibold text-gray-950">Cancellation</p>
            <ul className="list-disc space-y-1 pl-5" data-testid="pay03b-terms-cancellation">
              {describePay03bCancellationPolicy(plan.cancellationPolicy).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-gray-950">Refunds</p>
            <p data-testid="pay03b-terms-refund">{describePay03bRefundPolicy(plan.refundPolicy)}</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-gray-950">Plan changes</p>
            <ul className="list-disc space-y-1 pl-5">
              {describePay03bChangePolicy(plan.changePolicy).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          {plan.trialDays ? <p>Includes an approved trial of {plan.trialDays} days.</p> : null}
          {plan.graceDays ? <p>If a renewal payment fails, access continues for an approved grace period of {plan.graceDays} days.</p> : null}
          {continuingPaidThrough ? (
            <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">
              Your current paid access continues until {continuingPaidThrough}. A new subscription starts its own billing period.
            </p>
          ) : null}

          <ol className="grid gap-2 rounded-md border bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-3" data-testid="pay03b-terms-steps">
            <li><strong className="block text-slate-900">1 · Terms reviewed</strong>This step. Nothing is charged.</li>
            <li><strong className="block text-slate-900">2 · Provider payment</strong>You pay on the provider’s page.</li>
            <li><strong className="block text-slate-900">3 · Access</strong>Starts when CarUp confirms the payment with the provider.</li>
          </ol>
          <p className="font-medium text-gray-950" data-testid="pay03b-terms-redirect-notice">{PAY03B_REDIRECT_NOTICE}</p>

          {!terms ? (
            <ErrorText
              testId="pay03b-terms-error"
              error={{ code: null, status: null, message: 'This plan’s terms are incomplete, so it cannot be purchased.' }}
            />
          ) : null}
          {error ? <ErrorText error={error} testId="pay03b-terms-error" /> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="pay03b-terms-cancel">Close</Button>
          <Button
            className="h-auto min-h-9 whitespace-normal bg-orange-500 text-white hover:bg-orange-600"
            disabled={busy || !terms}
            onClick={() => void confirm()}
            data-testid="pay03b-terms-confirm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Starting checkout…' : error ? 'Try again' : 'Continue to provider'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------ plan change

function ChangePreviewPanel({ targetPlanId, mode, previewChange, onReady }: {
  targetPlanId: string
  mode: Pay03bPlanChangeMode
  previewChange: (targetPlanId: string, mode: Pay03bPlanChangeMode) => Promise<Pay03bChangePreview>
  onReady: (ready: boolean) => void
}) {
  const [preview, setPreview] = useState<Pay03bChangePreview | null>(null)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)

  useEffect(() => {
    let cancelled = false
    previewChange(targetPlanId, mode)
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        onReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        setError(describePay03bError(err, 'The change could not be previewed.'))
        onReady(false)
      })
    return () => { cancelled = true }
  }, [targetPlanId, mode, previewChange, onReady])

  if (error) return <ErrorText error={error} testId="pay03b-change-preview-error" />
  if (!preview) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-gray-600" data-testid="pay03b-change-preview-loading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Asking the provider for a preview…
      </p>
    )
  }
  const effective = preview.effectiveFrom === 'on_successful_payment'
    ? 'After the prorated invoice is paid and CarUp confirms it'
    : formatPay03bDateTime(preview.effectiveFrom) ?? preview.effectiveFrom
  return (
    <div className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm" data-testid="pay03b-change-preview">
      <div className="flex flex-wrap gap-2">
        <Pay03bSandboxLabel testId="pay03b-change-sandbox-label" />
        {preview.simulated ? <Pay03bSimulatedLabel testId="pay03b-change-simulated-label" /> : null}
      </div>
      <p>
        Charged now: <strong className="tabular-nums" data-testid="pay03b-change-charge-now">
          {formatPay03bMinor(preview.chargeNowMinor, preview.currency) ?? '—'}
        </strong>
      </p>
      <p>Takes effect: <span data-testid="pay03b-change-effective">{effective}</span></p>
      {preview.lines.length > 0 ? (
        <ul className="space-y-1 text-xs text-slate-700">
          {preview.lines.map((line, index) => (
            <li key={`${line.periodStart ?? 'line'}-${index}`} className="[overflow-wrap:anywhere]">
              {formatPay03bMinor(line.amountMinor, preview.currency) ?? '—'} · {line.proration ? 'prorated adjustment' : 'plan charge'}
              {line.periodStart ? ` · ${formatPay03bDateTime(line.periodStart)} – ${formatPay03bDateTime(line.periodEnd) ?? '—'}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-slate-600">
        {preview.providerBacked ? 'Preview calculated by the provider. ' : ''}A preview is not a charge.
      </p>
    </div>
  )
}

interface ChangePlanDialogProps {
  target: Pay03bPlan
  currentPlan: Pay03bPlan
  modes: Pay03bPlanChangeMode[]
  keyFor: (intentId: string) => string
  onAttempt: (intentId: string, key: string) => void
  onDone: (intentId: string) => void
  onClose: () => void
  onChanged: (result: Pay03bChangeResult, mode: Pay03bPlanChangeMode, target: Pay03bPlan) => void
  onTermsChanged: (error: Pay03bErrorDescription) => void
  previewChange: (targetPlanId: string, mode: Pay03bPlanChangeMode) => Promise<Pay03bChangePreview>
  changePlan: (body: { targetPlanId: string; mode: Pay03bPlanChangeMode }, idempotencyKey: string) => Promise<Pay03bChangeResult>
}

function ChangePlanDialog({
  target, currentPlan, modes, keyFor, onAttempt, onDone, onClose, onChanged, onTermsChanged, previewChange, changePlan,
}: ChangePlanDialogProps) {
  const [mode, setMode] = useState<Pay03bPlanChangeMode>(modes[0])
  const [key, setKey] = useState(() => keyFor(changeIntentId(target.id, modes[0])))
  const [previewReady, setPreviewReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const activeRef = useRef(true)
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])
  const handleReady = useCallback((ready: boolean) => setPreviewReady(ready), [])

  const upgrade = target.tierRank > currentPlan.tierRank

  const selectMode = (next: Pay03bPlanChangeMode) => {
    if (next === mode || busy) return
    setMode(next)
    setKey(keyFor(changeIntentId(target.id, next)))
    setPreviewReady(false)
    setError(null)
  }

  const confirm = async () => {
    if (busy || !previewReady) return
    setBusy(true)
    setError(null)
    const intentId = changeIntentId(target.id, mode)
    onAttempt(intentId, key)
    try {
      const result = await changePlan({ targetPlanId: target.id, mode }, key)
      if (!activeRef.current) return
      onDone(intentId)
      onChanged(result, mode, target)
    } catch (err) {
      if (!activeRef.current) return
      const described = describePay03bError(err, 'The plan change could not be completed.')
      if (described.code && PAY03B_RELOAD_PLAN_CODES.has(described.code)) {
        onDone(intentId)
        onTermsChanged(described)
        return
      }
      setError(described)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-change-dialog">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{upgrade ? 'Upgrade' : 'Change'} to {target.displayName}</DialogTitle>
          <DialogDescription>
            From {currentPlan.displayName}. The provider previews any charge before you confirm; access to the new plan
            follows the paid periods CarUp confirms.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-semibold text-gray-950">When should the change apply?</legend>
            {modes.map((option) => (
              <label key={option} className="flex items-start gap-2 rounded-md border p-2" htmlFor={`pay03b-change-mode-${option}`}>
                <input
                  type="radio"
                  id={`pay03b-change-mode-${option}`}
                  name="pay03b-change-mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => selectMode(option)}
                  className="mt-1"
                  data-testid={`pay03b-change-mode-${option}`}
                />
                <span className="min-w-0">
                  {option === 'period_end'
                    ? 'At the end of the current paid period — nothing is charged now.'
                    : 'Now — the provider invoices the prorated difference immediately.'}
                </span>
              </label>
            ))}
          </fieldset>

          <ChangePreviewPanel
            key={`${target.id}:${mode}`}
            targetPlanId={target.id}
            mode={mode}
            previewChange={previewChange}
            onReady={handleReady}
          />

          {error ? <ErrorText error={error} testId="pay03b-change-error" /> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            className="h-auto min-h-9 whitespace-normal"
            disabled={busy || !previewReady}
            onClick={() => void confirm()}
            data-testid="pay03b-change-confirm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Confirming with the provider…' : error ? 'Try again' : 'Confirm plan change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------ cancel / resume

interface ConfirmActionDialogProps {
  intent: ConfirmIntent
  subscription: Pay03bSubscription
  currentPlan: Pay03bPlan | null
  paidThroughLabel: string | null
  onAttempt: (intentId: string, key: string) => void
  onDone: (intentId: string) => void
  onClose: () => void
  onCompleted: (result: Pay03bChangeResult, mode: Pay03bCancelMode) => void
  cancelSubscription: (body: { mode: Pay03bCancelMode; reason?: string | null }, idempotencyKey: string) => Promise<Pay03bChangeResult>
}

function ConfirmActionDialog({
  intent, subscription, currentPlan, paidThroughLabel, onAttempt, onDone, onClose, onCompleted, cancelSubscription,
}: ConfirmActionDialogProps) {
  const { mode, key } = intent
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const activeRef = useRef(true)
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  const periodEnd = formatPay03bDateTime(subscription.currentPeriodEnd)
  const renewal = currentPlan ? planAmount(currentPlan) : null
  const interval = currentPlan ? formatPay03bInterval(currentPlan.billingInterval, currentPlan.intervalCount) : null

  const copy = mode === 'period_end'
    ? {
        title: 'Cancel at the end of the paid period?',
        body: `Renewal stops. Paid access continues until ${paidThroughLabel ?? periodEnd ?? 'the end of the paid period'}; after that, paid features end. Nothing further is charged unless you resume renewal before then.`,
        action: 'Cancel at period end',
      }
    : mode === 'immediate'
      ? {
          title: 'Cancel immediately?',
          body: `Access to paid features ends immediately, even though the current period was paid. ${describePay03bRefundPolicy(currentPlan?.refundPolicy)}`,
          action: 'Cancel immediately',
        }
      : {
          title: 'Resume renewal?',
          body: `The subscription will renew at the end of the current period${periodEnd ? ` (${periodEnd})` : ''}${renewal ? `, and the provider will charge ${renewal}${interval ? ` ${interval}` : ''}` : ''}. CarUp grants the next period only after confirming that payment.`,
          action: 'Resume renewal',
        }

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const intentId = cancelIntentId(mode)
    onAttempt(intentId, key)
    try {
      const result = await cancelSubscription({ mode, reason: mode === 'resume' ? null : reason }, key)
      if (!activeRef.current) return
      onDone(intentId)
      onCompleted(result, mode)
    } catch (err) {
      if (!activeRef.current) return
      setError(describePay03bError(err, 'The request could not be completed.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription data-testid="pay03b-confirm-body">{copy.body}</DialogDescription>
        </DialogHeader>
        {mode !== 'resume' ? (
          <div className="space-y-1.5">
            <Label htmlFor="pay03b-cancel-reason">Reason (optional, shared with CarUp)</Label>
            <Textarea
              id="pay03b-cancel-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              data-testid="pay03b-cancel-reason"
            />
          </div>
        ) : null}
        {error ? <ErrorText error={error} testId="pay03b-confirm-error" /> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Keep as is</Button>
          <Button
            variant={mode === 'immediate' ? 'destructive' : 'default'}
            className="h-auto min-h-9 whitespace-normal"
            disabled={busy}
            onClick={() => void confirm()}
            data-testid="pay03b-confirm-action"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Confirming with the provider…' : error ? 'Try again' : copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------ page

export default function DealerSubscription() {
  const {
    fetchPay03bDealerOverview,
    verifyPay03bDealerSubscription,
    createPay03bDealerCheckout,
    previewPay03bPlanChange,
    changePay03bDealerPlan,
    cancelPay03bDealerSubscription,
    createPay03bPaymentMethodUpdate,
    getPay03bInvoicePaymentLink,
  } = useCarUpApi()
  const [searchParams] = useSearchParams()
  const [returnState] = useState<ReturnState>(() => {
    const value = searchParams.get('pay03b')
    return value === 'returned' || value === 'cancelled' ? value : null
  })

  const [overview, setOverview] = useState<Pay03bDealerOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<Pay03bErrorDescription | null>(null)
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyOutcome>(returnState === 'returned' ? 'checking' : 'idle')
  const [verifyError, setVerifyError] = useState<Pay03bErrorDescription | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<Pay03bErrorDescription | null>(null)
  const [redirectBusy, setRedirectBusy] = useState<string | null>(null)
  const [termsIntent, setTermsIntent] = useState<TermsIntent | null>(null)
  const [changeTarget, setChangeTarget] = useState<Pay03bPlan | null>(null)
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent | null>(null)
  // One idempotency key per reviewed intent: remembered once a request was SENT, so re-opening the same
  // review after a stalled or failed attempt replays it instead of creating a second agreement; cleared
  // once the intent completed so a later, separate intent gets a fresh key.
  const [attemptKeys, setAttemptKeys] = useState<Record<string, string>>({})

  const keyFor = useCallback((intentId: string) => attemptKeys[intentId] ?? createPay03bIdempotencyKey(), [attemptKeys])
  const rememberAttempt = useCallback((intentId: string, key: string) => {
    setAttemptKeys((prev) => (prev[intentId] === key ? prev : { ...prev, [intentId]: key }))
  }, [])
  const forgetAttempt = useCallback((intentId: string) => {
    setAttemptKeys((prev) => {
      if (!(intentId in prev)) return prev
      const next = { ...prev }
      delete next[intentId]
      return next
    })
  }, [])

  const readOverview = useCallback(async () => {
    try {
      const data = await fetchPay03bDealerOverview()
      setOverview(data)
      setLoadError(null)
    } catch (err) {
      setOverview(null)
      setLoadError(describePay03bError(err, 'Plan & billing could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [fetchPay03bDealerOverview])

  // Initial load. A return from the provider is NOT payment proof: on `?pay03b=returned` the provider is
  // re-read into CarUp's authority first (verify), and "confirmation pending" stays until the overview
  // itself shows paid access. If that re-check fails, the last recorded state is read instead.
  useEffect(() => {
    let cancelled = false
    const read = () => fetchPay03bDealerOverview().then(
      (data) => {
        if (cancelled) return
        setOverview(data)
        setLoadError(null)
        setLoading(false)
      },
      (err) => {
        if (cancelled) return
        setOverview(null)
        setLoadError(describePay03bError(err, 'Plan & billing could not be loaded.'))
        setLoading(false)
      },
    )
    if (returnState === 'returned') {
      verifyPay03bDealerSubscription().then(
        (data) => {
          if (cancelled) return
          setOverview(data)
          setLoadError(null)
          setVerifyError(null)
          setVerifyOutcome(data.entitlements.access ? 'confirmed' : 'pending')
          setLoading(false)
        },
        (err) => {
          if (cancelled) return
          setVerifyError(describePay03bError(err, 'CarUp could not re-check the payment with the provider.'))
          setVerifyOutcome('pending')
          void read()
        },
      )
    } else {
      void read()
    }
    return () => { cancelled = true }
  }, [returnState, fetchPay03bDealerOverview, verifyPay03bDealerSubscription])

  const refresh = () => {
    setLoading(true)
    setLoadError(null)
    void readOverview()
  }

  const recheckPayment = async () => {
    setVerifyOutcome('checking')
    setVerifyError(null)
    try {
      const data = await verifyPay03bDealerSubscription()
      setOverview(data)
      setLoadError(null)
      setVerifyOutcome(data.entitlements.access ? 'confirmed' : 'pending')
    } catch (err) {
      setVerifyError(describePay03bError(err, 'CarUp could not re-check the payment with the provider.'))
      setVerifyOutcome('pending')
    }
  }

  const reloadAfterTermsChange = (error: Pay03bErrorDescription) => {
    setTermsIntent(null)
    setChangeTarget(null)
    setNotice(null)
    setActionError(error)
    setLoading(true)
    void readOverview()
  }

  const goToProvider = async (busyKey: string, obtain: () => Promise<{ url: string }>) => {
    if (redirectBusy) return
    setRedirectBusy(busyKey)
    setActionError(null)
    setNotice(null)
    try {
      const { url } = await obtain()
      redirectToPay03bProvider(url)
    } catch (err) {
      setActionError(describePay03bError(err, 'The provider page could not be opened.'))
      setRedirectBusy(null)
    }
  }

  const sub = overview?.subscription ?? null
  const entitlements = overview?.entitlements ?? null
  const billingAdmin = overview?.billingAuthority === true
  const plans = [...(overview?.plans ?? [])].sort((a, b) => a.tierRank - b.tierRank || a.displayName.localeCompare(b.displayName))
  const live = isPay03bSubscriptionLive(sub)
  const changeable = isPay03bSubscriptionChangeable(sub)
  const currentPlan = sub ? plans.find((plan) => plan.id === sub.planId) ?? null : null
  const planName = (code: string | null | undefined) =>
    (code ? plans.find((plan) => plan.planCode === code)?.displayName ?? code : null)
  const paidThroughIso = entitlements?.paidThrough ?? sub?.paidThrough ?? null
  const paidThroughLabel = formatPay03bDateTime(paidThroughIso)
  const capacity = entitlements?.effective?.[PAY03B_LISTING_CAPACITY_KEY]
  const access = entitlements?.access === true
  const pendingVisible = Boolean(overview) && verifyOutcome === 'pending' && !access
  const hasSandboxPlans = plans.some((plan) => pay03bCommercialKind(plan) === 'sandbox')

  const openTerms = (plan: Pay03bPlan) => {
    setNotice(null)
    setActionError(null)
    setTermsIntent({ plan, key: keyFor(termsIntentId(plan.id)) })
  }
  const openConfirm = (mode: Pay03bCancelMode) => {
    setNotice(null)
    setActionError(null)
    setConfirmIntent({ mode, key: keyFor(cancelIntentId(mode)) })
  }

  const onChanged = (result: Pay03bChangeResult, mode: Pay03bPlanChangeMode, target: Pay03bPlan) => {
    setOverview(result.overview)
    setChangeTarget(null)
    if (result.status === 'provider_confirmed') {
      setNotice(mode === 'period_end'
        ? `Plan change confirmed by the provider. ${target.displayName} applies from the next billing period.`
        : `Plan change confirmed by the provider. Access to ${target.displayName} starts once CarUp confirms the prorated invoice payment.`)
    } else {
      setNotice(`Plan change request recorded with status “${humanizePay03bToken(result.status)}”.`)
    }
  }

  const onCancelCompleted = (result: Pay03bChangeResult, mode: Pay03bCancelMode) => {
    setOverview(result.overview)
    setConfirmIntent(null)
    if (result.status !== 'provider_confirmed') {
      setNotice(`Request recorded with status “${humanizePay03bToken(result.status)}”.`)
      return
    }
    const through = formatPay03bDateTime(result.overview.entitlements?.paidThrough ?? result.overview.subscription?.paidThrough)
    setNotice(mode === 'period_end'
      ? `Renewal cancelled. Paid access continues until ${through ?? 'the end of the paid period'}.`
      : mode === 'immediate'
        ? 'Subscription cancelled immediately. Paid access has ended.'
        : 'Renewal resumed. The subscription renews at the end of the current period.')
  }

  const renewalText = !sub || !live
    ? 'No renewal is scheduled.'
    : sub.status === 'incomplete'
      ? 'Starts after checkout is completed and CarUp confirms the payment.'
      : sub.cancelAtPeriodEnd
        ? `Renewal cancelled — paid access continues until ${paidThroughLabel ?? formatPay03bDateTime(sub.currentPeriodEnd) ?? 'the end of the paid period'}.`
        : sub.currentPeriodEnd
          ? `Next renewal (provider schedule): ${formatPay03bDateTime(sub.currentPeriodEnd)}. The next period starts only after CarUp confirms that payment.`
          : 'The provider has not reported a renewal date yet.'

  const capacityText = typeof capacity === 'number' ? `Up to ${capacity} published listings` : 'No capacity set by any plan'
  const capacityNote = overview?.enforcementActive
    ? (typeof capacity === 'number'
        ? 'Enforced: publishing beyond this capacity is refused.'
        : 'Publishing is not limited by billing.')
    : 'Not enforced in this environment — publishing is not limited by billing.'

  const suspensionText = sub?.status === 'suspended'
    ? sub.suspendedReason === 'admin_suspension'
      ? 'Suspended by a CarUp administrator. Paid features are suspended until CarUp lifts the suspension.'
      : sub.suspendedReason === 'provider_unpaid'
        ? 'Suspended because the provider reports the subscription as unpaid. Pay any open invoice below.'
        : sub.suspendedReason === 'unauthorized_provider_trial'
          ? 'Suspended because the provider reported a trial this plan does not include. CarUp will resolve it.'
          : 'This subscription is suspended.'
    : null

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-6" data-testid="pay03b-dealer-subscription">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">Dealer workspace</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-950">
            <CreditCard className="h-6 w-6 shrink-0 text-orange-500" aria-hidden="true" />
            Plan &amp; Billing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Your dealership’s plan, paid access and invoices. Access comes only from periods CarUp has confirmed as paid
            with the payment provider.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} data-testid="pay03b-refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      {returnState === 'cancelled' ? (
        <div role="status" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" data-testid="pay03b-checkout-cancelled">
          Checkout was not completed. CarUp has not recorded a payment for it.
        </div>
      ) : null}
      {verifyOutcome === 'checking' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-gray-700" data-testid="pay03b-confirmation-checking">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking the payment with the provider…
        </p>
      ) : null}
      {pendingVisible ? (
        <div role="status" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="pay03b-confirmation-pending">
          <p className="font-semibold">Payment confirmation pending</p>
          <p>
            Returning from the provider is not proof of payment. CarUp grants access only after it confirms a paid period
            with the provider, and it has not confirmed one yet.
          </p>
          {verifyError ? <ErrorText error={verifyError} testId="pay03b-verify-error" /> : null}
          <Button size="sm" variant="outline" onClick={() => void recheckPayment()} data-testid="pay03b-verify">
            Check payment status
          </Button>
        </div>
      ) : null}
      {overview && verifyOutcome === 'confirmed' && access ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="pay03b-confirmation-confirmed">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>CarUp confirmed a paid period with the provider. Paid access is active{paidThroughLabel ? ` until ${paidThroughLabel}` : ''}.</span>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 [overflow-wrap:anywhere]" data-testid="pay03b-action-status">
          {notice}
        </div>
      ) : null}
      {actionError ? <ErrorText error={actionError} testId="pay03b-action-error" /> : null}

      {loading && !overview ? (
        <p role="status" className="flex items-center gap-2 rounded-md border bg-white p-4 text-sm text-gray-600" data-testid="pay03b-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading plan &amp; billing…
        </p>
      ) : null}

      {!loading && loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="pay03b-error">
          <p className="font-semibold">Plan &amp; billing could not be loaded.</p>
          <p className="[overflow-wrap:anywhere]">{loadError.message}</p>
          {loadError.code ? <p className="font-mono text-xs [overflow-wrap:anywhere]">{loadError.code}</p> : null}
          <p>Nothing is shown because CarUp could not confirm it — this is not an empty plan or invoice list.</p>
          <Button size="sm" variant="outline" onClick={refresh} data-testid="pay03b-retry">Try again</Button>
        </div>
      ) : null}

      {overview && entitlements ? (
        <>
          <section aria-label="Organization and billing authority" className="min-w-0 rounded-lg border bg-white p-4" data-testid="pay03b-organization">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
              <span className="min-w-0 font-semibold text-gray-950 [overflow-wrap:anywhere]" data-testid="pay03b-organization-name">
                {overview.organization.name}
              </span>
              <Badge variant="outline">{humanizePay03bToken(overview.organization.type)}</Badge>
              <Badge variant="outline">{humanizePay03bToken(overview.organization.status)}</Badge>
            </div>
            <p className="mt-2 text-sm text-gray-700" data-testid="pay03b-tenant-role">
              Your role in this organization: <strong>{humanizePay03bToken(overview.tenantRole)}</strong>
            </p>
            {billingAdmin ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-emerald-800" data-testid="pay03b-billing-authority">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>You are a billing administrator: you can subscribe, change or cancel the plan and manage payment.</span>
              </p>
            ) : (
              <div role="note" className="mt-2 flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" data-testid="pay03b-read-only">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  Read-only view. Only a billing administrator of {overview.organization.name} can subscribe, change or
                  cancel the plan, update the payment method or pay invoices. You can still see the plan, access and
                  invoices; ask a billing administrator of your organization if something needs to change.
                </span>
              </div>
            )}
          </section>

          <section aria-labelledby="pay03b-current-heading" className="min-w-0 space-y-3" data-testid="pay03b-current">
            <h2 id="pay03b-current-heading" className="text-lg font-semibold text-gray-950">Current plan &amp; access</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatusTile title="Paid access" testId="pay03b-access-status" tone={access ? 'positive' : 'neutral'}>
                <p className="text-base font-semibold text-gray-950" data-testid="pay03b-access-value">{access ? 'Active' : 'No paid access'}</p>
                <p className="text-sm text-gray-700" data-testid="pay03b-access-reason">{describePay03bAccessReason(entitlements.reason)}</p>
              </StatusTile>
              <StatusTile title="Plan" testId="pay03b-current-plan">
                {sub ? (
                  <>
                    <p className="font-semibold text-gray-950">{planName(sub.planCode) ?? 'Unknown plan'}</p>
                    <p className="text-sm text-gray-700" data-testid="pay03b-subscription-status">
                      Subscription: {describePay03bSubscriptionStatus(sub.status)}
                      {sub.providerStatus ? ` · provider reports ${humanizePay03bToken(sub.providerStatus)}` : ''}
                    </p>
                    {sub.simulated ? <Pay03bSimulatedLabel testId="pay03b-subscription-simulated-label" /> : null}
                  </>
                ) : (
                  <p className="font-semibold text-gray-950">No subscription</p>
                )}
              </StatusTile>
              <StatusTile title="Paid through" testId="pay03b-paid-through">
                <p className="font-semibold text-gray-950" data-testid="pay03b-paid-through-value">{paidThroughLabel ?? 'No paid period yet'}</p>
                <p className="text-sm text-gray-700" data-testid="pay03b-renewal">{renewalText}</p>
              </StatusTile>
              <StatusTile title="Published listing capacity" testId="pay03b-capacity">
                <p className="font-semibold text-gray-950" data-testid="pay03b-capacity-value">{capacityText}</p>
                <p className="text-sm text-gray-700">{capacityNote}</p>
              </StatusTile>
            </div>

            {sub?.scheduledPlanChange ? (
              <div role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 [overflow-wrap:anywhere]" data-testid="pay03b-scheduled-change">
                Plan change scheduled: the current paid period is on {planName(sub.paidPlanCode) ?? 'your previous plan'};{' '}
                {planName(sub.planCode) ?? 'the new plan'} applies from the next billing period.
              </div>
            ) : null}
            {entitlements.reason === 'approved_grace_period' ? (
              <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="pay03b-grace-notice">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  A renewal payment is past due. Access continues during the approved grace period
                  {formatPay03bDateTime(entitlements.graceUntil ?? sub?.graceUntil) ? ` until ${formatPay03bDateTime(entitlements.graceUntil ?? sub?.graceUntil)}` : ''}.
                  Pay the open invoice below to keep access after that.
                </span>
              </div>
            ) : null}
            {entitlements.reason === 'payment_reconciliation_hold' ? (
              <div role="status" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-testid="pay03b-hold-notice">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{PAY03B_RECONCILIATION_HOLD_TEXT}. CarUp reviews it against the provider’s records.</span>
              </div>
            ) : null}
            {suspensionText ? (
              <div role="status" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="pay03b-suspension-notice">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{suspensionText}</span>
              </div>
            ) : null}
            {sub?.status === 'incomplete' && !pendingVisible ? (
              <div role="status" className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" data-testid="pay03b-incomplete-notice">
                <p>
                  A checkout for {planName(sub.planCode) ?? 'a plan'} was started
                  {formatPay03bDateTime(sub.createdAt) ? ` on ${formatPay03bDateTime(sub.createdAt)}` : ''}, but CarUp has not
                  confirmed a payment. If you completed payment at the provider, check the payment status. An unfinished
                  checkout stays open at the provider until it expires; a new checkout can be started after that.
                </p>
                <Button size="sm" variant="outline" onClick={() => void recheckPayment()} data-testid="pay03b-verify">
                  Check payment status
                </Button>
              </div>
            ) : null}

            {billingAdmin && changeable && sub ? (
              <div className="flex flex-wrap gap-2" data-testid="pay03b-subscription-actions">
                {sub.cancelAtPeriodEnd ? (
                  <Button variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => openConfirm('resume')} data-testid="pay03b-resume">
                    Resume renewal
                  </Button>
                ) : currentPlan?.cancellationPolicy?.period_end !== false ? (
                  <Button variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => openConfirm('period_end')} data-testid="pay03b-cancel-period-end">
                    Cancel at period end
                  </Button>
                ) : null}
                {currentPlan?.cancellationPolicy?.immediate === true ? (
                  <Button
                    variant="outline"
                    className="h-auto min-h-9 whitespace-normal border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => openConfirm('immediate')}
                    data-testid="pay03b-cancel-immediate"
                  >
                    Cancel immediately
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-auto min-h-9 whitespace-normal"
                  disabled={redirectBusy !== null}
                  onClick={() => void goToProvider('payment-method', createPay03bPaymentMethodUpdate)}
                  data-testid="pay03b-update-payment-method"
                >
                  {redirectBusy === 'payment-method' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Update payment method
                </Button>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="pay03b-plans-heading" className="min-w-0 space-y-3" data-testid="pay03b-plans">
            <div>
              <h2 id="pay03b-plans-heading" className="text-lg font-semibold text-gray-950">Plans</h2>
              <p className="text-sm text-gray-600">
                No paid dealership plan has an approved commercial price yet.
                {hasSandboxPlans ? ' Sandbox test plans exist only for testing in this environment and are not offers.' : ''}
              </p>
              {hasSandboxPlans && overview.providerMode === 'local_simulator' ? (
                <p className="mt-1 text-xs text-violet-900" data-testid="pay03b-provider-mode">
                  Checkout in this environment uses the simulated provider (local test) — not Stripe.
                </p>
              ) : null}
            </div>
            {plans.length === 0 ? (
              <p className="rounded-md border bg-white p-4 text-sm text-gray-600" data-testid="pay03b-plans-empty">
                No dealership plans are published yet.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan) => {
                  const kind = pay03bCommercialKind(plan)
                  const isCurrent = Boolean(sub && live && sub.planId === plan.id)
                  const canSubscribe = billingAdmin && !live && kind === 'sandbox' && plan.purchasable
                  // Unknown current plan (e.g. its version was retired): offer nothing rather than guess its terms.
                  const changeModes = billingAdmin && changeable && currentPlan && kind === 'sandbox' && plan.purchasable && !isCurrent
                    ? pay03bAllowedChangeModes(currentPlan, plan)
                    : null
                  return (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      isCurrent={isCurrent}
                      canSubscribe={canSubscribe}
                      changeModes={changeModes}
                      onSubscribe={openTerms}
                      onChange={(target) => {
                        setNotice(null)
                        setActionError(null)
                        setChangeTarget(target)
                      }}
                    />
                  )
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="pay03b-invoices-heading" className="min-w-0 space-y-3" data-testid="pay03b-invoices">
            <div>
              <h2 id="pay03b-invoices-heading" className="text-lg font-semibold text-gray-950">Invoices</h2>
              <p className="text-sm text-gray-600">
                The provider invoice and CarUp’s payment record are shown separately. A period counts as paid only when
                CarUp’s payment record confirms it.
              </p>
            </div>
            {overview.invoices.length === 0 ? (
              <p className="rounded-md border bg-white p-4 text-sm text-gray-600" data-testid="pay03b-invoices-empty">
                No invoices yet.
              </p>
            ) : (
              <div className="min-w-0 rounded-lg border bg-white p-2 md:p-3">
                <Pay03bInvoicesTable
                  invoices={overview.invoices}
                  testIdPrefix="pay03b"
                  label="Subscription invoices"
                  renderAction={billingAdmin ? (invoice) => (invoice.providerStatus === 'open' ? (
                    <Button
                      size="sm"
                      className="h-auto min-h-8 whitespace-normal"
                      disabled={redirectBusy !== null}
                      onClick={() => void goToProvider(invoice.id, () => getPay03bInvoicePaymentLink(invoice.id))}
                      data-testid={`pay03b-pay-invoice-${invoice.providerInvoiceId}`}
                    >
                      {redirectBusy === invoice.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      Pay outstanding invoice
                    </Button>
                  ) : null) : undefined}
                />
              </div>
            )}
          </section>

          {overview.history.length > 0 ? (
            <section aria-labelledby="pay03b-history-heading" className="min-w-0 space-y-2" data-testid="pay03b-history">
              <h2 id="pay03b-history-heading" className="text-lg font-semibold text-gray-950">Earlier subscriptions</h2>
              <ul className="space-y-2">
                {overview.history.map((previous) => (
                  <li key={previous.id} className="rounded-md border bg-white p-3 text-sm text-gray-700 [overflow-wrap:anywhere]" data-testid={`pay03b-history-${previous.id}`}>
                    <span className="font-medium text-gray-950">{planName(previous.planCode) ?? 'Unknown plan'}</span>
                    {' · '}{describePay03bSubscriptionStatus(previous.status)}
                    {formatPay03bDateTime(previous.createdAt) ? ` · started ${formatPay03bDateTime(previous.createdAt)}` : ''}
                    {formatPay03bDateTime(previous.endedAt ?? previous.canceledAt) ? ` · ended ${formatPay03bDateTime(previous.endedAt ?? previous.canceledAt)}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {termsIntent ? (
        <TermsReviewDialog
          key={termsIntent.key}
          intent={termsIntent}
          continuingPaidThrough={access && !live ? paidThroughLabel : null}
          onClose={() => setTermsIntent(null)}
          onAttempt={rememberAttempt}
          onDone={forgetAttempt}
          onTermsChanged={reloadAfterTermsChange}
          createCheckout={createPay03bDealerCheckout}
        />
      ) : null}
      {changeTarget && currentPlan ? (
        <ChangePlanDialog
          key={changeTarget.id}
          target={changeTarget}
          currentPlan={currentPlan}
          modes={pay03bAllowedChangeModes(currentPlan, changeTarget)}
          keyFor={keyFor}
          onAttempt={rememberAttempt}
          onDone={forgetAttempt}
          onClose={() => setChangeTarget(null)}
          onChanged={onChanged}
          onTermsChanged={reloadAfterTermsChange}
          previewChange={previewPay03bPlanChange}
          changePlan={changePay03bDealerPlan}
        />
      ) : null}
      {confirmIntent && sub ? (
        <ConfirmActionDialog
          key={confirmIntent.key}
          intent={confirmIntent}
          subscription={sub}
          currentPlan={currentPlan}
          paidThroughLabel={paidThroughLabel}
          onAttempt={rememberAttempt}
          onDone={forgetAttempt}
          onClose={() => setConfirmIntent(null)}
          onCompleted={onCancelCompleted}
          cancelSubscription={cancelPay03bDealerSubscription}
        />
      ) : null}
    </div>
  )
}
