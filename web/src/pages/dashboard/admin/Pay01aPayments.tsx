import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, FlaskConical, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)
const PENDING_REFERENCE_KEY = 'carup_pay01a_pending_reference'

type PaymentStatus = 'pending' | 'paid' | 'cancelled' | 'refund_pending' | 'refunded'

export interface Pay01aPaymentRecord {
  reference: string
  amount: number
  currency: string
  status: PaymentStatus
  checkoutId: string | null
  paymentIntentId: string | null
  refundId: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface CheckoutResponse extends Pay01aPaymentRecord {
  checkoutUrl: string
  merchant: string
  live: false
  sandboxAccountId: string
}

const STATUS_COPY: Record<PaymentStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending provider confirmation', className: 'bg-amber-100 text-amber-800', Icon: RefreshCw },
  paid: { label: 'Payment confirmed', className: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  cancelled: { label: 'Checkout cancelled or expired', className: 'bg-slate-100 text-slate-700', Icon: XCircle },
  refund_pending: { label: 'Refund pending provider confirmation', className: 'bg-blue-100 text-blue-800', Icon: RefreshCw },
  refunded: { label: 'Refund confirmed', className: 'bg-violet-100 text-violet-800', Icon: CheckCircle2 },
}

const RESPONSE_ERROR = 'Incomplete canonical payment response. Previously verified data was retained.'
const VALID_STATUSES = new Set(['pending', 'paid', 'cancelled', 'refund_pending', 'refunded'])

export function parsePaymentRecord(value: unknown): Pay01aPaymentRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(RESPONSE_ERROR)
  const r = value as Record<string, unknown>
  if (['reference','amount','currency','status','checkoutId','paymentIntentId','refundId','createdAt','updatedAt'].some(k => !Object.prototype.hasOwnProperty.call(r,k))
    || typeof r.reference !== 'string' || !/^pay01a_[0-9a-f-]{36}$/.test(r.reference)
    || !Number.isSafeInteger(r.amount as number) || (r.amount as number) < 0
    || r.currency !== 'JPY' || !VALID_STATUSES.has(r.status as string)
    || ['checkoutId','paymentIntentId','refundId'].some(k => r[k] !== null && typeof r[k] !== 'string')
    || ['createdAt','updatedAt'].some(k => r[k] !== null && (typeof r[k] !== 'string' || !Number.isFinite(Date.parse(r[k] as string))))) {
    throw new Error(RESPONSE_ERROR)
  }
  return value as Pay01aPaymentRecord
}

export function formatAmount(record: Pick<Pay01aPaymentRecord, 'amount' | 'currency'>): string {
  if (!Number.isSafeInteger(record?.amount) || record.amount < 0 || record.currency !== 'JPY') return 'Amount unavailable'
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: record.currency }).format(record.amount) }
  catch { return 'Amount unavailable' }
}

export function formatDate(value: string | null): string {
  if (!value) return 'Not recorded'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', timeZoneName: 'short', year: 'numeric', month: 'short',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

export function providerMessage(status: PaymentStatus, navigation: 'returned' | 'cancelled' | null = null): string {
  if (status === 'paid') return 'Payment confirmed by Stripe.'
  if (status === 'refunded') return 'Refund confirmed by Stripe.'
  if (status === 'cancelled') return 'Checkout cancelled. No payment has been confirmed.'
  if (status === 'refund_pending') return 'Stripe is verifying the refund. The refund is not yet confirmed.'
  if (navigation === 'cancelled') return 'Checkout cancelled in the browser. No payment has been confirmed.'
  if (navigation === 'returned') return 'Returned from Stripe Checkout. Verifying payment with Stripe...'
  return 'Stripe has not yet confirmed the payment.'
}

function createIdempotencyKey(): string {
  const id = globalThis.crypto?.randomUUID?.()
  return `pay01b_${(id || `${Date.now()}_${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '')}`
}

function buildAuthHeaders(token: string | null, userId?: string, role?: string): AuthHeaders {
  return {
    'x-session-token': token ?? undefined,
    'x-user-id': userId,
    ...(role ? { 'x-stakeholder-role': role } : {}),
  }
}

function statusBadge(status: PaymentStatus) {
  const copy = STATUS_COPY[status] || STATUS_COPY.pending
  const Icon = copy.Icon
  return (
    <Badge className={`${copy.className} gap-1`} data-testid={`pay01a-status-${status}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {copy.label}
    </Badge>
  )
}

export default function Pay01aPayments() {
  const { user, token } = useAuth()
  const userId = user?.id
  const userRole = user?.role
  const [records, setRecords] = useState<Pay01aPaymentRecord[]>([])
  const [current, setCurrent] = useState<Pay01aPaymentRecord | null>(null)
  const [selectedReference, setSelectedReference] = useState<string | null>(null)
  const handledReturn = useRef(false)
  const [loading, setLoading] = useState(true)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returnMessage, setReturnMessage] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<Pay01aPaymentRecord | null>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiRequest<unknown>({
        baseUrl: API_BASE, path: '/pay01a',
        authHeaders: buildAuthHeaders(token, userId, userRole),
      })
      if (!response || typeof response !== 'object' || !('payments' in response)
        || !Array.isArray(response.payments)) throw new Error(RESPONSE_ERROR)
      setRecords(response.payments.map(parsePaymentRecord))
      setAvailable(true)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) {
        setAvailable(false)
        setError('The CarUp Japan sandbox payment feature is disabled in this environment.')
      } else {
        setError((err as { message?: string }).message || 'Unable to load sandbox payments.')
      }
    } finally {
      setLoading(false)
    }
  }, [token, userId, userRole])

  const reconcile = useCallback(async (reference: string, navigation: 'returned' | 'cancelled' | null = null) => {
    setActionBusy(true)
    setError(null)
    try {
      const response = parsePaymentRecord(await apiRequest<unknown>({
        baseUrl: API_BASE, path: `/pay01a/${encodeURIComponent(reference)}`,
        authHeaders: buildAuthHeaders(token, userId, userRole),
      }))
      if (response.reference !== reference) throw new Error(RESPONSE_ERROR)
      setCurrent(response)
      setSelectedReference(reference)
      setReturnMessage(providerMessage(response.status, navigation))
      if (navigation) window.localStorage.removeItem(PENDING_REFERENCE_KEY)
      await loadRecords()
      return response
    } catch (err) {
      setError((err as { message?: string }).message || 'Provider reconciliation is unavailable.')
      if (navigation) setReturnMessage('Stripe verification is currently unavailable. CarUp has not confirmed a new payment state.')
      return null
    } finally { setActionBusy(false) }
  }, [token, userId, userRole, loadRecords])

  useEffect(() => {
    queueMicrotask(() => { void loadRecords() })
  }, [loadRecords])

  useEffect(() => {
    if (handledReturn.current) return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('carup_pay01a')
    if (result !== 'returned' && result !== 'cancelled') return
    handledReturn.current = true
    const reference = window.localStorage.getItem(PENDING_REFERENCE_KEY)
    params.delete('carup_pay01a')
    params.delete('session_id')
    const search = params.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname
      + (search ? `?${search}` : '') + window.location.hash)
    if (!reference) {
      queueMicrotask(() => setReturnMessage(result === 'cancelled'
        ? 'Checkout cancelled in the browser. No payment has been confirmed.'
        : 'Stripe return received without a CarUp reference. Payment cannot yet be verified.'))
      return
    }
    queueMicrotask(() => {
      setReturnMessage(result === 'returned'
        ? 'Returned from Stripe Checkout. Verifying payment with Stripe...'
        : 'Checkout cancelled in the browser. Verifying canonical payment status...')
      void reconcile(reference, result)
    })
  }, [reconcile])

  const startCheckout = async () => {
    if (checkoutBusy) return
    setCheckoutBusy(true)
    setError(null)
    try {
      const response = await apiRequest<CheckoutResponse>({
        baseUrl: API_BASE,
        path: '/pay01a/checkout',
        options: {
          method: 'POST',
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          body: JSON.stringify({}),
        },
        authHeaders: buildAuthHeaders(token, userId, userRole),
      })
      if (!response.checkoutUrl || response.live !== false || response.currency !== 'JPY' || response.amount !== 100) {
        throw new Error('The sandbox checkout response did not match the approved JPY 100 item.')
      }
      window.localStorage.setItem(PENDING_REFERENCE_KEY, response.reference)
      window.location.assign(response.checkoutUrl)
    } catch (err) {
      setError((err as { message?: string }).message || 'Unable to open Stripe Checkout.')
      setCheckoutBusy(false)
    }
  }

  const requestRefund = async () => {
    if (!refundTarget || actionBusy) return
    setActionBusy(true)
    setError(null)
    try {
      const response = await apiRequest<Pay01aPaymentRecord>({
        baseUrl: API_BASE,
        path: `/pay01a/${encodeURIComponent(refundTarget.reference)}/refund`,
        options: { method: 'POST', body: JSON.stringify({}) },
        authHeaders: buildAuthHeaders(token, userId, userRole),
      })
      const verified = parsePaymentRecord(response)
      if (verified.reference !== refundTarget.reference) throw new Error(RESPONSE_ERROR)
      setCurrent(verified)
      setSelectedReference(verified.reference)
      setReturnMessage(providerMessage(verified.status))
      setRefundTarget(null)
      await loadRecords()
      toast.success(verified.status === 'refunded' ? 'Sandbox refund confirmed.' : 'Refund request submitted.')
    } catch (err) {
      setError((err as { message?: string }).message || 'Refund could not be completed.')
    } finally {
      setActionBusy(false)
    }
  }

  const historySelection = selectedReference
    ? records.find(r => r.reference === selectedReference) || null : null
  const detail = selectedReference
    ? (current?.reference === selectedReference
      && (!historySelection || Date.parse(current.updatedAt || '') >= Date.parse(historySelection.updatedAt || ''))
      ? current : historySelection)
    : (records[0] || null)

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8" data-testid="pay01a-console">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="bg-orange-500 text-white">CarUp Japan</Badge>
              <Badge variant="outline" className="border-white/30 text-white"><FlaskConical className="mr-1 h-3 w-3" /> Test mode</Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sandbox payment console</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              A controlled first-party JPY 100 certification item. This screen never represents a vehicle purchase,
              escrow balance, seller payout or live payment.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-200"><ShieldCheck className="h-4 w-4" /> Backend-authorized amount and merchant</div>
        </header>

        {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {returnMessage && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status">{returnMessage}</div>}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Card className="border-orange-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-orange-500" />Approved test item</CardTitle>
              <CardDescription>Only the server can create this payment. No amount or currency is accepted from the browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl bg-orange-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">CarUp Japan sandbox certification</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">¥100</p>
                <p className="mt-1 text-sm text-slate-600">JPY · direct merchant test collection</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">Use Stripe’s documented test payment methods only. The browser return is treated as unconfirmed until CarUp reconciles Stripe’s authoritative status.</p>
              <Button className="w-full" size="lg" onClick={startCheckout} disabled={!available || checkoutBusy} data-testid="pay01a-start-checkout">
                {checkoutBusy ? 'Opening secure Checkout…' : <>Continue to Stripe Checkout <ArrowRight className="h-4 w-4" /></>}
              </Button>
              {!available && <p className="text-xs text-slate-500">Sandbox payments are disabled outside an explicitly configured local/test environment.</p>}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div><CardTitle>{selectedReference ? 'Selected transaction' : 'Latest transaction'}</CardTitle><CardDescription>Canonical CarUp payment record and provider-backed status.</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => void loadRecords()} disabled={loading} aria-label="Refresh sandbox payments"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            </CardHeader>
            <CardContent>
              {loading && <p className="text-sm text-slate-500">Loading payment records…</p>}
              {!loading && !detail && <div className="rounded-lg border border-dashed p-5 text-sm text-slate-500">No sandbox payment has been initiated from this console.</div>}
              {selectedReference && <Button variant="link" size="sm" className="mb-3 px-0" onClick={() => { setSelectedReference(null); setCurrent(null) }}>Show latest transaction</Button>}
              {detail && (
                <div className="space-y-4" data-testid="pay01a-current-payment">
                  <div className="flex flex-wrap items-center justify-between gap-3">{statusBadge(detail.status)}<span className="font-semibold text-slate-900">{formatAmount(detail)}</span></div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-slate-500">CarUp reference</dt><dd className="break-all font-mono text-xs text-slate-900">{detail.reference}</dd></div>
                    <div><dt className="text-slate-500">Created</dt><dd className="text-slate-900">{formatDate(detail.createdAt)}</dd></div>
                    <div><dt className="text-slate-500">Checkout Session</dt><dd className="break-all font-mono text-xs text-slate-900">{detail.checkoutId || 'Not linked yet'}</dd></div>
                    <div><dt className="text-slate-500">PaymentIntent</dt><dd className="break-all font-mono text-xs text-slate-900">{detail.paymentIntentId || 'Not confirmed yet'}</dd></div>
                    {detail.refundId && <div><dt className="text-slate-500">Refund</dt><dd className="break-all font-mono text-xs text-slate-900">{detail.refundId}</dd></div>}
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void reconcile(detail.reference)} disabled={actionBusy} data-testid="pay01a-reconcile">{actionBusy ? 'Checking…' : 'Reconcile with Stripe'}</Button>
                    {detail.status === 'paid' && <Button variant="destructive" size="sm" onClick={() => setRefundTarget(detail)} disabled={actionBusy} data-testid="pay01a-refund">Request test refund</Button>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="shadow-sm">
          <CardHeader><CardTitle>Transaction history</CardTitle><CardDescription>Read-only projection of the canonical payment_transactions record. Stripe events remain provider evidence, not a second ledger.</CardDescription></CardHeader>
          <CardContent>
            {records.length === 0 ? <p className="text-sm text-slate-500">No records yet.</p> : (
              <div className="min-w-0 max-w-full">
                <p className="mb-2 text-xs text-slate-500 sm:hidden">Scroll horizontally for complete transaction history and actions.</p>
                <div className="max-w-full overflow-x-auto rounded-md border" role="region"
                  aria-label="Transaction history, horizontally scrollable" tabIndex={0} data-testid="pay01a-history-scroll">
                  <table className="w-full min-w-[880px] table-fixed text-left text-sm">
                    <colgroup><col className="w-[33%]" /><col className="w-[12%]" /><col className="w-[23%]" /><col className="w-[18%]" /><col className="w-[14%]" /></colgroup>
                    <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                      <tr><th scope="col" className="p-3">Reference</th><th scope="col" className="p-3">Amount</th>
                        <th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Updated (JST)</th>
                        <th scope="col" className="p-3 text-right">Action</th></tr>
                    </thead>
                    <tbody>{records.map(record => (
                      <tr key={record.reference} className="border-b last:border-0">
                        <td className="break-all p-3 font-mono text-xs">{record.reference}</td>
                        <td className="whitespace-nowrap p-3 font-semibold">{formatAmount(record)}</td>
                        <td className="p-3">{statusBadge(record.status)}</td>
                        <td className="p-3 text-xs text-slate-600">{formatDate(record.updatedAt)}</td>
                        <td className="p-3 text-right"><Button variant="ghost" size="sm" className="whitespace-nowrap"
                          aria-label={`Inspect transaction ${record.reference}`} onClick={() => void reconcile(record.reference)}
                          disabled={actionBusy}>Inspect <ExternalLink className="ml-1 h-3 w-3" /></Button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500">Direct merchant test collection only · No escrow, seller payout, vehicle reservation or title-transfer authority.</p>
      </div>

      <AlertDialog open={!!refundTarget} onOpenChange={(open) => { if (!open && !actionBusy) setRefundTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm sandbox refund</AlertDialogTitle><AlertDialogDescription>This will request a single full JPY 100 refund through the CarUp backend. Stripe and the canonical payment record must confirm the result. No live funds are involved.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void requestRefund() }} disabled={actionBusy}>{actionBusy ? 'Requesting…' : 'Confirm test refund'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
