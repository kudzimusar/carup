import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Users } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ReferralEventLog from '@/components/referral/ReferralEventLog'
import ReferralRealList from '@/components/referral/ReferralRealList'
import type { ReferralLocalMarketplaceLead } from '@/types/referral'

/**
 * Admin Local Marketplace Leads (/admin/referrals/local-leads). Records intent,
 * creates leads, creates referral bundles, and qualifies leads. No GET-list for
 * leads yet — recent activity comes from the real event log (ReferralEventLog).
 */

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
}

export default function ReferralLocalLeads() {
  const {
    createReferralLocalMarketplaceIntent,
    createReferralLocalMarketplaceLead,
    createReferralLocalMarketplaceBundle,
    qualifyReferralLocalMarketplaceLead,
    listReferralLocalMarketplaceLeads,
  } = useCarUpApi()

  const loadLeads = useCallback(async () => {
    const res = await listReferralLocalMarketplaceLeads({ limit: 50 })
    return { items: res.leads ?? [], pagination: res.pagination }
  }, [listReferralLocalMarketplaceLeads])

  const [intentText, setIntentText] = useState('')
  const [intentMsg, setIntentMsg] = useState<string | null>(null)

  const [leadCode, setLeadCode] = useState('')
  const [leadMake, setLeadMake] = useState('')
  const [leadModel, setLeadModel] = useState('')
  const [leadMsg, setLeadMsg] = useState<string | null>(null)

  const [ownerUserId, setOwnerUserId] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)

  const [qualifyEventId, setQualifyEventId] = useState('')
  const [milestone, setMilestone] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [qualifyMsg, setQualifyMsg] = useState<string | null>(null)

  const onIntent = useCallback(async () => {
    if (!intentText.trim()) {
      setIntentMsg('Enter a message to classify.')
      return
    }
    try {
      const res = await createReferralLocalMarketplaceIntent({ message: intentText.trim(), channel: 'web' })
      const intent = pick(res, 'intent')
      setIntentMsg(`Flow: ${str(pick(intent, 'flow_type'))} · Participant: ${str(pick(intent, 'participant_type'))}`)
    } catch (err) {
      setIntentMsg(err instanceof Error ? err.message : 'Intent failed.')
    }
  }, [intentText, createReferralLocalMarketplaceIntent])

  const onLead = useCallback(async () => {
    try {
      const res = await createReferralLocalMarketplaceLead({
        ...(leadCode.trim() ? { referral_code: leadCode.trim() } : {}),
        ...(leadMake.trim() ? { make: leadMake.trim() } : {}),
        ...(leadModel.trim() ? { model: leadModel.trim() } : {}),
        channel: 'web',
      })
      setLeadMsg(`Lead created. event_id: ${str(pick(res, 'event_id'))}`)
    } catch (err) {
      setLeadMsg(err instanceof Error ? err.message : 'Could not create lead.')
    }
  }, [leadCode, leadMake, leadModel, createReferralLocalMarketplaceLead])

  const onBundle = useCallback(async () => {
    if (!ownerUserId.trim()) {
      setBundleMsg('owner_user_id is required.')
      return
    }
    try {
      const res = await createReferralLocalMarketplaceBundle({
        owner_user_id: ownerUserId.trim(),
        ...(campaignName.trim() ? { campaign_name: campaignName.trim() } : {}),
      })
      setBundleMsg(`Bundle created. code: ${str(pick(pick(res, 'code'), 'code'))}`)
    } catch (err) {
      setBundleMsg(err instanceof Error ? err.message : 'Could not create bundle.')
    }
  }, [ownerUserId, campaignName, createReferralLocalMarketplaceBundle])

  const onQualify = useCallback(async () => {
    if (!qualifyEventId.trim() || !milestone.trim()) {
      setQualifyMsg('lead_event_id and milestone are required.')
      return
    }
    try {
      const res = await qualifyReferralLocalMarketplaceLead(qualifyEventId.trim(), {
        milestone: milestone.trim(),
        ...(rewardAmount.trim() ? { reward_amount: Number(rewardAmount) } : {}),
      })
      setQualifyMsg(`Qualified. reward_created: ${str(pick(res, 'reward_created'))}`)
    } catch (err) {
      setQualifyMsg(err instanceof Error ? err.message : 'Could not qualify lead.')
    }
  }, [qualifyEventId, milestone, rewardAmount, qualifyReferralLocalMarketplaceLead])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Users className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Local Marketplace Leads</h1>
          <p className="text-gray-500">Capture intent, create and qualify local referral leads</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Classify Intent</h2>
            <Textarea placeholder="e.g. I want to sell my Toyota Aqua in Harare" value={intentText} onChange={(e) => setIntentText(e.target.value)} />
            <Button variant="outline" onClick={onIntent}>Classify</Button>
            {intentMsg && <p className="text-sm text-gray-600">{intentMsg}</p>}
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Lead</h2>
            <Input placeholder="Referral code (optional)" value={leadCode} onChange={(e) => setLeadCode(e.target.value)} />
            <div className="flex gap-2">
              <Input placeholder="Make" value={leadMake} onChange={(e) => setLeadMake(e.target.value)} />
              <Input placeholder="Model" value={leadModel} onChange={(e) => setLeadModel(e.target.value)} />
            </div>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onLead}>Create Lead</Button>
            {leadMsg && <p className="text-sm text-gray-600 break-all">{leadMsg}</p>}
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Referral Bundle</h2>
            <Input placeholder="Owner user id *" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} />
            <Input placeholder="Campaign name (optional)" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onBundle}>Create Bundle</Button>
            {bundleMsg && <p className="text-sm text-gray-600 break-all">{bundleMsg}</p>}
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Qualify Lead</h2>
            <Input placeholder="lead_event_id *" value={qualifyEventId} onChange={(e) => setQualifyEventId(e.target.value)} />
            <div className="flex gap-2">
              <Input placeholder="Milestone *" value={milestone} onChange={(e) => setMilestone(e.target.value)} />
              <Input type="number" placeholder="Reward amount" value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} />
            </div>
            <Button variant="outline" onClick={onQualify}>Qualify</Button>
            {qualifyMsg && <p className="text-sm text-gray-600">{qualifyMsg}</p>}
          </CardContent>
        </Card>
      </div>

      <ReferralRealList
        title="Local Marketplace Leads"
        load={loadLeads}
        emptyText="No leads yet — create one above."
        renderRow={(lead: ReferralLocalMarketplaceLead) => (
          <div key={lead.lead_event_id} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
            <span className="text-gray-500">{[lead.flow_type, lead.participant_type].filter(Boolean).join(' · ') || 'lead'}</span>
            <span className="text-gray-400 font-mono break-all mx-2">{lead.lead_event_id}</span>
            <span className="text-gray-400 shrink-0">{lead.status || ''}</span>
          </div>
        )}
      />
      <ReferralEventLog title="Audit activity (event log)" />
    </div>
  )
}
