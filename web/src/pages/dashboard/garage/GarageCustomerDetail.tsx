import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi, type GarageCustomerDetailResponse, type GarageCustomerRelationship } from '@/hooks/useCarUpApi'
import { spendLabel } from './GarageCustomers'
import { whenLabel } from '@/lib/garageWorkspace'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

type Site = { id: string; name: string; branch_code: string | null; is_active: boolean }
type Staff = { user_id: string; employment_status: string; staff_code: string; user?: { name?: string | null } | null }
type Editor = {
  relationship_status: string; customer_category: string; preferred_branch_id: string
  assigned_staff_user_id: string; internal_notes: string; tags: string
  follow_up_date: string; follow_up_status: string
}
const EMPTY: Editor = {
  relationship_status: '', customer_category: '', preferred_branch_id: '', assigned_staff_user_id: '',
  internal_notes: '', tags: '', follow_up_date: '', follow_up_status: '',
}
function fromRelationship(value: GarageCustomerRelationship | null): Editor {
  if (!value) return EMPTY
  return {
    relationship_status: value.relationship_status, customer_category: value.customer_category || '',
    preferred_branch_id: value.preferred_branch_id || '', assigned_staff_user_id: value.assigned_staff_user_id || '',
    internal_notes: value.internal_notes || '', tags: value.tags.join(', '),
    follow_up_date: value.follow_up_at?.slice(0, 10) || '', follow_up_status: value.follow_up_status || '',
  }
}
function recordLabel(value: string | null | undefined) { return value || 'Not recorded' }

export default function GarageCustomerDetail() {
  const { customerId } = useParams<{ customerId: string }>()
  const { user } = useAuth()
  const { fetchGarageCustomerDetail, listGarageSites, listGarageWorkforce, updateGarageCustomerRelationship } = useCarUpApi()
  const [detail, setDetail] = useState<GarageCustomerDetailResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editor, setEditor] = useState<Editor>(EMPTY)
  const [sites, setSites] = useState<Site[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [optionsReady, setOptionsReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const isAdmin = user?.active_tenant?.role === 'admin' || user?.tenant_role === 'admin'
  const canOpenMessages = ['owner', 'dealer', 'admin', 'government'].includes(user?.role || '')

  const load = useCallback(async () => {
    if (!customerId) { setState('error'); return }
    setState('loading')
    try {
      const result = await fetchGarageCustomerDetail(customerId)
      setDetail(result)
      setEditor(fromRelationship(result.customer.relationship))
      setState('ready')
    } catch { setState('error') }
  }, [fetchGarageCustomerDetail, customerId])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!isAdmin) return
    let active = true
    Promise.all([listGarageSites(), listGarageWorkforce()]).then(([s, w]) => {
      if (!active) return
      setSites(((s?.sites as Site[]) || []).filter((site) => site.is_active))
      setStaff(((w?.workforce as Staff[]) || []).filter((person) => person.employment_status === 'active'))
      setOptionsReady(true)
    }).catch(() => { if (active) setOptionsReady(false) })
    return () => { active = false }
  }, [listGarageSites, listGarageWorkforce, isAdmin])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!customerId || !detail || !isAdmin) return
    setFormError(null)
    setMessage(null)
    const before = fromRelationship(detail.customer.relationship)
    const body: Record<string, unknown> = {}
    if (editor.relationship_status !== before.relationship_status && editor.relationship_status) body.relationship_status = editor.relationship_status
    if (editor.customer_category !== before.customer_category) body.customer_category = editor.customer_category || null
    if (editor.preferred_branch_id !== before.preferred_branch_id) body.preferred_branch_id = editor.preferred_branch_id || null
    if (editor.assigned_staff_user_id !== before.assigned_staff_user_id) body.assigned_staff_user_id = editor.assigned_staff_user_id || null
    if (editor.internal_notes !== before.internal_notes) body.internal_notes = editor.internal_notes || null
    if (editor.tags !== before.tags) body.tags = editor.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (editor.follow_up_date !== before.follow_up_date || editor.follow_up_status !== before.follow_up_status) {
      if (Boolean(editor.follow_up_date) !== Boolean(editor.follow_up_status)) {
        setFormError('Record both a follow-up date and status, or clear both.')
        return
      }
      body.follow_up_at = editor.follow_up_date ? new Date(`${editor.follow_up_date}T00:00:00Z`).toISOString() : null
      body.follow_up_status = editor.follow_up_status || null
    }
    if (!Object.keys(body).length) { setMessage('No relationship changes to save.'); return }
    setBusy(true)
    try {
      await updateGarageCustomerRelationship(customerId, body)
      await load()
      setMessage('Garage relationship updated.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Relationship could not be updated.')
    } finally { setBusy(false) }
  }

  return <div className={SN_PAGE}>
    <Link to="/garage/customers" className="text-sm text-gray-600 hover:text-gray-900">← Back to customers</Link>
    {state === 'loading' && <p role="status">Loading customer relationship…</p>}
    {state === 'error' && <Card data-testid="customer-detail-error"><CardContent className="p-6">
      <p className="font-semibold">Customer relationship could not be loaded</p>
      <p className="text-sm text-gray-500">This is a loading problem, not an empty customer record.</p>
      <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>Try again</Button>
    </CardContent></Card>}
    {state === 'ready' && detail && <>
      <header>
        <h1 className="text-2xl font-bold">{detail.customer.display_name || 'Unnamed customer'}</h1>
        <p className="text-sm text-gray-500">{detail.customer.identity_status} · {detail.customer.relationship?.customer_reference_code || 'Garage reference not recorded'}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="p-5 space-y-2">
          <h2 className="font-semibold">Garage relationship</h2>
          <p>Status: {recordLabel(detail.customer.relationship?.relationship_status)}</p>
          <p>Category: {recordLabel(detail.customer.relationship?.customer_category)} <span className="text-xs text-gray-500">(Garage-entered)</span></p>
          <p>Preferred site: {detail.customer.relationship?.preferred_site_name || sites.find((s) => s.id === detail.customer.relationship?.preferred_branch_id)?.name || recordLabel(detail.customer.relationship?.preferred_branch_id)}</p>
          <p>Service advisor: {detail.customer.relationship?.assigned_staff_name || staff.find((p) => p.user_id === detail.customer.relationship?.assigned_staff_user_id)?.user?.name || recordLabel(detail.customer.relationship?.assigned_staff_user_id)}</p>
          <p>First relationship: {detail.customer.relationship?.first_relationship_at ? whenLabel(detail.customer.relationship.first_relationship_at) : 'Not recorded'}</p>
          <p>Follow-up: {detail.customer.relationship?.follow_up_at ? `${whenLabel(detail.customer.relationship.follow_up_at)} · ${detail.customer.relationship.follow_up_status}` : 'Not recorded'}</p>
          <p>Tags: {detail.customer.relationship?.tags.length ? detail.customer.relationship.tags.join(', ') : 'Not recorded'} <span className="text-xs text-gray-500">(Garage-entered)</span></p>
          <p>Internal notes: {detail.customer.relationship?.notes_available === false ? 'Private to Garage admin' : detail.customer.relationship?.internal_notes || 'Not recorded'} <span className="text-xs text-gray-500">(private Garage metadata)</span></p>
        </CardContent></Card>
        <Card><CardContent className="p-5 space-y-2">
          <h2 className="font-semibold">Service relationship</h2>
          <p>Recorded service costs: {spendLabel(detail.customer.spend_by_currency)}</p>
          <p className="text-xs text-gray-500">Recorded costs by currency; these are not proof of paid revenue.</p>
          <p>{detail.cases.length} service cases · {detail.work_orders.length} work orders · {detail.service_records.length} service records</p>
          {detail.customer.conversation_thread_id && canOpenMessages && <Link className="text-orange-700 underline" to="/diaspora/messages">Open canonical Messages</Link>}
          {detail.customer.conversation_thread_id && !canOpenMessages && <p>Conversation linked; use your authorized Messages workspace.</p>}
          {!detail.customer.conversation_thread_id && <p>Conversation: Not recorded</p>}
        </CardContent></Card>
      </div>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Related canonical vehicles</h2>
        {detail.vehicles.length === 0 && <p className="text-sm text-gray-500">No related vehicles recorded.</p>}
        <div className="grid gap-3 md:grid-cols-2">{detail.vehicles.map((v) => <Card key={v.vin}><CardContent className="p-4 space-y-1">
          <p className="font-medium break-all">{v.make || 'Make not recorded'} {v.model || 'Model not recorded'} · {v.year || 'Year not recorded'}</p>
          <p className="text-sm break-all">VIN {v.vin}</p>
          <p className="text-sm">Relationship: service requester for this VIN</p>
          <p className="text-sm">Canonical owner: {v.canonical_owner_is_customer ? 'This CarUp customer' : v.canonical_owner_recorded ? 'Another recorded owner' : 'Not recorded'}</p>
          <p className="text-sm">{v.case_count} Garage cases · {v.open_case_count} open · last service {whenLabel(v.last_service_at)}</p>
        </CardContent></Card>)}</div>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Service cases and work orders</h2>
        {detail.cases.length === 0 && <p className="text-sm text-gray-500">No service history recorded for this prospect.</p>}
        {detail.cases.map((c) => <Card key={c.id}><CardContent className="p-4">
          <Link to={`/garage/cases/${encodeURIComponent(c.id)}`} className="font-medium text-orange-700 underline">Case {c.id.slice(0, 8)}</Link>
          <p className="text-sm">{c.status} · {recordLabel(c.service_category)} · VIN {c.vin} · requested {whenLabel(c.requested_at)}</p>
          {detail.work_orders.filter((w) => w.service_case_id === c.id).map((w) => <p className="text-sm" key={w.id}>Work order {w.id.slice(0, 8)} · {w.status}</p>)}
          {detail.service_records.filter((r) => r.service_case_id === c.id).map((r) => <p className="text-sm" key={r.id}>
            Service record {r.id.slice(0, 8)} · {recordLabel(r.service_category)} · {r.total_cost === null || !r.currency ? 'Cost not recorded' : `${r.currency} ${Number(r.total_cost).toLocaleString()}`} · {whenLabel(r.performed_at || r.created_at)}
          </p>)}
        </CardContent></Card>)}
      </section>
      {isAdmin && <Card><CardContent className="p-5"><h2 className="font-semibold mb-3">Edit Garage metadata</h2>
        <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Relationship status<select className="mt-1 min-h-11 w-full rounded-md border px-3" value={editor.relationship_status} onChange={(e) => setEditor({ ...editor, relationship_status: e.target.value })}>
            <option value="">Not recorded</option><option value="active" disabled={detail.customer.party_kind !== 'registered'}>Active</option><option value="inactive">Inactive</option><option value="prospect">Prospect</option>
          </select></label>
          <label className="text-sm">Customer category<select className="mt-1 min-h-11 w-full rounded-md border px-3" value={editor.customer_category} onChange={(e) => setEditor({ ...editor, customer_category: e.target.value })}>
            <option value="">Not recorded</option><option value="individual">Individual</option><option value="business">Business</option><option value="fleet">Fleet</option><option value="other">Other</option>
          </select></label>
          <label className="text-sm">Preferred site<select className="mt-1 min-h-11 w-full rounded-md border px-3" value={editor.preferred_branch_id} disabled={!optionsReady} onChange={(e) => setEditor({ ...editor, preferred_branch_id: e.target.value })}>
            <option value="">Not recorded</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label className="text-sm">Assigned service advisor<select className="mt-1 min-h-11 w-full rounded-md border px-3" value={editor.assigned_staff_user_id} disabled={!optionsReady} onChange={(e) => setEditor({ ...editor, assigned_staff_user_id: e.target.value })}>
            <option value="">Not recorded</option>{staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.user?.name || p.staff_code}</option>)}
          </select></label>
          <label className="text-sm">Follow-up date<Input className="mt-1" type="date" value={editor.follow_up_date} onChange={(e) => setEditor({ ...editor, follow_up_date: e.target.value })} /></label>
          <label className="text-sm">Follow-up status<select className="mt-1 min-h-11 w-full rounded-md border px-3" value={editor.follow_up_status} onChange={(e) => setEditor({ ...editor, follow_up_status: e.target.value })}>
            <option value="">Not recorded</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select></label>
          <label className="text-sm sm:col-span-2">Garage tags (comma separated)<Input className="mt-1" value={editor.tags} onChange={(e) => setEditor({ ...editor, tags: e.target.value })} /></label>
          <label className="text-sm sm:col-span-2">Private Garage notes<textarea className="mt-1 min-h-28 w-full rounded-md border p-3" maxLength={2000} value={editor.internal_notes} onChange={(e) => setEditor({ ...editor, internal_notes: e.target.value })} /></label>
          {!optionsReady && <p className="sm:col-span-2 text-sm text-amber-700">Site and workforce options could not be loaded. Retry this page before changing them.</p>}
          {formError && <p className="sm:col-span-2 text-sm text-red-700" role="alert">{formError}</p>}
          {message && <p className="sm:col-span-2 text-sm text-green-700" role="status">{message}</p>}
          <Button type="submit" className="min-h-11 sm:col-span-2" disabled={busy}>Save relationship</Button>
        </form>
      </CardContent></Card>}
    </>}
  </div>
}
