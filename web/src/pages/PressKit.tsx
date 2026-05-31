import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Link } from 'react-router-dom'
import { 
  Download, 
  Copy, 
  Check, 
  FileText, 
  MapPin, 
  Mail, 
  Phone, 
  Calendar, 
  ChevronRight,
  Sparkles,
  Info,
  Clock,
  Send,
  Sliders,
  Palette,
  Image,
  Award,
  Globe,
  X,
  Share2
} from 'lucide-react'
import { toast } from 'sonner'

// Press Releases Data with Full Text for high fidelity detail viewing
interface PressRelease {
  id: string
  title: string
  date: string
  category: 'Product Launch' | 'Corporate' | 'Partnership' | 'Milestone'
  readTime: string
  summary: string
  fullContent: string[]
}

const pressReleases: PressRelease[] = [
  {
    id: 'pr-1',
    title: 'CarUp Integrates ZINARA Third-Party Registry System for Instant Vehicle Logbook OCR Verification in Zimbabwe',
    date: 'May 12, 2026',
    category: 'Product Launch',
    readTime: '4 min read',
    summary: 'A major regulatory integration enabling Harare and Bulawayo drivers to securely sync vehicle logbooks and police clearances with Gutu AI for instantaneous trust scoring.',
    fullContent: [
      'HARARE, ZIMBABWE — CarUp, Zimbabwe\'s premier automotive intelligence platform, today announced the official integration of its Gutu AI engine with the Zimbabwe National Road Administration (ZINARA) vehicle validation protocols and advanced OCR logbook scanning systems.',
      'This landmark integration allows vehicle owners, premium dealerships, and corporate fleet managers across Zimbabwe to instantly upload scans of their official vehicle logbooks, physical police clearance certificates, and licensing documents. Gutu AI\'s advanced optical character recognition (OCR) immediately matches these with the database, establishing a tamper-proof digital profile in less than 30 seconds.',
      '"With this launch, we are ending the era of fraudulent vehicle histories in Zimbabwe," said Tendai Moyo, Founder and CEO of CarUp. "Every year, thousands of buyers are defrauded using fake registration logbooks or altered mileage records. By linking our blockchain-backed trust system directly with ZINARA metadata verification, we provide an absolute shield of authenticity."',
      'The feature is immediately available for all registered users on the CarUp dashboard, with premium support offered to verified dealer networks in Harare, Bulawayo, Gweru, and Mutare. Insurers and financial institutions can also query these records with owner permission, speeding up loan approval times for car financing from weeks to mere minutes.'
    ]
  },
  {
    id: 'pr-2',
    title: 'CarUp Launches PartSentry: Zimbabwe\'s First Cryptographic Parts Lifecycle Ledger to Combat Counterfeiting',
    date: 'March 24, 2026',
    category: 'Partnership',
    readTime: '5 min read',
    summary: 'Partnering with 300+ certified garages nationwide, PartSentry makes car repair records tamper-proof, shielding consumers from sub-standard aftermarket parts fraud.',
    fullContent: [
      'HARARE, ZIMBABWE — CarUp has officially launched PartSentry, a pioneering cryptographic ledger designed to track the source, warranty, and installation history of automotive spare parts across Zimbabwe.',
      'Designed to combat the rampant flow of counterfeit and sub-standard vehicle components in the local market, PartSentry creates a digital twin for critical replacement parts—such as brake systems, timing belts, and suspension parts. When a verified mechanic in the CarUp network installs a part, the unique serial number is scanned and committed to the vehicle\'s permanent digital passport.',
      'PartSentry launches with over 300 certified garage partners, including prominent service centres in Harare\'s Graniteside and Southerton industrial areas, as well as Bulawayo\'s Belmont district. This decentralized network ensures that subsequent buyers can verify whether a car has been serviced with genuine OEM parts or low-grade replicas.',
      'Chipo Sibanda, Brand & PR Officer at CarUp, commented: "A vehicle is only as safe as its weakest part. By digitizing the repair invoice and locking spare part serials in a secure cryptographic ledger, we give car buyers full insight into maintenance records. This not only raises the safety standards on Zimbabwean roads but also protects the resale value of well-maintained vehicles."'
    ]
  },
  {
    id: 'pr-3',
    title: 'Seed Funding Expansion: CarUp Secures Capital to Expand Automotive Intelligence Across SADC Region',
    date: 'January 15, 2026',
    category: 'Corporate',
    readTime: '3 min read',
    summary: 'Following rapid growth in the local Zimbabwean market, CarUp secures premium backing to deploy verified vehicle profiles and pricing intelligence in South Africa, Botswana, and Zambia.',
    fullContent: [
      'HARARE, ZIMBABWE — CarUp is proud to announce the closing of its latest seed funding expansion round, backed by leading regional venture capital firms and international automotive tech investors.',
      'The newly acquired capital will be used to accelerate product development for the Gutu AI engine, enhance blockchain infrastructure for vehicle passports, and fund regional expansion across the Southern African Development Community (SADC) region—specifically targeting South Africa, Botswana, and Zambia.',
      'Since its inception in 2024, CarUp has registered over 12,000 verified vehicles, connected 850+ dealerships, and established trust frameworks with major local insurers and commercial banks. The expansion will allow cross-border car buyers—particularly those importing vehicles through the Durban or Beira ports—to trace a vehicle\'s history before it crosses customs borders.',
      '"Regional integration is the logical next step," explained Tendai Moyo. "Vehicles move constantly between South Africa, Zimbabwe, and Zambia. Having a disjointed registry system invites criminal networks to exploit the gaps. CarUp will serve as the unifying ledger of trust, ensuring that a vehicle\'s history remains transparent no matter where it is driven, sold, or serviced in Southern Africa."'
    ]
  }
]

export default function PressKit() {
  const [activeTab, setActiveTab] = useState<'logos' | 'colors' | 'mockups'>('logos')
  const [copiedColor, setCopiedColor] = useState<string | null>(null)
  const [selectedPR, setSelectedPR] = useState<PressRelease | null>(null)
  
  // Inquiry Form State
  const [formSubmitted, setFormSubmitted] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    outlet: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  })

  // Mock download states
  const [downloadingAsset, setDownloadingAsset] = useState<string | null>(null)

  const handleCopyColor = (hex: string, label: string) => {
    navigator.clipboard.writeText(hex)
    setCopiedColor(hex)
    toast.success(`Copied ${label} HEX (${hex}) to clipboard!`)
    setTimeout(() => setCopiedColor(null), 2000)
  }

  const handleDownload = (assetName: string) => {
    setDownloadingAsset(assetName)
    toast.info(`Preparing ${assetName} download package...`)
    
    setTimeout(() => {
      setDownloadingAsset(null)
      toast.success(`${assetName} downloaded successfully!`)
      // Simulate download triggering
      const element = document.createElement("a")
      const file = new Blob(["Simulated brand asset package content"], {type: 'text/plain'})
      element.href = URL.createObjectURL(file)
      element.download = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_bundle.zip`
      document.body.appendChild(element)
      element.click()
      document.body.removeChild(element)
    }, 1500)
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.email || !formData.message) {
      toast.error('Please fill in all required fields.')
      return
    }

    setFormLoading(true)
    setTimeout(() => {
      setFormLoading(false)
      setFormSubmitted(true)
      toast.success('Your media inquiry has been transmitted successfully!')
    }, 1800)
  }

  const handleCopyContact = () => {
    const contactText = `CarUp PR Office\nEmail: press@carup.co.zw\nPhone: +263 242 755 889 / +263 772 400 121\nAddress: Office 402, Batanai Gardens, Jason Moyo Ave, Harare, Zimbabwe`
    navigator.clipboard.writeText(contactText)
    toast.success('PR Team contact details copied to clipboard!')
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,6%)] text-slate-100 font-sans selection:bg-orange-500 selection:text-white">
      {/* Decorative Top Mesh/Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] pointer-events-none overflow-hidden z-0 opacity-20">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[80%] rounded-full bg-gradient-to-br from-orange-500/30 to-amber-500/0 blur-[120px]" />
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[70%] rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/0 blur-[100px]" />
      </div>

      {/* Hero Header Section */}
      <header className="relative z-10 pt-24 pb-20 border-b border-slate-800/80 bg-gradient-to-b from-transparent to-[hsl(222,47%,8%)]">
        <div className="mx-auto max-w-[1280px] px-6 md:px-8 text-center md:text-left">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="max-w-3xl">
              <Badge className="mb-4 bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30 text-orange-400 hover:from-orange-500/30 hover:to-amber-500/30 font-medium px-3.5 py-1 text-xs tracking-wider uppercase rounded-full">
                CarUp Corporate Newsroom
              </Badge>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight text-white mb-6">
                CarUp{' '}
                <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-amber-500 bg-clip-text text-transparent">
                  Media Hub
                </span>
              </h1>
              <p className="text-lg md:text-xl text-slate-400 font-normal leading-relaxed max-w-2xl">
                Access official brand assets, corporate narratives, verified stats, and the latest press announcements for Zimbabwe's premier automotive intelligence platform.
              </p>
            </div>
            
            {/* Quick Links Nav */}
            <div className="flex flex-wrap justify-center md:justify-end gap-3.5 mt-4 md:mt-0 shrink-0">
              <Button 
                variant="outline" 
                size="sm"
                className="border-slate-800 hover:bg-slate-900 text-slate-300 hover:text-white"
                onClick={() => {
                  document.getElementById('brand-assets')?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                Brand Assets
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="border-slate-800 hover:bg-slate-900 text-slate-300 hover:text-white"
                onClick={() => {
                  document.getElementById('fast-facts')?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                Fast Facts
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="border-slate-800 hover:bg-slate-900 text-slate-300 hover:text-white"
                onClick={() => {
                  document.getElementById('press-releases')?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                Press Releases
              </Button>
              <Button 
                className="bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20"
                size="sm"
                onClick={() => {
                  document.getElementById('contact-pr')?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                Contact PR
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="relative z-10 mx-auto max-w-[1280px] px-6 md:px-8 py-16">
        
        {/* Brand Story Section */}
        <section className="mb-24">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            
            {/* Story Text */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center gap-2 text-orange-400 font-semibold tracking-wider text-xs uppercase">
                <Sparkles className="w-4 h-4 text-orange-500" />
                The CarUp Vision
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Establishing the Ledger of Trust for Southern African Vehicles
              </h2>
              <p className="text-slate-300 leading-relaxed font-normal">
                Founded in Harare in 2024, CarUp emerged to address a persistent and high-friction issue in Zimbabwe\'s automotive landscape: the absolute deficit of vehicle transaction transparency and verified historical integrity. 
              </p>
              <p className="text-slate-400 leading-relaxed font-normal">
                By synthesizing state-of-the-art Optical Character Recognition (OCR), AI-driven valuation models, and decentralized blockchain verification, CarUp has engineered a ecosystem that establishes a bulletproof digital identity for every car. From import clearance and licensing records with the <strong className="text-slate-200">Zimbabwe National Road Administration (ZINARA)</strong> to service journals, spare parts tracking, and ownership registers, our mission is simple: to make vehicle transactions transparent, reliable, and completely secure.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <div className="flex items-center gap-3.5 bg-slate-900/60 border border-slate-800 rounded-xl px-5 py-3.5">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400 shrink-0">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white text-sm">Trust First</h4>
                    <p className="text-xs text-slate-400">Digital histories that cannot be forged.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3.5 bg-slate-900/60 border border-slate-800 rounded-xl px-5 py-3.5">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white text-sm">Regional Architecture</h4>
                    <p className="text-xs text-slate-400">Powering transparency across SADC corridors.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Story Card/Mock Up Showcase */}
            <div className="lg:col-span-5 relative">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-indigo-500/10 rounded-3xl blur-2xl pointer-events-none" />
              <Card className="relative bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 overflow-hidden shadow-2xl rounded-2xl group hover:border-slate-700 transition-all duration-300">
                <div className="h-2 bg-gradient-to-r from-orange-500 to-amber-500" />
                <CardContent className="p-8 space-y-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Info className="w-5 h-5 text-orange-400" />
                    Brand Essence
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Company Name</span>
                      <p className="text-base text-slate-200">CarUp (Pvt) Ltd</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Tagline</span>
                      <p className="text-base text-slate-200 font-medium italic">"Building the Decentralized Trust Ledger for Africa's Roads"</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Core Pillars</span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {['Registry Trust', 'Gutu AI Intelligence', 'PartSentry Lifecycle', 'Marketplace Security', 'Cross-Border Traceability'].map((pillar) => (
                          <Badge key={pillar} className="bg-slate-900 border-slate-800 text-slate-300 text-[10px] py-0.5 px-2 hover:bg-slate-800">
                            {pillar}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Press Package Version 2.4</span>
                    <button 
                      onClick={() => handleDownload('Full PR Pitch Kit')}
                      className="text-orange-400 hover:text-orange-300 flex items-center gap-1 hover:underline font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" /> Download Pitch Kit
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
            
          </div>
        </section>

        {/* Fast Facts Grid */}
        <section id="fast-facts" className="mb-24 scroll-mt-20">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 px-3 py-0.5 rounded-full mb-3 text-xs tracking-wider uppercase">
              Key Metrics
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">CarUp Fast Facts</h2>
            <p className="text-slate-400 mt-3 text-base">
              A quick numerical guide to our market traction, localized presence, and ecosystem density.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                value: '2024',
                label: 'Founded',
                desc: 'Launched in Harare, Zimbabwe to solve vehicle registry friction.',
                icon: Clock
              },
              {
                value: '12,000+',
                label: 'Verified Cars Registered',
                desc: 'Vehicles issued with a cryptographically secure digital passport.',
                icon: FileText
              },
              {
                value: '85,000+',
                label: 'Active System Users',
                desc: 'Individual drivers, fleet managers, and corporate stakeholders.',
                icon: Globe
              },
              {
                value: '98.7%',
                label: 'Fraud Detection Rate',
                desc: 'Successful prevention of cloned plates, logbook falsification, and odometer fraud.',
                icon: Sparkles
              },
              {
                value: '1,170+',
                label: 'Partner Ecosystem Networks',
                desc: 'Includes ZINARA validators, 850+ dealers, and 320+ certified mechanics.',
                icon: Sliders
              },
              {
                value: 'Harare, ZW',
                label: 'Corporate Headquarters',
                desc: 'PR, Engineering, and Operations based on Samora Machel Avenue.',
                icon: MapPin
              }
            ].map((fact, index) => (
              <Card 
                key={index} 
                className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 hover-lift hover:border-orange-500/30 transition-all duration-300 shadow-xl overflow-hidden group"
              >
                <CardContent className="p-6 relative">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-orange-500/5 to-transparent pointer-events-none rounded-bl-full" />
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400 mb-4 group-hover:bg-orange-500/20 group-hover:text-orange-300 transition-colors duration-300">
                    <fact.icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-1">
                    {fact.value}
                  </h3>
                  <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">
                    {fact.label}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {fact.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Brand Assets Hub (Interactive Tabs: Logos, Colors, Mockups) */}
        <section id="brand-assets" className="mb-24 scroll-mt-20">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-12">
            <div>
              <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 px-3 py-0.5 rounded-full mb-3 text-xs tracking-wider uppercase">
                Brand Resources
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-white">Interactive Assets Vault</h2>
              <p className="text-slate-400 mt-2 max-w-2xl text-sm md:text-base">
                Use official, high-resolution logos, precise brand color definitions, and mobile/desktop dashboard mockups.
              </p>
            </div>
            
            {/* Interactive Tab Selectors */}
            <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-lg gap-1.5 mt-6 md:mt-0 max-w-fit">
              <button
                onClick={() => setActiveTab('logos')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'logos' 
                    ? 'bg-orange-500 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Share2 className="w-3.5 h-3.5" /> Logos
              </button>
              <button
                onClick={() => setActiveTab('colors')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'colors' 
                    ? 'bg-orange-500 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Palette className="w-3.5 h-3.5" /> Colors
              </button>
              <button
                onClick={() => setActiveTab('mockups')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'mockups' 
                    ? 'bg-orange-500 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Image className="w-3.5 h-3.5" /> Mockups
              </button>
            </div>
          </div>

          {/* TAB 1: LOGOS DOWNLOAD WIDGETS */}
          {activeTab === 'logos' && (
            <div className="grid md:grid-cols-3 gap-6 animate-fadeIn">
              {[
                {
                  name: 'CarUp Premium Primary Logo',
                  desc: 'Our standard brand signature. Features the amber mark combined with the custom dark-navy type.',
                  specs: 'SVG, PNG, EPS | Vector & High-Res Transparent (5MB)',
                  theme: 'Amber & Navy Duo-tone',
                  bgClass: 'bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,16%)]'
                },
                {
                  name: 'CarUp Light Monochrome Logo',
                  desc: 'Reversed white-ink variation designed exclusively for high-contrast dark backgrounds.',
                  specs: 'SVG, PNG | Optimized for Web & Print (1.2MB)',
                  theme: 'Stark Monochrome White',
                  bgClass: 'bg-black/40'
                },
                {
                  name: 'CarUp Icon & Trust Mark Only',
                  desc: 'The standalone shield-car-sparkle signature. Ideal for app icon simulations, avatars, and tight layouts.',
                  specs: 'SVG, PNG, ICO | Multi-resolution optimized (800KB)',
                  theme: 'Amber Trust Icon',
                  bgClass: 'bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,16%)]'
                }
              ].map((logo, index) => (
                <Card key={index} className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 overflow-hidden hover:border-slate-700 transition-all duration-300 flex flex-col justify-between">
                  <div>
                    {/* Interactive Logo Canvas Area */}
                    <div className={`h-44 ${logo.bgClass} flex items-center justify-center p-6 border-b border-slate-800 relative group`}>
                      <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <span className="text-[10px] text-orange-400 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-full uppercase tracking-wider font-semibold">
                          Asset Verified
                        </span>
                      </div>
                      
                      {/* Interactive Visual Elements Simulating Logo Content */}
                      <div className="flex flex-col items-center gap-3">
                        {index === 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white font-extrabold text-lg">
                              CU
                            </div>
                            <span className="text-2xl font-black text-white tracking-wider flex items-center gap-0.5">
                              Car<span className="text-orange-500">Up</span>
                            </span>
                          </div>
                        )}
                        {index === 1 && (
                          <div className="flex items-center gap-2 filter brightness-200">
                            <div className="w-10 h-10 rounded-xl border-2 border-white flex items-center justify-center text-white font-extrabold text-lg">
                              CU
                            </div>
                            <span className="text-2xl font-black text-white tracking-wider">
                              CarUp
                            </span>
                          </div>
                        )}
                        {index === 2 && (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center shadow-2xl shadow-orange-500/30 text-white font-black text-xl hover:scale-105 transition-transform duration-300">
                            CU
                          </div>
                        )}
                        <span className="text-[10px] text-slate-500 tracking-widest uppercase mt-1">
                          {logo.theme}
                        </span>
                      </div>
                    </div>

                    <div className="p-6">
                      <h4 className="font-bold text-white text-base mb-2">{logo.name}</h4>
                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-4">{logo.desc}</p>
                    </div>
                  </div>

                  <div className="p-6 pt-0 border-t border-slate-800/50 mt-auto flex flex-col gap-3">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                      Files Included: {logo.specs}
                    </span>
                    <Button 
                      onClick={() => handleDownload(logo.name)}
                      disabled={downloadingAsset === logo.name}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 hover:border-slate-700 font-semibold text-xs flex items-center justify-center gap-2 py-2"
                    >
                      {downloadingAsset === logo.name ? (
                        <>
                          <Clock className="w-3.5 h-3.5 animate-spin text-orange-400" />
                          Zipping Bundle...
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          Download Package
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* TAB 2: BRAND COLORS SWATCH DISPLAYS */}
          {activeTab === 'colors' && (
            <div className="grid md:grid-cols-4 gap-6 animate-fadeIn">
              {[
                {
                  label: 'CarUp Amber Gold',
                  hex: '#F59E0B',
                  rgb: 'rgb(245, 158, 11)',
                  hsl: 'hsl(38, 92%, 50%)',
                  cmyk: '0%, 36%, 96%, 4%',
                  role: 'Represents premium trust metrics, AI scanning indicators, interactive hover signals, and primary highlights.',
                  accentClass: 'bg-amber-500 shadow-amber-500/20'
                },
                {
                  label: 'CarUp Deep Navy',
                  hex: '#0A0F1D',
                  rgb: 'rgb(10, 15, 29)',
                  hsl: 'hsl(222, 47%, 8%)',
                  cmyk: '66%, 48%, 0%, 89%',
                  role: 'The flagship background tone. Creates the premium, dark-modern aesthetic, prioritizing depth and sleek interfaces.',
                  accentClass: 'bg-[hsl(222,47%,8%)] shadow-slate-900/40 border border-slate-800'
                },
                {
                  label: 'CarUp Charcoal Slate',
                  hex: '#1E293B',
                  rgb: 'rgb(30, 41, 59)',
                  hsl: 'hsl(215, 25%, 27%)',
                  cmyk: '49%, 31%, 0%, 77%',
                  role: 'Used for structural components, inactive page grids, border lines, card backgrounds, and dark contrast elements.',
                  accentClass: 'bg-slate-800 shadow-slate-800/20'
                },
                {
                  label: 'CarUp Platinum Gray',
                  hex: '#F8FAFC',
                  rgb: 'rgb(248, 250, 252)',
                  hsl: 'hsl(210, 40%, 98%)',
                  cmyk: '1%, 0%, 0%, 1%',
                  role: 'Primary high-contrast text and active heading elements. Ensures stellar reading scores and crisp layouts.',
                  accentClass: 'bg-slate-100 shadow-slate-100/10'
                }
              ].map((color, index) => (
                <Card key={index} className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 overflow-hidden hover:border-slate-700 transition-all duration-300 flex flex-col justify-between">
                  <div>
                    {/* Color Preview Block */}
                    <div className={`h-36 ${color.accentClass} flex items-end justify-between p-4 relative group`}>
                      <button
                        onClick={() => handleCopyColor(color.hex, color.label)}
                        className="absolute top-3 right-3 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white p-2 rounded-lg transition-colors shadow-lg"
                        title="Copy Hex Code"
                      >
                        {copiedColor === color.hex ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      
                      <div className="bg-slate-950/80 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-mono font-bold tracking-wide text-white border border-white/5">
                        {color.hex}
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      <div>
                        <h4 className="font-bold text-white text-base">{color.label}</h4>
                        <span className="text-[10px] text-orange-400 uppercase tracking-widest font-semibold block mt-0.5">
                          Brand Code Spec
                        </span>
                      </div>
                      
                      <p className="text-xs text-slate-400 leading-relaxed font-normal">{color.role}</p>

                      <div className="space-y-2 pt-2 border-t border-slate-800/60 font-mono text-[10.5px]">
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">HEX:</span>
                          <span className="text-slate-300">{color.hex}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">RGB:</span>
                          <span className="text-slate-300">{color.rgb}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">HSL:</span>
                          <span className="text-slate-300">{color.hsl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">CMYK:</span>
                          <span className="text-slate-300">{color.cmyk}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 pt-0 mt-auto">
                    <Button 
                      onClick={() => handleCopyColor(color.hex, color.label)}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 font-semibold text-xs py-2 flex items-center justify-center gap-1.5"
                    >
                      {copiedColor === color.hex ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-400" />
                          HEX Code Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy HEX Code
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* TAB 3: SCREENSHOTS / MOCKUPS WIDGETS */}
          {activeTab === 'mockups' && (
            <div className="grid md:grid-cols-3 gap-6 animate-fadeIn">
              {[
                {
                  title: 'Gutu AI Logbook Scanning Interface',
                  specs: 'Mobile Mockup | High Resolution 1080 x 2400 (PNG)',
                  size: '2.4 MB',
                  previewText: 'Mobile Mockup',
                  desc: 'High-fidelity preview demonstrating Gutu AI scanning a physical Zimbabwean registration book, highlighting verified OCR fields in real-time.'
                },
                {
                  title: 'PartSentry Cryptographic Ledger Ledger',
                  specs: 'Desktop Dashboard | High Resolution 1920 x 1080 (PNG)',
                  size: '4.8 MB',
                  previewText: 'Desktop Mockup',
                  desc: 'Comprehensive dashboard screenshot detailing spare parts lifecycle logs, mechanic signature certifications, and permanent blockchain seal data.'
                },
                {
                  title: 'CarUp Digital Vehicle Trust Score Passport',
                  specs: 'Print Ready PDF Layout | Standard A4 Format (PNG & PDF)',
                  size: '6.1 MB',
                  previewText: 'Document Layout',
                  desc: 'A gorgeous export design of the verified vehicle passport. Shows official trust score rating, ownership chain logs, and ZINARA sync badge.'
                }
              ].map((mockup, index) => (
                <Card key={index} className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 overflow-hidden hover:border-slate-700 transition-all duration-300 flex flex-col justify-between group">
                  <div>
                    {/* Simulated Mockup Image Canvas with dynamic overlays */}
                    <div className="h-44 bg-gradient-to-br from-slate-900 to-slate-950 p-6 flex items-center justify-center border-b border-slate-800 relative overflow-hidden">
                      <div className="absolute inset-0 bg-orange-500/5 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none" />
                      
                      {/* Grid background simulation */}
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />
                      
                      {/* Inner mockup display widget */}
                      <div className="border border-slate-800/80 bg-slate-900/90 rounded-lg p-3 max-w-[80%] text-center shadow-lg relative group-hover:border-orange-500/20 group-hover:shadow-orange-500/5 transition-all duration-300">
                        <div className="flex gap-1 mb-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                        </div>
                        
                        <div className="p-2 bg-slate-950 rounded border border-slate-800/40">
                          <span className="text-[10px] font-mono tracking-wider text-slate-500 block">
                            {mockup.previewText}
                          </span>
                          <span className="text-[9px] text-orange-400 font-bold tracking-wide">
                            CU_VERIFIED_ASSET
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-6">
                      <h4 className="font-bold text-white text-base mb-2 group-hover:text-orange-400 transition-colors">{mockup.title}</h4>
                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-4">{mockup.desc}</p>
                    </div>
                  </div>

                  <div className="p-6 pt-0 border-t border-slate-800/50 mt-auto flex flex-col gap-3">
                    <div className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      <span>Dimensions: {mockup.specs.split('|')[1]}</span>
                      <span>{mockup.size}</span>
                    </div>
                    <Button 
                      onClick={() => handleDownload(mockup.title)}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 hover:border-slate-700 font-semibold text-xs flex items-center justify-center gap-2 py-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download High-Res
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Recent Press Releases (News Feed Style) */}
        <section id="press-releases" className="mb-24 scroll-mt-20">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 px-3 py-0.5 rounded-full mb-3 text-xs tracking-wider uppercase">
              CarUp Pressroom
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Recent Press Announcements</h2>
            <p className="text-slate-400 mt-3 text-base">
              The official timeline of product milestones, strategic mergers, regulatory syncs, and financial funding updates.
            </p>
          </div>

          <div className="space-y-6">
            {pressReleases.map((release) => (
              <Card 
                key={release.id} 
                className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 hover:border-slate-700 hover:bg-[hsl(222,47%,10%)] transition-all duration-300 shadow-xl overflow-hidden group"
              >
                <CardContent className="p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:items-start justify-between">
                  <div className="space-y-4 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge className="bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 text-orange-400 text-[10px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded">
                        {release.category}
                      </Badge>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{release.date}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{release.readTime}</span>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xl sm:text-2xl font-bold text-white group-hover:text-orange-400 transition-colors duration-300 leading-snug">
                        {release.title}
                      </h3>
                      <p className="text-sm sm:text-base text-slate-400 font-normal leading-relaxed mt-2.5">
                        {release.summary}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center md:self-center">
                    <Button 
                      onClick={() => setSelectedPR(release)}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center gap-2 group-hover:bg-orange-500 group-hover:border-orange-500 group-hover:text-white transition-all duration-300 font-bold text-xs px-5 py-3 h-auto"
                    >
                      Read Full Release
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Media Contact & PR Inquiry Form Section */}
        <section id="contact-pr" className="scroll-mt-20">
          <div className="grid lg:grid-cols-12 gap-12 items-start">
            
            {/* PR Details */}
            <div className="lg:col-span-5 space-y-8">
              <div className="space-y-4">
                <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 px-3 py-0.5 rounded-full text-xs tracking-wider uppercase">
                  Media Contact
                </Badge>
                <h2 className="text-3xl font-bold text-white tracking-tight">PR & Communications Team</h2>
                <p className="text-slate-400 leading-relaxed text-sm sm:text-base font-normal">
                  Are you a journalist, research analyst, or corporate partner looking for custom briefings, interviews with our founders, or detailed market data? Reach out directly.
                </p>
              </div>

              {/* Contact Cards */}
              <div className="space-y-4">
                {[
                  {
                    name: 'Rudo Mutasa',
                    role: 'Head of Corporate Communications & Media Relations',
                    email: 'rudo.mutasa@carup.co.zw',
                    phone: '+263 772 400 121'
                  },
                  {
                    name: 'Chipo Sibanda',
                    role: 'Brand & PR Officer',
                    email: 'chipo.sibanda@carup.co.zw',
                    phone: '+263 773 345 678'
                  }
                ].map((person, index) => (
                  <Card key={index} className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 overflow-hidden hover:border-slate-800/80 shadow-md">
                    <CardContent className="p-6 space-y-3 relative">
                      <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-green-500" title="Online / Direct" />
                      <div>
                        <h4 className="font-bold text-white text-base leading-tight">{person.name}</h4>
                        <span className="text-[10px] text-orange-400 tracking-wider uppercase font-semibold block mt-0.5">
                          {person.role}
                        </span>
                      </div>
                      
                      <div className="space-y-1.5 text-xs text-slate-400 pt-2 border-t border-slate-800/50">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <a href={`mailto:${person.email}`} className="hover:text-orange-400 transition-colors">{person.email}</a>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span>{person.phone}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* PR Headquarter Location Card */}
              <Card className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 shadow-md">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400 shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-white text-sm">CarUp PR Head Office</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Office 402, Batanai Gardens, Jason Moyo Ave, Harare, Zimbabwe
                    </p>
                    <span className="text-[10px] text-slate-500 block pt-1">
                      Business Hours: 08:00 - 17:00 (CAT), Monday to Friday
                    </span>
                  </div>
                </CardContent>
              </Card>
              
              <Button 
                onClick={handleCopyContact}
                className="w-full bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-bold py-3 flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy PR Team Contacts
              </Button>
            </div>

            {/* Inquiry Form */}
            <div className="lg:col-span-7">
              <Card className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 shadow-2xl relative overflow-hidden rounded-2xl">
                <div className="h-2 bg-gradient-to-r from-orange-500 to-amber-500" />
                <CardContent className="p-8">
                  {formSubmitted ? (
                    <div className="py-12 text-center space-y-6 animate-fadeIn">
                      <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 mx-auto">
                        <Check className="w-8 h-8" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-white">Media Inquiry Received</h3>
                        <p className="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
                          Thank you for connecting. Our communications office has received your query. A PR officer will review and reach out within 2 hours.
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          setFormSubmitted(false)
                          setFormData({ name: '', outlet: '', email: '', phone: '', subject: '', message: '' })
                        }}
                        variant="outline"
                        className="border-slate-800 hover:bg-slate-900 text-slate-300 hover:text-white font-semibold text-xs px-6"
                      >
                        Submit Another Query
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleFormSubmit} className="space-y-6">
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold text-white">Direct PR Inquiry Form</h3>
                        <p className="text-slate-400 text-xs sm:text-sm">
                          Submit your press query or interview request directly into our triage queue.
                        </p>
                      </div>
                      
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                            Full Name <span className="text-orange-500">*</span>
                          </label>
                          <Input 
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            placeholder="Tendai Moyo" 
                            className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg text-sm"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                            Media Publication / Outlet
                          </label>
                          <Input 
                            value={formData.outlet}
                            onChange={(e) => setFormData({...formData, outlet: e.target.value})}
                            placeholder="The Herald / TechCabal" 
                            className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                            Corporate Email <span className="text-orange-500">*</span>
                          </label>
                          <Input 
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                            placeholder="reporter@herald.co.zw" 
                            className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg text-sm"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                            Phone Number
                          </label>
                          <Input 
                            value={formData.phone}
                            onChange={(e) => setFormData({...formData, phone: e.target.value})}
                            placeholder="+263 772 123 456" 
                            className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg text-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                          Inquiry Subject
                        </label>
                        <Input 
                          value={formData.subject}
                          onChange={(e) => setFormData({...formData, subject: e.target.value})}
                          placeholder="Interview Request with CEO / Data Query" 
                          className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg text-sm"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                          Your Inquiry / Message <span className="text-orange-500">*</span>
                        </label>
                        <Textarea 
                          value={formData.message}
                          onChange={(e) => setFormData({...formData, message: e.target.value})}
                          placeholder="Please type your editorial questions or interview logistics details..." 
                          className="bg-slate-950/80 border-slate-800 text-slate-200 focus-visible:border-orange-500/50 focus-visible:ring-orange-500/10 placeholder:text-slate-600 rounded-lg min-h-[140px] text-sm resize-none"
                          required
                        />
                      </div>

                      <Button 
                        type="submit"
                        disabled={formLoading}
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10 rounded-lg text-sm tracking-wide transition-all"
                      >
                        {formLoading ? (
                          <>
                            <Clock className="w-4 h-4 animate-spin" />
                            Transmitting Inquiry...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Submit Press Inquiry
                          </>
                        )}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
            
          </div>
        </section>

      </main>

      {/* FOOTER ACCENT NOTE */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-12 relative z-10">
        <div className="mx-auto max-w-[1280px] px-6 md:px-8 text-center text-xs text-slate-500 space-y-4">
          <p>© 2026 CarUp (Pvt) Ltd. All brand marks, patents, and system screenshots displayed are official protected assets.</p>
          <div className="flex justify-center gap-6">
            <Link to="/" className="hover:text-slate-300 transition-colors">Platform Home</Link>
            <Link to="/about" className="hover:text-slate-300 transition-colors">Our Story</Link>
            <Link to="/contact" className="hover:text-slate-300 transition-colors">Contact Sales</Link>
            <Link to="/api-docs" className="hover:text-slate-300 transition-colors">Developer Portal</Link>
          </div>
        </div>
      </footer>

      {/* FULL PRESS RELEASE MODAL DETAIL VIEW */}
      {selectedPR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <Card className="bg-[hsl(222,47%,9%)] border-slate-800 text-slate-100 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative rounded-2xl">
            <div className="h-2 bg-gradient-to-r from-orange-500 to-amber-500 sticky top-0 z-10" />
            
            <button 
              onClick={() => setSelectedPR(null)}
              className="absolute top-4 right-4 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white p-2 rounded-lg transition-colors z-20"
            >
              <X className="w-4 h-4" />
            </button>

            <CardHeader className="p-8 pb-4 space-y-4">
              <div className="flex items-center gap-3">
                <Badge className="bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase font-semibold">
                  {selectedPR.category}
                </Badge>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {selectedPR.date}
                </span>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {selectedPR.readTime}
                </span>
              </div>
              
              <CardTitle className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                {selectedPR.title}
              </CardTitle>
            </CardHeader>

            <CardContent className="p-8 pt-4 space-y-6">
              {selectedPR.fullContent.map((paragraph, idx) => (
                <p key={idx} className="text-slate-300 leading-relaxed font-normal text-sm sm:text-base">
                  {paragraph}
                </p>
              ))}
              
              <div className="pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="text-xs text-slate-500">
                  Published by CarUp Public Relations Department, Harare Office.
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin + `/press#${selectedPR.id}`)
                      toast.success('Press Release link copied to clipboard!')
                    }}
                    variant="outline"
                    className="border-slate-800 hover:bg-slate-900 text-slate-300 hover:text-white text-xs font-semibold px-4 py-2"
                  >
                    <Share2 className="w-3.5 h-3.5 mr-1.5" /> Share
                  </Button>
                  <Button
                    onClick={() => handleDownload(`${selectedPR.title.substring(0, 20)} Press Release`)}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Export PDF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
