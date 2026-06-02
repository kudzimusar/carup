import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Car,
  Shield,
  Brain,
  Wrench,
  FileCheck,
  Users,
  ArrowRight,
  CheckCircle,
  Star,
  Zap,
  Lock,
  Eye
} from 'lucide-react'
import { vehicles } from '@/data/mockData'

const pillars = [
  {
    icon: Shield,
    title: 'Vehicle Registry Intelligence',
    description: 'Every car gets a digital identity with complete ownership, service, and accident history powered by AI and blockchain verification.',
    color: 'bg-blue-500',
  },
  {
    icon: Car,
    title: 'Marketplace Ecosystem',
    description: 'Buy and sell vehicles with confidence. From dealers to individuals, find your perfect match with AI-powered recommendations.',
    color: 'bg-orange-500',
  },
  {
    icon: Brain,
    title: 'Gutu AI Assistant',
    description: 'Your personal automotive AI that handles document scanning, fraud detection, pricing intelligence, and maintenance predictions.',
    color: 'bg-purple-500',
  },
  {
    icon: Wrench,
    title: 'PartSentry System',
    description: 'Track every part that goes into your vehicle. Full lifecycle ledger from installation to warranty — impossible to fake.',
    color: 'bg-emerald-500',
  },
  {
    icon: FileCheck,
    title: 'OCR Document Intelligence',
    description: 'Scan logbooks, insurance papers, and police clearances. Gutu AI extracts data and autofills your vehicle profile instantly.',
    color: 'bg-amber-500',
  },
  {
    icon: Users,
    title: 'Multi-Stakeholder Network',
    description: 'Connected ecosystem for owners, dealers, mechanics, insurers, banks, and government — all working together.',
    color: 'bg-rose-500',
  },
]

const stats = [
  { value: '12,000+', label: 'Vehicles Registered' },
  { value: '850+', label: 'Verified Dealers' },
  { value: '320+', label: 'Partner Garages' },
  { value: '98.7%', label: 'Fraud Detection Rate' },
]

const testimonials = [
  {
    name: 'Tendai Moyo',
    role: 'Car Owner',
    avatar: '/images/avatars/owner-1.jpg',
    content: 'CarUp gave me complete confidence when selling my car. The buyer could see the full service history and trust score. Sold within 3 days!',
    rating: 5,
  },
  {
    name: 'Sarah Chikomo',
    role: 'Car Owner',
    avatar: '/images/avatars/owner-2.jpg',
    content: 'The Gutu AI scanned my logbook in seconds and created my vehicle profile automatically. PartSentry tracked every part ever changed. Incredible.',
    rating: 5,
  },
  {
    name: 'James Ncube',
    role: 'Auto Dealer',
    avatar: '/images/avatars/dealer-1.jpg',
    content: 'Since joining CarUp as a verified dealer, my sales have increased 40%. Customers trust the verified badge and transparency.',
    rating: 5,
  },
]

const stakeholders = [
  { icon: Car, label: 'Car Owners', desc: 'Track vehicles, store docs, sell with trust' },
  { icon: Building2, label: 'Dealers', desc: 'Inventory tools, CRM, lead management' },
  { icon: Wrench, label: 'Mechanics', desc: 'Service logs, parts ledger, reputation' },
  { icon: Shield, label: 'Insurance', desc: 'Risk analysis, claims verification' },
  { icon: Landmark, label: 'Government', desc: 'Registry sync, compliance monitoring' },
  { icon: Star, label: 'Banks', desc: 'Asset verification, financing tools' },
]

function Building2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M12 6h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/><path d="M8 6h.01"/><path d="M9 22v-3h6v3"/><path d="M7 19h10v-9a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2Z"/><path d="M4 19h3"/><path d="M17 19h3"/><path d="M21 19v-8a2 2 0 0 0-2-2h-1"/><path d="M4 19v-8a2 2 0 0 1 2-2h1"/>
    </svg>
  )
}

function Landmark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 21v-5h6v5"/><path d="M9.1 9.99a3 3 0 0 1 5.8 0"/>
    </svg>
  )
}

export default function Landing() {
  const featuredVehicles = vehicles.filter(v => v.isFeatured).slice(0, 4)

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url('/images/hero/showroom.jpg')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(222,47%,8%)] via-transparent to-transparent" />

        <div className="relative section-padding mx-auto max-w-[1440px] pt-20 pb-24 lg:pt-32 lg:pb-40">
          <div className="max-w-3xl">
            <Badge className="mb-6 bg-orange-500/20 text-orange-300 border-orange-500/30 hover:bg-orange-500/30">
              Zimbabwe's Automotive Intelligence Platform
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Every Car Deserves a{' '}
              <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
                Digital Identity
              </span>
            </h1>
            <p className="text-lg md:text-xl text-gray-300 mb-8 max-w-2xl leading-relaxed">
              CarUp is Zimbabwe's trusted vehicle intelligence platform. Registry, marketplace, 
              AI-powered insights, and blockchain verification — all in one place.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white gap-2" asChild>
                <Link to="/marketplace">
                  Explore Marketplace <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 gap-2" asChild>
                <Link to="/register">
                  <Car className="w-4 h-4" /> Register Your Vehicle
                </Link>
              </Button>
            </div>

            {/* Trust Badges */}
            <div className="flex flex-wrap gap-6 mt-12 pt-8 border-t border-white/10">
              {[
                { icon: Shield, text: 'Blockchain Verified' },
                { icon: Eye, text: 'Full Transparency' },
                { icon: Lock, text: 'Bank-Grade Security' },
                { icon: Zap, text: 'AI-Powered' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2 text-sm text-gray-400">
                  <item.icon className="w-4 h-4 text-orange-400" />
                  {item.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-[hsl(222,47%,11%)]">{stat.value}</p>
                <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product Pillars */}
      <section className="py-20 bg-gray-50">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge className="mb-4 bg-orange-100 text-orange-700 hover:bg-orange-200">Product Pillars</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Six Pillars of Automotive Intelligence</h2>
            <p className="text-gray-600">A comprehensive ecosystem built to transform Zimbabwe's automotive landscape.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pillars.map((pillar) => (
              <Card key={pillar.title} className="hover-lift border-0 card-shadow">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl ${pillar.color} flex items-center justify-center mb-4`}>
                    <pillar.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{pillar.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{pillar.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Vehicles */}
      <section className="py-20 bg-white">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex items-end justify-between mb-10">
            <div>
              <Badge className="mb-4 bg-blue-100 text-blue-700 hover:bg-blue-200">Marketplace</Badge>
              <h2 className="text-3xl md:text-4xl font-bold">Featured Vehicles</h2>
              <p className="text-gray-600 mt-2">Verified listings with full history and trust scores</p>
            </div>
            <Button variant="outline" className="hidden md:flex gap-2" asChild>
              <Link to="/marketplace">View All <ArrowRight className="w-4 h-4" /></Link>
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredVehicles.map((vehicle) => (
              <Link key={vehicle.id} to={`/marketplace/${vehicle.id}`} className="group">
                <Card className="overflow-hidden border-0 card-shadow hover-lift h-full">
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img
                      src={vehicle.images[0]}
                      alt={`${vehicle.make} ${vehicle.model}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3 flex gap-2">
                      {vehicle.isVerified && (
                        <Badge className="bg-green-500 text-white text-[10px]">
                          <CheckCircle className="w-3 h-3 mr-1" /> Verified
                        </Badge>
                      )}
                      {vehicle.isFeatured && (
                        <Badge className="bg-orange-500 text-white text-[10px]">Featured</Badge>
                      )}
                    </div>
                    <div className="absolute top-3 right-3">
                      <Badge variant="secondary" className="text-[10px] font-semibold">
                        Trust {vehicle.trustScore}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-sm">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                    <p className="text-lg font-bold text-orange-600 mt-1">
                      ${vehicle.price.toLocaleString()}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{vehicle.mileage.toLocaleString()} km</span>
                      <span>{vehicle.transmission}</span>
                      <span>{vehicle.fuelType}</span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <div className="flex items-center gap-1.5">
                        <img src={vehicle.sellerAvatar} alt="" className="w-5 h-5 rounded-full" />
                        <span className="text-xs text-gray-600">{vehicle.sellerName}</span>
                      </div>
                      <span className="text-xs text-gray-400">{vehicle.location}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="mt-8 text-center md:hidden">
            <Button variant="outline" className="gap-2" asChild>
              <Link to="/marketplace">View All Vehicles <ArrowRight className="w-4 h-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stakeholders */}
      <section className="py-20 bg-gray-50">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge className="mb-4 bg-purple-100 text-purple-700 hover:bg-purple-200">Ecosystem</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">Built for Every Stakeholder</h2>
            <p className="text-gray-600 mt-3">
              CarUp connects the entire automotive ecosystem. Every participant has dedicated tools, dashboards, and AI assistance.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stakeholders.map((s) => (
              <Card key={s.label} className="border-0 card-shadow hover-lift">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shrink-0">
                    <s.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{s.label}</h3>
                    <p className="text-sm text-gray-600">{s.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-white">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge className="mb-4 bg-green-100 text-green-700 hover:bg-green-200">How It Works</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">Get Started in 4 Easy Steps</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Sign Up', desc: 'Create your CarUp account with your phone number and verify your identity.' },
              { step: '02', title: 'Add Vehicle', desc: 'Enter your VIN or scan your logbook. Gutu AI auto-fills the details.' },
              { step: '03', title: 'Build Trust', desc: 'Upload service records, insurance docs, and police clearances to build your trust score.' },
              { step: '04', title: 'Transact Safely', desc: 'Buy, sell, insure, and service with complete transparency and confidence.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-orange-500">{item.step}</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-gray-50">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge className="mb-4 bg-amber-100 text-amber-700 hover:bg-amber-200">Testimonials</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">Trusted by Zimbabweans</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <Card key={t.name} className="border-0 card-shadow">
                <CardContent className="p-6">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 mb-6 leading-relaxed">"{t.content}"</p>
                  <div className="flex items-center gap-3">
                    <img src={t.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,15%)] text-white">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            Ready to Join the Future of Automotive Trust?
          </h2>
          <p className="text-lg text-gray-300 mb-8 max-w-2xl mx-auto">
            Whether you're buying, selling, or managing vehicles — CarUp gives you the intelligence 
            and transparency you need.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button size="lg" className="bg-orange-500 hover:bg-orange-600 gap-2" asChild>
              <Link to="/register">
                Get Started Free <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
              <Link to="/contact">Contact Sales</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}