import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock3, FileText, LockKeyhole, RefreshCw, ShieldCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)
const PENDING_ORDER = 'carup_pay01c_pending_demo_order'

interface Product {
  code: string; name: string; amount: number; currency: string;
  merchant: string; testOnly: boolean; synthetic: boolean;
}
interface Order {
  id: string; product: string; testOnly: true; reference: string;
  amount: number; currency: string; status: string; createdAt: string;
  paymentUpdatedAt: string; checkoutId: string | null;
  paymentIntentId: string | null; refundId: string | null;
  reportAvailable: boolean; entitlement: string;
}
interface DemoReport {
  title: string; classification: string; summary: string;
  vehicleIdentifier: string; make: string; model: string; manufactureYear: number;
  history: Array<{ date: string; event: string; odometerKm: number }>;
  disclaimer: string;
}

function money(amount: number, currency: string): string {
  return amount === 100 && currency === 'JPY' ? new Intl.NumberFormat('en-US', {
    currency: 'JPY', style: 'currency',
  }).format(amount) : 'Price unavailable'
}

function validOrder(value: Order): Order {
  if (!value || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
    || value.testOnly !== true || typeof value.reference !== 'string'
    || typeof value.status !== 'string' || !['pending','paid','cancelled','refund_pending','refunded'].includes(value.status)
    || !Number.isSafeInteger(value.amount) || value.currency !== 'JPY'
    || typeof value.reportAvailable !== 'boolean') {
    throw new Error('Unverified order response. The previous purchase status was retained.')
  }
  return value
}
function statusText(order: Order) {
  if (order.status === 'refunded') return 'Refund confirmed — demo report access revoked.'
  if (order.status === 'refund_pending') return 'Refund verification pending — access suspended.'
  if (order.status === 'paid' && order.reportAvailable) return 'Payment verified — sample report ready.'
  if (order.status === 'cancelled') return 'Checkout cancelled — no report issued.'
  return 'Awaiting authoritative Stripe sandbox payment verification.'
}

export default function DemoVehicleHistory() {
  const { user, token } = useAuth()
  const [product, setProduct] = useState<Product | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [report, setReport] = useState<{ order: Order; report: DemoReport } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const consumedReturn = useRef(false)
  const authHeaders = { 'x-session-token': token ?? undefined }

  const loadHistory = useCallback(async () => {
    if (!token) { setOrders([]); return }
    const response = await apiRequest<{ orders: Order[] }>({
      baseUrl: API_BASE, path: '/pay01c/orders', authHeaders: { 'x-session-token': token },
    })
    if (!Array.isArray(response.orders)) throw new Error('Purchase history is unavailable.')
    setOrders(response.orders.map(validOrder))
  }, [token])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const r = await apiRequest<{ product: Product }>({ baseUrl: API_BASE, path: '/pay01c/product' })
        if (!r.product?.testOnly || r.product?.currency !== 'JPY' || r.product?.amount !== 100
          || r.product?.code !== 'vehicle_history_demo') throw new Error('Demo-product contract is unavailable.')
        if (active) setProduct(r.product)
        if (token) await loadHistory()
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Demo product is unavailable.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [token, loadHistory])

  const verify = useCallback(async (orderId: string) => {
    if (!token) return
    setBusy(true); setError(null)
    try {
      const r = validOrder(await apiRequest<Order>({
        baseUrl: API_BASE, path: `/pay01c/orders/${encodeURIComponent(orderId)}/verify`,
        options: { method: 'POST', body: JSON.stringify({}) },
        authHeaders: { 'x-session-token': token },
      }))
      setMessage(statusText(r))
      await loadHistory()
      return r
    } catch (err) {
      setMessage('Payment verification is temporarily unavailable. No report is granted by the browser redirect.')
      setError(err instanceof Error ? err.message : 'Unable to verify payment.')
      return null
    } finally { setBusy(false) }
  }, [token, loadHistory])

  useEffect(() => {
    if (!token || consumedReturn.current) return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('carup_pay01c')
    if (result !== 'returned' && result !== 'cancelled') return
    consumedReturn.current = true
    const orderId = sessionStorage.getItem(PENDING_ORDER)
    params.delete('carup_pay01c'); params.delete('session_id')
    const search = params.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname +
      (search ? `?${search}` : '') + window.location.hash)
    if (!orderId) {
      queueMicrotask(() => setMessage('Stripe redirect received without an order reference. Check your purchase history.'))
      return
    }
    queueMicrotask(() => {
      setMessage(result === 'cancelled'
        ? 'Checkout cancelled in browser. Checking the canonical order.'
        : 'Returned from Stripe Checkout. Verifying payment with Stripe...')
      sessionStorage.removeItem(PENDING_ORDER)
      void verify(orderId)
    })
  }, [token, verify])

  async function startPurchase() {
    if (!token || busy || !product) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const id = globalThis.crypto.randomUUID().replace(/-/g, '')
      const result = await apiRequest<{
        orderId: string; checkoutUrl: string; amount: number; currency: string;
        sandboxAccountId: string; live: boolean; testOnly: boolean;
      }>({
        baseUrl: API_BASE, path: '/pay01c/orders/checkout',
        options: { method: 'POST', headers: { 'Idempotency-Key': `pay01c_${id}` }, body: '{}' },
        authHeaders,
      })
      if (!/^[0-9a-f-]{36}$/.test(result.orderId) || !result.checkoutUrl?.startsWith('https://checkout.stripe.com/')
        || result.live !== false || result.testOnly !== true
        || result.amount !== product.amount || result.currency !== product.currency
        || result.sandboxAccountId !== 'acct_1UVnGaEjgXqvlsJk') {
        throw new Error('The provider Checkout response failed sandbox verification.')
      }
      sessionStorage.setItem(PENDING_ORDER, result.orderId)
      window.location.assign(result.checkoutUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create test Checkout.')
      setBusy(false)
    }
  }

  async function openReport(order: Order) {
    if (!token || !order.reportAvailable) return
    setBusy(true); setError(null)
    try {
      const response = await apiRequest<{ order: Order; report: DemoReport }>({
        baseUrl: API_BASE, path: `/pay01c/orders/${encodeURIComponent(order.id)}/report`,
        authHeaders,
      })
      if (!validOrder(response.order).reportAvailable
        || !response.report?.classification?.includes('SYNTHETIC SAMPLE')) {
        throw new Error('The verified sample report is not available.')
      }
      setReport(response)
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : 'Report access unavailable.')
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-8" data-testid="pay01c-demo-page">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-3xl bg-slate-950 px-6 py-9 text-white shadow-lg sm:px-10">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge className="bg-orange-500 text-white">SANDBOX · TEST ONLY</Badge>
            <Badge variant="outline" className="border-slate-500 text-slate-200">Synthetic report</Badge>
          </div>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">CarUp Vehicle History Report</h1>
          <p className="mt-2 text-lg text-slate-200">Demo Edition · See how a CarUp report purchase could work.</p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            This is a fictional vehicle-history demonstration. It is not a real vehicle search,
            registration record, inspection certificate, ownership record or commercial offering.
          </p>
        </header>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {message && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <Card className="border-orange-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-orange-600"/>What the sample contains</CardTitle>
              <CardDescription>A preview of the report format, not actual vehicle intelligence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p>Illustrative registration, inspection, service and odometer milestones.</p>
              <p>Clear synthetic-data disclaimers throughout the report.</p>
              <p>No VIN lookup, customer vehicle, ownership transfer, escrow or seller settlement.</p>
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
                <ShieldCheck className="h-4 w-4 shrink-0"/> Access is issued only after CarUp verifies payment with Stripe.
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader><CardTitle>Try the sandbox purchase</CardTitle>
              <CardDescription>Direct CarUp Japan test merchant, one-time sample product.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-orange-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Demo test price</p>
                <p className="mt-1 text-4xl font-bold text-slate-950" data-testid="pay01c-price">
                  {product ? money(product.amount, product.currency) : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-600">Sandbox funds only · no live purchase</p>
              </div>
              {!user || !token ? (
                <Button asChild className="w-full"><Link to="/login">Sign in to try the demo <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
              ) : (
                <Button className="w-full" size="lg" disabled={!product || busy || loading}
                  onClick={() => void startPurchase()} data-testid="pay01c-buy">
                  {busy ? 'Processing…' : 'Buy demo report with Stripe test Checkout'}
                  <ArrowRight className="ml-2 h-4 w-4"/>
                </Button>
              )}
              <p className="flex items-start gap-2 text-xs text-slate-500">
                <LockKeyhole className="h-4 w-4 shrink-0"/> No report unlocks from a Checkout URL or redirect alone.
              </p>
            </CardContent>
          </Card>
        </div>

        {token && <section aria-label="Your demo purchases">
          <Card><CardHeader><CardTitle>Your demo purchases</CardTitle>
            <CardDescription>Only orders belonging to your authenticated CarUp session are shown.</CardDescription>
          </CardHeader><CardContent className="space-y-4">
            {loading ? <p>Loading purchases…</p> : orders.length === 0 ? <p className="text-sm text-slate-500">No demo purchases yet.</p> :
              orders.map(order => (
                <div key={order.id} className="space-y-3 rounded-xl border p-4" data-testid="pay01c-order">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold text-slate-900">{order.product}</p>
                      <p className="break-all font-mono text-xs text-slate-500">{order.reference}</p></div>
                    <Badge variant="outline" className="shrink-0">{order.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-700">{statusText(order)}</p>
                  <p className="text-sm font-semibold">{money(order.amount, order.currency)}</p>
                  {order.refundId && <p className="break-all text-xs text-slate-500">Test refund: {order.refundId}</p>}
                  <div className="flex flex-wrap gap-2">
                    {order.reportAvailable && <Button size="sm" onClick={() => void openReport(order)} disabled={busy}>
                      <FileText className="mr-2 h-4 w-4"/>Open sample report</Button>}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void verify(order.id)}>
                      <RefreshCw className="mr-2 h-4 w-4"/>Verify with Stripe</Button>
                  </div>
                  {order.reportAvailable ? <p className="flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Verified entitlement</p>
                    : order.status === 'refunded' ? <p className="flex items-center gap-2 text-xs text-slate-600"><Undo2 className="h-4 w-4"/>Report access revoked after refund</p>
                      : <p className="flex items-center gap-2 text-xs text-amber-700"><Clock3 className="h-4 w-4"/>Provider confirmation pending</p>}
                </div>
              ))
            }
          </CardContent></Card>
        </section>}

        {report && <section aria-label="Purchased synthetic vehicle report" data-testid="pay01c-report" className="space-y-4 rounded-2xl border-2 border-orange-400 bg-white p-6">
          <Badge className="bg-orange-600 text-white">{report.report.classification}</Badge>
          <h2 className="text-2xl font-bold">{report.report.title}</h2>
          <p className="text-sm text-slate-600">{report.report.summary}</p>
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Fictional identifier</dt><dd className="font-mono">{report.report.vehicleIdentifier}</dd></div>
            <div><dt className="text-slate-500">Illustrative vehicle</dt><dd>{report.report.make} · {report.report.model}</dd></div>
          </dl>
          <h3 className="font-semibold">Illustrative timeline</h3>
          <ol className="space-y-2">{report.report.history.map(item => <li key={item.date} className="rounded-lg border p-3 text-sm">
            {item.date} — {item.event} · {item.odometerKm.toLocaleString()} demo km</li>)}</ol>
          <p className="rounded-lg bg-orange-50 p-4 text-sm font-medium text-orange-950">{report.report.disclaimer}</p>
          <Button variant="outline" onClick={() => setReport(null)}>Close sample report</Button>
        </section>}
      </div>
    </main>
  )
}
