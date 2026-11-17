/**
 * RX05-F — the RX-06 Trade north-star (DEV ONLY; never in a production build — App.tsx creates the
 * route only when import.meta.env.DEV and scripts/assert-no-dev-pages.mjs proves no chunk, test id or
 * route ships). A DESIGN PROTOTYPE, not Trade: it calls no API, migrates no Trade logic and replaces no
 * live Trade source. Every order value is a FIXTURE and says so on screen.
 *
 * It answers master plan §22.5 / UX-REF-07: the Import Order is the anchor object — one object header,
 * one lifecycle rail (fed in RX-06 by ONE backend projection; the phase grouping below maps the real
 * 20-state import-order lifecycle used by DiasporaOrderPassport), one next-action region, and tabs
 * Overview · Quotes · Documents · Shipping · Customs · Payments · Activity.
 */
import { useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, Check, CircleDashed, Clock, FileText, Info, Package, RefreshCw, Ship, ShieldCheck, Upload,
} from 'lucide-react'
import { TradeRouteScene, type TradeMilestone } from '@/components/media/rx05/AutomotiveScenes'
import { EditorialFilm } from '@/components/showroom/EditorialFilm'
import { SOURCING_FILM } from '@/content/media/homeFilm'
import { cn } from '@/lib/utils'

/** The real import-order lifecycle (DiasporaOrderPassport ORDER_LIFECYCLE), grouped for people. */
const PHASES: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'request', label: 'Request & quotes', statuses: ['IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED'] },
  { key: 'documents', label: 'Documents', statuses: ['DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED'] },
  { key: 'loading', label: 'Booking & loading', statuses: ['CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED'] },
  { key: 'sea', label: 'At sea', statuses: ['SHIPPED'] },
  { key: 'customs', label: 'Border & customs', statuses: ['ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED'] },
  { key: 'ready', label: 'Zimbabwe ready', statuses: ['REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING', 'INSURANCE_PENDING', 'ZIMBABWE_READY'] },
  { key: 'handover', label: 'Handover', statuses: ['LOCAL_LISTING_ENABLED', 'COMPLETED'] },
]
type PhaseState = 'done' | 'current' | 'upcoming'
function phaseStates(status: string): PhaseState[] {
  const idx = PHASES.findIndex(p => p.statuses.includes(status))
  return PHASES.map((_, i) => (idx < 0 ? 'upcoming' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming'))
}

type DocState = 'verified' | 'uploaded' | 'missing'
const FIXTURE = {
  ref: 'FIXTURE-IO-0001',
  title: 'Toyota Hilux 2.8 GD-6 double cab, 2019–2021',
  route: 'Yokohama, Japan → Harare, Zimbabwe',
  status: 'SHIPPED',
  budget: 'USD 28,000 (your stated budget)',
  quotes: [
    { seller: 'Fixture exporter A', amount: 'USD 24,950 FOB', status: 'Accepted', received: '3 Nov', note: 'Unit inspected by the seller; CarUp has not verified it.' },
    { seller: 'Fixture exporter B', amount: 'USD 26,400 FOB', status: 'Declined by you', received: '4 Nov', note: '' },
  ],
  documents: [
    { name: 'Bill of lading', required: true, state: 'verified' as DocState, by: 'CarUp document reviewer', at: '15 Nov' },
    { name: 'CBCA pre-shipment inspection certificate', required: true, state: 'verified' as DocState, by: 'CarUp document reviewer', at: '12 Nov' },
    { name: 'Export de-registration certificate', required: true, state: 'uploaded' as DocState, by: 'Uploaded by seller · awaiting review', at: '10 Nov' },
    { name: 'Commercial invoice', required: true, state: 'missing' as DocState, by: 'Seller to upload', at: '' },
    { name: 'Your ID for customs clearance', required: true, state: 'uploaded' as DocState, by: 'Uploaded by you · awaiting review', at: '9 Nov' },
  ],
  shipping: [
    { at: '14 Nov', label: 'Container loaded', source: 'Shipping line notice, recorded by CarUp operations' },
    { at: '15 Nov', label: 'Vessel departed Yokohama', source: 'Shipping line notice, recorded by CarUp operations' },
  ],
  payments: [
    { label: 'Deposit (30%)', amount: 'USD 7,485', state: 'Recorded as paid (sandbox)' },
    { label: 'Balance before release (70%)', amount: 'USD 17,465', state: 'Not due yet' },
    { label: 'Duty and clearing', amount: 'Not yet assessed', state: 'Assessed by ZIMRA at the border' },
  ],
  activity: [
    { at: '15 Nov 09:12', who: 'CarUp operations', what: 'Recorded vessel departure from the shipping line notice' },
    { at: '15 Nov 08:40', who: 'Document reviewer', what: 'Verified the bill of lading' },
    { at: '12 Nov 16:05', who: 'Document reviewer', what: 'Verified the CBCA inspection certificate' },
    { at: '10 Nov 11:30', who: 'Fixture exporter A', what: 'Uploaded the export de-registration certificate' },
    { at: '3 Nov 14:22', who: 'You', what: 'Accepted the quote from Fixture exporter A' },
  ],
}
const TABS = ['Overview', 'Quotes', 'Documents', 'Shipping', 'Customs', 'Payments', 'Activity'] as const
type Tab = typeof TABS[number]

function FixtureTag({ children = 'FIXTURE' }: { children?: string }) {
  return <span className="inline-flex items-center rounded-full border border-status-warning bg-status-warning-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-warning">{children}</span>
}

function LifecycleRail({ status, compact = false }: { status: string; compact?: boolean }) {
  const states = phaseStates(status)
  return (
    <ol className={cn('relative flex gap-1', compact ? 'overflow-x-auto pb-1' : 'flex-wrap sm:flex-nowrap')} aria-label="Import lifecycle" data-testid="ns-lifecycle-rail">
      {PHASES.map((p, i) => {
        const s = states[i]
        return (
          <li key={p.key} className={cn(compact ? 'w-[6.5rem] shrink-0' : 'min-w-0 flex-1 basis-[calc(25%-0.25rem)] sm:basis-0')} aria-current={s === 'current' ? 'step' : undefined}>
            <div className="h-1.5 rounded-full" style={{ background: s === 'done' ? 'var(--carup-color-text)' : s === 'current' ? 'var(--carup-raw-orange-signal)' : 'var(--carup-color-line)' }} />
            <p className={cn('mt-2 flex items-center gap-1 text-xs', s === 'upcoming' ? 'text-carup-text-3' : 'font-semibold text-carup-text')}>
              {s === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s === 'current' ? <Ship className="h-3.5 w-3.5 text-carup-action" aria-hidden="true" /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />}
              {p.label}
            </p>
            <p className="sr-only">{s === 'done' ? 'completed' : s === 'current' ? 'current stage' : 'not started'}</p>
          </li>
        )
      })}
    </ol>
  )
}

function DocRow({ d }: { d: typeof FIXTURE.documents[number] }) {
  const tone = d.state === 'verified' ? 'text-status-success bg-status-success-soft' : d.state === 'uploaded' ? 'text-status-info bg-status-info-soft' : 'text-status-warning bg-status-warning-soft'
  const label = d.state === 'verified' ? 'Verified' : d.state === 'uploaded' ? 'Uploaded · not yet verified' : 'Missing'
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3">
      <FileText className="hidden h-4 w-4 shrink-0 text-carup-text-3 sm:block" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-carup-text">{d.name}{d.required && <span className="ml-1.5 text-xs font-normal text-carup-text-3">required</span>}</p>
        <p className="text-xs text-carup-text-3">{d.by}{d.at && ` · ${d.at}`}</p>
      </div>
      <span className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-semibold', tone)}>{label}</span>
    </li>
  )
}

function TabBody({ tab, compact }: { tab: Tab; compact: boolean }) {
  const panel = 'rounded-card border border-carup-line bg-carup-bg-raised p-4'
  switch (tab) {
    case 'Overview':
      return (
        <div className={cn('grid gap-4', !compact && 'md:grid-cols-2')}>
          <div className={panel}>
            <h4 className="text-sm font-semibold text-carup-text">What you asked for</h4>
            <dl className="mt-2 space-y-2 text-sm">
              {([['Vehicle', FIXTURE.title], ['Route', FIXTURE.route], ['Budget', FIXTURE.budget]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-carup-text-3">{k}</dt><dd className="text-carup-text">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div className={panel}>
            <h4 className="text-sm font-semibold text-carup-text">Documents</h4>
            <p className="mt-2 text-sm text-carup-text-2">2 of 5 required documents verified · 2 awaiting review · 1 missing</p>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-carup-bg-surface-2" aria-hidden="true">
              <span className="bg-status-success" style={{ width: '40%' }} /><span className="bg-status-info" style={{ width: '40%' }} />
            </div>
          </div>
        </div>
      )
    case 'Quotes':
      return (
        <ul className="space-y-3">
          {FIXTURE.quotes.map(q => (
            <li key={q.seller} className={panel}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-carup-text">{q.seller}</p>
                <p className="text-lg font-bold tabular-nums text-carup-text">{q.amount}</p>
              </div>
              <p className="mt-1 text-sm text-carup-text-2">{q.status} · received {q.received}</p>
              {q.note && <p className="mt-1 text-xs text-carup-text-3">{q.note}</p>}
            </li>
          ))}
          <li className="text-xs text-carup-text-3">Freight, insurance and duty are not included in a seller’s FOB quote and are never estimated here.</li>
        </ul>
      )
    case 'Documents':
      return (
        <div className={panel}>
          <p className="text-sm text-carup-text-2">Who uploaded each document, and who verified it. Uploaded is not verified.</p>
          <ul className="mt-2 divide-y divide-carup-line">{FIXTURE.documents.map(d => <DocRow key={d.name} d={d} />)}</ul>
        </div>
      )
    case 'Shipping':
      return (
        <div className={panel}>
          <ol className="space-y-3 border-l-2 border-carup-line pl-4">
            {FIXTURE.shipping.map(e => (
              <li key={e.label}>
                <p className="text-sm font-semibold text-carup-text">{e.label} <span className="font-normal text-carup-text-3">· {e.at}</span></p>
                <p className="text-xs text-carup-text-3">Source: {e.source}</p>
              </li>
            ))}
            <li>
              <p className="text-sm font-semibold text-carup-text-2">Arrival at Durban or Beira</p>
              <p className="text-xs text-carup-text-3">ETA not confirmed by the shipping line — CarUp does not estimate one.</p>
            </li>
          </ol>
        </div>
      )
    case 'Customs':
      return (
        <div className={panel}>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-status-success" aria-hidden="true" /><span className="text-carup-text">CBCA pre-shipment inspection certificate verified (12 Nov)</span></li>
            <li className="flex gap-2"><CircleDashed className="mt-0.5 h-4 w-4 text-carup-text-3" aria-hidden="true" /><span className="text-carup-text-2">Border arrival and ZIMRA assessment — not started</span></li>
            <li className="flex gap-2"><CircleDashed className="mt-0.5 h-4 w-4 text-carup-text-3" aria-hidden="true" /><span className="text-carup-text-2">Duty payment and release — not started</span></li>
          </ul>
          <p className="mt-3 text-xs text-carup-text-3">Duty is assessed by the authority at the border. CarUp shows it once recorded and never pre-calculates it.</p>
        </div>
      )
    case 'Payments':
      return (
        <div className={panel}>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-status-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Live payments are not active. These milestones are sandbox fixtures.</p>
          <ul className="divide-y divide-carup-line">
            {FIXTURE.payments.map(p => (
              <li key={p.label} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-sm text-carup-text">{p.label}</span>
                <span className="text-right"><span className="block font-semibold tabular-nums text-carup-text">{p.amount}</span><span className="text-xs text-carup-text-3">{p.state}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'Activity':
      return (
        <ol className={cn(panel, 'space-y-2.5')}>
          {FIXTURE.activity.map(a => (
            <li key={a.at} className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
              <span className="tabular-nums text-carup-text-3">{a.at}</span>
              <span className="text-carup-text"><span className="font-semibold">{a.who}</span> — {a.what}</span>
            </li>
          ))}
        </ol>
      )
  }
}

function ImportOrder({ compact = false }: { compact?: boolean }) {
  const [tab, setTab] = useState<Tab>('Overview')
  const id = compact ? 'ns-m' : 'ns-d'
  return (
    <article className="min-w-0 space-y-4" data-testid={compact ? 'ns-order-mobile' : 'ns-order-desktop'} aria-label="Import order (fixture)">
      {/* Object header */}
      <header className="rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2"><FixtureTag /><span className="font-mono text-xs text-carup-text-3">{FIXTURE.ref}</span></div>
        <h3 className={cn('mt-2 font-bold tracking-tight text-carup-text', compact ? 'text-lg' : 'text-2xl')}>{FIXTURE.title}</h3>
        <p className="mt-1 text-sm text-carup-text-2">{FIXTURE.route}</p>
        <div className="mt-4"><LifecycleRail status={FIXTURE.status} compact={compact} /></div>
      </header>
      {/* Next-action region: who owns the next step, and what the buyer can do now */}
      <section aria-labelledby={`${id}-next`} className="rounded-card border border-carup-line-strong bg-carup-bg-raised p-4" style={{ boxShadow: 'inset 4px 0 0 var(--carup-raw-orange-signal)' }} data-testid="ns-next-action">
        <h4 id={`${id}-next`} className="text-xs font-semibold uppercase tracking-wide text-carup-text-3">What happens next</h4>
        <p className="mt-1 font-semibold text-carup-text">The seller needs to upload the commercial invoice before arrival.</p>
        <p className="mt-1 text-sm text-carup-text-2">Nothing is needed from you right now. We will tell you when the vessel arrives and customs starts.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on">Message the seller<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-carup-line-strong px-4 text-sm font-semibold text-carup-text">View documents</button>
        </div>
      </section>
      {/* Tabs */}
      <div>
        <div role="tablist" aria-label="Order sections" className="flex gap-1 overflow-x-auto border-b border-carup-line">
          {TABS.map(t => (
            <button key={t} role="tab" type="button" id={`${id}-tab-${t}`} aria-selected={tab === t} aria-controls={`${id}-panel`} onClick={() => setTab(t)}
              className={cn('min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold', tab === t ? 'border-carup-action text-carup-text' : 'border-transparent text-carup-text-2 hover:text-carup-text')}>
              {t}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} className="pt-4"><TabBody tab={tab} compact={compact} /></div>
      </div>
    </article>
  )
}

function StateCard({ icon, title, body, action, tone }: { icon: ReactNode; title: string; body: string; action?: string; tone: 'neutral' | 'info' | 'danger' | 'warning' }) {
  const t = { neutral: 'bg-status-neutral-soft text-status-neutral', info: 'bg-status-info-soft text-status-info', danger: 'bg-status-danger-soft text-status-danger', warning: 'bg-status-warning-soft text-status-warning' }[tone]
  return (
    <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-control', t)} aria-hidden="true">{icon}</span>
      <h4 className="mt-3 font-semibold text-carup-text">{title}</h4>
      <p className="mt-1 text-sm text-carup-text-2">{body}</p>
      {action && <p className="mt-3 inline-flex min-h-10 items-center rounded-control border border-carup-line-strong px-3 text-sm font-semibold text-carup-text">{action}</p>}
    </div>
  )
}

const SHOTS = [
  ['T1 · Dawn at the origin port', '6 s · slow push-in', 'Quay cranes against first light; rows of unbadged vehicles waiting. No readable company marks, no plates.'],
  ['T2 · The lift', '5 s · low angle, crane tracking', 'A container rises; one unbadged pickup visible inside before the doors close.'],
  ['T3 · Crossing', '6 s · aerial drift', 'A container vessel on open sea at golden hour; CarUp orange only as a light, never a logo on the hull.'],
  ['T4 · Arrival and clearance', '5 s · handheld, shallow focus', 'Port gate at dusk, an officer’s silhouette, papers out of focus — never a readable document, stamp or authority emblem.'],
  ['T5 · Handover in Harare', '7 s · gentle orbit', 'Keys passed between two hands beside the vehicle under jacaranda; faces not identifiable.'],
] as const

export default function Rx06TradeNorthStar() {
  return (
    <div className="min-h-screen bg-carup-bg px-4 py-8 text-carup-text sm:px-8" data-testid="rx06-trade-north-star">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-status-warning">Design prototype · DEV only · not the live product · every order value is a fixture</p>
      <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.4rem)] font-bold tracking-[-0.03em]">RX-06 Trade north-star</h1>
      <p className="mt-2 max-w-3xl text-sm text-carup-text-2">The Import Order as the anchor object (master plan §22.5, UX-REF-07). No API is called, no Trade logic is migrated and the live Trade pages are unchanged.</p>

      {/* 1 — Entry and overview composition */}
      <section className="mt-10" aria-labelledby="ns-entry">
        <h2 id="ns-entry" className="text-lg font-semibold">1 · Trade entry</h2>
        <div className="mt-3 overflow-hidden rounded-card bg-carup-raw-ink text-carup-raw-paper">
          <div className="grid lg:grid-cols-[1.1fr_1fr]">
            <div className="p-6 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-carup-raw-orange-signal">CarUp Trade</p>
              <p className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Import the right car, and see every step until it is yours.</p>
              <p className="mt-3 max-w-md text-sm text-white/75">Request a vehicle, compare seller quotes, and follow documents, shipping and customs in one order — with who did what, and when.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex min-h-11 items-center rounded-control bg-carup-raw-orange-signal px-5 text-sm font-semibold text-carup-raw-ink">Start an import</span>
                <span className="inline-flex min-h-11 items-center rounded-control border border-white/25 px-5 text-sm font-semibold text-white">My import orders</span>
              </div>
              <ol className="mt-8 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-white/75 sm:grid-cols-4">
                {['Request', 'Quotes', 'Documents', 'Shipping', 'Customs', 'Zimbabwe ready', 'Handover'].map((s, i) => <li key={s}><span className="font-semibold text-white">{i + 1}</span> {s}</li>)}
              </ol>
            </div>
            <div className="relative min-h-[16rem]">
              <EditorialFilm film={SOURCING_FILM} label="the sourcing film" className="absolute inset-0 h-full w-full" testId="ns-entry-film"
                fallback={<TradeRouteScene className="absolute inset-0 h-full w-full" milestones={[{ key: 'a', label: 'Origin' }, { key: 'b', label: 'Sea' }, { key: 'c', label: 'Harare' }]} />} />
            </div>
          </div>
        </div>
      </section>

      {/* 2 — Import Order detail (desktop) */}
      <section className="mt-12" aria-labelledby="ns-order">
        <h2 id="ns-order" className="text-lg font-semibold">2 · Import Order — the anchor object</h2>
        <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <ImportOrder />
          <aside className="space-y-3">
            <TradeRouteScene className="aspect-[12/5] w-full rounded-card" milestones={([[0, 'Quotes'], [2, 'Loading'], [3, 'At sea'], [4, 'Customs'], [6, 'Handover']] as const).map(([i, label]) => (
              { key: PHASES[i].key, label, state: phaseStates(FIXTURE.status)[i] } as TradeMilestone
            ))} />
            <p className="text-xs text-carup-text-3">The illustration mirrors the rail’s state; it never shows a vessel position, ETA or document the order does not have.</p>
          </aside>
        </div>
      </section>

      {/* 3 — Mobile journey */}
      <section className="mt-12" aria-labelledby="ns-mobile">
        <h2 id="ns-mobile" className="text-lg font-semibold">3 · Mobile journey (390 px)</h2>
        <div className="mt-3 w-full max-w-[390px] rounded-[2rem] border-8 border-carup-raw-ink bg-carup-bg p-3">
          <ImportOrder compact />
        </div>
      </section>

      {/* 4 — Truthful states */}
      <section className="mt-12" aria-labelledby="ns-states">
        <h2 id="ns-states" className="text-lg font-semibold">4 · Empty, pending, blocked and error states</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StateCard tone="neutral" icon={<Package className="h-4 w-4" />} title="No import orders yet" body="Start with the car you want and where it should arrive. Sellers quote; nothing is charged to ask." action="Start an import" />
          <StateCard tone="info" icon={<Clock className="h-4 w-4" />} title="Documents awaiting review" body="2 uploaded documents are waiting for a CarUp reviewer. Uploaded is not verified; we show who verifies each one." action="View documents" />
          <StateCard tone="warning" icon={<ShieldCheck className="h-4 w-4" />} title="Held at customs" body="The authority recorded a hold. CarUp shows the reason it was given and does not predict a release date." action="See the recorded reason" />
          <StateCard tone="danger" icon={<RefreshCw className="h-4 w-4" />} title="This order could not be loaded" body="Nothing about your order has changed. Try again; if it keeps failing, CarUp support can see the same record." action="Try again" />
        </div>
      </section>

      {/* 5 — Media placement and film storyboard */}
      <section className="mt-12" aria-labelledby="ns-media">
        <h2 id="ns-media" className="text-lg font-semibold">5 · Media placement and the Trade film storyboard</h2>
        <ul className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <li className="rounded-card border border-carup-line bg-carup-bg-raised p-4"><p className="font-semibold">Entry (public)</p><p className="mt-1 text-carup-text-2">Owner-approved sourcing film, poster first, pausable; reduced motion / Data Saver → poster only; disclosure always visible.</p></li>
          <li className="rounded-card border border-carup-line bg-carup-bg-raised p-4"><p className="font-semibold">Order detail (signed in)</p><p className="mt-1 text-carup-text-2">Only the code-drawn route illustration, labelled. No film behind documents, payments or customs data.</p></li>
          <li className="rounded-card border border-carup-line bg-carup-bg-raised p-4"><p className="font-semibold">Phones</p><p className="mt-1 text-carup-text-2">No film inside an order. The rail and next action come first; the illustration is omitted below 768 px.</p></li>
        </ul>
        <div className="mt-4 rounded-card border border-carup-line bg-carup-bg-raised p-4">
          <div className="flex flex-wrap items-center gap-2"><Info className="h-4 w-4 text-status-info" aria-hidden="true" /><p className="text-sm font-semibold">Storyboard — “From port to Harare” (specification only; generation not authorised in RX-05)</p></div>
          <ol className="mt-3 grid gap-3 md:grid-cols-5">
            {SHOTS.map(([title, timing, body]) => (
              <li key={title} className="rounded-control bg-carup-bg-surface p-3">
                <p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs text-carup-text-3">{timing}</p><p className="mt-2 text-xs leading-5 text-carup-text-2">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-carup-text-3"><Upload className="h-3.5 w-3.5" aria-hidden="true" />Disclosure on every cut: “Editorial film · AI-generated, not a shipment record”.</p>
        </div>
      </section>
    </div>
  )
}
