import React, { useState, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Briefcase,
  MapPin,
  DollarSign,
  Users,
  Award,
  ArrowRight,
  CheckCircle2,
  FileText,
  UploadCloud,
  Stethoscope,
  Compass,
  Laptop,
  Plus,
  Mail,
  Phone,
  User,
  Loader2,
  Check
} from 'lucide-react'

// Mock job data with hyper-realistic local details
interface Job {
  id: string
  title: string
  location: string
  department: 'Engineering' | 'Operations' | 'Data'
  type: string
  salary: string
  impact: string
  requirements: string[]
  perks: string[]
}

const jobsList: Job[] = [
  {
    id: 'ai-engineer',
    title: 'Lead AI Engineer (Gutu AI)',
    location: 'Harare, Zimbabwe (Hub)',
    department: 'Engineering',
    type: 'Full-time',
    salary: '$4,500 - $6,500 USD / mo',
    impact: 'Own the evolution of Gutu AI, our signature automotive intelligence assistant. You will build highly optimized computer vision systems to parse vehicle registration logbooks (ZINARA), deep learning models for predictive maintenance, and NLP models to answer complex automotive queries in Shona, Ndebele, and English.',
    requirements: [
      '5+ years of experience in Python, PyTorch/TensorFlow, and ML engineering.',
      'Deep expertise in OCR, document intelligence, or computer vision architectures.',
      'Experience deploying and monitoring ML models in production environments (AWS/GCP).',
      'Knowledge of local vehicle registry systems or similar Southern African document formats.'
    ],
    perks: [
      'Uncapped professional training budget & tech allowance',
      'Brand new Apple Silicon MacBook Pro setup',
      'Dedicated fuel allowance in USD',
      'Significant early-stage equity options'
    ]
  },
  {
    id: 'react-developer',
    title: 'Senior Full-Stack React Developer',
    location: 'Harare / Bulawayo (Hybrid)',
    department: 'Engineering',
    type: 'Full-time',
    salary: '$3,500 - $5,200 USD / mo',
    impact: 'Craft the beautiful, responsive, dark-modern dashboards that power the CarUp platform. You will work closely with dealers, insurance partners, and car owners to build stunning React interfaces, advanced map visualizations (like our Collateral Map), and high-frequency real-time update pipelines.',
    requirements: [
      '4+ years of professional React experience (Next.js or Vite stacks preferred).',
      'Expert-level skills in Tailwind CSS, TypeScript, and state management (Zustand/Redux).',
      'Experience integrating REST/GraphQL APIs and serverless backends (Supabase/Firebase).',
      'An exceptional eye for pixel-perfect motion design, transitions, and micro-interactions.'
    ],
    perks: [
      'High-end dual-monitor developer workstation',
      'Solar/Inverter power stipend & high-speed fiber internet subsidy',
      'Full premium health coverage through Cimas (Private Hospital plan)',
      'Flexible hybrid schedule (2 days in Harare/Bulawayo Hub, 3 days remote)'
    ]
  },
  {
    id: 'data-analyst',
    title: 'Automotive Data Analyst',
    location: 'Bulawayo, Zimbabwe (Hub)',
    department: 'Data',
    type: 'Full-time',
    salary: '$2,800 - $4,200 USD / mo',
    impact: 'Govern the pricing intelligence and trust metrics of CarUp. You will analyze regional vehicle import data, local market transaction rates, repair frequency ledgers, and auction records to refine our automated valuation algorithms.',
    requirements: [
      '3+ years of experience in data analysis, SQL, and Python (pandas/numpy) or R.',
      'Proven history building interactive analytics dashboards (PowerBI, Tableau, or custom React charts).',
      'Deep familiarity with the Southern African automotive market (Japanese, UK, and South African imports).',
      'Strong communication skills to translate complex statistical analyses into clear product insights.'
    ],
    perks: [
      'Full sponsorship for professional data science certifications',
      'Monthly team adventure drives around Matopos and the Eastern Highlands',
      'Flexible working hours & remote-friendly workspace',
      'High-performance PC or MacBook of choice'
    ]
  },
  {
    id: 'partner-relations',
    title: 'Partner Relations Specialist',
    location: 'Harare / Bulawayo (Field & Hybrid)',
    department: 'Operations',
    type: 'Full-time',
    salary: '$2,200 - $3,500 USD / mo + commission',
    impact: 'Grow our certified dealer and garage network across Zimbabwe. You will be the face of CarUp, onboarding prestigious car dealerships, verifying auto mechanics for the PartSentry ledger, and aligning with national insurance giants.',
    requirements: [
      '3+ years of experience in sales, account management, or business development.',
      'Deep network in Zimbabwe’s automotive, insurance, or mechanical sector.',
      'Outstanding communication, negotiation, and relationship-building capabilities.',
      'Valid driver’s license and willingness to travel frequently between major cities (Harare, Bulawayo, Mutare).'
    ],
    perks: [
      'Dedicated company utility vehicle for partner field visits',
      'Unlimited business call, SMS, and data connectivity package',
      'Comprehensive Cimas health insurance coverage',
      'Uncapped performance bonuses in USD based on network growth'
    ]
  }
]

const perksList = [
  {
    icon: DollarSign,
    title: 'Inflation-Resistant Pay',
    desc: 'All compensation packages are benchmarked and paid in USD to ensure absolute financial stability.'
  },
  {
    icon: Stethoscope,
    title: 'Elite Health Coverage',
    desc: 'Comprehensive medical insurance through top local partners like Cimas or Mars for you and your family.'
  },
  {
    icon: Laptop,
    title: 'State-of-the-Art Gear',
    desc: 'High-end laptops (MacBook Pro/ThinkPad), dual monitors, plus a solar/inverter stipend for continuous power.'
  },
  {
    icon: Compass,
    title: 'Quarterly Adventure Drives',
    desc: 'Join our team drives around Nyanga, Vumba, or Kariba. We test our terrain AI and bond over great local food.'
  },
  {
    icon: Award,
    title: 'Learning & Growth Budget',
    desc: 'Uncapped access to international tech courses, global auto summits, and regular professional bootcamps.'
  },
  {
    icon: Users,
    title: 'True Hybrid Autonomy',
    desc: 'Work from our state-of-the-art hubs in Harare and Bulawayo, or work completely remotely from anywhere in Zimbabwe.'
  }
]

const faqsList = [
  {
    question: 'Can I apply if I live outside Harare or Bulawayo?',
    answer: 'Absolutely. While our primary physical hubs are in Harare (Avondale) and Bulawayo (Suburbs), we fully support hybrid work arrangements. If you are located in Mutare, Gweru, or Masvingo, we provide hardware packages and robust power/internet subsidies to set you up for remote success.'
  },
  {
    question: 'What currency are salaries paid in?',
    answer: 'To ensure financial peace of mind, all employee salaries at CarUp are contractually benchmarked in USD and disbursed in USD cash or international wire arrangements, adhering strictly to national regulatory compliance.'
  },
  {
    question: 'What is the "Quarterly Adventure Drive"?',
    answer: 'Zimbabwe boasts some of the most breathtaking terrains in the world. Once a quarter, our entire team hitches up 4x4s and premium SUVs for field drives in places like Nyanga, Vumba, and Kariba. We use this time to benchmark our computer vision terrain models, test offline mobile capabilities, and enjoy a weekend of team-building.'
  },
  {
    question: 'Does CarUp offer equity?',
    answer: 'Yes. We believe in building together. Every full-time hire at CarUp receives stock options inside our employee equity pool. As the platform scales to revolutionize automotive intelligence across Southern Africa, you own a literal piece of that success.'
  }
]

export default function Careers() {
  const [activeDept, setActiveDept] = useState<string>('All')
  const [activeLoc, setActiveLoc] = useState<string>('All')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  
  // Application form states
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [applicantName, setApplicantName] = useState('')
  const [applicantEmail, setApplicantEmail] = useState('')
  const [applicantPhone, setApplicantPhone] = useState('+263 ')
  const [coverLetter, setCoverLetter] = useState('')
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filter jobs based on user selections
  const filteredJobs = jobsList.filter(job => {
    const matchesDept = activeDept === 'All' || job.department === activeDept
    const matchesLoc = activeLoc === 'All' || 
      (activeLoc === 'Harare' && job.location.includes('Harare')) || 
      (activeLoc === 'Bulawayo' && job.location.includes('Bulawayo')) || 
      (activeLoc === 'Hybrid/Remote' && job.location.includes('Hybrid'))
    return matchesDept && matchesLoc
  })

  // Simulate file upload interaction
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      const sizeInMB = (file.size / (1024 * 1024)).toFixed(2)
      setUploadedFile({
        name: file.name,
        size: `${sizeInMB} MB`
      })
    }
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    setUploadedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle application submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!applicantName || !applicantEmail || !uploadedFile) return

    setIsSubmitting(true)
    // Simulate API call delay
    setTimeout(() => {
      setIsSubmitting(false)
      setIsSubmitted(true)
    }, 1800)
  }

  const handleOpenApply = (job: Job) => {
    setSelectedJob(job)
    setIsSubmitted(false)
    setApplicantName('')
    setApplicantEmail('')
    setApplicantPhone('+263 ')
    setCoverLetter('')
    setUploadedFile(null)
    setIsSheetOpen(true)
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,5%)] text-slate-100 selection:bg-orange-500 selection:text-white pb-24 overflow-x-hidden relative">
      {/* Background glowing overlays */}
      <div className="absolute top-0 inset-x-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent pointer-events-none z-0" />
      <div className="absolute top-[800px] right-0 w-[400px] h-[400px] bg-blue-500/5 rounded-full filter blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[300px] left-0 w-[500px] h-[500px] bg-orange-500/5 rounded-full filter blur-[150px] pointer-events-none z-0" />
      
      {/* Fine Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808007_1px,transparent_1px),linear-gradient(to_bottom,#80808007_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0" />

      <div className="relative z-10">
        
        {/* HERO SECTION */}
        <section className="pt-24 pb-20 px-4 max-w-[1200px] mx-auto text-center">
          <Badge className="mb-6 bg-orange-500/15 text-orange-400 border border-orange-500/30 px-3 py-1 hover:bg-orange-500/20 text-xs tracking-wider uppercase">
            We're Hiring • Join the Revolution
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Drive the Future of <br className="hidden md:inline" />
            <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-300 bg-clip-text text-transparent">
              Zimbabwe's Auto Tech
            </span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed">
            CarUp is building Zimbabwe's trusted automotive intelligence platform. From Gutu AI document scanners to decentralized PartSentry lifecycles, join a team of elite creators redefining transparency, finance, and intelligence in African mobility.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button 
              size="lg" 
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] px-8"
              onClick={() => {
                const element = document.getElementById('jobs-board')
                element?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              View Open Roles <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 hover:text-white transition-all duration-300"
              onClick={() => {
                const element = document.getElementById('perks')
                element?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Learn Our Perks
            </Button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 pt-10 border-t border-slate-800/80 max-w-4xl mx-auto">
            {[
              { label: 'Platform Users', val: '12k+' },
              { label: 'Engineering Hubs', val: 'Harare & BYO' },
              { label: 'Salary Standard', val: '100% USD' },
              { label: 'Work Culture', val: 'True Hybrid' }
            ].map((m, idx) => (
              <div key={idx} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800/40 backdrop-blur-xs">
                <p className="text-2xl md:text-3xl font-bold text-amber-400">{m.val}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">{m.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CORE PERKS / BENEFITS */}
        <section id="perks" className="py-20 px-4 bg-slate-950/40 border-y border-slate-900">
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <Badge className="mb-4 bg-blue-500/10 text-blue-400 border border-blue-500/25 px-2.5 py-0.5 text-xs font-semibold">
                Employee Value
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Designed to Support Elite Creators
              </h2>
              <p className="text-slate-400">
                We believe top talent deserves premium benefits, continuous enablement, and a workspace optimized for pure output.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {perksList.map((p, idx) => (
                <Card 
                  key={idx} 
                  className="bg-[hsl(222,47%,9%)] border-[hsl(222,47%,15%)] hover:border-amber-500/30 text-slate-100 hover:shadow-[0_0_30px_rgba(245,158,11,0.06)] hover:-translate-y-1 transition-all duration-300 group"
                >
                  <CardContent className="p-6 flex flex-col items-start">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-5 group-hover:bg-amber-500/20 group-hover:text-amber-300 transition-colors duration-300">
                      <p.icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-amber-300 transition-colors duration-300">
                      {p.title}
                    </h3>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {p.desc}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ACTIVE OPENINGS */}
        <section id="jobs-board" className="py-24 px-4 max-w-[1200px] mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Badge className="mb-4 bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2.5 py-0.5 text-xs font-semibold">
              Join Our Journey
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Active Strategic Openings
            </h2>
            <p className="text-slate-400">
              Filter by department or hub location to discover where you can make your mark.
            </p>
          </div>

          {/* Filtering controls */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-10 pb-6 border-b border-slate-800/80">
            {/* Dept Filter */}
            <div className="flex flex-wrap gap-2">
              {['All', 'Engineering', 'Data', 'Operations'].map((dept) => (
                <button
                  key={dept}
                  onClick={() => setActiveDept(dept)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                    activeDept === dept 
                      ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' 
                      : 'bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>

            {/* Location Filter */}
            <div className="flex flex-wrap gap-2">
              {['All', 'Harare', 'Bulawayo', 'Hybrid/Remote'].map((loc) => (
                <button
                  key={loc}
                  onClick={() => setActiveLoc(loc)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                    activeLoc === loc 
                      ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' 
                      : 'bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>

          {/* Job listings grid */}
          {filteredJobs.length > 0 ? (
            <div className="grid lg:grid-cols-2 gap-6">
              {filteredJobs.map((job) => (
                <Card 
                  key={job.id} 
                  className="bg-[hsl(222,47%,8%)] border-[hsl(222,47%,14%)] hover:border-amber-500/25 hover:shadow-[0_0_35px_rgba(245,158,11,0.05)] transition-all duration-300 rounded-xl overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <CardHeader className="pb-4">
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Badge className="bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 text-[10px] py-0.5">
                          {job.department}
                        </Badge>
                        <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] py-0.5">
                          {job.type}
                        </Badge>
                      </div>
                      <CardTitle className="text-xl md:text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">
                        {job.title}
                      </CardTitle>
                    </CardHeader>
                    
                    <CardContent className="space-y-4">
                      {/* Job Metadata */}
                      <div className="grid grid-cols-2 gap-3 text-xs text-slate-400 py-3 px-4 bg-slate-900/50 rounded-lg border border-slate-800/40">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">{job.location}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5 text-green-500 shrink-0" />
                          <span className="font-semibold text-slate-200">{job.salary}</span>
                        </div>
                      </div>

                      {/* Job Impact */}
                      <div>
                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Role Impact</h4>
                        <p className="text-sm text-slate-400 leading-relaxed line-clamp-3">
                          {job.impact}
                        </p>
                      </div>

                      {/* Key Requirements Preview */}
                      <div>
                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Key Competencies</h4>
                        <ul className="space-y-1.5">
                          {job.requirements.slice(0, 2).map((req, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                              <CheckCircle2 className="w-3.5 h-3.5 text-amber-500/80 shrink-0 mt-0.5" />
                              <span>{req}</span>
                            </li>
                          ))}
                          {job.requirements.length > 2 && (
                            <li className="text-[11px] text-amber-400/80 pl-5 italic">
                              + {job.requirements.length - 2} more core requirements
                            </li>
                          )}
                        </ul>
                      </div>
                    </CardContent>
                  </div>

                  <div className="p-6 pt-0 border-t border-slate-900/60 mt-4 flex items-center justify-between gap-4">
                    <span className="text-xs text-slate-500 italic">Posted 3 days ago</span>
                    <Button 
                      onClick={() => handleOpenApply(job)}
                      className="bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-amber-400 border border-amber-500/30 hover:border-amber-500 font-semibold transition-all duration-300 px-5 text-sm"
                    >
                      View & Apply
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/20 max-w-md mx-auto">
              <Briefcase className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-1">No openings match filters</h3>
              <p className="text-sm text-slate-400 px-4">
                We are actively expanding. Try relaxing your department or location filters to see other strategic roles.
              </p>
            </div>
          )}
        </section>

        {/* TEAM DRIVE VIDEO SHOWCASE & LOCAL CITATIONS */}
        <section className="py-20 px-4 bg-slate-950/40 border-t border-slate-900">
          <div className="max-w-[1200px] mx-auto grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 text-xs font-semibold">
                Life at CarUp
              </Badge>
              <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-tight">
                Not Just a Tech Job. <br />
                <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
                  A Zimbabwean Automotive Odyssey.
                </span>
              </h2>
              <p className="text-slate-300 leading-relaxed">
                CarUp is fundamentally transforming the automotive landscape of Zimbabwe. But building groundbreaking AI means taking breaks to appreciate the rugged landscapes of the country our code empowers.
              </p>
              
              <div className="grid sm:grid-cols-2 gap-4 pt-4">
                {[
                  { title: 'The Kariba Field Test', desc: 'Running off-line ZINARA token syncing on remote borders.' },
                  { title: 'Nyanga Offroad Drive', desc: 'Gathering local suspension metrics under rocky and misty terrain.' },
                  { title: 'Harare Avondale Hub', desc: 'Our electric, premium, solar-backed innovation campus.' },
                  { title: 'Bulawayo Data Hub', desc: 'Where deep Southern African import trends are modeled.' }
                ].map((item, idx) => (
                  <div key={idx} className="flex gap-3">
                    <Check className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-white text-sm">{item.title}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 relative">
              {/* Decorative background glow */}
              <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/20 to-blue-500/20 rounded-2xl filter blur-xl opacity-70" />
              
              {/* Interactive Video/Image Card */}
              <div className="relative rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-2xl group cursor-pointer aspect-video md:aspect-[4/3] flex flex-col justify-end p-6">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=1000')] bg-cover bg-center group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                
                {/* Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-orange-500/90 text-white flex items-center justify-center shadow-lg group-hover:bg-orange-500 group-hover:scale-110 transition-all duration-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="ml-1">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>

                <div className="relative z-10">
                  <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest bg-orange-950/70 border border-orange-500/30 px-2 py-0.5 rounded-sm">
                    Watch Documentary
                  </span>
                  <h3 className="font-bold text-white text-lg mt-2">
                    CarUp Vumba Mountain Drive 2025
                  </h3>
                  <p className="text-xs text-slate-400">
                    22 Engineers. 5 Terrain Vehicles. 1 AI Core.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FREQUENTLY ASKED QUESTIONS (FAQ) */}
        <section className="py-24 px-4 max-w-[800px] mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 text-xs font-semibold">
              Have Questions?
            </Badge>
            <h2 className="text-3xl font-bold text-white mb-2">
              Frequently Asked Questions
            </h2>
            <p className="text-sm text-slate-400">
              Clear answers to help you understand our workplace, culture, and alignment.
            </p>
          </div>

          <div className="space-y-4">
            {faqsList.map((faq, idx) => {
              const isOpen = expandedFaq === idx
              return (
                <div 
                  key={idx} 
                  className="bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden backdrop-blur-xs transition-all duration-300"
                >
                  <button
                    onClick={() => setExpandedFaq(isOpen ? null : idx)}
                    className="w-full text-left p-5 flex items-center justify-between gap-4 font-semibold text-white hover:text-amber-400 transition-colors"
                  >
                    <span>{faq.question}</span>
                    <Plus className={`w-4 h-4 text-amber-400 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-45 text-orange-500' : ''}`} />
                  </button>
                  
                  {isOpen && (
                    <div className="p-5 pt-0 text-sm text-slate-400 leading-relaxed border-t border-slate-900/60 bg-slate-950/20">
                      {faq.answer}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* CALL TO ACTION */}
        <section className="py-20 px-4 max-w-[1000px] mx-auto text-center border-t border-slate-800/60">
          <div className="bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,16%)] border border-slate-800 rounded-3xl p-8 md:p-14 relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-orange-500/5 rounded-full filter blur-[100px] pointer-events-none" />
            
            <div className="relative z-10 space-y-6 max-w-2xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Don’t See Your Ideal Role? <br />
                <span className="text-amber-400">Apply Spontaneously.</span>
              </h2>
              <p className="text-slate-300 text-sm md:text-base leading-relaxed">
                We are always seeking exceptional builders, mathematicians, automotive experts, and operators who refuse to settle. Tell us how you can impact the ecosystem.
              </p>
              <div>
                <Button 
                  onClick={() => handleOpenApply({
                    id: 'spontaneous-role',
                    title: 'Spontaneous Executive Application',
                    location: 'Harare or Bulawayo (Flexible)',
                    department: 'Engineering',
                    type: 'Full-time',
                    salary: 'Competitive Market Benchmarked',
                    impact: 'Apply spontaneously and define your own path at CarUp Zimbabwe. Share your expertise, career aspirations, and what strategic value you plan to inject.',
                    requirements: ['Outstanding capability in your domain.', 'Deep passion for solving mobility trust in emerging markets.'],
                    perks: []
                  })}
                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] px-6"
                >
                  Submit Spontaneous Application
                </Button>
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* APPLICATION DRAWER (Radix Sheet Component) */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:max-w-xl bg-[hsl(222,47%,6%)] border-[hsl(222,47%,16%)] text-slate-100 flex flex-col h-full overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-amber-500/20">
          
          {!isSubmitted ? (
            <>
              <SheetHeader className="p-0 pb-6 border-b border-slate-800">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-orange-500/15 text-orange-400 border border-orange-500/20 text-[10px]">
                    Applying For Strategic Role
                  </Badge>
                </div>
                <SheetTitle className="text-2xl font-bold text-white leading-tight">
                  {selectedJob?.title}
                </SheetTitle>
                <SheetDescription className="text-slate-400 text-xs mt-1">
                  Complete the secure application form below. Our recruiting leads in Harare will verify your details within 3 days.
                </SheetDescription>
              </SheetHeader>

              {/* Strategic Job Info Preview inside Sheet */}
              <div className="my-6 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest">Selected Job Profile</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedJob?.impact}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-amber-500" /> {selectedJob?.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-green-500" /> {selectedJob?.salary}
                  </span>
                </div>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSubmit} className="space-y-6 pb-8">
                {/* Full Name */}
                <div className="space-y-2">
                  <Label htmlFor="fullname" className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <User className="w-3 h-3 text-amber-400" /> Full Name <span className="text-orange-500">*</span>
                  </Label>
                  <Input
                    id="fullname"
                    required
                    placeholder="e.g. Tendai Moyo"
                    value={applicantName}
                    onChange={(e) => setApplicantName(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:ring-amber-500/10 focus:ring-2 h-11"
                  />
                </div>

                {/* Email Address */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <Mail className="w-3 h-3 text-amber-400" /> Professional Email <span className="text-orange-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="e.g. tendai@carup.co.zw"
                    value={applicantEmail}
                    onChange={(e) => setApplicantEmail(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:ring-amber-500/10 focus:ring-2 h-11"
                  />
                </div>

                {/* Phone Number */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-amber-400" /> Phone Number (WhatsApp Enabled)
                  </Label>
                  <Input
                    id="phone"
                    placeholder="e.g. +263 773 123 456"
                    value={applicantPhone}
                    onChange={(e) => setApplicantPhone(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:ring-amber-500/10 focus:ring-2 h-11"
                  />
                </div>

                {/* Simulated Resume Upload */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-amber-400" /> Curriculum Vitae (CV) / Resume <span className="text-orange-500">*</span>
                  </Label>
                  
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                  />

                  {!uploadedFile ? (
                    <div 
                      onClick={triggerFileSelect}
                      className="border border-dashed border-slate-800 hover:border-amber-500/30 bg-slate-900/50 hover:bg-slate-900/80 rounded-xl cursor-pointer p-6 transition-all duration-300 text-center flex flex-col items-center justify-center group"
                    >
                      <UploadCloud className="w-8 h-8 text-slate-600 group-hover:text-amber-400 transition-colors mb-2" />
                      <p className="text-xs font-semibold text-slate-300">Click to upload CV</p>
                      <p className="text-[10px] text-slate-500 mt-1">PDF, DOC, DOCX up to 10MB</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-5 h-5 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 truncate">{uploadedFile.name}</p>
                          <p className="text-[10px] text-slate-500">{uploadedFile.size}</p>
                        </div>
                      </div>
                      <Button 
                        type="button" 
                        onClick={removeFile}
                        variant="ghost" 
                        className="h-7 w-7 p-0 text-slate-500 hover:text-white rounded-full"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>

                {/* Cover Letter */}
                <div className="space-y-2">
                  <Label htmlFor="coverletter" className="text-xs font-semibold text-slate-300">
                    Cover Letter / Why CarUp Zimbabwe?
                  </Label>
                  <Textarea
                    id="coverletter"
                    placeholder="Detail your motivations, automotive interests, or experiences that align with CarUp's mission."
                    rows={4}
                    value={coverLetter}
                    onChange={(e) => setCoverLetter(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:ring-amber-500/10 focus:ring-2 text-sm"
                  />
                </div>

                {/* Submit button */}
                <div className="pt-4">
                  <Button
                    type="submit"
                    disabled={isSubmitting || !applicantName || !applicantEmail || !uploadedFile}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition-all duration-300 shadow-md h-12 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Encrypting & Transmitting...
                      </>
                    ) : (
                      'Submit Strategic Application'
                    )}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            /* Submission Success Screen with local flavor */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 flex items-center justify-center shadow-[0_0_20px_rgba(34,197,94,0.15)]">
                <Check className="w-8 h-8" />
              </div>
              
              <div className="space-y-2">
                <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">Application Locked In</span>
                <h3 className="text-2xl font-extrabold text-white">Maita basa! (Thank You)</h3>
                <p className="text-sm text-slate-300 leading-relaxed max-w-sm mx-auto">
                  We've successfully received your application for the <strong className="text-amber-400 font-semibold">{selectedJob?.title}</strong> role.
                </p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 text-xs text-slate-400 leading-relaxed max-w-sm text-left space-y-2">
                <p className="font-semibold text-slate-200">What happens next?</p>
                <p>1. Our engineering & recruitment hubs in Avondale, Harare will review your technical credentials and portfolio documents.</p>
                <p>2. We will contact you via your verified email or WhatsApp line (+263) within 3 business days for initial conversations.</p>
              </div>

              <div className="w-full pt-4">
                <Button 
                  onClick={() => setIsSheetOpen(false)}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-bold h-11 transition-all duration-300"
                >
                  Close Application Hub
                </Button>
              </div>
            </div>
          )}

        </SheetContent>
      </Sheet>
    </div>
  )
}
