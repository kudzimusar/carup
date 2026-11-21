import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Store, ShoppingCart } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaBuyerOrder, DiasporaMatchCandidate, DiasporaQuote } from '@/types'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { SourcingDeskView } from '@/components/trade/sourcing/SourcingDeskView'
import { READ_IDLE, READ_LOADING, READ_READY, errorMessage, errorStatus, failedRead, formatAmount, type ReadState } from '@/components/trade/sourcing/deskKit'
import type { RfqDetailRead, RfqNotice } from '@/components/trade/sourcing/rfqDesk'

const BUYER_ROLES = new Set(['owner', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const SELLER_ROLES = new Set(['dealer', 'admin', 'platform_admin', 'super_admin', 'reviewer'])

function genKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function DiasporaReverseRfq() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  // The mount reads must be keyed on the individually memoized request functions, never on `api`:
  // useCarUpApi() returns a NEW object on every render and owns loading state, so callbacks keyed on
  // it re-fired the mount effect on its own state changes — an unbounded request loop (the defect
  // pull request 130 fixed on the trade profile). These identities are stable per signed-in session.
  const { fetchDiasporaBuyerOrders, fetchDiasporaRfqs } = api
  const role = (user?.role || '').toLowerCase()
  const isBuyer = isAuthenticated && BUYER_ROLES.has(role)
  const isSeller = isAuthenticated && SELLER_ROLES.has(role)
  const canView = isBuyer || isSeller

  // buyer state
  const [orders, setOrders] = useState<DiasporaBuyerOrder[]>([])
  const [selectedOrder, setSelectedOrder] = useState<DiasporaBuyerOrder | null>(null)
  const [matches, setMatches] = useState<DiasporaMatchCandidate[]>([])
  const [quotes, setQuotes] = useState<DiasporaQuote[]>([])
  const [buyerError, setBuyerError] = useState('')
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newOrigin, setNewOrigin] = useState('')
  const [creating, setCreating] = useState(false)

  // seller state
  const [rfqs, setRfqs] = useState<DiasporaBuyerOrder[]>([])
  const [sellerError, setSellerError] = useState('')
  const [quoteAmounts, setQuoteAmounts] = useState<Record<string, string>>({})
  const [quotingId, setQuotingId] = useState('')

  // RX-06 unified view only (the legacy view never reads these): whether each read has answered, how
  // the selected order's detail read went, and a receipt/refusal for the last action — so a failed
  // read is never shown as "none" and a 403/429 is never shown as an outage.
  const [ordersRead, setOrdersRead] = useState<ReadState>(READ_IDLE)
  const [rfqsRead, setRfqsRead] = useState<ReadState>(READ_IDLE)
  const [detailRead, setDetailRead] = useState<RfqDetailRead>({ phase: 'idle', orderId: null })
  const [deskNotice, setDeskNotice] = useState<RfqNotice | null>(null)

  const loadOrders = useCallback(async () => {
    if (!isBuyer) return
    try {
      setOrders(await fetchDiasporaBuyerOrders())
      setOrdersRead(READ_READY)
    } catch (err) {
      setBuyerError(err instanceof Error ? err.message : 'Unable to load orders')
      setOrdersRead(failedRead(err))
    }
  }, [fetchDiasporaBuyerOrders, isBuyer])

  const loadRfqs = useCallback(async () => {
    if (!isSeller) return
    try {
      setRfqs(await fetchDiasporaRfqs())
      setRfqsRead(READ_READY)
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : 'Unable to load RFQs')
      setRfqsRead(failedRead(err))
    }
  }, [fetchDiasporaRfqs, isSeller])

  useEffect(() => {
    if (authLoading || !canView) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrders()
    void loadRfqs()
  }, [authLoading, canView, loadOrders, loadRfqs])

  const selectOrder = async (order: DiasporaBuyerOrder) => {
    setSelectedOrder(order)
    setBuyerError('')
    setDetailRead((prev) => (prev.orderId === order.id && prev.phase === 'ready' ? prev : { phase: 'loading', orderId: order.id }))
    let stage: 'detail' | 'matches' = 'detail'
    try {
      const detail = await api.fetchDiasporaBuyerOrder(order.id)
      setSelectedOrder(detail) // keep fresh metadata (e.g. acceptedQuoteId) for accept-state derivation
      setQuotes(detail.quotes || [])
      stage = 'matches'
      if (detail.metadata?.rfq?.published) setMatches(await api.fetchDiasporaOrderMatches(order.id))
      else setMatches([])
      setDetailRead({ phase: 'ready', orderId: order.id })
    } catch (err) {
      setBuyerError(err instanceof Error ? err.message : 'Unable to load order detail')
      setDetailRead({ phase: 'failed', orderId: order.id, stage, status: errorStatus(err), message: errorMessage(err) })
    }
  }

  const handleCreate = async () => {
    if (creating) return
    setBuyerError('')
    setDeskNotice(null)
    if (!newOrigin.trim()) {
      setBuyerError('Origin country is required')
      setDeskNotice({ lane: 'buyer', tone: 'danger', text: 'Enter the origin country — it is the one required field.' })
      return
    }
    setCreating(true)
    try {
      await api.createDiasporaBuyerOrder({
        order_type: 'parts',
        origin_country: newOrigin.trim(),
        requested_make: newMake.trim() || undefined,
        requested_model: newModel.trim() || undefined,
      })
      setNewMake(''); setNewModel(''); setNewOrigin('')
      setDeskNotice({ lane: 'buyer', tone: 'info', text: 'Request recorded as a draft. Sellers see it only after you publish it.' })
      await loadOrders()
    } catch (err) {
      setBuyerError(err instanceof Error ? err.message : 'Unable to create order')
      setDeskNotice({ lane: 'buyer', tone: 'danger', text: `The request was not recorded: ${err instanceof Error ? err.message : 'Unable to create order'}` })
    } finally {
      setCreating(false)
    }
  }

  const handlePublish = async (order: DiasporaBuyerOrder) => {
    setBuyerError('')
    setDeskNotice(null)
    try {
      await api.publishDiasporaRfq(order.id)
      setDeskNotice({ lane: 'buyer', tone: 'info', text: 'Published. Sellers can now see this request and submit quotes.' })
      await loadOrders()
      await loadRfqs()
      if (selectedOrder?.id === order.id) await selectOrder(order)
    } catch (err) {
      setBuyerError(err instanceof Error ? err.message : 'Unable to publish RFQ')
      setDeskNotice({ lane: 'buyer', tone: 'danger', text: `Not published: ${err instanceof Error ? err.message : 'Unable to publish RFQ'}` })
    }
  }

  const handleAccept = async (quote: DiasporaQuote) => {
    if (!selectedOrder) return
    setBuyerError('')
    setDeskNotice(null)
    try {
      await api.acceptDiasporaQuote(selectedOrder.id, quote.id)
      setDeskNotice({ lane: 'buyer', tone: 'info', text: 'Quote accepted. The other submitted quotes on this request were rejected in the same step.' })
      await selectOrder(selectedOrder)
      await loadOrders()
    } catch (err) {
      setBuyerError(err instanceof Error ? err.message : 'Unable to accept quote')
      setDeskNotice({ lane: 'buyer', tone: 'danger', text: `The quote was not accepted: ${err instanceof Error ? err.message : 'Unable to accept quote'}` })
    }
  }

  const handleSellerQuote = async (rfqOrder: DiasporaBuyerOrder) => {
    setSellerError('')
    setDeskNotice(null)
    const amount = Number(quoteAmounts[rfqOrder.id])
    if (!(amount > 0)) {
      setSellerError('Enter a positive quote amount')
      setDeskNotice({ lane: 'seller', tone: 'danger', text: 'Enter a quote amount greater than zero.' })
      return
    }
    setQuotingId(rfqOrder.id)
    try {
      await api.createDiasporaQuote(rfqOrder.id, { quote_amount: amount, submit: true, idempotencyKey: genKey() })
      setQuoteAmounts((prev) => ({ ...prev, [rfqOrder.id]: '' }))
      setDeskNotice({ lane: 'seller', tone: 'info', text: `Quote of ${formatAmount(amount, 'USD') ?? amount} submitted to the buyer.` })
      await loadRfqs()
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : 'Unable to submit quote')
      setDeskNotice({ lane: 'seller', tone: 'danger', text: `The quote was not submitted: ${err instanceof Error ? err.message : 'Unable to submit quote'}` })
    } finally {
      setQuotingId('')
    }
  }

  const selectedAcceptedId = useMemo(() => selectedOrder?.metadata?.rfq?.acceptedQuoteId, [selectedOrder])

  if (isUnifiedUiEnabled()) {
    // RX-06: the same reads, state and handlers, arranged as a sourcing desk.
    return (
      <SourcingDeskView
        model={{
          authLoading,
          signedIn: isAuthenticated,
          role,
          isBuyer,
          isSeller,
          notice: deskNotice,
          buyer: {
            orders,
            read: ordersRead,
            onRetry: () => { setOrdersRead(READ_LOADING); void loadOrders() },
            selected: selectedOrder,
            detail: detailRead,
            quotes,
            matches,
            acceptedQuoteId: selectedAcceptedId,
            onSelect: selectOrder,
            onPublish: handlePublish,
            onAccept: handleAccept,
            compose: {
              origin: newOrigin,
              make: newMake,
              model: newModel,
              setOrigin: setNewOrigin,
              setMake: setNewMake,
              setModel: setNewModel,
              creating,
              onSubmit: () => { void handleCreate() },
            },
          },
          seller: {
            rfqs,
            read: rfqsRead,
            onRetry: () => { setRfqsRead(READ_LOADING); void loadRfqs() },
            amounts: quoteAmounts,
            setAmount: (orderId, value) => setQuoteAmounts((p) => ({ ...p, [orderId]: value })),
            quotingId,
            onQuote: (order) => { void handleSellerQuote(order) },
          },
        }}
      />
    )
  }

  if (authLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-rfq-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The Reverse RFQ marketplace requires a buyer or seller role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-rfq-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 text-2xl font-semibold text-gray-950">Reverse RFQ marketplace</h1>
          <p className="mt-1 text-sm text-gray-500">Buyers publish demand; sellers compete with quotes; one quote is accepted.</p>
        </div>
        <Button asChild variant="outline"><Link to="/diaspora/stock">Stock manager</Link></Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {isBuyer && (
          <div className="space-y-4">
            <section className="rounded-md border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950"><ShoppingCart className="h-5 w-5 text-orange-600" /> My buyer orders</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Input placeholder="Origin country" value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} data-testid="diaspora-buyer-order-origin" />
                <Input placeholder="Make (optional)" value={newMake} onChange={(e) => setNewMake(e.target.value)} data-testid="diaspora-buyer-order-make" />
                <Input placeholder="Model (optional)" value={newModel} onChange={(e) => setNewModel(e.target.value)} data-testid="diaspora-buyer-order-model" />
              </div>
              <Button className="mt-3" onClick={handleCreate} disabled={creating} data-testid="diaspora-buyer-order-submit">
                {creating ? 'Creating…' : 'Create demand'}
              </Button>
              {buyerError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-rfq-buyer-error">{buyerError}</p>}
              <div className="mt-3 rounded-md border border-gray-200" data-testid="diaspora-buyer-order-list">
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {orders.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500" data-testid="diaspora-buyer-order-empty">{buyerError ? 'Orders could not be loaded. This is not a report that you have none.' : 'No orders yet.'}</TableCell></TableRow>
                    ) : orders.map((order) => (
                      <TableRow key={order.id} data-testid="diaspora-buyer-order-row">
                        <TableCell className="font-medium">{order.requested_make || order.order_type} {order.requested_model || ''}</TableCell>
                        <TableCell>
                          {order.metadata?.rfq?.published
                            ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">RFQ open</Badge>
                            : <Badge variant="outline">Draft</Badge>}
                        </TableCell>
                        <TableCell className="space-x-2">
                          <Button size="sm" variant="outline" onClick={() => selectOrder(order)} data-testid="diaspora-buyer-order-select">Open</Button>
                          {!order.metadata?.rfq?.published && (
                            <Button size="sm" onClick={() => handlePublish(order)} data-testid="diaspora-buyer-order-publish">Publish RFQ</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            {selectedOrder && (
              <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-rfq-detail">
                <h3 className="text-base font-semibold text-gray-950">Matches</h3>
                <div className="mt-2 rounded-md border border-gray-200" data-testid="diaspora-rfq-matches">
                  <Table>
                    <TableHeader><TableRow><TableHead>Part</TableHead><TableHead>Score</TableHead><TableHead>Reasons</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {matches.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500">No matches yet (publish to match).</TableCell></TableRow>
                      ) : matches.map((m) => (
                        <TableRow key={m.stockItemId} data-testid="diaspora-rfq-match-row">
                          <TableCell className="font-medium">{m.partName}</TableCell>
                          <TableCell>{m.score}</TableCell>
                          <TableCell className="text-xs text-gray-600">{m.reasons.join('; ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <h3 className="mt-4 text-base font-semibold text-gray-950">Quotes</h3>
                <div className="mt-2 rounded-md border border-gray-200" data-testid="diaspora-rfq-quotes">
                  <Table>
                    <TableHeader><TableRow><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {quotes.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500">No quotes yet.</TableCell></TableRow>
                      ) : quotes.map((q) => (
                        <TableRow key={q.id} data-testid="diaspora-rfq-quote-row">
                          <TableCell className="font-medium">{q.quote_amount} {q.quote_currency}</TableCell>
                          <TableCell><Badge variant="outline">{q.status}</Badge></TableCell>
                          <TableCell>
                            {q.id === selectedAcceptedId ? (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-100" data-testid="diaspora-rfq-accepted-badge"><CheckCircle2 className="mr-1 h-3 w-3" /> Accepted</Badge>
                            ) : (!selectedAcceptedId && q.status === 'ISSUED') ? (
                              <Button size="sm" onClick={() => handleAccept(q)} data-testid="diaspora-rfq-accept">Accept</Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </div>
        )}

        {isSeller && (
          <div className="space-y-4">
            <section className="rounded-md border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950"><Store className="h-5 w-5 text-orange-600" /> Open RFQs</h2>
              {sellerError && (
                <Alert className="mt-3 border-red-200 bg-red-50" data-testid="diaspora-rfq-seller-error">
                  <AlertTriangle className="h-4 w-4 text-red-700" />
                  <AlertDescription>{sellerError}</AlertDescription>
                </Alert>
              )}
              <div className="mt-3 rounded-md border border-gray-200" data-testid="diaspora-rfq-marketplace">
                <Table>
                  <TableHeader><TableRow><TableHead>Demand</TableHead><TableHead>Origin</TableHead><TableHead>Quote</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rfqs.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500" data-testid="diaspora-rfq-marketplace-empty">{sellerError ? 'Open RFQs could not be loaded. This is not a report that there are none.' : 'No open RFQs.'}</TableCell></TableRow>
                    ) : rfqs.map((order) => (
                      <TableRow key={order.id} data-testid="diaspora-rfq-open-row">
                        <TableCell className="font-medium">{order.requested_make || order.order_type} {order.requested_model || ''}</TableCell>
                        <TableCell>{order.origin_country}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input type="number" min="0" placeholder="Amount" value={quoteAmounts[order.id] || ''} onChange={(e) => setQuoteAmounts((p) => ({ ...p, [order.id]: e.target.value }))} className="w-28" data-testid="diaspora-rfq-quote-amount" />
                            <Button size="sm" onClick={() => handleSellerQuote(order)} disabled={quotingId === order.id} data-testid="diaspora-rfq-quote-submit">Quote</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
