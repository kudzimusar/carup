import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Lock,
  Shield,
  Share2,
  ChevronDown,
  ChevronUp,
  Info,
  Globe,
  Database,
  UserCheck,
  Download,
  Printer,
  ChevronRight,
  AlertCircle,
  Building,
  Check,
  HelpCircle,
  Activity,
  Fingerprint,
  FileSignature
} from 'lucide-react'
import { toast } from 'sonner'

// Collapsible item structure
interface CollapsibleProps {
  title: string
  children: React.ReactNode
  isOpenDefault?: boolean
}

function CollapsibleDeepDive({ title, children, isOpenDefault = false }: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(isOpenDefault)
  return (
    <div className="border border-white/5 bg-[hsl(222,47%,10%)]/50 rounded-lg overflow-hidden transition-all duration-300">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left font-medium text-sm text-gray-200 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-orange-500 shrink-0" />
          {title}
        </span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 pt-0 text-xs md:text-sm text-gray-400 border-t border-white/5 bg-[hsl(222,47%,8%)]/30 leading-relaxed space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

export default function PrivacyPolicy() {
  const [activeSection, setActiveSection] = useState('intro')
  
  // Gutu AI consent toggles state
  const [consents, setConsents] = useState({
    ocrScan: true,
    auditLedger: true,
    insuranceSharing: false,
    bankValuation: false,
    gutuTraining: true
  })

  // Smooth scroll handler
  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const element = document.getElementById(id)
    if (element) {
      const offset = 100 // space for sticky navbar
      const bodyRect = document.body.getBoundingClientRect().top
      const elementRect = element.getBoundingClientRect().top
      const elementPosition = elementRect - bodyRect
      const offsetPosition = elementPosition - offset

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      })
    }
  }

  // Monitor scroll to update active sidebar item
  useEffect(() => {
    const handleScroll = () => {
      const sections = [
        'intro',
        'collect',
        'use',
        'audit-ledger',
        'sharing',
        'rights',
        'retention',
        'consent-console',
        'contact'
      ]

      const scrollPosition = window.scrollY + 150

      for (const section of sections) {
        const el = document.getElementById(section)
        if (el) {
          const top = el.offsetTop
          const height = el.offsetHeight
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Action handlers
  const handleDownload = (format: string) => {
    toast.success(`Download started: CarUp_Privacy_Policy_v2.4.${format}`, {
      description: 'Your document is cryptographically signed for verification.',
      icon: <FileSignature className="w-5 h-5 text-orange-500" />
    })
  }

  const handlePrint = () => {
    toast.info('Preparing document ledger for printing...', {
      description: 'Optimized formatting will be applied.'
    })
    window.print()
  }

  const handleToggleConsent = (key: keyof typeof consents, label: string) => {
    const nextVal = !consents[key]
    setConsents(prev => ({ ...prev, [key]: nextVal }))
    
    if (nextVal) {
      toast.success(`${label} Activated`, {
        description: 'Synchronized with your localized browser cookie and secure trust token.',
        duration: 3000
      })
    } else {
      toast.warning(`${label} Deactivated`, {
        description: 'Some automated features might be restricted. Security verification is unaffected.',
        duration: 3000
      })
    }
  }

  const handleApplyProtocol = () => {
    toast.success('Custom Privacy Protocol Applied Successfully!', {
      description: 'Signed with private key: SHA256-hash...' + Math.random().toString(36).substr(2, 8).toUpperCase(),
      icon: <UserCheck className="w-5 h-5 text-green-500" />
    })
  }

  const sections = [
    { id: 'intro', label: '1. Preamble & Framework', icon: Shield },
    { id: 'collect', label: '2. Information We Collect', icon: Database },
    { id: 'use', label: '3. How We Use Your Data', icon: Activity },
    { id: 'audit-ledger', label: '4. CarUp Audit Ledger', icon: Globe },
    { id: 'sharing', label: '5. Sharing & Third-Parties', icon: Share2 },
    { id: 'rights', label: '6. Your Rights & Controls', icon: Lock },
    { id: 'retention', label: '7. Data Retention & Deletion', icon: Info },
    { id: 'consent-console', label: '8. Gutu AI Consent Console', icon: Fingerprint },
    { id: 'contact', label: '9. Contact & DPO Office', icon: Building }
  ]

  return (
    <div className="min-h-screen bg-[hsl(222,47%,8%)] text-gray-100 selection:bg-orange-500/30 selection:text-orange-200">
      
      {/* Premium Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[hsl(222,47%,6%)] via-[hsl(222,47%,10%)] to-[hsl(222,47%,8%)] pt-16 pb-16 border-b border-white/5">
        {/* Decorative Glowing Lights */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[200px] bg-orange-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-[400px] h-[150px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="section-padding mx-auto max-w-[1440px] relative">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 tracking-wide font-semibold text-xs px-2.5 py-0.5">
                  Decentralized Integrity Protocol
                </Badge>
                <Badge className="bg-white/5 text-gray-300 border border-white/10 text-xs px-2.5 py-0.5">
                  v2.4 (Active)
                </Badge>
              </div>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-none bg-gradient-to-r from-white via-gray-100 to-gray-400 bg-clip-text text-transparent">
                Privacy Policy & <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Data Rights Protocol</span>
              </h1>
              <p className="text-sm md:text-base text-gray-400 leading-relaxed max-w-2xl">
                How CarUp manages ownership trust, ledger hashing, and vehicle data under the 
                <span className="text-orange-300 font-semibold"> Cyber Security and Data Protection Act [Chapter 12:07]</span> of Zimbabwe.
              </p>
            </div>
            
            <div className="flex items-center gap-3 shrink-0">
              <Button 
                onClick={() => handleDownload('pdf')}
                variant="outline" 
                className="bg-white/5 border-white/10 hover:bg-white/10 hover:text-white text-gray-300 text-xs h-9 transition-all duration-300 hover:border-orange-500/30 gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Official PDF
              </Button>
              <Button 
                onClick={handlePrint}
                variant="outline" 
                className="bg-white/5 border-white/10 hover:bg-white/10 hover:text-white text-gray-300 text-xs h-9 transition-all duration-300 hover:border-orange-500/30 gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-y-2 gap-x-6 mt-8 text-xs text-gray-500 border-t border-white/5 pt-4">
            <div>
              <span className="text-gray-600">Last Updated:</span> <span className="text-gray-300 font-medium">May 26, 2026</span>
            </div>
            <div>
              <span className="text-gray-600">Jurisdiction:</span> <span className="text-gray-300 font-medium">Republic of Zimbabwe</span>
            </div>
            <div>
              <span className="text-gray-600">Regulator:</span> <span className="text-gray-300 font-medium">POTRAZ (Postal & Telecommunications Authority)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Grid Content */}
      <div className="section-padding mx-auto max-w-[1440px] py-12">
        <div className="grid lg:grid-cols-4 gap-8">
          
          {/* Left Sticky Sidebar Navigation */}
          <aside className="lg:col-span-1 lg:block hidden">
            <div className="sticky top-28 space-y-6">
              <Card className="bg-[hsl(222,47%,11%)] border-white/5 shadow-2xl overflow-hidden shadow-orange-500/2">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs uppercase tracking-widest text-gray-500 font-bold">
                    Table of Contents
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {sections.map((sec) => {
                    const Icon = sec.icon
                    const isActive = activeSection === sec.id
                    return (
                      <button
                        key={sec.id}
                        onClick={() => scrollToSection(sec.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold rounded-md transition-all duration-300 group relative ${
                          isActive 
                            ? 'text-orange-400 bg-orange-500/10' 
                            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        }`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-orange-500 rounded-r" />
                        )}
                        <Icon className={`w-4 h-4 shrink-0 transition-transform duration-300 ${
                          isActive ? 'text-orange-500' : 'text-gray-500 group-hover:text-gray-300'
                        }`} />
                        <span className="truncate">{sec.label}</span>
                        <ChevronRight className={`ml-auto w-3 h-3 transition-transform duration-300 shrink-0 ${
                          isActive ? 'text-orange-500 translate-x-0.5' : 'text-gray-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5'
                        }`} />
                      </button>
                    )
                  })}
                </CardContent>
              </Card>

              {/* Gutu AI Trust Metric Callout */}
              <div className="p-5 rounded-xl bg-gradient-to-br from-[hsl(222,47%,12%)] to-[hsl(222,47%,16%)] border border-white/5 relative overflow-hidden shadow-[0_0_15px_-3px_rgba(249,115,22,0.05)]">
                <div className="absolute -top-10 -right-10 w-24 h-24 bg-orange-500/10 rounded-full blur-xl pointer-events-none" />
                <div className="flex items-center gap-2 text-orange-400 mb-2">
                  <Shield className="w-5 h-5 shrink-0" />
                  <h4 className="font-bold text-xs uppercase tracking-wide">Secure Trust Architecture</h4>
                </div>
                <p className="text-[11px] leading-relaxed text-gray-400 mb-3">
                  Vehicle ownership metadata is hashed cryptographically to verify marketplace authenticity while protecting personal identification fields (PII).
                </p>
                <div className="flex items-center justify-between text-[10px] text-gray-500 border-t border-white/5 pt-2">
                  <span>SSL Encryption</span>
                  <span className="text-orange-400 font-bold">256-BIT</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Scrollable Detailed Content Area */}
          <div className="lg:col-span-3 space-y-12 text-gray-300">
            
            {/* 1. PREAMBLE & JURISDICTION */}
            <section id="intro" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    1. Preamble & Legal Framework
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: INTRO_ZIM_LEG_12_07</p>
                </div>
              </div>
              
              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  Welcome to <span className="text-white font-semibold">CarUp</span> (referred to as "we", "us", or "our"), operated by CarUp Automotive Technologies Ltd. We are committed to establishing a high-trust, fraud-resistant secondary automotive market in the Republic of Zimbabwe by building an intelligent digital repository of vehicle details, history logs, and cryptographic scorecards.
                </p>
                <p>
                  This Privacy Policy details how we collect, store, cryptographically hash, process, and disclose data when you register as a user, register your vehicle chassis details, utilize our specialized <span className="text-orange-400 font-medium">PartSentry system</span>, or consult our <span className="text-orange-400 font-medium">Gutu AI assistant</span>. 
                </p>
                
                {/* High-fidelity Legal Callout */}
                <div className="p-4 rounded-lg bg-orange-500/5 border-l-2 border-orange-500/60 text-gray-300 my-4 shadow-[0_4px_20px_-4px_rgba(249,115,22,0.08)]">
                  <div className="flex gap-2.5 items-start">
                    <Info className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="font-bold text-xs uppercase tracking-wider text-orange-400">Cyber Security and Data Protection Compliance</h5>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        This protocol operates strictly under the regulatory mandates of the <span className="text-gray-200 font-medium">Cyber Security and Data Protection Act [Chapter 12:07]</span> of the Republic of Zimbabwe, overseen by the Postal and Telecommunications Regulatory Authority of Zimbabwe (<span className="text-gray-200 font-medium">POTRAZ</span>) in its capacity as the Data Protection Authority. 
                      </p>
                    </div>
                  </div>
                </div>

                <p>
                  By creating an account, registering a vehicle, or utilising our platforms in Harare, Bulawayo, Mutare, Gweru, or any territory within Zimbabwe, you explicitly authorize the processing of your personal information and public registry records in accordance with this Policy.
                </p>
              </div>

              {/* Collapsible item for introductory context */}
              <CollapsibleDeepDive title="Why does CarUp link vehicle details to national registries?">
                <p>
                  Historically, Zimbabwe’s secondary automotive market has suffered from deep systemic challenges, including double registration, VIN cloning, import tax manipulation, and odometer rollbacks on vehicles imported from Japan, the United Kingdom, or South Africa. 
                </p>
                <p>
                  To eliminate these trust issues, CarUp verifies vehicle data records directly against the Central Vehicle Registry (CVR) and ZINARA databases. This verification does not expose the vehicle owner’s personal residential address or financial information, but ensures that the vehicle itself is legally recognized, physically sound, and free of outstanding government tax liabilities.
                </p>
              </CollapsibleDeepDive>
            </section>

            <Separator className="bg-white/5" />

            {/* 2. INFORMATION WE COLLECT */}
            <section id="collect" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    2. Information We Collect
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: COLLECT_DATA_SCHEMA</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  We collect several categories of information to verify vehicle safety, maintain ledger integrity, and secure transactional marketplace portals. The scope of information depends on your account type (e.g., Car Owner, Licensed Dealer, Registered Garage Mechanic, Financial Bank Officer, or Insurer).
                </p>
                
                {/* Grid of Data Collected Card */}
                <div className="grid md:grid-cols-2 gap-4 my-6">
                  <Card className="bg-[hsl(222,47%,10%)] border-white/5 hover:border-white/10 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs md:text-sm">
                        <UserCheck className="w-4 h-4 text-orange-500 shrink-0" />
                        <span>A. User Identity & KYC Records</span>
                      </div>
                      <ul className="text-xs text-gray-400 list-disc list-inside space-y-1.5 leading-relaxed">
                        <li>Legal name, email, and verified phone number (Econet, NetOne, or Telecel).</li>
                        <li>National Registration Number (National ID) and facial verification selfie.</li>
                        <li>Physical residential address or dealership operational coordinates.</li>
                        <li>Authorized signature logs for transactional approvals.</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-[hsl(222,47%,10%)] border-white/5 hover:border-white/10 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs md:text-sm">
                        <Activity className="w-4 h-4 text-orange-500 shrink-0" />
                        <span>B. Deep Vehicle & Mechanical Data</span>
                      </div>
                      <ul className="text-xs text-gray-400 list-disc list-inside space-y-1.5 leading-relaxed">
                        <li>VIN (Vehicle Identification Number), Chassis, and Engine numbers.</li>
                        <li>License plate logs and historical ZINARA licensing discs.</li>
                        <li>Logbook scans, customs clearance documents, and police verification reports.</li>
                        <li>Mechanic service logs, parts installation timestamps via PartSentry.</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-[hsl(222,47%,10%)] border-white/5 hover:border-white/10 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs md:text-sm">
                        <Lock className="w-4 h-4 text-orange-500 shrink-0" />
                        <span>C. Financial & Subscription Logs</span>
                      </div>
                      <ul className="text-xs text-gray-400 list-disc list-inside space-y-1.5 leading-relaxed">
                        <li>Billing currencies used (USD, ZiG, or South African Rand ZAR).</li>
                        <li>Payments routed via EcoCash, local banking cards, or SWIFT wire logs.</li>
                        <li>Collateral value estimations and bank financing application history.</li>
                        <li>Premium tier billing schedules and active invoices.</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-[hsl(222,47%,10%)] border-white/5 hover:border-white/10 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs md:text-sm">
                        <Globe className="w-4 h-4 text-orange-500 shrink-0" />
                        <span>D. Technical & Assistant Logs</span>
                      </div>
                      <ul className="text-xs text-gray-400 list-disc list-inside space-y-1.5 leading-relaxed">
                        <li>Interactive transcripts with Gutu AI assistant.</li>
                        <li>Device IP address, operating system, and geolocation data.</li>
                        <li>Logbook OCR scanner quality metrics and file upload sizes.</li>
                        <li>Browser user agent patterns and marketplace tracking clicks.</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <CollapsibleDeepDive title="What exactly is extracted from my ZINARA and CVR logbook scans?">
                <p>
                  When you upload a scanned image of your vehicle logbook or licensing disc, Gutu AI utilizes customized Optical Character Recognition (OCR) neural networks to extract the vehicle owner's name, physical address, chassis number, engine number, weight capacity, and historical registration numbers.
                </p>
                <p>
                  We run automated matching sequences between this extracted text and active database records from our official partner feeds (such as vehicle importers and parts registries) to verify that the documentation has not been digitally altered. Once verified, the raw document is stored securely in our encrypted vaults, while the parsed parameters form your vehicle's digital identity.
                </p>
              </CollapsibleDeepDive>
            </section>

            <Separator className="bg-white/5" />

            {/* 3. HOW WE USE YOUR DATA */}
            <section id="use" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    3. How We Use Your Data
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: USE_DATA_INTELLIGENCE</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  CarUp processes your personal information and vehicle records based on strict contractual, legitimate interest, and consent parameters. We never engage in bulk data broking or market personal profiles to third-party ad networks.
                </p>
                
                <h4 className="text-white font-bold text-sm">Key Processing Operational Purposes:</h4>
                <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm">
                  <li>
                    <strong className="text-gray-200">Decentralized Trust Scores:</strong> Calculating and updating our public <span className="text-orange-400">CarUp Trust Score</span> (ranging from 0-100) based on vehicle consistency, verification flags, and complete mileage tracking.
                  </li>
                  <li>
                    <strong className="text-gray-200">PartSentry Life-Cycle Ledgers:</strong> Creating permanent historical logs of every verified spare part installed in your vehicle, protecting your secondary market resale value and warranty parameters.
                  </li>
                  <li>
                    <strong className="text-gray-200">AI-Powered Fraud Mitigation:</strong> Comparing uploaded VIN stamps and chassis sheets against cross-continental shipping records to detect clone vehicles before they are listed on the marketplace.
                  </li>
                  <li>
                    <strong className="text-gray-200">Automatic Document Autofill:</strong> Processing logbook and customs documents through Gutu AI, allowing owners to initialize new vehicle profiles in under 30 seconds.
                  </li>
                  <li>
                    <strong className="text-gray-200">Premium Valuation & Financing:</strong> Providing risk profiles and automated pricing valuations in USD and ZiG for asset financing, ensuring accurate collateral tracking for partner banks in Harare and Bulawayo.
                  </li>
                </ul>
              </div>

              <CollapsibleDeepDive title="How does Gutu AI prevent vehicle identification fraud?">
                <p>
                  Gutu AI parses structural patterns inside chassis prints and logbook security stamps. It performs check-digit mathematical verifications specific to manufacturers (e.g., Toyota, Nissan, Ford, Mercedes-Benz, BMW). 
                </p>
                <p>
                  Additionally, it scans records for historical mileage anomalies (such as an odometer reading 80,000 km in 2024 but 50,000 km in 2026) and generates risk warnings on suspicious profiles. These calculations occur automatically in the background to ensure that active listings represent physical realities.
                </p>
              </CollapsibleDeepDive>
            </section>

            <Separator className="bg-white/5" />

            {/* 4. AUDIT LEDGER & PUBLIC REGISTRY DISCLOSURE */}
            <section id="audit-ledger" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    4. CarUp Audit Ledger Disclosure
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: CARUP_AUDIT_LEDGER</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  CarUp records part and odometer history in a tamper-evident audit ledger that CarUp operates. It is not a distributed ledger and it is not published to any external or public network. What follows is what is committed to that record, and how your personal data stays isolated from it.
                </p>

                {/* Audit-ledger detail. CarUp operates this record internally. */}
                <div className="bg-[hsl(222,47%,10%)] border border-white/5 rounded-xl overflow-hidden my-6">
                  <div className="bg-gradient-to-r from-orange-500/20 to-amber-500/10 p-4 border-b border-white/5 flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wide text-orange-400 flex items-center gap-1.5">
                      <Fingerprint className="w-4 h-4 shrink-0" />
                      Audit-Ledger Partitioning
                    </span>
                    <span className="text-[10px] text-orange-300 font-mono">SHA-256 SECURED</span>
                  </div>
                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">
                    <div className="p-5 space-y-3">
                      <h5 className="font-semibold text-xs text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 shrink-0" /> Marketplace-Visible Record (Hashed, Append-Only)
                      </h5>
                      <ul className="text-xs text-gray-400 space-y-2 list-none">
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span>Vehicle VIN, Chassis, and Engine ID structure.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span>Verified Odometer readings and timestamps.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span>PartSentry mechanical installations and structural upgrades.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span>Overall CarUp Trust Score history card.</span>
                        </li>
                      </ul>
                    </div>
                    <div className="p-5 space-y-3">
                      <h5 className="font-semibold text-xs text-rose-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Private Database (Encrypted Offline)
                      </h5>
                      <ul className="text-xs text-gray-400 space-y-2 list-none">
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                          <span className="text-gray-300 font-medium">Names, National IDs, and physical addresses.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                          <span>Customer phone numbers and email channels.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                          <span>EcoCash numbers, bank accounts, and specific pricing tokens.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                          <span>Individual communication logs with Gutu AI.</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <p>
                  This cryptographic design guarantees that while anyone in the marketplace can audit the full, unbroken history of a Mercedes-Benz C200 or Toyota Hilux before completing a transaction, they can never discover the owner's personal identity or identity history unless you explicitly choose to authorize that share request.
                </p>
              </div>

              <CollapsibleDeepDive title="Can I delete my vehicle's past service history from the CarUp audit ledger?">
                <p>
                  No. Due to the append-only, tamper-evident architecture of the CarUp audit ledger, mechanical logs and odometer metrics verified under the PartSentry framework cannot be deleted or altered once they are finalized.
                </p>
                <p>
                  This is necessary to protect subsequent buyers of the vehicle against historical fraud and mileage tampering. This policy perfectly aligns with the Cyber Security and Data Protection Act [Chapter 12:07], which allows for data retention limits to be bypassed when processing is strictly required for historical preservation, market safety, and the prevention of fraud in public commercial transactions.
                </p>
              </CollapsibleDeepDive>
            </section>

            <Separator className="bg-white/5" />

            {/* 5. SHARING DATA WITH PARTNERS */}
            <section id="sharing" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    5. Sharing Data with Partners
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: PARTNER_DATA_ROUTING</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  We facilitate integrated exchanges between key stakeholders in the Zimbabwean automotive ecosystem. We only initiate exchanges with partner networks under strict user-controlled authorization, except in legal verification cases.
                </p>
                
                <div className="space-y-4 my-6">
                  {[
                    {
                      partner: "Verified Auto Dealers & Showrooms",
                      purpose: "When you list your car for sale, we share verified vehicle history dossiers, Trust Scores, and odometer audits to speed up listings. Your phone number is only shared when buyers make verified bids.",
                      tag: "Marketplace Integration"
                    },
                    {
                      partner: "Registered Garages & Mechanics",
                      purpose: "Mechanics can check your active PartSentry engine details and structural profiles. Upon servicing, they commit part changes and service stamps back to your digital profile.",
                      tag: "Service Lifecycle"
                    },
                    {
                      partner: "Verified Insurance Underwriters (e.g., Old Mutual, Zimnat, NicozDiamond)",
                      purpose: "If you apply for auto coverage, we share verified trust and mechanical ratings to help you unlock premium discount rates. We never share driving metrics or route tracking data without explicit opt-in.",
                      tag: "Underwriting & Risk"
                    },
                    {
                      partner: "Asset Financing Banks (e.g., CBZ, CABS, Stanbic Bank)",
                      purpose: "When you apply for a collateralized vehicle loan, we share verified valuation certificates in USD/ZiG directly to the bank's processing system to secure quick processing.",
                      tag: "Financing Valuations"
                    }
                  ].map((p, index) => (
                    <div key={index} className="flex gap-4 p-4 rounded-xl bg-[hsl(222,47%,10%)] border border-white/5 hover:border-white/10 transition-colors">
                      <Building className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-xs md:text-sm text-white">{p.partner}</span>
                          <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[9px] font-mono px-1.5">
                            {p.tag}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">{p.purpose}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <Separator className="bg-white/5" />

            {/* 6. YOUR RIGHTS */}
            <section id="rights" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    6. Your Rights & Data Controls
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: USER_RIGHTS_REGULATORY</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  Under Part IV of the Cyber Security and Data Protection Act [Chapter 12:07] of Zimbabwe, you hold explicit rights as a data subject. CarUp provides comprehensive controls to exercise these rights through your profile settings panel.
                </p>

                <div className="grid sm:grid-cols-2 gap-4 my-6">
                  {[
                    {
                      right: "Right of Access & Portability",
                      desc: "You can request a complete, structured export of all personal data, logbook uploads, and historical activities associated with your profile at any time."
                    },
                    {
                      right: "Right to Rectification",
                      desc: "If you detect an inaccuracy in your legal name, contact channel, or vehicle registration chassis details, you can submit an update request along with verified registry documents."
                    },
                    {
                      right: "Right to Restriction of Processing",
                      desc: "You have the power to suspend data sharing with partner insurers, banking dashboards, or public marketplaces, keeping your asset profile strictly private."
                    },
                    {
                      right: "Right to Object & Revoke Consent",
                      desc: "You can modify your consent settings instantly via our integrated Gutu AI Consent Console to opt out of non-essential AI scans or automated notifications."
                    }
                  ].map((r, i) => (
                    <div key={i} className="p-4 rounded-xl border border-white/5 bg-[hsl(222,47%,10%)] hover:border-orange-500/20 transition-all duration-300">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        <span className="font-bold text-xs md:text-sm text-white">{r.right}</span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <CollapsibleDeepDive title="How do I request a complete dump of my vehicle dossier data?">
                <p>
                  To export your vehicle data, navigate to your Owner Dashboard, select "Security Settings" and click "Request Data Dossier". Gutu AI will compile a password-protected zip file containing your complete personal details, ZINARA logs, mechanics work history, and CarUp audit ledger entries.
                </p>
                <p>
                  This report is issued in both human-readable PDF format and machine-readable JSON format, enabling effortless data portability under POTRAZ regulatory guidelines.
                </p>
              </CollapsibleDeepDive>
            </section>

            <Separator className="bg-white/5" />

            {/* 7. DATA RETENTION & DELETION */}
            <section id="retention" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    7. Data Retention & Deletion
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: RETENTION_LEDGER_ARCHIVAL</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  We store your personal details for as long as your CarUp profile is active. If you initiate a profile deletion request, we immediately run automated secure-erase cycles on all personal identifiers (PII) like names, email channels, and phone numbers.
                </p>
                <p>
                  However, please be informed that <span className="text-orange-400 font-semibold">vehicle-specific hardware ledgers</span> (including VIN, chassis numbers, historical odometer metrics, and mechanic work orders committed via PartSentry) are retained indefinitely. These parameters represent public safety information that must remain accessible to prevent commercial fraud, vehicle cloning, and secondary market manipulation in Zimbabwe.
                </p>
                <p>
                  In the event of profile deletion, the historical records of your vehicles are permanently disconnected from your name or contact details, leaving an anonymous, unlinked technical logbook that subsequent buyers can audit safely.
                </p>
              </div>
            </section>

            <Separator className="bg-white/5" />

            {/* 8. INTERACTIVE GUTU AI CONSENT CONSOLE */}
            <section id="consent-console" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    8. Gutu AI Privacy Consent Console
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: GUTU_AI_CONSENT_DASHBOARD</p>
                </div>
              </div>

              <p className="text-xs md:text-sm text-gray-400 leading-relaxed">
                Take control of your data flow in real-time. Use the control dials below to specify what data parameters you permit Gutu AI and our integrated APIs to process. Toggling these settings immediately updates your system credentials.
              </p>

              {/* Console Dashboard Card */}
              <Card className="bg-gradient-to-br from-[hsl(222,47%,10%)] to-[hsl(222,47%,14%)] border-white/5 shadow-2xl relative overflow-hidden shadow-orange-500/2">
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl pointer-events-none" />
                
                <CardHeader className="border-b border-white/5 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-orange-500 shrink-0" />
                        Interactive Protocol Configurations
                      </CardTitle>
                      <CardDescription className="text-[11px] text-gray-500 mt-1">
                        Configure customized permissions and watch changes synchronize on the secure platform client.
                      </CardDescription>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold tracking-wide shrink-0">
                      Live Sandbox
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="p-5 space-y-6">
                  
                  {/* Option 1 */}
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1">
                      <label className="text-xs md:text-sm font-semibold text-gray-200 block">
                        Gutu AI Automated OCR Extraction
                      </label>
                      <span className="text-[11px] text-gray-500 leading-relaxed block max-w-xl">
                        Allows Gutu AI to automatically scan and parse details from uploaded ZINARA disc images, import bills, and police clearances to build profile registries in seconds.
                      </span>
                    </div>
                    <Switch 
                      checked={consents.ocrScan}
                      onCheckedChange={() => handleToggleConsent('ocrScan', 'Gutu AI OCR Scanning')}
                    />
                  </div>
                  
                  <Separator className="bg-white/5" />

                  {/* Option 2 */}
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1">
                      <label className="text-xs md:text-sm font-semibold text-gray-200 block">
                        PartSentry Audit-Ledger Hashing
                      </label>
                      <span className="text-[11px] text-gray-500 leading-relaxed block max-w-xl">
                        Allows historical part updates and odometer metrics to be recorded as tamper-evident hashes in the CarUp audit ledger — an internal, CarUp-operated record, not an external or public network. Disabling this removes real-time marketplace trust verification flags.
                      </span>
                    </div>
                    <Switch
                      checked={consents.auditLedger}
                      onCheckedChange={() => handleToggleConsent('auditLedger', 'PartSentry Audit Ledger')}
                    />
                  </div>

                  <Separator className="bg-white/5" />

                  {/* Option 3 */}
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1">
                      <label className="text-xs md:text-sm font-semibold text-gray-200 block">
                        Verified Insurer Instant Claim Sync
                      </label>
                      <span className="text-[11px] text-gray-500 leading-relaxed block max-w-xl">
                        Allows partnered insurance brokers (e.g., Zimnat, NicozDiamond) to instantly query mechanical audit dossiers to accelerate your accident claims processing.
                      </span>
                    </div>
                    <Switch 
                      checked={consents.insuranceSharing}
                      onCheckedChange={() => handleToggleConsent('insuranceSharing', 'Insurance Dossier Syncing')}
                    />
                  </div>

                  <Separator className="bg-white/5" />

                  {/* Option 4 */}
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1">
                      <label className="text-xs md:text-sm font-semibold text-gray-200 block">
                        Auto-Bank Collateral Valuations
                      </label>
                      <span className="text-[11px] text-gray-500 leading-relaxed block max-w-xl">
                        Allows authorized financing institutions (e.g., CBZ, CABS) to execute background pricing algorithm queries against your vehicle profile for swift credit scoring.
                      </span>
                    </div>
                    <Switch 
                      checked={consents.bankValuation}
                      onCheckedChange={() => handleToggleConsent('bankValuation', 'Automated Bank Valuation Syncing')}
                    />
                  </div>

                  <Separator className="bg-white/5" />

                  {/* Option 5 */}
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1">
                      <label className="text-xs md:text-sm font-semibold text-gray-200 block">
                        Gutu AI Contextual Model Tuning
                      </label>
                      <span className="text-[11px] text-gray-500 leading-relaxed block max-w-xl">
                        Allows Gutu AI to parse anonymous vehicle logs to improve predictive maintenance algorithms and market price estimates for Zimbabwean car buyers.
                      </span>
                    </div>
                    <Switch 
                      checked={consents.gutuTraining}
                      onCheckedChange={() => handleToggleConsent('gutuTraining', 'Gutu AI Training Context')}
                    />
                  </div>

                  {/* Bottom apply panel */}
                  <div className="pt-4 border-t border-white/5 flex items-center justify-between flex-wrap gap-4">
                    <div className="text-[10px] text-gray-500 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                      Changes are securely committed and encrypted locally on client browser cache.
                    </div>
                    <Button 
                      onClick={handleApplyProtocol}
                      size="sm"
                      className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold px-4 py-2 rounded-lg text-xs transition-all duration-300 hover:shadow-orange-500/10 hover:shadow-lg hover:-translate-y-0.5 gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Apply Custom Protocol
                    </Button>
                  </div>

                </CardContent>
              </Card>
            </section>

            <Separator className="bg-white/5" />

            {/* 9. CONTACT & DPO */}
            <section id="contact" className="scroll-mt-28 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <Building className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                    9. Contact & Data Protection Officer Office
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">SECTION_ID: DPO_CONTACT_CHANNELS</p>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-xs md:text-sm text-gray-400 leading-relaxed space-y-4">
                <p>
                  If you have queries regarding this Privacy Policy, your rights under the Cyber Security and Data Protection Act [Chapter 12:07], or wish to submit verified corrections to vehicle registers, contact our designated Data Protection Officer (DPO) at our regional Harare headquarters:
                </p>

                {/* DPO Information Card Grid */}
                <div className="grid md:grid-cols-3 gap-4 my-6">
                  <Card className="bg-[hsl(222,47%,10%)] border-white/5">
                    <CardContent className="p-4 space-y-1.5 text-center">
                      <Building className="w-5 h-5 text-orange-500 mx-auto" />
                      <h6 className="font-bold text-xs text-white">Physical Headquarters</h6>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        CarUp Technologies Ltd<br />
                        123 Samora Machel Ave<br />
                        Harare, Zimbabwe
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-[hsl(222,47%,10%)] border-white/5">
                    <CardContent className="p-4 space-y-1.5 text-center">
                      <Lock className="w-5 h-5 text-orange-500 mx-auto" />
                      <h6 className="font-bold text-xs text-white">Direct DPO Dispatch</h6>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        dpo@carup.co.zw<br />
                        legal@carup.co.zw<br />
                        Response within 48 hrs
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-[hsl(222,47%,10%)] border-white/5">
                    <CardContent className="p-4 space-y-1.5 text-center">
                      <Activity className="w-5 h-5 text-orange-500 mx-auto" />
                      <h6 className="font-bold text-xs text-white">Telephone Support</h6>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        +263 242 700 000<br />
                        +263 773 345 678<br />
                        Mon-Fri: 8AM - 5PM
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <p className="text-xs text-gray-500">
                  You also maintain the legal right to file direct complaints regarding data handling violations to the Postal and Telecommunications Regulatory Authority of Zimbabwe (POTRAZ) at their national offices: 1008 Performance Plaza, Samora Machel Ave, Harare, Zimbabwe.
                </p>
              </div>
            </section>
            
          </div>
        </div>
      </div>
      
    </div>
  )
}
