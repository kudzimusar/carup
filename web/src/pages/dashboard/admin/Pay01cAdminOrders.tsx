import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)
interface AdminOrder {
  id: string; buyerId: string; reference: string;
  amount: number; currency: string; status: string; product: string;
  createdAt: string; checkoutId: string | null; paymentIntentId: string | null;
  refundId: string | null; reportAvailable: boolean; entitlement: string;
}

export default function Pay01cAdminOrders() {
  const { token } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<AdminOrder | null>(null)
  const authHeaders = { 'x-session-token': token ?? undefined }
  const load = useCallback(async () => {
    if (!token) return
    try {
      const r = await apiRequest<{ orders: AdminOrder[] }>({
        baseUrl: API_BASE, path: '/pay01c/admin/orders',
        authHeaders: { 'x-session-token': token },
      })
      if (!Array.isArray(r.orders)) throw new Error('Invalid administrator response.')
      setOrders(r.orders)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to inspect orders.') }
  }, [token])
  useEffect(() => { void load() }, [load])

  async function refund() {
    if (!target || !token || busy) return
    setBusy(true); setError(null)
    try {
      const result = await apiRequest<AdminOrder>({
        baseUrl: API_BASE, path: `/pay01c/admin/orders/${encodeURIComponent(target.id)}/refund`,
        options: { method: 'POST', body: '{}' }, authHeaders,
      })
      if (result.id !== target.id || !['refunded', 'refund_pending'].includes(result.status)) {
        throw new Error('Refund confirmation was not established by the provider.')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sandbox refund could not be reconciled.')
    } finally { setTarget(null); setBusy(false) }
  }

  return (
    <main className="min-h-screen space-y-6 bg-slate-50 px-4 py-6 sm:px-8" data-testid="pay01c-admin-console">
      <div className="mx-auto max-w-5xl space-y-5">
        <Button variant="link" asChild><Link to="/admin/payments"><ArrowLeft className="mr-2 h-4 w-4"/>Payment console</Link></Button>
        <div className="rounded-2xl bg-slate-950 p-6 text-white">
          <Badge className="bg-orange-500 text-white">STRIPE SANDBOX ONLY</Badge>
          <h1 className="mt-3 text-2xl font-semibold">Demo report purchase operations</h1>
          <p className="mt-2 text-sm text-slate-300">Buyer-linked orders. No vehicle sale, real report, escrow or live money.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
        <Card><CardHeader><div className="flex items-start justify-between gap-2">
          <div><CardTitle>Customer test purchases</CardTitle>
            <CardDescription>Canonical payment state from existing payment_transactions.</CardDescription></div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
        </div></CardHeader>
          <CardContent className="space-y-4">
            {orders.length === 0 ? <p className="text-sm text-slate-500">No sandbox demo orders.</p> :
              orders.map(o => <section key={o.id} className="space-y-3 rounded-xl border p-4" data-testid="pay01c-admin-order">
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">{o.product}</h2>
                  <Badge variant="outline">{o.status}</Badge>
                </div>
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                  {([
                    ['Buyer ID', o.buyerId], ['CarUp reference', o.reference],
                    ['Amount', o.currency === 'JPY' && o.amount === 100 ? '¥100' : 'Unverified'],
                    ['Order ID', o.id], ['Checkout', o.checkoutId || 'Not linked'],
                    ['PaymentIntent', o.paymentIntentId || 'Pending'],
                    ['Refund', o.refundId || 'Not refunded'], ['Entitlement', o.entitlement],
                  ] as const).map(([label, val]) => <div key={label} className="min-w-0">
                    <dt className="text-slate-500">{label}</dt><dd className="break-all font-mono text-slate-800">{val}</dd>
                  </div>)}
                </dl>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="h-4 w-4"/> Provider-verified state only</span>
                  {o.status === 'paid' && <Button size="sm" variant="destructive" disabled={busy} onClick={() => setTarget(o)}>
                    <FileText className="mr-2 h-4 w-4"/>Refund test purchase
                  </Button>}
                </div>
              </section>)}
          </CardContent>
        </Card>
      </div>
      <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !busy) setTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm full test-mode refund</AlertDialogTitle>
            <AlertDialogDescription>
              Only the CarUp Japan sandbox administrator may refund this ¥100 demo order.
              The report entitlement will be revoked after authoritative refund confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void refund() }}>
              {busy ? 'Verifying refund…' : 'Confirm sandbox refund'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
