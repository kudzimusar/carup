/**
 * RX-06 — the Import Order in PASSPORT mode: a read-only record of everything on the order, laid out as
 * one dossier. Same sources and the same guarantees as the legacy passport:
 *  - the order read is the backbone; the government footprint, audit history, ownership-handoff status
 *    and shipment stage timeline are best-effort — a failed one says "unavailable", never "none";
 *  - identities are short references only (never emails or phones); no storage path or file URL ever;
 *  - payment milestones are tracking records — CarUp does not hold, receive or guarantee funds.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BookOpenCheck, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImportOrderLifecycle } from '@/components/trade/core/ImportOrderLifecycleRail'
import { documentState } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaAuditEntry, DiasporaGovernmentDocument, DiasporaOwnershipHandoffStatus, DiasporaShipmentStageEvent } from '@/types'
import {
  activityActorLabel,
  actorLabel,
  auditActionLabel,
  cargoLabel,
  documentTypeLabel,
  formatWhen,
  governmentRecordLabel,
  governmentRecordStatus,
  isZimbabweReadyOrLater,
  money,
  place,
  recordStatusTone,
  sentence,
  shortRef,
  statusLabel,
  timeOf,
  yearsLabel,
  orderStatusTone,
  type Read,
  type TradeOrder,
} from './orderModel'
import { useOrderHref, useOrderSurface } from './orderLinks'
import type { TradeViewer } from './orderViewTypes'
import { NotRecorded, Provenance, RefCode } from './TradeKit'

function Section({ index, title, testId, children }: { index: number; title: string; testId: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-6 gap-y-2 border-t border-carup-line px-4 py-4 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="flex items-baseline gap-2 text-sm font-semibold text-carup-text">
        <span className="font-mono text-xs tabular-nums text-carup-text-3" aria-hidden="true">{String(index).padStart(2, '0')}</span>
        {title}
      </h2>
      <div className="min-w-0 space-y-2 text-sm">{children}</div>
    </section>
  )
}

function Row({ label, children, testId }: { label: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" data-testid={testId}>
      <span className="text-carup-text-2">{label}</span>
      <span className="min-w-0 text-right font-semibold text-carup-text [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

function None({ testId, children = 'None recorded' }: { testId: string; children?: ReactNode }) {
  return <p className="text-carup-text-3" data-testid={testId}>{children}</p>
}

function Unavailable({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-carup-text" data-testid={testId}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />{children}
    </p>
  )
}

export function OrderPassportView({ order, viewer, footprint, audit, handoff, stageEvents }: {
  order: TradeOrder
  viewer: TradeViewer
  footprint?: Read<DiasporaGovernmentDocument[]>
  audit?: Read<DiasporaAuditEntry[]>
  handoff?: Read<DiasporaOwnershipHandoffStatus>
  stageEvents?: Read<Record<string, DiasporaShipmentStageEvent[]>>
}) {
  const { toolLinks } = useOrderSurface()
  const orderHref = useOrderHref()
  const zimReady = isZimbabweReadyOrLater(order.status)
  const participants = order.diaspora_import_order_participants ?? []
  const quotes = order.diaspora_import_quotes ?? []
  const documents = order.diaspora_trade_documents ?? []
  const milestones = order.diaspora_payment_milestones ?? []
  const reservations = order.diaspora_cargo_reservations ?? []
  const shipments = order.diaspora_shipments ?? []
  const reviews = order.diaspora_compliance_reviews ?? []
  const firstShipment = shipments.find(s => s?.id)
  const failed = (r?: Read<unknown>) => Boolean(r && (r.state === 'failed' || r.state === 'denied' || r.state === 'unavailable'))
  const footprintRows = footprint?.state === 'ready' ? footprint.data : null
  const requiredDocs = (footprintRows ?? []).filter(f => f.requiredForZimbabweReady)
  const verifiedRequired = requiredDocs.filter(f => String(f.status || '').toUpperCase() === 'VERIFIED')
  const auditRows = audit?.state === 'ready'
    ? [...audit.data].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0)).slice(0, 50)
    : []
  const timeline = stageEvents?.state === 'ready' && firstShipment ? [...(stageEvents.data[firstShipment.id] ?? [])] : []

  return (
    <article className="overflow-hidden rounded-card border border-carup-line-strong bg-carup-bg-raised" data-testid="order-passport-page" aria-labelledby="order-passport-title">
      <div className="bg-carup-raw-ink px-4 py-5 text-white sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-carup-raw-orange-signal">CarUp Trade · Import order record</p>
        <h2 id="order-passport-title" className="mt-1.5 flex items-center gap-2 text-xl font-bold tracking-[-0.02em]" data-testid="order-passport-title">
          <BookOpenCheck className="h-5 w-5 shrink-0" aria-hidden="true" /> Read-only record of order {shortRef(order.id)}
        </h2>
        <p className="mt-1 text-sm text-white/75">Every line below is read from CarUp’s records for this order. Nothing is estimated, and identities are shown as short references.</p>
      </div>
      <div className="px-4 py-4 sm:px-6"><ImportOrderLifecycle status={order.status} testId="order-passport-lifecycle" /></div>

      <Section index={1} title="Order identity & state" testId="order-passport-identity">
        <Row label="Order id" testId="order-passport-id"><RefCode value={shortRef(order.id)} full={order.id} /></Row>
        <Row label="Order type" testId="order-passport-type">{cargoLabel(order.order_type)}</Row>
        <Row label="Status"><StatusChip tone={orderStatusTone(order.status)} testId="order-passport-status">{statusLabel(order.status)}</StatusChip></Row>
        <Row label="Created" testId="order-passport-created">{formatWhen(order.created_at) ?? <NotRecorded />}</Row>
        <Row label="Origin" testId="order-passport-origin">{place(order.origin_city, order.origin_country) ?? <NotRecorded>Not set</NotRecorded>}</Row>
        <Row label="Destination" testId="order-passport-destination">{place(order.destination_city, order.destination_country) ?? <NotRecorded>Not set</NotRecorded>}</Row>
        <p
          className={cn('flex items-center gap-2 rounded-control border px-3 py-2', zimReady ? 'border-status-success bg-status-success-soft text-carup-text' : 'border-carup-line bg-carup-bg-surface text-carup-text-2')}
          data-testid="order-passport-zim-ready"
          data-zim-ready={zimReady ? 'true' : 'false'}
        >
          {zimReady
            ? <><CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" /> Zimbabwe ready (recorded status)</>
            : <>Not Zimbabwe ready yet — current stage: {statusLabel(order.status)}</>}
        </p>
      </Section>

      <Section index={2} title="Participants" testId="order-passport-participants">
        <Row label="Buyer" testId="order-passport-buyer">{actorLabel(order.buyer_id, viewer.id)}</Row>
        {participants.length === 0 ? <None testId="order-passport-participants-empty" /> : participants.map(p => (
          <Row key={p.id} label={sentence(p.participant_role, 'Participant')} testId={`order-passport-participant-${p.id}`}>
            <span className="inline-flex flex-wrap items-center justify-end gap-2">{actorLabel(p.user_id || p.id, viewer.id)}<StatusChip tone={recordStatusTone(p.verification_status)}>{sentence(p.verification_status, 'Not set')}</StatusChip></span>
          </Row>
        ))}
      </Section>

      <Section index={3} title="Request" testId="order-passport-request">
        {(order.requested_make || order.requested_model || order.requested_year_min || order.requested_year_max || order.budget_amount) ? (
          <>
            <Row label="Requested make" testId="order-passport-make">{order.requested_make || <NotRecorded>Not set</NotRecorded>}</Row>
            <Row label="Requested model" testId="order-passport-model">{order.requested_model || <NotRecorded>Not set</NotRecorded>}</Row>
            <Row label="Year range" testId="order-passport-years">{yearsLabel(order.requested_year_min, order.requested_year_max) ?? <NotRecorded>Not set</NotRecorded>}</Row>
            <Row label="Budget" testId="order-passport-budget">{money(order.budget_amount, order.budget_currency) ?? <NotRecorded>Not set</NotRecorded>}</Row>
          </>
        ) : <None testId="order-passport-request-empty" />}
      </Section>

      <Section index={4} title="Quotations" testId="order-passport-quotes">
        {quotes.length === 0 ? <None testId="order-passport-quotes-empty" /> : quotes.map(q => {
          const accepted = String(q.status || '').toUpperCase() === 'ACCEPTED'
          return (
            <div key={q.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2', accepted ? 'border-status-success bg-status-success-soft' : 'border-carup-line')} data-testid={`order-passport-quote-${q.id}`} data-accepted={accepted ? 'true' : 'false'}>
              <span className="font-semibold tabular-nums text-carup-text">{money(q.quote_amount, q.quote_currency) ?? 'Amount not recorded'}</span>
              <span className="flex flex-wrap items-center gap-2"><span className="text-carup-text-2">Seller {shortRef(q.seller_id)}</span><StatusChip tone={recordStatusTone(q.status)}>{accepted ? 'Accepted' : sentence(q.status)}</StatusChip></span>
            </div>
          )
        })}
      </Section>

      <Section index={5} title="Documents & verification" testId="order-passport-documents">
        {documents.length === 0 ? <None testId="order-passport-documents-empty" /> : documents.map(d => {
          const truth = documentState(d.verification_status || 'UPLOADED')
          return <Row key={d.id} label={documentTypeLabel(d.document_type)} testId={`order-passport-document-${d.id}`}><StatusChip tone={truth.verified ? 'success' : truth.truth === 'rejected' ? 'danger' : truth.truth === 'flagged' ? 'warning' : 'info'}>{truth.label}</StatusChip></Row>
        })}
      </Section>

      <Section index={6} title="Payment milestones" testId="order-passport-milestones">
        {milestones.length === 0 ? <None testId="order-passport-milestones-empty" /> : milestones.map(m => (
          <Row key={m.id} label={sentence(m.milestone_type, 'Milestone')} testId={`order-passport-milestone-${m.id}`}>
            <span className="inline-flex flex-wrap items-center justify-end gap-2"><span className="tabular-nums">{money(m.amount, m.currency) ?? 'Not set'}</span><StatusChip tone={recordStatusTone(m.status)}>{sentence(m.status)}</StatusChip></span>
          </Row>
        ))}
        <p className="text-xs text-carup-text-3" data-testid="order-passport-milestones-note">Milestones record payment progress reported by the trade parties. CarUp does not hold, receive or guarantee funds. {toolLinks && <Link to={orderHref(order.id, 'payments')} className={cn(WS_TEXT_ACTION, 'min-h-0 px-0 text-xs')}>Record one in Payments</Link>}</p>
      </Section>

      <Section index={7} title="Cargo reservation" testId="order-passport-reservations">
        {reservations.length === 0 ? <None testId="order-passport-reservations-empty" /> : reservations.map(r => (
          <Row key={r.id} label={`Volume: ${r.estimated_volume ?? 'not set'}${r.estimated_volume != null ? ' m³' : ''}`} testId={`order-passport-reservation-${r.id}`}><StatusChip tone={recordStatusTone(r.reservation_status)}>{sentence(r.reservation_status)}</StatusChip></Row>
        ))}
      </Section>

      <Section index={8} title="Shipment & timeline" testId="order-passport-shipment">
        {shipments.length === 0 ? <None testId="order-passport-shipments-empty" /> : (
          <>
            {shipments.map(s => <Row key={s.id} label={`Shipment ${shortRef(s.id)}`} testId={`order-passport-shipment-${s.id}`}><StatusChip tone={recordStatusTone(s.status)}>{sentence(s.status)}</StatusChip></Row>)}
            <p className="pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-carup-text-3">Stage timeline</p>
            {failed(stageEvents)
              ? <Unavailable testId="order-passport-timeline-unavailable">The shipment stage timeline is unavailable right now.</Unavailable>
              : timeline.length === 0
                ? <None testId="order-passport-timeline-empty" />
                : timeline.map(e => <Row key={e.id} label={sentence(e.stage)} testId={`order-passport-stage-${e.id}`}><span className="font-normal text-carup-text-2">{formatWhen(e.created_at) ?? 'Not recorded'}</span></Row>)}
          </>
        )}
      </Section>

      <Section index={9} title="Compliance & government footprint" testId="order-passport-compliance">
        {reviews.length === 0 ? <None testId="order-passport-reviews-empty">No compliance reviews recorded</None> : reviews.map(r => (
          <Row key={r.id} label={sentence(r.review_type || 'review')} testId={`order-passport-review-${r.id}`}><StatusChip tone={recordStatusTone(r.status)}>{sentence(r.status)}</StatusChip></Row>
        ))}
        <div className="border-t border-carup-line pt-2">
          {failed(footprint)
            ? <Unavailable testId="order-passport-footprint-unavailable">The government document footprint is unavailable right now.</Unavailable>
            : !footprintRows
              ? <None testId="order-passport-footprint-loading">Loading the government footprint…</None>
              : footprintRows.length === 0
                ? <None testId="order-passport-footprint-empty" />
                : (
                  <>
                    <p className="font-semibold text-carup-text" data-testid="order-passport-footprint-summary">{verifiedRequired.length} of {requiredDocs.length} required documents verified</p>
                    {footprintRows.map(f => {
                      const st = governmentRecordStatus(f.status)
                      return <Row key={f.category} label={<>{governmentRecordLabel(f.category)}{f.requiredForZimbabweReady && <span className="ml-1.5 text-xs text-carup-text-3">required</span>}</>} testId={`order-passport-footprint-${f.category}`}><StatusChip tone={st.tone} className="whitespace-nowrap">{st.label}</StatusChip></Row>
                    })}
                  </>
                )}
        </div>
      </Section>

      <Section index={10} title="Vehicle import record & ownership handoff" testId="order-passport-handoff">
        <Row label="Linked vehicle VIN" testId="order-passport-vin">{order.linked_vehicle_vin ? <RefCode value={order.linked_vehicle_vin} /> : <NotRecorded>Not linked</NotRecorded>}</Row>
        {failed(handoff)
          ? <Unavailable testId="order-passport-handoff-unavailable">The ownership handoff status is unavailable right now.</Unavailable>
          : handoff?.state === 'ready' && handoff.data.handedOff
            ? (
              <>
                <Row label="Ownership handoff"><StatusChip tone="success" testId="order-passport-handoff-badge">Handed off</StatusChip></Row>
                <Row label="Vehicle VIN" testId="order-passport-handoff-vin">{handoff.data.vehicleVin ? <RefCode value={handoff.data.vehicleVin} /> : <NotRecorded />}</Row>
                {(handoff.data.evidence?.length ?? 0) > 0 && <p className="flex items-center gap-2 text-status-success" data-testid="order-passport-handoff-evidence"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Verified import completed</p>}
              </>
            )
            : handoff?.state === 'ready'
              ? <p className="text-carup-text-2" data-testid="order-passport-handoff-pending">Not yet handed off</p>
              : <None testId="order-passport-handoff-loading">Reading the handoff status…</None>}
      </Section>

      <Section index={11} title="Disputes" testId="order-passport-disputes">
        <p className="text-carup-text-2" data-testid="order-passport-disputes-note">Dispute records are available in SafeTrade when enabled.</p>
      </Section>

      <Section index={12} title="Audit history" testId="order-passport-audit">
        {failed(audit)
          ? <Unavailable testId="order-passport-audit-unavailable">The audit history is unavailable right now.</Unavailable>
          : audit?.state !== 'ready'
            ? <None testId="order-passport-audit-loading">Reading the audit history…</None>
            : auditRows.length === 0
              ? <None testId="order-passport-audit-empty" />
              : (
                <ol className="space-y-2">
                  {auditRows.map(a => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`order-passport-audit-${a.id}`}>
                      <span className="font-semibold text-carup-text">{auditActionLabel(a.action)}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-carup-text-2">
                        <span>{activityActorLabel({ actorId: a.actor_id ?? null, actorRelation: a.actor_relation ?? null }, viewer.id)}</span>
                        <span>{formatWhen(a.created_at) ?? 'Not recorded'}</span>
                        {(a.cryptographic_seal || a.sealed) && <Provenance kind="carup">Sealed</Provenance>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
        <p className="text-xs text-carup-text-3" data-testid="order-passport-audit-note">Showing up to the latest 50 entries. The full sealed audit trail is retained server-side.</p>
      </Section>
    </article>
  )
}
