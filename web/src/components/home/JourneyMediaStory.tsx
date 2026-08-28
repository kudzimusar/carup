import {
  BadgeDollarSign,
  Camera,
  CarFront,
  CheckCircle2,
  FileSearch,
  GitCompare,
  Globe2,
  Gauge,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { ListingImage } from '@/components/marketplace/ListingImage'

export type JourneyScene =
  | 'buy'
  | 'sell'
  | 'verify'
  | 'diaspora'
  | 'finance'
  | 'protect'
  | 'maintain'
  | 'parts'

function Signal({
  icon: Icon,
  eyebrow,
  label,
  className = '',
}: {
  icon: typeof CarFront
  eyebrow: string
  label: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 border border-white/70 bg-white/95 px-3 py-2 text-slate-950 shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur-sm ${className}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-orange-50 text-orange-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{eyebrow}</span>
        <span className="block truncate text-[11px] font-black text-slate-900">{label}</span>
      </span>
    </div>
  )
}

function VehicleBackdrop({
  src,
  alt,
  objectPosition = 'center',
}: {
  src?: string | null
  alt: string
  objectPosition?: string
}) {
  return (
    <ListingImage
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full"
      imgClassName={`object-cover transition duration-700 ease-out motion-safe:group-hover:scale-[1.035] [object-position:${objectPosition}]`}
    />
  )
}

function AbstractCar({ className = '' }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <div className="absolute h-28 w-44 rounded-[50%] bg-orange-200/60 blur-2xl" />
      <CarFront className="relative h-28 w-28 stroke-[1.2] text-slate-800 transition duration-500 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:scale-105" />
    </div>
  )
}

export function JourneyMediaStory({
  scene,
  image,
  alt,
}: {
  scene: JourneyScene
  image?: string | null
  alt: string
}) {
  const shell = 'relative min-h-[220px] overflow-hidden bg-[radial-gradient(circle_at_75%_25%,rgba(249,115,22,0.16),transparent_32%),linear-gradient(145deg,#f8fafc,#eef2f7)] sm:min-h-[250px]'

  if (scene === 'buy') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="buy">
        <VehicleBackdrop src={image} alt={alt} objectPosition="center 58%" />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950/18 to-transparent" />
        <svg className="absolute left-[7%] top-[22%] h-28 w-36 overflow-visible text-orange-500/65" viewBox="0 0 150 110" aria-hidden="true">
          <path d="M4 92 C36 92, 32 42, 70 44 S108 70, 142 18" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 6" />
          <circle cx="142" cy="18" r="4" fill="currentColor" />
        </svg>
        <Signal icon={GitCompare} eyebrow="Shortlist" label="Compare up to 4" className="absolute left-4 top-4 max-w-[155px]" />
        <Signal icon={FileSearch} eyebrow="Vehicle Passport" label="Open what is known" className="absolute bottom-4 right-4 max-w-[180px]" />
      </div>
    )
  }

  if (scene === 'sell') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="sell">
        <VehicleBackdrop src={image} alt={alt} objectPosition="center 58%" />
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-white/8 to-white/38" />
        <div className="absolute bottom-4 left-4 flex gap-1.5">
          {[0, 1, 2].map(index => (
            <div key={index} className="h-12 w-16 overflow-hidden border-2 border-white bg-white shadow-sm">
              <ListingImage
                src={image}
                alt=""
                className="h-full w-full"
                imgClassName={index === 0 ? 'object-cover object-left' : index === 1 ? 'object-cover object-center' : 'object-cover object-right'}
              />
            </div>
          ))}
        </div>
        <Signal icon={Camera} eyebrow="Smart capture" label="Build the photo story" className="absolute right-4 top-4 max-w-[175px]" />
        <Signal icon={Sparkles} eyebrow="Guest first" label="Draft before sign-in" className="absolute bottom-4 right-4 max-w-[175px]" />
      </div>
    )
  }

  if (scene === 'verify') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="verify">
        {image ? <VehicleBackdrop src={image} alt={alt} objectPosition="center 60%" /> : <AbstractCar className="absolute inset-0" />}
        <div className="absolute inset-0 bg-gradient-to-r from-[#f8fafc]/95 via-[#f8fafc]/68 to-transparent" />
        <div className="absolute left-4 top-4 w-[58%] max-w-[230px] bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-orange-600">
            <ShieldCheck className="h-4 w-4" /> Vehicle Passport
          </div>
          <div className="mt-4 space-y-3 text-[11px] font-bold text-slate-700">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-orange-500" /> See public evidence</div>
            <div className="flex items-center gap-2"><Gauge className="h-3.5 w-3.5 text-orange-500" /> See mileage observations</div>
            <div className="flex items-center gap-2"><FileSearch className="h-3.5 w-3.5 text-orange-500" /> See what remains unknown</div>
          </div>
        </div>
        <Signal icon={Lock} eyebrow="Privacy" label="Protected IDs stay gated" className="absolute bottom-4 right-4 max-w-[185px]" />
      </div>
    )
  }

  if (scene === 'diaspora') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="diaspora">
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_center,rgba(15,23,42,0.08)_1px,transparent_1px)] [background-size:18px_18px]" />
        <Globe2 className="absolute right-5 top-5 h-28 w-28 stroke-[1.1] text-slate-300 transition duration-700 motion-safe:group-hover:rotate-6" />
        <svg className="absolute inset-x-4 top-14 h-28 w-[calc(100%-2rem)] overflow-visible text-orange-500" viewBox="0 0 300 100" aria-hidden="true">
          <path d="M18 70 C80 14, 160 95, 278 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 7" />
          <circle cx="18" cy="70" r="5" fill="currentColor" />
          <circle cx="278" cy="26" r="5" fill="currentColor" />
        </svg>
        <div className="absolute left-5 top-5 bg-[#08111f] px-4 py-3 text-white shadow-xl">
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-orange-300">Source</p>
          <p className="mt-1 text-xs font-black">Vehicle + documents</p>
        </div>
        <Signal icon={Globe2} eyebrow="Journey" label="Keep import context attached" className="absolute bottom-4 right-4 max-w-[200px]" />
      </div>
    )
  }

  if (scene === 'finance') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="finance">
        {image ? <VehicleBackdrop src={image} alt={alt} objectPosition="center 60%" /> : <AbstractCar className="absolute inset-y-0 left-0 w-1/2" />}
        <div className="absolute inset-0 bg-gradient-to-r from-white/30 via-white/70 to-white" />
        <div className="absolute right-4 top-5 w-[55%] max-w-[220px] space-y-2">
          <Signal icon={CarFront} eyebrow="Step 1" label="Choose the vehicle" />
          <div className="ml-5 h-5 border-l-2 border-dashed border-orange-300" />
          <Signal icon={BadgeDollarSign} eyebrow="Step 2" label="Explore real finance routes" />
        </div>
        <p className="absolute bottom-4 right-4 max-w-[210px] text-right text-[10px] font-semibold leading-4 text-slate-500">No invented approval, lender or terms.</p>
      </div>
    )
  }

  if (scene === 'protect') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="protect">
        {image ? <VehicleBackdrop src={image} alt={alt} objectPosition="center 62%" /> : <AbstractCar className="absolute inset-0" />}
        <div className="absolute inset-0 bg-white/45" />
        <div className="absolute right-6 top-1/2 flex h-28 w-28 -translate-y-1/2 items-center justify-center border-2 border-orange-300 bg-orange-50/90 text-orange-600 shadow-xl transition duration-500 motion-safe:group-hover:scale-105">
          <ShieldCheck className="h-14 w-14 stroke-[1.3]" />
        </div>
        <Signal icon={ShieldCheck} eyebrow="Protection" label="Connect options to the car" className="absolute bottom-4 left-4 max-w-[190px]" />
      </div>
    )
  }

  if (scene === 'maintain') {
    return (
      <div className={shell} data-testid="home-journey-media" data-scene="maintain">
        <AbstractCar className="absolute inset-y-0 right-0 w-[55%]" />
        <div className="absolute left-5 top-5 bottom-5 w-[44%] border-l border-slate-300 pl-5">
          {[
            ['Service context', Wrench],
            ['Mileage event', Gauge],
            ['Lifecycle record', FileSearch],
          ].map(([label, Icon], index) => (
            <div key={String(label)} className={`relative flex items-center gap-2 text-[11px] font-bold text-slate-700 ${index > 0 ? 'mt-7' : ''}`}>
              <span className="absolute -left-[25px] h-2.5 w-2.5 bg-orange-500 ring-4 ring-orange-100" />
              <Icon className="h-4 w-4 text-orange-600" />
              {label}
            </div>
          ))}
        </div>
        <Signal icon={Wrench} eyebrow="Garages" label="Keep service connected" className="absolute bottom-4 right-4 max-w-[180px]" />
      </div>
    )
  }

  return (
    <div className={shell} data-testid="home-journey-media" data-scene="parts">
      <div className="absolute left-6 top-8 h-32 w-32 rounded-full border-[14px] border-slate-800 shadow-[inset_0_0_0_5px_#cbd5e1] transition duration-500 motion-safe:group-hover:rotate-6">
        <div className="absolute inset-[34%] rounded-full bg-slate-500" />
      </div>
      <div className="absolute right-5 top-5 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
        <Package className="h-8 w-8 text-orange-600" />
        <p className="mt-3 text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">Fitment</p>
        <p className="mt-1 max-w-[130px] text-xs font-black text-slate-900">Match the part to the vehicle</p>
      </div>
      <Signal icon={ShieldCheck} eyebrow="PartSentry" label="Keep verification context" className="absolute bottom-4 right-4 max-w-[185px]" />
    </div>
  )
}
