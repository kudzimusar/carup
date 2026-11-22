/**
 * RX-06 Sourcing — the unified shared-container board (/diaspora/containers): "space on a ship".
 *
 * Presentation only. The list of containers open for booking, one container's capacity and space
 * requests, requesting space, and (for CarUp logistics reviewers) approve / reject / close booking are
 * all the page container's own reads and handlers (DiasporaContainerMarketplace).
 * Truth rules: capacity is the recorded total and the APPROVED volume only; a pending request is shown
 * apart and never counted; dates are the coordinator's recorded plan, never a carrier ETA; a participant
 * sees only their own requests, and the page says so.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CircleDashed, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { revealOnPhone } from '@/components/dealer/workspace/format'
import { WS_DANGER, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { buildLoginRedirect } from '@/lib/returnTo'
import type { DiasporaMarketplaceContainer, DiasporaMarketplaceReservation } from '@/types'
import { DeskHeader, DeskPanel, DeskState, EditorialEmpty, Fact, InlineConfirm, NextMove, PulseLine, RefCode, RouteGlyph, SourceChip } from './TradeDesk'
import { failureKind, formatDay, humanizeCode, plural, roleWords } from './deskKit'
import {
  CONTAINER_STATUS, CONTAINER_TRACK, containerStatus, fillOf, formatCbm, pendingVolume, placeOf, recordedDay,
  reservationStatus, trackIndex, type ContainerBoardModel, type Fill,
} from './containerBoard'

export function ContainerBoardView({ model }: { model: ContainerBoardModel }) {
  const shell = (children: ReactNode) => (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-containers" data-presentation="trade-desk">{children}</div>
  )
  if (model.authLoading) {
    return shell(<DeskState kind="loading" title="Checking your access to shared containers…" testId="trade-containers-auth-loading" />)
  }
  if (!model.signedIn) {
    return shell(
      <>
        <DeskHeader eyebrow="Trade · Sourcing" title="Shared containers" />
        <DeskState kind="signin" title="Sign in to book space on a shared container" action={<Link to={buildLoginRedirect('/diaspora/containers')} className={WS_PRIMARY}>Sign in</Link>} testId="trade-containers-signin">
          Containers and space requests belong to signed-in traders. Nothing was loaded.
        </DeskState>
      </>,
    )
  }
  if (!model.canView) {
    return shell(
      <>
        <DeskHeader eyebrow="Trade · Sourcing" title="Shared containers" />
        <DeskState kind="denied" title="Shared containers need a trading role" testId="trade-containers-denied">
          Your account ({roleWords(model.role)}) cannot book container space. Nothing was loaded. The server checks the role again on every request.
        </DeskState>
      </>,
    )
  }

  const ready = model.read.phase === 'ready' && !model.loading
  const answered = model.read.phase !== 'idle'
  const openCount = model.containers.filter((c) => String(c.status).toUpperCase() === 'BOOKING_OPEN').length

  return shell(
    <>
      <DeskHeader
        eyebrow="Trade · Sourcing"
        title="Shared containers"
        description="Book space on a container shared with other traders. CarUp logistics approves or rejects every request, and only approved space counts against capacity."
        meta={model.isReviewer ? <SourceChip testId="trade-containers-reviewer">You review space requests as CarUp logistics</SourceChip> : undefined}
        actions={<Link to="/diaspora/rfq" className={WS_SECONDARY}>Sourcing requests</Link>}
      />

      {model.notice && (
        <div aria-live="polite"><WorkspaceNotice tone={model.notice.tone} testId="trade-containers-notice">{model.notice.text}</WorkspaceNotice></div>
      )}

      {(!answered || model.loading) && model.containers.length === 0 && (
        <DeskState kind="loading" title="Loading containers open for booking…" testId="trade-containers-loading" />
      )}

      {model.read.phase === 'failed' && !model.loading && <ListFailure model={model} />}

      {ready && model.containers.length === 0 && (
        <EditorialEmpty still="containerYard">
          <DeskState bare kind="empty" title="No containers are open for booking right now" testId="trade-containers-empty" action={<Link to="/diaspora/imports" className={WS_SECONDARY}>Your import orders</Link>}>
            A shared container appears here when CarUp logistics opens one for booking, with its route, planned departure and recorded capacity.
            You can then request space for your cargo. Nothing is reserved for you until a request is approved.
          </DeskState>
        </EditorialEmpty>
      )}

      {model.containers.length > 0 && (
        <>
          <PulseLine
            label="Containers at a glance"
            testId="trade-containers-pulse"
            items={[{ label: openCount === 1 ? 'container open for booking' : 'containers open for booking', value: openCount }]}
          />
          {!model.selected && (
            <NextMove
              testId="trade-containers-next"
              title="Choose a container whose route and dates suit your cargo"
              usuallyWith="You"
              after="Open it to see its recorded capacity and request space. A CarUp logistics reviewer then approves or rejects the request."
              action={<button type="button" className={WS_PRIMARY} onClick={() => void model.onOpen(model.containers[0])}>Open the first container<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
            />
          )}
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-start">
            <ul className="min-w-0 space-y-3" aria-label="Containers open for booking" data-testid="trade-containers-board">
              {model.containers.map((c) => <ContainerCard key={c.id} container={c} selected={model.selected?.id === c.id} onOpen={() => void model.onOpen(c)} />)}
            </ul>
            <div className="min-w-0">
              {model.selected
                ? <ContainerDetail key={model.selected.id} model={model} container={model.selected} />
                : (
                  <DeskState compact kind="empty" title="Open a container to see its space" testId="trade-containers-detail-empty">
                    Each container shows its recorded capacity, your space requests and what happens next.
                  </DeskState>
                )}
            </div>
          </div>
        </>
      )}
    </>,
  )
}

function ListFailure({ model }: { model: ContainerBoardModel }) {
  const kind = failureKind(model.read)
  // RX06-LR04: an ended session is said as such, with the way back — not as a failure to retry.
  if (kind === 'session') {
    return <DeskState kind="signin" title="Your session has ended" action={<Link to={buildLoginRedirect('/diaspora/containers')} className={WS_PRIMARY}>Sign in again</Link>} testId="trade-containers-failed">Sign in again to see the shared containers. Nothing has been booked or changed.</DeskState>
  }
  if (kind === 'denied') {
    return <DeskState kind="denied" title="The server refused to show containers to this account" testId="trade-containers-failed">This is a permission answer (403), not an empty board.</DeskState>
  }
  if (kind === 'limited') {
    return <DeskState kind="limited" title="Too many requests right now" onRetry={model.onRetry} retryLabel="Retry now" testId="trade-containers-failed">The shared request limit was reached. Nothing is retried automatically — wait about a minute, then retry.</DeskState>
  }
  if (kind === 'missing') {
    return <DeskState kind="unavailable" title="Shared containers are not available on this server" testId="trade-containers-failed">The server answered “not found” (404). The feature may be switched off here; this is not a report that no containers exist.</DeskState>
  }
  return (
    <DeskState kind="failed" title="Containers could not be loaded" onRetry={model.onRetry} testId="trade-containers-failed">
      This is not a report that no containers are open. Nothing has been booked or changed.
    </DeskState>
  )
}

/* ── Capacity ──────────────────────────────────────────────────────────────────────────────── */

function CapacityBar({ fill, pending = 0, testId }: { fill: Fill; pending?: number; testId?: string }) {
  if (!fill.recorded) {
    return <p className="text-sm text-carup-text-3" data-testid={testId}>Capacity not recorded</p>
  }
  const usedPct = Math.min(100, Math.max(0, fill.pct * 100))
  const pendingPct = Math.min(100 - usedPct, Math.max(0, (pending / fill.total) * 100))
  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="text-carup-text-2"><span className="font-semibold tabular-nums text-carup-text">{formatCbm(fill.used)}</span> approved of {formatCbm(fill.total)}</span>
        <span className="font-semibold tabular-nums text-carup-text">{formatCbm(fill.available)} free</span>
      </div>
      <div
        role="img"
        aria-label={`Capacity: ${formatCbm(fill.used)} approved of ${formatCbm(fill.total)}, ${formatCbm(fill.available)} free${pending > 0 ? `; ${formatCbm(pending)} requested and not yet counted` : ''}`}
        className="mt-1.5 flex h-3 overflow-hidden rounded-full border border-carup-line bg-carup-bg-surface-2"
      >
        <span className="h-full bg-carup-text" style={{ width: `${usedPct}%` }} />
        {pendingPct > 0 && (
          <span
            className="h-full"
            style={{ width: `${pendingPct}%`, backgroundImage: 'repeating-linear-gradient(135deg, var(--carup-raw-orange-signal) 0 3px, transparent 3px 7px)' }}
          />
        )}
      </div>
      <p className="mt-1 text-xs tabular-nums text-carup-text-3">{Math.round(fill.pct * 100)}% approved</p>
    </div>
  )
}

function FillFlags({ fill }: { fill: Fill }) {
  if (!fill.recorded) return null
  if (fill.full) return <StatusChip tone="danger" testId="trade-containers-full">Full</StatusChip>
  if (fill.readyToClose) return <StatusChip tone="warning" testId="trade-containers-ready-to-close">Ready to close</StatusChip>
  return null
}

function ContainerCard({ container, selected, onOpen }: { container: DiasporaMarketplaceContainer; selected: boolean; onOpen: () => void }) {
  const status = containerStatus(container.status)
  const fill = fillOf(container)
  return (
    <li className={cn('rounded-card border p-4', selected ? 'border-carup-line-strong bg-carup-bg-surface' : 'border-carup-line bg-carup-bg-raised')} data-testid="trade-containers-card" data-status={status.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-xs text-carup-text-3">
          <span className="font-mono font-medium text-carup-text">{container.container_type || 'Type not recorded'}</span>
          {' · '}<RefCode value={container.id} label="Container" />
        </p>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>
      <div className="mt-2"><RouteGlyph from={placeOf(container.origin_city, container.origin_country)} to={placeOf(container.destination_city, container.destination_country)} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-carup-text-3">Planned departure</dt><dd className="mt-0.5 font-semibold text-carup-text">{recordedDay(container.departure_date) ?? 'Not recorded'}</dd></div>
        <div><dt className="text-carup-text-3">Booking closes</dt><dd className="mt-0.5 font-semibold text-carup-text">{recordedDay(container.booking_deadline) ?? 'Not recorded'}</dd></div>
      </dl>
      <div className="mt-3"><CapacityBar fill={fill} /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <FillFlags fill={fill} />
        <button type="button" className={cn(WS_SECONDARY, 'ml-auto')} onClick={onOpen} aria-current={selected ? 'true' : undefined} data-testid="trade-containers-open">
          {selected ? 'Showing' : 'Open'}
        </button>
      </div>
    </li>
  )
}

/* ── One container ─────────────────────────────────────────────────────────────────────────── */

function StatusTrack({ status }: { status: string }) {
  const at = trackIndex(status)
  const cancelled = String(status).toUpperCase() === 'CANCELLED'
  return (
    <div data-testid="trade-containers-track">
      {cancelled && <p className="mb-2 rounded-control bg-status-danger-soft px-3 py-2 text-sm text-carup-text">{CONTAINER_STATUS.CANCELLED.meaning}</p>}
      {!cancelled && at < 0 && <p className="mb-2 rounded-control bg-status-warning-soft px-3 py-2 text-sm text-carup-text">This container has a status CarUp does not recognise ({status || 'none'}), so it is not placed on the track.</p>}
      <ol className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4" aria-label="Container lifecycle">
        {CONTAINER_TRACK.map((key, i) => {
          const state = at < 0 ? 'unknown' : i < at ? 'earlier' : i === at ? 'current' : 'later'
          return (
            <li key={key} className="min-w-0" aria-current={state === 'current' ? 'step' : undefined} data-progress={state}>
              <span
                aria-hidden="true"
                className={cn('block h-1.5 rounded-full', state === 'earlier' ? 'bg-carup-text' : state === 'current' ? '' : 'bg-carup-line')}
                style={state === 'current' ? { background: 'var(--carup-raw-orange-signal)' } : undefined}
              />
              <span className={cn('mt-1.5 flex items-center gap-1 text-xs', state === 'current' ? 'font-semibold text-carup-text' : state === 'earlier' ? 'text-carup-text-2' : 'text-carup-text-3')}>
                {state === 'earlier' ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : state === 'current' ? null : <CircleDashed className="h-3 w-3 shrink-0" aria-hidden="true" />}
                <span className="truncate">{CONTAINER_STATUS[key].label}</span>
              </span>
              <span className="sr-only">{state === 'earlier' ? 'earlier stage' : state === 'current' ? 'current stage' : state === 'later' ? 'not reached' : 'not known'}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ContainerDetail({ model, container }: { model: ContainerBoardModel; container: DiasporaMarketplaceContainer }) {
  const ref = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const fieldId = useId()
  const [requesting, setRequesting] = useState(false)
  const [closing, setClosing] = useState<'idle' | 'confirm' | 'busy'>('idle')
  useEffect(() => { revealOnPhone(ref.current) }, [])

  const status = containerStatus(container.status)
  const open = status.key === 'BOOKING_OPEN'
  const fill = fillOf(container)
  const reservationsReady = model.reservationsFor === container.id
  const reservations = reservationsReady ? model.reservations : []
  const pending = reservationsReady && !model.reservationsUnreadable ? pendingVolume(reservations) : 0
  const pendingCount = reservations.filter((r) => String(r.reservation_status).toUpperCase() === 'REQUESTED').length
  const eta = recordedDay(container.estimated_arrival_date)

  async function request() {
    if (requesting) return
    setRequesting(true)
    try { await model.onReserve() } finally { setRequesting(false) }
  }
  async function closeBooking() {
    setClosing('busy')
    try { await model.onCloseBooking() } finally { setClosing('idle') }
  }

  const move = (() => {
    if (model.isReviewer && pendingCount > 0) {
      return { title: `Review ${plural(pendingCount, 'pending space request')}`, with: 'You, as CarUp logistics', after: 'Approval is checked against remaining capacity and refused if it would overfill the container. Approved space counts at once.' }
    }
    if (!open) return { title: `Booking is not open for this container (${status.label.toLowerCase()})`, with: 'CarUp logistics', after: 'Space cannot be requested. Requests already approved keep their space.' }
    if (fill.full) return { title: 'This container is full', with: 'CarUp logistics', after: 'Approved space has reached the recorded capacity. A new request would be refused.' }
    if (!model.isReviewer && pendingCount > 0) return { title: `Your request for ${formatCbm(pending)} is awaiting review`, with: 'CarUp logistics', after: 'A reviewer approves or rejects it. It counts against capacity only once approved.' }
    if (model.isReviewer && fill.readyToClose) return { title: 'This container is ready to close', with: 'You, as CarUp logistics', after: 'Closing booking stops new space requests. It does not mean the container is loaded or shipped.' }
    return { title: 'Request space for your cargo', with: 'You', after: 'A CarUp logistics reviewer approves or rejects the request. It counts against capacity only once approved.' }
  })()

  return (
    <article ref={ref} tabIndex={-1} aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-card focus-visible:outline-none" data-testid="trade-containers-detail" data-status={status.key}>
      <header className="space-y-3 rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={status.tone} testId="trade-containers-detail-status">{status.label}</StatusChip>
          <span className="font-mono text-xs font-medium text-carup-text">{container.container_type || 'Type not recorded'}</span>
          <RefCode value={container.id} label="Container" testId="trade-containers-detail-ref" />
        </div>
        <h2 id={titleId} className="sr-only">Container {String(container.id).slice(0, 8)}</h2>
        <RouteGlyph from={placeOf(container.origin_city, container.origin_country)} to={placeOf(container.destination_city, container.destination_country)} testId="trade-containers-detail-route" />
        <p className="text-sm text-carup-text-2">{status.meaning}</p>
        <StatusTrack status={status.key} />
        <dl className="grid gap-x-6 gap-y-3 border-t border-carup-line pt-3 sm:grid-cols-3">
          <Fact label="Planned departure" value={recordedDay(container.departure_date)} source={<SourceChip>Recorded by CarUp logistics</SourceChip>} />
          <Fact label="Booking closes" value={recordedDay(container.booking_deadline)} />
          <Fact label="Estimated arrival" value={eta} source={<SourceChip>CarUp logistics estimate · not a carrier ETA</SourceChip>} />
        </dl>
        {!eta && <p className="text-xs text-carup-text-3">No arrival estimate is recorded. CarUp does not estimate one.</p>}
      </header>

      <NextMove testId="trade-containers-detail-next" title={move.title} usuallyWith={move.with} after={move.after} />

      <DeskPanel title="Space on this container" testId="trade-containers-space">
        <CapacityBar fill={fill} pending={pending} testId="trade-containers-capacity" />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-carup-text-2">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-carup-text" />Approved space</span>
          {pending > 0 && (
            <span className="inline-flex items-center gap-1.5" data-testid="trade-containers-pending-legend">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundImage: 'repeating-linear-gradient(135deg, var(--carup-raw-orange-signal) 0 2px, transparent 2px 4px)' }} />
              {formatCbm(pending)} requested · not counted until approved
            </span>
          )}
          <FillFlags fill={fill} />
        </div>

        {open ? (
          <form noValidate className="mt-4 flex flex-col gap-2 border-t border-carup-line pt-4 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void request() }} data-testid="trade-containers-request">
            <div className="min-w-0 sm:w-56">
              <label htmlFor={fieldId} className={WS_LABEL}>Space you need (CBM)</label>
              <input id={fieldId} type="number" inputMode="decimal" min="0" step="0.001" className={WS_FIELD} value={model.volume} onChange={(e) => model.setVolume(e.target.value)} data-testid="trade-containers-volume" />
            </div>
            <button type="submit" className={cn(WS_PRIMARY, 'whitespace-nowrap')} disabled={requesting} data-testid="trade-containers-request-submit">
              {requesting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Request space
            </button>
          </form>
        ) : (
          <p className="mt-4 border-t border-carup-line pt-4 text-sm text-carup-text-2" data-testid="trade-containers-request-closed">
            Space cannot be requested while the container is {status.label.toLowerCase()}.
          </p>
        )}
        {open && <p className={WS_HINT}>The server refuses a request larger than the container, and refuses an approval that would overfill it.</p>}
      </DeskPanel>

      <DeskPanel title={model.isReviewer ? 'All space requests' : 'Your space requests'} testId="trade-containers-reservations">
        {!model.isReviewer && <p className="mb-3 text-xs leading-5 text-carup-text-3">Only your own requests are shown. Other traders’ requests on this container are visible to CarUp logistics only.</p>}
        {!reservationsReady ? (
          <DeskState compact kind="loading" title="Loading space requests…" testId="trade-containers-reservations-loading" />
        ) : model.reservationsUnreadable ? (
          <DeskState compact kind="failed" title="Space requests could not be loaded" onRetry={() => void model.onOpen(container)} testId="trade-containers-reservations-failed">
            This is not a report that none exist{model.isReviewer ? ' — do not close booking on the strength of this list' : ''}.
          </DeskState>
        ) : reservations.length === 0 ? (
          <DeskState compact kind="empty" title={model.isReviewer ? 'No space requests on this container yet' : 'You have not requested space on this container'} testId="trade-containers-reservations-empty">
            {model.isReviewer ? 'Requests appear here as traders submit them.' : 'Use the form above. Your request then appears here with its review status.'}
          </DeskState>
        ) : (
          <ReservationLedger model={model} reservations={reservations} />
        )}
      </DeskPanel>

      {model.isReviewer && open && (
        <DeskPanel title="Close booking" testId="trade-containers-close">
          {closing === 'idle' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-carup-text-2">Stops new space requests for this container. Approved space is kept. It does not mean the container is loaded or shipped.</p>
              <button type="button" className={cn(WS_DANGER, 'shrink-0')} onClick={() => setClosing('confirm')} data-testid="trade-containers-close-booking">Close booking…</button>
            </div>
          ) : (
            <InlineConfirm
              tone="danger"
              testId="trade-containers-close-confirm"
              title="Close booking for this container?"
              confirm={<button type="button" className={WS_DANGER} disabled={closing === 'busy'} onClick={() => void closeBooking()} data-testid="trade-containers-close-confirm-yes">{closing === 'busy' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Close booking</button>}
              cancel={<button type="button" className={WS_SECONDARY} disabled={closing === 'busy'} onClick={() => setClosing('idle')}>Keep booking open</button>}
            >
              {pendingCount > 0 ? `${plural(pendingCount, 'request is', 'requests are')} still awaiting review. ` : ''}No new space can be requested once booking is closed.
            </InlineConfirm>
          )}
        </DeskPanel>
      )}
    </article>
  )
}

function ReservationLedger({ model, reservations }: { model: ContainerBoardModel; reservations: DiasporaMarketplaceReservation[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  async function run(id: string, fn: (id: string) => void | Promise<void>) {
    if (busy) return
    setBusy(id)
    try { await fn(id) } finally { setBusy(null); setRejecting(null) }
  }
  return (
    <ul className="divide-y divide-carup-line" data-testid="trade-containers-reservation-list">
      {reservations.map((r) => {
        const st = reservationStatus(r.reservation_status)
        const requested = String(r.reservation_status).toUpperCase() === 'REQUESTED'
        const weight = Number(r.estimated_weight)
        return (
          <li key={r.id} className="py-3 first:pt-0 last:pb-0" data-testid="trade-containers-reservation-row" data-status={String(r.reservation_status).toUpperCase()}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-bold tabular-nums text-carup-text">{formatCbm(r.estimated_volume)}</p>
                <p className="mt-0.5 text-xs text-carup-text-3">
                  {humanizeCode(r.cargo_type, 'Cargo type not recorded')}
                  {r.estimated_weight !== null && r.estimated_weight !== undefined && Number.isFinite(weight) ? ` · ${new Intl.NumberFormat('en-US').format(weight)} kg declared` : ''}
                  {' · '}{formatDay(r.created_at ?? null) ? `requested ${formatDay(r.created_at ?? null)}` : 'request date not recorded'}
                </p>
                {r.import_order_id && <p className="mt-0.5 text-xs text-carup-text-3">For import order <RefCode value={r.import_order_id} label="Import order" /></p>}
              </div>
              <StatusChip tone={st.tone}>{st.label}</StatusChip>
            </div>
            {model.isReviewer && requested && (
              rejecting === r.id ? (
                <div className="mt-3">
                  <InlineConfirm
                    tone="danger"
                    title={`Reject the request for ${formatCbm(r.estimated_volume)}?`}
                    confirm={<button type="button" className={WS_DANGER} disabled={busy !== null} onClick={() => void run(r.id, model.onReject)} data-testid="trade-containers-reject-confirm">{busy === r.id && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Reject request</button>}
                    cancel={<button type="button" className={WS_SECONDARY} disabled={busy !== null} onClick={() => setRejecting(null)}>Keep it</button>}
                  >
                    The trader sees it as rejected. No capacity changes.
                  </InlineConfirm>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={WS_PRIMARY} disabled={busy !== null} onClick={() => void run(r.id, model.onApprove)} data-testid="trade-containers-approve">
                    {busy === r.id && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Approve
                  </button>
                  <button type="button" className={WS_SECONDARY} disabled={busy !== null} onClick={() => setRejecting(r.id)} data-testid="trade-containers-reject">Reject…</button>
                </div>
              )
            )}
          </li>
        )
      })}
    </ul>
  )
}
