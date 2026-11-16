/**
 * RX03-P2-R4 — My CarUp, vehicle-first (unified presentation only; flags OFF keep the legacy
 * Owner Dashboard composition byte-for-byte).
 *
 * Same data, same truth rules as OwnerDashboard — this file only re-composes what the container
 * already read: the owner's vehicles lead, then what needs doing, then the places an owner goes
 * (garage, saved cars, service, insurance, PartSentry, Gutu AI). Money and Trust facts that have
 * no authoritative source keep their honest "Not available / Not calculated" wording in one
 * compact standing card instead of four empty tiles, and the session-scoped market intelligence
 * moves below the owner's own objects. Every data-testid the truthfulness tests read is kept.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bookmark, Car, FileText, Gauge, ImageOff, MessageSquare, Shield, Wrench } from 'lucide-react'
import MarketplacePulse from '@/components/intelligence/MarketplacePulse'
import NextBestActions from '@/components/intelligence/NextBestActions'
import PeriodicReport from '@/components/intelligence/PeriodicReport'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'
import type { Vehicle } from '@/types'
import { readOwnerTrustClaim, statedMileage } from './ownerStatedValues'

export interface MyCarUpHomeProps {
  userName?: string | null
  vehicles: Vehicle[]
  vehiclesState: 'loading' | 'ready' | 'unavailable'
  escrow: { status: 'loading' | 'ready' | 'error'; usd: number; count: number }
  notificationsState: 'loading' | 'ready' | 'unavailable'
  recentNotifications: Array<{ id: string; read?: boolean; title?: string; message?: string; priority?: string | null }>
  attentionItems: Array<{ key: string; label: string; detail: string; to: string; cta: string }>
  lowBandwidth: boolean
  onToggleLowBandwidth: () => void
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'

const DESTINATIONS: Array<{ label: string; detail: string; href: string; icon: typeof Car }> = [
  { label: 'My garage', detail: 'Every vehicle and its Passport', href: '/dashboard/garage', icon: Car },
  { label: 'Saved cars', detail: 'Cars you are considering', href: '/dashboard/saved', icon: Bookmark },
  { label: 'Service history', detail: 'Work recorded on your cars', href: '/dashboard/service-history', icon: Wrench },
  { label: 'Insurance', detail: 'Policies and records', href: '/dashboard/insurance', icon: Shield },
  { label: 'PartSentry', detail: 'Parts provenance', href: '/dashboard/partsentry', icon: FileText },
  { label: 'Gutu AI', detail: 'Ask about your cars', href: '/dashboard/ai', icon: MessageSquare },
]

function Section({ title, action, children, testId }: { title: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="min-w-0" data-testid={testId} aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function VehicleCard({ vehicle, hideMedia }: { vehicle: Vehicle; hideMedia: boolean }) {
  const trust = readOwnerTrustClaim(vehicle)
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  return (
    <Link
      to={`/dashboard/garage/${vehicle.vin}`}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-carup-bg-raised ring-1 ring-carup-line transition hover:ring-carup-text-3 ${FOCUS}`}
      data-testid="mycarup-vehicle-card"
    >
      {hideMedia ? (
        <div className="flex aspect-[16/9] items-center justify-center bg-carup-bg-surface text-xs text-carup-text-3">
          <ImageOff className="mr-2 h-4 w-4" aria-hidden="true" /> Photos hidden (low-bandwidth)
        </div>
      ) : (
        <OwnerListingMedia media={vehicle.listing_media} alt={name} className="aspect-[16/9] w-full overflow-hidden bg-carup-bg-surface" />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-carup-text">{name}</h3>
          <p className="mt-0.5 truncate font-mono text-[12px] text-carup-text-3">VIN {vehicle.vin}</p>
        </div>
        <p className="flex items-center gap-1.5 text-[13px] text-carup-text-2">
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" /> {statedMileage(vehicle.mileage)}
        </p>
        <div className="mt-auto border-t border-carup-line pt-2.5 text-[13px]" data-testid={`trust-claim-${vehicle.vin}`}>
          {trust.score !== null ? (
            <span className="text-carup-text-2">
              CarUp Trust <b className="text-carup-text" data-testid={`trust-claim-score-${vehicle.vin}`}>{trust.score} / 100</b> · {trust.headline}
            </span>
          ) : (
            <span className="text-carup-text-3" data-testid={`trust-claim-state-${vehicle.vin}`}>CarUp Trust: {trust.headline}</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-carup-action-hover">
          Open Passport <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

export function MyCarUpHome({
  userName,
  vehicles,
  vehiclesState,
  escrow,
  notificationsState,
  recentNotifications,
  attentionItems,
  lowBandwidth,
  onToggleLowBandwidth,
}: MyCarUpHomeProps) {
  const unread = recentNotifications.filter(n => !n.read).length
  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-8" data-testid="mycarup-home">
      {/* Who and what: one greeting, one primary route into the garage, Gutu one tap away. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">My CarUp</p>
          <h1 className="mt-1 text-[clamp(1.5rem,2.4vw,1.9rem)] font-bold tracking-[-0.02em] text-carup-text">
            Welcome back{userName ? `, ${userName}` : ''}!
          </h1>
          <p className="mt-1 max-w-xl text-sm text-carup-text-2">Your vehicles, their Passports and what needs doing next.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard/ai"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 ${FOCUS}`}
            data-testid="mycarup-gutu"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" /> Ask Gutu AI
          </Link>
          <Link
            to="/dashboard/garage"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover ${FOCUS}`}
            data-testid="mycarup-primary-action"
          >
            <Car className="h-4 w-4" aria-hidden="true" /> Open my garage
          </Link>
        </div>
      </header>

      {attentionItems.length > 0 && (
        <section
          className="rounded-2xl bg-carup-raw-ink p-4 text-carup-raw-paper sm:p-5"
          data-testid="owner-needs-attention"
          aria-label="Needs your attention"
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--carup-raw-paper)_70%,transparent)]">Needs your attention</h2>
          <ul className="mt-3 divide-y divide-[color-mix(in_srgb,var(--carup-raw-paper)_14%,transparent)]">
            {attentionItems.map(item => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{item.label}</p>
                  <p className="mt-0.5 text-[13px] text-[color-mix(in_srgb,var(--carup-raw-paper)_72%,transparent)]">{item.detail}</p>
                </div>
                <Link
                  to={item.to}
                  className={`inline-flex min-h-11 items-center rounded-full bg-carup-raw-paper px-4 text-sm font-semibold text-carup-raw-ink ${FOCUS}`}
                >
                  {item.cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section
        title="Your vehicles"
        testId="mycarup-vehicles"
        action={
          <div className="flex items-center gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-carup-text-2">
              <input type="checkbox" checked={lowBandwidth} onChange={onToggleLowBandwidth} className="h-4 w-4 accent-[var(--carup-action)]" />
              Hide photos
            </label>
            <Link to="/dashboard/garage" className={`inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-carup-action-hover ${FOCUS}`}>
              View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        }
      >
        {vehiclesState === 'loading' && (
          <p className="rounded-2xl bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line" role="status">Loading your garage…</p>
        )}
        {vehiclesState === 'unavailable' && (
          <p className="rounded-2xl bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line" role="alert" data-testid="mycarup-vehicles-unavailable">
            Your garage could not be loaded. This is a loading failure, not an empty garage.
          </p>
        )}
        {vehiclesState === 'ready' && vehicles.length === 0 && (
          <div className="rounded-2xl bg-carup-bg-raised p-6 ring-1 ring-carup-line" data-testid="mycarup-vehicles-empty">
            <p className="text-[15px] font-semibold text-carup-text">No vehicles in your garage yet</p>
            <p className="mt-1 text-sm text-carup-text-2">Add a vehicle to start building its Passport.</p>
            <Link to="/dashboard/sell-vehicle" className={`mt-4 inline-flex min-h-11 items-center rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on ${FOCUS}`}>
              Add vehicle
            </Link>
          </div>
        )}
        {vehiclesState === 'ready' && vehicles.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {vehicles.slice(0, 3).map(vehicle => <VehicleCard key={vehicle.vin} vehicle={vehicle} hideMedia={lowBandwidth} />)}
          </div>
        )}
      </Section>

      <Section title="Go to" testId="mycarup-destinations">
        <nav aria-label="My CarUp destinations">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {DESTINATIONS.map(d => (
              <li key={d.href} className="min-w-0">
                <Link
                  to={d.href}
                  className={`flex h-full min-h-[4.5rem] flex-col justify-between gap-2 rounded-xl bg-carup-bg-raised p-3 ring-1 ring-carup-line transition hover:ring-carup-text-3 ${FOCUS}`}
                >
                  <d.icon className="h-4 w-4 text-carup-action-hover" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-carup-text">{d.label}</span>
                    <span className="block truncate text-[12px] text-carup-text-3">{d.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Account standing" testId="mycarup-standing">
          <dl className="divide-y divide-carup-line rounded-2xl bg-carup-bg-raised ring-1 ring-carup-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Automotive Wallet (USD)</dt>
              <dd className="text-right">
                <p data-testid="wallet-usd-value" className="text-sm font-semibold text-carup-text-2">Not available</p>
                <p className="text-[12px] text-carup-text-3">No wallet established for this account</p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Automotive Wallet (ZiG)</dt>
              <dd className="text-right">
                <p data-testid="wallet-zig-value" className="text-sm font-semibold text-carup-text-2">Not available</p>
                <p className="text-[12px] text-carup-text-3">No wallet established for this account</p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Locked SafePay Escrows</dt>
              <dd className="text-right">
                {escrow.status === 'loading' && <p data-testid="escrow-usd-value" className="text-sm font-semibold text-carup-text-2">Loading…</p>}
                {escrow.status === 'error' && <p data-testid="escrow-usd-value" className="text-sm font-semibold text-carup-text-2">Not available</p>}
                {escrow.status === 'ready' && <p data-testid="escrow-usd-value" className="text-base font-bold text-carup-text">${escrow.usd.toLocaleString()}</p>}
                <p className="text-[12px] text-carup-text-3">
                  {escrow.status === 'ready'
                    ? `${escrow.count} active purchase escrow${escrow.count !== 1 ? 's' : ''}`
                    : escrow.status === 'error' ? 'Could not load your escrows' : 'Checking your escrows'}
                </p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Account Trust Index</dt>
              <dd className="text-right">
                <p data-testid="trust-index-value" className="text-sm font-semibold text-carup-text-2">Not calculated</p>
                <p data-testid="trust-index-label" className="text-[12px] text-carup-text-3">Verification pending</p>
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          title="Notifications"
          testId="mycarup-notifications"
          action={notificationsState === 'ready' ? <span className="rounded-full bg-carup-bg-surface px-2.5 py-1 text-[12px] font-semibold text-carup-text-2">{unread} new</span> : undefined}
        >
          <div className="space-y-2 rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line">
            {notificationsState === 'loading' ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-not-read">
                Your notifications have not been read yet. No count is shown, because none has been counted.
              </p>
            ) : notificationsState === 'unavailable' ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-unavailable">
                CarUp could not read your notifications. This is NOT “you have no notifications” — nothing below has been counted.
              </p>
            ) : recentNotifications.length === 0 ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-none">No notifications yet.</p>
            ) : recentNotifications.map(n => (
              <div key={n.id} className={`rounded-xl p-3 text-sm ${n.read ? 'bg-carup-bg-surface' : 'bg-[color-mix(in_srgb,var(--carup-action)_10%,transparent)]'}`}>
                <p className="font-semibold text-carup-text">{n.title}</p>
                <p className="mt-0.5 text-carup-text-2">{n.message}</p>
              </div>
            ))}
            <Link to="/dashboard/communications" className={`inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-carup-action-hover ${FOCUS}`}>
              Open communications <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Section>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Document vault" testId="mycarup-documents">
          <div className="rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line" data-testid="document-vault-list">
            <p data-testid="document-vault-empty" className="text-sm text-carup-text-2">No documents uploaded yet.</p>
            <p data-testid="document-vault-unavailable" className="mt-1 text-[12px] text-carup-text-3">Document upload is not available from this dashboard yet.</p>
          </div>
        </Section>
        {!lowBandwidth && (
          <Section title="Vehicle value trend" testId="mycarup-value">
            <div className="rounded-2xl bg-carup-bg-raised p-4 ring-1 ring-carup-line">
              <p data-testid="value-trend-unavailable" className="text-sm text-carup-text-2">Valuation history is not available for your account yet.</p>
            </div>
          </Section>
        )}
      </div>

      {/* Session-scoped market intelligence follows the owner's own objects. */}
      <Section title="Market insights" testId="mycarup-insights">
        <div className="min-w-0 space-y-6">
          <MarketplacePulse />
          <NextBestActions />
          <PeriodicReport period="monthly" />
        </div>
      </Section>
    </div>
  )
}
