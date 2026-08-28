import { ArrowRight, FileSearch, Gauge, History, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ListingImage } from '@/components/marketplace/ListingImage'

export function MarketplaceDecisionStory({
  image,
  alt,
  href,
}: {
  image?: string | null
  alt: string
  href: string
}) {
  return (
    <section
      className="group relative grid min-h-[250px] overflow-hidden border-y border-orange-100 bg-[#fff7ed] md:grid-cols-[0.86fr_1.14fr]"
      data-testid="marketplace-decision-story"
      aria-labelledby="marketplace-decision-story-title"
    >
      <div className="relative z-10 flex flex-col justify-center px-6 py-8 sm:px-8">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">CarUp decision layer</p>
        <h3 id="marketplace-decision-story-title" className="mt-3 max-w-md text-3xl font-black leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-4xl">
          Know before you decide.
        </h3>
        <p className="mt-4 max-w-lg text-sm leading-6 text-slate-600">
          Open the Vehicle Passport to see the public evidence CarUp can show, the observations that were actually recorded,
          and the gaps that remain unknown. Missing information stays missing.
        </p>
        <Link
          to={href}
          className="mt-6 inline-flex w-fit items-center gap-2 border-b border-slate-950 pb-1 text-sm font-black text-slate-950 transition hover:border-orange-600 hover:text-orange-700"
        >
          Open this vehicle <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <div className="relative min-h-[240px] overflow-hidden sm:min-h-[280px]">
        <ListingImage
          src={image}
          alt={alt}
          className="absolute inset-0 h-full w-full"
          imgClassName="object-cover object-center transition duration-700 ease-out motion-safe:group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#fff7ed] via-[#fff7ed]/55 to-transparent" />

        <div className="absolute right-5 top-1/2 w-[58%] max-w-[250px] -translate-y-1/2 bg-white/95 p-4 shadow-[0_22px_55px_rgba(15,23,42,0.16)] backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-orange-600">
            <ShieldCheck className="h-4 w-4" /> Vehicle Passport
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2">
              <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <div>
                <p className="text-xs font-black text-slate-900">Evidence timeline</p>
                <p className="text-[10px] text-slate-500">Only public-safe evidence that exists.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <div>
                <p className="text-xs font-black text-slate-900">Mileage observations</p>
                <p className="text-[10px] text-slate-500">Recorded values stay distinct from unknowns.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <div>
                <p className="text-xs font-black text-slate-900">Lifecycle context</p>
                <p className="text-[10px] text-slate-500">Known events can remain partial.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
