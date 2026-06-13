import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Megaphone, RefreshCw } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { ReferralEvent } from '@/types/referral'

/**
 * Admin AI Marketing Review (/admin/referrals/marketing). Creates AI draft assets
 * and walks them through the backend status workflow (draft → review → approved →
 * scheduled → published, plus reject/archive). Publication, disclosure, and
 * attribution are enforced by the backend — this UI never publishes outside the
 * status workflow, never strips disclosure, and never overwrites attribution.
 */

const STATUSES = ['draft', 'review', 'approved', 'rejected', 'scheduled', 'published', 'archived'] as const
const PAGE_TYPES = ['corridor_landing_page', 'local_city_page', 'vehicle_import_page', 'parts_request_page', 'container_campaign_page', 'faq_page'] as const

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  review: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  scheduled: 'bg-amber-100 text-amber-700',
  published: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-500',
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
}

type TransitionFn = (assetId: string, payload: Record<string, unknown>) => Promise<unknown>

function MarketingAssetRow({ event, transition, onDone }: { event: ReferralEvent; transition: TransitionFn; onDone: () => void }) {
  const md = (event.metadata ?? {}) as Record<string, unknown>
  const seo = (pick(md, 'seo') ?? {}) as Record<string, unknown>
  const [status, setStatus] = useState<string>(str(md.status) || 'draft')
  const [reason, setReason] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const apply = useCallback(async () => {
    setMsg(null)
    try {
      await transition(event.id, {
        status,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(status === 'scheduled' && scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
        ...(status === 'published' && publicUrl.trim() ? { public_url: publicUrl.trim() } : {}),
      })
      setMsg('Status updated.')
      onDone()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Transition failed.')
    }
  }, [transition, event.id, status, reason, scheduledAt, publicUrl, onDone])

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">{str(md.asset_type) || 'asset'}</p>
          <p className="text-[11px] text-gray-400">
            {pick(md, 'disclosure') ? 'disclosure ✓' : 'disclosure —'}
            {typeof seo.canonical_url === 'string' ? ` · canonical: ${str(seo.canonical_url)}` : ''}
            {pick(seo, 'utm') ? ' · utm ✓' : ''}
            {pick(seo, 'internal_links') ? ' · internal-links ✓' : ''}
          </p>
        </div>
        <Badge className={`text-[10px] ${STATUS_STYLES[str(md.status)] || 'bg-gray-100 text-gray-700'}`}>{str(md.status) || 'draft'}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-200 rounded-md h-8 px-2 text-xs">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Input placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 text-xs max-w-[160px]" />
        {status === 'scheduled' && (
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="border border-gray-200 rounded-md h-8 px-2 text-xs" />
        )}
        {status === 'published' && (
          <Input placeholder="public_url (optional)" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} className="h-8 text-xs max-w-[200px]" />
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={apply}>Apply</Button>
      </div>
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
    </div>
  )
}

export default function ReferralMarketing() {
  const {
    getReferralMarketingRules,
    createReferralMarketingCampaignKit,
    createReferralSeoPage,
    createReferralChannelMessage,
    createReferralProofStory,
    createReferralFaq,
    listReferralMarketingAssets,
    updateReferralMarketingAssetStatus,
    createReferralMarketingAnalyticsSuggestion,
  } = useCarUpApi()

  const [rules, setRules] = useState<Record<string, unknown> | null>(null)
  const [assets, setAssets] = useState<ReferralEvent[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Shared draft context
  const [campaignId, setCampaignId] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [seoType, setSeoType] = useState<string>('corridor_landing_page')
  const [channels, setChannels] = useState('')
  const [draftMsg, setDraftMsg] = useState<string | null>(null)

  const [metricViews, setMetricViews] = useState('')
  const [metricClicks, setMetricClicks] = useState('')
  const [analyticsMsg, setAnalyticsMsg] = useState<string | null>(null)

  const ctx = useCallback((): Record<string, unknown> => ({
    ...(campaignId.trim() ? { campaign_id: campaignId.trim() } : {}),
    ...(referralCode.trim() ? { referral_code: referralCode.trim() } : {}),
    ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
  }), [campaignId, referralCode, baseUrl])

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await listReferralMarketingAssets()
      setAssets(res.assets ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load assets.')
    } finally {
      setLoading(false)
    }
  }, [listReferralMarketingAssets])

  useEffect(() => {
    getReferralMarketingRules().then((r) => setRules((r.rules ?? null) as Record<string, unknown> | null)).catch(() => setRules(null))
    loadAssets()
  }, [getReferralMarketingRules, loadAssets])

  const runDraft = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setDraftMsg(null)
    try {
      await fn()
      setDraftMsg(`${label} created.`)
      loadAssets()
    } catch (err) {
      setDraftMsg(err instanceof Error ? err.message : `${label} failed.`)
    }
  }, [loadAssets])

  const onAnalytics = useCallback(async () => {
    setAnalyticsMsg(null)
    try {
      await createReferralMarketingAnalyticsSuggestion({
        ...ctx(),
        metrics: {
          ...(metricViews.trim() ? { views: Number(metricViews) } : {}),
          ...(metricClicks.trim() ? { clicks: Number(metricClicks) } : {}),
        },
      })
      setAnalyticsMsg('Analytics suggestion created.')
    } catch (err) {
      setAnalyticsMsg(err instanceof Error ? err.message : 'Could not create suggestion.')
    }
  }, [ctx, metricViews, metricClicks, createReferralMarketingAnalyticsSuggestion])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Marketing Review</h1>
          <p className="text-gray-500">Generate, review, and publish referral marketing assets</p>
        </div>
      </div>

      {/* Rules */}
      {rules && (
        <Card className="border-0 card-shadow">
          <CardContent className="p-6">
            <h2 className="font-semibold mb-2">Rules</h2>
            <div className="text-xs text-gray-600 space-y-1">
              {Array.isArray(pick(rules, 'workflow')) && <p><span className="font-medium">Workflow:</span> {(pick(rules, 'workflow') as unknown[]).map(str).join(' → ')}</p>}
              {typeof pick(rules, 'required_disclosure') === 'string' && <p><span className="font-medium">Disclosure required:</span> {str(pick(rules, 'required_disclosure'))}</p>}
              {Array.isArray(pick(rules, 'asset_types')) && <p><span className="font-medium">Asset types:</span> {(pick(rules, 'asset_types') as unknown[]).map(str).join(', ')}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create drafts */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <h2 className="font-semibold">Create Draft Assets</h2>
          <div className="grid sm:grid-cols-3 gap-2">
            <Input placeholder="campaign_id" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
            <Input placeholder="referral_code" value={referralCode} onChange={(e) => setReferralCode(e.target.value)} />
            <Input placeholder="base_url (https://…)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">Provide a campaign_id or referral_code so the AI can resolve campaign context.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={() => runDraft('Campaign kit', () => createReferralMarketingCampaignKit(ctx()))}>Campaign Kit</Button>
            <Button size="sm" variant="outline" onClick={() => runDraft('Proof story', () => createReferralProofStory(ctx()))}>Proof Story</Button>
            <Button size="sm" variant="outline" onClick={() => runDraft('FAQ', () => createReferralFaq(ctx()))}>FAQ</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            <select value={seoType} onChange={(e) => setSeoType(e.target.value)} className="border border-gray-200 rounded-md h-9 px-2 text-sm">
              {PAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => runDraft('SEO page', () => createReferralSeoPage({ ...ctx(), asset_type: seoType }))}>SEO Page</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            <Input placeholder="channels (comma-sep, blank = all)" value={channels} onChange={(e) => setChannels(e.target.value)} className="max-w-xs" />
            <Button size="sm" variant="outline" onClick={() => runDraft('Channel messages', () => createReferralChannelMessage({ ...ctx(), ...(channels.trim() ? { channels: channels.split(',').map((c) => c.trim()).filter(Boolean) } : {}) }))}>Channel Messages</Button>
          </div>
          {draftMsg && <p className="text-sm text-gray-600">{draftMsg}</p>}
        </CardContent>
      </Card>

      {/* Assets */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Marketing Assets</h2>
            <Button size="sm" variant="outline" onClick={loadAssets} disabled={loading}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </div>
          {listError ? (
            <p className="text-sm text-red-600">{listError}</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-gray-500">{loading ? 'Loading…' : 'No assets yet — create a draft above.'}</p>
          ) : (
            <div className="space-y-2">
              {assets.map((ev) => (
                <MarketingAssetRow key={ev.id} event={ev} transition={updateReferralMarketingAssetStatus} onDone={loadAssets} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analytics */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <h2 className="font-semibold">Analytics Suggestion</h2>
          <div className="flex flex-wrap gap-2">
            <Input type="number" placeholder="views" value={metricViews} onChange={(e) => setMetricViews(e.target.value)} className="max-w-[120px]" />
            <Input type="number" placeholder="clicks" value={metricClicks} onChange={(e) => setMetricClicks(e.target.value)} className="max-w-[120px]" />
            <Button size="sm" variant="outline" onClick={onAnalytics}>Get Suggestions</Button>
          </div>
          {analyticsMsg && <p className="text-sm text-gray-600">{analyticsMsg}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
