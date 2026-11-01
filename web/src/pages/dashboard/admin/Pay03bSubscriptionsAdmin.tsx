/**
 * CARUP-PAY-03B — administrator sections of the commercial console (/admin/commercial-foundation):
 *  1. Payment reconciliation exceptions (F5) — list, verify with the provider, acknowledge, resolve.
 *  2. Business subscriptions — list, detail (invoices + payment status, transitions, change requests,
 *     entitlements) and the governed actions: reconcile, suspend / resume with reason, refund an invoice.
 *  3. Subscription plan governance — every plan version with pricing kind, activation status and blocker.
 *
 * Follows the console's established patterns: reads go through apiRequest with the console's own
 * session headers (via the PAY-03B client module), and a failed read is an explicit role="alert" — an
 * administrator must never read a failed or forbidden read as "nothing exists". Every consequential
 * action states its effect and asks for a reason before anything is sent.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Scale, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { AuthHeaders } from '@/lib/apiClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pay03bInvoicesTable } from '@/components/pay03b/Pay03bInvoicesTable'
import { Pay03bSandboxLabel, Pay03bSimulatedLabel } from '@/components/pay03b/Pay03bLabels'
import {
  acknowledgePay03bReconciliationException,
  createPay03bIdempotencyKey,
  fetchPay03bAdminCatalogue,
  fetchPay03bAdminSubscription,
  fetchPay03bAdminSubscriptions,
  fetchPay03bReconciliationException,
  fetchPay03bReconciliationExceptions,
  reconcilePay03bAdminSubscription,
  refundPay03bAdminInvoice,
  resolvePay03bReconciliationException,
  setPay03bAdminSuspension,
  type Pay03bClientConfig,
} from '@/lib/pay03bApi'
import {
  PAY03B_LISTING_CAPACITY_KEY,
  PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL,
  describePay03bAccessReason,
  describePay03bError,
  describePay03bPaymentStatus,
  describePay03bSubscriptionStatus,
  formatPay03bDateTime,
  formatPay03bInterval,
  formatPay03bMinor,
  humanizePay03bToken,
  pay03bCommercialKind,
  pay03bCommercialLabel,
  type Pay03bErrorDescription,
} from '@/lib/pay03bDisplay'
import type {
  Pay03bAdminSubscriptionDetail,
  Pay03bAdminSubscriptionRow,
  Pay03bExceptionStatusFilter,
  Pay03bInvoice,
  Pay03bPlan,
  Pay03bProviderTruth,
  Pay03bReconciliationException,
  Pay03bResolution,
  Pay03bSuspensionAction,
} from '@/types/pay03b'

export interface Pay03bReconciliationSummary {
  /** Open exceptions per the last successful read; null when unknown. */
  openCount: number | null
  /** Set when the last read FAILED — the open count is then unknown, never zero. */
  error: string | null
}

export interface Pay03bSubscriptionsAdminProps {
  baseUrl: string
  getAuthHeaders: () => AuthHeaders
  onReconciliationSummary?: (summary: Pay03bReconciliationSummary) => void
}

const MIN_REASON = 10
const MAX_NOTE = 1000

const RESOLUTIONS: Array<{ value: Pay03bResolution; title: string; detail: string }> = [
  {
    value: 'restore_access_provider_unrefunded',
    title: 'Restore access — the provider shows the payment as not refunded',
    detail: 'Use when the provider no longer shows a refund against this payment. CarUp re-reads the provider and refuses if that is not true.',
  },
  {
    value: 'revoke_access_partial_refund_final',
    title: 'Revoke access — the partial refund is final',
    detail: 'Use when a partial refund has settled and stands. The paid coverage this payment bought is revoked. CarUp re-reads the provider and refuses unless a settled partial refund is shown.',
  },
]

function ErrorBox({ error, testId, children }: { error: Pay03bErrorDescription; testId: string; children?: ReactNode }) {
  return (
    <div role="alert" data-testid={testId} className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 [overflow-wrap:anywhere]">
      <p>
        {error.message}
        {error.code ? <span className="ml-1 font-mono">({error.code})</span> : null}
      </p>
      {children}
    </div>
  )
}

function StatusBox({ message, testId }: { message: string; testId: string }) {
  return (
    <div role="status" data-testid={testId} className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900 [overflow-wrap:anywhere]">
      {message}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-slate-800 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function MobileLabel({ children }: { children: ReactNode }) {
  return <span className="w-28 shrink-0 text-xs font-medium text-slate-500 md:hidden">{children}</span>
}

const cellClass = 'whitespace-normal align-top max-md:flex max-md:gap-2 max-md:px-1 max-md:py-1'

function ProviderLabel({ simulated, gateway }: { simulated?: boolean; gateway?: string | null }) {
  if (simulated || gateway === 'pay03b_local_provider_simulator') return <Pay03bSimulatedLabel testId="pay03b-admin-simulated-label" />
  return <span className="text-xs text-slate-600">{PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL}</span>
}

// ------------------------------------------------------------------------------------------ dialogs

function ReasonField({ id, value, onChange, max = 500, testId }: {
  id: string
  value: string
  onChange: (value: string) => void
  max?: number
  testId: string
}) {
  const length = value.trim().length
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Reason (at least {MIN_REASON} characters, recorded in the audit log)</Label>
      <Textarea id={id} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
      <p className={`text-xs ${length >= MIN_REASON ? 'text-slate-500' : 'text-amber-700'}`}>
        {length} / {MIN_REASON} characters minimum
      </p>
    </div>
  )
}

function SuspensionDialog({ subscription, action, idempotencyKey, submit, onClose, onDone }: {
  subscription: Pay03bAdminSubscriptionDetail['subscription']
  action: Pay03bSuspensionAction
  idempotencyKey: string
  submit: (reason: string, idempotencyKey: string) => Promise<Pay03bAdminSubscriptionDetail>
  onClose: () => void
  onDone: (detail: Pay03bAdminSubscriptionDetail, action: Pay03bSuspensionAction) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const valid = reason.trim().length >= MIN_REASON

  const confirm = async () => {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    try {
      onDone(await submit(reason, idempotencyKey), action)
    } catch (err) {
      setError(describePay03bError(err, 'The suspension change was not applied.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-admin-suspension-dialog">
        <DialogHeader>
          <DialogTitle>{action === 'suspend' ? 'Suspend this subscription?' : 'Lift the administrator suspension?'}</DialogTitle>
          <DialogDescription>
            {action === 'suspend'
              ? 'Paid access for this organization stops immediately. The provider subscription is not changed, and the provider can never lift an administrator suspension.'
              : `The subscription returns to the status the provider last reported (${humanizePay03bToken(subscription.providerStatus)}). Access again follows confirmed paid periods only.`}
          </DialogDescription>
        </DialogHeader>
        <ReasonField id="pay03b-admin-suspension-reason" value={reason} onChange={setReason} testId="pay03b-admin-suspension-reason" />
        {error ? <ErrorBox error={error} testId="pay03b-admin-suspension-error" /> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant={action === 'suspend' ? 'destructive' : 'default'}
            disabled={busy || !valid}
            onClick={() => void confirm()}
            data-testid="pay03b-admin-suspension-confirm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {action === 'suspend' ? 'Suspend subscription' : 'Lift suspension'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RefundDialog({ invoice, submit, onClose, onDone }: {
  invoice: Pay03bInvoice
  submit: (reason: string) => Promise<Pay03bAdminSubscriptionDetail>
  onClose: () => void
  onDone: (detail: Pay03bAdminSubscriptionDetail, invoice: Pay03bInvoice) => void
}) {
  const [reason, setReason] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const valid = reason.trim().length >= MIN_REASON && understood
  const amount = formatPay03bMinor(invoice.amountDueMinor, invoice.currency)

  const confirm = async () => {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    try {
      onDone(await submit(reason), invoice)
    } catch (err) {
      setError(describePay03bError(err, 'The refund was not completed.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-admin-refund-dialog">
        <DialogHeader>
          <DialogTitle>Refund this invoice payment?</DialogTitle>
          <DialogDescription data-testid="pay03b-admin-refund-effect">
            A governed FULL refund of {amount ?? 'this invoice'} for invoice {invoice.providerInvoiceId}. The provider refunds
            that invoice’s payment and the paid coverage of its period ({formatPay03bDateTime(invoice.periodStart) ?? '—'} –{' '}
            {formatPay03bDateTime(invoice.periodEnd) ?? '—'}) ends. The request is audited before the provider is called.
          </DialogDescription>
        </DialogHeader>
        <ReasonField id="pay03b-admin-refund-reason" value={reason} onChange={setReason} testId="pay03b-admin-refund-reason" />
        <label className="flex items-start gap-2 text-sm" htmlFor="pay03b-admin-refund-understood">
          <input
            id="pay03b-admin-refund-understood"
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            className="mt-1"
            data-testid="pay03b-admin-refund-understood"
          />
          <span>I understand this refunds the full invoice payment and ends that period’s paid coverage.</span>
        </label>
        {error ? <ErrorBox error={error} testId="pay03b-admin-refund-error" /> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="destructive" disabled={busy || !valid} onClick={() => void confirm()} data-testid="pay03b-admin-refund-confirm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Refund invoice payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResolveDialog({ exception, submit, onClose, onDone }: {
  exception: Pay03bReconciliationException
  submit: (resolution: Pay03bResolution, note: string) => Promise<{ paymentStatus: string; entitlementStatus: string | null; providerTruth: Pay03bProviderTruth; exception: Pay03bReconciliationException }>
  onClose: () => void
  onDone: (result: { paymentStatus: string; entitlementStatus: string | null; providerTruth: Pay03bProviderTruth; exception: Pay03bReconciliationException }) => void
}) {
  const [resolution, setResolution] = useState<Pay03bResolution | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Pay03bErrorDescription | null>(null)
  const noteLength = note.trim().length
  const valid = resolution !== null && noteLength >= MIN_REASON && noteLength <= MAX_NOTE

  const confirm = async () => {
    if (busy || !valid || !resolution) return
    setBusy(true)
    setError(null)
    try {
      onDone(await submit(resolution, note))
    } catch (err) {
      setError(describePay03bError(err, 'The exception was not resolved.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="pay03b-admin-resolve-dialog">
        <DialogHeader>
          <DialogTitle>Resolve reconciliation exception</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            Payment {exception.paymentReference}. CarUp performs a fresh provider read and refuses any resolution that the
            provider’s current state does not support. The request is audited before the provider is read.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Resolution</legend>
          {RESOLUTIONS.map((option) => (
            <label key={option.value} htmlFor={`pay03b-admin-resolution-${option.value}`} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input
                type="radio"
                id={`pay03b-admin-resolution-${option.value}`}
                name="pay03b-admin-resolution"
                value={option.value}
                checked={resolution === option.value}
                onChange={() => setResolution(option.value)}
                className="mt-1"
                data-testid={`pay03b-admin-resolution-${option.value}`}
              />
              <span className="min-w-0">
                <span className="block font-medium">{option.title}</span>
                <span className="block text-xs text-slate-600">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="pay03b-admin-resolve-note">Resolution note ({MIN_REASON}–{MAX_NOTE} characters, audited)</Label>
          <Textarea id="pay03b-admin-resolve-note" value={note} maxLength={MAX_NOTE} onChange={(event) => setNote(event.target.value)} data-testid="pay03b-admin-resolve-note" />
          <p className={`text-xs ${noteLength >= MIN_REASON ? 'text-slate-500' : 'text-amber-700'}`}>{noteLength} / {MIN_REASON} characters minimum</p>
        </div>
        {error ? <ErrorBox error={error} testId="pay03b-admin-resolve-error" /> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={busy || !valid} onClick={() => void confirm()} data-testid="pay03b-admin-resolve-confirm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Resolve with fresh provider evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------ main

type VerificationResult = { truth: Pay03bProviderTruth | null } | { error: Pay03bErrorDescription }

export default function Pay03bSubscriptionsAdmin({ baseUrl, getAuthHeaders, onReconciliationSummary }: Pay03bSubscriptionsAdminProps) {
  const configFor = useCallback((): Pay03bClientConfig => ({ baseUrl, authHeaders: getAuthHeaders() }), [baseUrl, getAuthHeaders])

  // F5 reconciliation exceptions
  const [exceptionFilter, setExceptionFilter] = useState<Pay03bExceptionStatusFilter>('open')
  const [exceptions, setExceptions] = useState<Pay03bReconciliationException[]>([])
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [exceptionsLoaded, setExceptionsLoaded] = useState(false)
  const [exceptionsLoading, setExceptionsLoading] = useState(true)
  const [exceptionsError, setExceptionsError] = useState<Pay03bErrorDescription | null>(null)
  const [financialTruth, setFinancialTruth] = useState<string | null>(null)
  const [verifications, setVerifications] = useState<Record<string, VerificationResult>>({})
  const [exceptionBusy, setExceptionBusy] = useState<string | null>(null)
  const [exceptionMessage, setExceptionMessage] = useState<string | null>(null)
  const [exceptionActionError, setExceptionActionError] = useState<Pay03bErrorDescription | null>(null)
  const [resolveTarget, setResolveTarget] = useState<Pay03bReconciliationException | null>(null)

  // Business subscriptions
  const [subscriptions, setSubscriptions] = useState<Pay03bAdminSubscriptionRow[]>([])
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false)
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true)
  const [subscriptionsError, setSubscriptionsError] = useState<Pay03bErrorDescription | null>(null)
  const [sourceOfTruth, setSourceOfTruth] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Pay03bAdminSubscriptionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<Pay03bErrorDescription | null>(null)
  const [subscriptionBusy, setSubscriptionBusy] = useState<string | null>(null)
  const [subscriptionMessage, setSubscriptionMessage] = useState<string | null>(null)
  const [subscriptionActionError, setSubscriptionActionError] = useState<Pay03bErrorDescription | null>(null)
  const [suspensionIntent, setSuspensionIntent] = useState<{ action: Pay03bSuspensionAction; key: string } | null>(null)
  const [refundTarget, setRefundTarget] = useState<Pay03bInvoice | null>(null)
  const latestDetailRequest = useRef<string | null>(null)

  // Plan governance
  const [plans, setPlans] = useState<Pay03bPlan[]>([])
  const [plansLoaded, setPlansLoaded] = useState(false)
  const [plansError, setPlansError] = useState<Pay03bErrorDescription | null>(null)

  const loadExceptions = useCallback(async (status: Pay03bExceptionStatusFilter) => {
    try {
      const res = await fetchPay03bReconciliationExceptions(configFor(), status)
      setExceptions(res.exceptions)
      setOpenCount(res.openCount)
      setFinancialTruth(res.sourceOfFinancialTruth || null)
      setExceptionsError(null)
      setExceptionsLoaded(true)
      onReconciliationSummary?.({ openCount: res.openCount, error: null })
    } catch (err) {
      const described = describePay03bError(err, 'Reconciliation exceptions could not be loaded.')
      setExceptionsError(described)
      onReconciliationSummary?.({ openCount: null, error: described.code ?? described.message })
    } finally {
      setExceptionsLoading(false)
    }
  }, [configFor, onReconciliationSummary])

  const loadSubscriptions = useCallback(async () => {
    try {
      const res = await fetchPay03bAdminSubscriptions(configFor())
      setSubscriptions(res.subscriptions)
      setSourceOfTruth(res.sourceOfTruth || null)
      setSubscriptionsError(null)
      setSubscriptionsLoaded(true)
    } catch (err) {
      setSubscriptionsError(describePay03bError(err, 'Business subscriptions could not be loaded.'))
    } finally {
      setSubscriptionsLoading(false)
    }
  }, [configFor])

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetchPay03bAdminCatalogue(configFor())
      setPlans(res.plans)
      setPlansError(null)
      setPlansLoaded(true)
    } catch (err) {
      setPlansError(describePay03bError(err, 'Subscription plan governance could not be loaded.'))
    }
  }, [configFor])

  useEffect(() => {
    void loadSubscriptions()
    void loadPlans()
  }, [loadSubscriptions, loadPlans])

  useEffect(() => {
    void loadExceptions(exceptionFilter)
  }, [loadExceptions, exceptionFilter])

  const planLabel = (planId: string | null | undefined) => {
    if (!planId) return '—'
    const plan = plans.find((p) => p.id === planId)
    return plan ? `${plan.planCode} v${plan.planVersion}` : planId
  }

  // ---------------------------------------------------------------- F5 actions
  const changeExceptionFilter = (next: Pay03bExceptionStatusFilter) => {
    if (next === exceptionFilter) return
    setExceptionsLoading(true)
    setExceptionFilter(next)
  }

  const refreshExceptions = () => {
    setExceptionsLoading(true)
    void loadExceptions(exceptionFilter)
  }

  const verifyException = async (exception: Pay03bReconciliationException) => {
    if (exceptionBusy) return
    setExceptionBusy(`verify:${exception.id}`)
    setExceptionActionError(null)
    try {
      const res = await fetchPay03bReconciliationException(configFor(), exception.id, { verify: true })
      setVerifications((prev) => ({ ...prev, [exception.id]: { truth: res.providerTruth } }))
      setExceptions((prev) => prev.map((row) => (row.id === exception.id ? res.exception : row)))
    } catch (err) {
      setVerifications((prev) => ({ ...prev, [exception.id]: { error: describePay03bError(err, 'The provider could not be read.') } }))
    } finally {
      setExceptionBusy(null)
    }
  }

  const acknowledgeException = async (exception: Pay03bReconciliationException) => {
    if (exceptionBusy) return
    setExceptionBusy(`ack:${exception.id}`)
    setExceptionActionError(null)
    setExceptionMessage(null)
    try {
      const res = await acknowledgePay03bReconciliationException(configFor(), exception.id)
      setExceptions((prev) => prev.map((row) => (row.id === exception.id ? res.exception : row)))
      setExceptionMessage(`Exception for ${exception.paymentReference} acknowledged. Paid access stays held until it is resolved.`)
    } catch (err) {
      setExceptionActionError(describePay03bError(err, 'The exception was not acknowledged.'))
    } finally {
      setExceptionBusy(null)
    }
  }

  // ---------------------------------------------------------------- subscription actions
  const inspectSubscription = async (subscriptionId: string) => {
    latestDetailRequest.current = subscriptionId
    setSelectedId(subscriptionId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setSubscriptionMessage(null)
    setSubscriptionActionError(null)
    try {
      const res = await fetchPay03bAdminSubscription(configFor(), subscriptionId)
      if (latestDetailRequest.current === subscriptionId) setDetail(res)
    } catch (err) {
      if (latestDetailRequest.current === subscriptionId) {
        setDetailError(describePay03bError(err, 'The subscription detail could not be loaded.'))
      }
    } finally {
      if (latestDetailRequest.current === subscriptionId) setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    latestDetailRequest.current = null
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
  }

  const refreshSubscriptions = () => {
    setSubscriptionsLoading(true)
    void loadSubscriptions()
  }

  const reconcileSubscription = async () => {
    if (!detail || subscriptionBusy) return
    const subscriptionId = detail.subscription.id
    setSubscriptionBusy('reconcile')
    setSubscriptionActionError(null)
    setSubscriptionMessage(null)
    try {
      const res = await reconcilePay03bAdminSubscription(configFor(), subscriptionId)
      if (latestDetailRequest.current === subscriptionId) setDetail(res)
      const synced = res.result?.invoicesSynced
      setSubscriptionMessage(
        `Provider re-read into the canonical authority: ${humanizePay03bToken(res.result?.state ?? 'completed')}`
        + `${typeof synced === 'number' ? ` (${synced} invoice${synced === 1 ? '' : 's'} synchronised)` : ''}.`,
      )
      void loadSubscriptions()
    } catch (err) {
      setSubscriptionActionError(describePay03bError(err, 'The provider re-read did not complete.'))
    } finally {
      setSubscriptionBusy(null)
    }
  }

  const onSuspensionDone = (res: Pay03bAdminSubscriptionDetail, action: Pay03bSuspensionAction) => {
    setSuspensionIntent(null)
    if (latestDetailRequest.current === res.subscription.id) setDetail(res)
    setSubscriptionMessage(action === 'suspend'
      ? 'Subscription suspended by an administrator. Paid access is suspended.'
      : `Administrator suspension lifted. Status is now ${describePay03bSubscriptionStatus(res.subscription.status)}.`)
    void loadSubscriptions()
  }

  const onRefundDone = (res: Pay03bAdminSubscriptionDetail, invoice: Pay03bInvoice) => {
    setRefundTarget(null)
    if (latestDetailRequest.current === res.subscription.id) setDetail(res)
    const updated = res.invoices.find((row) => row.id === invoice.id)
    setSubscriptionMessage(
      `Governed refund recorded for invoice ${invoice.providerInvoiceId}. CarUp payment record: ${describePay03bPaymentStatus(updated?.paymentStatus ?? null)}.`,
    )
    void loadSubscriptions()
  }

  const onResolved = (result: { paymentStatus: string; entitlementStatus: string | null; providerTruth: Pay03bProviderTruth; exception: Pay03bReconciliationException }) => {
    setResolveTarget(null)
    setExceptions((prev) => prev.map((row) => (row.id === result.exception.id ? result.exception : row)))
    setExceptionMessage(
      `Exception for ${result.exception.paymentReference} resolved (${humanizePay03bToken(result.exception.resolution)}). `
      + `Payment status: ${describePay03bPaymentStatus(result.paymentStatus)}; entitlement: ${humanizePay03bToken(result.entitlementStatus)}; `
      + `provider verified ${humanizePay03bToken(result.providerTruth?.status)} at ${formatPay03bDateTime(result.providerTruth?.verifiedAt) ?? '—'}.`,
    )
    setExceptionsLoading(true)
    void loadExceptions(exceptionFilter)
  }

  const subscription = detail?.subscription ?? null
  const adminSuspended = subscription?.suspendedReason === 'admin_suspension'
  const detailCapacity = detail?.entitlements?.effective?.[PAY03B_LISTING_CAPACITY_KEY]

  return (
    <section className="space-y-6" aria-label="Dealer & Business subscriptions (PAY-03B)" data-testid="pay03b-admin-sections">
      {/* ---------------------------------------------------------------- F5 */}
      <Card id="pay03b-admin-f5" data-testid="pay03b-admin-f5">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="h-5 w-5 shrink-0 text-slate-700" aria-hidden="true" />
                Payment reconciliation exceptions (F5)
              </CardTitle>
              <CardDescription>
                Canonical payments whose provider state no longer matches CarUp’s record (for example a refund made outside
                CarUp). Paid access bought by a held payment stays suspended until an administrator resolves it against a
                fresh provider read.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter reconciliation exceptions by status"
                className="rounded-md border bg-white px-2.5 py-1.5 text-xs"
                value={exceptionFilter}
                onChange={(event) => changeExceptionFilter(event.target.value as Pay03bExceptionStatusFilter)}
                data-testid="pay03b-admin-f5-filter"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="superseded">Superseded</option>
                <option value="all">All</option>
              </select>
              <Button size="sm" variant="outline" disabled={exceptionsLoading} onClick={refreshExceptions} data-testid="pay03b-admin-f5-refresh">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${exceptionsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {exceptionsError ? (
            <ErrorBox error={exceptionsError} testId="pay03b-admin-f5-error">
              <p className="mt-1">
                {exceptions.length > 0
                  ? 'The exceptions below may be stale — refresh before acting on them.'
                  : 'This is a read failure, not an empty queue — do not infer that no exceptions exist.'}
              </p>
            </ErrorBox>
          ) : null}
          {openCount !== null && !exceptionsError ? (
            <p className="font-medium text-slate-700" data-testid="pay03b-admin-f5-open-count">Open exceptions: {openCount}</p>
          ) : null}
          {exceptionMessage ? <StatusBox message={exceptionMessage} testId="pay03b-admin-f5-status" /> : null}
          {exceptionActionError ? <ErrorBox error={exceptionActionError} testId="pay03b-admin-f5-action-error" /> : null}
          {exceptions.length === 0 ? (
            exceptionsError ? null : exceptionsLoaded && !exceptionsLoading ? (
              <p className="text-slate-500" data-testid="pay03b-admin-f5-empty">
                No {exceptionFilter === 'all' ? '' : `${exceptionFilter} `}reconciliation exceptions.
              </p>
            ) : (
              <p className="text-slate-500" data-testid="pay03b-admin-f5-loading">Loading reconciliation exceptions…</p>
            )
          ) : (
            exceptions.map((exception) => {
              const verification = verifications[exception.id]
              const open = exception.status === 'open'
              return (
                <article key={exception.id} className="min-w-0 space-y-2 rounded-xl border bg-white p-3" data-testid={`pay03b-admin-exception-${exception.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-mono font-semibold text-slate-900 [overflow-wrap:anywhere]">{exception.paymentReference}</span>
                    <Badge className={open ? 'bg-red-700 text-white' : 'bg-slate-700 text-white'}>{humanizePay03bToken(exception.status)}</Badge>
                    <Badge variant="outline">Severity: {humanizePay03bToken(exception.severity)}</Badge>
                    {exception.mismatch ? <Badge variant="outline" className="whitespace-normal">{humanizePay03bToken(exception.mismatch)}</Badge> : null}
                  </div>
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Payment amount">{formatPay03bMinor(exception.paymentAmountMinor, exception.currency) ?? '—'}</Field>
                    <Field label="Detected refunded / pending">
                      {formatPay03bMinor(exception.detectedRefundedMinor, exception.currency) ?? '—'} /{' '}
                      {formatPay03bMinor(exception.detectedPendingRefundMinor, exception.currency) ?? '—'}
                    </Field>
                    <Field label="Refund IDs">{exception.detectedRefundIds.length ? exception.detectedRefundIds.join(', ') : '—'}</Field>
                    <Field label="Detected via">
                      {humanizePay03bToken(exception.detectedVia)} · {formatPay03bDateTime(exception.firstDetectedAt) ?? '—'}
                    </Field>
                    <Field label="Observations">{exception.observationCount}</Field>
                    <Field label="Last observed">
                      {humanizePay03bToken(exception.lastObservedStatus)}
                      {exception.lastObservedRefundedMinor !== null
                        ? ` · refunded ${formatPay03bMinor(exception.lastObservedRefundedMinor, exception.currency)}`
                        : ''}
                    </Field>
                    <Field label="Acknowledged">
                      {exception.acknowledgedAt ? `${exception.acknowledgedBy ?? '—'} · ${formatPay03bDateTime(exception.acknowledgedAt)}` : 'Not yet'}
                    </Field>
                    <Field label="Resolution">
                      {exception.resolution
                        ? `${humanizePay03bToken(exception.resolution)} · ${exception.resolvedBy ?? '—'} · ${formatPay03bDateTime(exception.resolvedAt) ?? '—'}`
                        : 'Unresolved'}
                    </Field>
                  </dl>
                  {exception.resolutionNote ? <p className="text-slate-600 [overflow-wrap:anywhere]">Note: {exception.resolutionNote}</p> : null}
                  {verification ? (
                    'error' in verification ? (
                      <ErrorBox error={verification.error} testId={`pay03b-admin-exception-truth-error-${exception.id}`} />
                    ) : (
                      <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-950" data-testid={`pay03b-admin-exception-truth-${exception.id}`}>
                        {verification.truth ? (
                          <>
                            Provider now reports <strong>{humanizePay03bToken(verification.truth.status)}</strong>: refunded{' '}
                            {formatPay03bMinor(verification.truth.refundedMinor, exception.currency) ?? '—'}, pending refund{' '}
                            {formatPay03bMinor(verification.truth.pendingRefundMinor, exception.currency) ?? '—'}
                            {verification.truth.refundIds?.length ? ` (refunds ${verification.truth.refundIds.join(', ')})` : ''}
                            {' '}· verified {formatPay03bDateTime(verification.truth.verifiedAt) ?? '—'}
                          </>
                        ) : (
                          'The provider returned no verification for this exception.'
                        )}
                      </div>
                    )
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={exceptionBusy !== null}
                      onClick={() => void verifyException(exception)}
                      data-testid={`pay03b-admin-verify-${exception.id}`}
                    >
                      {exceptionBusy === `verify:${exception.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      Verify with provider
                    </Button>
                    {open && !exception.acknowledgedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={exceptionBusy !== null}
                        onClick={() => void acknowledgeException(exception)}
                        data-testid={`pay03b-admin-acknowledge-${exception.id}`}
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                    {open ? (
                      <Button
                        size="sm"
                        disabled={exceptionBusy !== null}
                        onClick={() => {
                          setExceptionMessage(null)
                          setExceptionActionError(null)
                          setResolveTarget(exception)
                        }}
                        data-testid={`pay03b-admin-resolve-${exception.id}`}
                      >
                        Resolve…
                      </Button>
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
          {financialTruth ? <p className="text-slate-500 [overflow-wrap:anywhere]">Source of financial truth: {financialTruth}</p> : null}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- subscriptions */}
      <Card data-testid="pay03b-admin-subscriptions">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-lg">Business subscriptions ({subscriptions.length})</CardTitle>
              <CardDescription>
                Dealer and garage subscription agreements. Access is derived from confirmed paid periods only; provider
                status alone never grants it.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" disabled={subscriptionsLoading} onClick={refreshSubscriptions} data-testid="pay03b-admin-subscriptions-refresh">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${subscriptionsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {subscriptionsError ? (
            <ErrorBox error={subscriptionsError} testId="pay03b-admin-subscriptions-error">
              <p className="mt-1">
                {subscriptions.length > 0
                  ? 'The subscriptions below may be stale — refresh before acting on them.'
                  : 'This is a read failure, not an empty subscription book — do not infer that no subscriptions exist.'}
              </p>
            </ErrorBox>
          ) : null}
          {subscriptions.length === 0 ? (
            subscriptionsError ? null : subscriptionsLoaded && !subscriptionsLoading ? (
              <p className="text-slate-500" data-testid="pay03b-admin-subscriptions-empty">No business subscriptions recorded in this environment yet.</p>
            ) : (
              <p className="text-slate-500" data-testid="pay03b-admin-subscriptions-loading">Loading business subscriptions…</p>
            )
          ) : (
            subscriptions.map((row) => (
              <div
                key={row.id}
                className={`flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border bg-white p-3 ${selectedId === row.id ? 'border-orange-300 ring-1 ring-orange-200' : ''}`}
                data-testid={`pay03b-admin-subscription-${row.id}`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-semibold text-slate-900 [overflow-wrap:anywhere]">{row.organizationName ?? row.ownerOrganizationId ?? 'Unknown organization'}</span>
                    <Badge variant="outline">{describePay03bSubscriptionStatus(row.status)}</Badge>
                    <Badge className={row.access ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-white'} data-testid={`pay03b-admin-subscription-access-${row.id}`}>
                      {row.access ? 'Paid access' : 'No paid access'}
                    </Badge>
                    {row.cancelAtPeriodEnd ? <Badge variant="outline">Cancels at period end</Badge> : null}
                  </div>
                  <p className="text-slate-600 [overflow-wrap:anywhere]">
                    Plan {row.planCode ?? '—'}{row.paidPlanCode && row.paidPlanCode !== row.planCode ? ` (paid period on ${row.paidPlanCode})` : ''} · paid through{' '}
                    {formatPay03bDateTime(row.paidThrough) ?? '—'}
                    {row.providerStatus ? ` · provider: ${humanizePay03bToken(row.providerStatus)}` : ''}
                  </p>
                  <p className="text-slate-500">{describePay03bAccessReason(row.accessReason)}</p>
                  <ProviderLabel simulated={row.simulated} gateway={row.gateway} />
                </div>
                <Button size="sm" variant="outline" onClick={() => void inspectSubscription(row.id)} data-testid={`pay03b-admin-inspect-${row.id}`}>
                  Inspect
                </Button>
              </div>
            ))
          )}

          {selectedId ? (
            <div className="min-w-0 space-y-4 rounded-xl border border-slate-300 bg-slate-50 p-3" data-testid="pay03b-admin-subscription-detail">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Subscription detail</h3>
                <Button size="sm" variant="ghost" onClick={closeDetail} data-testid="pay03b-admin-detail-close">Close detail</Button>
              </div>
              {detailLoading ? <p className="text-slate-500" data-testid="pay03b-admin-detail-loading">Loading subscription detail…</p> : null}
              {detailError ? <ErrorBox error={detailError} testId="pay03b-admin-detail-error" /> : null}
              {subscriptionMessage ? <StatusBox message={subscriptionMessage} testId="pay03b-admin-subscription-status" /> : null}
              {subscriptionActionError ? <ErrorBox error={subscriptionActionError} testId="pay03b-admin-subscription-action-error" /> : null}
              {detail && subscription ? (
                <>
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Reference"><span className="font-mono">{subscription.subscriptionReference ?? subscription.id}</span></Field>
                    <Field label="Status">
                      {describePay03bSubscriptionStatus(subscription.status)}
                      {subscription.providerStatus ? ` · provider: ${humanizePay03bToken(subscription.providerStatus)}` : ''}
                    </Field>
                    <Field label="Plan / paid plan">{subscription.planCode ?? '—'} / {subscription.paidPlanCode ?? '—'}</Field>
                    <Field label="Current period">
                      {formatPay03bDateTime(subscription.currentPeriodStart) ?? '—'} – {formatPay03bDateTime(subscription.currentPeriodEnd) ?? '—'}
                    </Field>
                    <Field label="Paid through">{formatPay03bDateTime(subscription.paidThrough) ?? '—'}</Field>
                    <Field label="Grace until">{formatPay03bDateTime(subscription.graceUntil) ?? '—'}</Field>
                    <Field label="Cancellation">
                      {subscription.cancelAtPeriodEnd ? 'At period end' : subscription.cancellationMode ? humanizePay03bToken(subscription.cancellationMode) : 'None'}
                    </Field>
                    <Field label="Suspended reason">{subscription.suspendedReason ? humanizePay03bToken(subscription.suspendedReason) : '—'}</Field>
                    <Field label="Tenant / organization">
                      <span className="font-mono">{subscription.ownerTenantId ?? '—'} / {subscription.ownerOrganizationId ?? '—'}</span>
                    </Field>
                    <Field label="Provider subscription"><span className="font-mono">{subscription.providerSubscriptionId ?? '—'}</span></Field>
                    <Field label="Gateway"><ProviderLabel simulated={subscription.simulated} gateway={subscription.gateway} /></Field>
                  </dl>

                  <div className="rounded-lg border bg-white p-3" data-testid="pay03b-admin-entitlements">
                    <p className="font-semibold text-slate-900">
                      {detail.entitlements.access ? 'Paid access: active' : 'Paid access: none'}
                    </p>
                    <p className="text-slate-600">{describePay03bAccessReason(detail.entitlements.reason)}</p>
                    <p className="text-slate-600">
                      Paid through {formatPay03bDateTime(detail.entitlements.paidThrough) ?? '—'} · listing capacity{' '}
                      {typeof detailCapacity === 'number' ? detailCapacity : 'not set'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={subscriptionBusy !== null}
                      onClick={() => void reconcileSubscription()}
                      data-testid="pay03b-admin-reconcile"
                    >
                      {subscriptionBusy === 'reconcile' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                      Reconcile with provider
                    </Button>
                    {adminSuspended ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSubscriptionMessage(null)
                          setSuspensionIntent({ action: 'resume', key: createPay03bIdempotencyKey() })
                        }}
                        data-testid="pay03b-admin-resume"
                      >
                        Lift suspension…
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setSubscriptionMessage(null)
                          setSuspensionIntent({ action: 'suspend', key: createPay03bIdempotencyKey() })
                        }}
                        data-testid="pay03b-admin-suspend"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        Suspend…
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">Invoices</h4>
                    {detail.invoices.length === 0 ? (
                      <p className="text-slate-500" data-testid="pay03b-admin-invoices-empty">No invoices recorded for this subscription.</p>
                    ) : (
                      <div className="rounded-lg border bg-white p-2">
                        <Pay03bInvoicesTable
                          invoices={detail.invoices}
                          testIdPrefix="pay03b-admin"
                          label="Subscription invoices (administrator)"
                          renderAction={(invoice) => (invoice.providerStatus === 'paid' && invoice.paymentStatus === 'paid' && invoice.paymentReference ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-auto min-h-8 whitespace-normal border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setSubscriptionMessage(null)
                                setRefundTarget(invoice)
                              }}
                              data-testid={`pay03b-admin-refund-${invoice.providerInvoiceId}`}
                            >
                              Refund…
                            </Button>
                          ) : null)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">Provider-sync exceptions</h4>
                    {(detail.syncExceptions ?? []).length === 0 ? (
                      <p className="text-slate-500">No provider-sync exceptions.</p>
                    ) : (
                      <>
                        {(detail.syncExceptions ?? []).some((x) => x.status === 'open') ? (
                          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900" data-testid="pay03b-admin-sync-exceptions-alert">
                            {(detail.syncExceptions ?? []).filter((x) => x.status === 'open').length} open: CarUp could not record
                            {' '}an invoice the provider listed, so paid access is suspended. Reconcile after the provider-side
                            {' '}cause is fixed; an exception clears when the invoice records cleanly or the provider no longer lists it.
                          </p>
                        ) : null}
                        <ul className="space-y-1" data-testid="pay03b-admin-sync-exceptions">
                          {(detail.syncExceptions ?? []).map((x) => (
                            <li key={x.id} className="rounded-md border bg-white p-2 [overflow-wrap:anywhere]" data-testid={`pay03b-admin-sync-exception-${x.id}`}>
                              <span className="font-medium">{x.status === 'open' ? 'Open' : 'Cleared'}</span>
                              {' · invoice '}{x.providerInvoiceId}
                              {' · '}<code>{x.errorCode}</code>
                              {' · seen '}{x.observationCount}{x.observationCount === 1 ? ' time' : ' times'}
                              {' · last '}{formatPay03bDateTime(x.lastSeenAt) ?? '—'}
                              {x.clearedAt ? ` · cleared ${formatPay03bDateTime(x.clearedAt) ?? '—'}` : ''}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">Lifecycle transitions</h4>
                    {detail.transitions.length === 0 ? (
                      <p className="text-slate-500">No transitions recorded.</p>
                    ) : (
                      <ul className="space-y-1" data-testid="pay03b-admin-transitions">
                        {detail.transitions.map((transition) => (
                          <li key={transition.id} className="rounded-md border bg-white p-2 [overflow-wrap:anywhere]" data-testid={`pay03b-admin-transition-${transition.id}`}>
                            <span className="font-medium">{humanizePay03bToken(transition.from_status)} → {humanizePay03bToken(transition.to_status)}</span>
                            {' · '}{humanizePay03bToken(transition.cause)}
                            {transition.to_plan_id && transition.to_plan_id !== transition.from_plan_id
                              ? ` · plan ${planLabel(transition.from_plan_id)} → ${planLabel(transition.to_plan_id)}`
                              : ''}
                            {transition.paid_through ? ` · paid through ${formatPay03bDateTime(transition.paid_through)}` : ''}
                            {transition.actor_id ? ` · by ${transition.actor_id}` : ''}
                            {' · '}{formatPay03bDateTime(transition.recorded_at) ?? '—'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">Change requests</h4>
                    {detail.changeRequests.length === 0 ? (
                      <p className="text-slate-500">No change requests recorded.</p>
                    ) : (
                      <ul className="space-y-1" data-testid="pay03b-admin-change-requests">
                        {detail.changeRequests.map((request) => (
                          <li key={request.id} className="rounded-md border bg-white p-2 [overflow-wrap:anywhere]" data-testid={`pay03b-admin-change-request-${request.id}`}>
                            <span className="font-medium">{humanizePay03bToken(request.change_type)}</span>
                            {' · '}{humanizePay03bToken(request.status)}
                            {request.outcome_code ? ` (${request.outcome_code})` : ''}
                            {request.target_plan_id ? ` · target ${planLabel(request.target_plan_id)}` : ''}
                            {' · '}{request.requested_by} ({humanizePay03bToken(request.requested_role)})
                            {request.reason ? ` · “${request.reason}”` : ''}
                            {' · '}{formatPay03bDateTime(request.requested_at) ?? '—'}
                            {request.completed_at ? ` → ${formatPay03bDateTime(request.completed_at)}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {sourceOfTruth ? <p className="text-slate-500 [overflow-wrap:anywhere]">Source of truth: {sourceOfTruth}</p> : null}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- plan governance */}
      <Card data-testid="pay03b-admin-plan-governance">
        <CardHeader>
          <CardTitle className="text-lg">Subscription plan governance</CardTitle>
          <CardDescription>
            Every plan version in the governed registry. No paid plan is commercially approved; sandbox fixture amounts are
            test values, never prices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {plansError ? (
            <ErrorBox error={plansError} testId="pay03b-admin-plans-error">
              <p className="mt-1">
                {plans.length > 0
                  ? 'The plans below may be stale.'
                  : 'This is a read failure, not an empty registry — do not infer that no plans exist.'}
              </p>
            </ErrorBox>
          ) : null}
          {plans.length === 0 ? (
            plansError ? null : plansLoaded ? (
              <p className="text-slate-500" data-testid="pay03b-admin-plans-empty">No plan versions are registered.</p>
            ) : (
              <p className="text-slate-500" data-testid="pay03b-admin-plans-loading">Loading plan governance…</p>
            )
          ) : (
            <Table aria-label="Subscription plan governance" className="max-md:block" data-testid="pay03b-admin-plans-table">
              <TableHeader className="max-md:hidden">
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Pricing kind</TableHead>
                  <TableHead>Activation</TableHead>
                  <TableHead>Commercial status</TableHead>
                  <TableHead>Sandbox amount</TableHead>
                  <TableHead>Blocker</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-md:block">
                {plans.map((plan) => {
                  const kind = pay03bCommercialKind(plan)
                  const amount = kind === 'sandbox' ? formatPay03bMinor(plan.amountMinor, plan.currency, plan.currencyScale) : null
                  return (
                    <TableRow
                      key={plan.id}
                      className="max-md:mb-3 max-md:block max-md:rounded-md max-md:border max-md:bg-white max-md:p-2"
                      data-testid={`pay03b-admin-plan-${plan.planCode}-v${plan.planVersion}`}
                    >
                      <TableCell className={cellClass}>
                        <MobileLabel>Plan</MobileLabel>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 [overflow-wrap:anywhere]">{plan.displayName}</div>
                          <div className="font-mono text-[11px] text-slate-500 [overflow-wrap:anywhere]">
                            {plan.planCode} v{plan.planVersion}{plan.productCode ? ` · ${plan.productCode}` : ''}
                          </div>
                          {plan.effectiveTo ? <div className="text-[11px] text-slate-500">Retired {formatPay03bDateTime(plan.effectiveTo)}</div> : null}
                        </div>
                      </TableCell>
                      <TableCell className={cellClass}>
                        <MobileLabel>Pricing kind</MobileLabel>
                        <span>{humanizePay03bToken(plan.pricingKind)}</span>
                      </TableCell>
                      <TableCell className={cellClass}>
                        <MobileLabel>Activation</MobileLabel>
                        <Badge variant="outline" className="whitespace-normal">{humanizePay03bToken(plan.activationStatus)}</Badge>
                      </TableCell>
                      <TableCell className={cellClass}>
                        <MobileLabel>Commercial</MobileLabel>
                        {kind === 'sandbox' ? (
                          <Pay03bSandboxLabel testId={`pay03b-admin-plan-sandbox-${plan.planCode}-v${plan.planVersion}`} />
                        ) : (
                          <span data-testid={`pay03b-admin-plan-commercial-${plan.planCode}-v${plan.planVersion}`}>{pay03bCommercialLabel(kind)}</span>
                        )}
                      </TableCell>
                      <TableCell className={cellClass}>
                        <MobileLabel>Sandbox amount</MobileLabel>
                        <div className="min-w-0 space-y-1">
                          {amount ? (
                            <>
                              <span className="tabular-nums">{amount} {formatPay03bInterval(plan.billingInterval, plan.intervalCount) ?? ''}</span>
                              <ProviderLabel simulated={plan.simulated} />
                            </>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={cellClass}>
                        <MobileLabel>Blocker</MobileLabel>
                        {plan.blockerReason ? (
                          <span className="flex min-w-0 items-start gap-1 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{plan.blockerClass ?? 'Governance'}:</strong> {plan.blockerReason}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {suspensionIntent && subscription ? (
        <SuspensionDialog
          key={suspensionIntent.key}
          subscription={subscription}
          action={suspensionIntent.action}
          idempotencyKey={suspensionIntent.key}
          submit={(reason, key) => setPay03bAdminSuspension(configFor(), subscription.id, { action: suspensionIntent.action, reason }, key)}
          onClose={() => setSuspensionIntent(null)}
          onDone={onSuspensionDone}
        />
      ) : null}
      {refundTarget && subscription ? (
        <RefundDialog
          key={refundTarget.id}
          invoice={refundTarget}
          submit={(reason) => refundPay03bAdminInvoice(configFor(), subscription.id, refundTarget.id, { reason })}
          onClose={() => setRefundTarget(null)}
          onDone={onRefundDone}
        />
      ) : null}
      {resolveTarget ? (
        <ResolveDialog
          key={resolveTarget.id}
          exception={resolveTarget}
          submit={(resolution, note) => resolvePay03bReconciliationException(configFor(), resolveTarget.id, { resolution, note })}
          onClose={() => setResolveTarget(null)}
          onDone={onResolved}
        />
      ) : null}
    </section>
  )
}
