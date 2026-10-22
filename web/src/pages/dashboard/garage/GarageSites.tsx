import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, MapPin, Plus, Pencil, Power, PowerOff } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

type Hour = { day_of_week: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }
type Site = {
  id: string; branch_code: string | null; name: string; address_public: string | null
  location_city: string | null; location_province: string | null; country_code: string | null
  phone: string | null; email: string | null; whatsapp: string | null; timezone: string | null
  is_active: boolean; is_primary: boolean; is_public: boolean; manager_user_id: string | null
  opening_hours: Hour[]
}
type Workforce = { user_id: string; employment_status: string; staff_code: string; user?: { name?: string | null } | null }

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const blankHours = (): Hour[] => DAYS.map((_, day_of_week) => ({
  day_of_week, is_closed: day_of_week === 0, opens_at: day_of_week === 0 ? null : '08:00', closes_at: day_of_week === 0 ? null : '17:00',
}))
const emptyForm = () => ({
  branch_code: '', name: '', address_line: '', location_city: '', location_province: '', country_code: '',
  phone: '', email: '', whatsapp: '', timezone: '', is_primary: false, is_public: false,
  manager_user_id: '', opening_hours: blankHours(),
})

export default function GarageSites() {
  const { listGarageSites, createGarageSite, updateGarageSite, setGarageSiteStatus, setGarageSiteManager, listGarageWorkforce } = useCarUpApi()
  const [sites, setSites] = useState<Site[] | null>(null)
  const [workforce, setWorkforce] = useState<Workforce[]>([])
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const [siteResult, staffResult] = await Promise.all([listGarageSites(), listGarageWorkforce()])
      setSites((siteResult?.sites as Site[] | undefined) ?? [])
      setWorkforce(((staffResult?.workforce as Workforce[] | undefined) ?? []).filter((p) => p.employment_status === 'active'))
      setState('ready')
    } catch { setState('error') }
  }, [listGarageSites, listGarageWorkforce])

  useEffect(() => { void load() }, [load])

  const managerName = useMemo(() => new Map(workforce.map((p) => [p.user_id, p.user?.name || p.staff_code])), [workforce])

  function edit(site: Site) {
    setEditing(site.id)
    const byDay = new Map((site.opening_hours || []).map((h) => [h.day_of_week, h]))
    setForm({
      branch_code: site.branch_code || '', name: site.name, address_line: site.address_public || '',
      location_city: site.location_city || '', location_province: site.location_province || '',
      country_code: site.country_code || '', phone: site.phone || '', email: site.email || '',
      whatsapp: site.whatsapp || '', timezone: site.timezone || '', is_primary: site.is_primary,
      is_public: site.is_public, manager_user_id: site.manager_user_id || '',
      opening_hours: DAYS.map((_, day) => byDay.get(day) || { day_of_week: day, is_closed: true, opens_at: null, closes_at: null }),
    })
    setError(null)
  }

  function setHour(day: number, patch: Partial<Hour>) {
    setForm((f) => ({ ...f, opening_hours: f.opening_hours.map((h) => h.day_of_week === day ? { ...h, ...patch } : h) }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    const payload = {
      ...form,
      manager_user_id: form.manager_user_id || null,
      location_province: form.location_province || null,
      phone: form.phone || null, email: form.email || null, whatsapp: form.whatsapp || null,
      timezone: form.timezone || undefined,
      opening_hours: form.opening_hours.map((h) => h.is_closed
        ? { day_of_week: h.day_of_week, is_closed: true }
        : { day_of_week: h.day_of_week, is_closed: false, opens_at: h.opens_at, closes_at: h.closes_at }),
    }
    try {
      if (editing) {
        const previous = sites?.find((site) => site.id === editing) || null
        const { manager_user_id: managerUserId, ...sitePayload } = payload
        await updateGarageSite(editing, sitePayload)
        const nextManager = managerUserId || null
        if ((previous?.manager_user_id || null) !== nextManager) {
          await setGarageSiteManager(editing, nextManager)
        }
      } else {
        await createGarageSite(payload)
      }
      setEditing(null); setForm(emptyForm()); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'The site could not be saved.') }
    finally { setBusy(false) }
  }

  async function toggle(site: Site) {
    setBusy(true); setError(null)
    try { await setGarageSiteStatus(site.id, site.is_active ? 'inactive' : 'active'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'The site status could not be changed.') }
    finally { setBusy(false) }
  }

  if (state === 'loading') return <div className="p-6 flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading sites…</div>
  if (state === 'error') return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="sites-error">
      <h1 className="text-2xl font-bold">Sites</h1>
      <p className="mt-4 text-sm text-red-700">Your sites could not be loaded. This does not mean your garage has no sites.</p>
      <Button variant="outline" className="mt-4 min-h-11" onClick={() => void load()}>Try again</Button>
    </div>
  )

  return (
    <div className={`p-4 sm:p-6 ${SN_PAGE}`}>
      <div>
        <h1 className="text-2xl font-bold">Sites</h1>
        <p className="text-sm text-gray-600 mt-1">Manage the real operating locations of this garage. Parts stock remains garage-wide until branch inventory is introduced.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
        <section className="space-y-3" aria-label="Garage sites">
          {sites?.length === 0 && (
            <Card data-testid="sites-empty"><CardContent className="p-6 text-center">
              <MapPin className="w-6 h-6 mx-auto text-gray-400" />
              <p className="font-medium mt-2">No operating sites have been recorded yet</p>
              <p className="text-sm text-gray-500 mt-1">Create the first site to begin multi-site operations.</p>
            </CardContent></Card>
          )}
          {sites?.map((site) => (
            <Card key={site.id} data-testid="site-card"><CardContent className="p-4 sm:p-5">
              <div className="flex flex-wrap gap-3 items-start justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <p className="font-semibold break-words">{site.name}</p>
                    <Badge variant="outline">{site.branch_code || 'Code not set'}</Badge>
                    <Badge className={site.is_active ? 'bg-green-600' : 'bg-gray-500'}>{site.is_active ? 'Active' : 'Inactive'}</Badge>
                    {site.is_primary && <Badge variant="secondary">Primary</Badge>}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 break-words">{[site.address_public, site.location_city, site.location_province, site.country_code].filter(Boolean).join(', ') || 'Address not recorded'}</p>
                  <p className="text-xs text-gray-500 mt-2">Timezone: {site.timezone || 'Not recorded'} · Manager: {site.manager_user_id ? (managerName.get(site.manager_user_id) || 'Recorded staff member') : 'Not assigned'}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => edit(site)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                  <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => void toggle(site)}>
                    {site.is_active ? <PowerOff className="w-4 h-4 mr-1" /> : <Power className="w-4 h-4 mr-1" />}
                    {site.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </CardContent></Card>
          ))}
        </section>

        <form onSubmit={submit} className="rounded-xl border bg-white p-4 sm:p-5 space-y-4" data-testid="site-form">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{editing ? 'Edit site' : 'Add a site'}</h2>
            {editing && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setEditing(null); setForm(emptyForm()) }}>Cancel</Button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Branch code<Input required disabled={Boolean(editing && form.branch_code)} value={form.branch_code} onChange={(e) => setForm({ ...form, branch_code: e.target.value.toUpperCase() })} placeholder="SITE-01" /></label>
            <label className="text-sm">Name<Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          </div>
          <label className="text-sm block">Address<Input required value={form.address_line} onChange={(e) => setForm({ ...form, address_line: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">City<Input required value={form.location_city} onChange={(e) => setForm({ ...form, location_city: e.target.value })} /></label>
            <label className="text-sm">Province / state<Input value={form.location_province} onChange={(e) => setForm({ ...form, location_province: e.target.value })} /></label>
            <label className="text-sm">Country code<Input required maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })} placeholder="ZW" /></label>
            <label className="text-sm">Timezone<Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Uses garage default if blank" /></label>
            <label className="text-sm">Phone<Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="text-sm">WhatsApp<Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
          </div>
          <label className="text-sm block">Email<Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-sm block">Manager
            <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={form.manager_user_id} onChange={(e) => setForm({ ...form, manager_user_id: e.target.value })}>
              <option value="">No manager assigned</option>
              {workforce.map((p) => <option key={p.user_id} value={p.user_id}>{p.user?.name || p.staff_code}</option>)}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Opening hours</legend>
            <div className="space-y-2">
              {form.opening_hours.map((h) => (
                <div key={h.day_of_week} className="grid grid-cols-[3rem_5rem_1fr_1fr] gap-2 items-center text-sm">
                  <span>{DAYS[h.day_of_week]}</span>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={h.is_closed} onChange={(e) => setHour(h.day_of_week, { is_closed: e.target.checked, opens_at: e.target.checked ? null : '08:00', closes_at: e.target.checked ? null : '17:00' })} /> Closed</label>
                  <Input type="time" disabled={h.is_closed} value={h.opens_at || ''} onChange={(e) => setHour(h.day_of_week, { opens_at: e.target.value })} />
                  <Input type="time" disabled={h.is_closed} value={h.closes_at || ''} onChange={(e) => setHour(h.day_of_week, { closes_at: e.target.value })} />
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} /> Primary site</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> Customer-visible</label>
          </div>
          <Button className="min-h-11 w-full sm:w-auto" disabled={busy} type="submit">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {editing ? 'Save site' : 'Create site'}
          </Button>
        </form>
      </div>
    </div>
  )
}
