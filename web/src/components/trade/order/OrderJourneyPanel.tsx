/**
 * RX06-LR04 CAP S1 — Import Order › Shipping & CAP › "Journey & arrival".
 *
 * A VIEW over the Journey projection (GET /diaspora/journeys/import_order/:id), carried from CAP R2/R3
 * (6af11ac6) onto the R2C line. It records nothing and decides nothing. The wording is CAP's own, from the
 * ported files in components/trade/journey/.
 *
 * RX06-LR05 — truth-first hierarchy (Moderator review of the LR04 390/1280 evidence):
 *   1. The PRIMARY status is CarUp's own movement record — never what someone else reports.
 *   2. A short ledger says what is known and on what basis: a departure is planned or observed, an arrival is
 *      estimated or observed, movement is confirmed by CarUp or not, and what an external party reports.
 *   3. What an external party reports sits in a clearly SECONDARY section ("Reported milestones"): its
 *      "completed" is the sender's own statement, so it is never drawn as a success, and a missing date is said
 *      once per stage instead of on every row. On phones the stages start collapsed; every row stays one tap away.
 * Documents, customs and payments keep their own tabs, which read their own records; this panel links to them.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, ChevronDown, Clock, MapPin, Ship, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip, type StatusTone } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import type { Journey, JourneyLegs, JourneyProgress, JourneyProgressGroup } from '../journey/journeyTypes'
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
import { originLabel, progressGroupCounts, progressRowTone, progressStateBadge } from '../journey/capDisplay'
import { toneFromClasses } from '../journey/journeyTone'
import { reportedSummary } from '../journey/reportedProgress'
import type { Read } from './orderModel'
import { useOrderHref } from './orderLinks'
import { Fact, NotRecorded, Panel, Provenance, ReadGate } from './TradeKit'

const LINK = 'font-semibold text-carup-action underline-offset-4 hover:underline'
const QUIET_NOTE = 'rounded-control border border-dashed border-carup-line-strong bg-carup-bg-surface px-3 py-2.5 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]'

export function OrderJourneyPanel({ orderId, journey }: { orderId: string; journey: Read<Journey> }) {
  return (
    <Panel title="Journey & arrival" eyebrow="What CarUp has confirmed, and what others report" testId="trade-journey" id="trade-journey">
      <ReadGate read={journey} label="the journey" testId="trade-journey-read">
        {data => <JourneyBody orderId={orderId} data={data} />}
      </ReadGate>
    </Panel>
  )
}

/** Phones (< 768 px) start the reported stages collapsed. Read once at mount, then followed; no matchMedia = wide. */
function useNarrowViewport(): boolean {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setNarrow(mql.matches)
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])
  return narrow
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
  const progress = data.sections?.progress
  const reported = reportedSummary(progress)
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
  // Movement is CONFIRMED only by CarUp's own observations: an observed departure or arrival, or a recorded movement event.
  const movementConfirmed = Boolean(dates?.observed_departure || dates?.observed_arrival || data.timeline.length > 0)

  return (
    <div className="space-y-4" data-testid="journey-body" data-state={data.state} data-viewer={data.viewer?.kind}>
      {/* 1 — the primary status: CarUp's own movement record */}
      <div className="space-y-2" data-testid="journey-state">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">CarUp’s movement record</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={toneFromClasses(ui.tone)} testId="journey-badge">{ui.label}</StatusChip>
          <Provenance kind="carup" testId="journey-state-provenance">Recorded by CarUp</Provenance>
        </div>
        <p className="text-sm leading-6 text-carup-text [overflow-wrap:anywhere]" data-testid="journey-sentence">{data.sentence}</p>
        <p className="text-xs text-carup-text-3" data-testid="journey-last-update">
          Last movement CarUp recorded: {last.label}{last.at ? ` · ${when(last.at)}` : ''}
        </p>
      </div>

      {/* 2 — what is known, and on what basis */}
      {(dates || reported) && (
        <dl className="grid gap-4 rounded-control bg-carup-bg-surface p-3 sm:grid-cols-2 sm:p-4" data-testid="journey-ledger">
          {dates && (
            <Fact
              label={<span className="inline-flex items-center gap-1.5"><Anchor className="h-3.5 w-3.5" aria-hidden="true" />Leaving</span>}
              testId="journey-departure"
              provenance={departure.observed
                ? <Provenance kind="record" testId="journey-departure-provenance">Observed departure · recorded by CarUp</Provenance>
                : dates.planned_departure ? <Provenance kind="stated" testId="journey-departure-provenance">A plan, not a departure</Provenance> : null}
            >
              <span data-testid="journey-departure-headline">{departure.headline}</span>
              {departure.detail && <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2" data-testid="journey-departure-detail">{departure.detail}</span>}
            </Fact>
          )}
          {dates && (
            <Fact
              label={<span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Arriving</span>}
              testId="journey-arrival"
              provenance={arrival.observed
                ? <Provenance kind="record" testId="journey-arrival-provenance">Observed arrival · recorded by CarUp</Provenance>
                : hasEstimate ? <Provenance kind="unverified" testId="journey-arrival-provenance">An estimate, not an arrival</Provenance> : null}
            >
              <span data-testid="journey-arrival-headline">{arrival.headline}</span>
              {arrival.detail && <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2" data-testid="journey-arrival-detail">{arrival.detail}</span>}
              {etaBasis && <span className="mt-0.5 block text-xs font-normal text-carup-text-3" data-testid="journey-eta-basis">{etaBasis}</span>}
              {eta && eta.current && eta.revision_count === 0 && <span className="mt-0.5 block text-xs font-normal text-carup-text-3" data-testid="journey-eta-no-revisions">{NO_ESTIMATE_REVISIONS}</span>}
            </Fact>
          )}
          <Fact
            label="Movement"
            testId="journey-movement"
            provenance={<Provenance kind="carup">{movementConfirmed ? 'Confirmed by CarUp' : 'Not confirmed by CarUp'}</Provenance>}
          >
            {movementConfirmed
              ? <span data-testid="journey-movement-value">CarUp has recorded movement — see “Movement CarUp has recorded”.</span>
              : <span data-testid="journey-movement-value">Not confirmed. CarUp has recorded no departure, loading or arrival.</span>}
          </Fact>
          {reported && (
            <Fact
              label="Reported by others"
              testId="journey-reported-summary"
              provenance={<Provenance kind="unverified">Reported · not confirmed by CarUp</Provenance>}
            >
              <span>{reported.sourceSentence} reports {reported.complete} of {reported.total} stages complete.</span>
              {reported.completedTitles.length > 0 && (
                <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2">Reported complete: {reported.completedTitles.join(', ')}.</span>
              )}
              <a href="#journey-reported" className={cn(LINK, 'mt-0.5 inline-block text-xs')} data-testid="journey-reported-link">See the reported milestones</a>
            </Fact>
          )}
        </dl>
      )}

      {/* exceptions, in the projection's words */}
      {data.exceptions.map(e => (
        <WorkspaceNotice key={e.code} tone="warning" testId={`journey-exception-${e.code}`}>
          {exceptionText(e.code, e.note)}{e.recorded_at ? ` · ${when(e.recorded_at)}` : ''}
        </WorkspaceNotice>
      ))}

      {!shipping && <p className={QUIET_NOTE} data-testid="journey-nothing-connected">{NOTHING_CONNECTED_YET}</p>}
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

      {/* vessel and route: declared, never observed */}
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

      {/* 3 — CarUp's own movement events, before anything reported by others */}
      <Part title="Movement CarUp has recorded" icon={Ship} testId="journey-recorded" chip={<Provenance kind="carup">Recorded by CarUp</Provenance>}>
        {data.timeline.length ? (
          <ol className="space-y-2" data-testid="journey-timeline">
            {data.timeline.map((e, i) => (
              <li key={`${e.kind}-${e.stage}-${e.event_time}-${i}`} className="min-w-0 border-l-2 border-carup-text pl-3" data-testid="journey-timeline-entry">
                <p className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{timelineLabel(e)}</p>
                <p className="text-xs text-carup-text-2 [overflow-wrap:anywhere]">{when(e.event_time)}{e.location ? ` · ${e.location}` : ''} · {sourceLabel(e.source)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-carup-text-2" data-testid="journey-timeline-empty">No movement has been recorded.</p>
        )}
      </Part>

      {/* 4 — what others report: secondary, never the headline */}
      <ReportedMilestones progress={progress} />

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

/** What others report (CAP R2 §23.8 stages), kept visibly secondary to CarUp's own record. */
function ReportedMilestones({ progress }: { progress: JourneyProgress | undefined }) {
  const narrow = useNarrowViewport()
  const headingId = useId()
  if (!progress) return null
  if (progress.availability !== 'composed') {
    return (
      <section className="min-w-0 rounded-control border border-dashed border-carup-line-strong p-3 sm:p-4" data-testid="journey-progress" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-sm font-semibold text-carup-text">Reported milestones</h3>
        <div className="mt-2"><Unshown availability={progress.availability} note={progress.note} testId="journey-progress-unshown" /></div>
      </section>
    )
  }
  const summary = reportedSummary(progress)
  const multipleSources = progress.sources.filter(s => s.origin !== 'carup').length > 1
  return (
    <section id="journey-reported" className="min-w-0 scroll-mt-24 rounded-control border border-dashed border-carup-line-strong bg-carup-bg-surface p-3 sm:p-4" data-testid="journey-progress" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-carup-text">Reported milestones</h3>
        <Provenance kind="unverified" testId="journey-progress-provenance">Reported · not confirmed by CarUp</Provenance>
      </div>
      <p className="mt-2 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]" data-testid="journey-progress-lead">
        {summary
          ? <>{summary.sourceSentence} reports these steps{summary.asOf ? `, as of ${when(summary.asOf)}` : ''}. “Completed” is the sender’s own statement about its work — CarUp has not observed it.{summary.undated > 0 ? ` ${summary.undated === summary.rows ? `No dates were supplied for any of the ${summary.rows} steps.` : `No dates were supplied for ${summary.undated} of the ${summary.rows} steps.`}` : ''}</>
          : 'Nothing has been reported for these stages. That does not mean nothing has happened.'}
      </p>
      <ol className="mt-3 space-y-2">
        {progress.groups.map(g => <ReportedGroup key={g.code} group={g} defaultOpen={!narrow} multipleSources={multipleSources} />)}
      </ol>
      <p className="mt-3 text-xs text-carup-text-2 [overflow-wrap:anywhere]" data-testid="journey-progress-note">{progress.note}</p>
    </section>
  )
}

function ReportedGroup({ group: g, defaultOpen, multipleSources }: { group: JourneyProgressGroup; defaultOpen: boolean; multipleSources: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? defaultOpen
  const panelId = useId()
  const badge = progressStateBadge(g.state)
  // A stage someone else reports complete is the sender's statement: never drawn as a success. CarUp's own record may be.
  const tone: StatusTone = g.state === 'carup_recorded' ? toneFromClasses(badge.tone) : g.state === 'not_recorded' ? 'neutral' : 'info'
  const undated = g.rows.filter(r => !r.time).length
  return (
    <li className="min-w-0 rounded-control border border-carup-line bg-carup-bg-raised" data-testid={`journey-progress-${g.code}`} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setUserOpen(!open)}
        data-testid={`journey-progress-toggle-${g.code}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{g.title}</span>
          <span className="block text-xs text-carup-text-3">{progressGroupCounts(g)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusChip tone={tone} testId={`journey-progress-state-${g.code}`}>{badge.label}</StatusChip>
          <ChevronDown className={cn('h-4 w-4 text-carup-text-3 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </span>
      </button>
      <div id={panelId} hidden={!open} className="border-t border-carup-line px-3 py-2">
        {g.rows.length ? (
          <>
            {undated > 0 && g.rows.length > 1 && (
              <p className="mb-1 text-xs text-carup-text-3" data-testid={`journey-progress-dates-${g.code}`}>
                {undated === g.rows.length ? `No dates were supplied for these ${g.rows.length} steps.` : `No dates were supplied for ${undated} of these ${g.rows.length} steps.`}
              </p>
            )}
            <ul className="divide-y divide-carup-line">
              {g.rows.map(r => (
                <li
                  key={`${r.origin}-${r.sequence}`}
                  className={cn('min-w-0 py-2 first:pt-1 last:pb-0', r.origin === 'carup' && 'border-l-2 border-carup-text pl-2')}
                  data-testid={`journey-progress-row-${g.code}-${r.origin}-${r.sequence}`}
                  data-origin={r.origin}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 text-sm text-carup-text [overflow-wrap:anywhere]">
                      <span className="font-semibold">{r.action_taker.display_label}</span>
                      <span className="text-carup-text-3"> — </span>{r.text}
                    </p>
                    <StatusChip tone={r.origin === 'carup' ? toneFromClasses(progressRowTone(r.status)) : 'neutral'}>{r.origin === 'carup' ? r.status_label : `${r.status_label} (reported)`}</StatusChip>
                  </div>
                  {(r.time || r.origin === 'carup' || multipleSources || (g.rows.length === 1 && !r.time)) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-carup-text-2">
                      {r.time && <span data-testid="journey-progress-row-date">{when(r.time.value)}{r.time.basis ? ` · ${r.time.basis}` : ''}</span>}
                      {!r.time && g.rows.length === 1 && <span>{r.time_note || 'No date was supplied for this step.'}</span>}
                      {(r.origin === 'carup' || multipleSources) && <Provenance kind={r.origin === 'carup' ? 'carup' : 'record'}>{originLabel(r.origin, r.source_label)}</Provenance>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-carup-text-2" data-testid={`journey-progress-empty-${g.code}`}>Nothing has been recorded for this stage. That does not mean it has not happened.</p>
        )}
      </div>
    </li>
  )
}
