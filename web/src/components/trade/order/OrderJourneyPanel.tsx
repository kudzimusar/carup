/**
 * RX06-LR04 CAP S1 — Import Order › Shipping & CAP › "Journey & arrival".
 *
 * A VIEW over the Journey projection (GET /diaspora/journeys/import_order/:id), carried from CAP R2/R3
 * (6af11ac6) onto the R2C line. It records nothing and decides nothing. The wording is CAP's own, from the
 * ported files in components/trade/journey/, and three habits carry over unchanged:
 *
 *   · a plan reads as a plan, an estimate as an estimate, and only an observed date as an event;
 *   · a part the projection did not compose, withheld from this viewer or could not read says so —
 *     never an empty list, because "not read" is not "nothing to report";
 *   · a sender's REPORTED progress is headlined as the sender's, and CarUp's own movement record is
 *     printed beneath it, verbatim.
 *
 * Documents, customs and payments keep their own tabs, which read their own records; this panel links
 * to them rather than repeating them. The vehicle card, parties and document delivery are S2.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Clock, ListChecks, MapPin, Ship, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import type { Journey, JourneyLegs, JourneyProgress } from '../journey/journeyTypes'
import {
  JOURNEY_STATE_UI,
  NOTHING_CONNECTED_YET,
  NO_ESTIMATE_REVISIONS,
  PORT_OF_DISCHARGE_IS_NOT_DESTINATION,
  REFERENCE_IS_NOT_MOVEMENT,
  SECTION_UI,
  describeArrival,
  describeDeparture,
  estimateChange,
  estimatedArrival,
  exceptionText,
  lastRecordedUpdate,
  legRoute,
  legTitle,
  plannedDeparture,
  revisionReason,
  revisionTitle,
  shortDate,
  sourceLabel,
  timelineLabel,
  when,
} from '../journey/journeyDisplay'
import {
  originLabel,
  progressGroupCounts,
  progressRowTone,
  progressStateBadge,
  progressTimeText,
  reportedProgressSummary,
} from '../journey/capDisplay'
import { toneFromClasses } from '../journey/journeyTone'
import type { Read } from './orderModel'
import { useOrderHref } from './orderLinks'
import { Fact, NotRecorded, Panel, Provenance, ReadGate } from './TradeKit'

const LINK = 'font-semibold text-carup-action underline-offset-4 hover:underline'
const QUIET_NOTE = 'rounded-control border border-dashed border-carup-line-strong bg-carup-bg-surface px-3 py-2.5 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]'

export function OrderJourneyPanel({ orderId, journey }: { orderId: string; journey: Read<Journey> }) {
  return (
    <Panel title="Journey & arrival" eyebrow="What has been recorded, and who said so" testId="trade-journey" id="trade-journey">
      <ReadGate read={journey} label="the journey" testId="trade-journey-read">
        {data => <JourneyBody orderId={orderId} data={data} />}
      </ReadGate>
    </Panel>
  )
}

/** One titled part of the journey (h3 under the panel's h2). */
function Part({ title, icon: Icon, chip, testId, children }: { title: string; icon?: LucideIcon; chip?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-control border border-carup-line p-3 sm:p-4" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-carup-text">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />}
          {title}
        </h3>
        {chip}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** A part the projection withheld from this viewer, could not read, or has not connected — said as what it is. */
function Unshown({ availability, note, testId }: { availability: string; note?: string; testId: string }) {
  if (availability === 'unavailable') {
    return <WorkspaceNotice tone="warning" testId={testId}>{note || 'This could not be read right now. That does not mean there is nothing to show.'}</WorkspaceNotice>
  }
  if (availability === 'withheld') {
    return <p className={QUIET_NOTE} data-testid={testId}>{note || 'This is not available to you here.'}</p>
  }
  return <p className={QUIET_NOTE} data-testid={testId}>{note || 'This is not connected to this view yet. That does not mean there is nothing to show.'}</p>
}

function JourneyBody({ orderId, data }: { orderId: string; data: Journey }) {
  const href = useOrderHref()
  const ui = JOURNEY_STATE_UI[data.state] ?? { label: 'Status unavailable', tone: '' }
  // When a sender has REPORTED progress, "shipment set up — nothing moving yet" alone would read as a journey that has not
  // started. The sender's report is headlined as the sender's, and CarUp's own movement sentence stays beneath it, verbatim.
  const reported = reportedProgressSummary(data)
  const last = lastRecordedUpdate(data.timeline)
  const shipping = data.shipping
  const dates = shipping?.dates ?? null
  const departure = describeDeparture(dates)
  // The estimate: the latest accepted revision BESIDE the shipment record's own.
  const eta = shipping?.eta && shipping.eta.availability === 'composed' ? shipping.eta : null
  const etaUnavailable = shipping?.eta && shipping.eta.availability === 'unavailable' ? shipping.eta : null
  const arrival = describeArrival(dates && eta?.current ? { ...dates, estimated_arrival: eta.current } : dates)
  const etaBasis = eta?.current ? (eta.basis === 'revision' ? 'Latest revised estimate' : 'From the shipment record') : null
  const hasEstimate = Boolean(dates && (eta?.current || dates.estimated_arrival))
  const references = shipping?.references ?? null

  return (
    <div className="space-y-4" data-testid="journey-body" data-state={data.state} data-viewer={data.viewer?.kind}>
      {/* 1 — the state line */}
      <div className="space-y-2" data-testid="journey-state">
        <StatusChip tone={reported ? 'info' : toneFromClasses(ui.tone)} testId="journey-badge">
          {reported ? reported.badge : ui.label}
        </StatusChip>
        <p className="text-sm leading-6 text-carup-text [overflow-wrap:anywhere]" data-testid="journey-sentence">{reported ? reported.sentence : data.sentence}</p>
        {reported && (
          <p className="text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]" data-testid="journey-carup-record">
            <span className="font-semibold text-carup-text">CarUp’s own movement record: </span>{ui.label}. {data.sentence}
          </p>
        )}
        <p className="text-xs text-carup-text-3" data-testid="journey-last-update">
          {reported ? 'Last update recorded by CarUp' : 'Last recorded update'}: {last.label}{last.at ? ` · ${when(last.at)}` : ''}
        </p>
      </div>

      {/* 2 — exceptions, in the projection's words */}
      {data.exceptions.map(e => (
        <WorkspaceNotice key={e.code} tone="warning" testId={`journey-exception-${e.code}`}>
          {exceptionText(e.code, e.note)}{e.recorded_at ? ` · ${when(e.recorded_at)}` : ''}
        </WorkspaceNotice>
      ))}

      {!shipping && <p className={QUIET_NOTE} data-testid="journey-nothing-connected">{NOTHING_CONNECTED_YET}</p>}

      {/* 3 — leaving and arriving: a plan is a plan, an estimate is an estimate */}
      {dates && (
        <dl className="grid gap-4 sm:grid-cols-2" data-testid="journey-dates">
          <Fact
            label={<span className="inline-flex items-center gap-1.5"><Anchor className="h-3.5 w-3.5" aria-hidden="true" />Leaving</span>}
            testId="journey-departure"
            provenance={departure.observed
              ? <Provenance kind="record" testId="journey-departure-provenance">Recorded as an actual departure</Provenance>
              : dates.planned_departure ? <Provenance kind="stated" testId="journey-departure-provenance">A plan, not a departure</Provenance> : null}
          >
            <span data-testid="journey-departure-headline">{departure.headline}</span>
            {departure.detail && <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2" data-testid="journey-departure-detail">{departure.detail}</span>}
          </Fact>
          <Fact
            label={<span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Arriving</span>}
            testId="journey-arrival"
            provenance={arrival.observed
              ? <Provenance kind="record" testId="journey-arrival-provenance">Recorded as an actual arrival</Provenance>
              : hasEstimate ? <Provenance kind="unverified" testId="journey-arrival-provenance">An estimate, not an arrival</Provenance> : null}
          >
            <span data-testid="journey-arrival-headline">{arrival.headline}</span>
            {arrival.detail && <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2" data-testid="journey-arrival-detail">{arrival.detail}</span>}
            {etaBasis && <span className="mt-0.5 block text-xs font-normal text-carup-text-3" data-testid="journey-eta-basis">{etaBasis}</span>}
            {eta && eta.current && eta.revision_count === 0 && <span className="mt-0.5 block text-xs font-normal text-carup-text-3" data-testid="journey-eta-no-revisions">{NO_ESTIMATE_REVISIONS}</span>}
          </Fact>
        </dl>
      )}
      {etaUnavailable && <WorkspaceNotice tone="warning" testId="journey-eta-unavailable">{etaUnavailable.note}</WorkspaceNotice>}

      {eta && eta.revision_count > 0 && (
        <Part title="Estimate history" icon={Clock} testId="journey-eta" chip={<Provenance kind="unverified">An estimate can move</Provenance>}>
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Current estimate" testId="journey-eta-current">{shortDate(eta.current) ?? <NotRecorded />}</Fact>
            <Fact label="Original (shipment record)" testId="journey-eta-original">{shortDate(eta.original) ?? <NotRecorded />}</Fact>
          </dl>
          {estimateChange(eta.change_days) && <p className="mt-2 text-sm text-carup-text-2" data-testid="journey-eta-change">{estimateChange(eta.change_days)}</p>}
          <ol className="mt-3 space-y-2">
            {eta.revisions.map((r, i) => (
              <li key={`${r.observed_at}-${i}`} className="min-w-0 border-l-2 border-carup-line pl-3" data-testid="journey-eta-revision">
                <p className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">
                  {revisionTitle(r)}{r.superseded && <span className="font-normal text-carup-text-3"> · Superseded</span>}
                </p>
                <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">Recorded {when(r.observed_at)} · {sourceLabel(r.source)}</p>
                <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">{revisionReason(r.reason)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-carup-text-3 [overflow-wrap:anywhere]">{eta.note}</p>
        </Part>
      )}

      {/* 4 — vessel and route: declared, never observed */}
      {shipping && <Legs legs={shipping.legs} hasDates={Boolean(dates)} />}

      {references && (
        <Part title="Shipping references" testId="journey-references">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Fact label="Carrier">{references.carrier ?? <NotRecorded />}</Fact>
            <Fact label="Tracking reference">{references.tracking_reference ? <code className="font-mono text-xs">{references.tracking_reference}</code> : <NotRecorded />}</Fact>
            <Fact label="Port of loading">{references.origin_port ?? <NotRecorded />}</Fact>
            <Fact label="Port of discharge">{references.destination_port ?? <NotRecorded />}</Fact>
          </dl>
          <p className="mt-2 text-xs text-carup-text-3 [overflow-wrap:anywhere]" data-testid="journey-reference-note">{REFERENCE_IS_NOT_MOVEMENT}</p>
          <p className="mt-1 text-xs text-carup-text-3 [overflow-wrap:anywhere]" data-testid="journey-port-note">{PORT_OF_DISCHARGE_IS_NOT_DESTINATION}</p>
        </Part>
      )}

      {/* 5 — progress: what the sender reported, kept apart from what CarUp recorded */}
      <ProgressGroups progress={data.sections?.progress} />

      {/* 6 — the movement CarUp has recorded (the Activity tab is the order's own audit) */}
      <Part title="What has been recorded" icon={Ship} testId="journey-recorded">
        {data.timeline.length ? (
          <ol className="space-y-2" data-testid="journey-timeline">
            {data.timeline.map((e, i) => (
              <li key={`${e.kind}-${e.stage}-${e.event_time}-${i}`} className="min-w-0 border-l-2 border-carup-line pl-3" data-testid="journey-timeline-entry">
                <p className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{timelineLabel(e)}</p>
                <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">{when(e.event_time)}{e.location ? ` · ${e.location}` : ''} · {sourceLabel(e.source)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-carup-text-2" data-testid="journey-timeline-empty">No movement has been recorded.</p>
        )}
      </Part>

      <p className="text-sm leading-6 text-carup-text-2" data-testid="journey-elsewhere">
        Documents, customs and payments keep their own records, on their own tabs:{' '}
        <Link to={href(orderId, 'documents')} className={LINK} data-testid="journey-link-documents">Documents</Link>{' · '}
        <Link to={href(orderId, 'customs')} className={LINK} data-testid="journey-link-customs">Customs</Link>{' · '}
        <Link to={href(orderId, 'payments')} className={LINK} data-testid="journey-link-payments">Payments</Link>
      </p>

      <p className="text-xs leading-5 text-carup-text-3 [overflow-wrap:anywhere]" data-testid="journey-disclaimer">
        {data.note} Read {data.generated_at ? when(data.generated_at) : 'just now'}.
      </p>
    </div>
  )
}

function Legs({ legs, hasDates }: { legs: JourneyLegs | undefined; hasDates: boolean }) {
  if (legs?.availability === 'composed') {
    return (
      <Part title="Vessel and route" icon={Ship} testId="journey-legs" chip={<Provenance kind="stated" testId="journey-legs-provenance">Declared, not observed</Provenance>}>
        {legs.items.length > 0 && (
          <ol className="space-y-3">
            {legs.items.map(l => (
              <li key={l.sequence} className="min-w-0 border-l-2 border-carup-line pl-3" data-testid="journey-leg">
                <p className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{legTitle(l)}</p>
                <p className="text-sm text-carup-text-2 [overflow-wrap:anywhere]">{legRoute(l)}</p>
                <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">{plannedDeparture(l.planned_departure)} · {estimatedArrival(l.estimated_arrival)}</p>
                {l.vessel_name && l.carrier_name && <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">Carrier: {l.carrier_name}</p>}
                {(l.imo || l.mmsi) && <p className="text-xs text-carup-text-2">{[l.imo ? `IMO ${l.imo}` : null, l.mmsi ? `MMSI ${l.mmsi}` : null].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ol>
        )}
        <p className={cn('text-xs text-carup-text-3 [overflow-wrap:anywhere]', legs.items.length > 0 && 'mt-3')} data-testid="journey-legs-note">{legs.note}</p>
      </Part>
    )
  }
  if (legs?.availability === 'unavailable') {
    return <WorkspaceNotice tone="warning" testId="journey-legs-unavailable">{legs.note}</WorkspaceNotice>
  }
  // The API said legs are not connected, or sent nothing about them: say so rather than imply there are none.
  if (hasDates && (!legs || legs.availability === 'not_yet_composed')) {
    return (
      <p className={QUIET_NOTE} data-testid="journey-legs-note">
        <strong className="font-semibold text-carup-text">{SECTION_UI.legs.title}: </strong>{SECTION_UI.legs.message}
      </p>
    )
  }
  return null
}

/** The five stages with the real rows under each (CAP R2 §23.8), in Get 6's visual language. */
function ProgressGroups({ progress }: { progress: JourneyProgress | undefined }) {
  if (!progress) return null
  if (progress.availability !== 'composed') {
    return (
      <Part title="Progress" icon={ListChecks} testId="journey-progress">
        <Unshown availability={progress.availability} note={progress.note} testId="journey-progress-unshown" />
      </Part>
    )
  }
  return (
    <Part title="Progress" icon={ListChecks} testId="journey-progress">
      <ol className="space-y-3">
        {progress.groups.map(g => {
          const badge = progressStateBadge(g.state)
          return (
            <li key={g.code} className="min-w-0 rounded-control bg-carup-bg-surface p-3" data-testid={`journey-progress-${g.code}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="min-w-0 text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{g.title}</h4>
                <StatusChip tone={toneFromClasses(badge.tone)} testId={`journey-progress-state-${g.code}`}>{badge.label}</StatusChip>
              </div>
              <p className="mt-0.5 text-xs text-carup-text-3">{progressGroupCounts(g)}</p>
              {g.rows.length ? (
                <ul className="mt-2 divide-y divide-carup-line">
                  {g.rows.map(r => (
                    <li
                      key={`${r.origin}-${r.sequence}`}
                      className={cn('min-w-0 py-2 first:pt-0 last:pb-0', r.origin === 'carup' && 'border-l-2 border-carup-text pl-2')}
                      data-testid={`journey-progress-row-${g.code}-${r.origin}-${r.sequence}`}
                      data-origin={r.origin}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 text-sm text-carup-text [overflow-wrap:anywhere]">
                          <span className="font-semibold">{r.action_taker.display_label}</span>
                          <span className="text-carup-text-3"> — </span>{r.text}
                        </p>
                        <StatusChip tone={toneFromClasses(progressRowTone(r.status))}>{r.status_label}</StatusChip>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-carup-text-2">
                        <span className="[overflow-wrap:anywhere]">{progressTimeText(r, when)}</span>
                        <Provenance kind={r.origin === 'carup' ? 'carup' : 'record'}>{originLabel(r.origin, r.source_label)}</Provenance>
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-carup-text-2" data-testid={`journey-progress-empty-${g.code}`}>Nothing has been recorded for this stage. That does not mean it has not happened.</p>
              )}
            </li>
          )
        })}
      </ol>
      {progress.sources.length > 0 && (
        <p className="mt-3 text-xs text-carup-text-3 [overflow-wrap:anywhere]" data-testid="journey-progress-sources">
          {progress.sources.map(s => `${originLabel(s.origin, s.source_label)}${s.observed_at ? `, as of ${when(s.observed_at)}` : ''} (${s.row_count} ${s.row_count === 1 ? 'step' : 'steps'})`).join(' · ')}
        </p>
      )}
      <p className="mt-2 text-xs text-carup-text-2 [overflow-wrap:anywhere]" data-testid="journey-progress-note">{progress.note}</p>
    </Part>
  )
}
