// @ts-nocheck
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  FileText, 
  ShieldCheck, 
  UserCheck, 
  AlertTriangle, 
  Coins, 
  Wrench, 
  Scale, 
  Building2, 
  HelpCircle, 
  ArrowRight, 
  CheckCircle2, 
  BookOpen,
  Calendar,
  Lock,
  Stamp,
  MessageSquare
} from 'lucide-react'

// Define the sections for navigation
const SECTIONS = [
  { id: 'introduction', label: '1. Introduction & Acceptance', icon: BookOpen },
  { id: 'accounts-kyc', label: '2. User Accounts & KYC Verification', icon: UserCheck },
  { id: 'listing-regulations', label: '3. "No Fake Cars" & Listing Regulations', icon: ShieldCheck },
  { id: 'fees-commissions', label: '4. Commission & Transaction Fees', icon: Coins },
  { id: 'subscriptions', label: '5. Subscriptions (Dealers & Mechanics)', icon: Wrench },
  { id: 'disclaimers', label: '6. Disclaimers & Warranties', icon: AlertTriangle },
  { id: 'governing-law', label: '7. Governing Law (Zimbabwe)', icon: Scale },
  { id: 'compliance-contact', label: '8. Compliance & Legal Contacts', icon: Stamp },
]

export default function TermsOfService() {
  const [activeSection, setActiveSection] = useState('introduction')

  // Smooth scroll helper
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      const yOffset = -90 // header height offset
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset
      window.scrollTo({ top: y, behavior: 'smooth' })
      setActiveSection(id)
    }
  }

  // Monitor scroll position to highlight active section in Sidebar
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 120

      for (const section of SECTIONS) {
        const element = document.getElementById(section.id)
        if (element) {
          const top = element.offsetTop
          const height = element.offsetHeight
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section.id)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 selection:bg-orange-500 selection:text-white">
      {/* Top Premium Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,16%)] text-white py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        {/* Glow Effects */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="max-w-[1400px] mx-auto text-center relative z-10">
          <Badge className="mb-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 py-1 px-3 shadow-lg shadow-orange-500/20 text-xs font-semibold uppercase tracking-wider">
            Legal & Compliance Portal
          </Badge>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Terms of Service
          </h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-base md:text-lg font-light leading-relaxed">
            Welcome to Zimbabwe's premier automotive intelligence platform. Our terms ensure transparency, security, and absolute reliability for all buyers, private sellers, commercial dealers, and automotive mechanics.
          </p>
          
          <div className="flex flex-wrap justify-center items-center gap-4 mt-8 text-xs md:text-sm text-slate-400 bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-full py-2.5 px-5 w-fit mx-auto">
            <span className="flex items-center gap-1.5 font-medium">
              <Calendar className="w-4 h-4 text-orange-500 animate-pulse" />
              Last Updated: May 26, 2026
            </span>
            <span className="hidden md:inline text-slate-700">|</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              ZINARA & Central Vehicle Registry (CVR) Compliant
            </span>
          </div>
        </div>
      </div>

      {/* Main Layout Container */}
      <div className="max-w-[1400px] mx-auto section-padding py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Table of Contents (Sticky Sidebar) */}
          <div className="lg:col-span-4 lg:sticky lg:top-24 space-y-6">
            <Card className="border border-slate-200/80 shadow-md bg-white/95 backdrop-blur-md rounded-xl overflow-hidden">
              <CardHeader className="bg-slate-900/5 border-b border-slate-100 p-5">
                <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-orange-500" />
                  Table of Contents
                </CardTitle>
                <p className="text-xs text-slate-500">Quickly navigate through our legal clauses</p>
              </CardHeader>
              <CardContent className="p-3">
                <nav className="space-y-1">
                  {SECTIONS.map((sec) => {
                    const Icon = sec.icon
                    const isActive = activeSection === sec.id
                    return (
                      <button
                        key={sec.id}
                        onClick={() => scrollToSection(sec.id)}
                        className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 group ${
                          isActive 
                            ? 'bg-gradient-to-r from-orange-500/10 to-amber-500/10 text-orange-700 font-semibold border-l-4 border-orange-500 shadow-sm' 
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-l-4 border-transparent'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive ? 'text-orange-500' : 'text-slate-400 group-hover:text-slate-700'
                        }`} />
                        <span className="truncate">{sec.label}</span>
                      </button>
                    )
                  })}
                </nav>
              </CardContent>
            </Card>

            {/* Quick Interactive Gutu AI Legal Summary Card */}
            <Card className="border border-orange-200/60 shadow-lg bg-gradient-to-br from-slate-950 to-slate-900 text-white rounded-xl overflow-hidden hover-lift">
              <CardContent className="p-6 relative">
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-ping" />
                  <Badge className="bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30 text-[10px] uppercase font-bold py-0.5 px-2">
                    Gutu AI Legal Sentry
                  </Badge>
                </div>
                <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-orange-500" />
                  Need a Plain-Text Summary?
                </h3>
                <p className="text-slate-300 text-xs md:text-sm leading-relaxed mb-4">
                  Gutu AI can break down these legal terms, ZINARA duties, and buyer safeguards in plain English, Shona, or Ndebele.
                </p>
                <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-xs shadow-md border-0 py-4 gap-2" asChild>
                  <Link to="/dashboard/ai">
                    Ask Gutu AI Now <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Structured Terms of Service Sections */}
          <div className="lg:col-span-8 space-y-12">
            
            {/* Section 1: Introduction & Acceptance */}
            <section id="introduction" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <BookOpen className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  1. Introduction & Acceptance
                </h2>
              </div>
              
              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  These Terms of Service (<strong>"Terms"</strong>) govern your access to and use of the CarUp digital platform, including our website, mobile application, vehicle verification tools, API connections, and associated services (collectively, the <strong>"Platform"</strong>).
                </p>
                <p>
                  The Platform is owned and operated by CarUp Automotive Intelligence Private Limited, a registered entity under the laws of the Republic of Zimbabwe. By registering an account, list a vehicle, purchasing a subscription, or accessing any data on this Platform, you acknowledge that you have read, understood, and agreed to be legally bound by these Terms and our Privacy Policy.
                </p>
                
                {/* Warning Alert Note */}
                <div className="bg-amber-50/80 border-l-4 border-amber-500 p-5 rounded-r-lg shadow-sm">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-amber-900 text-sm md:text-base mb-1">Mandatory Consent & Warning</h4>
                      <p className="text-amber-800 text-xs md:text-sm leading-relaxed">
                        If you do not agree to these terms, you are strictly prohibited from using our services. Continuing to access the Platform or registering a profile constitutes legal acceptance of these rules, which are subject to regular updates in line with Zimbabwean digital commerce regulations.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: User Accounts & KYC Verification */}
            <section id="accounts-kyc" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  2. User Accounts & KYC Verification
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  To leverage our secure, smart marketplace, users must register an account. CarUp supports three primary account types: <strong>Private Owners</strong>, <strong>Commercial Dealers</strong>, and <strong>Automotive Mechanics/Garages</strong>.
                </p>
                <p>
                  In compliance with national regulations and to eliminate fraudulent activity within Zimbabwe’s digital auto space, all users must submit to mandatory **Know Your Customer (KYC)** verification checks.
                </p>

                {/* Grid for KYC Requirements */}
                <div className="grid md:grid-cols-2 gap-4 my-6">
                  <Card className="border border-slate-100 shadow-sm bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-orange-600 bg-orange-500/10 py-1 px-2.5 rounded-full">Private Sellers & Buyers</span>
                        <Lock className="w-4 h-4 text-slate-400" />
                      </div>
                      <CardTitle className="text-sm font-bold mt-2">Required KYC Credentials</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-slate-600 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Valid Zimbabwean National ID or International Passport</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Zimbabwean Driver's License (for verification of active driver status)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Mobile number registered under Ecocash/OneMoney with matching ID</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border border-slate-100 shadow-sm bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-600 bg-amber-500/10 py-1 px-2.5 rounded-full">Dealers & Garages</span>
                        <Building2 className="w-4 h-4 text-slate-400" />
                      </div>
                      <CardTitle className="text-sm font-bold mt-2">Required Commercial Credentials</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-slate-600 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Company Registration Certificate (Form CR6/CR14)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>ZIMRA Tax Clearance Certificate (ITF263)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Physical address verification (Harare, Bulawayo, Mutare, etc.)</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <p className="text-xs text-slate-500 italic">
                  Note: All submitted KYC documentation is securely encrypted using AES-256 standard and parsed in connection with relevant statutory databases.
                </p>
              </div>
            </section>

            {/* Section 3: "No Fake Cars" & Listing Regulations */}
            <section id="listing-regulations" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  3. "No Fake Cars" & Listing Regulations
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  CarUp enforces a strict, zero-tolerance policy against deceptive listings, fraudulent vehicle advertising, and "phantom" or "duplicate" vehicle profiles (colloquially referred to as our **"No Fake Cars Policy"**). 
                </p>
                <p>
                  To list a vehicle for sale on CarUp, private sellers and dealers must abide by the following stringent regulations:
                </p>

                {/* Highlight Grid of Rules */}
                <div className="space-y-4 my-6">
                  {[
                    {
                      title: "Physical Vehicle Possession & VIN Verification",
                      desc: "The seller must be the legal owner of the vehicle or hold a registered Power of Attorney. Every listed vehicle must have its verified Chassis Number / VIN (Vehicle Identification Number) submitted for matching against historical vehicle registry records."
                    },
                    {
                      title: "ZINARA & Insurance Compliance Check",
                      desc: "Any vehicle listed must match ZINARA vehicle licensing and roadworthiness records. Listings with expired ZINARA disks or missing registration plates must be clearly marked 'unlicensed' or 'off-road', or they will be flagged for review."
                    },
                    {
                      title: "No Stock Photos or Deceptive Images",
                      desc: "Sellers must submit real-time, high-fidelity photos of the actual vehicle taken in Zimbabwe. Use of factory stock photos, images downloaded from international sites (e.g., Be Forward, SBT Japan), or watermarked photos from competitor platforms will trigger automatic listing suspension."
                    },
                    {
                      title: "Truthful Pricing Disclosure",
                      desc: "All pricing must be displayed transparently in USD, ZiG, or ZAR. Listings with fake pricing (e.g., '$1' or 'Price on Request' to attract false leads) are prohibited."
                    }
                  ].map((rule, idx) => (
                    <div key={idx} className="flex gap-3 bg-white p-4 border border-slate-100 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                      <div className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-950 text-sm md:text-base">{rule.title}</h4>
                        <p className="text-slate-600 text-xs md:text-sm mt-1">{rule.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Premium Warning Note */}
                <div className="bg-red-50/50 border-l-4 border-red-500 p-5 rounded-r-lg shadow-sm">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-red-900 text-sm md:text-base mb-1">Severe Penalty Clause</h4>
                      <p className="text-red-800 text-xs md:text-sm leading-relaxed">
                        Violators of the "No Fake Cars" policy will have their accounts immediately blacklisted. Commercial dealers will face forfeiture of their monthly subscription balance, and details will be forwarded to the relevant authorities for investigation under the Criminal Law (Codification and Reform) Act of Zimbabwe.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 4: Commission & Transaction Fees */}
            <section id="fees-commissions" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <Coins className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  4. Commission & Transaction Fees
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  To support high-quality vehicle verification, secure hosting, database checks, and continuous support, CarUp implements a transparent commission and fee structure on marketplace sales completed via the Platform.
                </p>

                {/* Detailed Fee Structure Table */}
                <div className="overflow-hidden border border-slate-200/80 rounded-xl shadow-sm my-6 bg-white">
                  <table className="w-full text-left border-collapse text-xs md:text-sm">
                    <thead>
                      <tr className="bg-slate-900 text-white font-semibold">
                        <th className="p-4">Transaction Type</th>
                        <th className="p-4">Applicable Fee</th>
                        <th className="p-4">Verification Check Included</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      <tr>
                        <td className="p-4 font-medium">Private Vehicle Sale (under $10,000)</td>
                        <td className="p-4 text-orange-600 font-semibold">1.5% of final sale value</td>
                        <td className="p-4">Chassis match, digital logbook creation</td>
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="p-4 font-medium">Premium Vehicle Sale ($10,000 to $40,000)</td>
                        <td className="p-4 text-orange-600 font-semibold">1.2% of final sale value</td>
                        <td className="p-4">Full digital logbook, ZINARA verification badge</td>
                      </tr>
                      <tr>
                        <td className="p-4 font-medium">High-End Luxury/Utility Sale (above $40,000)</td>
                        <td className="p-4 text-orange-600 font-semibold">0.9% of final sale value</td>
                        <td className="p-4">VIP listing placement, physical CVR check verification</td>
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="p-4 font-medium">Secure Escrow Protection Fee</td>
                        <td className="p-4 text-slate-900 font-semibold">Flat $25 (buyer split optionally)</td>
                        <td className="p-4">Ensures secure transfer of funds between bank accounts</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-slate-600">
                  Commissions are automatically charged upon confirmation of sale in our dashboard. All outstanding balances must be cleared within seven (7) business days. Unpaid commission balances will result in immediate marketplace suspension and loss of Platform privileges.
                </p>
              </div>
            </section>

            {/* Section 5: Subscriptions (Dealers & Mechanics) */}
            <section id="subscriptions" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <Wrench className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  5. Subscriptions (Dealers & Mechanics)
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  CarUp offers specialized subscription-tier memberships for registered commercial automotive dealers and mechanics/garages, allowing access to enhanced tools, CRM hubs, vehicle telemetry logs, and customer service portals.
                </p>

                <div className="space-y-4 my-6">
                  {/* Dealer Subscription */}
                  <div className="border border-slate-100 p-5 rounded-xl bg-gradient-to-br from-white to-slate-50/50 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-orange-500" />
                        <h4 className="font-bold text-slate-950 text-sm md:text-base">Commercial Dealers Subscription</h4>
                      </div>
                      <Badge className="bg-orange-500 text-white font-medium text-xs">$99/month</Badge>
                    </div>
                    <p className="text-slate-600 text-xs md:text-sm leading-relaxed">
                      Includes advanced inventory management (up to 100 active cars), ZINARA auto-verification integration, customer lead tracking CRM, sales analytics, and dedicated priority support. Billing is run monthly on the anniversary date of sign-up.
                    </p>
                  </div>

                  {/* Mechanic Subscription */}
                  <div className="border border-slate-100 p-5 rounded-xl bg-gradient-to-br from-white to-slate-50/50 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-5 h-5 text-orange-500" />
                        <h4 className="font-bold text-slate-950 text-sm md:text-base">Garages & Mechanics Subscription</h4>
                      </div>
                      <Badge className="bg-amber-500 text-white font-medium text-xs">$49/month</Badge>
                    </div>
                    <p className="text-slate-600 text-xs md:text-sm leading-relaxed">
                      Grants access to the digital service history logging panel, vehicle part-sentry tracker, shared maintenance ledgers, direct customer communication channels, and certified badge markers.
                    </p>
                  </div>
                </div>

                <h4 className="font-bold text-slate-950 text-sm md:text-base">Billing Cycles & Suspension Rules</h4>
                <p>
                  All commercial plans are billed upfront on a recurring monthly or annual basis. Surcharges are computed in USD, payable in accepted currencies at the prevailing market rate. Unpaid subscriptions will enter a ten (10) day grace period. Failure to settle subscriptions within this grace period will result in automated account locking and suspension of inventory search visibility.
                </p>
              </div>
            </section>

            {/* Section 6: Disclaimers & Warranties */}
            <section id="disclaimers" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  6. Disclaimers & Warranties
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  THE CARUP PLATFORM AND ALL AUTOMOTIVE DATA, METRICS, VEHICLE REPORTS, AND OTHER SERVICES ARE PROVIDED ON AN <strong>"AS-IS"</strong> AND <strong>"AS-AVAILABLE"</strong> BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
                </p>
                <p>
                  While our verification protocols run automated checks with registries like ZINARA, CarUp is a technological intermediary. We do not inspect physical vehicles in person, nor do we act as a traditional retail dealership.
                </p>

                {/* Disclaimers List */}
                <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-slate-600">
                  <li>
                    <strong>Third-Party Conduct:</strong> CarUp does not assume responsibility for the actions, errors, or omissions of private sellers, commercial dealers, or automotive mechanics using the platform.
                  </li>
                  <li>
                    <strong>Accuracy of Data:</strong> While we employ advanced AI parsing and state checks, vehicle logs, compliance markers, and diagnostic reports depend on external sources and should not replace a professional mechanic's physical pre-purchase inspection.
                  </li>
                  <li>
                    <strong>Marketplace Disputes:</strong> Any disputes arising from sales, mechanical repairs, or diagnostic errors are strictly between the transacting parties. CarUp is not liable for replacement parts, repair costs, or financial losses stemming from marketplace transactions.
                  </li>
                </ul>
              </div>
            </section>

            {/* Section 7: Governing Law (Zimbabwe) */}
            <section id="governing-law" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <Scale className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  7. Governing Law (Zimbabwe)
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  These Terms of Service and any contractual or non-contractual disputes arising out of your relationship with CarUp are governed by and construed in accordance with the laws of the **Republic of Zimbabwe**.
                </p>
                <p>
                  Any legal actions, suits, or arbitrations relating to the Platform's services or operations must be filed exclusively within the competent courts of Zimbabwe located in **Harare**, and all parties consent to the jurisdiction of such courts.
                </p>

                {/* Local Legal Highlight Card */}
                <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="flex items-center gap-2 mb-3">
                    <Stamp className="w-5 h-5 text-orange-500" />
                    <h4 className="font-bold text-sm md:text-base">Zimbabwean Statutory Compliance</h4>
                  </div>
                  <p className="text-slate-300 text-xs md:text-sm leading-relaxed">
                    CarUp complies fully with the <strong>Consumer Protection Act [Chapter 14:14]</strong> and the <strong>Cyber and Data Protection Act [Chapter 12:07]</strong> of Zimbabwe. Our protocols ensure fair trading practices, security for online transactors, and absolute compliance with digital trade standards.
                  </p>
                </div>
              </div>
            </section>

            {/* Section 8: Compliance & Legal Contacts */}
            <section id="compliance-contact" className="scroll-mt-24 space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-600">
                  <Stamp className="w-6 h-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                  8. Compliance & Legal Contacts
                </h2>
              </div>

              <div className="prose prose-slate max-w-none text-slate-600 space-y-4 text-sm md:text-base leading-relaxed">
                <p>
                  If you have any questions, compliance concerns, or disputes regarding these Terms of Service, or if you need to report suspicious listings, please contact our legal and compliance department directly.
                </p>

                {/* Contact Grid */}
                <div className="grid sm:grid-cols-2 gap-4 my-6">
                  <div className="border border-slate-100 p-4 rounded-lg bg-white shadow-sm flex items-start gap-3">
                    <div className="p-2 bg-orange-500/10 rounded text-orange-600 mt-0.5">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs md:text-sm">Legal & Compliance Dept.</h5>
                      <p className="text-xs text-slate-500 mt-1">CarUp Legal Affairs Office</p>
                      <p className="text-xs text-slate-600 font-medium mt-0.5">legal@carup.co.zw</p>
                    </div>
                  </div>

                  <div className="border border-slate-100 p-4 rounded-lg bg-white shadow-sm flex items-start gap-3">
                    <div className="p-2 bg-orange-500/10 rounded text-orange-600 mt-0.5">
                      <HelpCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs md:text-sm">General Help & Support</h5>
                      <p className="text-xs text-slate-500 mt-1">Available Mon-Fri, 8AM - 5PM</p>
                      <p className="text-xs text-slate-600 font-medium mt-0.5">support@carup.co.zw</p>
                    </div>
                  </div>
                </div>

                <div className="text-center py-6 border-t border-slate-200">
                  <p className="text-xs text-slate-500">
                    CarUp Automotive Intelligence (Pvt) Ltd. Registration Number: 14838/2025. 
                    <br />
                    Harare Head Office: 123 Samora Machel Avenue, Harare, Zimbabwe.
                  </p>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  )
}
