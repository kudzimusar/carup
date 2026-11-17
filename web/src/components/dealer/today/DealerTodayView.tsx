import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ArrowUpRight, Car, CheckCircle2, Clock, FileCheck2, ImagePlus, Loader2, MapPin, MessageSquare,
  Minus, Navigation, Pencil, Plus, RefreshCw, ShieldCheck, Store, TrendingDown, TrendingUp, Users, CreditCard,
  type LucideIcon,
} from 'lucide-react'
import { DealerProfileAvatar } from '@/components/dealer/profile/DealerProfileMedia'
import { cn } from '@/lib/utils'
import { AREA_LABELS, TONE_LABELS, type AreaCheck, type QueueArea, type QueueItem, type QueueTone } from './dealerActionQueue'

/**
 * RX05-B — Dealer Today: an action-first command centre built around one question, "What needs this
 * dealership's attention today?". Presentation only: every value is passed in from the reads the
 * Dealer dashboard container already makes (server-verified workspace, tenant-scoped inventory,
 * enquiries, owner media, staff, performance). Rendered only inside the unified Dealer OS workspace.
 */

export interface TodayMetric { value: number | null; scope?: string; status?: string; last_30_days?: number | null; previous_30_days?: number | null }
export interface TodayBranch { id: string; name: string | null; address: string | null; hasGps: boolean; hours: string | null; sourceLabel: string | null; sourceStatus: string | null }
export interface TodayImage { url: string; alt: string; pending: boolean }

const AREA_ICONS: Record<QueueArea, LucideIcon> = {
  compliance: ShieldCheck, enquiries: MessageSquare, inventory: Car, media: ImagePlus, branches: MapPin, staff: Users,
}
const TONE_TEXT: Record<QueueTone, string> = {
  urgent: 'text-status-danger', action: 'text-carup-action', unknown: 'text-status-neutral', waiting: 'text-status-info', suggestion: 'text-carup-text-2',
}
const TONE_SOFT: Record<QueueTone, string> = {
  urgent: 'bg-status-danger-soft', action: 'bg-carup-action-soft', unknown: 'bg-status-neutral-soft', waiting: 'bg-status-info-soft', suggestion: 'bg-carup-bg-surface-2',
}
const TONE_BAR: Record<QueueTone, string> = {
  urgent: 'var(--carup-danger)', action: 'var(--carup-color-action)', unknown: 'var(--carup-neutral)', waiting: 'var(--carup-info)', suggestion: 'var(--carup-color-line-strong)',
}
const AREA_STATE: Record<AreaCheck['state'], { text: string; dot: string }> = {
  clear: { text: 'Clear', dot: 'var(--carup-success)' },
  attention: { text: 'Needs you', dot: 'var(--carup-color-action)' },
  waiting: { text: 'Waiting', dot: 'var(--carup-info)' },
  unavailable: { text: 'Not checked', dot: 'var(--carup-neutral)' },
  loading: { text: 'Checking…', dot: 'var(--carup-color-line-strong)' },
}
const MEASURED: Array<[string, string]> = [
  ['published_vehicles', 'Published vehicles'], ['recorded_vehicles', 'Recorded vehicles'],
  ['buyer_enquiries', 'Buyer enquiries'], ['qualified_enquiries', 'Qualified enquiries'], ['vehicle_saves', 'Vehicle saves'],
]
const DEFERRED = 'DEFERRED_NEW_PRODUCT_CAPABILITY_REQUIRED'
const QUIET_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-carup-line-strong bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
const PRIMARY_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
const PANEL = 'rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5'

function humanize(key: string | null | undefined): string {
  if (!key) return 'Not recorded'
  const s = key.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function DealerTodayView(props: {
  displayName: string
  legalName: string | null
  registrationNumber?: string | null
  chips: Array<{ label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }>
  cover: TodayImage | null
  avatar: TodayImage | null
  publicHref: string | null
  queue: { items: QueueItem[]; areas: AreaCheck[] }
  onRefresh: () => void
  busy: boolean
  performance: { status: 'loading' | 'ready' | 'unavailable'; generatedAt: string | null; metrics: Partial<Record<string, TodayMetric>> }
  formatDateTime: (iso: string | null) => string
  branches: TodayBranch[]
  onEditBranch: (id: string) => void
  onAddBranch: () => void
  branchEditor: ReactNode
  notice: string
  error: string
  compliance: Array<[string, string]>
  claims: Array<{ key: string; title: string; kind: string; status: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; detail: string }>
  carryover: ReactNode
}) {
  const { queue } = props
  const pendingImage = props.cover?.pending || props.avatar?.pending
  const checking = queue.areas.some(a => a.state === 'loading')
  const blind = queue.areas.filter(a => a.state === 'unavailable')
  const actionable = queue.items.filter(i => i.tone !== 'suggestion')
  const suggestions = queue.items.filter(i => i.tone === 'suggestion')
  const primaryId = queue.items.find(i => i.cta || i.addBranch || i.editBranchId)?.id

  return (
    <div className="space-y-6" data-testid="real-dealer-dashboard" data-presentation="dealer-today">
      {/* ── Identity: one row, the dealership's own images only (private previews say so) ── */}
      <header className="relative isolate overflow-hidden rounded-card bg-carup-raw-ink text-carup-raw-paper" data-testid="dealer-today-identity">
        {props.cover && (
          <img src={props.cover.url} alt={props.cover.alt} className="absolute inset-0 -z-20 h-full w-full object-cover" />
        )}
        <div aria-hidden="true" className="absolute inset-0 -z-10"
          style={{ background: props.cover
            ? 'linear-gradient(90deg, var(--carup-raw-ink) 0%, color-mix(in srgb, var(--carup-raw-ink) 82%, transparent) 55%, color-mix(in srgb, var(--carup-raw-ink) 35%, transparent) 100%)'
            : 'radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--carup-raw-orange-signal) 22%, transparent) 0%, transparent 55%), linear-gradient(135deg, var(--carup-raw-ink) 0%, var(--carup-raw-navy) 100%)' }} />
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
          <DealerProfileAvatar className="h-16 w-16 rounded-control shadow-none ring-0 sm:h-20 sm:w-20" src={props.avatar?.url} alt={props.avatar?.alt} name={props.displayName} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-carup-raw-orange-signal">Dealer OS · Today</p>
            <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-3xl" data-testid="dealer-today-name">{props.displayName}</h1>
            <p className="mt-1 text-sm text-white/75 [overflow-wrap:anywhere]">
              Registered legal entity: <span data-testid="dealer-canonical-registered-legal-name">{props.legalName || 'Not recorded'}</span>
              {props.registrationNumber && <> · Reg. {props.registrationNumber}</>}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Dealership status">
              {props.chips.map(chip => (
                <li key={chip.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: chip.tone === 'good' ? 'var(--carup-success)' : chip.tone === 'bad' ? 'var(--carup-danger)' : chip.tone === 'warn' ? 'var(--carup-warning)' : 'var(--carup-raw-paper)' }} />
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
            {props.publicHref && (
              <Link to={props.publicHref} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-white px-4 text-sm font-semibold text-carup-raw-ink hover:bg-carup-raw-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                Public profile<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <button type="button" onClick={props.onRefresh} disabled={props.busy}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:opacity-60">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh
            </button>
          </div>
        </div>
        {pendingImage && (
          <p className="flex items-center gap-1.5 border-t border-white/10 px-4 py-2 text-xs text-white/80 sm:px-6" data-testid="dealer-today-image-pending">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Your {props.cover?.pending && props.avatar?.pending ? 'cover and profile images are' : props.cover?.pending ? 'cover image is' : 'profile image is'} awaiting independent review — only you can see {props.cover?.pending && props.avatar?.pending ? 'them' : 'it'}.
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
        {/* ── The Dealer Action Queue ── */}
        <section aria-labelledby="dealer-today-queue-heading" className="min-w-0" data-testid="dealer-action-queue">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 id="dealer-today-queue-heading" className="text-xl font-bold tracking-tight text-carup-text">What needs attention today</h2>
              <p className="mt-0.5 text-sm text-carup-text-2">
                {checking ? 'Checking live CarUp records…'
                  : actionable.length ? `${actionable.length} ${actionable.length === 1 ? 'item' : 'items'} from live CarUp records · most urgent first`
                  : 'From live CarUp records'}
              </p>
            </div>
          </div>

          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Areas checked" data-testid="dealer-action-areas">
            {queue.areas.map(area => {
              const Icon = AREA_ICONS[area.area]
              const s = AREA_STATE[area.state]
              return (
                <li key={area.area} data-state={area.state} className="inline-flex items-center gap-1.5 rounded-full border border-carup-line bg-carup-bg-raised px-2.5 py-1 text-xs text-carup-text-2">
                  <Icon className="h-3.5 w-3.5 text-carup-text-3" aria-hidden="true" />
                  <span className="font-medium text-carup-text">{area.label}</span>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
                  <span>{area.state === 'attention' && area.count ? `${area.count}` : s.text}</span>
                </li>
              )
            })}
          </ul>

          {checking && actionable.length === 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-card border border-carup-line bg-carup-bg-raised p-4 text-sm text-carup-text-2" role="status">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Checking enquiries, inventory, images and staff…
            </div>
          )}

          {actionable.length > 0 && (
            <ol className="mt-4 space-y-3" aria-label="Action queue">
              {actionable.map(item => <QueueRow key={item.id} item={item} primary={item.id === primaryId} onEditBranch={props.onEditBranch} onAddBranch={props.onAddBranch} />)}
            </ol>
          )}

          {!checking && actionable.length === 0 && (
            <div className="mt-4 rounded-card border border-dashed border-carup-line-strong bg-carup-bg-raised p-6 text-center" data-testid="dealer-action-queue-empty">
              <CheckCircle2 className="mx-auto h-8 w-8 text-status-success" aria-hidden="true" />
              <h3 className="mt-2 text-base font-semibold text-carup-text">Nothing needs your attention right now</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-carup-text-2">
                Checked: {queue.areas.filter(a => a.state !== 'unavailable').map(a => a.label.toLowerCase()).join(', ')}.
                {blind.length > 0 && ` Not checked: ${blind.map(a => a.label.toLowerCase()).join(', ')}.`}
              </p>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-carup-text">When you have a moment</h3>
              <ol className="mt-2 space-y-2" aria-label="Suggestions">
                {suggestions.map(item => <QueueRow key={item.id} item={item} compact primary={false} onEditBranch={props.onEditBranch} onAddBranch={props.onAddBranch} />)}
              </ol>
            </div>
          )}
        </section>

            <section aria-labelledby="dealer-today-branches-heading" className={PANEL} data-testid="dealer-today-branches">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 id="dealer-today-branches-heading" className="text-lg font-bold tracking-tight text-carup-text">Branches</h2>
                  <p className="mt-0.5 text-xs text-carup-text-3">Recorded company branches: <strong className="text-carup-text">{props.branches.length}</strong></p>
                </div>
                <button type="button" onClick={props.onAddBranch} disabled={props.busy} className={cn(QUIET_BUTTON, 'min-h-9 px-3')}>
                  <Plus className="h-4 w-4" aria-hidden="true" />Add
                </button>
              </div>
              {props.notice && <p role="status" className="mt-3 rounded-control bg-status-success-soft p-3 text-sm text-status-success">{props.notice}</p>}
              {props.error && <p role="alert" className="mt-3 rounded-control bg-status-danger-soft p-3 text-sm text-status-danger">{props.error}</p>}
              {props.branches.length === 0
                ? <p className="mt-3 text-sm text-carup-text-2">No branches are recorded for this active company.</p>
                : (
                  <ul className="mt-3 grid gap-3 md:grid-cols-2">
                    {props.branches.map(b => (
                      <li key={b.id} className="min-w-0 rounded-control border border-carup-line p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 font-semibold leading-snug text-carup-text [overflow-wrap:anywhere]">{b.name || 'Unnamed branch'}</p>
                          <button type="button" onClick={() => props.onEditBranch(b.id)} aria-label={'Edit ' + (b.name || 'unnamed branch')}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-control px-2 text-sm font-semibold text-carup-text-2 hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit
                          </button>
                        </div>
                        {(b.sourceLabel || b.sourceStatus) && (
                          <p className="mt-0.5 text-xs text-carup-text-3">{[b.sourceLabel, b.sourceStatus].filter(Boolean).join(' · ')}</p>
                        )}
                        <ul className="mt-2 space-y-1 text-sm text-carup-text-2">
                          <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{b.address || 'No address recorded'}</span></li>
                          <li className="flex gap-2"><Navigation className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" /><span>{b.hasGps ? 'GPS declared · not verified' : 'No GPS declared'}</span></li>
                          <li className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">Declared hours: {b.hours || 'Not recorded'}</span></li>
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              {props.branchEditor}
            </section>
        </div>

        {/* ── Context: pulse, legal standing, tools ── */}
        <aside className="min-w-0 space-y-4" aria-label="Dealership at a glance">
          <section aria-labelledby="dealer-today-pulse-heading" className={PANEL} data-testid="dealer-today-pulse">
            <h2 id="dealer-today-pulse-heading" className="text-base font-semibold text-carup-text">Dealership pulse</h2>
            <p className="mt-0.5 text-xs text-carup-text-3">
              {props.performance.status === 'ready' && props.performance.generatedAt ? `Exact counts · updated ${props.formatDateTime(props.performance.generatedAt)}` : 'Exact counts from CarUp records'}
            </p>
            {props.performance.status === 'loading' && <div className="mt-3 h-24 animate-pulse rounded-control bg-carup-bg-surface motion-reduce:animate-none" aria-hidden="true" />}
            {props.performance.status === 'unavailable' && (
              <p role="status" className="mt-3 text-sm text-carup-text-2">Performance figures are not available right now. Nothing is estimated in their place.</p>
            )}
            {props.performance.status === 'ready' && <Pulse metrics={props.performance.metrics} />}
          </section>


          <section aria-labelledby="dealer-today-legal-heading" className={PANEL} data-testid="dealer-today-legal">
            <h2 id="dealer-today-legal-heading" className="text-base font-semibold text-carup-text">Legal standing &amp; claims</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {props.compliance.map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-xs text-carup-text-3">{k}</dt><dd className="font-medium text-carup-text [overflow-wrap:anywhere]">{v}</dd></div>
              ))}
            </dl>
            <ul className="mt-4 space-y-2">
              {props.claims.map(c => (
                <li key={c.key} className="rounded-control border border-carup-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 font-semibold text-carup-text [overflow-wrap:anywhere]">{c.title}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold',
                      c.tone === 'good' ? 'bg-status-success-soft text-status-success' : c.tone === 'bad' ? 'bg-status-danger-soft text-status-danger'
                        : c.tone === 'warn' ? 'bg-status-warning-soft text-status-warning' : 'bg-status-neutral-soft text-status-neutral')}>{c.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-carup-text-3">{c.kind}</p>
                  <p className="mt-1 text-sm text-carup-text-2">{c.detail}</p>
                </li>
              ))}
            </ul>
            {props.carryover}
          </section>

          <nav aria-label="Dealership tools" className={PANEL}>
            <h2 className="text-base font-semibold text-carup-text">Workspace</h2>
            <ul className="mt-2 divide-y divide-carup-line">
              {([
                ['Inventory', '/dealers/stock', Car], ['Buyer enquiries', '/dealers/inquiries', MessageSquare],
                ['Staff & access', '/dealers/staff', Users], ['Operating details & images', '/dealers/operating-details', Store],
                ['Billing readiness', '/dealers/billing', CreditCard], ['Claim & private evidence history', '/dealers/claims', FileCheck2],
              ] as Array<[string, string, LucideIcon]>).map(([label, href, Icon]) => (
                <li key={href}>
                  <Link to={href} className="flex min-h-11 items-center gap-3 py-2 text-sm font-medium text-carup-text hover:text-carup-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                    <Icon className="h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{label}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-5 text-carup-text-3">Invoices, settlement, sales and complaints are never fabricated here.</p>
          </nav>
        </aside>
      </div>
    </div>
  )
}

function QueueRow({ item, primary, compact = false, onEditBranch, onAddBranch }: {
  item: QueueItem; primary: boolean; compact?: boolean; onEditBranch: (id: string) => void; onAddBranch: () => void
}) {
  const Icon = AREA_ICONS[item.area]
  const buttonClass = cn(primary ? PRIMARY_BUTTON : QUIET_BUTTON, 'w-full shrink-0 sm:w-auto')
  return (
    <li data-testid={`dealer-action-${item.id}`} data-tone={item.tone} className="relative overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: TONE_BAR[item.tone] }} />
      <div className={cn('flex flex-col gap-3 pl-5 sm:flex-row sm:items-center', compact ? 'p-3' : 'p-4')}>
        {!compact && (
          <span className={cn('hidden h-10 w-10 shrink-0 items-center justify-center rounded-control sm:flex', TONE_SOFT[item.tone], TONE_TEXT[item.tone])} aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs font-semibold">
            <span className={TONE_TEXT[item.tone]}>{TONE_LABELS[item.tone]}</span>
            <span className="text-carup-text-3">· {AREA_LABELS[item.area]}</span>
          </p>
          <h3 className={cn('mt-0.5 font-semibold leading-snug text-carup-text [overflow-wrap:anywhere]', compact && 'text-sm')}>{item.title}</h3>
          <p className={cn('mt-1 text-carup-text-2', compact ? 'text-xs leading-5' : 'text-sm leading-6')}>{item.detail}</p>
        </div>
        {item.cta && <Link to={item.cta.href} className={buttonClass}>{item.cta.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
        {!item.cta && item.editBranchId && <button type="button" className={buttonClass} onClick={() => onEditBranch(item.editBranchId!)}>Edit branch<Pencil className="h-4 w-4" aria-hidden="true" /></button>}
        {!item.cta && item.addBranch && <button type="button" className={buttonClass} onClick={onAddBranch}>Add a branch<Plus className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
    </li>
  )
}

function Pulse({ metrics }: { metrics: Partial<Record<string, TodayMetric>> }) {
  const measured = MEASURED.filter(([key]) => metrics[key] && metrics[key]?.status !== DEFERRED)
  const deferred = Object.entries(metrics).filter(([, m]) => m?.status === DEFERRED)
  return (
    <>
      <dl className="mt-3 divide-y divide-carup-line">
        {measured.map(([key, label]) => {
          const m = metrics[key]!
          const value = typeof m.value === 'number' && Number.isFinite(m.value) ? m.value.toLocaleString('en-US') : 'Not available'
          const last = m.last_30_days
          const prev = m.previous_30_days
          const trend = typeof last === 'number' && typeof prev === 'number' ? last - prev : null
          return (
            <div key={key} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-carup-text-2">{label}</dt>
                <dd className="text-lg font-bold tabular-nums text-carup-text">{value}</dd>
              </div>
              {trend !== null && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-carup-text-3">
                  {trend > 0 ? <TrendingUp className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> : trend < 0 ? <TrendingDown className="h-3.5 w-3.5 text-status-danger" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                  {last} in the last 30 days · {prev} in the 30 before
                </p>
              )}
              {m.scope && <p className="mt-0.5 text-xs leading-5 text-carup-text-3">{m.scope}</p>}
            </div>
          )
        })}
      </dl>
      {deferred.length > 0 && (
        <p className="mt-3 rounded-control bg-carup-bg-surface p-2.5 text-xs leading-5 text-carup-text-2" data-testid="dealer-today-not-measured">
          <span className="font-semibold text-carup-text">Not measured yet:</span> {deferred.map(([k]) => humanize(k)).join(', ')}. Nothing is estimated in their place.
        </p>
      )}
    </>
  )
}
