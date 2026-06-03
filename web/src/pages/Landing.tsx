import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowRight,
  CheckCircle,
  ClipboardCheck,
  FileSearch,
  Gauge,
  KeyRound,
  Lock,
  MapPin,
  Search,
  ShieldCheck,
  Tag,
  UserRoundCheck,
} from 'lucide-react'
import { vehicles } from '@/data/mockData'
import { useAuth } from '@/context/AuthContext'

const popularSearches = [
  'Brand New',
  'Recently Imported',
  'Fresh Imports',
  'Locally Used',
  'Second Hand',
  'Duty Cleared',
  'ZIMRA Verified',
  'CID Clear',
  'Low Mileage',
  'Toyota Hilux',
  'Honda Fit',
  'Mazda Demio',
  'SUVs',
  'Under $5,000',
  'Under $10,000',
  'Dealer Verified',
  'Harare',
  'Bulawayo',
]

const trustStrip = [
  { label: 'Plate Check', icon: FileSearch },
  { label: 'Evidence Timeline', icon: ClipboardCheck },
  { label: 'Owner Privacy', icon: UserRoundCheck },
  { label: 'Trust Score', icon: Gauge },
  { label: 'SafePay Ready', icon: Lock },
]

const howItWorks = [
  {
    title: 'Search cars',
    description: 'Browse verified listings by make, location, budget, or category.',
    icon: Search,
  },
  {
    title: 'Verify Passport',
    description: 'Open the vehicle Passport with plate, VIN, chassis, and trust data.',
    icon: ShieldCheck,
  },
  {
    title: 'Reserve / SafePay',
    description: 'Use CarUp reservation and SafePay flows where the listing supports it.',
    icon: KeyRound,
  },
  {
    title: 'Complete ownership transfer',
    description: 'Move forward with clearer identity, seller, and history context.',
    icon: CheckCircle,
  },
]

function formatUsd(price: number) {
  return `$${price.toLocaleString()}`
}

function vehiclePassportPath(vin: string) {
  return `/marketplace/${encodeURIComponent(vin)}`
}

export default function Landing() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [buyQuery, setBuyQuery] = useState('')
  const [verifyQuery, setVerifyQuery] = useState('')
  const [sellQuery, setSellQuery] = useState('')
  const [verifyBeforeBuyQuery, setVerifyBeforeBuyQuery] = useState('')
  const [sellSectionQuery, setSellSectionQuery] = useState('')

  const featuredVehicles = useMemo(
    () => vehicles.filter(vehicle => vehicle.isFeatured && vehicle.isVerified).slice(0, 6),
    []
  )

  const heroVehicle = featuredVehicles[0] || vehicles[0]

  const submitBuy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(buyQuery.trim() ? '/search' : '/marketplace')
  }

  const openPassport = (identifier: string) => {
    const cleanIdentifier = identifier.trim()
    if (!cleanIdentifier) return
    navigate(`/marketplace/${encodeURIComponent(cleanIdentifier)}`)
  }

  const submitVerify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    openPassport(verifyQuery)
  }

  const sellerHandoff = () => {
    navigate(isAuthenticated ? '/dashboard/sell-vehicle' : '/register')
  }

  const submitSell = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sellerHandoff()
  }

  const submitVerifyBeforeBuy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    openPassport(verifyBeforeBuyQuery)
  }

  const submitSellSection = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sellerHandoff()
  }

  return (
    <div className="min-h-screen bg-white text-gray-950">
      <section
        className="relative overflow-hidden bg-[hsl(222,47%,8%)] text-white"
        data-testid="home-hero"
      >
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.24),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(15,23,42,0.86))]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white to-transparent" />
        </div>

        <div className="relative section-padding mx-auto grid max-w-[1440px] gap-10 py-12 lg:grid-cols-[minmax(0,1.08fr)_420px] lg:py-16 xl:py-20">
          <div className="max-w-4xl">
            <Badge className="mb-5 border-orange-400/40 bg-orange-500/15 text-orange-100 hover:bg-orange-500/20">
              Verified automotive marketplace for Zimbabwe
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-normal md:text-6xl lg:text-7xl">
              Find Verified Cars. Sell With Confidence.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-gray-300 md:text-xl">
              CarUp helps buyers and sellers build trust with vehicle Passports, plate checks,
              owner privacy, trust scores, and evidence-backed timelines.
            </p>

            <Card className="mt-8 max-w-3xl border-white/20 bg-white/95 text-gray-950 shadow-xl backdrop-blur">
              <CardContent className="p-4 sm:p-5">
                <Tabs defaultValue="buy">
                  <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-transparent p-0">
                    <TabsTrigger
                      value="buy"
                      data-testid="home-buy-tab"
                      className="rounded-md py-2.5 text-xs font-semibold data-[state=active]:bg-gray-950 data-[state=active]:text-white sm:text-sm"
                    >
                      Buy a Car
                    </TabsTrigger>
                    <TabsTrigger
                      value="sell"
                      data-testid="home-sell-tab"
                      className="rounded-md py-2.5 text-xs font-semibold data-[state=active]:bg-gray-950 data-[state=active]:text-white sm:text-sm"
                    >
                      Sell My Car
                    </TabsTrigger>
                    <TabsTrigger
                      value="verify"
                      data-testid="home-verify-tab"
                      className="rounded-md py-2.5 text-xs font-semibold data-[state=active]:bg-gray-950 data-[state=active]:text-white sm:text-sm"
                    >
                      Verify a Car
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="buy" className="mt-5">
                    <form onSubmit={submitBuy} className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          value={buyQuery}
                          onChange={event => setBuyQuery(event.target.value)}
                          placeholder="Search make, model, dealer, location, plate, VIN, or chassis"
                          className="h-12 pl-10"
                          data-testid="home-buy-search"
                        />
                      </div>
                      <Button
                        type="submit"
                        className="h-12 bg-orange-500 px-5 text-white hover:bg-orange-600"
                        data-testid="home-search-submit"
                      >
                        Search Verified Cars
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="verify" className="mt-5">
                    <form onSubmit={submitVerify} className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <FileSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          value={verifyQuery}
                          onChange={event => setVerifyQuery(event.target.value)}
                          placeholder="Enter plate, VIN, or chassis"
                          className="h-12 pl-10 font-mono"
                          data-testid="home-verify-lookup"
                        />
                      </div>
                      <Button type="submit" className="h-12 bg-orange-500 px-5 text-white hover:bg-orange-600">
                        Open Vehicle Passport
                      </Button>
                    </form>
                    <p className="mt-3 text-xs text-gray-500">
                      We will open the existing Passport/detail route and run the current lookup there.
                    </p>
                  </TabsContent>

                  <TabsContent value="sell" className="mt-5">
                    <form onSubmit={submitSell} className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          value={sellQuery}
                          onChange={event => setSellQuery(event.target.value)}
                          placeholder="Enter plate or VIN"
                          className="h-12 pl-10 font-mono"
                          data-testid="home-sell-lookup"
                        />
                      </div>
                      <Button type="submit" className="h-12 bg-orange-500 px-5 text-white hover:bg-orange-600">
                        Start Seller Verification
                      </Button>
                    </form>
                    <p className="mt-3 text-xs text-gray-500">
                      Seller verification currently hands off to the existing account and listing flow.
                    </p>
                  </TabsContent>
                </Tabs>

                <div
                  className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="home-seller-callout"
                >
                  <div>
                    <p className="font-semibold text-gray-950">Selling your car?</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Start with your plate or VIN and create a trusted Passport listing.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={sellerHandoff}
                    className="bg-orange-500 text-white hover:bg-orange-600"
                  >
                    Start Selling
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {heroVehicle && (
            <Card className="self-start overflow-hidden border-white/15 bg-white text-gray-950 shadow-2xl" data-testid="featured-verified-car">
              <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                <img
                  src={heroVehicle.images[0]}
                  alt={`${heroVehicle.year} ${heroVehicle.make} ${heroVehicle.model}`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                  {heroVehicle.isVerified && (
                    <Badge className="bg-green-600 text-white">
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Verified
                    </Badge>
                  )}
                  {heroVehicle.plate_number && (
                    <Badge className="bg-blue-600 text-white">Plate on file</Badge>
                  )}
                </div>
              </div>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-500">{heroVehicle.location}</p>
                    <h2 className="mt-1 text-xl font-bold">
                      {heroVehicle.year} {heroVehicle.make} {heroVehicle.model}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    Trust {heroVehicle.trustScore}
                  </Badge>
                </div>
                <p className="mt-3 text-2xl font-bold text-orange-600">{formatUsd(heroVehicle.price)}</p>
                <Button asChild className="mt-5 w-full bg-gray-950 text-white hover:bg-gray-800" data-testid="featured-view-passport">
                  <Link to={vehiclePassportPath(heroVehicle.vin)}>
                    View Passport <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      <section className="border-b bg-white" data-testid="home-trust-strip">
        <div className="section-padding mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-6 gap-y-3 py-4 lg:justify-between">
          {trustStrip.map((item, index) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 ${index > 0 ? 'lg:border-l lg:border-gray-200 lg:pl-6' : ''}`}
            >
              <item.icon className="h-5 w-5 text-orange-500" />
              <span className="text-sm font-semibold text-gray-800">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <Badge className="mb-3 bg-blue-100 text-blue-700 hover:bg-blue-100">Featured Verified Cars</Badge>
              <h2 className="text-3xl font-bold">Shop cars with visible trust signals</h2>
              <p className="mt-2 max-w-2xl text-gray-600">
                Phase 1 uses existing local vehicle data and shows only supported listing labels.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/marketplace">
                Browse all cars <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredVehicles.map(vehicle => (
              <Card key={vehicle.vin} className="overflow-hidden border-0 bg-white shadow-md transition-shadow hover:shadow-lg" data-testid="featured-verified-car">
                <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                  <img
                    src={vehicle.images[0]}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                    {vehicle.isVerified && (
                      <Badge className="bg-green-600 text-white">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Verified
                      </Badge>
                    )}
                    {vehicle.plate_number && (
                      <Badge className="bg-blue-600 text-white">Plate on file</Badge>
                    )}
                    {vehicle.sellerType === 'Dealer' && (
                      <Badge className="bg-gray-950 text-white">Dealer</Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </h3>
                      <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {vehicle.location}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      Trust {vehicle.trustScore}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xl font-bold text-orange-600">{formatUsd(vehicle.price)}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-gray-500">
                    <span>{vehicle.mileage.toLocaleString()} km</span>
                    <span>{vehicle.transmission}</span>
                    <span>{vehicle.fuelType}</span>
                  </div>
                  <Button asChild className="mt-5 w-full bg-gray-950 text-white hover:bg-gray-800" data-testid="featured-view-passport">
                    <Link to={vehiclePassportPath(vehicle.vin)}>
                      View Passport <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-14">
        <div className="section-padding mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-2">
          <Card className="border-0 bg-[hsl(222,47%,10%)] text-white shadow-md">
            <CardContent className="p-6 md:p-8">
              <Badge className="mb-4 bg-white/10 text-white hover:bg-white/10">Sell with a Passport</Badge>
              <h2 className="text-3xl font-bold">Sell your car with a trusted Passport</h2>
              <p className="mt-3 text-gray-300">
                Start with the current seller verification handoff and create a listing through CarUp.
              </p>
              <form onSubmit={submitSellSection} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={sellSectionQuery}
                  onChange={event => setSellSectionQuery(event.target.value)}
                  placeholder="Plate or VIN"
                  className="h-12 border-white/20 bg-white/10 font-mono text-white placeholder:text-gray-400"
                  data-testid="sell-car-input"
                />
                <Button type="submit" className="h-12 bg-white text-gray-950 hover:bg-gray-100">
                  Start Seller Verification
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardContent className="p-6 md:p-8">
              <Badge className="mb-4 bg-green-100 text-green-700 hover:bg-green-100">Verify before you buy</Badge>
              <h2 className="text-3xl font-bold">Already found a car elsewhere?</h2>
              <p className="mt-3 text-gray-600">Check its CarUp Passport before you pay.</p>
              <form onSubmit={submitVerifyBeforeBuy} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={verifyBeforeBuyQuery}
                  onChange={event => setVerifyBeforeBuyQuery(event.target.value)}
                  placeholder="Plate, VIN, or chassis"
                  className="h-12 font-mono"
                  data-testid="verify-before-buy-input"
                />
                <Button type="submit" className="h-12 bg-orange-500 text-white hover:bg-orange-600">
                  Verify Vehicle
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <Badge className="mb-3 bg-orange-100 text-orange-700 hover:bg-orange-100">Popular Zimbabwe Categories</Badge>
              <h2 className="text-2xl font-bold md:text-3xl">Start with what buyers ask for most</h2>
            </div>
            <p className="max-w-lg text-sm text-gray-600">
              These are Phase 1 quick-entry labels. Backend category filters come later.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {popularSearches.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => navigate('/marketplace')}
                className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                data-testid="popular-search-chip"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="max-w-2xl">
            <Badge className="mb-3 bg-orange-100 text-orange-700 hover:bg-orange-100">How CarUp Works</Badge>
            <h2 className="text-3xl font-bold">From search to transfer, keep the trust record visible</h2>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-4">
            {howItWorks.map((item, index) => (
              <Card key={item.title} className="border border-gray-100 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-sm font-bold text-orange-600">0{index + 1}</p>
                  <h3 className="mt-1 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[hsl(222,47%,8%)] py-14 text-white">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <Badge className="mb-3 bg-orange-500/20 text-orange-100 hover:bg-orange-500/20">
                Why CarUp is safer
              </Badge>
              <h2 className="max-w-2xl text-3xl font-bold">
                Buy, verify, and sell with Passport-backed confidence
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-orange-500 text-white hover:bg-orange-600">
                <Link to="/marketplace">Buy Cars</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                <Link to="/search">Verify a Vehicle</Link>
              </Button>
            </div>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <div>
              <h3 className="font-semibold">Private seller details stay protected</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Homepage cards avoid exposing private owner names or phone numbers.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Passport context before payment</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Buyers can open the current vehicle Passport route from VIN-based listing links.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Seller trust starts early</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Sellers are guided into the existing account and listing flow before publishing.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
