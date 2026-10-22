import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, UserCog, Award, MapPin } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type Member = {
  membershipId: string
  userId: string
  displayName: string | null
  email: string | null
  role: string | null
  joinedAt: string | null
}
type Site = { id: string; branch_code: string | null; name: string; is_active: boolean }
type Department = { id: string; name: string; is_active: boolean }
type BranchAssignment = { branch_id: string; is_primary: boolean }
type Skill = { id: string; skill_name: string }
type Certification = {
  id: string; name: string; issuer: string | null; reference_number: string | null
  issue_date: string | null; expiry_date: string | null
}
type WorkforceProfile = {
  id: string; tenant_id: string; user_id: string; staff_code: string; job_title: string | null
  employment_classification: 'owner'|'employee'|'contractor'|'other'
  employment_status: 'pending'|'active'|'inactive'|'ended'
  start_date: string; end_date: string | null; department_id: string | null
  internal_notes: string | null
  user?: { id: string; name: string | null; email: string | null } | null
  department?: Department | null
  branch_assignments: BranchAssignment[]
  skills: Skill[]
  certifications: Certification[]
}

const emptyProfile = () => ({
  staff_code: '',
  job_title: '',
  employment_classification: 'employee',
  start_date: new Date().toISOString().slice(0, 10),
  department_id: '',
  internal_notes: '',
  primary_branch_id: '',
  additional_branch_ids: [] as string[],
  skills: '',
})

export default function GarageWorkforce() {
  const {
    listGarageMembers, listGarageWorkforce, listGarageSites, listGarageDepartments,
    createGarageDepartment, createGarageWorkforceProfile, upsertGarageWorkforceProfile,
    setGarageWorkforceStatus, setGarageWorkforceBranches, replaceGarageWorkforceSkills,
    addGarageWorkforceCertification,
  } = useCarUpApi()

  const [members, setMembers] = useState<Member[] | null>(null)
  const [workforce, setWorkforce] = useState<WorkforceProfile[] | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [form, setForm] = useState(emptyProfile)
  const [departmentName, setDepartmentName] = useState('')
  const [cert, setCert] = useState({ name: '', issuer: '', reference_number: '', issue_date: '', expiry_date: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const [memberR, staffR, siteR, deptR] = await Promise.all([
        listGarageMembers(), listGarageWorkforce(), listGarageSites(), listGarageDepartments(),
      ])
      setMembers((memberR?.members as Member[] | undefined) ?? [])
      setWorkforce((staffR?.workforce as WorkforceProfile[] | undefined) ?? [])
      setSites(((siteR?.sites as Site[] | undefined) ?? []).filter((s) => s.is_active))
      setDepartments(((deptR?.departments as Department[] | undefined) ?? []).filter((d) => d.is_active))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [listGarageMembers, listGarageWorkforce, listGarageSites, listGarageDepartments])

  useEffect(() => { void load() }, [load])

  const byUser = useMemo(() => new Map((workforce || []).map((p) => [p.user_id, p])), [workforce])
  const selectedMember = members?.find((m) => m.userId === selectedUserId) || null
  const selectedProfile = selectedUserId ? byUser.get(selectedUserId) || null : null

  function choose(userId: string) {
    setSelectedUserId(userId); setError(null)
    const p = byUser.get(userId)
    if (!p) {
      setForm(emptyProfile())
      return
    }
    const primary = p.branch_assignments?.find((a) => a.is_primary)?.branch_id || ''
    setForm({
      staff_code: p.staff_code,
      job_title: p.job_title || '',
      employment_classification: p.employment_classification,
      start_date: p.start_date,
      department_id: p.department_id || '',
      internal_notes: p.internal_notes || '',
      primary_branch_id: primary,
      additional_branch_ids: (p.branch_assignments || []).filter((a) => !a.is_primary).map((a) => a.branch_id),
      skills: (p.skills || []).map((s) => s.skill_name).join(', '),
    })
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId) return
    if (selectedMember?.role === 'mechanic' && !form.primary_branch_id) {
      setError('Assign a primary active site before activating this mechanic.')
      return
    }
    setBusy('profile'); setError(null)
    try {
      const payload = {
        staff_code: form.staff_code.trim().toUpperCase(),
        job_title: form.job_title.trim() || null,
        employment_classification: form.employment_classification,
        start_date: form.start_date,
        department_id: form.department_id || null,
        internal_notes: form.internal_notes.trim() || null,
      }
      if (selectedProfile) await upsertGarageWorkforceProfile(selectedUserId, payload)
      else await createGarageWorkforceProfile({ user_id: selectedUserId, ...payload })

      if (form.primary_branch_id) {
        await setGarageWorkforceBranches(selectedUserId, {
          primary_branch_id: form.primary_branch_id,
          additional_branch_ids: form.additional_branch_ids,
        })
      }
      const skills = [...new Set(form.skills.split(',').map((s) => s.trim()).filter(Boolean))]
      await replaceGarageWorkforceSkills(selectedUserId, skills)
      if (selectedMember?.role === 'mechanic' && (!selectedProfile || selectedProfile.employment_status === 'pending')) {
        await setGarageWorkforceStatus(selectedUserId, 'active')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The workforce profile could not be saved.')
    } finally { setBusy(null) }
  }

  async function changeStatus(status: 'active'|'inactive'|'ended') {
    if (!selectedUserId) return
    setBusy('status'); setError(null)
    try { await setGarageWorkforceStatus(selectedUserId, status); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'The workforce status could not be changed.') }
    finally { setBusy(null) }
  }

  async function addDepartment(e: React.FormEvent) {
    e.preventDefault()
    const name = departmentName.trim()
    if (!name) return
    setBusy('department'); setError(null)
    try {
      await createGarageDepartment(name)
      setDepartmentName('')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'The department could not be created.') }
    finally { setBusy(null) }
  }

  async function addCertification(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId || !cert.name.trim()) return
    setBusy('cert'); setError(null)
    try {
      await addGarageWorkforceCertification(selectedUserId, {
        name: cert.name.trim(),
        issuer: cert.issuer.trim() || null,
        reference_number: cert.reference_number.trim() || null,
        issue_date: cert.issue_date || null,
        expiry_date: cert.expiry_date || null,
      })
      setCert({ name: '', issuer: '', reference_number: '', issue_date: '', expiry_date: '' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'The certification could not be recorded.') }
    finally { setBusy(null) }
  }

  if (state === 'loading') return <div className="p-6 flex items-center gap-2" data-testid="workforce-loading"><Loader2 className="w-5 h-5 animate-spin" /> Loading workforce…</div>
  if (state === 'error') return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="workforce-error">
      <h1 className="text-2xl font-bold">Workforce</h1>
      <p className="mt-4 text-sm text-red-700">Workforce records could not be loaded. This does not mean this garage has no staff.</p>
      <Button variant="outline" className="mt-4 min-h-11" onClick={() => void load()}>Try again</Button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workforce</h1>
        <p className="text-sm text-gray-600 mt-1">
          Membership controls Garage access. Workforce records describe how a real member works: staff code, responsibility, department, sites, skills and recorded qualifications.
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <section className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-5">
              <h2 className="font-semibold">Garage members</h2>
              <p className="text-xs text-gray-500 mt-1">Invite and membership acceptance happen on the Team page first. A workforce profile cannot create a user or membership.</p>
              {members?.length === 0 ? (
                <p className="mt-4 text-sm text-gray-600" data-testid="workforce-members-empty">No current Garage members were returned.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {members?.map((m) => {
                    const p = byUser.get(m.userId)
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => choose(m.userId)}
                        data-testid="workforce-member"
                        className={`w-full min-h-11 rounded-lg border p-3 text-left hover:bg-gray-50 ${selectedUserId === m.userId ? 'ring-2 ring-orange-300' : ''}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium break-words">{m.displayName || 'Unnamed member'}</span>
                          <div className="flex gap-2">
                            <Badge variant="outline">{m.role || 'Role not recorded'}</Badge>
                            {p && <Badge className={p.employment_status === 'active' ? 'bg-green-600' : 'bg-gray-500'}>{p.employment_status}</Badge>}
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 break-all">{m.email || 'Email unavailable'}</p>
                        <p className="text-xs text-gray-500 mt-1">{p ? `Staff code: ${p.staff_code}` : 'Workforce profile not completed'}</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-5">
              <h2 className="font-semibold">Departments / teams</h2>
              <p className="text-xs text-gray-500 mt-1">Departments organize work; they do not grant authorization.</p>
              <form onSubmit={addDepartment} className="flex gap-2 mt-3">
                <Input value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="Workshop, Service Desk…" data-testid="department-name" />
                <Button type="submit" variant="outline" disabled={busy === 'department'}><Plus className="w-4 h-4" /></Button>
              </form>
              <div className="flex flex-wrap gap-2 mt-3">
                {departments.map((d) => <Badge key={d.id} variant="secondary">{d.name}</Badge>)}
                {departments.length === 0 && <span className="text-xs text-gray-500">No departments recorded.</span>}
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          {!selectedMember ? (
            <Card data-testid="workforce-select-member"><CardContent className="p-8 text-center">
              <UserCog className="w-8 h-8 mx-auto text-gray-300" />
              <p className="font-medium mt-3">Choose a Garage member</p>
              <p className="text-sm text-gray-500 mt-1">Then record how that person works in this Garage.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              <form onSubmit={saveProfile} className="rounded-xl border bg-white p-4 sm:p-5 space-y-4" data-testid="workforce-profile-form">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <h2 className="font-semibold break-words">{selectedMember.displayName || 'Unnamed member'}</h2>
                    <p className="text-xs text-gray-500 break-all">{selectedMember.email || 'Email unavailable'} · Garage role: {selectedMember.role || 'unrecorded'}</p>
                  </div>
                  {selectedProfile && <Badge className={selectedProfile.employment_status === 'active' ? 'bg-green-600' : 'bg-gray-500'}>{selectedProfile.employment_status}</Badge>}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Staff code<Input required value={form.staff_code} onChange={(e) => setForm({ ...form, staff_code: e.target.value.toUpperCase() })} placeholder="STAFF-001" data-testid="staff-code" /></label>
                  <label className="text-sm">Job title<Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Branch Manager, Technician…" /></label>
                  <label className="text-sm">Classification
                    <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={form.employment_classification} onChange={(e) => setForm({ ...form, employment_classification: e.target.value })}>
                      <option value="owner">Owner</option><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className="text-sm">Start date<Input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
                  <label className="text-sm">Department
                    <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                      <option value="">No department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Primary site
                    <select className="mt-1 min-h-11 w-full rounded-md border px-3" value={form.primary_branch_id} onChange={(e) => setForm({ ...form, primary_branch_id: e.target.value })} data-testid="primary-site">
                      <option value="">Not assigned yet</option>
                      {sites.map((s) => <option key={s.id} value={s.id}>{s.branch_code ? `${s.branch_code} — ` : ''}{s.name}</option>)}
                    </select>
                  </label>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium">Additional permitted sites</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sites.filter((s) => s.id !== form.primary_branch_id).map((s) => {
                      const checked = form.additional_branch_ids.includes(s.id)
                      return (
                        <label key={s.id} className="min-h-11 inline-flex items-center gap-2 rounded-lg border px-3 text-sm">
                          <input
                            type="checkbox" checked={checked}
                            onChange={(e) => setForm((f) => ({
                              ...f,
                              additional_branch_ids: e.target.checked
                                ? [...new Set([...f.additional_branch_ids, s.id])]
                                : f.additional_branch_ids.filter((id) => id !== s.id),
                            }))}
                          />
                          {s.branch_code || s.name}
                        </label>
                      )
                    })}
                    {sites.length === 0 && <span className="text-xs text-gray-500">Create an active site before assigning staff.</span>}
                  </div>
                </fieldset>

                <label className="text-sm block">Skills / specialties
                  <Input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="Brakes, diagnostics, electrical" />
                  <span className="text-xs text-gray-500">Recorded facts only; comma-separated. No skill is treated as independently verified.</span>
                </label>

                <label className="text-sm block">Internal operational notes
                  <textarea className="mt-1 min-h-24 w-full rounded-md border p-3 text-sm" value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" className="min-h-11" disabled={busy === 'profile'}>
                    {busy === 'profile' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {selectedProfile ? 'Save workforce profile' : 'Create workforce profile'}
                  </Button>
                  {selectedProfile && selectedProfile.employment_status !== 'active' && selectedProfile.employment_status !== 'ended' && <Button type="button" variant="outline" onClick={() => void changeStatus('active')} disabled={busy === 'status'}>{selectedProfile.employment_status === 'pending' ? 'Activate' : 'Reactivate'}</Button>}
                  {selectedProfile?.employment_status === 'active' && <Button type="button" variant="outline" onClick={() => void changeStatus('inactive')} disabled={busy === 'status'}>Mark inactive</Button>}
                  {selectedProfile && selectedProfile.employment_status !== 'ended' && <Button type="button" variant="outline" onClick={() => void changeStatus('ended')} disabled={busy === 'status'}>End workforce record</Button>}
                </div>
              </form>

              {selectedProfile && (
                <Card>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center gap-2"><Award className="w-5 h-5 text-gray-500" /><h2 className="font-semibold">Recorded certifications</h2></div>
                    <p className="text-xs text-gray-500 mt-1">Recording a certificate does not mean CarUp verified it.</p>
                    <div className="mt-3 space-y-2">
                      {(selectedProfile.certifications || []).map((c) => (
                        <div key={c.id} className="rounded-lg border p-3 text-sm" data-testid="certification-item">
                          <p className="font-medium break-words">{c.name}</p>
                          <p className="text-xs text-gray-500 break-words">{c.issuer || 'Issuer not recorded'}{c.reference_number ? ` · ${c.reference_number}` : ''}</p>
                          <p className="text-xs text-gray-500">{c.issue_date || 'Issue date not recorded'}{c.expiry_date ? ` → expires ${c.expiry_date}` : ''}</p>
                        </div>
                      ))}
                      {selectedProfile.certifications?.length === 0 && <p className="text-sm text-gray-500">No certifications recorded.</p>}
                    </div>
                    <form onSubmit={addCertification} className="grid gap-3 sm:grid-cols-2 mt-4">
                      <label className="text-sm">Name<Input required value={cert.name} onChange={(e) => setCert({ ...cert, name: e.target.value })} /></label>
                      <label className="text-sm">Issuer<Input value={cert.issuer} onChange={(e) => setCert({ ...cert, issuer: e.target.value })} /></label>
                      <label className="text-sm">Reference number<Input value={cert.reference_number} onChange={(e) => setCert({ ...cert, reference_number: e.target.value })} /></label>
                      <label className="text-sm">Issue date<Input type="date" value={cert.issue_date} onChange={(e) => setCert({ ...cert, issue_date: e.target.value })} /></label>
                      <label className="text-sm">Expiry date<Input type="date" value={cert.expiry_date} onChange={(e) => setCert({ ...cert, expiry_date: e.target.value })} /></label>
                      <div className="flex items-end"><Button type="submit" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={busy === 'cert'}><Plus className="w-4 h-4 mr-2" /> Record certification</Button></div>
                    </form>
                  </CardContent>
                </Card>
              )}

              {selectedProfile?.branch_assignments?.length ? (
                <Card><CardContent className="p-4">
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-500" /><p className="font-medium">Current site assignments</p></div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedProfile.branch_assignments.map((a) => {
                      const site = sites.find((s) => s.id === a.branch_id)
                      return <Badge key={a.branch_id} variant={a.is_primary ? 'default' : 'secondary'}>{site?.branch_code || site?.name || 'Recorded site'}{a.is_primary ? ' · primary' : ''}</Badge>
                    })}
                  </div>
                </CardContent></Card>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
