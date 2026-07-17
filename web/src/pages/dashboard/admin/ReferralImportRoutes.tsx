import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MapPin } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ReferralEventLog from '@/components/referral/ReferralEventLog'
import ReferralRealList from '@/components/referral/ReferralRealList'
import type { ReferralImportRoute } from '@/types/referral'

/**
 * Admin Import Routes & Capacity (/admin/referrals/import-routes). Creates routes,
 * checks live route status, updates capacity, and creates/qualifies import leads —
 * covering vehicle import, parts import, and the container-space flow. Capacity
 * rules and statuses come from real backend responses (no faked capacity).
 */

const FLOW_TYPES = ['vehicle_import', 'parts_import', 'container_space'] as const
type ImportFlowType = (typeof FLOW_TYPES)[number]

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
}

export default function ReferralImportRoutes() {
  const {
    createReferralImportRoute,
    getReferralImportRouteStatus,
    updateReferralImportRouteCapacity,
    createReferralImportLead,
    qualifyReferralImportLead,
    listReferralImportRoutes,
  } = useCarUpApi()

  const loadRoutes = useCallback(async () => {
    const res = await listReferralImportRoutes({ limit: 50 })
    return { items: res.routes ?? [], pagination: res.pagination }
  }, [listReferralImportRoutes])

  // Create route
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [flowType, setFlowType] = useState<ImportFlowType>('vehicle_import')
  const [routeKey, setRouteKey] = useState('')
  const [totalCapacity, setTotalCapacity] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [routeMsg, setRouteMsg] = useState<string | null>(null)

  // Status + capacity
  const [statusKey, setStatusKey] = useState('')
  const [statusText, setStatusText] = useState<string | null>(null)
  const [capTotal, setCapTotal] = useState('')
  const [capBooked, setCapBooked] = useState('')
  const [capMsg, setCapMsg] = useState<string | null>(null)

  // Import lead
  const [leadRouteKey, setLeadRouteKey] = useState('')
  const [leadFlow, setLeadFlow] = useState<ImportFlowType>('container_space')
  const [leadCapacity, setLeadCapacity] = useState('')
  const [allowWaitlist, setAllowWaitlist] = useState(false)
  const [leadReferralCode, setLeadReferralCode] = useState('')
  const [leadReference, setLeadReference] = useState('')
  const [leadContactUserId, setLeadContactUserId] = useState('')
  const [leadPartName, setLeadPartName] = useState('')
  const [leadMsg, setLeadMsg] = useState<string | null>(null)

  // Qualify
  const [qualifyEventId, setQualifyEventId] = useState('')
  const [milestone, setMilestone] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [qualifyReferredUserId, setQualifyReferredUserId] = useState('')
  const [qualifyResultReference, setQualifyResultReference] = useState('')
  const [qualifyMsg, setQualifyMsg] = useState<string | null>(null)

  const onCreateRoute = useCallback(async () => {
    if (!origin.trim() || !destination.trim()) {
      setRouteMsg('Origin and destination are required.')
      return
    }
    try {
      const res = await createReferralImportRoute({
        route_origin: origin.trim(),
        route_destination: destination.trim(),
        flow_type: flowType,
        ...(routeKey.trim() ? { route_key: routeKey.trim() } : {}),
        ...(totalCapacity.trim() ? { total_capacity_units: Number(totalCapacity) } : {}),
        ...(unitLabel.trim() ? { unit_label: unitLabel.trim() } : {}),
      })
      setRouteMsg(`Route created. route_key: ${str(pick(pick(res, 'route'), 'route_key'))}`)
    } catch (err) {
      setRouteMsg(err instanceof Error ? err.message : 'Could not create route.')
    }
  }, [origin, destination, flowType, routeKey, totalCapacity, unitLabel, createReferralImportRoute])

  const onStatus = useCallback(async () => {
    if (!statusKey.trim()) {
      setStatusText('Enter a route_key.')
      return
    }
    try {
      const res = await getReferralImportRouteStatus(statusKey.trim())
      const cap = pick(res, 'capacity')
      setStatusText(
        `Status: ${str(pick(cap, 'capacity_status'))} · total: ${str(pick(cap, 'total_capacity_units'))} · booked: ${str(pick(cap, 'booked_capacity_units'))} · available: ${str(pick(cap, 'available_capacity_units'))}`
      )
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : 'Could not fetch status.')
    }
  }, [statusKey, getReferralImportRouteStatus])

  const onUpdateCapacity = useCallback(async () => {
    if (!statusKey.trim()) {
      setCapMsg('Enter the route_key above first.')
      return
    }
    try {
      await updateReferralImportRouteCapacity(statusKey.trim(), {
        ...(capTotal.trim() ? { total_capacity_units: Number(capTotal) } : {}),
        ...(capBooked.trim() ? { booked_capacity_units: Number(capBooked) } : {}),
      })
      setCapMsg('Capacity updated.')
      onStatus()
    } catch (err) {
      setCapMsg(err instanceof Error ? err.message : 'Could not update capacity.')
    }
  }, [statusKey, capTotal, capBooked, updateReferralImportRouteCapacity, onStatus])

  const onLead = useCallback(async () => {
    try {
      const res = await createReferralImportLead({
        ...(leadRouteKey.trim() ? { route_key: leadRouteKey.trim() } : {}),
        flow_type: leadFlow,
        ...(leadCapacity.trim() ? { requested_capacity_units: Number(leadCapacity) } : {}),
        allow_waitlist: allowWaitlist,
        ...(leadReferralCode.trim() ? { referral_code: leadReferralCode.trim() } : {}),
        ...(leadReference.trim() ? { lead_reference: leadReference.trim() } : {}),
        ...(leadContactUserId.trim() ? { contact: { user_id: leadContactUserId.trim() } } : {}),
        ...(leadPartName.trim() ? { part_request: { part_name: leadPartName.trim() } } : {}),
      })
      const lead = pick(res, 'lead')
      setLeadMsg(`Lead created. event_id: ${str(pick(res, 'event_id'))} · capacity_status: ${str(pick(lead, 'capacity_status'))} · waitlisted: ${str(pick(lead, 'waitlisted'))}`)
    } catch (err) {
      setLeadMsg(err instanceof Error ? err.message : 'Could not create import lead.')
    }
  }, [leadRouteKey, leadFlow, leadCapacity, allowWaitlist, leadReferralCode, leadReference, leadContactUserId, leadPartName, createReferralImportLead])

  const onQualify = useCallback(async () => {
    if (!qualifyEventId.trim() || !milestone.trim()) {
      setQualifyMsg('lead_event_id and milestone are required.')
      return
    }
    try {
      const res = await qualifyReferralImportLead(qualifyEventId.trim(), {
        milestone: milestone.trim(),
        ...(rewardAmount.trim() ? { reward_amount: Number(rewardAmount) } : {}),
        ...(qualifyReferredUserId.trim() ? { referred_user_id: qualifyReferredUserId.trim() } : {}),
        ...(qualifyResultReference.trim() ? { result_reference: qualifyResultReference.trim() } : {}),
      })
      setQualifyMsg(`Qualified. reward_created: ${str(pick(res, 'reward_created'))}`)
    } catch (err) {
      setQualifyMsg(err instanceof Error ? err.message : 'Could not qualify lead.')
    }
  }, [qualifyEventId, milestone, rewardAmount, qualifyReferredUserId, qualifyResultReference, qualifyReferralImportLead])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <MapPin className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Import Routes &amp; Capacity</h1>
          <p className="text-gray-500">Vehicle import, parts import, and container-space flow</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Create route */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Route</h2>
            <div className="flex gap-2">
              <Input placeholder="Origin *" value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="referral-import-route-origin" />
              <Input placeholder="Destination *" value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="referral-import-route-destination" />
            </div>
            <select value={flowType} onChange={(e) => setFlowType(e.target.value as ImportFlowType)} className="w-full border border-gray-200 rounded-md h-9 px-3 text-sm" data-testid="referral-import-route-flow">
              {FLOW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input placeholder="Route key (optional unique key)" value={routeKey} onChange={(e) => setRouteKey(e.target.value)} data-testid="referral-import-route-key-input" />
            <div className="flex gap-2">
              <Input type="number" placeholder="Total capacity" value={totalCapacity} onChange={(e) => setTotalCapacity(e.target.value)} data-testid="referral-import-route-total-capacity" />
              <Input placeholder="Unit label (e.g. CBM, slots)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} data-testid="referral-import-route-unit-label" />
            </div>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onCreateRoute} data-testid="referral-import-route-create">Create Route</Button>
            {routeMsg && <p className="text-sm text-gray-600 break-all" data-testid="referral-import-route-message">{routeMsg}</p>}
          </CardContent>
        </Card>

        {/* Status + capacity */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Route Status &amp; Capacity</h2>
            <div className="flex gap-2">
              <Input placeholder="route_key" value={statusKey} onChange={(e) => setStatusKey(e.target.value)} data-testid="referral-import-status-route-key" />
              <Button variant="outline" onClick={onStatus} data-testid="referral-import-status-check">Check</Button>
            </div>
            {statusText && <p className="text-sm text-gray-700 break-all" data-testid="referral-import-status-text">{statusText}</p>}
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex gap-2">
                <Input type="number" placeholder="New total" value={capTotal} onChange={(e) => setCapTotal(e.target.value)} data-testid="referral-import-capacity-total" />
                <Input type="number" placeholder="New booked" value={capBooked} onChange={(e) => setCapBooked(e.target.value)} data-testid="referral-import-capacity-booked" />
              </div>
              <Button variant="outline" onClick={onUpdateCapacity} data-testid="referral-import-capacity-update">Update Capacity</Button>
              {capMsg && <p className="text-sm text-gray-600" data-testid="referral-import-capacity-message">{capMsg}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Import lead (incl. container-space) */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Import Lead</h2>
            <Input placeholder="route_key (optional)" value={leadRouteKey} onChange={(e) => setLeadRouteKey(e.target.value)} data-testid="referral-import-lead-route-key" />
            <select value={leadFlow} onChange={(e) => setLeadFlow(e.target.value as ImportFlowType)} className="w-full border border-gray-200 rounded-md h-9 px-3 text-sm" data-testid="referral-import-lead-flow">
              {FLOW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input type="number" placeholder="Requested capacity (container-space)" value={leadCapacity} onChange={(e) => setLeadCapacity(e.target.value)} data-testid="referral-import-lead-capacity" />
            <Input placeholder="Referral code" value={leadReferralCode} onChange={(e) => setLeadReferralCode(e.target.value)} data-testid="referral-import-lead-referral-code" />
            <Input placeholder="Lead reference" value={leadReference} onChange={(e) => setLeadReference(e.target.value)} data-testid="referral-import-lead-reference" />
            <Input placeholder="Referred participant user ID" value={leadContactUserId} onChange={(e) => setLeadContactUserId(e.target.value)} data-testid="referral-import-lead-contact-user-id" />
            <Input placeholder="Part request (parts import)" value={leadPartName} onChange={(e) => setLeadPartName(e.target.value)} data-testid="referral-import-lead-part-name" />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={allowWaitlist} onChange={(e) => setAllowWaitlist(e.target.checked)} data-testid="referral-import-lead-allow-waitlist" />
              Allow waitlist when route is full
            </label>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onLead} data-testid="referral-import-lead-create">Create Lead</Button>
            {leadMsg && <p className="text-sm text-gray-600 break-all" data-testid="referral-import-lead-message">{leadMsg}</p>}
          </CardContent>
        </Card>

        {/* Qualify */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Qualify Import Lead</h2>
            <Input placeholder="lead_event_id *" value={qualifyEventId} onChange={(e) => setQualifyEventId(e.target.value)} data-testid="referral-import-qualify-lead-event-id" />
            <div className="flex gap-2">
              <Input placeholder="Milestone *" value={milestone} onChange={(e) => setMilestone(e.target.value)} data-testid="referral-import-qualify-milestone" />
              <Input type="number" placeholder="Reward amount" value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} data-testid="referral-import-qualify-reward-amount" />
            </div>
            <Input placeholder="Referred participant ID for self-referral check" value={qualifyReferredUserId} onChange={(e) => setQualifyReferredUserId(e.target.value)} data-testid="referral-import-qualify-referred-user-id" />
            <p className="text-xs text-gray-500" data-testid="referral-import-qualify-owner-note">
              The reward owner is derived from the validated referral code. This field cannot select or change the reward owner.
            </p>
            <Input placeholder="Result reference" value={qualifyResultReference} onChange={(e) => setQualifyResultReference(e.target.value)} data-testid="referral-import-qualify-result-reference" />
            <Button variant="outline" onClick={onQualify} data-testid="referral-import-qualify-submit">Qualify</Button>
            {qualifyMsg && <p className="text-sm text-gray-600" data-testid="referral-import-qualify-message">{qualifyMsg}</p>}
            <p className="text-xs text-gray-400">Milestones (e.g. quote, booking, delivery) tie incentives to real import progress.</p>
          </CardContent>
        </Card>
      </div>

      <Badge variant="outline" className="text-[11px]">Container-space = flow_type “container_space” + requested capacity</Badge>
      <ReferralRealList
        title="Import Routes"
        load={loadRoutes}
        emptyText="No routes yet — create one above."
        renderRow={(route: ReferralImportRoute) => (
          <div key={route.route_key} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
            <span className="font-mono break-all">{route.route_key}</span>
            <span className="text-gray-500 mx-2">{[route.flow_type, route.capacity_status].filter(Boolean).join(' · ')}</span>
            <span className="text-gray-400 shrink-0">{route.available_capacity_units ?? '—'}/{route.total_capacity_units ?? '—'} {route.unit_label || ''}</span>
          </div>
        )}
      />
      <ReferralEventLog title="Audit activity (event log)" />
    </div>
  )
}
