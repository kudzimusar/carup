import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Search, 
  ChevronDown, 
  MessageSquare, 
  ArrowRight, 
  Mail, 
  ShieldCheck, 
  ShoppingBag, 
  Tag, 
  Wrench, 
  Building, 
  Coins, 
  HelpCircle, 
  Check, 
  Sparkles,
  RefreshCw
} from 'lucide-react'
import { PUBLIC_CONTACTS, PUBLIC_LOCATION_LINE } from '@/config/publicIdentity'

// Realistic Zimbabwe-focused FAQ database
interface FAQ {
  id: string;
  category: 'buyer' | 'seller' | 'mechanic' | 'dealer' | 'security' | 'payments';
  question: string;
  answer: string;
  tags: string[];
}

const FAQS: FAQ[] = [
  {
    id: 'faq-1',
    category: 'security',
    question: 'How does CarUp verify vehicle history in Zimbabwe?',
    answer: 'CarUp is not connected to ZINARA, the CVR, an insurance database or any other authority, so it cross-references nothing with them. Its Trust position reflects the documents a seller supplied and its own review of them. Confirming registration, licensing or insurance remains something you should do directly with the relevant body.',
    tags: ['ZINARA', 'history', 'VIN', 'verification', 'CVR']
  },
  {
    id: 'faq-2',
    category: 'security',
    question: 'Is the CarUp trust score legally binding?',
    answer: 'The Trust position describes how much confidence CarUp places in the evidence it holds about a vehicle. CarUp performs no face-match or biometric identity check, and it makes no claim that anything uploaded to it is legally binding. Treat it as documentation, not as a warranty.',
    tags: ['trust score', 'legal', 'KYC', 'compliance']
  },
  {
    id: 'faq-3',
    category: 'payments',
    question: 'What payment options are accepted in Zimbabwe?',
    answer: 'CarUp prices its own subscription plans and reports in USD and ZiG, but no online payment method — card, EcoCash, InnBucks, ZIPIT or RTGS — is live on CarUp yet, so nothing can be paid through CarUp today. For a vehicle purchase, money moves directly between buyer and seller: CarUp is non-custodial, holds no funds, has no trust account, and its escrow feature runs against a sandbox provider only — no live payment has ever been processed through it.',
    tags: ['ZiG', 'USD', 'Ecocash', 'InnBucks', 'payments', 'fees']
  },
  {
    id: 'faq-4',
    category: 'dealer',
    question: 'How do I register a dealership on CarUp?',
    answer: 'Dealerships can register through the Dealer Registration portal and upload their company documents. CarUp does not visit business premises, operates no physical audit, and has no financing arrangement with any bank — so registration establishes an account, not an endorsement.',
    tags: ['dealer', 'Harare', 'Bulawayo', 'CR14', 'financing']
  },
  {
    id: 'faq-5',
    category: 'buyer',
    question: 'Can I list an imported vehicle that has not yet arrived in Zimbabwe?',
    answer: 'Yes, you can list transit vehicles under the \'In Transit\' category, and you should attach the export certificate, bill of lading and auction sheets so a buyer can read them. CarUp does not verify mileage or condition from those documents and runs no check before a listing goes live — the documents are shown to buyers, not adjudicated.',
    tags: ['import', 'Japan', 'Beira', 'transit', 'auction sheets']
  },
  {
    id: 'faq-6',
    category: 'mechanic',
    question: 'What is the PartSentry ledger, and how does it protect my car?',
    answer: 'PartSentry records a part change against a vehicle: what was replaced, by whom, and at what odometer reading. It records what a mechanic entered — it does not inspect the part, authenticate it, or prevent a counterfeit being fitted or sold. Entries are signed so a later edit is detectable, and a reviewed entry can become governed evidence that informs the vehicle\'s Trust position.',
    tags: ['PartSentry', 'mechanics', 'parts', 'audit ledger', 'maintenance']
  },
  {
    id: 'faq-7',
    category: 'seller',
    question: 'How do I clear my ZINARA licensing arrears through CarUp?',
    answer: 'You cannot. CarUp has no connection to ZINARA, cannot read arrears or licensing status, and cannot take a payment for road tax — it holds no money at all. Road tax remains something you settle with ZINARA directly.',
    tags: ['ZINARA', 'logbook', 'licensing', 'arrears', 'OCR']
  },
  {
    id: 'faq-8',
    category: 'buyer',
    question: 'What is a Verified Buyer status and how do I get it?',
    answer: 'Adding a phone number and national ID to your profile gives a seller more to go on. CarUp publishes no figure for how much it changes seller behaviour, because it does not measure that, and it has no bank financing scheme to unlock.',
    tags: ['verification', 'ID', 'buyer', 'financing']
  },
  {
    id: 'faq-9',
    category: 'mechanic',
    question: 'How do independent garages join the CarUp Mechanic network?',
    answer: 'Independent mechanics can apply through the Mechanic Directory with their trade certifications and garage address. CarUp does not inspect a garage or accredit anyone, and it awards no reputation points — listing creates a directory entry and access to write repair records, not an endorsement.',
    tags: ['mechanics', 'garages', 'PartSentry', 'accreditation']
  }
];

const CATEGORIES = [
  {
    id: 'buyer',
    title: 'For Car Buyers',
    desc: 'Trust positions, imported vehicles and the records CarUp holds.',
    icon: ShoppingBag,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    hoverBorderColor: 'hover:border-orange-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(249,115,22,0.15)]',
    badge: 'Buyers'
  },
  {
    id: 'seller',
    title: 'For Car Sellers',
    desc: 'Logbook upload, listing your vehicle, and the records CarUp holds for it.',
    icon: Tag,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    hoverBorderColor: 'hover:border-amber-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(245,158,11,0.15)]',
    badge: 'Sellers'
  },
  {
    id: 'mechanic',
    title: 'For Mechanics',
    desc: 'PartSentry audit ledger registration, service logs & client work orders.',
    icon: Wrench,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    hoverBorderColor: 'hover:border-emerald-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]',
    badge: 'Mechanics'
  },
  {
    id: 'dealer',
    title: 'For Dealerships',
    desc: 'Bulk inventory management, verified dealership status, premium leads & CRM integration.',
    icon: Building,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    hoverBorderColor: 'hover:border-blue-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]',
    badge: 'Dealers'
  },
  {
    id: 'security',
    title: 'Trust & Security',
    desc: 'Account security, and the signed internal record CarUp keeps of changes.',
    icon: ShieldCheck,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    hoverBorderColor: 'hover:border-rose-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(244,63,94,0.15)]',
    badge: 'Security'
  },
  {
    id: 'payments',
    title: 'Payments & Fees',
    desc: 'USD and ZiG pricing for CarUp plans. No online payment method is live yet, and CarUp holds no funds.',
    icon: Coins,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    hoverBorderColor: 'hover:border-yellow-500/40',
    glowColor: 'hover:shadow-[0_0_30px_rgba(234,179,8,0.15)]',
    badge: 'Finance'
  }
];


/**
 * The answers the old keyword "chat" gave, kept because they are accurate — but presented as what
 * they are: fixed text, not an assistant that is online.
 */
const STRAIGHT_ANSWERS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'Can CarUp check road tax or registration with ZINARA or the CVR?',
    answer: 'No. CarUp is not connected to ZINARA or the CVR, so it cannot look up road tax arrears, take a payment, or register anything with them. Please deal with ZINARA directly.',
  },
  {
    question: 'How do I list a vehicle that is still in transit from Japan?',
    answer: 'Transit vehicles can be listed under the "In Transit" tag, and you should attach the export certificate and auction sheets so buyers can read them. CarUp does not scan those documents to confirm mileage and cannot detect an odometer rollback.',
  },
  {
    question: 'What does PartSentry record?',
    answer: 'PartSentry records a part change against a vehicle — what was replaced, by whom, and at what odometer reading. It records what a mechanic entered; it does not inspect or authenticate the part, and it guarantees nothing about whether a component is genuine.',
  },
  {
    question: 'Where does a Trust position come from?',
    answer: 'A Trust position reflects the evidence CarUp holds about a vehicle — the documents supplied and CarUp\u2019s own review of them. It is not derived from ZINARA or any registry, because CarUp is connected to none, and CarUp makes no claim that records held here are legally binding.',
  },
  {
    question: 'Can I pay through CarUp?',
    answer: 'Not yet. CarUp prices its plans and reports in USD and ZiG, but no online payment method — card, EcoCash, InnBucks, ZIPIT or RTGS — is live, so nothing can be paid through CarUp today. Vehicle deals are settled directly between buyer and seller, and CarUp holds no funds.',
  },
  {
    question: 'How does a dealership join CarUp?',
    answer: 'Create an account, then upload your company documents in the dealer onboarding flow. CarUp does not visit premises and has no bank financing integration, so registration creates an account rather than an endorsement.',
  },
]

export default function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  
  // Filter FAQs based on search and selected category
  const filteredFaqs = useMemo(() => {
    return FAQS.filter(faq => {
      const matchesCategory = selectedCategory ? faq.category === selectedCategory : true;
      const matchesSearch = searchQuery
        ? faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
          faq.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
        : true;
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const handleTagClick = (tag: string) => {
    setSearchQuery(tag);
    setSelectedCategory(null);
  };

  const handleCategorySelect = (categoryId: string) => {
    if (selectedCategory === categoryId) {
      setSelectedCategory(null); // Deselect if already selected
    } else {
      setSelectedCategory(categoryId);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    setOpenFaqId(null);
  };

  return (
    <div className="min-h-screen bg-[hsl(222,47%,6%)] text-gray-100 overflow-x-hidden relative">
      
      {/* Decorative ambient background glows */}
      <div className="absolute top-[20%] left-[-10%] w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[-10%] w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Hero Search Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[hsl(222,47%,10%)] via-[hsl(222,47%,12%)] to-[hsl(222,35%,16%)] border-b border-[hsl(222,47%,16%)] py-20 lg:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent pointer-events-none" />
        <div className="section-padding mx-auto max-w-[1440px] px-6 text-center relative z-10">
          <Badge className="mb-6 bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30 px-3 py-1 font-medium tracking-wide">
            Automotive Intelligence Hub
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
            How can we{' '}
            <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent">
              help you
            </span>{' '}
            today?
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto mb-10 text-base md:text-lg leading-relaxed">
            Answers about what CarUp records for a vehicle, how Trust is derived, and what CarUp cannot do for you.
          </p>

          {/* Premium Glowing Search Bar */}
          <div className="max-w-2xl mx-auto mb-6 relative">
            <div className="absolute inset-0 bg-orange-500/10 rounded-full blur-md opacity-75 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
            <div className="relative flex items-center bg-[hsl(222,47%,10%)] border border-[hsl(222,47%,18%)] rounded-full px-6 py-2 shadow-2xl focus-within:border-orange-500/50 focus-within:ring-2 focus-within:ring-orange-500/20 transition-all duration-300 group">
              <Search className="w-6 h-6 text-gray-400 mr-3 shrink-0" />
              <Input
                type="text"
                placeholder="Search history reports, ZINARA, imported cars, PartSentry ledger..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-500 text-gray-100 w-full text-base h-12"
              />
              {searchQuery && (
                <button 
                  onClick={handleResetFilters}
                  className="text-xs text-gray-400 hover:text-orange-400 transition-colors uppercase font-semibold mr-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Popular Tag suggestions */}
          <div className="flex flex-wrap items-center justify-center gap-3 max-w-xl mx-auto mt-4 text-sm text-gray-400">
            <span className="font-medium text-gray-500 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-orange-400" /> Popular searches:
            </span>
            {[
              'ZINARA clearance',
              'PartSentry',
              'Transit imports',
              'ZiG payments',
              'Trust score calculation'
            ].map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className="min-h-11 sm:min-h-0 px-3 py-1.5 rounded-full bg-[hsl(222,47%,12%)] border border-[hsl(222,47%,20%)] text-xs text-gray-300 hover:text-orange-400 hover:border-orange-500/30 transition-all duration-200"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Category Browser Grid */}
      <section className="py-20 bg-[hsl(222,47%,6%)] relative">
        <div className="section-padding mx-auto max-w-[1440px] px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-4 px-3 py-1">
              Category Browser
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Browse by Automotive Pillar</h2>
            <p className="text-gray-400 leading-relaxed text-sm md:text-base">
              Select a specialized category below to instantly filter down our intelligence base to your exact interest.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CATEGORIES.map((cat) => {
              const IconComponent = cat.icon;
              const isActive = selectedCategory === cat.id;
              
              return (
                <div
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`cursor-pointer rounded-xl border p-6 transition-all duration-300 group flex flex-col justify-between ${
                    isActive 
                      ? `${cat.bgColor} border-orange-500 ring-1 ring-orange-500/30 shadow-[0_0_25px_rgba(249,115,22,0.1)] scale-[1.02]` 
                      : `bg-[hsl(222,47%,10%)] border-[hsl(222,47%,16%)] ${cat.hoverBorderColor} ${cat.glowColor} hover:-translate-y-1`
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-12 h-12 rounded-xl ${cat.bgColor} flex items-center justify-center border ${cat.borderColor} group-hover:scale-110 transition-transform duration-300`}>
                        <IconComponent className={`w-6 h-6 ${cat.color}`} />
                      </div>
                      <Badge variant="outline" className={`${isActive ? 'bg-orange-500 text-white' : 'text-gray-400 border-gray-700'} text-[10px]`}>
                        {cat.badge}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-bold mb-2 group-hover:text-orange-300 transition-colors">
                      {cat.title}
                    </h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      {cat.desc}
                    </p>
                  </div>
                  
                  <div className="mt-6 flex items-center justify-between text-xs font-semibold text-gray-500">
                    <span className="text-orange-400/80 group-hover:text-orange-400 transition-colors flex items-center gap-1">
                      {isActive ? 'Active Filter' : 'Explore FAQs'} 
                      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                    </span>
                    {isActive && (
                      <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Selected
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Accordion FAQ List */}
      <section className="py-16 bg-[hsl(222,47%,8%)] border-t border-b border-[hsl(222,47%,16%)]">
        <div className="section-padding mx-auto max-w-[4xl] max-w-[960px] px-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 pb-4 border-b border-[hsl(222,47%,20%)] gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <HelpCircle className="w-6 h-6 text-orange-400" /> 
                {selectedCategory 
                  ? `${CATEGORIES.find(c => c.id === selectedCategory)?.title} FAQs` 
                  : 'Popular FAQ Database'
                }
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Showing {filteredFaqs.length} of {FAQS.length} registered guidelines
              </p>
            </div>
            
            {(searchQuery || selectedCategory) && (
              <Button 
                onClick={handleResetFilters} 
                variant="outline" 
                size="sm" 
                className="text-xs border-[hsl(222,47%,20%)] hover:bg-[hsl(222,47%,12%)] hover:border-orange-500/50 text-gray-300 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reset Filters
              </Button>
            )}
          </div>

          {filteredFaqs.length > 0 ? (
            <div className="space-y-4">
              {filteredFaqs.map((faq) => {
                const isOpen = openFaqId === faq.id;
                const faqCat = CATEGORIES.find(c => c.id === faq.category);
                
                return (
                  <div
                    key={faq.id}
                    className={`rounded-lg border transition-all duration-300 ${
                      isOpen 
                        ? 'bg-[hsl(222,47%,12%)] border-orange-500/40 shadow-lg shadow-orange-500/5' 
                        : 'bg-[hsl(222,47%,10%)] border-[hsl(222,47%,18%)] hover:border-[hsl(222,47%,24%)]'
                    }`}
                  >
                    <button
                      onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                      className="w-full flex items-center justify-between px-6 py-5 text-left transition-all duration-200"
                    >
                      <div className="flex items-start gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-2 ${
                          faq.category === 'buyer' ? 'bg-orange-400' :
                          faq.category === 'seller' ? 'bg-amber-400' :
                          faq.category === 'mechanic' ? 'bg-emerald-400' :
                          faq.category === 'dealer' ? 'bg-blue-400' :
                          faq.category === 'security' ? 'bg-rose-400' : 'bg-yellow-400'
                        }`} />
                        <div>
                          <span className="text-xs uppercase tracking-wider font-semibold text-gray-500 block mb-1">
                            {faqCat?.title || faq.category}
                          </span>
                          <h3 className={`text-base font-semibold md:text-lg transition-colors ${isOpen ? 'text-orange-400' : 'text-gray-100'}`}>
                            {faq.question}
                          </h3>
                        </div>
                      </div>
                      
                      <div className={`p-1.5 rounded-full border bg-[hsl(222,47%,8%)] transition-transform duration-300 ${
                        isOpen ? 'rotate-180 border-orange-500/30 text-orange-400' : 'border-gray-800 text-gray-400'
                      }`}>
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </button>

                    {/* Animated Accordion Content */}
                    <div 
                      className={`overflow-hidden transition-all duration-300 ${
                        isOpen ? 'max-h-[500px] border-t border-[hsl(222,47%,18%)] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="px-6 py-5 text-sm md:text-base text-gray-300 leading-relaxed">
                        <p className="mb-4">{faq.answer}</p>
                        
                        {/* Render Tags */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {faq.tags.map((tag) => (
                            <Badge 
                              key={tag} 
                              variant="secondary" 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTagClick(tag);
                              }}
                              className="bg-[hsl(222,47%,8%)] hover:bg-orange-500/20 text-[10px] text-gray-400 hover:text-orange-300 cursor-pointer border border-gray-800 transition-colors"
                            >
                              #{tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 bg-[hsl(222,47%,10%)] border border-[hsl(222,47%,18%)] rounded-lg">
              <HelpCircle className="w-12 h-12 text-orange-500/40 mx-auto mb-4" />
              <h3 className="text-lg font-bold mb-2">No matching FAQs found</h3>
              <p className="text-gray-500 max-w-md mx-auto mb-6 text-sm">
                We couldn't find any guidelines matching your query "<span className="text-orange-400 font-semibold">{searchQuery}</span>" {selectedCategory && `in ${selectedCategory}`}.
              </p>
              <Button 
                onClick={handleResetFilters} 
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                Clear Search & Filters
              </Button>
            </div>
          )}
        </div>
      </section>

      {/*
        Still need help — PC01-J-R1. This section used to present a keyword-matching simulator as
        "Gutu AI Support Assistant — Online & Ready to Guide", promise a support ticket and a "Harare
        support squad", and publish a "CarUp Zimbabwe HQ" card with a hotline, a showroom and opening
        hours. None of those exists. The simulator's answers were accurate, so they are kept — as fixed
        answers that say what they are — and the contact card now carries only real addresses.
      */}
      <section className="py-16 sm:py-20 bg-[hsl(222,47%,6%)] relative z-10" data-testid="help-still-need-help">
        <div className="section-padding mx-auto max-w-[1440px] px-6">
          <div className="grid lg:grid-cols-12 gap-8 items-start">

            <div className="lg:col-span-5 space-y-6">
              <div>
                <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 mb-4">
                  Support
                </Badge>
                <h2 className="text-3xl font-bold leading-tight mb-4">Still need help?</h2>
                <p className="text-gray-400 leading-relaxed text-sm md:text-base">
                  Write to CarUp Support with what you were trying to do and what happened instead — a listing
                  link, an order reference or the email address on your account helps the team find it. CarUp
                  publishes no telephone line, opening hours or response time.
                </p>
              </div>

              <Card className="border border-[hsl(222,47%,16%)] bg-[hsl(222,47%,10%)] text-gray-200 py-0" data-testid="help-contact-card">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-bold text-lg text-white border-b border-[hsl(222,47%,20%)] pb-2 flex items-center gap-2">
                    <Mail className="w-5 h-5 text-orange-400" aria-hidden="true" /> How to reach CarUp
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="font-semibold text-gray-300">Help with an account, a listing or an order</p>
                      <a className="inline-flex min-h-11 items-center break-all text-orange-300 underline" href={`mailto:${PUBLIC_CONTACTS.support}`}>
                        {PUBLIC_CONTACTS.support}
                      </a>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-300">A suspicious message or a security concern</p>
                      <a className="inline-flex min-h-11 items-center break-all text-orange-300 underline" href={`mailto:${PUBLIC_CONTACTS.security}`}>
                        {PUBLIC_CONTACTS.security}
                      </a>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-300">Where CarUp is</p>
                      <p className="text-gray-400">{PUBLIC_LOCATION_LINE}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="p-6 rounded-xl bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-transparent border border-orange-500/20 shadow-xl flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-orange-400" aria-hidden="true" />
                </div>
                <div>
                  <h4 className="font-bold text-white mb-1">Every contact address, by purpose</h4>
                  <p className="text-xs text-gray-400 leading-relaxed mb-3">
                    Privacy requests, legal questions, press and general correspondence each have their own address.
                  </p>
                  <Button size="sm" className="min-h-11 sm:min-h-9 bg-orange-500 hover:bg-orange-600 text-white font-semibold flex items-center gap-1.5" asChild>
                    <Link to="/contact">
                      Contact CarUp <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <Card className="border border-[hsl(222,47%,16%)] bg-[hsl(222,47%,10%)] overflow-hidden shadow-2xl py-0 gap-0" data-testid="help-straight-answers">
                <div className="bg-[hsl(222,47%,12%)] px-6 py-4 border-b border-[hsl(222,47%,18%)]">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-orange-400" aria-hidden="true" /> Straight answers
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">Fixed answers written by CarUp. This is not a live chat.</p>
                </div>
                <dl className="divide-y divide-[hsl(222,47%,16%)]">
                  {STRAIGHT_ANSWERS.map(({ question, answer }) => (
                    <div key={question} className="px-6 py-4">
                      <dt className="text-sm font-semibold text-white">{question}</dt>
                      <dd className="mt-1.5 text-sm leading-relaxed text-gray-300">{answer}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>

          </div>
        </div>
      </section>
      
    </div>
  )
}
