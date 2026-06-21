import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ShieldAlert, CheckCircle, XCircle, Flag, EyeOff, FileQuestion, ShieldCheck, Sparkles, Mail, Phone, X } from 'lucide-react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errorMessage'

export interface AdminListing {
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
export interface AdminInquiry {
  id: string
  listing_id?: string | null
  inquiry_type: string
  status: string
  risk_status?: string
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  referral_attributed?: boolean
  created_at: string
}
export interface AiAdvisory {
  vin: string
  vehicle: string
  summary: string
  suggested_action: string
  source: string
}

const STATUS_COLORS: Record<string, string> = {
  public: 'bg-green-500', pending_review: 'bg-amber-500', suppressed: 'bg-orange-500',
  rejected: 'bg-red-500', archived: 'bg-gray-400',
}
const INQUIRY_STATUSES = ['contacted', 'qualified', 'spam'] as const

function normalizeId(value?: string | null) {
  return String(value || '').trim()
}

function vehicleLabel(listing: AdminListing | undefined, listingId: string) {
  if (!listing) return listingId ? `Listing ${listingId}` : 'Marketplace request'
  return [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || listing.vin
}

function emailHref(email?: string | null) {
  const value = String(email || '').trim()
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${encodeURIComponent(value)}` : null
}

function phoneHref(phone?: string | null) {
  const value = String(phone || '').trim()
  const dial = value.replace(/[^\d+]/g, '')
  return dial.length >= 6 ? `tel:${dial}` : null
}

function riskBadgeClass(risk?: string) {
  if (!risk || risk === 'clear') return 'border-gray-200 text-gray-500 bg-gray-50'
  return 'border-orange-300 text-orange-700'
}

export function AdminInquiryCard({
  inquiry,
  listing,
  updating,
  onUpdate,
}: {
  inquiry: AdminInquiry
  listing?: AdminListing
  updating?: boolean
  onUpdate: (id: string, status: string) => void
}) {
  const listingId = normalizeId(inquiry.listing_id)
  const vin = listing?.vin || listingId
  const mailto = emailHref(inquiry.contact_email)
  const tel = phoneHref(inquiry.contact_phone)
  const hasReplyChannel = Boolean(mailto || tel)
  const risk = inquiry.risk_status || 'clear'

  return (
    <Card className="border-0 card-shadow" data-testid="marketplace-admin-inquiry">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-gray-400" />
              <h3 className="font-medium capitalize">{inquiry.inquiry_type.replace(/_/g, ' ')}</h3>
              <Badge variant="secondary">Current: {inquiry.status}</Badge>
              <Badge variant="outline" className={riskBadgeClass(risk)}>risk: {risk}</Badge>
              {inquiry.referral_attributed && <Badge variant="outline" className="border-purple-300 text-purple-700">referral</Badge>}
            </div>
            <div className="rounded-md bg-gray-50 p-2 text-sm text-gray-600">
              <p className="font-medium text-gray-800">
                {vin ? (
                  <Link className="hover:text-orange-600 hover:underline" to={`/marketplace/${encodeURIComponent(vin)}`}>
                    {vehicleLabel(listing, listingId)}
                  </Link>
                ) : (
                  vehicleLabel(listing, listingId)
                )}
              </p>
              {vin && <p className="mt-0.5 font-mono text-xs text-gray-500">VIN {vin}</p>}
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              <p><span className="text-gray-400">Buyer:</span> {inquiry.contact_name || 'Buyer'}</p>
              {inquiry.contact_email && (
                <p className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-gray-400" />
                  {mailto ? <a className="hover:text-orange-600 hover:underline" href={mailto}>{inquiry.contact_email}</a> : <span>{inquiry.contact_email}</span>}
                </p>
              )}
              {inquiry.contact_phone && (
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-gray-400" />
                  {tel ? <a className="hover:text-orange-600 hover:underline" href={tel}>{inquiry.contact_phone}</a> : <span>{inquiry.contact_phone}</span>}
                </p>
              )}
              {!hasReplyChannel && <p className="text-amber-700">No reply channel available</p>}
              <p className="text-xs text-gray-400">{new Date(inquiry.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {INQUIRY_STATUSES.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={inquiry.status === status ? 'secondary' : 'outline'}
                className={status === 'spam' ? 'text-red-600' : undefined}
                disabled={updating || inquiry.status === status}
                aria-pressed={inquiry.status === status}
                onClick={() => onUpdate(inquiry.id, status)}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AiAdvisoryPanel({ advisory, onDismiss }: { advisory: AiAdvisory; onDismiss: () => void }) {
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4" data-testid="marketplace-ai-advisory">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-500" />
            <p className="font-medium text-orange-950">Moderation advisory</p>
            <Badge variant="outline" className="border-orange-300 text-orange-700">{advisory.source}</Badge>
          </div>
          <p className="text-sm text-orange-950">{advisory.vehicle}</p>
          <p className="text-sm text-orange-900">{advisory.summary}</p>
          <p className="text-xs text-orange-800">Suggested action: {advisory.suggested_action}</p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Dismiss moderation advisory" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [updatingInquiryId, setUpdatingInquiryId] = useState<string | null>(null)
  const [aiAdvisory, setAiAdvisory] = useState<AiAdvisory | null>(null)

  const activeTab = searchParams.get('tab') === 'inquiries' ? 'inquiries' : 'listings'
  const setActiveTab = useCallback((tab: string) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'inquiries') next.set('tab', 'inquiries')
    else next.delete('tab')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const listingsByVin = useMemo(() => new Map(listings.map((listing) => [normalizeId(listing.vin), listing])), [listings])

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
      const listing = listingsByVin.get(normalizeId(vin))
      setAiAdvisory({
        vin,
        vehicle: `${vehicleLabel(listing, vin)} · VIN ${vin}`,
        summary: res.summary || 'No summary returned.',
        suggested_action: res.suggested_action || 'review',
        source: res.ai_available ? 'AI advisory' : 'Deterministic advisory',
      })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Summary unavailable'))
    }
  }

  const updateInquiry = async (id: string, status: string) => {
    setActiveTab('inquiries')
    setUpdatingInquiryId(id)
    try {
      await setMarketplaceInquiryStatus(id, status)
      toast.success(`Inquiry marked ${status}`)
      await load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update inquiry'))
    } finally {
      setUpdatingInquiryId(null)
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

      {aiAdvisory && <AiAdvisoryPanel advisory={aiAdvisory} onDismiss={() => setAiAdvisory(null)} />}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
                      <Badge variant="outline" className={riskBadgeClass(l.risk_status)}>risk: {l.risk_status || 'clear'}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{l.currency} {l.price?.toLocaleString()} · Trust {l.trust_score} · {l.vin}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => aiSummary(l.vin)} title="Show moderation advisory" aria-label={`Show moderation advisory for ${l.vin}`}><Sparkles className="w-4 h-4 text-orange-500" />Summary</Button>
                    <Button size="sm" variant="outline" className="text-green-600" onClick={() => moderate(l.vin, 'approve')} data-testid="marketplace-moderate-approve" title="Approve listing" aria-label={`Approve listing ${l.vin}`}><CheckCircle className="w-4 h-4" />Approve</Button>
                    <Button size="sm" variant="outline" className="text-orange-600" onClick={() => moderate(l.vin, 'suppress')} data-testid="marketplace-moderate-suppress" title="Suppress listing" aria-label={`Suppress listing ${l.vin}`}><EyeOff className="w-4 h-4" />Suppress</Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => moderate(l.vin, 'reject')} data-testid="marketplace-moderate-reject" title="Reject listing" aria-label={`Reject listing ${l.vin}`}><XCircle className="w-4 h-4" />Reject</Button>
                    <Button size="sm" variant="outline" className="text-amber-600" onClick={() => moderate(l.vin, 'flag-risk')} data-testid="marketplace-moderate-flag-risk" title="Flag risk" aria-label={`Flag risk for listing ${l.vin}`}><Flag className="w-4 h-4" />Flag</Button>
                    <Button size="sm" variant="outline" onClick={() => moderate(l.vin, 'request-evidence')} data-testid="marketplace-moderate-request-evidence" title="Request evidence" aria-label={`Request evidence for listing ${l.vin}`}><FileQuestion className="w-4 h-4" />Evidence</Button>
                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => moderate(l.vin, 'clear-risk')} data-testid="marketplace-moderate-clear-risk" title="Clear risk" aria-label={`Clear risk for listing ${l.vin}`}><ShieldCheck className="w-4 h-4" />Clear</Button>
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
          ) : inquiries.map((inq) => {
            const listing = listingsByVin.get(normalizeId(inq.listing_id))
            return (
              <AdminInquiryCard
                key={inq.id}
                inquiry={inq}
                listing={listing}
                updating={updatingInquiryId === inq.id}
                onUpdate={updateInquiry}
              />
            )
          })}
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
