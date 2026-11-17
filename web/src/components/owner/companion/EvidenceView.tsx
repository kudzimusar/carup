/**
 * RX04-C2 — Evidence, unified presentation.
 *
 * Leads with the cars: each one is an evidence workspace attached to one VIN, with the one
 * evidence figure this page reads (its count of VERIFIED documents) and two doors — add evidence
 * (the Passport's existing `?upload=1` upload sheet) and open the Passport, where every document's
 * own review status lives.
 *
 * Provenance rules kept here:
 *  - only a governed review (admin/government reviewer on the server) makes evidence "verified"; uploaded and pending items are never counted
 *    or styled as verified;
 *  - a listing photo is labelled as a listing photo — it is not evidence;
 *  - a count that was not read says so in words (never 0), and a failed read is never "no evidence".
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Car, ChevronDown, FileCheck2, FileClock, FileX2, Upload } from 'lucide-react'
import type { Vehicle } from '@/types'
import { DataState } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { StatusChip, VehiclePhoto, VehicleThumb } from './CompanionParts'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { passportHref, passportUploadHref, plural, vehicleName } from './companionFormat'

function verifiedChip(count: number | null | undefined) {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return <StatusChip tone="unknown">Verified count not recorded</StatusChip>
  }
  if (count === 0) return <StatusChip tone="neutral">No verified documents yet</StatusChip>
  return <StatusChip tone="success"><FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> {plural(count, 'verified document')}</StatusChip>
}

function EvidenceCar({ vehicle }: { vehicle: Vehicle }) {
  const name = vehicleName(vehicle)
  const headingId = `evidence-car-${vehicle.vin}`
  const hasPhoto = Boolean(primaryListingImageUrl(vehicle.listing_media))
  return (
    <article
      aria-labelledby={headingId}
      className="grid overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line sm:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]"
      data-testid={`evidence-vehicle-${vehicle.vin}`}
    >
      <div className="relative hidden bg-carup-bg-surface sm:block">
        <VehiclePhoto media={vehicle.listing_media} alt={`${name} listing photo`} className="h-full min-h-[10rem] w-full" />
        {hasPhoto && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-carup-bg-raised px-2.5 py-0.5 text-[11px] font-medium text-carup-text-2 ring-1 ring-carup-line">
            Listing photo · not evidence
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <VehicleThumb media={vehicle.listing_media} alt={`${name} listing photo`} className="w-24 sm:hidden" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Vehicle Passport</p>
            <h2 id={headingId} className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em] text-carup-text">{name}</h2>
            <p className="break-all font-mono text-[12px] text-carup-text-3">VIN {vehicle.vin}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid={`evidence-verified-${vehicle.vin}`}>
          {verifiedChip(vehicle.counts?.verified_documents)}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Link to={passportUploadHref(vehicle.vin)} className={OWNER_PRIMARY_ACTION} data-testid={`evidence-add-${vehicle.vin}`}>
            <Upload className="h-4 w-4" aria-hidden="true" /> Add evidence
          </Link>
          <Link to={passportHref(vehicle.vin)} className={OWNER_SECONDARY_ACTION}>
            Open Passport <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}

/** "Which car is this for?" — evidence always belongs to one VIN, so adding starts by choosing it. */
function AddEvidenceChooser({ vehicles, open, onToggle }: { vehicles: Vehicle[]; open: boolean; onToggle: () => void }) {
  if (vehicles.length === 1) {
    return (
      <Link to={passportUploadHref(vehicles[0].vin)} className={OWNER_PRIMARY_ACTION} data-testid="evidence-add-primary">
        <Upload className="h-4 w-4" aria-hidden="true" /> Add evidence
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="evidence-car-chooser"
      className={OWNER_PRIMARY_ACTION}
      data-testid="evidence-add-primary"
    >
      <Upload className="h-4 w-4" aria-hidden="true" /> Add evidence
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  )
}

export function EvidenceView({ vehicles, state, onRetry }: { vehicles: Vehicle[]; state: 'loading' | 'ready' | 'error'; onRetry: () => void }) {
  const [chooserOpen, setChooserOpen] = useState(false)
  const count = vehicles.length
  const counts = vehicles.map(v => v.counts?.verified_documents)
  const allRead = counts.every(c => typeof c === 'number' && Number.isFinite(c))
  const verifiedTotal = allRead ? counts.reduce<number>((a, c) => a + (c as number), 0) : null

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6" data-testid="owner-evidence-vault" data-presentation="rx04">
      <OwnerPageHeader
        title="Evidence"
        description="The documents and photographs behind each car’s Vehicle Passport. Add evidence to the car it belongs to — it counts as verified only after it has been reviewed."
        meta={state === 'ready' && count > 0
          ? `${plural(count, 'car')} · ${verifiedTotal === null ? 'verified count not recorded for every car' : plural(verifiedTotal, 'verified document')}`
          : undefined}
        actions={state === 'ready' && count > 0 ? (
          <AddEvidenceChooser vehicles={vehicles} open={chooserOpen} onToggle={() => setChooserOpen(o => !o)} />
        ) : (
          <Link to="/dashboard/garage" className={OWNER_SECONDARY_ACTION}>Open my garage <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        )}
      />

      {state === 'ready' && count > 1 && chooserOpen && (
        <nav id="evidence-car-chooser" aria-label="Choose the car this evidence is for" className="rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5" data-testid="evidence-car-chooser">
          <p className="text-[15px] font-semibold text-carup-text">Which car is this evidence for?</p>
          <p className="mt-0.5 text-[13px] text-carup-text-2">It is attached to that car&rsquo;s VIN and opens the upload in its Passport.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {vehicles.map(v => (
              <li key={v.vin}>
                <Link to={passportUploadHref(v.vin)} className={`group flex min-h-14 items-center gap-3 rounded-control bg-carup-bg-surface px-3 py-2 hover:bg-carup-action-soft ${OWNER_FOCUS}`}>
                  <Car className="h-4 w-4 shrink-0 text-carup-action-hover" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-carup-text">{vehicleName(v)}</span>
                    <span className="block break-all font-mono text-[11px] text-carup-text-3">VIN {v.vin}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-carup-text-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {state === 'loading' && <DataState state="loading" subject="Evidence workspaces" />}

      {state === 'error' && (
        <DataState
          state="error"
          subject="Evidence"
          description="Your evidence workspaces could not be read. CarUp has not converted that failure into zero documents."
          action={{ label: 'Try again', onClick: onRetry }}
        />
      )}

      {state === 'ready' && count === 0 && (
        <section className="rounded-card bg-carup-raw-ink px-6 py-10 text-white sm:px-10" data-testid="evidence-empty">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Evidence</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">No car to attach evidence to yet</h2>
          <p className="mt-2 max-w-lg text-[15px] leading-6 text-white/75">Evidence always belongs to one car&rsquo;s Vehicle Passport. Add or identify a car first, then add its documents and photographs.</p>
          <Link to="/sell" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Add or find a car <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      )}

      {state === 'ready' && count > 0 && (
        <>
          <section aria-labelledby="evidence-how-title" className="rounded-card bg-carup-raw-ink p-5 text-white sm:p-6" data-testid="evidence-how">
            <h2 id="evidence-how-title" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">How evidence counts</h2>
            <ol className="mt-4 grid gap-4 sm:grid-cols-3">
              <li className="flex gap-3">
                <Upload className="mt-0.5 h-5 w-5 shrink-0 text-white/70" aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold">You add it</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-white/70">A document or photograph, attached to one car&rsquo;s VIN. Uploaded is not verified.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <FileClock className="mt-0.5 h-5 w-5 shrink-0 text-white/70" aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold">It waits for review</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-white/70">Each car’s Passport lists every document with its review status. Pending items are not counted as verified here.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <FileX2 className="mt-0.5 h-5 w-5 shrink-0 text-white/70" aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold">Verified or rejected</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-white/70">Only a review marks it verified — uploading never does. Listing photos are separate and are never evidence.</p>
                </div>
              </li>
            </ol>
          </section>

          <section aria-label="Your cars" className="space-y-4">
            {vehicles.map(vehicle => <EvidenceCar key={vehicle.vin} vehicle={vehicle} />)}
          </section>
        </>
      )}
    </div>
  )
}
