import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tag, RefreshCw } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ReferralIntelligence from '@/components/intelligence/ReferralIntelligence'
import type {
  ReferralCampaign,
  ReferralCampaignType,
  ReferralPriorityScope,
  ReferralCampaignStatus,
} from '@/types/referral'

/**
 * Admin Referral Campaigns (/admin/referrals). Lists campaigns via the real
 * GET /campaigns endpoint, creates campaigns, and updates campaign status.
 * No parallel campaign store — uses useCarUpApi only.
 */

const CAMPAIGN_TYPES: ReferralCampaignType[] = [
  'LOCAL_MARKETPLACE',
  'IMPORT_VEHICLE',
  'IMPORT_PARTS',
  'CONTAINER_SPACE',
  'COMMUNITY_GROUP',
  'AGENT_PARTNER',
]
const PRIORITY_SCOPES: ReferralPriorityScope[] = ['LOCAL', 'IMPORT', 'HYBRID']
const STATUSES: ReferralCampaignStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  DRAFT: 'bg-gray-100 text-gray-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  ARCHIVED: 'bg-gray-100 text-gray-500',
}

export default function ReferralCampaigns() {
  const { listReferralCampaigns, createReferralCampaign, updateReferralCampaign } = useCarUpApi()

  const [campaigns, setCampaigns] = useState<ReferralCampaign[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [campaignType, setCampaignType] = useState<ReferralCampaignType>('LOCAL_MARKETPLACE')
  const [scope, setScope] = useState<ReferralPriorityScope>('LOCAL')
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listReferralCampaigns()
      setCampaigns(res.campaigns ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [listReferralCampaigns])

  useEffect(() => {
    load()
  }, [load])

  const onCreate = useCallback(async () => {
    if (!name.trim()) {
      setCreateMsg('Campaign name is required.')
      return
    }
    try {
      await createReferralCampaign({ name: name.trim(), campaign_type: campaignType, priority_scope: scope })
      setCreateMsg('Campaign created.')
      setName('')
      load()
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : 'Could not create campaign.')
    }
  }, [name, campaignType, scope, createReferralCampaign, load])

  const onStatusChange = useCallback(
    async (id: string, status: string) => {
      try {
        await updateReferralCampaign(id, { status })
        load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update status.')
      }
    },
    [updateReferralCampaign, load]
  )

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Tag className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Referral Campaigns</h1>
          <p className="text-gray-500">Create and manage referral campaigns</p>
        </div>
      </div>

      {/* The governed referral projection: activity separated from the shared
          event log, accrued benefits kept apart from paid, and no ROI. */}
      <ReferralIntelligence windowDays={30} />

      {/* Create */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <h2 className="font-semibold">Create Campaign</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input placeholder="Campaign name *" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={campaignType} onChange={(e) => setCampaignType(e.target.value as ReferralCampaignType)} className="border border-gray-200 rounded-md h-9 px-3 text-sm">
              {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value as ReferralPriorityScope)} className="border border-gray-200 rounded-md h-9 px-3 text-sm">
              {PRIORITY_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onCreate}>Create</Button>
          </div>
          {createMsg && <p className="text-sm text-gray-600">{createMsg}</p>}
        </CardContent>
      </Card>

      {/* List */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Campaigns</h2>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </div>
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-gray-500">{loading ? 'Loading…' : 'No campaigns yet.'}</p>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name || c.slug || c.id}</p>
                    <p className="text-xs text-gray-400">{[c.campaign_type, c.priority_scope].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`text-[10px] ${STATUS_STYLES[c.status || ''] || 'bg-gray-100 text-gray-700'}`}>{c.status || 'unknown'}</Badge>
                    <select
                      value={c.status || 'DRAFT'}
                      onChange={(e) => onStatusChange(c.id, e.target.value)}
                      className="border border-gray-200 rounded-md h-8 px-2 text-xs"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
