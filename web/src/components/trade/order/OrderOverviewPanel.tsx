/**
 * RX-06 — Import Order › Overview: the journey ledger (what is on record for each phase), the
 * required-document checklist (uploaded and verified as separate facts), the request as the buyer
 * stated it, participants, a payments summary and the latest recorded activity. CarUp operations also
 * get the operations controls the legacy detail page offered (assign seller, Zimbabwe-ready, link the
 * vehicle record, ownership handoff) — every one still authorized by the backend.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CircleDashed, FileText, HelpCircle, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { positionOf, TRADE_PHASES, type PhaseKey, type PhaseProgress } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_DANGER, WS_FIELD, WS_LABEL, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaOwnershipHandoffStatus, DiasporaTradeDocument } from '@/types'
import {
  REQUIRED_DOCUMENTS,
  REQUIRED_DOCUMENT_TYPES,
  activeReservation,
  actorLabel,
  buildActivity,
  cargoLabel,
  documentTypeLabel,
  formatDay,
  formatWhen,
  isTradeOperator,
  latestSubmissionFor,
  milestoneSummary,
  money,
  orderRank,
  place,
  requiredDocumentState,
  requiredDocumentTally,
  sentence,
  truncateMessage,
  yearsLabel,
  formatAmount,
  type OrderTab,
  REQUIRED_STATE_TONE,
  type Read,
  type TradeOrder,
} from './orderModel'
import { useOrderHref } from './orderLinks'
import type { ImportOrderActions, TradeViewer } from './orderViewTypes'
import { Fact, NotRecorded, Panel, Provenance, RefCode } from './TradeKit'

export function OrderOverviewPanel({ order, viewer, documents, handoff, actions }: {
  order: TradeOrder
  viewer: TradeViewer
  documents: DiasporaTradeDocument[]
  handoff?: Read<DiasporaOwnershipHandoffStatus>
  actions?: ImportOrderActions
}) {
  const operator = isTradeOperator(viewer.role)
  const hasOperatorActions = operator && Boolean(actions?.assignSeller || actions?.markZimbabweReady || actions?.linkVehicleRecord || actions?.completeHandoff)
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]" data-testid="trade-order-overview">
      <div className="min-w-0 space-y-5">
        <JourneyLedger order={order} documents={documents} handoff={handoff} viewer={viewer} />
        <RequiredDocumentsSummary order={order} documents={documents} />
        {hasOperatorActions && actions && <OperationsControls order={order} actions={actions} />}
      </div>
      <aside className="min-w-0 space-y-5" aria-label="Order facts">
        <RequestFacts order={order} viewer={viewer} />
        <Participants order={order} viewer={viewer} />
        <PaymentsSummary order={order} />
        <LatestActivity order={order} viewer={viewer} documents={documents} />
      </aside>
    </div>
  )
}

/* ── Journey ledger ───────────────────────────────────────────────────────────────────────────── */

const PROGRESS_WORD: Record<PhaseProgress, string> = {
  passed: 'Earlier stage',
  current: 'Now',
  upcoming: 'Not reached',
  unknown: 'Not known',
}

const PHASE_TAB: Record<PhaseKey, { tab: OrderTab | 'passport'; label: string }> = {
  request: { tab: 'quotes', label: 'Quotes' },
  documents: { tab: 'documents', label: 'Documents' },
  loading: { tab: 'shipping', label: 'Shipping & CAP' },
  sea: { tab: 'shipping', label: 'Shipping & CAP' },
  customs: { tab: 'customs', label: 'Customs' },
  ready: { tab: 'customs', label: 'Government records' },
  handover: { tab: 'passport', label: 'Passport' },
}

function phaseEvidence(key: PhaseKey, order: TradeOrder, documents: DiasporaTradeDocument[], handoff: Read<DiasporaOwnershipHandoffStatus> | undefined, viewerId?: string | null): ReactNode {
  switch (key) {
    case 'request': {
      const quotes = order.diaspora_import_quotes ?? []
      const accepted = quotes.find(q => String(q.status || '').toUpperCase() === 'ACCEPTED')
      const sellers = (order.diaspora_import_order_participants ?? []).filter(p => String(p.participant_role || '').toLowerCase() === 'seller')
      return (
        <>
          {quotes.length === 0 ? 'No quotes recorded yet.' : `${quotes.length} quote${quotes.length === 1 ? '' : 's'} recorded${accepted ? ` · accepted: ${money(accepted.quote_amount, accepted.quote_currency) ?? 'amount not recorded'}` : ''}.`}{' '}
          {sellers.length === 0 ? 'No seller assigned yet.' : `Seller assigned (${actorLabel(sellers[0].user_id, viewerId)}).`}
        </>
      )
    }
    case 'documents': {
      const t = requiredDocumentTally(documents)
      return `${t.uploaded} of ${t.total} required uploaded · ${t.verified} verified${t.rejected ? ` · ${t.rejected} rejected or flagged` : ''}${t.reviewNeeded ? ` · ${t.reviewNeeded} need CarUp to confirm` : ''}.`
    }
    case 'loading': {
      const reservations = order.diaspora_cargo_reservations ?? []
      const active = activeReservation(reservations)
      const booked = orderRank(order.status) >= orderRank('CONTAINER_BOOKED')
      let text: string
      if (active) {
        text = active.reservation_status === 'APPROVED'
          ? 'Container space approved by CarUp logistics.'
          : active.reservation_status === 'REQUESTED' ? 'Container space requested — awaiting CarUp logistics.' : `Container reservation: ${sentence(active.reservation_status)}.`
      } else if (reservations.length > 0) {
        text = `${reservations.length} container request${reservations.length === 1 ? '' : 's'} on record, none active.`
      } else {
        text = 'No container reservation is recorded.'
      }
      if (booked) text += ' The order status records the booking.'
      return <span data-testid="trade-shipment-state">{text}</span>
    }
    case 'sea': {
      const shipment = (order.diaspora_shipments ?? [])[0]
      if (!shipment) return 'No shipment record yet — departure is shown only once logistics record it.'
      const eta = formatDay(shipment.estimated_arrival_date)
      return `Shipment ${sentence(shipment.status).toLowerCase()}${shipment.carrier_name ? ` · carrier ${shipment.carrier_name}` : ''} · ${eta ? `estimated arrival recorded: ${eta}` : 'ETA not provided by the carrier'}.`
    }
    case 'customs': {
      const reviews = order.diaspora_compliance_reviews ?? []
      const duty = (order.diaspora_payment_milestones ?? []).filter(m => String(m.milestone_type).toUpperCase() === 'CUSTOMS_DUTY')
      return (
        <>
          {reviews.length === 0 ? 'No compliance review recorded.' : `${reviews.length} compliance review${reviews.length === 1 ? '' : 's'}: ${reviews.map(r => sentence(r.status).toLowerCase()).join(', ')}.`}{' '}
          {duty.length === 0 ? 'Duty: not recorded.' : `Duty milestone recorded: ${duty.map(d => money(d.amount, d.currency)).filter(Boolean).join(', ') || 'amount not recorded'} (a reference, not an assessment).`}
        </>
      )
    }
    case 'ready':
      return 'Registration, roadworthiness, insurance and the other government records appear under Customs as they are recorded.'
    case 'handover': {
      const vin = order.linked_vehicle_vin
      const status = !handoff ? '' : handoff.state === 'ready'
        ? (handoff.data.handedOff ? ' Ownership handoff recorded.' : ' Ownership handoff not recorded.')
        : handoff.state === 'loading' ? '' : ' Handoff status could not be read.'
      return <>{vin ? <>Vehicle record linked · VIN <code className="font-mono text-xs">{vin}</code>.</> : 'No vehicle record linked yet.'}{status}</>
    }
  }
}

function PhaseMarker({ progress }: { progress: PhaseProgress }) {
  if (progress === 'passed') {
    return <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-carup-text text-carup-bg-raised"><Check className="h-3 w-3" /></span>
  }
  if (progress === 'current') {
    return <span className="mt-0.5 flex h-5 w-5 shrink-0 rounded-full" style={{ background: 'var(--carup-raw-orange-signal)', boxShadow: '0 0 0 4px color-mix(in srgb, var(--carup-raw-orange-signal) 22%, transparent)' }} />
  }
  if (progress === 'unknown') return <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-carup-text-3" />
  return <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-carup-text-3" />
}

function JourneyLedger({ order, documents, handoff, viewer }: {
  order: TradeOrder
  documents: DiasporaTradeDocument[]
  handoff?: Read<DiasporaOwnershipHandoffStatus>
  viewer: TradeViewer
}) {
  const orderHref = useOrderHref()
  const pos = positionOf(order.status)
  return (
    <Panel
      title="Journey ledger"
      eyebrow="What is on record, phase by phase"
      testId="trade-journey-ledger"
    >
      <p className="-mt-1 mb-3 text-sm text-carup-text-2">Each phase shows only what CarUp has recorded for this order. Nothing here is estimated.</p>
      <ol className="divide-y divide-carup-line">
        {TRADE_PHASES.map((phase, i) => {
          const progress = pos.phases[i]?.progress ?? 'unknown'
          const reached = progress === 'passed' || progress === 'current'
          const link = PHASE_TAB[phase.key]
          return (
            <li
              key={phase.key}
              data-testid="diaspora-timeline-item"
              data-phase={phase.key}
              data-reached={reached ? 'true' : 'false'}
              aria-current={progress === 'current' ? 'step' : undefined}
              className="grid gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-start"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span aria-hidden="true"><PhaseMarker progress={progress} /></span>
                <div className="min-w-0">
                  <p className={cn('text-sm font-semibold', progress === 'upcoming' || progress === 'unknown' ? 'text-carup-text-2' : 'text-carup-text')}>{phase.label}</p>
                  <p className={cn('text-xs', progress === 'current' ? 'font-semibold text-carup-text' : 'text-carup-text-3')}>{PROGRESS_WORD[progress]}</p>
                </div>
              </div>
              <p className="min-w-0 pl-[1.875rem] text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere] sm:pl-0">{phaseEvidence(phase.key, order, documents, handoff, viewer.id)}</p>
              <Link to={orderHref(order.id, link.tab)} className={cn(WS_TEXT_ACTION, 'pl-[1.875rem] sm:pl-1')} data-testid={`trade-journey-link-${phase.key}`}>
                {link.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

/* ── Required documents (compact) ─────────────────────────────────────────────────────────────── */

function RequiredDocumentsSummary({ order, documents }: { order: TradeOrder; documents: DiasporaTradeDocument[] }) {
  const orderHref = useOrderHref()
  return (
    <Panel
      title="Required documents"
      eyebrow="Uploaded and verified are separate facts"
      testId="diaspora-document-checklist"
      action={<Link to={orderHref(order.id, 'documents')} className={WS_TEXT_ACTION} data-testid="diaspora-open-documents-button">Open documents <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
    >
      <ul className="divide-y divide-carup-line">
        {REQUIRED_DOCUMENTS.map((name, index) => {
          const state = requiredDocumentState(name, documents)
          const latest = latestSubmissionFor(name, documents)
          const uploaded = state !== 'Pending'
          const verified = state === 'Verified'
          return (
            <li key={name} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4" data-testid="diaspora-document-row">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-carup-text" data-testid={`diaspora-document-name-${index}`}>{name}</p>
                  <p className="text-xs text-carup-text-3">Accepted as: {(REQUIRED_DOCUMENT_TYPES[name] ?? []).map(documentTypeLabel).join(', ')}</p>
                </div>
              </div>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs sm:pl-0" data-testid={`diaspora-document-facts-${index}`}>
                <div className="flex gap-1"><dt className="text-carup-text-3">Uploaded</dt><dd className="font-semibold text-carup-text">{uploaded ? `Yes${latest?.created_at ? ` · ${formatDay(latest.created_at)}` : ''}` : 'No'}</dd></div>
                <div className="flex gap-1"><dt className="text-carup-text-3">Verified</dt><dd className="font-semibold text-carup-text">{verified ? 'Yes' : 'No'}</dd></div>
              </dl>
              <div className="pl-6 sm:pl-0">
                <StatusChip tone={REQUIRED_STATE_TONE[state]} testId={`diaspora-document-status-${index}`}>{state}</StatusChip>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/* ── Aside: the request, participants, payments, latest activity ─────────────────────────────── */

function RequestFacts({ order, viewer }: { order: TradeOrder; viewer: TradeViewer }) {
  const own = Boolean(viewer.id && order.buyer_id && viewer.id === order.buyer_id)
  const budget = money(order.budget_amount, order.budget_currency)
  return (
    <Panel title="The request" eyebrow="As the buyer stated it" testId="trade-order-request">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Vehicle" className="col-span-2" testId="diaspora-order-type">
          {[order.requested_make, order.requested_model].filter(Boolean).join(' ') || <NotRecorded />}
          {yearsLabel(order.requested_year_min, order.requested_year_max) && <span className="font-normal text-carup-text-2"> · {yearsLabel(order.requested_year_min, order.requested_year_max)}</span>}
        </Fact>
        <Fact label="Cargo">{cargoLabel(order.order_type)}</Fact>
        <Fact label="Recorded">{formatDay(order.created_at) ?? <NotRecorded />}</Fact>
        <Fact label="From" testId="diaspora-order-origin">{place(order.origin_city, order.origin_country) ?? <NotRecorded />}</Fact>
        <Fact label="To" testId="diaspora-order-destination">{place(order.destination_city, order.destination_country) ?? <NotRecorded />}</Fact>
        <Fact
          label="Budget"
          className="col-span-2"
          testId="diaspora-order-budget"
          provenance={budget ? <Provenance kind="stated">{own ? 'Stated by you' : 'Stated by the buyer'} · not a price or a quote</Provenance> : undefined}
        >
          {budget ?? <NotRecorded>Not stated</NotRecorded>}
        </Fact>
        <Fact label="Reference" className="col-span-2"><RefCode value={order.id} /></Fact>
      </dl>
    </Panel>
  )
}

function Participants({ order, viewer }: { order: TradeOrder; viewer: TradeViewer }) {
  const participants = order.diaspora_import_order_participants ?? []
  return (
    <Panel title="Participants" testId="trade-order-participants">
      <ul className="space-y-2.5 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-carup-text">Buyer</span>
          <span className="text-carup-text-2">{actorLabel(order.buyer_id, viewer.id)}</span>
        </li>
        {participants.map(p => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`trade-order-participant-${p.id}`}>
            <span className="font-semibold text-carup-text">{sentence(p.participant_role, 'Participant')}</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-carup-text-2">{actorLabel(p.user_id ?? p.id, viewer.id)}</span>
              {p.verification_status && <StatusChip tone={p.verification_status.toUpperCase() === 'VERIFIED' ? 'success' : 'neutral'}>{sentence(p.verification_status)}</StatusChip>}
            </span>
          </li>
        ))}
      </ul>
      {participants.length === 0 && (
        <p className="mt-3 text-xs leading-5 text-carup-text-3" data-testid="trade-order-participants-empty">
          No seller, agent or logistics partner is assigned yet. CarUp operations assign participants; they appear here once recorded.
        </p>
      )}
    </Panel>
  )
}

function PaymentsSummary({ order }: { order: TradeOrder }) {
  const orderHref = useOrderHref()
  const milestones = order.diaspora_payment_milestones ?? []
  const summary = milestoneSummary(milestones, order.diaspora_import_quotes, order.budget_amount, order.budget_currency)
  return (
    <Panel
      title="Payments"
      testId="trade-order-payments-summary"
      action={<Link to={orderHref(order.id, 'payments')} className={WS_TEXT_ACTION}>Open <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
    >
      <p className="text-sm text-carup-text">
        {milestones.length === 0
          ? 'No payment milestones recorded.'
          : `${milestones.length} milestone${milestones.length === 1 ? '' : 's'} recorded${summary.totals.length ? ` · active ${summary.totals.map(t => formatAmount(t.total, t.currency)).join(' + ')}` : ''}.`}
      </p>
      <p className="mt-2 text-xs leading-5 text-carup-text-3" data-testid="trade-order-payments-mode">
        Reference records only — CarUp does not hold or move money on import orders. Live payments are off.
      </p>
    </Panel>
  )
}

function LatestActivity({ order, viewer, documents }: { order: TradeOrder; viewer: TradeViewer; documents: DiasporaTradeDocument[] }) {
  const orderHref = useOrderHref()
  const events = buildActivity({ order, documents }).slice(0, 3)
  return (
    <Panel
      title="Latest activity"
      testId="trade-order-latest-activity"
      action={<Link to={orderHref(order.id, 'activity')} className={WS_TEXT_ACTION}>All <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
    >
      {events.length === 0 ? (
        <p className="text-sm text-carup-text-3">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map(e => (
            <li key={e.id} className="text-sm">
              <p className="font-semibold text-carup-text">{e.title}</p>
              <p className="text-xs text-carup-text-3">{formatWhen(e.at) ?? 'Time not recorded'} · {actorLabel(e.actorId, viewer.id)}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/* ── Operations controls (CarUp operations only; the backend authorizes every call) ──────────── */

function OperationsControls({ order, actions }: { order: TradeOrder; actions: ImportOrderActions }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [actionError, setActionError] = useState('')
  const [sellerId, setSellerId] = useState('')
  const [vin, setVin] = useState('')
  const [chassis, setChassis] = useState('')
  const [confirming, setConfirming] = useState<'ready' | 'handoff' | null>(null)

  const run = async (fn: () => Promise<string>, errorPrefix = '') => {
    if (busy) return
    setBusy(true)
    setResult('')
    setActionError('')
    try {
      setResult(await fn())
    } catch (err) {
      setActionError(`${errorPrefix}${truncateMessage(err, 'Action failed')}`)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const row = 'grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end'
  return (
    <Panel
      id="order-operations"
      title="Operations controls"
      eyebrow="CarUp operations · recorded with your account"
      testId="diaspora-order-reviewer-actions"
      action={<ShieldCheck className="h-5 w-5 text-carup-text-3" aria-hidden="true" />}
    >
      <p className="-mt-1 mb-3 text-xs leading-5 text-carup-text-2">Shown because this account has an operations role. CarUp’s server decides whether each action is allowed and records who did it.</p>
      <div className="divide-y divide-carup-line">
        {actions.assignSeller && (
          <div className={row}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-carup-text">Assign a seller</p>
              <p className="text-xs leading-5 text-carup-text-2">Adds the seller as a participant and moves the order to “Seller assigned”.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className={WS_LABEL}>Seller account id</span>
                <input value={sellerId} onChange={e => setSellerId(e.target.value)} className={WS_FIELD} data-testid="diaspora-reviewer-seller-input" />
              </label>
              <button type="button" className={WS_SECONDARY} disabled={busy || !sellerId.trim()} data-testid="diaspora-reviewer-assign-seller"
                onClick={() => run(async () => { await actions.assignSeller?.(sellerId.trim()); return 'Seller assigned.' })}>
                Assign seller
              </button>
            </div>
          </div>
        )}
        {actions.linkVehicleRecord && (
          <div className={row}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-carup-text">Link the vehicle import record</p>
              <p className="text-xs leading-5 text-carup-text-2">Records the imported vehicle’s VIN (and chassis, if known) against this order.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="min-w-0"><span className={WS_LABEL}>VIN</span><input value={vin} onChange={e => setVin(e.target.value)} className={cn(WS_FIELD, 'font-mono')} data-testid="diaspora-reviewer-vin-input" /></label>
              <label className="min-w-0"><span className={WS_LABEL}>Chassis (optional)</span><input value={chassis} onChange={e => setChassis(e.target.value)} className={cn(WS_FIELD, 'font-mono')} data-testid="diaspora-reviewer-chassis-input" /></label>
              <button type="button" className={WS_SECONDARY} disabled={busy || !vin.trim()} data-testid="diaspora-reviewer-link-vehicle"
                onClick={() => run(async () => { await actions.linkVehicleRecord?.({ vin: vin.trim(), chassis: chassis.trim() || undefined }); return 'Vehicle import record linked.' })}>
                Link record
              </button>
            </div>
          </div>
        )}
        {actions.markZimbabweReady && (
          <div className={row}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-carup-text">Mark Zimbabwe-ready</p>
              <p className="text-xs leading-5 text-carup-text-2">CarUp refuses this until every required government record is verified.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {confirming === 'ready' ? (
                <>
                  <button type="button" className={WS_DANGER} disabled={busy} data-testid="diaspora-reviewer-zimbabwe-ready"
                    onClick={() => run(async () => { await actions.markZimbabweReady?.(); return 'Order marked Zimbabwe Ready.' }, 'Blocked: ')}>
                    Confirm: mark Zimbabwe-ready
                  </button>
                  <button type="button" className={WS_SECONDARY} onClick={() => setConfirming(null)}>Cancel</button>
                </>
              ) : (
                <button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => setConfirming('ready')} data-testid="diaspora-reviewer-zimbabwe-ready-start">Mark Zimbabwe-ready…</button>
              )}
            </div>
          </div>
        )}
        {actions.completeHandoff && (
          <div className={row}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-carup-text">Complete the ownership handoff</p>
              <p className="text-xs leading-5 text-carup-text-2">Links a Zimbabwe-ready order and its verified import record to the vehicle’s CarUp identity. Repeating it is safe.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {confirming === 'handoff' ? (
                <>
                  <button type="button" className={WS_DANGER} disabled={busy} data-testid="diaspora-reviewer-complete-handoff"
                    onClick={() => run(async () => {
                      const handoff = await actions.completeHandoff?.() as { idempotentReplay?: boolean } | undefined
                      return handoff?.idempotentReplay ? 'Ownership handoff already completed (idempotent replay).' : 'Ownership handoff completed.'
                    })}>
                    Confirm: complete handoff
                  </button>
                  <button type="button" className={WS_SECONDARY} onClick={() => setConfirming(null)}>Cancel</button>
                </>
              ) : (
                <button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => setConfirming('handoff')} data-testid="diaspora-reviewer-complete-handoff-start">Complete ownership handoff…</button>
              )}
            </div>
          </div>
        )}
      </div>
      <div aria-live="polite" className="mt-3">
        {result && <WorkspaceNotice testId="diaspora-reviewer-result">{result}</WorkspaceNotice>}
        {actionError && <WorkspaceNotice tone="danger" testId="diaspora-reviewer-error">{actionError}</WorkspaceNotice>}
      </div>
      <p className="mt-3 text-xs text-carup-text-3">Order <RefCode value={order.id} /></p>
    </Panel>
  )
}
