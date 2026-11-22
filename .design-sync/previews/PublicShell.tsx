import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EvidenceLine,
  Input,
  MoneyDisplay,
  PublicShell,
  TrustLens,
  VehicleIdentity,
} from '@carup/design-system'
import { Gauge, MapPin, Search, SlidersHorizontal } from 'lucide-react'

const LISTINGS = [
  { title: 'Toyota Hilux 2.8 GD-6 Raider', year: 2021, km: '62,400 km', city: 'Harare', price: 38500, seller: 'Dealer', lens: { state: 'evaluated' as const, sourceCount: 3, freshness: '12 Nov 2026' } },
  { title: 'Honda Fit 1.3 Hybrid', year: 2014, km: '118,200 km', city: 'Bulawayo', price: 8900, seller: 'Private', lens: { state: 'not-evaluated' as const, sourceCount: 0, freshness: '10 Nov 2026' } },
  { title: 'Mazda CX-5 2.0 Dynamic', year: 2019, km: '71,250 km', city: 'Harare', price: 24800, seller: 'Dealer', lens: { state: 'stale' as const, sourceCount: 3, freshness: '14 Mar 2026' } },
]

const ListingGrid = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
    {LISTINGS.map((l) => (
      <Card key={l.title}>
        <CardHeader>
          <CardTitle>{l.title}</CardTitle>
          <CardDescription className="flex items-center gap-3">
            <span>{l.year}</span>
            <span className="inline-flex items-center gap-1"><Gauge className="size-3.5" /> {l.km}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {l.city}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <MoneyDisplay amount={l.price} currency="USD" source="asking" size="lg" />
          <div><TrustLens {...l.lens} /></div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button className="flex-1">Contact seller</Button>
          <Badge variant="secondary">{l.seller}</Badge>
        </CardFooter>
      </Card>
    ))}
  </div>
)

export const GuestMarketplace = () => (
  <PublicShell identity={{ displayName: 'Visitor', isAuthenticated: false, role: null }} currentPath="/marketplace">
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.12] tracking-[-0.02em]">Vehicles for sale in Zimbabwe</h1>
          <p className="mt-1 text-[13px] text-carup-text-2">1,284 listings from private sellers and approved dealers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><SlidersHorizontal /> Filters</Button>
          <Button variant="outline">Save search</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">Pickups &amp; SUVs</Badge>
        <Badge variant="secondary">Harare</Badge>
        <Badge variant="secondary">2018 or newer</Badge>
        <Badge variant="outline">Diesel</Badge>
      </div>
      <ListingGrid />
    </div>
  </PublicShell>
)

export const SignedInOwner = () => (
  <PublicShell identity={{ displayName: 'Tendai Moyo', isAuthenticated: true, role: 'owner' }} currentPath="/">
    <div className="space-y-6">
      <section className="rounded-card border border-carup-line bg-carup-bg-raised p-6">
        <p className="text-[13px] text-carup-text-2">Welcome back, Tendai</p>
        <h1 className="mt-1 text-[28px] font-bold leading-[1.12] tracking-[-0.02em]">Find your next car</h1>
        <div className="mt-4 flex gap-2" style={{ maxWidth: 640 }}>
          <Input placeholder="Make, model or keyword, e.g. Hilux GD-6" aria-label="Search vehicles" />
          <Button><Search /> Search</Button>
        </div>
      </section>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[16px] font-bold tracking-[-0.02em]">Recently viewed</h2>
        <Button variant="link" size="sm">See saved vehicles</Button>
      </div>
      <ListingGrid />
    </div>
  </PublicShell>
)

export const SessionChecking = () => (
  <PublicShell identity={{ displayName: 'Tendai Moyo', isAuthenticated: true, role: 'owner', bootstrapping: true }} currentPath="/marketplace">
    <div className="space-y-5">
      <VehicleIdentity
        title="Toyota Hilux 2.8 GD-6 Raider"
        year={2021}
        mileageKm={62400}
        location="Harare"
        variant="header"
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24 }}>
        <Card>
          <CardHeader>
            <CardTitle>Evidence for this vehicle</CardTitle>
            <CardDescription>Records submitted by the seller and governed sources.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
            <div className="space-y-1.5">
              <EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />
              <EvidenceLine actor="Toyota Zimbabwe, Msasa" source="Service invoice" at="2026-09-12" />
              <EvidenceLine actor="ZINARA" source="Vehicle licence disc" at="2026-07-03" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Price</CardTitle>
            <CardDescription>Sold by Croco Motors Harare</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <MoneyDisplay amount={38500} currency="USD" source="asking" size="lg" />
            <div><MoneyDisplay amount={36200} currency="USD" source="guide" /></div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button className="flex-1">Contact seller</Button>
            <Button variant="outline">Save</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  </PublicShell>
)
