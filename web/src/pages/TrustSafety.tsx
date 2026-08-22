import { useState, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  ShieldAlert,
  CheckCircle,
  Cpu,
  FileCheck,
  UserCheck,
  Coins,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Upload,
  X,
  ShieldCheck,
  Send,
  Building,
  Clock,
  ArrowRight,
  Sparkles,
  HelpCircle
} from 'lucide-react'

// Mock verification stages specific to Zimbabwe
const verificationStages = [
  {
    step: '01',
    title: 'ZINARA & CVR Registry Check',
    description: 'We perform a real-time digital sync with the Central Vehicle Registry (CVR) and Zimbabwe National Road Administration (ZINARA). This confirms the chassis number/VIN authenticity, licensing compliance, and validates that duty was legally cleared at ports of entry like Beitbridge or Mutare.',
    details: ['Chassis & VIN Validation', 'Import Duty Clearance Status', 'ZRP Stolen Vehicle Registry Cross-Reference', 'Licensing Validity Analysis']
  },
  {
    step: '02',
    title: 'Physical 150-Point Inspection',
    description: 'Conducted at CarUp Hubs or certified partner garages across Harare, Bulawayo, Mutare, and Gweru. Our master mechanics conduct rigorous diagnostics on the powertrain, structural integrity, hybrid batteries, suspension, and vehicle electricals.',
    details: ['Engine & Transmission Diagnostics', 'Under-carriage & Suspension Check', 'Electrical Grid & ECU Health Audit', 'Road Test Performance Validation']
  },
  {
    step: '03',
    title: 'Odometer Integrity Verification',
    description: 'Odometer fraud is highly prevalent in imported second-hand Japanese and UK vehicles. We deploy proprietary ECU scanner technology to read historical mileage records directly from internal modules (ABS, transmission, key fobs) to detect odometer rollbacks.',
    details: ['Proprietary ECU Log Extraction', 'Historical Import Mileage Syncing', 'Wear-and-Tear Consistency Check', 'Mileage Discrepancy Flagging']
  },
  {
    step: '04',
    title: 'Title Deed & Logbook Forensic Audit',
    description: 'Our legal desk verifies the original vehicle logbook (title deed) for tampering, scans Customs Clearance Certificates (CCC), and cross-references original ID credentials of the registered owner to eliminate double-selling schemes.',
    details: ['Original Logbook Forensic Scan', 'Owner National ID Verification', 'Customs Clearance Certificate Audit', 'Police Clearance Verification (ZRP Form 94)']
  },
  {
    step: '05',
    title: 'Cryptographic CarUp Trust Score',
    description: 'Once passed, all verification reports are hashed and stored securely. The car is issued a digital CarUp Trust Certificate and an AI-calculated Trust Score (ranging from 1 to 10) displayed publically to premium buyers.',
    details: ['Immutable Certificate Hash', 'Dynamic AI Trust Score Generation', 'Verified Marketplace Badge', 'Lifetime Digital Car Profile Registry']
  }
]

// Safe Trading Guidelines
const buyerGuidelines = [
  {
    title: 'Insist on a CarUp Verification Report',
    desc: 'Never buy a car without requesting its digital CarUp Trust Certificate. A verified vehicle has undergone rigorous checks for odometer tampering, registration validity, and structural integrity.'
  },
  {
    title: 'Always Conduct Inspections at Designated Hubs',
    desc: 'Never meet sellers in isolated or unfamiliar areas. Conduct physical meetups and test drives at CarUp hubs, ZRP stations, or verified partner garages in Harare or Bulawayo.'
  },
  {
    title: 'Verify ZRP Form 94 and Logbook Authenticity',
    desc: 'Ensure the seller provides a recent Zimbabwe Republic Police (ZRP) clearance certificate (Form 94) alongside a verified original logbook that matches their National Registration Card.'
  },
  {
    title: 'Avoid Cash Handouts Before Title Transfer',
    desc: 'Avoid paying large cash deposits or full amounts upfront prior to confirming physical title transfer at the CVR offices or through CarUp Safe Escrow Services.'
  }
]

const sellerGuidelines = [
  {
    title: 'Obtain the "CarUp Verified" Seller Status',
    desc: 'Vehicles listed with a "CarUp Verified" badge receive 4x more engagement and sell within an average of 48 hours because buyers are confident in the absolute integrity of your listing.'
  },
  {
    title: 'Accept Bank Transfers or CarUp Escrow Only',
    desc: 'Do not accept suspicious personal checks or third-party bank slips. Always wait for actual clearance in your bank account (RTGS/ZiG or USD FCA) before releasing the keys and original logbook.'
  },
  {
    title: 'Conduct Test Drives Safely',
    desc: 'Always verify the prospective buyer\'s driver\'s license and identity on CarUp before organizing a test drive. Have a third party or a CarUp representative accompany you during the test drive.'
  },
  {
    title: 'Maintain Transcripts & Communication on CarUp',
    desc: 'Keep all negotiations, agreements, and payment records inside the CarUp messaging ecosystem. This provides legally binding evidence in case of contract or transaction disputes.'
  }
]

// FAQs
const faqsList = [
  {
    question: 'How does CarUp verify vehicle import and duty clearance in Zimbabwe?',
    answer: 'We cross-reference every imported vehicle VIN with records from the Zimbabwe Revenue Authority (ZIMRA) and Central Vehicle Registry (CVR). This confirms if the vehicle was cleared under a personal allowance, civil service scheme, or standard commercial duties, ensuring you do not inherit outstanding import liabilities.'
  },
  {
    question: 'What happens if a vehicle fails the Odometer Integrity Check?',
    answer: 'If our proprietary ECU diagnostics reveal an odometer discrepancy (e.g. rolled back from 180,000km to 60,000km), the vehicle is permanently flagged in our registry. The owner is notified and the vehicle cannot be listed with a "Verified Badge" on the marketplace.'
  },
  {
    question: 'How does the Report Sentry program work?',
    answer: 'If you encounter any suspicious activity, a pricing anomaly, or suspect a listing is fraudulent, you can report it instantly. Our local team in Harare immediately reviews the flag, freezes the listing if necessary, and coordinates with ZRP CID Vehicle Theft Squad if a stolen vehicle indicator is detected.'
  },
  {
    question: 'What currencies are accepted in the Safe Escrow program?',
    answer: 'CarUp supports secure transaction settlement in both US Dollars (USD) and Zimbabwe Gold (ZiG) through our regulated banking partners. Funds are held securely in escrow until both parties sign the digital transfer authorization.'
  },
  {
    question: 'Is my personal information secure when reporting a listing?',
    answer: 'Yes, absolutely. All reports submitted to our Trust & Safety Sentry are handled with absolute confidentiality. Your identity is never shared with the reported user or dealer, and is only accessed by our credentialed security officers.'
  }
]

export default function TrustSafety() {
  const [activeTab, setActiveTab] = useState<'buyer' | 'seller'>('buyer')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [activeVerificationStep, setActiveVerificationStep] = useState<number>(0)
  
  // Form States
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')
  const [reporterPhone, setReporterPhone] = useState('')
  const [targetType, setTargetType] = useState('listing')
  const [listingId, setListingId] = useState('')
  const [dealerName, setDealerName] = useState('')
  const [issueType, setIssueType] = useState('odometer')
  const [description, setDescription] = useState('')
  
  // Simulated File Upload
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [ticketNumber, setTicketNumber] = useState('')

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files).map(file => ({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      }))
      setAttachedFiles(prev => [...prev, ...filesArray])
      toast.success('Evidence file(s) attached successfully!')
    }
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!reporterName || !reporterEmail || !description) {
      toast.error('Please fill in all required fields.')
      return
    }

    setIsSubmitting(true)

    // Simulate API request to Gutu AI / Trust Team
    setTimeout(() => {
      setIsSubmitting(false)
      setIsSuccess(true)
      const randomTicket = 'TK-ZIM-' + Math.floor(100000 + Math.random() * 900000)
      setTicketNumber(randomTicket)
      toast.success('Report submitted successfully! Security ticket generated.')
    }, 1500)
  }

  const resetForm = () => {
    setReporterName('')
    setReporterEmail('')
    setReporterPhone('')
    setTargetType('listing')
    setListingId('')
    setDealerName('')
    setIssueType('odometer')
    setDescription('')
    setAttachedFiles([])
    setIsSuccess(false)
  }

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index)
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,8%)] text-white overflow-hidden selection:bg-orange-500 selection:text-white">
      {/* Decorative Glow Elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[150px] pointer-events-none" />
      
      {/* HERO SECTION */}
      <section className="relative border-b border-[hsl(222,47%,14%)] bg-gradient-to-br from-[hsl(222,47%,6%)] via-[hsl(222,47%,10%)] to-[hsl(222,30%,14%)] py-24 px-4 md:px-8">
        <div className="max-w-[1440px] mx-auto text-center relative z-10">
          <Badge className="mb-6 bg-orange-500/10 text-orange-400 border border-orange-500/20 px-4 py-1.5 text-xs font-semibold hover:bg-orange-500/20 transition-all duration-300">
            🛡️ SECURE ECOSYSTEM
          </Badge>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6 max-w-5xl mx-auto">
            Zimbabwe's Safest{' '}
            <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent drop-shadow-[0_2px_15px_rgba(249,115,22,0.2)]">
              Automotive Intelligence
            </span>{' '}
            Platform
          </h1>
          <p className="text-gray-300 text-lg md:text-xl max-w-3xl mx-auto mb-10 leading-relaxed font-light">
            We integrate advanced machine learning, CVR registry synchronization, odometer physical diagnostics, 
            and cryptographic ledger histories to bring absolute transparency and integrity to the Zimbabwean vehicle market.
          </p>

          {/* Glowing Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-5xl mx-auto mt-16 pt-10 border-t border-[hsl(222,47%,16%)]">
            {[
              { value: '10,000+', label: 'Verified Odomoteres', desc: 'Japanese & UK imports audited' },
              { value: '99.8%', label: 'Fraud Detection Rate', desc: 'Pre-listing checks caught early' },
              { value: '100%', label: 'ZINARA & CVR Sync', desc: 'Duty & ownership validated' },
              { value: '850+', label: 'Vetted Dealerships', desc: 'Harare & Bulawayo approved' }
            ].map((stat, idx) => (
              <div key={idx} className="bg-[hsl(222,47%,11%)]/50 backdrop-blur-md rounded-2xl p-5 border border-[hsl(222,47%,16%)] hover:border-orange-500/25 transition-all duration-300 hover:shadow-[0_0_15px_rgba(249,115,22,0.08)] text-center group">
                <p className="text-2xl md:text-3xl font-extrabold text-orange-400 group-hover:scale-105 transition-transform duration-300">{stat.value}</p>
                <p className="text-sm font-semibold text-white mt-1">{stat.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{stat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CORE PILLARS SECTION */}
      <section className="py-24 px-4 md:px-8 max-w-[1440px] mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge className="mb-4 bg-orange-500/10 text-orange-400 border border-orange-500/20">SECURITY PILLARS</Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Our Four Pillars of Immutable Security</h2>
          <p className="text-gray-400 mt-3 font-light">Engineered to eliminate car fraud, dual-selling, and mechanical tampering across Zimbabwe.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: ShieldCheck,
              title: 'Audit Ledger Verification',
              desc: 'Every vehicle registered gets an immutable digital identity ledger. All legal ownership transactions, ZIMRA tax status, and structural repairs are hashed onto the ledger to prevent document falsification.',
              color: 'from-orange-500/20 to-amber-500/20',
              badge: 'Tamper-Proof'
            },
            {
              icon: UserCheck,
              title: 'Mandatory KYC & Vetting',
              desc: 'Every dealer and individual seller undergoes rigorous National ID, biometric, and physical site verification prior to listing. We eliminate ghost sellers and phantom vehicle listings.',
              color: 'from-blue-500/20 to-indigo-500/20',
              badge: '100% Identity Check'
            },
            {
              icon: Cpu,
              title: 'Gutu AI Fraud Sentry',
              desc: 'Our neural networks scan listing descriptions, analyze listing location profiles, inspect pricing patterns against real-world valuations, and conduct reverse-image audits to catch fraud before it goes live.',
              color: 'from-purple-500/20 to-pink-500/20',
              badge: 'Real-time AI Guard'
            },
            {
              icon: Coins,
              title: 'Secure Escrow Settle',
              desc: 'Transact with absolute trust in USD or ZiG. Buying funds are safely held in a regulated trust account until both parties complete the physical transfer of the vehicle and clear titles at the CVR offices.',
              color: 'from-emerald-500/20 to-teal-500/20',
              badge: 'Regulated Escrow'
            }
          ].map((pillar, idx) => (
            <Card key={idx} className="bg-[hsl(222,47%,11%)] border-[hsl(222,47%,18%)] text-white hover:border-orange-500/40 transition-all duration-500 group flex flex-col justify-between hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(249,115,22,0.1)]">
              <CardHeader className="relative">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${pillar.color} flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 shadow-lg`}>
                  <pillar.icon className="w-6 h-6 text-orange-400" />
                </div>
                <Badge className="absolute top-6 right-6 bg-white/5 border border-white/10 text-gray-400 group-hover:border-orange-500/30 group-hover:text-orange-300 transition-colors">
                  {pillar.badge}
                </Badge>
                <CardTitle className="text-xl font-bold tracking-tight mt-2">{pillar.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-gray-400 text-sm leading-relaxed font-light">
                {pillar.desc}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* STEP-BY-STEP VERIFICATION PROCESS */}
      <section className="py-24 bg-gradient-to-b from-[hsl(222,47%,8%)] to-[hsl(222,47%,12%)] border-t border-b border-[hsl(222,47%,15%)] px-4 md:px-8">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge className="mb-4 bg-amber-500/10 text-amber-400 border border-amber-500/20">AUDITING STANDARDS</Badge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Our 5-Stage Vehicle Verification Rigour</h2>
            <p className="text-gray-400 mt-3 font-light">How we construct an absolute shield of truth for every vehicle sold on CarUp.</p>
          </div>

          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* Steps Left List */}
            <div className="lg:col-span-5 space-y-4">
              {verificationStages.map((stage, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveVerificationStep(idx)}
                  className={`cursor-pointer rounded-2xl p-5 border transition-all duration-300 flex items-center gap-4 ${
                    activeVerificationStep === idx
                      ? 'bg-[hsl(222,47%,14%)] border-orange-500/60 shadow-[0_0_15px_rgba(249,115,22,0.12)]'
                      : 'bg-[hsl(222,47%,10%)] border-[hsl(222,47%,18%)] hover:border-white/10'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0 transition-colors ${
                    activeVerificationStep === idx ? 'bg-orange-500 text-white shadow-md' : 'bg-white/5 text-gray-400'
                  }`}>
                    {stage.step}
                  </div>
                  <div className="text-left">
                    <h3 className={`font-semibold text-base transition-colors ${activeVerificationStep === idx ? 'text-orange-400 font-bold' : 'text-white'}`}>
                      {stage.title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {stage.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Display Detail Right Card */}
            <div className="lg:col-span-7">
              <Card className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white p-8 relative overflow-hidden shadow-2xl h-full flex flex-col justify-between">
                <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-orange-500/10 to-transparent rounded-full blur-2xl" />
                
                <div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
                    <div className="flex items-center gap-3">
                      <span className="text-5xl font-extrabold text-orange-500/20">{verificationStages[activeVerificationStep].step}</span>
                      <div>
                        <h3 className="text-2xl font-bold tracking-tight text-white">{verificationStages[activeVerificationStep].title}</h3>
                        <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 mt-1">Active Verification Protocol</Badge>
                      </div>
                    </div>
                  </div>

                  <p className="text-gray-300 text-base leading-relaxed mb-8 font-light">
                    {verificationStages[activeVerificationStep].description}
                  </p>

                  <div>
                    <h4 className="text-sm font-semibold uppercase text-orange-400 mb-4 tracking-wider flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-orange-400" />
                      Detailed Inspection Checks:
                    </h4>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {verificationStages[activeVerificationStep].details.map((detail, idx) => (
                        <div key={idx} className="flex items-center gap-2.5 bg-[hsl(222,47%,9%)] p-3 rounded-xl border border-[hsl(222,47%,16%)] hover:border-orange-500/35 transition-colors">
                          <div className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                          <span className="text-sm text-gray-300 font-light">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5" /> Partners: CVR, ZINARA, ZRP VTS, ZIMRA
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Average Audit Time: 2-4 Hours
                  </span>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* SAFE TRADING GUIDELINES */}
      <section className="py-24 px-4 md:px-8 max-w-[1440px] mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge className="mb-4 bg-orange-500/10 text-orange-400 border border-orange-500/20">GUIDES & PROTOCOLS</Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Safe Trading Rules & Best Practices</h2>
          <p className="text-gray-400 mt-3 font-light">Whether you are purchasing a family sedan in Harare or selling a utility truck in Bulawayo, follow these mandatory secure transaction steps.</p>
        </div>

        {/* Custom Guidelines Switcher */}
        <div className="flex justify-center mb-12">
          <div className="bg-[hsl(222,47%,11%)] p-1.5 rounded-xl border border-[hsl(222,47%,16%)] inline-flex gap-2">
            <Button
              onClick={() => setActiveTab('buyer')}
              className={`rounded-lg px-6 py-2 transition-all font-semibold ${
                activeTab === 'buyer'
                  ? 'bg-orange-500 text-white shadow-lg'
                  : 'bg-transparent text-gray-400 hover:text-white'
              }`}
            >
              🛡️ Buyer Safety Guide
            </Button>
            <Button
              onClick={() => setActiveTab('seller')}
              className={`rounded-lg px-6 py-2 transition-all font-semibold ${
                activeTab === 'seller'
                  ? 'bg-orange-500 text-white shadow-lg'
                  : 'bg-transparent text-gray-400 hover:text-white'
              }`}
            >
              💼 Seller Safety Guide
            </Button>
          </div>
        </div>

        {/* Guidelines Grid */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {(activeTab === 'buyer' ? buyerGuidelines : sellerGuidelines).map((item, idx) => (
            <Card key={idx} className="bg-[hsl(222,47%)] border-[hsl(222,47%,18%)] bg-[hsl(222,47%,11%)] text-white hover:border-orange-500/30 transition-all duration-300 shadow-lg relative group">
              <div className="absolute top-6 left-6 w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center font-bold text-orange-400 text-sm group-hover:bg-orange-500 group-hover:text-white transition-colors duration-300">
                {idx + 1}
              </div>
              <CardHeader className="pl-16">
                <CardTitle className="text-lg font-bold tracking-tight text-white group-hover:text-orange-400 transition-colors">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="pl-16 text-sm text-gray-400 leading-relaxed font-light">
                {item.desc}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* REPORT SUSPICIOUS USER / LISTING FORM */}
      <section id="report-form" className="py-24 bg-gradient-to-b from-[hsl(222,47%,12%)] to-[hsl(222,47%,6%)] border-t border-[hsl(222,47%,15%)] px-4 md:px-8">
        <div className="max-w-[1440px] mx-auto grid lg:grid-cols-12 gap-12 items-start">
          
          {/* Left Description Column */}
          <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
            <Badge className="bg-red-500/10 text-red-400 border border-red-500/20">REPORT SENTRY</Badge>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">
              Encountered a <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">Suspicious Listing</span> or User?
            </h2>
            <p className="text-gray-300 text-base leading-relaxed font-light">
              Our dedicated Trust & Safety Division and our artificial intelligence engine, Gutu AI, monitor the platform 24/7. However, community alerts are vital. 
              If you identify cloned listings, mileage rollbacks, fake dealership profiles, or scam activity, submit this confidential report immediately.
            </p>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">100% Anonymous & Secure</h4>
                  <p className="text-xs text-gray-500">Your details are never disclosed to the suspect.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0 border border-orange-500/20">
                  <Clock className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">2-Hour Rapid Response Action</h4>
                  <p className="text-xs text-gray-500">Our security agents audit verified reports immediately.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 border border-blue-500/20">
                  <AlertTriangle className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">ZRP & CVR Enforcement Escalation</h4>
                  <p className="text-xs text-gray-500">Stolen or duty evasion vehicles are instantly escalated.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Form Column */}
          <div className="lg:col-span-7">
            <Card className="bg-[hsl(222,47%,11%)] border-[hsl(222,47%,18%)] shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-red-500 to-orange-500" />
              
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2 text-white">
                  <ShieldAlert className="w-5 h-5 text-red-500" /> Trust Sentry Incident Report
                </CardTitle>
                <CardDescription className="text-gray-400 font-light">
                  Required fields are marked with *
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6">
                {!isSuccess ? (
                  <form onSubmit={handleFormSubmit} className="space-y-6">
                    {/* Reporter Info Group */}
                    <div className="bg-[hsl(222,47%,8%)]/60 p-4 rounded-xl border border-[hsl(222,47%,18%)] space-y-4">
                      <h3 className="text-xs uppercase font-extrabold tracking-wider text-orange-400">Reporter Contact (Confidential)</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-300">Your Full Name *</label>
                          <Input
                            placeholder="Tendai Moyo"
                            className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                            value={reporterName}
                            onChange={(e) => setReporterName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-300">Your Email Address *</label>
                          <Input
                            type="email"
                            placeholder="tendai@email.co.zw"
                            className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                            value={reporterEmail}
                            onChange={(e) => setReporterEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-gray-300 font-light">Your Phone Number (Optional)</label>
                        <Input
                          placeholder="+263 773 345 678"
                          className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                          value={reporterPhone}
                          onChange={(e) => setReporterPhone(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Report Target Settings */}
                    <div className="space-y-4">
                      <h3 className="text-xs uppercase font-extrabold tracking-wider text-orange-400">Report Details</h3>
                      
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-gray-300">What are you reporting? *</label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setTargetType('listing')}
                            className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                              targetType === 'listing'
                                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                                : 'bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-gray-400 hover:text-white'
                            }`}
                          >
                            🚗 Suspicious Listing
                          </button>
                          <button
                            type="button"
                            onClick={() => setTargetType('dealer')}
                            className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                              targetType === 'dealer'
                                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                                : 'bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-gray-400 hover:text-white'
                            }`}
                          >
                            🏢 Suspicious User / Dealer
                          </button>
                        </div>
                      </div>

                      {targetType === 'listing' ? (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-300">Vehicle Listing ID or Reg Number *</label>
                          <Input
                            placeholder="e.g. AD-38291 or Plate: AGE-9281"
                            className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                            value={listingId}
                            onChange={(e) => setListingId(e.target.value)}
                            required
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-300">User / Dealership Name *</label>
                          <Input
                            placeholder="e.g. Harare Elite Autos or Tafadzwa M."
                            className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                            value={dealerName}
                            onChange={(e) => setDealerName(e.target.value)}
                            required
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-gray-300">Incident Category *</label>
                        <select
                          className="w-full bg-[hsl(222,47%,12%)] border border-[hsl(222,47%,18%)] text-white rounded-md h-9 px-3 text-sm focus-visible:border-orange-500/50 outline-none"
                          value={issueType}
                          onChange={(e) => setIssueType(e.target.value)}
                        >
                          <option value="odometer">Odometer Tampering / Rollback Suspicion</option>
                          <option value="fake_listing">Fake / Cloned Listing or Duplicate</option>
                          <option value="price_bait">Bait-and-Switch Pricing (USD vs. ZiG confusion)</option>
                          <option value="owner_impersonation">Fraudulent Ownership Document / Logbook</option>
                          <option value="stolen_vehicle">Suspicion of Stolen Vehicle</option>
                          <option value="dealer_behavior">Abusive / Extortionate Dealer Behavior</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-gray-300">Detailed Incident Description *</label>
                        <Textarea
                          rows={4}
                          placeholder="Describe the discrepancy in detail. Mention what elements of the listing or user interactions triggered this alert..."
                          className="bg-[hsl(222,47%,12%)] border-[hsl(222,47%,18%)] text-white focus-visible:border-orange-500/50"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    {/* File Upload Area */}
                    <div className="space-y-3">
                      <label className="text-xs font-semibold text-gray-300">Evidence Attachments (Logbook scans, chat history, physical damage proofs)</label>
                      <div
                        onClick={triggerFileInput}
                        className="border-2 border-dashed border-[hsl(222,47%,18%)] hover:border-orange-500/50 rounded-xl p-6 text-center cursor-pointer transition-colors group bg-[hsl(222,47%,9%)]"
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          onChange={handleFileUpload}
                          multiple
                        />
                        <Upload className="w-8 h-8 text-gray-500 group-hover:text-orange-400 mx-auto mb-2 transition-colors duration-300" />
                        <p className="text-sm font-semibold text-gray-300 group-hover:text-orange-300 transition-colors">Drag & drop files or click to upload</p>
                        <p className="text-xs text-gray-500 mt-1">Supports PDF, PNG, JPG (Max 5MB each)</p>
                      </div>

                      {/* Display attached files list */}
                      {attachedFiles.length > 0 && (
                        <div className="space-y-2 mt-3">
                          {attachedFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-[hsl(222,47%,12%)] border border-[hsl(222,47%,18%)] rounded-lg p-2.5">
                              <div className="flex items-center gap-2 truncate">
                                <FileCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                                <span className="text-xs font-semibold text-white truncate max-w-[200px] md:max-w-[350px]">{file.name}</span>
                                <span className="text-[10px] text-gray-500">({file.size})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeFile(idx)}
                                className="text-gray-500 hover:text-red-400"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Submit Button */}
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-3 font-bold transition-all shadow-lg flex items-center justify-center gap-2 group cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Processing Incident Report...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                          <span>Submit Security Report</span>
                        </>
                      )}
                    </Button>
                  </form>
                ) : (
                  /* Form Success Area */
                  <div className="text-center py-12 px-4 space-y-6">
                    <div className="w-20 h-20 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-full flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                      <ShieldCheck className="w-10 h-10 text-emerald-400 animate-pulse" />
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold tracking-tight text-white">Report Successfully Logged</h3>
                      <p className="text-sm text-gray-400 max-w-md mx-auto font-light">
                        Thank you for contributing to the integrity of CarUp. A secure priority ticket has been generated.
                      </p>
                    </div>

                    {/* Ticket Details Panel */}
                    <div className="bg-[hsl(222,47%,8%)] border border-[hsl(222,47%,16%)] rounded-2xl p-6 max-w-md mx-auto space-y-3">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-xs text-gray-500">Security Ticket Number</span>
                        <span className="text-sm font-extrabold text-orange-400 tracking-wider">{ticketNumber}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-xs text-gray-500">Audit Status</span>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-red-500/10 border border-red-500/25 rounded text-red-400 animate-pulse">High Priority Audit</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Response SLA</span>
                        <span className="text-xs font-semibold text-white">Under 2 Hours</span>
                      </div>
                    </div>

                    <p className="text-xs text-gray-500 max-w-sm mx-auto font-light leading-relaxed">
                      A copy of this case status link has been dispatched to <span className="text-gray-300 font-semibold">{reporterEmail}</span>. 
                      You can securely append extra notes or evidence later if required.
                    </p>

                    <Button
                      onClick={resetForm}
                      variant="outline"
                      className="border-white/10 hover:bg-white/5 text-white"
                    >
                      File Another Incident
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FREQUENTLY ASKED QUESTIONS */}
      <section className="py-24 px-4 md:px-8 max-w-[1440px] mx-auto border-t border-[hsl(222,47%,15%)]">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge className="mb-4 bg-orange-500/10 text-orange-400 border border-orange-500/20">COMMON ENQUIRIES</Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Trust & Safety FAQs</h2>
          <p className="text-gray-400 mt-3 font-light">Have further questions regarding inspections, registration checks, or escrow policies? Read on.</p>
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          {faqsList.map((faq, idx) => (
            <Card
              key={idx}
              className="bg-[hsl(222,47%,11%)] border-[hsl(222,47%,18%)] text-white hover:border-orange-500/30 transition-all duration-300 cursor-pointer overflow-hidden shadow-md"
              onClick={() => toggleFaq(idx)}
            >
              <div className="p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-5 h-5 text-orange-400 shrink-0" />
                  <h3 className="font-bold text-base md:text-lg text-left">{faq.question}</h3>
                </div>
                <div>
                  {expandedFaq === idx ? (
                    <ChevronUp className="w-5 h-5 text-orange-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-500 hover:text-orange-400 transition-colors" />
                  )}
                </div>
              </div>
              
              {/* FAQ Collapsible Panel */}
              <div
                className={`transition-all duration-500 ease-in-out overflow-hidden border-t border-white/5 ${
                  expandedFaq === idx ? 'max-h-[300px] opacity-100 bg-[hsl(222,47%,9%)]/50' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="p-6 text-sm text-gray-400 leading-relaxed font-light text-left">
                  {faq.answer}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* CALL TO ACTION */}
      <section className="py-24 border-t border-[hsl(222,47%,15%)] bg-gradient-to-t from-[hsl(222,47%,6%)] via-[hsl(222,47%,8%)] to-[hsl(222,30%,12%)] relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(249,115,22,0.03),transparent_70%)]" />
        
        <div className="section-padding mx-auto max-w-[1440px] text-center relative z-10 px-4">
          <Badge className="mb-6 bg-orange-500/10 text-orange-400 border border-orange-500/20 px-4 py-1 flex items-center gap-1.5 w-fit mx-auto">
            <Sparkles className="w-3.5 h-3.5" /> Transact with Absolute Peace of Mind
          </Badge>
          <h2 className="text-3xl md:text-5xl font-extrabold mb-6 tracking-tight max-w-3xl mx-auto leading-tight">
            Ready to Experience the Secure Future of Car Trading?
          </h2>
          <p className="text-gray-300 text-lg mb-10 max-w-2xl mx-auto font-light leading-relaxed">
            Whether you want to audit an imported Japanese sedan, register your mechanical garage, or search for clean-titled dealer vehicles — CarUp is your shield.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white gap-2 font-bold px-8 shadow-lg cursor-pointer" asChild>
              <a href="/marketplace">
                Search Verified Vehicles <ArrowRight className="w-4 h-4" />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="border-white/10 text-white hover:bg-white/5 font-semibold px-8" asChild>
              <a href="#report-form">Report Suspicious Activity</a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
