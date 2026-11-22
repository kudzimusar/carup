import {
  Badge,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  MoneyDisplay,
} from '@carup/design-system'
import { Armchair, Car, Cog, Gauge, Truck } from 'lucide-react'
import type { ReactNode } from 'react'

// No network in previews: photos are token-coloured placeholder panels.
const navyPanel = {
  background: 'linear-gradient(135deg, var(--carup-raw-navy) 0%, var(--carup-raw-ink-2) 100%)',
}

const shots: { icon: ReactNode; label: string }[] = [
  { icon: <Truck className="size-10" />, label: 'Front three-quarter' },
  { icon: <Armchair className="size-10" />, label: 'Interior · leather seats' },
  { icon: <Gauge className="size-10" />, label: 'Dashboard · 62,400 km' },
  { icon: <Cog className="size-10" />, label: 'Engine bay · 2.8 GD-6' },
]

export const VehicleGallery = () => (
  <div style={{ padding: '0 56px' }}>
    <Carousel style={{ maxWidth: 560, margin: '0 auto' }}>
      <CarouselContent>
        {shots.map((s, i) => (
          <CarouselItem key={s.label}>
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg text-white" style={{ ...navyPanel, height: 280 }}>
              <span className="text-carup-raw-orange-signal">{s.icon}</span>
              <span className="text-sm font-semibold">Toyota Hilux 2.8 GD-6 Raider</span>
              <span className="text-xs" style={{ opacity: 0.75 }}>{s.label} · {i + 1} of {shots.length}</span>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
)

const similar = [
  { title: 'Toyota Hilux 2.4 GD-6 SRX', meta: '2020 · 81,000 km · Harare', price: 31500, badge: 'Dealer' },
  { title: 'Isuzu D-Max 2.5 LE', meta: '2019 · 94,300 km · Bulawayo', price: 24900, badge: 'Private' },
  { title: 'Nissan Navara 2.5 dCi', meta: '2018 · 102,700 km · Mutare', price: 22800, badge: 'Dealer' },
  { title: 'Ford Ranger 2.2 XLS', meta: '2019 · 88,150 km · Harare', price: 26400, badge: 'Private' },
  { title: 'Mitsubishi Triton 2.4', meta: '2021 · 54,900 km · Gweru', price: 29900, badge: 'Dealer' },
]

export const SimilarListings = () => (
  <div style={{ padding: '0 56px' }}>
    <p className="mb-3 text-sm font-semibold">Similar bakkies near you</p>
    <Carousel opts={{ align: 'start' }}>
      <CarouselContent>
        {similar.map((v) => (
          <CarouselItem key={v.title} style={{ flexBasis: '33.333%' }}>
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="relative flex items-center justify-center bg-carup-bg-surface" style={{ height: 110 }}>
                <Car className="size-8 text-carup-text-3" />
                <Badge variant="secondary" className="absolute left-2 top-2">{v.badge}</Badge>
              </div>
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">{v.meta}</p>
                <MoneyDisplay amount={v.price} currency="USD" source="asking" />
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
)

const tips = [
  { title: 'Ask for the logbook first', body: 'Check the chassis number on the logbook matches the vehicle before you talk price.' },
  { title: 'Book an independent inspection', body: 'A garage you choose, not the seller, should look at brakes, suspension and the engine.' },
  { title: 'Meet somewhere public', body: 'Arrange viewings in daylight at a busy location, and bring someone with you.' },
]

export const Vertical = () => (
  <div style={{ padding: '56px 0', width: 420, margin: '0 auto' }}>
    <Carousel orientation="vertical" opts={{ align: 'start' }}>
      <CarouselContent style={{ height: 264 }}>
        {tips.map((t, i) => (
          <CarouselItem key={t.title} style={{ flexBasis: '50%' }}>
            <div className="flex h-full flex-col justify-center gap-1 rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-carup-action">Buyer tip {i + 1} of {tips.length}</p>
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="text-xs text-muted-foreground">{t.body}</p>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
)
