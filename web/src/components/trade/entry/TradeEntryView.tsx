/**
 * RX-06 — CarUp Trade entry (/diaspora). A public, editorial front door that stays truthful:
 *  - the Owner-approved sourcing film (poster-first, pausable, disclosed; code-drawn route as fallback);
 *  - the real starting action ("Start an import") and, when signed in, the account's own orders —
 *    clearly marked as LIVE data, separate from the editorial explanation around it;
 *  - how an import moves, phase by phase (the core lifecycle's phases; no dates, prices or promises);
 *  - what every order needs (the five required documents; uploaded is not verified);
 *  - the Trade tools, offered exactly as the feature registry allows for this viewer.
 * LR02 — a signed-out visitor understands CarUp Trade before being asked for an account: four intentions
 * with their true status, what an import involves, and a status board of every service (in place of the
 * tool list). The guest sections wait for the session check, so a signed-in visitor never sees them flash
 * while the stored session is validated (the page passes signedIn=false until then). Below-the-fold stills
 * mount only when their section nears the viewport (RX-07 phone LCP); the hero is unchanged.
 * The page passes the auth state, the orders read and the offered capabilities.
 */
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Compass, FileCheck, FileText, KeyRound, Lock, LogIn, PackageSearch, Plus, Scale, Ship, Sparkles, Store, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { buildLoginRedirect } from '@/lib/returnTo'
import { TRADE_PHASES, positionOf } from '@/components/trade/core/importOrderLifecycle'
import { TradeRouteScene } from '@/components/media/rx05/AutomotiveScenes'
import { EditorialFilm } from '@/components/showroom/EditorialFilm'
import { SOURCING_FILM } from '@/content/media/homeFilm'
import { TradeStill } from '@/components/media/rx06/TradeStill'
import { usableTradeStill } from '@/content/media/tradeStills'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { EmptyState } from '@/components/dealer/workspace/EmptyState'
import { WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import {
  REQUIRED_DOCUMENTS,
  REQUIRED_DOCUMENT_TYPES,
  documentTypeLabel,
  formatDay,
  orderStatusTone,
  orderTitle,
  phaseLine,
  statusLabel,
  timeOf,
  type Read,
  type TradeOrder,
} from '@/components/trade/order/orderModel'
import { useOrderHref } from '@/components/trade/order/orderLinks'
import {
  CAPABILITY_GROUP_LABEL,
  IMPORT_INVOLVES,
  IMPORT_PRINCIPLES,
  JOURNEY_COPY,
  PHASE_STILL,
  SERVICE_GROUPS,
  TRADE_INTENTIONS,
  type CapabilityGroup,
  type EntryAction,
  type IntentionKey,
  type OfferedCapability,
  type ServiceGroup,
  type TradeIntention,
} from './entryModel'
import { useNearViewport } from './useNearViewport'

const PAGE = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10'
const ON_INK_PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-carup-raw-orange-signal px-5 text-sm font-semibold text-carup-raw-ink transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-carup-raw-ink'
const ON_INK_SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-3'

export function TradeEntryView({ signedIn, orders, capabilities, loginHref }: {
  signedIn: boolean
  /** The account's import orders (signed in only). */
  orders?: Read<TradeOrder[]>
  capabilities: OfferedCapability[]
  /** Where "Sign in" goes (with a return path). */
  loginHref: string
}) {
  // A known guest only once the stored session (if any) has been checked.
  const { loading: sessionPending } = useAuth()
  const guest = !signedIn && !sessionPending
  return (
    <div className="bg-carup-bg text-carup-text" data-testid="trade-entry">
      <Hero signedIn={signedIn} loginHref={loginHref} />
      {signedIn && orders && <Desk orders={orders} />}
      {guest && <Intentions />}
      <Journey />
      <OneRecord />
      {guest && <WhatItInvolves />}
      <DocumentsNeeded />
      {guest ? <ServicesAtAGlance /> : <Tools capabilities={capabilities} signedIn={signedIn} />}
    </div>
  )
}

function Hero({ signedIn, loginHref }: { signedIn: boolean; loginHref: string }) {
  return (
    <section className="bg-carup-raw-ink text-white" aria-labelledby="trade-entry-title" data-testid="trade-entry-hero">
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-20">
          <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-carup-raw-orange-signal">
            CarUp Trade
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-[0.14em] text-white">Early access</span>
          </p>
          <h1 id="trade-entry-title" className="mt-4 max-w-xl text-[clamp(2rem,4.2vw,3.25rem)] font-bold leading-[1.05] tracking-[-0.035em]">
            Import the right car, and see every step until it is yours.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-white/80">
            Request a vehicle or parts from abroad, compare what sellers quote, and follow documents, shipping and customs on one order — with what was recorded, by whom and when.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/diaspora/imports/new" className={ON_INK_PRIMARY} data-testid="diaspora-start-import-button"><Plus className="h-4 w-4" aria-hidden="true" />Start an import</Link>
            {signedIn
              ? <Link to="/diaspora/imports" className={ON_INK_SECONDARY} data-testid="diaspora-view-imports-button">My import orders</Link>
              : <Link to={loginHref} className={ON_INK_SECONDARY} data-testid="trade-entry-sign-in">Sign in to see your orders</Link>}
          </div>
          <p className="mt-6 max-w-lg text-xs leading-5 text-white/70">CarUp never estimates prices, arrival dates or duty. Each step of an order shows only what was recorded.</p>
        </div>
        <div className="relative min-h-[15rem] sm:min-h-[22rem] lg:min-h-full">
          <EditorialFilm
            film={SOURCING_FILM}
            label="the sourcing film"
            className="absolute inset-0 h-full w-full"
            testId="trade-entry-film"
            fallback={<TradeRouteScene className="absolute inset-0 h-full w-full" milestones={TRADE_PHASES.filter((_, i) => i % 2 === 0 || i === TRADE_PHASES.length - 1).map(p => ({ key: p.key, label: p.short }))} />}
          />
        </div>
      </div>
    </section>
  )
}

function Desk({ orders }: { orders: Read<TradeOrder[]> }) {
  const orderHref = useOrderHref()
  return (
    <section className="border-b border-carup-line bg-carup-bg-raised" aria-labelledby="trade-entry-desk-title" data-testid="trade-entry-desk">
      <div className={cn(PAGE, 'py-6 sm:py-8')}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className={cn(EYEBROW, 'flex items-center gap-2')}><span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-success" />Your trade desk · live from your account</p>
            <h2 id="trade-entry-desk-title" className="mt-1 text-xl font-bold tracking-[-0.02em] text-carup-text">Your import orders</h2>
          </div>
          {orders.state === 'ready' && orders.data.length > 0 && (
            <Link to="/diaspora/imports" className={WS_TEXT_ACTION} data-testid="trade-entry-all-orders">All {orders.data.length} import orders <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          )}
        </div>
        <div className="mt-4">
          {orders.state === 'loading' && <EmptyState kind="loading" compact title="Loading your import orders…" testId="trade-entry-desk-loading" />}
          {orders.state === 'failed' && (
            <EmptyState kind="error" compact title="Your import orders could not be loaded" onRetry={orders.onRetry} testId="trade-entry-desk-failed">
              This is a failed read, not an empty list.
            </EmptyState>
          )}
          {(orders.state === 'denied' || orders.state === 'unavailable') && (
            <EmptyState kind="denied" compact title="Import orders are not available to this account" testId="trade-entry-desk-denied">
              Import orders belong to the importer who requested them and the participants CarUp assigns.
            </EmptyState>
          )}
          {orders.state === 'ready' && orders.data.length === 0 && (
            <EmptyState compact title="You have no import orders yet" testId="trade-entry-desk-empty" action={<Link to="/diaspora/imports/new" className={WS_PRIMARY}>Start your first import</Link>}>
              An order starts when you send a request. Nothing is booked or charged by sending it.
            </EmptyState>
          )}
          {orders.state === 'ready' && orders.data.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-3" data-testid="trade-entry-orders">
              {[...orders.data].sort((a, b) => (timeOf(b.updated_at ?? b.created_at) ?? 0) - (timeOf(a.updated_at ?? a.created_at) ?? 0)).slice(0, 3).map(o => (
                <li key={o.id}>
                  <Link to={orderHref(o.id)} className="flex h-full min-h-11 flex-col gap-2 rounded-card border border-carup-line bg-carup-bg p-4 transition-colors hover:border-carup-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus" data-testid="trade-entry-order">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-semibold text-carup-text [overflow-wrap:anywhere]">{orderTitle(o)}</span>
                      <code className="shrink-0 font-mono text-xs text-carup-text-3">{o.id.slice(0, 8)}</code>
                    </span>
                    <StatusChip tone={orderStatusTone(o.status)} className="self-start">{statusLabel(o.status)}</StatusChip>
                    <span className="text-xs text-carup-text-2">{phaseLine(o.status)}</span>
                    <span className="mt-auto text-xs text-carup-text-3">Updated {formatDay(o.updated_at ?? o.created_at) ?? 'date not recorded'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function Journey() {
  const start = positionOf('IMPORT_REQUESTED')
  // The seven stills sit below the fold: mount them only when this section nears the viewport.
  const sectionRef = useRef<HTMLElement | null>(null)
  const stillsNear = useNearViewport(sectionRef)
  return (
    <section ref={sectionRef} className={cn(PAGE, 'py-12 sm:py-16')} aria-labelledby="trade-entry-journey-title" data-testid="trade-entry-journey">
      <p className={EYEBROW}>How CarUp Trade works · an explanation, not your order</p>
      <h2 id="trade-entry-journey-title" className="mt-2 max-w-2xl text-[clamp(1.5rem,2.6vw,2.125rem)] font-bold leading-tight tracking-[-0.03em] text-carup-text">One order, seven phases, every step on record</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-carup-text-2">Every import order moves through the same canonical phases. Each one is marked only when it is recorded — and a phase can be skipped when the order does not need it. The pictures are editorial illustrations of each phase, not anyone’s shipment.</p>
      <div className="relative -mx-4 mt-8 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0" role="region" aria-label="The seven phases of an import" tabIndex={0} data-testid="trade-entry-journey-scroller">
        <ol className="flex snap-x snap-mandatory gap-3 lg:grid lg:grid-cols-4 lg:gap-4">
          {TRADE_PHASES.map((phase, i) => {
            const copy = JOURNEY_COPY[phase.key]
            const first = i === start.phaseIndex
            return (
              <li key={phase.key} className="w-[78%] shrink-0 snap-start sm:w-[44%] lg:w-auto" data-testid="trade-entry-phase">
                <article className="flex h-full flex-col overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised">
                  <DeferredStill near={stillsNear} still={PHASE_STILL[phase.key]} className="aspect-[4/3]" sizes="(min-width: 1024px) 22vw, (min-width: 640px) 44vw, 78vw" />
                  <div className="flex flex-1 flex-col p-4">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">
                      <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] tabular-nums', first ? 'text-carup-raw-ink' : 'bg-carup-raw-ink text-white')} style={first ? { background: 'var(--carup-raw-orange-signal)' } : undefined}>{i + 1}</span>
                      Phase {i + 1} of {TRADE_PHASES.length}{first ? ' · where a request starts' : ''}
                    </p>
                    <h3 className="mt-2 text-base font-semibold text-carup-text">{phase.label}</h3>
                    <p className="mt-1 text-sm leading-6 text-carup-text-2">{copy.what}</p>
                    <p className="mt-auto pt-3 text-xs font-semibold text-carup-text-3">Recorded: {copy.records}</p>
                  </div>
                </article>
              </li>
            )
          })}
          <li className="w-[78%] shrink-0 snap-start sm:w-[44%] lg:w-auto">
            <div className="flex h-full flex-col justify-between gap-6 rounded-card bg-carup-raw-ink p-5 text-white" data-testid="trade-entry-journey-truth">
              <Sparkles className="h-5 w-5 text-carup-raw-orange-signal" aria-hidden="true" />
              <div>
                <p className="text-base font-semibold">Records, not estimates</p>
                <p className="mt-1 text-sm leading-6 text-white/75">CarUp never estimates a price, an arrival date or a duty. Each order shows what was recorded, who recorded it and when — and says so when something is not recorded yet.</p>
              </div>
              <Link to="/diaspora/imports/new" className={ON_INK_PRIMARY}>Start an import</Link>
            </div>
          </li>
        </ol>
      </div>
    </section>
  )
}

/** Secondary editorial panel: one still, one idea (the film stays the hero). */
function OneRecord() {
  const still = Boolean(usableTradeStill('portDawn'))
  const sectionRef = useRef<HTMLElement | null>(null)
  const stillNear = useNearViewport(sectionRef)
  return (
    <section ref={sectionRef} className="bg-carup-raw-ink text-white" aria-labelledby="trade-entry-record-title" data-testid="trade-entry-one-record">
      <div className={cn('mx-auto grid max-w-[1440px]', still && 'lg:grid-cols-2')}>
        {still && <DeferredStill near={stillNear} still="portDawn" className="aspect-[16/10] lg:aspect-auto lg:h-full lg:min-h-[24rem]" sizes="(min-width: 1024px) 50vw, 100vw" />}
        <div className="flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-12 lg:py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-carup-raw-orange-signal">Why one record</p>
          <h2 id="trade-entry-record-title" className="mt-2 max-w-md text-[clamp(1.5rem,2.6vw,2.125rem)] font-bold leading-tight tracking-[-0.03em]">Many hands, one record</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/80">An import passes through a seller, a port, a ship, a border post, a workshop and a registry. CarUp Trade keeps every hand-off on the same order, and shows only what the party responsible recorded.</p>
        </div>
      </div>
    </section>
  )
}

function DocumentsNeeded() {
  return (
    <section className="border-y border-carup-line bg-carup-bg-raised" aria-labelledby="trade-entry-docs-title" data-testid="trade-entry-documents">
      <div className={cn(PAGE, 'py-10 sm:py-12')}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-10">
          <div>
            <p className={EYEBROW}>Before anything ships</p>
            <h2 id="trade-entry-docs-title" className="mt-2 text-xl font-bold tracking-[-0.02em] text-carup-text">What every import order needs</h2>
            <p className="mt-2 text-sm leading-6 text-carup-text-2">Each order tracks the same five required documents. Uploading one is not the same as it being verified — a CarUp reviewer checks every original, and the order shows both facts separately.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {REQUIRED_DOCUMENTS.map(name => (
              <li key={name} className="flex gap-3 rounded-card border border-carup-line bg-carup-bg p-4" data-testid="diaspora-documents-preview-row">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-carup-text-3" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-carup-text">{name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-carup-text-3">Accepted as {(REQUIRED_DOCUMENT_TYPES[name] ?? []).map(documentTypeLabel).join(', ')}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Tools({ capabilities, signedIn }: { capabilities: OfferedCapability[]; signedIn: boolean }) {
  const groups = (['import', 'trade', 'operate'] as CapabilityGroup[])
    .map(group => ({ group, items: capabilities.filter(c => c.group === group) }))
    .filter(g => g.items.length > 0)
  return (
    <section className={cn(PAGE, 'py-12 sm:py-16')} aria-labelledby="trade-entry-tools-title" data-testid="trade-entry-tools">
      <p className={EYEBROW}>{signedIn ? 'What your account can open' : 'Sign in to use them'}</p>
      <h2 id="trade-entry-tools-title" className="mt-2 text-xl font-bold tracking-[-0.02em] text-carup-text">Everything in CarUp Trade</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-carup-text-2">
        {signedIn
          ? 'Tools marked “for another Trade role” belong to exporters, dealers or CarUp operations; your account cannot open them.'
          : 'Which tools you can open depends on your Trade role — importer, exporter or dealer, or CarUp operations.'}
      </p>
      <div className="mt-8 space-y-8">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h3 className="text-sm font-semibold text-carup-text">{CAPABILITY_GROUP_LABEL[group]} <span className="font-normal text-carup-text-3">· {items.length}</span></h3>
            {/* Phones: one swipeable row per group; wider screens: a grid. */}
            <div className="relative -mx-4 mt-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0" role="region" aria-label={`${CAPABILITY_GROUP_LABEL[group]} tools`} tabIndex={0}>
            <ul className="flex snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-3">
              {items.map(cap => (
                <li key={cap.route} className="w-[78%] shrink-0 snap-start sm:w-auto" data-testid="trade-entry-tool" data-availability={cap.availability}>
                  {cap.availability === 'unreleased' ? (
                    <Link to={cap.route} className="group flex h-full min-h-11 flex-col rounded-card border border-dashed border-carup-line-strong bg-carup-bg-raised p-4 transition-colors hover:border-carup-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-carup-text">{cap.title}<StatusChip tone="neutral">Built · not yet released</StatusChip></span>
                      <span className="mt-1 flex-1 text-sm leading-6 text-carup-text-2">{cap.what}</span>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-carup-action">Open <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                    </Link>
                  ) : cap.availability === 'other-role' ? (
                    <div className="h-full rounded-card border border-dashed border-carup-line p-4">
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-carup-text-2">{cap.title}<Lock className="h-4 w-4 text-carup-text-3" aria-hidden="true" /></p>
                      <p className="mt-1 text-sm leading-6 text-carup-text-3">{cap.what}</p>
                      <p className="mt-2 text-xs font-semibold text-carup-text-3">For another Trade role</p>
                    </div>
                  ) : (
                    <Link
                      to={cap.availability === 'available' ? cap.route : buildLoginRedirect(cap.route)}
                      className="group flex h-full min-h-11 flex-col rounded-card border border-carup-line bg-carup-bg-raised p-4 transition-colors hover:border-carup-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                    >
                      <span className="text-sm font-semibold text-carup-text">{cap.title}</span>
                      <span className="mt-1 flex-1 text-sm leading-6 text-carup-text-2">{cap.what}</span>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-carup-action">
                        {cap.availability === 'available' ? 'Open' : 'Sign in to open'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** A below-the-fold still: mounted once its section is near the viewport; until then its reserved box. */
function DeferredStill({ near, still, className, sizes }: { near: boolean; still: string; className: string; sizes: string }) {
  if (near) return <TradeStill still={still} className={className} sizes={sizes} />
  if (!usableTradeStill(still)) return null
  return <div aria-hidden="true" className={cn('bg-carup-raw-ink', className)} data-testid="trade-entry-still-slot" data-still={still} />
}

/* ── LR02 — guests ──────────────────────────────────────────────────────────────────────────────── */

const INTENT_ICON: Record<IntentionKey, LucideIcon> = { source: PackageSearch, move: Ship, learn: Compass, sell: Store }
const INVOLVES_ICON: Record<(typeof IMPORT_INVOLVES)[number]['key'], LucideIcon> = { quotes: Scale, documents: FileCheck, shipping: Ship, delivery: KeyRound }
const SECTION_TITLE = 'mt-2 max-w-2xl text-[clamp(1.5rem,2.6vw,2.125rem)] font-bold leading-tight tracking-[-0.03em] text-carup-text'
const SECTION_LEAD = 'mt-2 max-w-2xl text-sm leading-6 text-carup-text-2'

function ActionLink({ action, primary = false }: { action: EntryAction; primary?: boolean }) {
  return (
    <Link to={action.href} className={cn(primary ? WS_PRIMARY : WS_SECONDARY, 'w-full text-center sm:w-auto')} data-testid={action.testId}>
      {action.signIn && <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {action.label}
      {primary && <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </Link>
  )
}

/** The four ways in, each with its true status and only real actions. */
function Intentions() {
  return (
    <section className="border-b border-carup-line bg-carup-bg-raised" aria-labelledby="trade-entry-intentions-title" data-testid="trade-entry-intentions">
      <div className={cn(PAGE, 'py-12 sm:py-16')}>
        <p className={EYEBROW}>Start here · no account needed to explore</p>
        <h2 id="trade-entry-intentions-title" className={SECTION_TITLE}>What do you want to do?</h2>
        <p className={SECTION_LEAD}>Explore all of this without an account. CarUp asks you to sign in only when you send a request, or open something that belongs to your account.</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {TRADE_INTENTIONS.map(intent => (
            <li key={intent.key} className="min-w-0"><IntentionCard intent={intent} /></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function IntentionCard({ intent }: { intent: TradeIntention }) {
  const Icon = INTENT_ICON[intent.key]
  const titleId = `trade-intent-${intent.key}-title`
  return (
    <article
      aria-labelledby={titleId}
      className={cn('flex h-full flex-col rounded-card p-5 sm:p-6', intent.quiet ? 'border border-dashed border-carup-line-strong bg-carup-bg' : 'border border-carup-line bg-carup-bg shadow-sm')}
      data-testid={`trade-intent-${intent.key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2.5" aria-hidden="true">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-carup-raw-ink font-mono text-xs font-semibold text-white">{intent.letter}</span>
          <Icon className="h-5 w-5 text-carup-text-3" />
        </span>
        <StatusChip tone={intent.tone} testId={`trade-intent-${intent.key}-status`}>{intent.status}</StatusChip>
      </div>
      <h3 id={titleId} className="mt-4 text-lg font-semibold tracking-[-0.01em] text-carup-text">{intent.title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-carup-text-2">{intent.lead}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-carup-text-2">
        {intent.points.map(point => (
          <li key={point} className="flex gap-2.5"><span aria-hidden="true" className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-carup-text-3" />{point}</li>
        ))}
      </ul>
      {(intent.primary || intent.secondary) && (
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {intent.primary && <ActionLink action={intent.primary} primary />}
          {intent.secondary && <ActionLink action={intent.secondary} />}
        </div>
      )}
    </article>
  )
}

/** Quotations, documents, shipping and delivery — what each is, and what CarUp does and does not do. */
function WhatItInvolves() {
  return (
    <section className={cn(PAGE, 'py-12 sm:py-16')} aria-labelledby="trade-entry-involves-title" data-testid="trade-entry-involves">
      <p className={EYEBROW}>Before you start</p>
      <h2 id="trade-entry-involves-title" className={SECTION_TITLE}>What an import involves</h2>
      <p className={SECTION_LEAD}>Four parts every import passes through, in plain words.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {IMPORT_INVOLVES.map(part => {
          const Icon = INVOLVES_ICON[part.key]
          return (
            <li key={part.key} className="rounded-card border border-carup-line bg-carup-bg-raised p-5" data-testid={`trade-involves-${part.key}`}>
              <Icon className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold text-carup-text">{part.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-carup-text-2">{part.body}</p>
            </li>
          )
        })}
      </ul>
      <ul className="mt-4 grid gap-3 rounded-card bg-carup-raw-ink p-5 text-sm leading-6 text-white sm:p-6 lg:grid-cols-3" data-testid="trade-involves-principles">
        {IMPORT_PRINCIPLES.map(principle => (
          <li key={principle} className="flex items-start gap-2.5"><Check className="mt-1 h-4 w-4 shrink-0 text-carup-raw-orange-signal" aria-hidden="true" />{principle}</li>
        ))}
      </ul>
    </section>
  )
}

/** A truthful status board of every Trade service (in place of the tool list, for guests). */
function ServicesAtAGlance() {
  return (
    <section className={cn(PAGE, 'py-12 sm:py-16')} aria-labelledby="trade-entry-services-title" data-testid="trade-entry-services">
      <p className={EYEBROW}>Where each service stands</p>
      <h2 id="trade-entry-services-title" className={SECTION_TITLE}>Services at a glance</h2>
      <p className={SECTION_LEAD}>Every service with its true status. Anything not yet released here, or still waiting to join, cannot be opened from this page.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SERVICE_GROUPS.map(group => <ServiceGroupCard key={group.key} group={group} />)}
      </div>
    </section>
  )
}

function ServiceGroupCard({ group }: { group: ServiceGroup }) {
  const muted = group.key === 'unreleased' || group.key === 'planned'
  return (
    <section
      aria-labelledby={`trade-services-${group.key}-title`}
      className={cn('flex h-full flex-col rounded-card p-5', muted ? 'border border-dashed border-carup-line-strong' : 'border border-carup-line bg-carup-bg-raised')}
      data-testid={`trade-services-${group.key}`}
    >
      <h3 id={`trade-services-${group.key}-title`}><StatusChip tone={group.tone} testId={`trade-services-${group.key}-status`}>{group.status}</StatusChip></h3>
      <p className="mt-2 text-xs leading-5 text-carup-text-3">{group.note}</p>
      <ul className="mt-3 flex-1 divide-y divide-carup-line">
        {group.items.map(item => (
          <li key={item.title} className="py-2.5 first:pt-0" data-extraction={item.extraction}>
            {item.href ? (
              <Link to={item.href} className="group flex min-h-11 items-start justify-between gap-3 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus" data-testid="trade-services-link">
                <ServiceText item={item} muted={muted} />
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-carup-action transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </Link>
            ) : (
              <ServiceText item={item} muted={muted} />
            )}
          </li>
        ))}
      </ul>
      {group.action && <div className="pt-4"><ActionLink action={group.action} /></div>}
    </section>
  )
}

function ServiceText({ item, muted }: { item: { title: string; detail?: string }; muted: boolean }) {
  return (
    <span className="min-w-0">
      <span className={cn('block text-sm font-semibold', muted ? 'text-carup-text-2' : 'text-carup-text')}>{item.title}</span>
      {item.detail && <span className="mt-0.5 block text-xs leading-5 text-carup-text-3">{item.detail}</span>}
    </span>
  )
}
