/**
 * RX03 Addendum 05 — Vehicle Story: one REAL published car, read the way CarUp reads it.
 * Recorded facts on one side, what CarUp has not confirmed on the other, then the next actions.
 * Everything comes from the public listing summary; a gap is stated, never filled.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, CircleDashed, FileCheck2 } from 'lucide-react'
import type { ShowroomListingCardModel } from '@/components/showroom/ShowroomListingCard'
import { ShowroomListingImage } from '@/components/showroom/ShowroomListingImage'
import { PHOTO_SIZES } from '@/lib/mediaDelivery'
import { openQuestions, recordedFacts } from '@/lib/vehicleStory'

export function VehicleStory({ vehicle }: { vehicle: ShowroomListingCardModel | null }) {
  if (!vehicle) return null
  const href = `/marketplace/${encodeURIComponent(vehicle.vin)}`
  const gaps = openQuestions(vehicle)
  return (
    <article className="min-w-0 overflow-hidden rounded-[1.75rem] bg-white text-[#09122A] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]" data-testid="home-vehicle-story">
      <div className="relative aspect-[16/10] bg-[#EEECE7]">
        <ShowroomListingImage
          src={vehicle.primaryImage}
          alt={vehicle.name}
          bodyStyle={vehicle.bodyStyle ?? null}
          sizes={PHOTO_SIZES.card}
          loading="lazy"
          plate="stacked"
          className="h-full w-full"
        />
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-[#09122A] shadow-sm">Live listing{vehicle.syntheticDemo ? ' · Demo media' : ''}</span>
      </div>
      <div className="p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">Vehicle Story</p>
        <h3 className="mt-1 text-xl font-bold tracking-[-0.02em]">{vehicle.name}</h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><FileCheck2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> What is on record</p>
            <dl className="mt-2 space-y-1.5 text-[14px]" data-testid="vehicle-story-recorded">
              {recordedFacts(vehicle).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-slate-100 pb-1.5">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="min-w-0 truncate text-right font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><CircleDashed className="h-4 w-4 text-amber-700" aria-hidden="true" /> Not confirmed yet</p>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-5 text-slate-700" data-testid="vehicle-story-gaps">
              {gaps.length > 0 ? gaps.map(gap => <li key={gap}>{gap}</li>) : <li>No open questions in the public summary — the Passport has the detail.</li>}
            </ul>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={href} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#09122A] px-5 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2" data-testid="vehicle-story-open">
            Open the Vehicle Passport <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to={`${href}#vd-trust`} className="inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-[#09122A] ring-1 ring-slate-300 hover:bg-[#F6F4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">
            See what CarUp checked
          </Link>
        </div>
      </div>
    </article>
  )
}
