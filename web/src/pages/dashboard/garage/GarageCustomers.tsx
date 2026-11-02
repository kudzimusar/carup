import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2, Users, Search } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi, type GarageCustomerEntry } from '@/hooks/useCarUpApi'
import { whenLabel } from '@/lib/garageWorkspace'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

export function spendLabel(spend: Record<string, number>): string {
  const entries = Object.entries(spend || {})
  if (!entries.length) return 'No cost recorded'
  return entries.map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(' · ')
}

export default function GarageCustomers() {
  const { user } = useAuth()
  const { fetchGarageCustomers, createGarageProspect } = useCarUpApi()
  const [customers, setCustomers] = useState<GarageCustomerEntry[]>([])
  const [prospects, setProspects] = useState<GarageCustomerEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [site, setSite] = useState('all')
  const [dueOnly, setDueOnly] = useState(false)
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest')
  const [prospectName, setProspectName] = useState('')
  const [walkInConfirmed, setWalkInConfirmed] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = user?.active_tenant?.role === 'admin' || user?.tenant_role === 'admin'

  const load = useCallback(async () => {
    setState('loading')
    try {
      const result = await fetchGarageCustomers()
      if (!Array.isArray(result?.customers)) throw new Error('Customer response is incomplete')
      setCustomers(result.customers)
      setProspects(Array.isArray(result?.prospects) ? result.prospects : [])
      setState('ready')
    } catch { setState('error') }
  }, [fetchGarageCustomers])
  useEffect(() => { void load() }, [load])

  const all = useMemo(() => [...customers, ...prospects], [customers, prospects])
  const sites = useMemo(() => [...new Set(all.map((c) => c.relationship?.preferred_branch_id).filter((id): id is string => Boolean(id)))], [all])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const now = Date.now()
    return all.filter((c) => {
      const relation = c.relationship
      const customerId = c.customer_id || (c.user_id ? `registered:${c.user_id}` : '')
      if (term && ![c.display_name, relation?.customer_reference_code, customerId].some((v) => v?.toLowerCase().includes(term))) return false
      if (status !== 'all' && (relation?.relationship_status || 'not_recorded') !== status) return false
      if (site !== 'all' && relation?.preferred_branch_id !== site) return false
      if (dueOnly && !(relation?.follow_up_status === 'pending' && relation.follow_up_at && Date.parse(relation.follow_up_at) <= now)) return false
      return true
    }).sort((a, b) => {
      const aTime = a.last_service_at || ''
      const bTime = b.last_service_at || ''
      return sort === 'latest' ? bTime.localeCompare(aTime) : aTime.localeCompare(bTime)
    })
  }, [all, search, status, site, dueOnly, sort])

  async function addWalkIn(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!prospectName.trim() || !walkInConfirmed) {
      setFormError('Record a prospect label and confirm this is a real walk-in.')
      return
    }
    setBusy(true)
    try {
      await createGarageProspect({ origin: 'walk_in', display_name: prospectName.trim(), walk_in_confirmed: true })
      setProspectName('')
      setWalkInConfirmed(false)
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Prospect could not be recorded.')
    } finally { setBusy(false) }
  }

  return (
    <div className={SN_PAGE}>
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-gray-500">CarUp customers come from real service cases. Garage relationship details are recorded separately.</p>
      </div>

      {state === 'loading' && <div className="flex items-center gap-3 p-8" role="status"><Loader2 className="w-6 h-6 animate-spin" /><span>Loading your customers…</span></div>}
      {state === 'error' && <Card data-testid="customers-error"><CardContent className="p-6 text-center">
        <p className="font-semibold">Your customers could not be loaded</p>
        <p className="text-sm text-gray-500">This is a loading problem, not a statement that you have no customers.</p>
        <Button variant="outline" className="mt-4 min-h-11" onClick={() => void load()}>Try again</Button>
      </CardContent></Card>}

      {state === 'ready' && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Search by name or reference
            <span className="relative block mt-1"><Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></span>
          </label>
          <label className="text-sm">Relationship status
            <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option><option value="not_recorded">Not recorded</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="prospect">Prospect</option>
            </select>
          </label>
          <label className="text-sm">Preferred site
            <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="all">All sites</option>{sites.map((id) => <option key={id} value={id}>{all.find((c) => c.relationship?.preferred_branch_id === id)?.relationship?.preferred_site_name || id}</option>)}
            </select>
          </label>
          <label className="text-sm">Last service
            <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={sort} onChange={(e) => setSort(e.target.value as 'latest' | 'oldest')}>
              <option value="latest">Most recent first</option><option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Follow-up due</label>

        {all.length === 0 && <Card data-testid="customers-empty"><CardContent className="p-8 text-center">
          <Users className="w-7 h-7 text-gray-300 mx-auto mb-3" /><p className="font-semibold">No customers yet</p>
          <p className="text-sm text-gray-500">A CarUp customer appears after a real service request. Walk-ins appear separately as prospects.</p>
        </CardContent></Card>}
        {all.length > 0 && filtered.length === 0 && <p className="text-sm text-gray-500">No relationships match these filters.</p>}
        <div className="space-y-3">
          {filtered.map((c) => {
            const id = c.customer_id || `registered:${c.user_id}`
            return <Card key={id} data-testid="customer-row"><CardContent className="p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/garage/customers/${encodeURIComponent(id)}`} className="font-semibold text-orange-700 hover:underline" data-testid="customer-name">{c.display_name || 'Unnamed customer'}</Link>
                  <p className="text-xs text-gray-500">{c.party_kind === 'registered' || !c.party_kind ? 'CarUp account · service requester' : 'Garage prospect · identity unverified'}
                    {c.relationship?.customer_reference_code ? ` · ${c.relationship.customer_reference_code}` : ''}</p>
                </div>
                <p className="text-sm text-gray-600" data-testid="customer-spend">{spendLabel(c.spend_by_currency)}</p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                <span>{c.vehicle_count} {c.vehicle_count === 1 ? 'related vehicle' : 'related vehicles'}</span>
                <span data-testid="customer-jobs">{c.case_count} {c.case_count === 1 ? 'service case' : 'service cases'}, {c.completed_count} completed</span>
                <span>Last service {whenLabel(c.last_service_at)}</span>
                <span>Status: {c.relationship?.relationship_status || 'not recorded'}</span>
                <span>Follow-up: {c.relationship?.follow_up_status || 'not recorded'}</span>
              </div>
            </CardContent></Card>
          })}
        </div>
        {isAdmin && <Card><CardContent className="p-5">
          <h2 className="font-semibold">Record a walk-in prospect</h2>
          <p className="text-sm text-gray-500 mb-3">This is a Garage-entered prospect label, not a CarUp account or verified contact.</p>
          <form onSubmit={(e) => void addWalkIn(e)} className="space-y-3">
            <label className="text-sm block">Prospect label<Input className="mt-1" maxLength={120} value={prospectName} onChange={(e) => setProspectName(e.target.value)} /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={walkInConfirmed} onChange={(e) => setWalkInConfirmed(e.target.checked)} /> I confirm this was a real walk-in interaction.</label>
            {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
            <Button type="submit" disabled={busy} className="min-h-11">Record prospect</Button>
          </form>
        </CardContent></Card>}
      </>}
    </div>
  )
}
