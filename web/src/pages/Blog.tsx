import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Search,
  Calendar,
  Clock,
  ArrowRight,
  ChevronRight,
  Share2,
  Bookmark,
  MessageSquare,
  Send,
  Check,
  Calculator,
  AlertCircle,
  Filter,
  X,
  Award,
  Hash,
  Globe,
  Coins,
  BookOpen
} from 'lucide-react'
import { toast } from 'sonner'

// Type definitions
interface Author {
  name: string
  role: string
  avatar: string
  bio: string
}

interface Article {
  id: string
  title: string
  excerpt: string
  description: string
  content: string[]
  category: string
  date: string
  author: Author
  readTime: string
  accentColor: string // CSS class for premium gradient accents
  icon: React.ComponentType<{ className?: string }> // Lucide Icon Component
  views: number
  likes: number
  zimbabweanContext?: {
    label: string
    value: string
  }[]
}

export default function Blog() {
  // Articles Mock Data
  const articles: Article[] = [
    {
      id: 'zinara-guide-2026',
      title: 'Navigating ZINARA Regulations in 2026: A Complete Guide',
      excerpt: 'With the new digital licensing system and updated toll gate pricing in ZiG and USD, staying compliant in Zimbabwe has never been more complex. Our experts break down everything you need to know about licensing and insurance audits.',
      description: 'In 2026, the Zimbabwe National Road Administration (ZINARA) launched its third-generation Digital Licensing Portal, aimed at fully integrating tolling, vehicle registration, and third-party insurance databases. This guide covers how this impacts local vehicle owners, fleet managers, and dealers.',
      content: [
        'The year 2026 marks a massive shift in Zimbabwe\'s automotive compliance landscape. ZINARA\'s newly deployed digital registry is now fully operational, linking vehicle licensing, municipal parking accounts (like City Parking in Harare), and the Zimbabwe National Police (ZRP) databases into a single, cohesive electronic clearing system.',
        'One of the most significant changes is the integration of toll gate transponders with your vehicle licensing account. Commuters passing through major plazas like the newly modernized Mbudzi Interchange or the toll plaza on the Harare-Bulawayo road can now have their vehicle licensing status scanned automatically using Automatic Number Plate Recognition (ANPR) cameras. If your vehicle lacks active insurance or license discs, you will face automatic electronic fines added to your vehicle profile.',
        'Additionally, payment options have been diversified. Licensing and toll fees can be settled in both USD and ZiG (Zimbabwe Gold). While USD provides static, predictable pricing, settling in ZiG is calculated using the prevailing official interbank exchange rate of the day. Our compliance team recommends keeping pre-funded digital wallets in both currencies to avoid transaction failures at border crossings like Beitbridge or Chirundu.',
        'To help you stay completely compliant, our team has verified that third-party insurance must be renewed prior to ZINARA registration. You can purchase your insurance directly on CarUp, which automatically pushes a secure cryptographically signed voucher to the ZINARA database, clearing you for licensing in under 3 minutes without visiting a physical office.'
      ],
      category: 'Regulations',
      date: 'May 25, 2026',
      author: {
        name: 'Farai Chiganda',
        role: 'Compliance Lead',
        avatar: 'FC',
        bio: 'Former regulatory advisor with 12 years of experience in cross-border logistics and Zimbabwean transport policy.'
      },
      readTime: '8 min read',
      accentColor: 'from-orange-600 to-amber-600',
      icon: Award,
      views: 1420,
      likes: 312,
      zimbabweanContext: [
        { label: 'ZINARA System', value: '3rd Gen Digital Portal' },
        { label: 'Toll Integration', value: 'ANPR Enabled Plazas' },
        { label: 'Currencies Accepted', value: 'USD & ZiG (Interbank Rate)' }
      ]
    },
    {
      id: 'import-duties-zim',
      title: 'Understanding Vehicle Import Duties in Zimbabwe',
      excerpt: 'An in-depth analysis of the current ZIMRA import tax brackets, customs clearing processes at Beitbridge, and surcharge rules for older vehicles.',
      description: 'Importing a vehicle into Zimbabwe continues to be a major channel for car acquisition, particularly from Japan (via Dar es Salaam or Durban) and the UK. However, navigating the Zimbabwe Revenue Authority (ZIMRA) duty structure is notorious for unexpected costs.',
      content: [
        'Importing a vehicle into Zimbabwe remains the most popular way to acquire relatively modern Japanese, UK, or South African vehicles. However, the Zimbabwe Revenue Authority (ZIMRA) applies complex tariffs that can catch first-time importers off guard.',
        'The calculation of import duty is based on the Value for Duty Purposes (VDP). VDP includes the Cost, Insurance, and Freight (CIF) of the vehicle. ZIMRA will assess the purchase invoice, but they also maintain an internal valuation database. If they suspect the declared invoice is undervalued, they will re-value the vehicle based on historical import trends, which often leads to an unexpected increase in duty.',
        'For passenger motor vehicles, the basic duty rate can range from 25% to 40% depending on engine capacity. Crucially, a surcharge of 25% to 35% is levied on vehicles older than 10 years at the time of import. This regulation was designed to discourage the dumping of obsolete, carbon-heavy vehicles on Zimbabwean roads. However, for vehicles like the popular Toyota Fit, Toyota Wish, or Mazda Axela, this surcharge often exceeds the initial purchase price in Japan.',
        'To streamline clearance, importers are urged to utilize ZIMRA\'s Pre-clearance system. Working with a registered clearing agent, you can submit shipping papers, invoice, and bill of lading before the vehicle reaches the Beitbridge border post. This prevents high demurrage charges and ensures your car is cleared in hours rather than weeks.'
      ],
      category: 'Market Trends',
      date: 'May 20, 2026',
      author: {
        name: 'Ruvimbo Moyo',
        role: 'Import Specialist',
        avatar: 'RM',
        bio: 'Beitbridge logistics coordinator specializing in Southern African customs clearance and import tax audits.'
      },
      readTime: '6 min read',
      accentColor: 'from-blue-600 to-indigo-600',
      icon: Globe,
      views: 980,
      likes: 245,
      zimbabweanContext: [
        { label: 'Duty Assessment', value: 'Based on VDP (CIF value)' },
        { label: 'Surcharge rule', value: 'Applicable to cars >10 years' },
        { label: 'Busiest Port', value: 'Beitbridge Border Post' }
      ]
    },
    {
      id: 'ai-odometer-fraud',
      title: 'How AI is Combating Odometer Fraud in Harare',
      excerpt: 'Odometer tampering is a growing challenge for grey imports. Learn how CarUp uses telemetry and AI models to verify mileage authenticity.',
      description: 'Harare\'s secondary car market is plagued by mileage rollbacks, with some imported cars showing up with half their true mileage. CarUp\'s new AI engine cross-references historical shipping logs and domestic service histories to flags discrepancies.',
      content: [
        'Odometer tampering—colloquially referred to as "spinning" the odometer—has become a massive problem in Harare\'s independent car dealerships. Many grey imports from Japan or South Africa have their digital clusters flashed, lowering the displayed mileage by 50,000 to 100,000 kilometers before being listed on the local market.',
        'This fraudulent practice leads to buyers paying premium prices for vehicles that are on the verge of critical mechanical failures. To address this, CarUp has pioneered an AI-powered verification engine.',
        'The system works by extracting telemetry data and cross-referencing it with international shipping manifests. Before a car is exported from Japan, its true mileage is recorded at the export inspection terminal. CarUp\'s AI automatically scans these inspection records (such as JEVIC or QISJ databases) using the vehicle\'s chassis number.',
        'Furthermore, our machine learning models analyze the wear-and-tear profile of the vehicle when it enters our partner garages. By evaluating brake pedal wear, seat compression, and diagnostic computer system logs, the AI flags vehicles whose physical wear does not match the odometer. This generates a "Trust Score" displayed on every listing, making odometer fraud virtually impossible on CarUp.'
      ],
      category: 'AI & Valuation',
      date: 'May 18, 2026',
      author: {
        name: 'Dr. Kuda Gumbo',
        role: 'Head of AI Research',
        avatar: 'KG',
        bio: 'PhD in Machine Learning and Computer Vision, specializing in predictive maintenance and anomaly detection systems.'
      },
      readTime: '5 min read',
      accentColor: 'from-purple-600 to-pink-600',
      icon: Hash,
      views: 1250,
      likes: 408,
      zimbabweanContext: [
        { label: 'Fraud Rate', value: 'Estimated 35% in grey imports' },
        { label: 'AI Method', value: 'JEVIC/QISJ & wear analysis' },
        { label: 'Market Impact', value: 'Restoring transparency' }
      ]
    },
    {
      id: 'reliable-sedans-harare',
      title: 'Top 5 Most Reliable Sedans for Harare Roads in 2026',
      excerpt: 'Harare\'s mix of highway bypasses and challenging suburban roads require suspension resilience. Here are the top 5 models tested by our team.',
      description: 'Harare\'s roads demand a lot from a car\'s suspension and ground clearance. While SUVs are popular, many commuters prefer the fuel economy of sedans. We rank the top five sedans evaluating them on spare parts availability in downtown Harare and suspension durability.',
      content: [
        'Navigating Harare\'s roads requires a vehicle that balances durability, fuel economy, and affordable maintenance. Potholes on suburban routes like Kirkman Road or sections of Harare Drive mean that delicate suspension setups will lead to frequent, expensive garage visits.',
        'We evaluated dozens of sedans popular with local commuters, scoring them on ground clearance, parts availability in downtown Harare (around Kaguvi Street), fuel efficiency in heavy traffic, and overall mechanical simplicity.',
        'Ranked #1 is the Toyota Corolla Quest (or Corolla Prestige). Manufactured in South Africa, this model is built specifically for African road conditions. Its suspension is robust, ground clearance is highly decent, and spare parts are readily available at highly competitive prices.',
        'Ranked #2 is the Honda Fit (especially the newer e:HEV hybrid). Its "magic seats" offer SUV-like utility, and its fuel economy on Samora Machel Avenue gridlocks is legendary, regularly yielding over 22km per liter.',
        'The remaining spots are occupied by the Mazda 3 (noted for high-fidelity cabin materials and active safety features), the Nissan Almera (extremely spacious backseats for school runs), and the Toyota Belta (an excellent, ultra-affordable city commuter).'
      ],
      category: 'Maintenance',
      date: 'May 15, 2026',
      author: {
        name: 'Tinashe Mutasa',
        role: 'Master Technician',
        avatar: 'TM',
        bio: 'ASE-certified master mechanic with over 20 years repairing Japanese and European vehicles in Harare.'
      },
      readTime: '7 min read',
      accentColor: 'from-emerald-600 to-teal-600',
      icon: Clock,
      views: 890,
      likes: 198,
      zimbabweanContext: [
        { label: 'Top Performer', value: 'Toyota Corolla Quest' },
        { label: 'Parts Hub', value: 'Kaguvi Street dealers' },
        { label: 'Testing Ground', value: 'Harare Suburban roads' }
      ]
    },
    {
      id: 'zig-auto-finance',
      title: 'The Rise of ZiG in Local Automotive Financing',
      excerpt: 'As local banks begin backing car loans in Zimbabwe Gold (ZiG), we examine what this means for interest rates and monthly payments.',
      description: 'Zimbabwe\'s currency landscape continues to evolve. With local financial institutions introducing ZiG-denominated car finance options alongside traditional USD loans, purchasing a vehicle has become accessible to a wider demographic.',
      content: [
        'The Zimbabwean gold-backed currency, the ZiG, is making significant inroads into retail banking and commercial credit. Previously, automotive loans were exclusively issued in USD, featuring steep interest rates and short repayment terms that locked out the average salary earner.',
        'In recent months, major financial institutions—led by CABS and FBC Bank—have introduced vehicle asset finance packages denominated in ZiG. This shift allows civil servants and locally paid corporate employees to access vehicle finance without the constant need to convert salaries into USD.',
        'Interest rates for ZiG vehicle loans currently hover around 12% to 15% per annum, which is highly competitive compared to historical local currency loan structures. However, down payments remain significant, usually requiring 30% to 40% of the vehicle\'s valuation upfront.',
        'This article breaks down a typical finance structure for a $15,000 USD vehicle. If purchased in ZiG over a 36-month period, we demonstrate how monthly amortizations are hedged against inflation, providing a viable pathway for local professionals to acquire reliable transport.'
      ],
      category: 'Market Trends',
      date: 'May 10, 2026',
      author: {
        name: 'Chipo Mupfumi',
        role: 'Financial Analyst',
        avatar: 'CM',
        bio: 'Financial analyst covering macroeconomics and banking policy in the SADC region.'
      },
      readTime: '4 min read',
      accentColor: 'from-amber-600 to-yellow-500',
      icon: Coins,
      views: 730,
      likes: 112,
      zimbabweanContext: [
        { label: 'Loan currency', value: 'ZiG & USD dual option' },
        { label: 'Average Term', value: '24 to 36 months' },
        { label: 'Down Payment', value: '30% - 40% required' }
      ]
    }
    // Removed: a fabricated "CarUp Launches Blockchain-backed Vehicle Ledger" announcement claiming a
    // deployed Decentralized Vehicle Registry built "in partnership with major local insurers (such as
    // NicozDiamond and Cell Insurance)" and "100% Tamper-Proof" verification. CarUp has no such
    // partnership and publishes no such registry; the post asserted a commercial relationship with real
    // companies that does not exist.
  ]

  // Extract featured article and rest
  const featuredArticle = articles[0]

  // States
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  
  // Interactive Comments State
  const [comments, setComments] = useState<{ [key: string]: { name: string; text: string; date: string }[] }>({
    'zinara-guide-2026': [
      { name: 'Simbarashe Moyo', text: 'This digital integration is exactly what we needed. Trying to get ZINARA discs at the post office was a nightmare.', date: 'May 26, 2026' },
      { name: 'Sandra Chidzero', text: 'Does this mean Harare City Parking will also know if I have a valid license? Thanks for the clarity.', date: 'May 25, 2026' }
    ],
    'import-duties-zim': [
      { name: 'Keith Mhlanga', text: 'ZIMRA valuations at Beitbridge are indeed unpredictable. Excellent tip on using the pre-clearance system.', date: 'May 21, 2026' }
    ]
  })
  const [newCommentName, setNewCommentName] = useState('')
  const [newCommentText, setNewCommentText] = useState('')

  // ZINARA Fee Calculator State
  const [vehicleClass, setVehicleClass] = useState('light')
  const calculateFee = () => {
    switch (vehicleClass) {
      case 'light': return { usd: 20, zig: 520 }
      case 'minibus': return { usd: 30, zig: 780 }
      case 'bus': return { usd: 50, zig: 1300 }
      case 'heavy': return { usd: 80, zig: 2080 }
      default: return { usd: 20, zig: 520 }
    }
  }

  // Newsletter form state
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [isSubscribed, setIsSubscribed] = useState(false)

  // Categories list
  const categories = ['All', 'Regulations', 'Market Trends', 'AI & Valuation', 'Maintenance', 'Company News']

  // Filter Articles
  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      const matchesCategory = selectedCategory === 'All' || article.category === selectedCategory
      const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            article.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            article.author.name.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [selectedCategory, searchQuery])

  // Handle Comment Submission
  const handleAddComment = (articleId: string) => {
    if (!newCommentName.trim() || !newCommentText.trim()) {
      toast.error('Please fill in both name and comment fields')
      return
    }
    const newComment = {
      name: newCommentName,
      text: newCommentText,
      date: 'Just now'
    }
    setComments(prev => ({
      ...prev,
      [articleId]: [newComment, ...(prev[articleId] || [])]
    }))
    setNewCommentName('')
    setNewCommentText('')
    toast.success('Comment added successfully!')
  }

  // Handle newsletter submit
  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newsletterEmail.trim()) {
      toast.error('Please enter a valid email address')
      return
    }
    setIsSubscribed(true)
    toast.success('Successfully subscribed to CarUp newsletter!')
  }

  // Copy article link to clipboard
  const copyLink = (articleId: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/blog/${articleId}`)
    toast.success('Article link copied to clipboard!')
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,8%)] text-white">
      {/* Background Glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="section-padding mx-auto max-w-[1440px] pt-12 pb-24 relative z-10">
        
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
          <Link to="/" className="hover:text-orange-400 transition-colors">Home</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-orange-400 font-medium">The CarUp Drive</span>
        </div>

        {/* Hero Section */}
        <div className="mb-16 text-center md:text-left">
          <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 mb-4 px-3 py-1 hover:bg-orange-500/20">
            Insights & Updates
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-none mb-6">
            The CarUp{' '}
            <span className="bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">
              Drive
            </span>
          </h1>
          <p className="text-lg text-gray-300 max-w-3xl leading-relaxed">
            Automotive intelligence, regulatory updates, AI developments, and maintenance guides 
            specifically curated for Zimbabwean vehicle owners, dealers, and technicians.
          </p>
        </div>

        {/* Featured Article - High-fidelity Card */}
        {selectedCategory === 'All' && !searchQuery && (
          <div className="mb-16">
            <h2 className="text-xl font-bold tracking-wider text-orange-400 uppercase mb-6 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
              Featured Editorial
            </h2>
            
            <div className="group relative rounded-2xl bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,16%)] border border-white/5 overflow-hidden transition-all duration-300 hover:border-orange-500/30 hover:shadow-[0_0_30px_-5px_rgba(249,115,22,0.15)]">
              {/* Decorative Glow */}
              <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-gradient-to-bl from-orange-500/10 to-transparent blur-[60px] pointer-events-none" />
              
              <div className="grid lg:grid-cols-12 gap-8 p-6 md:p-8">
                {/* Visual Header / Visual Placeholder */}
                <div className="lg:col-span-5 relative rounded-xl overflow-hidden min-h-[250px] lg:min-h-[350px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-white/10 flex flex-col justify-between p-6">
                  {/* Neon Mesh Background */}
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent opacity-70" />
                  
                  <div className="relative z-10 flex justify-between items-start">
                    <Badge className="bg-orange-500 text-white font-bold tracking-wide uppercase px-3 py-1 shadow-md shadow-orange-500/20">
                      {featuredArticle.category}
                    </Badge>
                    <div className="flex items-center gap-1 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full text-xs text-gray-300 border border-white/5">
                      <Clock className="w-3.5 h-3.5 text-orange-400" />
                      {featuredArticle.readTime}
                    </div>
                  </div>

                  {/* Abstract automobile outline logo */}
                  <div className="relative z-10 my-auto flex justify-center items-center">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/0 flex items-center justify-center border border-orange-500/20 animate-pulse-glow" />
                      <featuredArticle.icon className="w-10 h-10 text-orange-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  <div className="relative z-10">
                    <p className="text-[10px] uppercase tracking-widest text-orange-400 font-bold mb-1">Zimbabwean Context</p>
                    <div className="flex flex-wrap gap-2">
                      {featuredArticle.zimbabweanContext?.map((item, idx) => (
                        <div key={idx} className="bg-white/5 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] border border-white/5">
                          <span className="text-gray-400 mr-1">{item.label}:</span>
                          <span className="text-orange-300 font-semibold">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Text Content */}
                <div className="lg:col-span-7 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
                      <Calendar className="w-4 h-4 text-orange-400" />
                      <span>{featuredArticle.date}</span>
                      <span className="mx-2">•</span>
                      <span>{featuredArticle.views} views</span>
                    </div>

                    <h3 className="text-2xl md:text-3xl lg:text-4xl font-extrabold mb-4 group-hover:text-orange-400 transition-colors leading-tight">
                      {featuredArticle.title}
                    </h3>
                    
                    <p className="text-gray-300 text-sm md:text-base leading-relaxed mb-6">
                      {featuredArticle.excerpt}
                    </p>
                  </div>

                  {/* Author, Action row */}
                  <div className="flex flex-wrap items-center justify-between gap-6 pt-6 border-t border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center font-bold text-white text-sm border border-orange-400/30">
                        {featuredArticle.author.avatar}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">{featuredArticle.author.name}</h4>
                        <p className="text-xs text-orange-400">{featuredArticle.author.role}</p>
                      </div>
                    </div>

                    <Button 
                      className="bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all duration-300 shadow-lg shadow-orange-500/20 group/btn rounded-lg gap-2"
                      onClick={() => setSelectedArticle(featuredArticle)}
                    >
                      Read Article 
                      <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Categories and Search Bar Bar */}
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between mb-10 pb-6 border-b border-white/5">
          {/* Categories Tab list */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-3 md:pb-0 scrollbar-none">
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs md:text-sm font-semibold px-3 py-1.5 rounded-md transition-all whitespace-nowrap ${
                    selectedCategory === cat
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Search insights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder-gray-400 pl-9 rounded-lg focus-visible:ring-orange-500/50"
            />
          </div>
        </div>

        {/* Grid Section Title */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold tracking-wider text-orange-400 uppercase flex items-center gap-2">
            <Filter className="w-4 h-4" />
            {selectedCategory === 'All' ? 'Latest Publications' : `${selectedCategory} Articles`}
          </h2>
          <span className="text-xs text-gray-400">{filteredArticles.length} publications found</span>
        </div>

        {/* Blog Cards Grid */}
        {filteredArticles.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
            {filteredArticles.map((article) => {
              const IconComp = article.icon
              return (
                <Card 
                  key={article.id} 
                  className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,16%)] border border-white/5 rounded-2xl overflow-hidden hover-lift hover:border-orange-500/30 group transition-all duration-300 hover:shadow-[0_0_24px_-4px_rgba(249,115,22,0.1)] flex flex-col justify-between"
                >
                  <div>
                    {/* Visual representation */}
                    <div className="relative aspect-[16/10] bg-gradient-to-br from-slate-950 to-slate-900 border-b border-white/5 flex flex-col justify-between p-4 overflow-hidden">
                      {/* Neon Mesh Background */}
                      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-60" />
                      
                      <div className="relative z-10 flex justify-between items-start">
                        <Badge className="bg-orange-500/10 text-orange-300 border border-orange-500/20 text-[10px] tracking-wide uppercase px-2 py-0.5">
                          {article.category}
                        </Badge>
                        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full text-[10px] text-gray-300 border border-white/5">
                          <Clock className="w-3 h-3 text-orange-400" />
                          {article.readTime}
                        </div>
                      </div>

                      {/* Icon projection */}
                      <div className="my-auto flex justify-center">
                        <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-orange-500/30 group-hover:bg-orange-500/5 transition-all duration-300">
                          <IconComp className="w-6 h-6 text-gray-300 group-hover:text-orange-400 transition-colors" />
                        </div>
                      </div>

                      <div className="relative z-10 text-[10px] text-gray-400 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-orange-400" />
                          {article.date}
                        </span>
                        <span>{article.views} views</span>
                      </div>
                    </div>

                    <CardHeader className="p-5 pb-2">
                      <CardTitle className="text-lg md:text-xl font-bold leading-snug group-hover:text-orange-400 transition-colors line-clamp-2">
                        {article.title}
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="px-5 pb-4">
                      <p className="text-gray-300 text-sm leading-relaxed line-clamp-3">
                        {article.excerpt}
                      </p>
                    </CardContent>
                  </div>

                  <div className="px-5 pb-5 pt-4 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500/10 to-amber-500/20 flex items-center justify-center font-bold text-[11px] text-orange-300 border border-orange-500/20">
                        {article.author.avatar}
                      </div>
                      <div>
                        <h4 className="font-bold text-[12px] text-white leading-none">{article.author.name}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5">{article.author.role}</p>
                      </div>
                    </div>

                    <button 
                      onClick={() => setSelectedArticle(article)}
                      className="text-xs font-bold text-orange-400 group-hover:text-orange-300 flex items-center gap-1 transition-colors outline-none focus-visible:underline"
                    >
                      Read More
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-20 bg-white/5 border border-white/10 rounded-2xl mb-20">
            <AlertCircle className="w-12 h-12 text-orange-400 mx-auto mb-4" />
            <h3 className="text-lg font-bold">No publications match your search</h3>
            <p className="text-gray-400 text-sm max-w-md mx-auto mt-2">
              Try adjusting your category selection, typing different search keywords, or clear filters.
            </p>
            <Button 
              className="mt-6 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg px-6"
              onClick={() => { setSelectedCategory('All'); setSearchQuery('') }}
            >
              Clear Filters
            </Button>
          </div>
        )}

        {/* In-depth Article Reader View (Smooth Single Page Application Modal) */}
        {selectedArticle && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex justify-end transition-opacity duration-300">
            {/* Modal Container */}
            <div className="w-full lg:w-[850px] h-full bg-[hsl(222,47%,8%)] border-l border-white/10 shadow-2xl flex flex-col relative z-20 overflow-y-auto animate-slide-in-right">
              
              {/* Sticky reader header */}
              <div className="sticky top-0 bg-[hsl(222,47%,8%)]/95 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between z-30">
                <div className="flex items-center gap-2">
                  <Badge className="bg-orange-500 text-white text-[10px] tracking-wide uppercase px-2 py-0.5">
                    {selectedArticle.category}
                  </Badge>
                  <span className="text-xs text-gray-400">{selectedArticle.readTime}</span>
                </div>
                <button
                  onClick={() => setSelectedArticle(null)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-colors text-gray-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Reader Body */}
              <div className="p-6 md:p-8 flex flex-col lg:flex-row gap-8 flex-1">
                
                {/* Main Content Area */}
                <div className="lg:w-[500px] shrink-0">
                  <div className="text-xs text-gray-400 flex items-center gap-2 mb-4">
                    <Calendar className="w-3.5 h-3.5 text-orange-400" />
                    <span>{selectedArticle.date}</span>
                    <span>•</span>
                    <span>{selectedArticle.views} views</span>
                  </div>

                  <h2 className="text-2xl md:text-3xl font-black mb-6 leading-tight text-white">
                    {selectedArticle.title}
                  </h2>

                  {/* Graphic layout placeholder */}
                  <div className="relative rounded-xl overflow-hidden aspect-video bg-gradient-to-br from-slate-950 to-slate-900 border border-white/10 flex items-center justify-center p-6 mb-8">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent opacity-70" />
                    <selectedArticle.icon className="w-16 h-16 text-orange-400/20 absolute" />
                    <div className="relative z-10 text-center">
                      <p className="text-xs uppercase tracking-widest text-orange-400 font-bold mb-2">Automotive Intelligence Analysis</p>
                      <h4 className="text-sm font-bold text-gray-300">{selectedArticle.zimbabweanContext?.[0]?.value || 'Local Regulatory Insight'}</h4>
                    </div>
                  </div>

                  {/* Full Text Content */}
                  <div className="space-y-6 text-gray-300 text-sm md:text-base leading-relaxed">
                    {selectedArticle.content.map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>

                  {/* Interaction buttons */}
                  <div className="flex items-center gap-4 mt-10 pt-6 border-t border-white/5">
                    <button 
                      onClick={() => toast.success('Added to bookmarks!')}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-white/5 hover:bg-orange-500/10 hover:text-orange-400 px-3.5 py-2 rounded-lg border border-white/10 hover:border-orange-500/20 transition-all duration-300"
                    >
                      <Bookmark className="w-4 h-4 text-orange-400" />
                      Save Article
                    </button>
                    <button 
                      onClick={() => copyLink(selectedArticle.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-white/5 hover:bg-orange-500/10 hover:text-orange-400 px-3.5 py-2 rounded-lg border border-white/10 hover:border-orange-500/20 transition-all duration-300"
                    >
                      <Share2 className="w-4 h-4 text-orange-400" />
                      Copy Link
                    </button>
                  </div>

                  {/* Comments Section */}
                  <div className="mt-12 pt-8 border-t border-white/10">
                    <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-orange-400" />
                      Audience Discussions ({(comments[selectedArticle.id] || []).length})
                    </h3>

                    {/* New Comment Form */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                      <p className="text-xs font-bold uppercase tracking-wider text-orange-400 mb-3">Add Your Contribution</p>
                      <div className="space-y-3">
                        <Input
                          type="text"
                          placeholder="Your name or organization..."
                          value={newCommentName}
                          onChange={(e) => setNewCommentName(e.target.value)}
                          className="bg-black/20 border-white/10 text-white text-xs"
                        />
                        <textarea
                          placeholder="Share your thoughts or ask compliance questions..."
                          value={newCommentText}
                          onChange={(e) => setNewCommentText(e.target.value)}
                          rows={3}
                          className="w-full bg-black/20 border border-white/10 text-white rounded-md p-2.5 text-xs placeholder-gray-400 focus:outline-none focus:border-orange-500"
                        />
                        <Button 
                          onClick={() => handleAddComment(selectedArticle.id)}
                          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs py-2 rounded-lg gap-2"
                        >
                          <Send className="w-3.5 h-3.5" /> Submit Comment
                        </Button>
                      </div>
                    </div>

                    {/* List comments */}
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                      {(comments[selectedArticle.id] || []).map((cmt, idx) => (
                        <div key={idx} className="bg-white/5 border border-white/5 rounded-lg p-3">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-bold text-orange-300">{cmt.name}</span>
                            <span className="text-gray-400">{cmt.date}</span>
                          </div>
                          <p className="text-gray-300 text-xs leading-relaxed">{cmt.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sidebar details */}
                <div className="flex-1 space-y-6">
                  
                  {/* Author Card */}
                  <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-3">Published By</p>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center font-bold text-white text-sm border border-orange-400/30">
                        {selectedArticle.author.avatar}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">{selectedArticle.author.name}</h4>
                        <p className="text-xs text-orange-400">{selectedArticle.author.role}</p>
                      </div>
                    </div>
                    <p className="text-gray-300 text-xs leading-relaxed">
                      {selectedArticle.author.bio}
                    </p>
                  </div>

                  {/* ZINARA Calculator - only show for Regulations category */}
                  {selectedArticle.category === 'Regulations' && (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                      <h4 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-2">
                        <Calculator className="w-4 h-4" />
                        ZINARA Fee Calculator (2026)
                      </h4>
                      <p className="text-xs text-gray-400 leading-relaxed mb-4">
                        Select your vehicle type to get the standard quarterly licensing rates mandated for 2026.
                      </p>
                      <div className="space-y-3 mb-4">
                        {[
                          { id: 'light', label: 'Light Passenger Car (e.g. Corolla, Fit)' },
                          { id: 'minibus', label: 'Minibus / Kombi (14 Seater)' },
                          { id: 'bus', label: 'Heavy Bus (e.g. Coach)' },
                          { id: 'heavy', label: 'Heavy Haulage Truck (Tri-Axle)' }
                        ].map((choice) => (
                          <label key={choice.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="radio"
                              name="vclass"
                              value={choice.id}
                              checked={vehicleClass === choice.id}
                              onChange={() => setVehicleClass(choice.id)}
                              className="accent-orange-500"
                            />
                            {choice.label}
                          </label>
                        ))}
                      </div>
                      <div className="bg-black/30 rounded-lg p-3 border border-white/5 flex justify-between items-center text-xs">
                        <div>
                          <p className="text-[10px] uppercase text-gray-400">Quarterly License Fee</p>
                          <p className="text-sm font-extrabold text-orange-400 mt-0.5">
                            USD ${calculateFee().usd} <span className="text-gray-400 font-normal">or</span> ZiG {calculateFee().zig}
                          </p>
                        </div>
                        <Badge className="bg-orange-500/10 text-orange-300 border border-orange-500/20 text-[10px]">Official Rates</Badge>
                      </div>
                    </div>
                  )}

                  {/* Share on WhatsApp CTA */}
                  <div className="bg-gradient-to-br from-green-500/10 via-slate-900 to-slate-950 border border-green-500/20 rounded-xl p-5">
                    <h4 className="text-sm font-bold text-green-400 mb-2 flex items-center gap-2">
                      <Share2 className="w-4 h-4" />
                      Send to WhatsApp Groups
                    </h4>
                    <p className="text-xs text-gray-300 leading-relaxed mb-4">
                      Share this crucial automotive guide with your local neighborhood, family, or commuter group instantly.
                    </p>
                    <a 
                      href={`https://wa.me/?text=Check%20out%20this%20article%20on%20CarUp:%20${encodeURIComponent(selectedArticle.title)}%20${encodeURIComponent(window.location.origin + '/blog/' + selectedArticle.id)}`}
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-2 px-3 rounded-lg gap-1.5 transition-colors"
                    >
                      Share on WhatsApp
                    </a>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* Grid of ZIMRA/ZINARA Quick Reference Guide - High fidelity section */}
        <div className="grid lg:grid-cols-12 gap-8 mb-20">
          <div className="lg:col-span-8 bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,16%)] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden">
            {/* Design glow */}
            <div className="absolute top-0 left-0 w-64 h-64 bg-orange-500/5 rounded-full blur-[80px] pointer-events-none" />
            
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-6 border-b border-white/5">
              <div>
                <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs px-2.5 mb-2">Automotive Directory</Badge>
                <h3 className="text-xl md:text-2xl font-bold">Zimbabwean Auto Reference Index</h3>
              </div>
              <BookOpen className="w-8 h-8 text-orange-400/40" />
            </div>

            <div className="relative z-10 grid md:grid-cols-2 gap-6">
              {[
                { title: 'ZIMRA Duties Clearing', desc: 'Pre-clearance processing takes 24-48h at Beitbridge. Original logbook and translation invoice are strictly required.', deadline: 'Required before entry' },
                { title: 'ZINARA Road Licensing', desc: 'Discs are renewable quarterly. Ensure third-party insurance is registered in national electronic databases beforehand.', deadline: 'Quarterly Deadlines' },
                { title: 'Mbudzi Interchange Tolls', desc: 'Integrated with ANPR digital transponders. Cash, USD cards, and ZiG-funded mobile wallets are fully supported.', deadline: 'Real-time billing' },
                { title: 'Emission Audits (2026)', desc: 'Vehicles older than 10 years are subject to computerized tailpipe emission checks during municipal compliance checks.', deadline: 'Annual check-up' }
              ].map((item, idx) => (
                <div key={idx} className="bg-black/20 rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-sm text-white">{item.title}</h4>
                    <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/10">{item.deadline}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick stats / Local Auto Data Panel */}
          <div className="lg:col-span-4 bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,16%)] border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-[60px] pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-orange-400 text-xs font-bold uppercase tracking-wider mb-4">
                <AlertCircle className="w-4 h-4" />
                Live Market Metrics
              </div>
              <h3 className="text-lg font-bold text-white mb-4">Harare Automotive Indices</h3>
              
              <div className="space-y-4">
                {[
                  { label: 'Import Duties (Averaged)', value: '32.5%', trend: '+1.2%', up: true },
                  { label: 'Used Car Trust Score (Avg)', value: '88.4 / 100', trend: '+4.5%', up: true },
                  { label: 'Unverified Mileage Listings', value: '4.2%', trend: '-8.9%', up: false },
                  { label: 'Monthly Registered Vehicles', value: '2,840', trend: '+12.4%', up: true }
                ].map((stat, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs py-2 border-b border-white/5">
                    <span className="text-gray-300">{stat.label}</span>
                    <div className="text-right">
                      <span className="font-bold text-white block">{stat.value}</span>
                      <span className={`text-[10px] font-semibold ${stat.up ? 'text-green-400' : 'text-red-400'}`}>
                        {stat.trend} from last Q
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-10 bg-orange-500/5 rounded-xl p-4 border border-orange-500/10 mt-6 text-center">
              <p className="text-xs text-gray-300 leading-relaxed mb-3">
                Need premium market insights or regulatory evaluations for your fleet?
              </p>
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white w-full text-xs" asChild>
                <Link to="/contact">Request Audit</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Premium Newsletter subscription card */}
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-[hsl(222,47%,10%)] to-[hsl(222,47%,15%)] border border-white/5 p-8 md:p-12 text-center md:text-left">
          {/* Neon background circle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-orange-500/5 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
            <div className="max-w-xl">
              <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 mb-4 px-2.5">Weekly Publication</Badge>
              <h3 className="text-2xl md:text-3xl font-extrabold mb-3">Stay Ahead of the Automotive Curve</h3>
              <p className="text-gray-300 text-sm md:text-base leading-relaxed">
                Join 8,500+ Zimbabwean car owners, dealers, and compliance experts. Receive real-time ZIMRA duty revisions, ZINARA regulation updates, and automotive insights direct to your inbox.
              </p>
            </div>

            <div className="w-full lg:w-96">
              {!isSubscribed ? (
                <form onSubmit={handleNewsletterSubmit} className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Enter your email address..."
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                    required
                    className="bg-white/5 border-white/10 text-white placeholder-gray-400 focus-visible:ring-orange-500/50"
                  />
                  <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white shrink-0 font-semibold rounded-lg px-5">
                    Subscribe
                  </Button>
                </form>
              ) : (
                <div className="bg-green-500/10 border border-green-500/20 text-green-300 rounded-xl p-4 flex items-center justify-center gap-2">
                  <Check className="w-5 h-5 shrink-0 text-green-400" />
                  <span className="text-sm font-bold">Successfully joined the mailing list!</span>
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-2.5 text-center lg:text-left">
                No spam. Unsubscribe anytime. SADC compliance standards verified.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
