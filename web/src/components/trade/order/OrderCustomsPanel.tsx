/**
 * RX-06 — Import Order › Customs. Customs, inspection (CBCA), duty and the government records are shown
 * ONLY as recorded. CarUp never pre-calculates duty, never predicts clearance or release, and a
 * verified inspection certificate is a checked document — not an inspection outcome CarUp decided.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, Landmark, ScrollText, ShieldCheck } from 'lucide-react'
import { documentState, positionOf } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaGovernmentDocument, DiasporaTradeDocument } from '@/types'
import {
  documentTypeLabel,
  formatDay,
  formatWhen,
  governmentRecordLabel,
  governmentRecordStatus,
  isTradeOperator,
  money,
  recordStatusTone,
  sentence,
  statusLabel,
  statusOutcome,
  type Read,
  type Tone,
  type TradeOrder,
} from './orderModel'
import type { TradeViewer } from './orderViewTypes'
import { useOrderSurface } from './orderLinks'
import { Panel, Provenance, ReadGate } from './TradeKit'

const TRUTH_TONE: Record<string, Tone> = {
  missing: 'neutral', uploaded: 'info', in_review: 'info', verified: 'success', rejected: 'danger', flagged: 'warning', unknown: 'neutral',
}

function DocLines({ docs, empty, testId }: { docs: DiasporaTradeDocument[]; empty: string; testId: string }) {
  if (docs.length === 0) return <p className="text-sm text-carup-text-2" data-testid={`${testId}-empty`}>{empty}</p>
  return (
    <ul className="space-y-2" data-testid={testId}>
      {docs.map(d => {
        const truth = documentState(d.verification_status || 'UPLOADED')
        return (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-semibold text-carup-text">{documentTypeLabel(d.document_type)}</span>
              <span className="block text-xs text-carup-text-3">Uploaded {formatDay(d.created_at) ?? 'on a date not recorded'}{truth.verified && d.reviewed_at ? ` · verified ${formatDay(d.reviewed_at)}` : ''}</span>
            </span>
            <StatusChip tone={TRUTH_TONE[truth.truth] ?? 'neutral'}>{truth.label}</StatusChip>
          </li>
        )
      })}
    </ul>
  )
}

export function OrderCustomsPanel({ order, viewer, documents, footprint }: {
  order: TradeOrder
  viewer: TradeViewer
  documents: DiasporaTradeDocument[]
  footprint?: Read<DiasporaGovernmentDocument[]>
}) {
  const pos = positionOf(order.status)
  const outcome = statusOutcome(order.status)
  const customsIndex = pos.phases.findIndex(p => p.phase.key === 'customs')
  const customsProgress = customsIndex >= 0 ? pos.phases[customsIndex].progress : 'unknown'
  const ofType = (...types: string[]) => documents.filter(d => types.includes(String(d.document_type || '').toLowerCase()))
  const inspection = ofType('inspection_certificate')
  const dutyDocs = ofType('customs_declaration', 'duty_receipt', 'port_release_order')
  const dutyMilestones = (order.diaspora_payment_milestones ?? []).filter(m => String(m.milestone_type).toUpperCase() === 'CUSTOMS_DUTY')
  const reviews = order.diaspora_compliance_reviews ?? []
  const { toolLinks } = useOrderSurface()
  return (
    <div className="space-y-5" data-testid="trade-customs">
      <section className="rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5" aria-labelledby="trade-customs-standing" data-testid="trade-customs-standing">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-carup-text-3" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="trade-customs-standing" className="text-base font-semibold text-carup-text">
              {outcome ? outcome.title
                : customsProgress === 'current' ? `Now: ${statusLabel(order.status)}`
                : customsProgress === 'passed' ? 'This order is past the border and customs phase'
                : 'Customs has not started for this order'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-carup-text-2">
              {outcome ? outcome.detail
                : customsProgress === 'current' ? pos.guide?.meaning
                : customsProgress === 'passed' ? `The order’s recorded status is “${statusLabel(order.status)}”.`
                : `The order’s recorded status is “${statusLabel(order.status)}”. Border arrival, customs, duty and release appear here once they are recorded.`}
            </p>
            <p className="mt-2 text-xs leading-5 text-carup-text-3">CarUp records customs as the authority acts. It never pre-calculates duty and never predicts clearance or release.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Pre-shipment inspection (CBCA)" eyebrow="Inspection certificate" testId="trade-customs-inspection">
          <DocLines docs={inspection} empty="No inspection certificate has been uploaded for this order." testId="trade-customs-inspection-docs" />
          <p className="mt-3 text-xs leading-5 text-carup-text-3">A verified certificate means a CarUp reviewer checked the document. It is not an inspection result decided by CarUp.</p>
        </Panel>

        <Panel title="Duty" eyebrow="As recorded — never estimated" testId="trade-customs-duty">
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-carup-text-3">Assessment and receipts</h3>
              <div className="mt-2"><DocLines docs={dutyDocs} empty="No customs declaration, duty receipt or release order uploaded." testId="trade-customs-duty-docs" /></div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-carup-text-3">Duty milestones</h3>
              {dutyMilestones.length === 0 ? (
                <p className="mt-2 text-sm text-carup-text-2" data-testid="trade-customs-duty-none">No duty amount is recorded on this order.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {dutyMilestones.map(m => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-semibold tabular-nums text-carup-text">{money(m.amount, m.currency) ?? 'Amount not recorded'}</span>
                      <span className="flex items-center gap-2"><Provenance kind="stated">Payment reference · not an assessment</Provenance><StatusChip tone={recordStatusTone(m.status)}>{sentence(m.status)}</StatusChip></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="Compliance reviews"
        eyebrow={`${reviews.length} recorded`}
        testId="trade-customs-reviews"
        action={toolLinks && isTradeOperator(viewer.role) ? <Link to="/admin/diaspora/compliance" className={WS_TEXT_ACTION}>Compliance desk <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : undefined}
      >
        {reviews.length === 0 ? (
          <p className="text-sm text-carup-text-2" data-testid="trade-customs-reviews-empty">No compliance review has been opened for this order. CarUp reviewers open one when the order needs it.</p>
        ) : (
          <ul className="divide-y divide-carup-line">
            {reviews.map(r => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0 text-sm" data-testid="trade-customs-review">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold text-carup-text"><ShieldCheck className="h-4 w-4 text-carup-text-3" aria-hidden="true" />{sentence(r.review_type, 'Review')}</span>
                  <span className="block text-xs text-carup-text-3">Opened {formatWhen(r.created_at) ?? 'at a time not recorded'}</span>
                  {r.notes && <span className="block text-xs text-carup-text-2 [overflow-wrap:anywhere]">{r.notes}</span>}
                </span>
                <StatusChip tone={recordStatusTone(r.status)}>{sentence(r.status)}</StatusChip>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {footprint && (
        <Panel title="Government records for Zimbabwe-ready" eyebrow="Registration, licensing, roadworthiness, clearance" testId="trade-customs-footprint">
          <ReadGate read={footprint} label="the government records" testId="trade-footprint-read">
            {rows => {
              const required = rows.filter(r => r.requiredForZimbabweReady)
              const verified = required.filter(r => String(r.status).toUpperCase() === 'VERIFIED')
              return (
                <div>
                  <p className="text-sm text-carup-text" data-testid="trade-footprint-summary">
                    <ScrollText className="mr-1.5 inline h-4 w-4 text-carup-text-3" aria-hidden="true" />
                    {verified.length} of {required.length} required records verified
                  </p>
                  {rows.length === 0 ? (
                    <p className="mt-2 text-sm text-carup-text-2">None recorded.</p>
                  ) : (
                    <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
                      {rows.map(r => {
                        const st = governmentRecordStatus(r.status)
                        return (
                          <li key={r.category} className="flex items-center justify-between gap-2 border-b border-carup-line py-2 text-sm" data-testid={`trade-footprint-${r.category}`}>
                            <span className="min-w-0">
                              <span className="font-medium text-carup-text">{governmentRecordLabel(r.category)}</span>
                              {r.requiredForZimbabweReady && <span className="ml-1.5 text-xs text-carup-text-3">required</span>}
                              {r.verifiedAt && <span className="block text-xs text-carup-text-3">Verified {formatDay(r.verifiedAt)}</span>}
                            </span>
                            <StatusChip tone={st.tone} className="shrink-0 whitespace-nowrap">{st.label}</StatusChip>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="mt-3 text-xs leading-5 text-carup-text-3">CarUp refuses “Zimbabwe-ready” until every required record is verified.</p>
                </div>
              )
            }}
          </ReadGate>
        </Panel>
      )}
    </div>
  )
}
