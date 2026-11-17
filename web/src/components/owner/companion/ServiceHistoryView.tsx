/**
 * RX04-C2 — Service history, unified presentation.
 *
 * A chronological history per car: every garage work order the page read, grouped under the car's
 * identity (year make model + VIN), newest first, with the date, status and cost exactly as
 * recorded. Presentation only — the container keeps its reads and filter state.
 *
 * Truth rules kept here:
 *  - a failed read is an error, never "no service history";
 *  - no next-service date, interval or recommendation is shown (none is recorded);
 *  - costs carry no currency (work orders do not record one) and are never summed across records,
 *    because a total of amounts in unknown currencies is not a fact;
 *  - provenance is the source table's: a garage work order. Nothing here says "verified".
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Search, Wrench, X } from 'lucide-react'
import type { ServiceRecord, Vehicle } from '@/types'
import { DataState, MoneyDisplay } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { CompanionNote, CompanionVehicleHeading, PassportLink, StatusChip } from './CompanionParts'
import { plural, recordedAmount, recordedDate, serviceText, vehicleName, workOrderStatus, type CompanionRead } from './companionFormat'

type Group = { vin: string | null; vehicle: Vehicle | null; records: ServiceRecord[]; latest: number }

const ALL = '__all__'

function TimelineEntry({ record, last }: { record: ServiceRecord; last: boolean }) {
  const date = recordedDate(record.created_at)
  const status = workOrderStatus(record.status)
  const text = serviceText(record)
  const amount = recordedAmount(record.total_cost)
  const mileage = recordedAmount(record.mileage)
  const parts = Array.isArray(record.parts) ? (record.parts as Array<{ id?: string; name?: string }>).filter(p => p && p.name) : []
  const dateNode = date
    ? <time dateTime={date.iso} title={date.iso}>{date.label}</time>
    : <span className="italic">Date not recorded</span>
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:grid-cols-[6.75rem_auto_minmax(0,1fr)]" data-testid={`service-entry-${record.id}`}>
      <p className="hidden pt-0.5 text-right text-[13px] font-medium tabular-nums text-carup-text-2 sm:block">{dateNode}</p>
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${status.tone === 'success' ? 'bg-carup-action' : 'bg-carup-line-strong'}`} />
        {!last && <span className="mt-1 w-px flex-1 bg-carup-line" />}
      </div>
      <div className={`min-w-0 ${last ? '' : 'pb-6'}`}>
        <p className="text-[12px] font-medium tabular-nums text-carup-text-3 sm:hidden">{dateNode}</p>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-[15px] font-semibold leading-6 text-carup-text">
            {text || <span className="font-medium italic text-carup-text-3">Work description not recorded</span>}
          </h3>
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-carup-text-2">
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-carup-text-3">Cost</span>
            <MoneyDisplay amount={amount} currency={null} ariaLabel={amount === null ? 'Cost not recorded' : undefined} />
          </span>
          {mileage !== null && <span><span className="text-carup-text-3">Odometer</span> <span className="tabular-nums">{mileage.toLocaleString()} km</span></span>}
          <span className="inline-flex items-center gap-1.5 text-carup-text-3">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" /> Garage work order
          </span>
        </div>
        {parts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-carup-text-3">Parts</span>
            {parts.map((p, i) => (
              <span key={p.id ?? i} className="rounded-full bg-carup-bg-surface px-2.5 py-0.5 text-[12px] text-carup-text-2">{p.name}</span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function VehicleHistory({ group }: { group: Group }) {
  const headingId = `service-car-${group.vin ?? 'unknown'}`
  const completed = group.records.filter(r => workOrderStatus(r.status).label === 'Completed').length
  const latest = recordedDate(group.records[0]?.created_at)
  return (
    <section aria-labelledby={headingId} className="rounded-card bg-carup-bg-raised ring-1 ring-carup-line" data-testid={`service-vehicle-${group.vin ?? 'unknown'}`}>
      <div className="border-b border-carup-line p-4 sm:p-5">
        <CompanionVehicleHeading
          name={group.vehicle ? vehicleName(group.vehicle) : 'Car details could not be read'}
          vin={group.vin}
          media={group.vehicle ? group.vehicle.listing_media : undefined}
          eyebrow={plural(group.records.length, 'record')}
          headingId={headingId}
          action={group.vin ? <PassportLink vin={group.vin} /> : undefined}
        />
        <p className="mt-3 text-[13px] text-carup-text-2">
          {completed} of {group.records.length} completed{latest ? <> · latest recorded <time dateTime={latest.iso}>{latest.label}</time></> : ''}
        </p>
      </div>
      <ol className="p-4 sm:p-5" aria-label={`Service timeline, newest first`}>
        {group.records.map((r, i) => <TimelineEntry key={r.id ?? i} record={r} last={i === group.records.length - 1} />)}
      </ol>
    </section>
  )
}

export function ServiceHistoryView({
  vehiclesRead,
  servicesRead,
  search,
  onSearchChange,
  onRetry,
}: {
  vehiclesRead: CompanionRead<Vehicle[]>
  servicesRead: CompanionRead<ServiceRecord[]>
  search: string
  onSearchChange: (value: string) => void
  onRetry: () => void
}) {
  const [focusVin, setFocusVin] = useState<string>(ALL)
  const vehicles = useMemo(() => (vehiclesRead.state === 'ready' ? vehiclesRead.rows : []), [vehiclesRead])
  const services = useMemo(() => (servicesRead.state === 'ready' ? servicesRead.rows : []), [servicesRead])
  const query = search.trim().toLowerCase()

  const groups = useMemo(() => {
    const byVin = new Map<string, ServiceRecord[]>()
    for (const s of services) {
      if (query && !serviceText(s).toLowerCase().includes(query)) continue
      const key = s.vin ?? ''
      byVin.set(key, [...(byVin.get(key) ?? []), s])
    }
    const out: Group[] = []
    for (const [vin, records] of byVin) {
      const sorted = [...records].sort((a, b) => (recordedDate(b.created_at)?.time ?? -Infinity) - (recordedDate(a.created_at)?.time ?? -Infinity))
      out.push({ vin: vin || null, vehicle: vehicles.find(v => v.vin === vin) ?? null, records: sorted, latest: recordedDate(sorted[0]?.created_at)?.time ?? -Infinity })
    }
    return out.sort((a, b) => b.latest - a.latest)
  }, [services, vehicles, query])

  const shown = focusVin === ALL ? groups : groups.filter(g => (g.vin ?? '') === focusVin)
  const carsWithout = vehicles.filter(v => !services.some(s => s.vin === v.vin))
  const loading = vehiclesRead.state === 'loading' || servicesRead.state === 'loading'
  const ready = servicesRead.state === 'ready' && vehiclesRead.state !== 'loading'
  const carsWithRecords = new Set(services.map(s => s.vin ?? '')).size

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6" data-testid="service-history-unified" data-presentation="rx04">
      <OwnerPageHeader
        title="Service history"
        description="Work recorded on your cars by garages on CarUp — newest first, grouped by car, with dates, status and cost exactly as recorded."
        meta={ready && (services.length > 0 || vehicles.length > 0)
          ? (services.length === 0 ? 'No work orders recorded yet' : `${plural(services.length, 'record')} across ${plural(carsWithRecords, 'car')}`)
          : undefined}
        actions={(
          <>
            {(vehicles.length > 0 || vehiclesRead.state !== 'ready') && (
              <Link to="/dashboard/partsentry" className={OWNER_SECONDARY_ACTION}><Plus className="h-4 w-4" aria-hidden="true" /> Log a repair</Link>
            )}
            <Link to="/marketplace/services" className={OWNER_PRIMARY_ACTION}>Find a garage <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </>
        )}
      />

      {loading && <DataState state="loading" subject="Service history" />}

      {!loading && servicesRead.state === 'error' && (
        <div data-testid="service-history-error">
          <DataState
            state="error"
            subject="Service history"
            description="Your service history could not be read just now. This is not the same as having no service history — nothing is shown because nothing was read."
            action={{ label: 'Try again', onClick: onRetry }}
          />
        </div>
      )}

      {ready && vehiclesRead.state === 'error' && (
        <p role="status" className="rounded-card bg-status-warning-soft px-4 py-3 text-[14px] text-carup-text" data-testid="service-history-vehicles-unread">
          Your garage could not be read, so records below are shown by VIN without the car&rsquo;s details.{' '}
          <button type="button" onClick={onRetry} className={`font-semibold text-carup-action-hover underline-offset-2 hover:underline ${OWNER_FOCUS}`}>Try again</button>
        </p>
      )}

      {ready && services.length === 0 && vehiclesRead.state === 'ready' && vehicles.length === 0 && (
        <section className="rounded-card bg-carup-raw-ink px-6 py-10 text-white sm:px-10" data-testid="service-history-empty">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Service history</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">No cars in your garage yet</h2>
          <p className="mt-2 max-w-lg text-[15px] leading-6 text-white/75">Service history is kept per car. Add a car you own, and work that a garage records against it on CarUp appears here.</p>
          <Link to="/sell" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Add a car <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      )}

      {ready && services.length === 0 && !(vehiclesRead.state === 'ready' && vehicles.length === 0) && (
        <section className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6" data-testid="service-history-empty">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">No service recorded yet</h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-6 text-carup-text-2">
            When a garage on CarUp records work on one of your cars, it appears here with its date, status and cost. Repairs you record yourself go on the car&rsquo;s PartSentry ledger.
          </p>
        </section>
      )}

      {ready && services.length > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search work descriptions</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Search work descriptions"
                className={`min-h-11 w-full rounded-full bg-carup-bg-raised pl-10 pr-4 text-[14px] text-carup-text ring-1 ring-carup-line placeholder:text-carup-text-3 ${OWNER_FOCUS}`}
                data-testid="service-history-search"
              />
            </label>
            {groups.length > 1 || focusVin !== ALL ? (
              <label className="block sm:w-[20rem]">
                <span className="sr-only">Show service history for</span>
                <select
                  value={focusVin}
                  onChange={e => setFocusVin(e.target.value)}
                  className={`min-h-11 w-full truncate rounded-full bg-carup-bg-raised px-4 text-[14px] font-medium text-carup-text ring-1 ring-carup-line ${OWNER_FOCUS}`}
                  data-testid="service-history-car-filter"
                >
                  <option value={ALL}>All cars</option>
                  {groups.map(g => (
                    <option key={g.vin ?? 'unknown'} value={g.vin ?? ''}>
                      {g.vehicle ? vehicleName(g.vehicle) : 'Car details not read'} · {g.vin ?? 'no VIN'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line" role="status" data-testid="service-history-no-match">
              <p className="text-[15px] font-semibold text-carup-text">No records match &ldquo;{search.trim()}&rdquo;</p>
              <p className="mt-1 text-[14px] text-carup-text-2">Search looks at the work description each garage recorded.</p>
              <button type="button" onClick={() => { onSearchChange(''); setFocusVin(ALL) }} className={`${OWNER_SECONDARY_ACTION} mt-3`}>
                <X className="h-4 w-4" aria-hidden="true" /> Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {shown.map(g => <VehicleHistory key={g.vin ?? 'unknown'} group={g} />)}
            </div>
          )}
        </>
      )}

      {ready && vehiclesRead.state === 'ready' && carsWithout.length > 0 && focusVin === ALL && !query && (
        <section aria-labelledby="service-cars-without" data-testid="service-history-cars-without">
          <h2 id="service-cars-without" className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-carup-text">
            {services.length === 0 ? 'Your cars' : 'No service recorded yet'}
          </h2>
          <ul className="divide-y divide-carup-line overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
            {carsWithout.map(v => (
              <li key={v.vin} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-carup-text">{vehicleName(v)}</p>
                  <p className="break-all font-mono text-[12px] text-carup-text-3">VIN {v.vin}</p>
                </div>
                <span className="flex items-center gap-3">
                  <span className="text-[13px] text-carup-text-3">No work orders on CarUp</span>
                  <PassportLink vin={v.vin} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready && services.length > 0 && (
        <CompanionNote>
          Each entry is a garage work order recorded on CarUp, shown as the garage recorded it. CarUp does not add service intervals or reminders here.
        </CompanionNote>
      )}
    </div>
  )
}
