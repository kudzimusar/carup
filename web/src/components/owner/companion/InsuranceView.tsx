/**
 * RX04-C2 — Insurance, unified presentation (presentation only: no insurance authority is added).
 *
 * One section per car: the governed count of ACTIVE policies the garage read carries, and any
 * policy rows the read included, exactly as recorded. Nothing is computed from dates — no expiry
 * warning, renewal prompt or cover advice is shown, and there is no dead "Add policy" control: the
 * capability is not offered here and the page says so.
 *
 * Truth rules kept here:
 *  - `insurance_records` absent from the read is NOT "no policies" — it is "not part of this view";
 *  - an empty array is "no policy records";
 *  - a premium shows its recorded currency or "Currency not recorded", and no period is implied;
 *  - a missing date reads "Not recorded", never "Invalid Date".
 */
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import type { InsuranceRecord, Vehicle } from '@/types'
import { DataState, MoneyDisplay } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { CompanionNote, CompanionVehicleHeading, PassportLink, StatusChip, VehicleThumb } from './CompanionParts'
import { passportHref, plural, policyStatus, recordedAmount, recordedDate, vehicleName } from './companionFormat'

function activeChip(count: number | null | undefined) {
  if (typeof count !== 'number' || !Number.isFinite(count)) return <StatusChip tone="unknown">Active policies not recorded</StatusChip>
  if (count === 0) return <StatusChip tone="neutral">No active policy recorded</StatusChip>
  return <StatusChip tone="success"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {plural(count, 'active policy', 'active policies')}</StatusChip>
}

function DateValue({ value }: { value: unknown }) {
  const d = recordedDate(value)
  return d ? <time dateTime={d.iso}>{d.label}</time> : <span className="italic text-carup-text-3">Not recorded</span>
}

function PolicyCard({ record }: { record: InsuranceRecord }) {
  const status = policyStatus(record.status)
  const provider = record.provider || record.insurer || ''
  const policyNumber = record.policy_number || record.policyNumber || ''
  const coverage = Array.isArray(record.coverage) ? record.coverage.filter(Boolean) : []
  return (
    <article className="rounded-control bg-carup-bg-surface p-4" data-testid={`insurance-policy-${record.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-carup-text">{provider || <span className="italic text-carup-text-3">Insurer not recorded</span>}</p>
          <p className="break-all font-mono text-[12px] text-carup-text-3">Policy {policyNumber || 'number not recorded'}</p>
        </div>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
        <div className="min-w-0">
          <dt className="text-carup-text-3">Type</dt>
          <dd className="text-carup-text">{record.type || <span className="italic text-carup-text-3">Not recorded</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-carup-text-3">Premium</dt>
          <dd><MoneyDisplay amount={recordedAmount(record.premium)} currency={record.currency ?? null} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-carup-text-3">Starts</dt>
          <dd className="text-carup-text"><DateValue value={record.start_date ?? record.startDate} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-carup-text-3">Ends</dt>
          <dd className="text-carup-text"><DateValue value={record.expiry_date ?? record.expiryDate} /></dd>
        </div>
      </dl>
      {coverage.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-carup-line pt-3">
          <span className="sr-only">Coverage:</span>
          {coverage.map(c => <span key={c} className="rounded-full bg-carup-bg-raised px-2.5 py-0.5 text-[12px] text-carup-text-2 ring-1 ring-carup-line">{c}</span>)}
        </div>
      )}
    </article>
  )
}

function InsuranceCar({ vehicle }: { vehicle: Vehicle }) {
  const headingId = `insurance-car-${vehicle.vin}`
  const records = vehicle.insurance_records
  return (
    <section aria-labelledby={headingId} className="rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5" data-testid={`insurance-vehicle-${vehicle.vin}`}>
      <CompanionVehicleHeading
        name={vehicleName(vehicle)}
        vin={vehicle.vin}
        media={vehicle.listing_media}
        headingId={headingId}
        action={<PassportLink vin={vehicle.vin} />}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">{activeChip(vehicle.counts?.active_insurance)}</div>
      <div className="mt-4">
        {!Array.isArray(records) ? (
          <p className="text-[13px] leading-5 text-carup-text-2" data-testid={`insurance-records-not-in-view-${vehicle.vin}`}>
            Policy details are not part of this view. Insurance events CarUp holds for this car are listed in its Passport.
          </p>
        ) : records.length === 0 ? (
          <p className="text-[13px] text-carup-text-2">No policy records for this car.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {records.map(r => <PolicyCard key={r.id} record={r} />)}
          </div>
        )}
      </div>
    </section>
  )
}

export function InsuranceView({ vehicles, state, onRetry }: { vehicles: Vehicle[]; state: 'loading' | 'ready' | 'error'; onRetry: () => void }) {
  const count = vehicles.length
  const actives = vehicles.map(v => v.counts?.active_insurance)
  const allRead = actives.every(c => typeof c === 'number' && Number.isFinite(c))
  const activeTotal = allRead ? actives.reduce<number>((a, c) => a + (c as number), 0) : null
  // When the read carries no policy rows for any car, one statement says so — not one per car.
  const anyRecords = vehicles.some(v => Array.isArray(v.insurance_records))
  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6" data-testid="insurance-unified" data-presentation="rx04">
      <OwnerPageHeader
        title="Insurance"
        description="The insurance policy records CarUp holds for each of your cars, shown exactly as recorded."
        meta={state === 'ready' && count > 0
          ? `${plural(count, 'car')} · ${activeTotal === null ? 'active policies not recorded for every car' : plural(activeTotal, 'active policy', 'active policies')}`
          : undefined}
        actions={<Link to="/dashboard/garage" className={OWNER_SECONDARY_ACTION}>Open my garage <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
      />

      {state === 'loading' && <DataState state="loading" subject="Insurance records" />}
      {state === 'error' && (
        <DataState
          state="error"
          subject="Insurance records"
          description="Your cars could not be read, so their insurance records are not shown. This is not the same as having no insurance on record."
          action={{ label: 'Try again', onClick: onRetry }}
        />
      )}

      {state === 'ready' && count === 0 && (
        <section className="rounded-card bg-carup-raw-ink px-6 py-10 text-white sm:px-10" data-testid="insurance-empty">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Insurance</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">No cars in your garage yet</h2>
          <p className="mt-2 max-w-lg text-[15px] leading-6 text-white/75">Insurance records are kept per car, with its Vehicle Passport. Add a car you own to start one.</p>
          <Link to="/sell" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Add a car <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      )}

      {state === 'ready' && count > 0 && (
        <>
          {anyRecords ? (
            <div className="space-y-4">
              {vehicles.map(v => <InsuranceCar key={v.vin} vehicle={v} />)}
            </div>
          ) : (
            <section aria-labelledby="insurance-cars-title" data-testid="insurance-cars">
              <h2 id="insurance-cars-title" className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">Your cars</h2>
              <p className="mb-3 mt-1 max-w-2xl text-[14px] leading-6 text-carup-text-2" data-testid="insurance-records-not-in-view">
                Policy details are not part of this view. Each car&rsquo;s Passport lists the insurance events CarUp holds for it.
              </p>
              <ul className="divide-y divide-carup-line overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
                {vehicles.map(v => (
                  <li key={v.vin} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5" data-testid={`insurance-vehicle-${v.vin}`}>
                    <VehicleThumb media={v.listing_media} alt={vehicleName(v)} className="w-16" />
                    <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-carup-text">{vehicleName(v)}</p>
                        <p className="break-all font-mono text-[12px] text-carup-text-3">VIN {v.vin}</p>
                      </div>
                      <div className="mt-1.5 sm:mt-0">{activeChip(v.counts?.active_insurance)}</div>
                    </div>
                    <Link
                      to={passportHref(v.vin)}
                      aria-label={`Open the Passport for ${vehicleName(v)}`}
                      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold text-carup-action-hover hover:text-carup-text sm:px-1 ${OWNER_FOCUS}`}
                    >
                      <span className="hidden sm:inline">Open Passport</span> <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <CompanionNote>
            Policies are shown as they were recorded. Adding, renewing or buying a policy is not offered on this page.
          </CompanionNote>
        </>
      )}
    </div>
  )
}
