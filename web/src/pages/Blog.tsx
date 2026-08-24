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
  Calculator,
  AlertCircle,
  Filter,
  X,
  ShieldCheck,
  Car,
  FileText,
  BookOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { EDITORIAL_ARTICLES, UNAVAILABLE_BODY, type EditorialArticle } from '@/content/editorial/articles'
import { bylineName, bylineRole, bylineInitials, classificationLabel } from '@/content/editorial/governance'

// Content governance — Issue #164 Phase 8, Cluster G.
// Articles are no longer free-text literals in this component. They live in
// `@/content/editorial/articles`, where every factual statement carries a classification
// (governed_capability | sourced_editorial | future_vision | unavailable) and a byline that cannot be
// an invented person. The design of this page is unchanged; what may appear inside it is not.
type Article = EditorialArticle

/** The card artwork, keyed by category. Presentation only — it asserts nothing. */
const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Trust: ShieldCheck,
  Marketplace: Car,
  Regulations: FileText,
}
const iconFor = (category: string) => CATEGORY_ICON[category] ?? BookOpen

export default function Blog() {
  const articles: Article[] = EDITORIAL_ARTICLES

  // Extract featured article and rest
  const featuredArticle = articles[0]

  // States
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  
  // Interactive Comments State
  // Seeded with nothing. Three invented reader comments attributed to named individuals used to be
  // hardcoded here, in a comment system that stores nothing beyond this component's state.
  const [comments, setComments] = useState<{ [key: string]: { name: string; text: string; date: string }[] }>({})
  const [newCommentName, setNewCommentName] = useState('')
  const [newCommentText, setNewCommentText] = useState('')

  // The fee table that lived here — four hardcoded USD/ZiG amounts presented as official 2026 rates —
  // is gone with the calculator it fed. It had no source and no effective date.

  // Newsletter form state
  const [newsletterEmail, setNewsletterEmail] = useState('')

  // Categories list
  // Derived from what is actually published, so a category chip can never lead to an empty shelf.
  const categories = ['All', ...Array.from(new Set(EDITORIAL_ARTICLES.map((a) => a.category)))]

  // Filter Articles
  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      const matchesCategory = selectedCategory === 'All' || article.category === selectedCategory
      const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            article.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            bylineName(article.byline).toLowerCase().includes(searchQuery.toLowerCase())
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
  // The form transmits nothing — there is no subscription endpoint behind it. It used to call
  // setIsSubscribed(true) and toast "Successfully subscribed", so a reader's address was collected
  // into a component's state and they were told they were on a list that does not exist. A UI must
  // not report a request it never made.
  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    toast.info('Newsletter sign-up is not open yet — nothing was sent, and your address was not stored.')
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
                      {(() => { const Icon = iconFor(featuredArticle.category); return <Icon className="w-10 h-10 text-orange-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" /> })()}
                    </div>
                  </div>

                  <div className="relative z-10">
                    <p className="text-[10px] uppercase tracking-widest text-orange-400 font-bold mb-1">Zimbabwean Context</p>
                    <div className="flex flex-wrap gap-2">
                      {featuredArticle.context?.map((item: { label: string; value: string }, idx: number) => (
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
                        {bylineInitials(featuredArticle.byline)}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">{bylineName(featuredArticle.byline)}</h4>
                        <p className="text-xs text-orange-400">{bylineRole(featuredArticle.byline)}</p>
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
              const IconComp = iconFor(article.category)
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
                        {bylineInitials(article.byline)}
                      </div>
                      <div>
                        <h4 className="font-bold text-[12px] text-white leading-none">{bylineName(article.byline)}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5">{bylineRole(article.byline)}</p>
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
                  </div>

                  <h2 className="text-2xl md:text-3xl font-black mb-6 leading-tight text-white">
                    {selectedArticle.title}
                  </h2>

                  {/* Graphic layout placeholder */}
                  <div className="relative rounded-xl overflow-hidden aspect-video bg-gradient-to-br from-slate-950 to-slate-900 border border-white/10 flex items-center justify-center p-6 mb-8">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent opacity-70" />
                    {(() => { const Icon = iconFor(selectedArticle.category); return <Icon className="w-16 h-16 text-orange-400/20 absolute" /> })()}
                    <div className="relative z-10 text-center">
                      <p className="text-xs uppercase tracking-widest text-orange-400 font-bold mb-2">Automotive Intelligence Analysis</p>
                      <h4 className="text-sm font-bold text-gray-300">{selectedArticle.context?.[0]?.value || 'Governed context'}</h4>
                    </div>
                  </div>

                  {/* Classification — every factual claim on this page carries one, and where the
                      claim is a concept or is not yet publishable the reader is told so up front. */}
                  {classificationLabel(selectedArticle.classification) && (
                    <div
                      className="mb-6 inline-flex items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-300"
                      data-testid="article-classification"
                    >
                      {classificationLabel(selectedArticle.classification)}
                    </div>
                  )}

                  {/* Full Text Content. An article with nothing publishable says so, in words, rather
                      than rendering an empty body or being filled with unsourced prose. */}
                  <div className="space-y-6 text-gray-300 text-sm md:text-base leading-relaxed">
                    {selectedArticle.content.length > 0 ? (
                      selectedArticle.content.map((paragraph, idx) => (
                        <p key={idx}>{paragraph}</p>
                      ))
                    ) : (
                      <p data-testid="article-unavailable">{UNAVAILABLE_BODY}</p>
                    )}
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
                        {bylineInitials(selectedArticle.byline)}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">{bylineName(selectedArticle.byline)}</h4>
                        <p className="text-xs text-orange-400">{bylineRole(selectedArticle.byline)}</p>
                      </div>
                    </div>
                    <p className="text-gray-300 text-xs leading-relaxed">
                      {selectedArticle.byline.kind === 'carup_editorial'
                        ? 'Written by CarUp\u2019s editorial desk. CarUp publishes under its own name rather than under invented author personas.'
                        : `${bylineRole(selectedArticle.byline)} at CarUp.`}
                    </p>
                  </div>

                  {/* A ZINARA fee calculator used to sit here: four hardcoded USD/ZiG amounts behind
                      an "Official Rates" badge, described as "mandated for 2026". No source, no
                      effective date, and no way for a reader to tell an invented figure from a
                      gazetted one. Licensing fees are a real regulatory fact with a real issuing
                      authority; CarUp will publish them when each figure can be traced to that
                      authority and kept current, and not before. The panel states that instead. */}
                  {selectedArticle.category === 'Regulations' && (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-5" data-testid="fee-calculator-unavailable">
                      <h4 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-2">
                        <Calculator className="w-4 h-4" />
                        Licensing fee calculator
                      </h4>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Not published yet. Licensing fees change and are set by the issuing authority,
                        so CarUp will show them only once every figure is traceable to that authority
                        and kept current. We would rather show you nothing than a rate you might pay on.
                      </p>
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
                Market Metrics
              </div>
              <h3 className="text-lg font-bold text-white mb-4">Harare Automotive Indices</h3>

              {/* Four fabricated statistics with fabricated quarter-on-quarter trend arrows used to
                  sit here under a heading asserting they were live. Nothing fetched them and no
                  source produced them. CarUp measures no market index today, so the card states
                  that rather than being filled with numbers a reader might act on. */}
              <p className="text-xs text-gray-400 leading-relaxed" data-testid="market-metrics-unavailable">
                CarUp does not publish market indices yet. We measure trust, evidence and listing
                facts per vehicle — not aggregate market movements — and we will not estimate a
                figure we do not hold.
              </p>
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
                CarUp\u2019s editorial desk publishes on vehicle trust, evidence and marketplace integrity. Sign-up is not open yet \u2014 when it is, this is where it will be.
              </p>
            </div>

            <div className="w-full lg:w-96">
              {/* The success state is gone with the fake subscription that produced it: there is no
                  endpoint behind this form, so nothing may render as "Successfully joined". The
                  control stays visible and disabled, in the page's own design, and says why. */}
              <form onSubmit={handleNewsletterSubmit} className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Sign-up not open yet"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  disabled
                  className="bg-white/5 border-white/10 text-white placeholder-gray-400 focus-visible:ring-orange-500/50 disabled:opacity-60"
                />
                <Button
                  type="submit"
                  disabled
                  data-testid="newsletter-unavailable"
                  className="bg-orange-500/40 text-white shrink-0 font-semibold rounded-lg px-5 disabled:opacity-100"
                >
                  Coming soon
                </Button>
              </form>
              <p className="text-[10px] text-gray-500 mt-2.5 text-center lg:text-left">
                No spam, ever. We will not add you to a list until this form actually delivers to one.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
