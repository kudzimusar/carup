/**
 * RX-06 — Import Order › Shipping & CAP.
 *
 *  - RX06-LR04 CAP S1: "Journey & arrival" first — the CAP Journey projection, read from the server
 *    (OrderJourneyPanel), when the page passes a `journey` read. Without one, nothing is drawn for it.
 *  - The order status steps (reservation → booking → loading → departure → arrival → customs → release →
 *    Zimbabwe-ready) derived ONLY from the order status and the reservation records, each step saying
 *    which record it comes from.
 *  - Container allocation: the order's reservations, the buyer's request form (only while no active
 *    reservation exists and a container is open), cancel for the buyer, approve/reject for operators.
 *  - The shipment record and its milestone events exactly as logistics recorded them. Vessel, voyage
 *    and ETA appear only when recorded; otherwise the page says they were not provided.
 *  - Logistics controls for CarUp operations (create the shipment record, set its stage).
 */
import { Link } from 'react-router-dom'
import { Anchor, Check, CircleDashed, Container, HelpCircle, Ship } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_DANGER, WS_FIELD, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaCargoReservation, DiasporaContainerShipment, DiasporaShipment, DiasporaShipmentStageEvent } from '@/types'
import type { Journey } from '../journey/journeyTypes'
import {
  RESERVATION_CARGO_TYPES,
  SHIPMENT_COORDINATION_NOTE,
  SHIPMENT_STAGES,
  activeReservation,
  actorLabel,
  buildShipmentTimeline,
  formatDay,
  formatWhen,
  isTradeOperator,
  place,
  readReady,
  recordStatusTone,
  sentence,
  statusOutcome,
  timeOf,
  type Read,
  type TradeOrder,
} from './orderModel'
import type { OrderLogistics, TradeViewer } from './orderViewTypes'
import { useOrderSurface } from './orderLinks'
import { NotRecorded, Panel, Provenance, ReadGate, RefCode } from './TradeKit'
import { OrderJourneyPanel } from './OrderJourneyPanel'

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function OrderShippingPanel({ order, viewer, logistics, stageEvents, journey }: {
  order: TradeOrder
  viewer: TradeViewer
  logistics?: OrderLogistics
  stageEvents?: Read<Record<string, DiasporaShipmentStageEvent[]>>
  /** RX06-LR04 CAP S1: the server's Journey projection for this order (omitted: no journey section). */
  journey?: Read<Journey>
}) {
  const reservations: Read<DiasporaCargoReservation[]> = logistics?.reservations ?? readReady(order.diaspora_cargo_reservations ?? [])
  const shipments: Read<DiasporaShipment[]> = logistics?.shipments ?? readReady(order.diaspora_shipments ?? [])
  const operator = isTradeOperator(viewer.role)
  return (
    <div className="space-y-5" data-testid="trade-shipping">
      <p className="flex items-start gap-2 rounded-control bg-carup-bg-surface px-3 py-2.5 text-sm leading-6 text-carup-text-2" data-testid="diaspora-shipment-coordination-note">
        <Ship className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
        <span>{SHIPMENT_COORDINATION_NOTE} CarUp never estimates a departure or arrival date.</span>
      </p>
      {journey && <OrderJourneyPanel orderId={order.id} journey={journey} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CapJourney order={order} reservations={reservations} />
        <div className="min-w-0 space-y-5">
          <Allocation order={order} reservations={reservations} logistics={logistics} operator={operator} />
          <ShipmentRecord shipments={shipments} stageEvents={stageEvents} viewer={viewer} logistics={logistics} operator={operator} />
        </div>
      </div>
      {logistics?.actionError && <WorkspaceNotice tone="danger" testId="diaspora-shipment-action-error">{logistics.actionError}</WorkspaceNotice>}
    </div>
  )
}

/* ── Order status steps (the client-derived ladder; test ids kept from "CAP journey") ─────────── */

function CapJourney({ order, reservations }: { order: TradeOrder; reservations: Read<DiasporaCargoReservation[]> }) {
  const known = reservations.state === 'ready'
  const steps = buildShipmentTimeline(order, known ? reservations.data : [])
  const outcome = statusOutcome(order.status)
  return (
    <Panel title="Order status steps" eyebrow="From reservation to Zimbabwe-ready" testId="trade-cap-journey">
      {outcome && <p className="mb-3 rounded-control bg-status-warning-soft px-3 py-2 text-sm text-carup-text" role="status" data-testid="trade-cap-outcome">{outcome.timeline}</p>}
      {!known && <p className="mb-3 text-xs text-carup-text-3" data-testid="trade-cap-reservations-unknown">The reservation records could not be read, so the first two steps are not known.</p>}
      <ol className="relative">
        {steps.map((step, i) => {
          const unknown = !known && step.key.startsWith('reservation')
          const last = i === steps.length - 1
          return (
            <li key={step.key} className="relative flex gap-3" data-testid="trade-cap-step" data-reached={unknown ? 'unknown' : step.reached ? 'true' : 'false'} data-current={step.current ? 'true' : 'false'} aria-current={step.current ? 'step' : undefined}>
              <div className="flex flex-col items-center" aria-hidden="true">
                <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                  unknown ? 'border-dashed border-carup-line-strong text-carup-text-3' : step.reached ? 'border-carup-text bg-carup-text text-carup-bg-raised' : 'border-carup-line-strong text-carup-text-3')}
                  style={step.current ? { background: 'var(--carup-raw-orange-signal)', borderColor: 'var(--carup-raw-orange-signal)' } : undefined}>
                  {unknown ? <HelpCircle className="h-3.5 w-3.5" /> : step.reached ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                </span>
                {!last && <span className={cn('w-0.5 flex-1', step.reached && !unknown ? 'bg-carup-text' : 'bg-carup-line')} />}
              </div>
              <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
                <p className={cn('text-sm', step.reached && !unknown ? 'font-semibold text-carup-text' : 'text-carup-text-2')}>
                  {step.label}
                  <span className="sr-only"> — {unknown ? 'not known' : step.reached ? (step.current ? 'latest recorded step' : 'recorded') : 'not recorded yet'}</span>
                </p>
                <p className="text-xs text-carup-text-3">
                  {unknown ? 'Reservation records unavailable'
                    : step.reached ? (step.source === 'reservation' ? 'From the reservation record' : 'From the order status')
                    : 'Not recorded yet'}
                  {step.current && ' · latest'}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

/* ── Container allocation ─────────────────────────────────────────────────────────────────────── */

function containerLabel(c: DiasporaContainerShipment): string {
  const route = `${place(c.origin_city, c.origin_country) ?? 'Origin not recorded'} → ${place(c.destination_city, c.destination_country) ?? 'destination not recorded'}`
  const dep = formatDay(c.departure_date)
  const free = c.available_capacity_volume ?? null
  return `${route} · ${dep ? `departure ${dep}` : 'departure not set'} · ${free === null ? 'free space not recorded' : `${free} m³ free`}`
}

function Allocation({ order, reservations, logistics, operator }: {
  order: TradeOrder
  reservations: Read<DiasporaCargoReservation[]>
  logistics?: OrderLogistics
  operator: boolean
}) {
  return (
    <Panel title="Container allocation" eyebrow="Your space in a shared container" testId="trade-allocation">
      <ReadGate read={reservations} label="the container reservations" testId="trade-reservations-read">
        {rows => {
          const active = activeReservation(rows)
          const sorted = [...rows].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))
          return (
            <div className="space-y-4">
              {sorted.length === 0 ? (
                <p className="text-sm text-carup-text-2" data-testid="diaspora-reservation-empty">No container space has been reserved for this order yet.</p>
              ) : (
                <ul className="space-y-2">
                  {sorted.map(r => (
                    <li key={r.id} className="rounded-control border border-carup-line p-3" data-testid="diaspora-reservation-row">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-carup-text">{sentence(r.cargo_type, 'Cargo')} · {r.estimated_volume ?? '—'} m³ <span className="font-normal text-carup-text-3">as requested</span></p>
                        <StatusChip tone={recordStatusTone(r.reservation_status)} testId="diaspora-reservation-status">{sentence(r.reservation_status)}</StatusChip>
                      </div>
                      <p className="mt-1 text-xs text-carup-text-3">
                        Requested {formatDay(r.created_at) ?? 'on a date not recorded'}
                        {r.container_id && <> · container <code className="font-mono">{r.container_id.slice(0, 8)}</code></>}
                      </p>
                      {r.reservation_status === 'REQUESTED' && logistics?.onReviewReservation && (
                        operator ? (
                          <div className="mt-2 flex flex-wrap gap-2" data-testid="diaspora-shipment-admin-controls">
                            <button type="button" className={WS_PRIMARY} onClick={() => logistics.onReviewReservation?.(r.id, 'approve')} data-testid="diaspora-reservation-approve-button">Approve</button>
                            <button type="button" className={WS_DANGER} onClick={() => logistics.onReviewReservation?.(r.id, 'reject')} data-testid="diaspora-reservation-reject-button">Reject</button>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <button type="button" className={WS_SECONDARY} onClick={() => logistics.onReviewReservation?.(r.id, 'cancel')} data-testid="diaspora-reservation-cancel-button">Cancel request</button>
                          </div>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!active && <RequestSpace order={order} logistics={logistics} />}
            </div>
          )
        }}
      </ReadGate>
    </Panel>
  )
}

function RequestSpace({ order, logistics }: { order: TradeOrder; logistics?: OrderLogistics }) {
  const { toolLinks } = useOrderSurface()
  if (!logistics) return null
  return (
    <ReadGate read={logistics.containers} label="the open containers" testId="trade-containers-read">
      {containers => {
        if (containers.length === 0) {
          return (
            <p className="text-sm text-carup-text-2" data-testid="diaspora-no-containers">
              No open containers are currently accepting reservations. Check back once a coordinator opens booking.{toolLinks && ' '}
              {toolLinks && <Link to="/diaspora/containers" className="font-semibold text-carup-action underline-offset-4 hover:underline">See shared containers</Link>}
            </p>
          )
        }
        const form = logistics.reservationForm
        if (!form) return null
        return (
          <form onSubmit={form.onSubmit} className="space-y-3 border-t border-carup-line pt-4" data-testid="diaspora-request-reservation">
            <div>
              <h3 className="text-sm font-semibold text-carup-text">Request container space</h3>
              <p className="mt-0.5 text-xs leading-5 text-carup-text-2">A logistics coordinator reviews availability — a request does not confirm a booking.</p>
            </div>
            <label className="block"><span className={WS_LABEL}>Container</span>
              <select className={WS_FIELD} value={form.value.container_id} onChange={e => form.onChange({ container_id: e.target.value })} data-testid="diaspora-reservation-container-select">
                <option value="">Select a container…</option>
                {containers.map(c => <option key={c.id} value={c.id} data-testid="diaspora-container-option">{containerLabel(c)}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={WS_LABEL}>Cargo</span>
                <select className={WS_FIELD} value={form.value.cargo_type} onChange={e => form.onChange({ cargo_type: e.target.value })} data-testid="diaspora-reservation-cargo-select">
                  {RESERVATION_CARGO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block"><span className={WS_LABEL}>Estimated volume (m³)</span>
                <input type="number" min="0" step="0.1" inputMode="decimal" className={WS_FIELD} value={form.value.estimated_volume} onChange={e => form.onChange({ estimated_volume: e.target.value })} data-testid="diaspora-reservation-volume-input" />
              </label>
            </div>
            <button type="submit" className={cn(WS_PRIMARY, 'w-full sm:w-auto')} disabled={form.submitting} data-testid="diaspora-request-reservation-button">
              <Container className="h-4 w-4" aria-hidden="true" /> {form.submitting ? 'Submitting…' : 'Request container space'}
            </button>
            <p className="text-xs text-carup-text-3">For order <code className="font-mono">{order.id.slice(0, 8)}</code>.</p>
          </form>
        )
      }}
    </ReadGate>
  )
}

/* ── Shipment record and milestone events ─────────────────────────────────────────────────────── */

function ShipmentRecord({ shipments, stageEvents, viewer, logistics, operator }: {
  shipments: Read<DiasporaShipment[]>
  stageEvents?: Read<Record<string, DiasporaShipmentStageEvent[]>>
  viewer: TradeViewer
  logistics?: OrderLogistics
  operator: boolean
}) {
  return (
    <Panel title="Shipment" eyebrow="As logistics recorded it" testId="trade-shipment">
      <ReadGate read={shipments} label="the shipment records" testId="trade-shipments-read">
        {rows => (
          <div className="space-y-4">
            {rows.length === 0 ? (
              <p className="text-sm leading-6 text-carup-text-2" data-testid="diaspora-shipment-empty">
                No shipment has been recorded for this order yet. Tracking appears here once logistics coordination begins — CarUp shows no departure or arrival before then.
              </p>
            ) : rows.map(s => {
              const meta = (s as DiasporaShipment & { metadata?: Record<string, unknown> | null }).metadata || {}
              const vessel = str(meta.vessel_name) ?? str(meta.vessel)
              const voyage = str(meta.voyage_number) ?? str(meta.voyage)
              const eta = formatDay(s.estimated_arrival_date)
              return (
                <div key={s.id} className="space-y-3" data-testid="diaspora-shipment-details">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <RefCode label="Shipment" value={s.id.slice(0, 8)} full={s.id} />
                    <StatusChip tone={recordStatusTone(s.status)} testId="diaspora-shipment-tracking-status">{sentence(s.status)}</StatusChip>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    <div><dt className="text-xs text-carup-text-3">Carrier</dt><dd className="font-semibold text-carup-text">{s.carrier_name || <NotRecorded />}</dd></div>
                    <div><dt className="text-xs text-carup-text-3">Tracking</dt><dd className="font-semibold text-carup-text">{s.tracking_number ? <code className="font-mono text-xs">{s.tracking_number}</code> : <NotRecorded />}</dd></div>
                    {vessel && <div><dt className="text-xs text-carup-text-3">Vessel</dt><dd className="font-semibold text-carup-text">{vessel}</dd></div>}
                    {voyage && <div><dt className="text-xs text-carup-text-3">Voyage</dt><dd className="font-semibold text-carup-text">{voyage}</dd></div>}
                    <div><dt className="text-xs text-carup-text-3">Port of loading</dt><dd className="font-semibold text-carup-text">{s.origin_port || <NotRecorded />}</dd></div>
                    <div><dt className="text-xs text-carup-text-3">Port of arrival</dt><dd className="font-semibold text-carup-text">{s.destination_port || <NotRecorded />}</dd></div>
                    <div><dt className="text-xs text-carup-text-3">Departure</dt><dd className="font-semibold text-carup-text">{formatDay(s.departure_date) ?? <NotRecorded>Not provided</NotRecorded>}</dd></div>
                    <div>
                      <dt className="text-xs text-carup-text-3">Estimated arrival</dt>
                      <dd className="font-semibold text-carup-text" data-testid="trade-shipment-eta">{eta ?? <NotRecorded>ETA not provided by the carrier</NotRecorded>}</dd>
                      {eta && <dd className="mt-0.5"><Provenance kind="record">Recorded by logistics · not a CarUp estimate</Provenance></dd>}
                    </div>
                    {s.actual_arrival_date && <div><dt className="text-xs text-carup-text-3">Arrived</dt><dd className="font-semibold text-carup-text">{formatDay(s.actual_arrival_date)}</dd></div>}
                  </dl>
                  <StageEvents shipmentId={s.id} stageEvents={stageEvents} viewer={viewer} />
                </div>
              )
            })}
            {operator && logistics && (logistics.onCreateShipment || logistics.stageForm) && (
              <div className="space-y-2 rounded-card border border-carup-line-strong p-3" data-testid="diaspora-shipment-lifecycle-controls">
                <p className="flex items-center gap-2 text-sm font-semibold text-carup-text"><Anchor className="h-4 w-4" aria-hidden="true" /> Logistics controls</p>
                <p className="text-xs leading-5 text-carup-text-2">Shown to CarUp operations roles. CarUp’s server enforces who may record logistics.</p>
                {rows[0] && logistics.stageForm ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="min-w-0"><span className={WS_LABEL}>Shipment stage</span>
                      <select className={WS_FIELD} value={logistics.stageForm.value} onChange={e => logistics.stageForm?.onChange(e.target.value)} data-testid="diaspora-shipment-stage-select">
                        <option value="">Set shipment stage…</option>
                        {SHIPMENT_STAGES.map(stage => <option key={stage} value={stage}>{sentence(stage)}</option>)}
                      </select>
                    </label>
                    <button type="button" className={WS_PRIMARY} onClick={logistics.stageForm.onSubmit} data-testid="diaspora-shipment-update-stage-button">Record stage</button>
                  </div>
                ) : !rows[0] && logistics.onCreateShipment ? (
                  <button type="button" className={WS_PRIMARY} onClick={logistics.onCreateShipment} data-testid="diaspora-shipment-create-button">Create shipment record</button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </ReadGate>
    </Panel>
  )
}

function StageEvents({ shipmentId, stageEvents, viewer }: {
  shipmentId: string
  stageEvents?: Read<Record<string, DiasporaShipmentStageEvent[]>>
  viewer: TradeViewer
}) {
  if (!stageEvents) return null
  return (
    <div className="border-t border-carup-line pt-3" data-testid="trade-stage-events">
      <h3 className="text-sm font-semibold text-carup-text">Milestone events</h3>
      <div className="mt-2">
        <ReadGate read={stageEvents} label="the shipment milestone events" testId="trade-stage-events-read">
          {byShipment => {
            const events = [...(byShipment[shipmentId] ?? [])].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))
            if (events.length === 0) return <p className="text-sm text-carup-text-2" data-testid="trade-stage-events-empty">No milestone events recorded yet.</p>
            return (
              <ol className="space-y-2.5">
                {events.map(e => (
                  <li key={e.id} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3 text-sm" data-testid="trade-stage-event">
                    <span className="tabular-nums text-xs text-carup-text-3">{formatWhen(e.created_at) ?? 'Time not recorded'}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-carup-text">{sentence(e.stage)}</span>
                      {e.notes && <span className="block text-xs text-carup-text-2 [overflow-wrap:anywhere]">{e.notes}</span>}
                      <span className="block text-xs text-carup-text-3">{actorLabel(e.created_by, viewer.id) === 'Not recorded' ? 'Recorder not recorded' : `Recorded by ${actorLabel(e.created_by, viewer.id)}`}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )
          }}
        </ReadGate>
      </div>
    </div>
  )
}
