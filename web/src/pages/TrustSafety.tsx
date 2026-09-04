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

/**
 * What CarUp actually does with a vehicle's evidence.
 *
 * The previous version of this array was labelled "Mock verification stages" in
 * the source and described an operating model CarUp does not have: a real-time
 * digital sync with the CVR and ZINARA, a 150-point physical inspection at CarUp
 * hubs in four cities, proprietary ECU scanner tooling reading ABS and
 * transmission modules, a legal desk auditing ZRP Form 94, and a cryptographic
 * certificate. None of it exists. `provider_registry` is empty, every registry
 * check on record ran against a sandbox simulator, and there is no inspection
 * network, no ECU tooling and no forensic desk.
 *
 * These stages describe the real thing instead, and each says who did it — which
 * is the distinction that matters, because CarUp reviewing a document a seller
 * supplied is not an authority confirming it.
 */
const verificationStages = [
  {
    step: '01',
    title: 'Documents are supplied',
    description: 'A seller uploads the paperwork for their vehicle — the logbook, import and clearance documents, service history. CarUp stores what it is given. Nothing is requested from any registry, because CarUp is not connected to one.',
    details: ['Seller-supplied documents', 'Stored against the vehicle', 'Nothing is fetched from an authority']
  },
  {
    step: '02',
    title: 'CarUp reviews what it was given',
    description: 'A reviewer checks the supplied documents for internal consistency and completeness, and records a decision. This is CarUp\'s own assessment of the evidence in front of it. It is not a government verification and CarUp never describes it as one.',
    details: ['CarUp\'s own review', 'Recorded decision with a reason', 'Not an official or registry confirmation']
  },
  {
    step: '03',
    title: 'Service and parts history is logged',
    description: 'Where a mechanic records a repair or a part replacement through PartSentry, that record is kept with the vehicle. A record can be marked as reviewed, and only a governed review decides whether it may be shown publicly.',
    details: ['Work and part records', 'Review status carried with each record', 'A governed gate gives public visibility']
  },
  {
    step: '04',
    title: 'A Trust position is calculated',
    description: 'Trust states how much confidence CarUp places in the evidence it holds about a vehicle. A vehicle CarUp has not evaluated is shown as not evaluated — never as a zero, a failure, or a poor result.',
    details: ['Confidence in the evidence held', 'Versioned, and stamped with what produced it', 'Not evaluated stays not evaluated']
  },
  {
    step: '05',
    title: 'What Trust is not',
    description: 'Trust describes a vehicle\'s evidence. It is not a credit score, not an insurance risk rating, not a valuation, and not a judgement about the seller. A thin Trust position means CarUp holds little documentation — not that anything is wrong.',
    details: ['Not a credit or risk score', 'Not a valuation', 'Not a verdict on the seller']
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
    title: 'Record as much detail as you can',
    desc: 'A listing that records more of what buyers filter on appears in more searches. CarUp publishes no figure for how much faster a listing sells, because it does not measure that.'
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
    question: 'Does CarUp verify import and duty clearance with ZIMRA or the CVR?',
    answer: 'It does not. CarUp is not connected to ZIMRA, the CVR or any other authority, so it cannot confirm duty status or clearance for you. What CarUp holds is the paperwork a seller supplied and its own review of it. Confirming import liabilities remains something you should do directly with the relevant authority before you buy.'
  },
  {
    question: 'Can CarUp detect an odometer rollback?',
    answer: 'CarUp has no ECU scanning tooling and reads nothing from a vehicle\'s modules. Where a mileage reading is recorded over time and a later reading is lower than an earlier one, that inconsistency is visible in the records CarUp holds. Judging it is yours to do — CarUp does not operate a registry and cannot flag a vehicle nationally.'
  },
  {
    question: 'How do I report a suspicious listing?',
    answer: 'By email, to support@carup.co.zw. CarUp does not yet have an in-product reporting queue, so the form on this page cannot submit and says so rather than pretending otherwise. CarUp has no arrangement with the ZRP or any other authority to escalate on your behalf — if a vehicle may be stolen, report it to the police directly.'
  },
  {
    question: 'Does CarUp hold my money in escrow?',
    answer: 'CarUp is non-custodial: it does not hold, transfer or process funds, and it has no banking partner and no trust account. Its escrow feature currently runs against a sandbox provider only — no live payment has ever been processed through CarUp, and the database itself forbids recording one. Any money you pay moves directly between you and the other party, so the safeguards below matter.'
  },
  {
    question: 'What happens to the information in a report?',
    answer: 'There is no in-product report to submit yet, so CarUp stores nothing from the form on this page. An email you send to support@carup.co.zw is handled by CarUp staff. CarUp makes no claim about credentialed security officers, because it does not operate such a team.'
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files).map(file => ({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      }))
      setAttachedFiles(prev => [...prev, ...filesArray])
      // Selected, not uploaded. Nothing leaves the browser, so nothing is confirmed.
      toast.info('File selected. Note that nothing is uploaded — reporting is not available yet.')
    }
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  /**
   * There is no report to submit.
   *
   * This handler previously ran a 1.5-second timer, invented a ticket number with
   * `Math.random()`, and announced "Report submitted successfully! Security ticket
   * generated." No request was ever made and nothing was ever stored — so somebody
   * reporting a stolen vehicle or a fraudulent dealer walked away believing CarUp
   * had it in hand, and it did not. Of every fabrication in this codebase this was
   * the one most likely to cause real harm.
   *
   * An exhaustive search of the backend found no intake a public reporter can
   * reach: the fraud routes evaluate an existing vehicle or serve a reviewer
   * queue, and every review, dispute and moderation route is gated to staff. So
   * the action is disabled and says so, and the page directs people to a channel
   * that genuinely exists. It will be wired up when an authoritative intake is
   * built — not before.
   */
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    toast.error('In-product reporting is not available yet. Please email support@carup.co.zw.')
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
            Buying a car{' '}
            <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent drop-shadow-[0_2px_15px_rgba(249,115,22,0.2)]">
              with your eyes open
            </span>
          </h1>
          <p className="text-gray-300 text-lg md:text-xl max-w-3xl mx-auto mb-10 leading-relaxed font-light">
            CarUp records what sellers supply about a vehicle and reviews it. It is not connected to the CVR,
            ZINARA, ZIMRA or the police, it holds no money, and it inspects no cars — so this page is about
            what CarUp can genuinely tell you, and what you still need to check yourself.
          </p>

          {/* Four claims this page used to make, and the truth behind each. The
              originals were '10,000+ Verified Odometers', '99.8% Fraud Detection
              Rate', '100% ZINARA & CVR Sync' and '850+ Vetted Dealerships' — all
              string literals, none measured. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto mt-16 pt-10 border-t border-[hsl(222,47%,16%)]" data-testid="trust-honest-position">
            {[
              { label: 'No registry connection', desc: 'CarUp cannot confirm ownership, duty or licensing with any authority.' },
              { label: 'No custody of funds', desc: 'CarUp never holds your money. Payment happens directly between you and the seller.' },
              { label: 'No physical inspection', desc: 'CarUp does not inspect vehicles. Arrange your own mechanical check before you buy.' }
            ].map((item, idx) => (
              <div key={idx} className="bg-[hsl(222,47%,11%)]/50 backdrop-blur-md rounded-2xl p-5 border border-[hsl(222,47%,16%)] text-left">
                <p className="text-sm font-semibold text-white">{item.label}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed font-light">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CORE PILLARS SECTION */}
      <section className="py-24 px-4 md:px-8 max-w-[1440px] mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge className="mb-4 bg-orange-500/10 text-orange-400 border border-orange-500/20">SECURITY PILLARS</Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">What CarUp actually does</h2>
          <p className="text-gray-400 mt-3 font-light">And, just as importantly, what it does not do. CarUp is not a registry, not a custodian and not an inspector.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: ShieldCheck,
              title: 'A signed internal record',
              desc: 'Changes CarUp records against a vehicle are written to its own signed, append-only log, so an entry cannot be quietly altered later. It is an internal ledger — not a blockchain, and it carries no tax or ownership status from any authority.',
              color: 'from-orange-500/20 to-amber-500/20',
              badge: 'Internal log'
            },
            {
              icon: UserCheck,
              title: 'Accounts and documents',
              desc: 'Sellers hold CarUp accounts and can supply documents for a vehicle, which CarUp reviews. There is no biometric check and no physical site visit, so treat an account as an account — not as proof of who somebody is.',
              color: 'from-blue-500/20 to-indigo-500/20',
              badge: 'No biometric check'
            },
            {
              icon: Cpu,
              title: 'Assisted review',
              desc: 'CarUp uses automated help when reviewing documents and listings, and a person decides. It does not run reverse-image audits or price a vehicle against a market model, and it makes no claim to catch fraud before it goes live.',
              color: 'from-purple-500/20 to-pink-500/20',
              badge: 'A person decides'
            },
            {
              icon: Coins,
              title: 'Non-custodial by design',
              desc: 'CarUp does not hold, transfer or process your money, and it operates no trust account. Its escrow feature runs against a sandbox provider only — no live payment has ever gone through CarUp. Money moves directly between you and the other party.',
              color: 'from-emerald-500/20 to-teal-500/20',
              badge: 'Holds no funds'
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
                    <Building className="w-3.5 h-3.5" /> No registry or authority integration
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
              CarUp has no monitoring team watching the platform around the clock, and no in-product
              reporting queue yet. If you see a cloned listing, a rolled-back odometer, a fake dealership
              profile or a scam, email the details to support@carup.co.zw — and contact the police
              directly if you believe a vehicle is stolen.
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
                {(
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

                    {/* There is nothing to submit to. The control says so and
                        stays disabled rather than performing a fake success. */}
                    <div
                      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200"
                      data-testid="trust-report-unavailable"
                    >
                      <p className="font-semibold">In-product reporting is not available yet.</p>
                      <p className="mt-1 font-light leading-relaxed text-amber-200/80">
                        CarUp has no reporting queue behind this form, so nothing you type here is
                        stored or sent. Please email{' '}
                        <a href="mailto:support@carup.co.zw" className="font-semibold underline">
                          support@carup.co.zw
                        </a>{' '}
                        instead, and contact the police directly if a vehicle may be stolen.
                      </p>
                    </div>

                    <Button
                      type="submit"
                      disabled
                      aria-disabled="true"
                      data-testid="trust-report-submit"
                      className="w-full bg-white/5 text-gray-400 rounded-xl py-3 font-bold flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                      <span>Reporting unavailable</span>
                    </Button>
                  </form>
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
