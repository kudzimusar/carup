import { AspectRatio, Badge, MoneyDisplay } from '@carup/design-system'
import { Camera, Car, Images, Truck } from 'lucide-react'
import type { ReactNode } from 'react'

// No network in previews: vehicle photos are token-coloured placeholder panels.
const navyPanel = {
  background: 'linear-gradient(135deg, var(--carup-raw-navy) 0%, var(--carup-raw-ink-2) 100%)',
}

const PhotoPanel = ({ icon, title, caption }: { icon: ReactNode; title: string; caption?: string }) => (
  <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg text-white" style={navyPanel}>
    <span className="text-carup-raw-orange-signal">{icon}</span>
    <span className="text-sm font-semibold">{title}</span>
    {caption && <span className="text-xs" style={{ opacity: 0.7 }}>{caption}</span>}
  </div>
)

export const ListingPhoto = () => (
  <div style={{ width: 480 }}>
    <AspectRatio ratio={16 / 9}>
      <PhotoPanel icon={<Truck className="size-10" />} title="Toyota Hilux 2.8 GD-6 Raider" caption="Photo 1 of 12 · 16:9" />
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
        <Images className="size-3" /> 12
      </span>
    </AspectRatio>
  </div>
)

const Ratio = ({ ratio, label }: { ratio: number; label: string }) => (
  <div className="space-y-1.5" style={{ width: 180 }}>
    <AspectRatio ratio={ratio}>
      <div className="flex size-full items-center justify-center rounded-md border border-dashed border-carup-line-strong bg-carup-bg-surface">
        <Car className="size-6 text-carup-text-3" />
      </div>
    </AspectRatio>
    <p className="text-xs text-muted-foreground">{label}</p>
  </div>
)

export const Ratios = () => (
  <div className="flex items-start gap-4">
    <Ratio ratio={1} label="1:1 · seller avatar, thumbnail" />
    <Ratio ratio={4 / 3} label="4:3 · listing card photo" />
    <Ratio ratio={16 / 9} label="16:9 · gallery hero" />
  </div>
)

export const InListingCard = () => (
  <div className="overflow-hidden rounded-xl border bg-card" style={{ width: 300 }}>
    <AspectRatio ratio={4 / 3}>
      <div className="flex size-full flex-col items-center justify-center gap-2 bg-carup-bg-surface">
        <Car className="size-10 text-carup-text-3" />
        <span className="text-xs text-muted-foreground">Honda Fit Hybrid · 2017</span>
      </div>
      <Badge className="absolute left-3 top-3">Featured</Badge>
    </AspectRatio>
    <div className="space-y-1 p-4">
      <p className="font-semibold">Honda Fit Hybrid 1.5</p>
      <p className="text-xs text-muted-foreground">2017 · 98,200 km · Bulawayo</p>
      <MoneyDisplay amount={7800} currency="USD" source="asking" />
    </div>
  </div>
)

export const PhotoPending = () => (
  <div style={{ width: 360 }}>
    <AspectRatio ratio={4 / 3}>
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-carup-line-strong bg-carup-bg-raised text-center">
        <Camera className="size-8 text-carup-action" />
        <span className="text-sm font-medium">Add a front three-quarter photo</span>
        <span className="text-xs text-muted-foreground">JPG or PNG, up to 10 MB</span>
      </div>
    </AspectRatio>
  </div>
)
