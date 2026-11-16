/**
 * RX03 Addendum 05 — International sourcing (Import / Trade) as a primary proposition.
 *
 * What is real today (audit A3): `/diaspora` is a public explainer; a signed-in buyer can create an
 * import order, upload documents and request shipment; later stages need CarUp reviewers and no money
 * moves in this flow. The film is editorial (AI-generated) and is labelled as not a shipment record.
 * Deeper Trade OS journeys are RX-06; this section only opens what exists.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { CinematicFilm } from '@/content/media/homeFilm'
import { EditorialFilm } from '@/components/showroom/EditorialFilm'

const STAGES = [
  { title: 'Ask for the car you want', copy: 'Describe the vehicle, budget and where it should arrive. One import order holds the request.' },
  { title: 'Documents and shipment on one order', copy: 'Papers, shipment milestones and payment references stay together — reviewed by CarUp, never paid outside it.' },
  { title: 'It arrives with its record', copy: 'The order hands its documents to the vehicle’s CarUp record, so the next buyer can read where it came from.' },
]

export function SourcingJourney({ film }: { film: CinematicFilm | null }) {
  return (
    <section className="relative isolate overflow-hidden bg-[#09122A] text-white" data-testid="home-import-journey" aria-labelledby="import-title">
      <EditorialFilm
        film={film}
        label="the sourcing film"
        testId="sourcing-film"
        controlsAt="top"
        className="h-[52vh] min-h-[320px] w-full sm:h-[62vh] lg:h-[70vh]"
        fallback={<div className="h-24 w-full" />}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[52vh] min-h-[320px] bg-[linear-gradient(180deg,rgba(9,18,42,0.15)_0%,rgba(9,18,42,0.35)_55%,#09122A_100%)] sm:h-[62vh] lg:h-[70vh]" aria-hidden="true" />
      <div className="section-padding relative mx-auto -mt-40 max-w-[1440px] pb-16 sm:-mt-48 sm:pb-24">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">Import · International sourcing</p>
        <h2 id="import-title" className="mt-3 max-w-2xl text-[clamp(2rem,4.6vw,4rem)] font-bold leading-[0.98] tracking-[-0.04em]">
          Source abroad. Arrive with the record.
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-white/80">
          Import a vehicle with its request, documents and shipment kept on one order — and its history carried into CarUp when it lands.
        </p>
        <ol className="mt-10 grid gap-6 border-t border-white/15 pt-8 md:grid-cols-3 md:gap-10">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="relative">
              <span className="text-[13px] font-semibold tabular-nums text-[#FE7D18]">0{index + 1}</span>
              <p className="mt-1 text-lg font-semibold tracking-[-0.01em]">{stage.title}</p>
              <p className="mt-1.5 max-w-sm text-[14px] leading-6 text-white/70">{stage.copy}</p>
            </li>
          ))}
        </ol>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link to="/diaspora/imports/new" className="inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-6 text-sm font-semibold text-[#09122A] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]" data-testid="import-start">
            Start an import request <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to="/diaspora" className="inline-flex h-12 items-center rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]" data-testid="import-how">
            How importing works
          </Link>
          <span className="text-[12px] text-white/55">Sign-in needed to start an order. No payment is taken in this flow.</span>
        </div>
      </div>
    </section>
  )
}
