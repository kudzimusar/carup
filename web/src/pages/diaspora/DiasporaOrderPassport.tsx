/**
 * DiasporaOrderPassport — STRICTLY READ-ONLY "passport" view of a diaspora import order
 * (route: /diaspora/imports/:id/passport).
 *
 * Load strategy: fetchDiasporaImportOrder is the backbone (its failure is fatal and renders a safe
 * error state with a back link). Government footprint, audit history, ownership-handoff status and
 * the shipment stage timeline are BEST-EFFORT enrichments — each failure collapses only that section
 * to an explicit "unavailable" note; the page never blanks.
 *
 * Privacy: participant/actor identities are rendered as short-form ids only (never emails/phones);
 * document rows never expose storage paths or URLs. NON-CUSTODIAL: payment milestones are recorded
 * for tracking only — CarUp does not hold, receive or guarantee funds.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BookOpenCheck, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import PaymentMilestonesCard from '@/components/diaspora/PaymentMilestonesCard'
import { classifyActionError } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type {
  DiasporaImportOrder,
  DiasporaGovernmentDocument,
  DiasporaAuditEntry,
  DiasporaShipmentStageEvent,
  DiasporaOwnershipHandoffStatus,
  DiasporaCargoReservation,
  DiasporaShipment,
  DiasporaComplianceReview,
} from '@/types'

// ── Embedded aggregate rows not present in the shared DiasporaImportOrder type ──
// (GET /diaspora/import-orders/:id embeds these relations; see diasporaImportOrderService.)
interface OrderParticipantRow {
  id: string
  participant_role?: string | null
  verification_status?: string | null
  user_id?: string | null
  trade_profile_id?: string | null
}
interface OrderQuoteRow {
  id: string
  seller_id?: string | null
  quote_amount?: number | string | null
  quote_currency?: string | null
  status?: string | null
  created_at?: string | null
}
interface OrderPaymentMilestoneRow {
  id: string
  milestone_type?: string | null
  amount?: number | string | null
  currency?: string | null
  status?: string | null
  due_date?: string | null
}
type OrderPassportAggregate = DiasporaImportOrder & {
  linked_vehicle_vin?: string | null
  diaspora_import_order_participants?: OrderParticipantRow[]
  diaspora_import_quotes?: OrderQuoteRow[]
  diaspora_cargo_reservations?: DiasporaCargoReservation[]
  diaspora_shipments?: DiasporaShipment[]
  diaspora_compliance_reviews?: DiasporaComplianceReview[]
  diaspora_payment_milestones?: OrderPaymentMilestoneRow[]
}

// Import-order lifecycle in stage order (mirrors backend IMPORT_ORDER_STATUSES) so
// "ZIMBABWE_READY or later" can be derived without fabricating progress.
const ORDER_LIFECYCLE = [
  'IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED', 'DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED',
  'CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED', 'SHIPPED', 'ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS',
  'DUTY_PENDING', 'DUTY_PAID', 'RELEASED', 'REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING',
  'INSURANCE_PENDING', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED', 'COMPLETED',
]
function isZimbabweReadyOrLater(status?: string | null): boolean {
  const rank = ORDER_LIFECYCLE.indexOf((status || '').toUpperCase())
  return rank >= ORDER_LIFECYCLE.indexOf('ZIMBABWE_READY')
}

function labelize(value?: string | null): string {
  if (!value) return 'Not set'
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Short-form id only — never render raw emails/phones for participants or actors. */
function shortId(value?: string | null): string {
  if (!value) return '—'
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

function formatMoney(amount?: number | string | null, currency?: string | null): string {
  if (amount === undefined || amount === null || amount === '') return 'Not set'
  const numeric = Number(amount)
  if (Number.isNaN(numeric)) return 'Not set'
  return `${currency || 'USD'} ${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'Not recorded'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString()
}

function statusVariant(status?: string | null): 'default' | 'secondary' | 'destructive' {
  const s = (status || '').toUpperCase()
  if (/(VERIFIED|ACCEPTED|APPROVED|CONFIRMED|COMPLETED|PUBLISHED|READY|RELEASED)/.test(s)) return 'default'
  if (/(REJECTED|FAILED|CANCELLED|EXPIRED|MISSING|FLAGGED|DISPUTED)/.test(s)) return 'destructive'
  return 'secondary'
}

// ── Small read-only presentation helpers ──
function PassportSection({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <h2 className="text-base font-semibold">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

function Field({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function EmptyNote({ testId, children = 'None recorded' }: { testId: string; children?: ReactNode }) {
  return <p className="text-sm text-muted-foreground" data-testid={testId}>{children}</p>
}

function UnavailableNote({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid={testId}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

export default function DiasporaOrderPassport() {
  const { id = '' } = useParams<{ id: string }>()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [order, setOrder] = useState<OrderPassportAggregate | null>(null)
  // Best-effort enrichments: `null` means the fetch FAILED (section shows an "unavailable" note);
  // an empty array/object means it loaded but has nothing to show ("None recorded").
  const [footprint, setFootprint] = useState<DiasporaGovernmentDocument[] | null>([])
  const [audit, setAudit] = useState<DiasporaAuditEntry[] | null>([])
  const [handoff, setHandoff] = useState<DiasporaOwnershipHandoffStatus | null>(null)
  const [handoffFailed, setHandoffFailed] = useState(false)
  const [timeline, setTimeline] = useState<DiasporaShipmentStageEvent[] | null>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const loadingRef = useRef(false)
  const [fatal, setFatal] = useState<{ kind: 'notfound' | 'forbidden' | 'session' | 'error'; message: string } | null>(null)

  const canView = isAuthenticated

  const load = useCallback(async () => {
    if (!canView || !id || loadingRef.current) return
    loadingRef.current = true
    setLoading(true); setFatal(null)
    try {
      // Backbone — failure here is fatal for the whole passport.
      const data = (await api.fetchDiasporaImportOrder(id)) as OrderPassportAggregate
      setOrder(data)
      // Best-effort enrichments — a single failure must not blank the page.
      try { setFootprint(await api.fetchDiasporaGovernmentFootprint(id)) } catch { setFootprint(null) }
      try { setAudit(await api.fetchDiasporaOrderAudit(id)) } catch { setAudit(null) }
      try { setHandoff(await api.fetchDiasporaOwnershipHandoffStatus(id)); setHandoffFailed(false) } catch { setHandoff(null); setHandoffFailed(true) }
      const shipmentId = (data.diaspora_shipments || []).find((s) => s?.id)?.id
      if (shipmentId) {
        try { setTimeline(await api.fetchDiasporaShipmentTimeline(shipmentId)) } catch { setTimeline(null) }
      } else {
        setTimeline([])
      }
    } catch (err) {
      const { kind } = classifyActionError(err)
      if (kind === 'session') setFatal({ kind: 'session', message: 'Your session has expired. Please sign in again to view this passport.' })
      else if (kind === 'notfound') setFatal({ kind: 'notfound', message: 'This import order was not found.' })
      else if (kind === 'forbidden') setFatal({ kind: 'forbidden', message: 'You do not have access to this import order.' })
      else setFatal({ kind: 'error', message: 'Could not load this order passport. Please retry.' })
    } finally { setLoading(false); setHasLoaded(true); loadingRef.current = false }
  }, [api, canView, id])

  // Depend on stable primitives (not `load`/`api`): useCarUpApi() returns a fresh object each render,
  // so depending on the api object (or a callback derived from it) would loop the effect forever.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, id])

  if (authLoading || (loading && !hasLoaded)) {
    return <div className="flex min-h-[40vh] items-center justify-center text-orange-600" data-testid="order-passport-loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" data-testid="order-passport-auth-required">
        <Alert>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>
            Please sign in to view this order passport.
            <Button asChild size="sm" variant="default" className="ml-2"><Link to="/login">Sign in</Link></Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (fatal) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" data-testid={`order-passport-${fatal.kind}`}>
        <Alert variant={fatal.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Unable to open passport</AlertTitle>
          <AlertDescription>
            {fatal.message}
            <span className="ml-2 inline-flex gap-2">
              {fatal.kind === 'error' && <Button size="sm" variant="outline" onClick={() => void load()} data-testid="order-passport-retry">Retry</Button>}
              {fatal.kind === 'session' && <Button asChild size="sm" variant="default"><Link to="/login" data-testid="order-passport-signin">Sign in</Link></Button>}
              <Button asChild size="sm" variant="ghost"><Link to="/diaspora/imports" data-testid="order-passport-back">Back to import orders</Link></Button>
            </span>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (!order) return null

  const zimReady = isZimbabweReadyOrLater(order.status)
  const participants = order.diaspora_import_order_participants || []
  const quotes = order.diaspora_import_quotes || []
  const documents = order.diaspora_trade_documents || []
  const milestones = order.diaspora_payment_milestones || []
  const reservations = order.diaspora_cargo_reservations || []
  const shipments = order.diaspora_shipments || []
  const reviews = order.diaspora_compliance_reviews || []
  const hasRequestData = Boolean(order.requested_make || order.requested_model || order.requested_year_min || order.requested_year_max || order.budget_amount)
  const requiredDocs = (footprint || []).filter((f) => f.requiredForZimbabweReady)
  const verifiedRequiredDocs = requiredDocs.filter((f) => (f.status || '').toUpperCase() === 'VERIFIED')
  const sortedAudit = [...(audit || [])]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 50)

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="order-passport-page" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/diaspora/imports" data-testid="order-passport-back"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Import orders</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-busy={loading} data-testid="order-passport-refresh">
          {loading
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />}
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold" data-testid="order-passport-title">
          <BookOpenCheck className="h-6 w-6 text-orange-600" aria-hidden="true" /> Import order passport
        </h1>
        <p className="text-sm text-muted-foreground">Read-only record of import order {shortId(order.id)}.</p>
      </header>

      <div className="space-y-4">
        {/* 1 — Order identity & state */}
        <PassportSection title="Order identity & state" testId="order-passport-identity">
          <Field label="Order id" value={shortId(order.id)} testId="order-passport-id" />
          <Field label="Order type" value={labelize(order.order_type)} testId="order-passport-type" />
          <Field label="Status" value={<Badge variant={statusVariant(order.status)} data-testid="order-passport-status">{labelize(order.status)}</Badge>} />
          <Field label="Created" value={formatDate(order.created_at)} testId="order-passport-created" />
          <Field label="Origin" value={[order.origin_city, order.origin_country].filter(Boolean).join(', ') || 'Not set'} testId="order-passport-origin" />
          <Field label="Destination" value={[order.destination_city, order.destination_country].filter(Boolean).join(', ') || 'Not set'} testId="order-passport-destination" />
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-2 ${zimReady ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
            data-testid="order-passport-zim-ready"
            data-zim-ready={zimReady ? 'true' : 'false'}
          >
            {zimReady
              ? <><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Zimbabwe ready</>
              : <>Not Zimbabwe ready yet — current stage: {labelize(order.status)}</>}
          </div>
        </PassportSection>

        {/* 2 — Participants (ids short-form only; never emails/phones) */}
        <PassportSection title="Participants" testId="order-passport-participants">
          <Field label="Buyer" value={shortId(order.buyer_id)} testId="order-passport-buyer" />
          {participants.length === 0
            ? <EmptyNote testId="order-passport-participants-empty" />
            : (
              <ul className="space-y-2">
                {participants.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-participant-${p.id}`}>
                    <span className="font-medium">{labelize(p.participant_role)}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">{shortId(p.user_id || p.id)}</span>
                      <Badge variant={statusVariant(p.verification_status)}>{labelize(p.verification_status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </PassportSection>

        {/* 3 — Request */}
        <PassportSection title="Request" testId="order-passport-request">
          {hasRequestData
            ? (
              <>
                <Field label="Requested make" value={order.requested_make || 'Not set'} testId="order-passport-make" />
                <Field label="Requested model" value={order.requested_model || 'Not set'} testId="order-passport-model" />
                <Field
                  label="Year range"
                  value={order.requested_year_min || order.requested_year_max
                    ? `${order.requested_year_min ?? '—'} – ${order.requested_year_max ?? '—'}`
                    : 'Not set'}
                  testId="order-passport-years"
                />
                <Field label="Budget" value={formatMoney(order.budget_amount, order.budget_currency)} testId="order-passport-budget" />
              </>
            )
            : <EmptyNote testId="order-passport-request-empty" />}
        </PassportSection>

        {/* 4 — Quotations (the accepted quote is highlighted) */}
        <PassportSection title="Quotations" testId="order-passport-quotes">
          {quotes.length === 0
            ? <EmptyNote testId="order-passport-quotes-empty" />
            : quotes.map((q) => {
              const accepted = (q.status || '').toUpperCase() === 'ACCEPTED'
              return (
                <div
                  key={q.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${accepted ? 'border-emerald-300 bg-emerald-50' : 'border-border'}`}
                  data-testid={`order-passport-quote-${q.id}`}
                  data-accepted={accepted ? 'true' : 'false'}
                >
                  <span className="font-medium">{formatMoney(q.quote_amount, q.quote_currency)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">Seller {shortId(q.seller_id)}</span>
                    {accepted
                      ? <Badge className="border-transparent bg-emerald-600 text-white"><CheckCircle2 aria-hidden="true" /> Accepted</Badge>
                      : <Badge variant={statusVariant(q.status)}>{labelize(q.status)}</Badge>}
                  </span>
                </div>
              )
            })}
        </PassportSection>

        {/* 5 — Documents & verification (no storage paths/URLs ever) */}
        <PassportSection title="Documents & verification" testId="order-passport-documents">
          {documents.length === 0
            ? <EmptyNote testId="order-passport-documents-empty" />
            : (
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-document-${d.id}`}>
                    <span className="font-medium">{labelize(d.document_type)}</span>
                    <Badge variant={statusVariant(d.verification_status)}>{labelize(d.verification_status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
        </PassportSection>

        {/* 6 — Payment milestones (non-custodial: tracking only) */}
        <PassportSection title="Payment milestones" testId="order-passport-milestones">
          {milestones.length === 0
            ? <EmptyNote testId="order-passport-milestones-empty" />
            : (
              <ul className="space-y-2">
                {milestones.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-milestone-${m.id}`}>
                    <span className="font-medium">{labelize(m.milestone_type)}</span>
                    <span className="flex items-center gap-2">
                      <span>{formatMoney(m.amount, m.currency)}</span>
                      <Badge variant={statusVariant(m.status)}>{labelize(m.status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <p className="text-xs text-muted-foreground" data-testid="order-passport-milestones-note">
            Milestones record payment progress reported by the trade parties. CarUp does not hold, receive or guarantee funds.
          </p>
        </PassportSection>

        {/* 6b — Record a milestone (shared card; totals, remaining balance vs accepted quote/budget,
            confirm step, per-submit idempotency; backend enforces authz + cumulative cap) */}
        <PaymentMilestonesCard
          orderId={order.id}
          milestones={milestones}
          quotes={quotes}
          budgetAmount={order.budget_amount}
          budgetCurrency={order.budget_currency}
          onRefresh={load}
        />

        {/* 7 — Cargo reservation */}
        <PassportSection title="Cargo reservation" testId="order-passport-reservations">
          {reservations.length === 0
            ? <EmptyNote testId="order-passport-reservations-empty" />
            : (
              <ul className="space-y-2">
                {reservations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-reservation-${r.id}`}>
                    <span className="font-medium">Volume: {r.estimated_volume ?? 'not set'}</span>
                    <Badge variant={statusVariant(r.reservation_status)}>{labelize(r.reservation_status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
        </PassportSection>

        {/* 8 — Shipment & timeline */}
        <PassportSection title="Shipment & timeline" testId="order-passport-shipment">
          {shipments.length === 0
            ? <EmptyNote testId="order-passport-shipments-empty" />
            : (
              <>
                <ul className="space-y-2">
                  {shipments.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-shipment-${s.id}`}>
                      <span className="font-medium">Shipment {shortId(s.id)}</span>
                      <Badge variant={statusVariant(s.status)}>{labelize(s.status)}</Badge>
                    </li>
                  ))}
                </ul>
                <Separator />
                <p className="font-medium">Stage timeline</p>
                {timeline === null
                  ? <UnavailableNote testId="order-passport-timeline-unavailable">The shipment stage timeline is unavailable right now.</UnavailableNote>
                  : timeline.length === 0
                    ? <EmptyNote testId="order-passport-timeline-empty" />
                    : (
                      <ol className="space-y-1">
                        {timeline.map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-stage-${e.id}`}>
                            <span>{labelize(e.stage)}</span>
                            <span className="text-muted-foreground">{formatDate(e.created_at)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
              </>
            )}
        </PassportSection>

        {/* 9 — Compliance & government footprint */}
        <PassportSection title="Compliance & government footprint" testId="order-passport-compliance">
          {reviews.length === 0
            ? <EmptyNote testId="order-passport-reviews-empty">No compliance reviews recorded</EmptyNote>
            : (
              <ul className="space-y-2">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-review-${r.id}`}>
                    <span className="font-medium">{labelize(r.review_type || 'review')}</span>
                    <Badge variant={statusVariant(r.status)}>{labelize(r.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          <Separator />
          {footprint === null
            ? <UnavailableNote testId="order-passport-footprint-unavailable">The government document footprint is unavailable right now.</UnavailableNote>
            : footprint.length === 0
              ? <EmptyNote testId="order-passport-footprint-empty" />
              : (
                <>
                  <p className="font-medium" data-testid="order-passport-footprint-summary">
                    {verifiedRequiredDocs.length} of {requiredDocs.length} required documents verified
                  </p>
                  <ul className="space-y-2">
                    {footprint.map((f) => (
                      <li key={f.category} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-footprint-${f.category}`}>
                        <span className="flex items-center gap-2">
                          {labelize(f.category)}
                          {f.requiredForZimbabweReady && <Badge variant="outline">Required</Badge>}
                        </span>
                        <Badge variant={statusVariant(f.status)}>{labelize(f.status)}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
        </PassportSection>

        {/* 10 — Vehicle import record & ownership handoff */}
        <PassportSection title="Vehicle import record & ownership handoff" testId="order-passport-handoff">
          <Field label="Linked vehicle VIN" value={order.linked_vehicle_vin || 'Not linked'} testId="order-passport-vin" />
          {handoffFailed
            ? <UnavailableNote testId="order-passport-handoff-unavailable">The ownership handoff status is unavailable right now.</UnavailableNote>
            : handoff?.handedOff
              ? (
                <>
                  <Field
                    label="Ownership handoff"
                    value={<Badge className="border-transparent bg-emerald-600 text-white" data-testid="order-passport-handoff-badge">Handed off</Badge>}
                  />
                  <Field label="Vehicle VIN" value={handoff.vehicleVin || 'Not recorded'} testId="order-passport-handoff-vin" />
                  {(handoff.evidence?.length ?? 0) > 0 && (
                    <p className="flex items-center gap-2 text-emerald-700" data-testid="order-passport-handoff-evidence">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Verified import completed
                    </p>
                  )}
                </>
              )
              : <p className="text-muted-foreground" data-testid="order-passport-handoff-pending">Not yet handed off</p>}
        </PassportSection>

        {/* 11 — Disputes (post-MVP here; do not fetch SafeTrade) */}
        <PassportSection title="Disputes" testId="order-passport-disputes">
          <p className="text-muted-foreground" data-testid="order-passport-disputes-note">
            Dispute records are available in SafeTrade when enabled.
          </p>
        </PassportSection>

        {/* 12 — Audit history (newest first, capped at 50; full sealed trail is server-side) */}
        <PassportSection title="Audit history" testId="order-passport-audit">
          {audit === null
            ? <UnavailableNote testId="order-passport-audit-unavailable">The audit history is unavailable right now.</UnavailableNote>
            : sortedAudit.length === 0
              ? <EmptyNote testId="order-passport-audit-empty" />
              : (
                <ul className="space-y-2">
                  {sortedAudit.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-audit-${a.id}`}>
                      <span className="font-medium">{labelize(a.action)}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span>Actor {shortId(a.actor_id)}</span>
                        <span>{formatDate(a.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          <p className="text-xs text-muted-foreground" data-testid="order-passport-audit-note">
            Showing up to the latest 50 entries. The full sealed audit trail is retained server-side.
          </p>
        </PassportSection>
      </div>
    </main>
  )
}
