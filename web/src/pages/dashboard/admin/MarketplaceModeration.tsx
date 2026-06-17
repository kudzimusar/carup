import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ShieldAlert, CheckCircle, XCircle, Flag, EyeOff, FileQuestion, ShieldCheck, Sparkles } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errorMessage'

interface AdminListing {
  vin: string
  make: string
  model: string
  year: number
  price: number
  currency: string
  trust_score: number
  public_status: string
  risk_status: string
  marketplace_tags?: string[]
}
interface AdminInquiry {
  id: string
  listing_id?: string | null
  inquiry_type: string
  status: string
  risk_status?: string
  contact_email?: string | null
  contact_phone?: string | null
  referral_attributed?: boolean
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  public: 'bg-green-500', pending_review: 'bg-amber-500', suppressed: 'bg-orange-500',
  rejected: 'bg-red-500', archived: 'bg-gray-400',
}

export default function MarketplaceModeration() {
  const {
    fetchAdminMarketplaceListings, moderateMarketplaceListing,
    fetchAdminMarketplaceInquiries, setMarketplaceInquiryStatus,
    fetchMarketplaceAnalytics, marketplaceAiModerationSummary,
  } = useCarUpApi()

  const [listings, setListings] = useState<AdminListing[]>([])
  const [inquiries, setInquiries] = useState<AdminInquiry[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [inquiriesNote, setInquiriesNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, a] = await Promise.allSettled([fetchAdminMarketplaceListings(), fetchMarketplaceAnalytics()])
      if (l.status === 'fulfilled') setListings(l.value.listings || [])
      if (a.status === 'fulfilled') setAnalytics(a.value)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load moderation queue'))
    } finally {
      setLoading(false)
    }
    try {
      const inq = await fetchAdminMarketplaceInquiries()
      setInquiries(inq.inquiries || [])
      setInquiriesNote(null)
    } catch {
      setInquiriesNote('Inquiries are unavailable until the marketplace_inquiries migration is applied.')
    }
  }, [fetchAdminMarketplaceListings, fetchMarketplaceAnalytics, fetchAdminMarketplaceInquiries])

  useEffect(() => { load() }, [load])

  const moderate = async (vin: string, action: 'approve' | 'suppress' | 'reject' | 'flag-risk' | 'clear-risk' | 'request-evidence') => {
    let reason: string | undefined
    if (['suppress', 'reject', 'flag-risk'].includes(action)) {
      reason = window.prompt(`Reason for ${action}?`) || undefined
      if (!reason) { toast.error('A reason is required for this action.'); return }
    }
    try {
      await moderateMarketplaceListing(vin, action, { reason })
      toast.success(`Listing ${action} applied`)
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Moderation action failed'))
    }
  }

  const aiSummary = async (vin: string) => {
    try {
      const res = await marketplaceAiModerationSummary({ vin })
      toast.message(res.ai_available ? 'AI moderation summary' : 'Moderation summary (deterministic)', { description: `${res.summary} · suggested: ${res.suggested_action}` })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Summary unavailable'))
    }
  }

  const updateInquiry = async (id: string, status: string) => {
    try {
      await setMarketplaceInquiryStatus(id, status)
      toast.success(`Inquiry marked ${status}`)
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update inquiry'))
    }
  }

  const counts = analytics?.listings || {
    total: listings.length,
    public: listings.filter((l) => l.public_status === 'public').length,
    suppressed: listings.filter((l) => l.public_status === 'suppressed').length,
    rejected: listings.filter((l) => l.public_status === 'rejected').length,
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto" data-testid="marketplace-moderation-page">
      <div>
        <h1 className="text-2xl font-bold">Marketplace Command Center</h1>
        <p className="text-gray-500">Govern public visibility, trust suppression, and buyer inquiries.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4" data-testid="marketplace-admin-analytics">
        <StatCard label="Total" value={counts.total} color="text-blue-600" />
        <StatCard label="Public" value={counts.public} color="text-green-600" />
        <StatCard label="Suppressed" value={counts.suppressed} color="text-orange-600" />
        <StatCard label="Rejected" value={counts.rejected} color="text-red-600" />
        <StatCard label="Inquiries" value={analytics?.inquiries?.total ?? inquiries.length} color="text-purple-600" />
      </div>

      <Tabs defaultValue="listings">
        <TabsList>
          <TabsTrigger value="listings" data-testid="marketplace-admin-tab-listings">Listings</TabsTrigger>
          <TabsTrigger value="inquiries" data-testid="marketplace-admin-tab-inquiries">Inquiries</TabsTrigger>
        </TabsList>

        <TabsContent value="listings" className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-0 card-shadow"><CardContent className="p-5"><Skeleton className="h-5 w-64" /></CardContent></Card>
            ))
          ) : listings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No listings found.</div>
          ) : listings.map((l) => (
            <Card key={l.vin} className="border-0 card-shadow" data-testid="marketplace-admin-listing">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{l.year} {l.make} {l.model}</h3>
                      <Badge className={STATUS_COLORS[l.public_status] || 'bg-gray-400'}>{l.public_status}</Badge>
                      {l.risk_status !== 'clear' && <Badge variant="outline" className="border-orange-300 text-orange-700">risk: {l.risk_status}</Badge>}
                    </div>
                    <p className="text-sm text-gray-600">{l.currency} {l.price?.toLocaleString()} · Trust {l.trust_score} · {l.vin}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => aiSummary(l.vin)} title="AI summary"><Sparkles className="w-4 h-4 text-orange-500" /></Button>
                    <Button size="sm" variant="outline" className="text-green-600" onClick={() => moderate(l.vin, 'approve')} data-testid="marketplace-moderate-approve"><CheckCircle className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" className="text-orange-600" onClick={() => moderate(l.vin, 'suppress')} data-testid="marketplace-moderate-suppress"><EyeOff className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => moderate(l.vin, 'reject')} data-testid="marketplace-moderate-reject"><XCircle className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" className="text-amber-600" onClick={() => moderate(l.vin, 'flag-risk')}><Flag className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => moderate(l.vin, 'request-evidence')} title="Request evidence"><FileQuestion className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => moderate(l.vin, 'clear-risk')} title="Clear risk"><ShieldCheck className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="inquiries" className="space-y-3" data-testid="marketplace-admin-inquiries">
          {inquiriesNote ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{inquiriesNote}</div>
          ) : inquiries.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No inquiries yet.</div>
          ) : inquiries.map((inq) => (
            <Card key={inq.id} className="border-0 card-shadow">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-gray-400" />
                      <h3 className="font-medium">{inq.inquiry_type.replace(/_/g, ' ')}</h3>
                      <Badge variant="secondary">{inq.status}</Badge>
                      {inq.risk_status && inq.risk_status !== 'clear' && <Badge variant="outline" className="border-orange-300 text-orange-700">{inq.risk_status}</Badge>}
                      {inq.referral_attributed && <Badge variant="outline" className="border-purple-300 text-purple-700">referral</Badge>}
                    </div>
                    <p className="text-sm text-gray-600">
                      {inq.listing_id ? `Listing ${inq.listing_id} · ` : ''}{inq.contact_email || inq.contact_phone || 'guest'} · {new Date(inq.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateInquiry(inq.id, 'contacted')}>Contacted</Button>
                    <Button size="sm" variant="outline" onClick={() => updateInquiry(inq.id, 'qualified')}>Qualified</Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateInquiry(inq.id, 'spam')}>Spam</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">{label}</p><p className={`text-2xl font-bold ${color}`}>{value}</p></CardContent></Card>
  )
}
