import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  Settings2,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  useCarUpApi,
  type GarageDepartment,
  type GarageOpeningHour,
  type GarageOperatingBranch,
  type GarageStaffOperatingRecord,
} from '@/hooks/useCarUpApi'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type BranchDraft = {
  name: string
  code: string
  location_city: string
  location_province: string
  address_public: string
  contact_phone: string
  contact_email: string
  manager_user_id: string
}

const EMPTY_BRANCH: BranchDraft = {
  name: '',
  code: '',
  location_city: '',
  location_province: '',
  address_public: '',
  contact_phone: '',
  contact_email: '',
  manager_user_id: '',
}

function branchDraft(branch: GarageOperatingBranch): BranchDraft {
  return {
    name: branch.name || '',
    code: branch.code || '',
    location_city: branch.location_city || '',
    location_province: branch.location_province || '',
    address_public: branch.address_public || '',
    contact_phone: branch.contact_phone || '',
    contact_email: branch.contact_email || '',
    manager_user_id: branch.manager_user_id || '',
  }
}

function defaultHours(existing: GarageOpeningHour[] = []): GarageOpeningHour[] {
  const byDay = new Map(existing.filter((row) => row.slot_no === 1).map((row) => [row.weekday, row]))
  return DAY_LABELS.map((_, weekday) => {
    const row = byDay.get(weekday)
    return row || {
      weekday,
      slot_no: 1,
      is_closed: weekday === 0,
      opens_at: weekday === 0 ? null : '08:00',
      closes_at: weekday === 0 ? null : '17:00',
    }
  })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

type BranchEditorProps = {
  branch: GarageOperatingBranch
  admins: GarageStaffOperatingRecord[]
  onSaved: () => Promise<void>
}

function BranchEditor({ branch, admins, onSaved }: BranchEditorProps) {
  const api = useCarUpApi()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<BranchDraft>(() => branchDraft(branch))
  const [hours, setHours] = useState<GarageOpeningHour[]>(() => defaultHours(branch.opening_hours))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(branchDraft(branch))
    setHours(defaultHours(branch.opening_hours))
  }, [branch])

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await onSaved()
      setNotice(success)
    } catch (e) {
      setError(errorMessage(e, 'That change did not save.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveBranch() {
    await act(
      () => api.updateGarageOperatingBranch(branch.id, {
        name: draft.name,
        code: draft.code || null,
        location_city: draft.location_city || null,
        location_province: draft.location_province || null,
        address_public: draft.address_public || null,
        contact_phone: draft.contact_phone || null,
        contact_email: draft.contact_email || null,
        manager_user_id: draft.manager_user_id || null,
      }),
      'Branch details saved.',
    )
    setEditing(false)
  }

  async function saveHours() {
    await act(
      () => api.replaceGarageOperatingHours(
        branch.id,
        hours.map((row) => ({
          weekday: row.weekday,
          slot_no: 1,
          is_closed: row.is_closed,
          opens_at: row.is_closed ? null : row.opens_at,
          closes_at: row.is_closed ? null : row.closes_at,
        })),
      ),
      'Opening hours saved.',
    )
  }

  return (
    <Card className="border-0 card-shadow" data-testid="garage-branch-card">
      <CardContent className="p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg">{branch.name}</h3>
              {branch.code && <Badge variant="outline">{branch.code}</Badge>}
              <Badge className={branch.is_active ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'}>
                {branch.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <MapPin className="w-4 h-4" aria-hidden="true" />
              {[branch.address_public, branch.location_city, branch.location_province].filter(Boolean).join(', ') || 'Address not recorded'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setEditing((v) => !v)} disabled={busy}>
              <Settings2 className="w-4 h-4 mr-2" aria-hidden="true" />
              {editing ? 'Close editor' : 'Edit site'}
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => act(
                () => api.setGarageOperatingBranchActive(branch.id, !branch.is_active),
                branch.is_active ? 'Branch deactivated.' : 'Branch reactivated.',
              )}
            >
              {branch.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        </div>

        {notice && <p className="text-sm text-green-800 bg-green-50 rounded-lg p-3" role="status">{notice}</p>}
        {error && <p className="text-sm text-red-800 bg-red-50 rounded-lg p-3" role="alert">{error}</p>}

        {editing && (
          <>
            <section className="space-y-3" aria-labelledby={`branch-details-${branch.id}`}>
              <h4 id={`branch-details-${branch.id}`} className="font-medium">Site details</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">Branch name
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                </label>
                <label className="text-sm">Branch code
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3 uppercase" value={draft.code}
                    onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))} placeholder="CBD" />
                </label>
                <label className="text-sm">City
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.location_city}
                    onChange={(e) => setDraft((d) => ({ ...d, location_city: e.target.value }))} />
                </label>
                <label className="text-sm">Province
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.location_province}
                    onChange={(e) => setDraft((d) => ({ ...d, location_province: e.target.value }))} />
                </label>
                <label className="text-sm md:col-span-2">Address
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.address_public}
                    onChange={(e) => setDraft((d) => ({ ...d, address_public: e.target.value }))} />
                </label>
                <label className="text-sm">Site phone
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.contact_phone}
                    onChange={(e) => setDraft((d) => ({ ...d, contact_phone: e.target.value }))} />
                </label>
                <label className="text-sm">Site email
                  <input type="email" className="mt-1 w-full min-h-11 rounded-lg border px-3" value={draft.contact_email}
                    onChange={(e) => setDraft((d) => ({ ...d, contact_email: e.target.value }))} />
                </label>
                <label className="text-sm md:col-span-2">Branch manager
                  <select className="mt-1 w-full min-h-11 rounded-lg border px-3 bg-white" value={draft.manager_user_id}
                    onChange={(e) => setDraft((d) => ({ ...d, manager_user_id: e.target.value }))}>
                    <option value="">No manager assigned</option>
                    {admins.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.display_name || member.email || member.user_id}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-gray-500 mt-1">Only a current Garage administrator can manage a branch.</span>
                </label>
              </div>
              <Button className="min-h-11" onClick={saveBranch} disabled={busy || draft.name.trim().length < 2}>
                Save site details
              </Button>
            </section>

            <section className="space-y-3 border-t pt-5" aria-labelledby={`branch-hours-${branch.id}`}>
              <div>
                <h4 id={`branch-hours-${branch.id}`} className="font-medium">Opening hours</h4>
                <p className="text-sm text-gray-500">These are operating facts for this site, not inferred availability.</p>
              </div>
              <div className="space-y-2">
                {hours.map((row, index) => (
                  <div key={row.weekday} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2 text-sm">
                    <span>{DAY_LABELS[row.weekday]}</span>
                    <input type="time" className="min-h-10 rounded-lg border px-2" disabled={row.is_closed}
                      value={row.opens_at?.slice(0, 5) || ''}
                      onChange={(e) => setHours((current) => current.map((h, i) => i === index ? { ...h, opens_at: e.target.value } : h))} />
                    <input type="time" className="min-h-10 rounded-lg border px-2" disabled={row.is_closed}
                      value={row.closes_at?.slice(0, 5) || ''}
                      onChange={(e) => setHours((current) => current.map((h, i) => i === index ? { ...h, closes_at: e.target.value } : h))} />
                    <label className="flex items-center gap-1 whitespace-nowrap">
                      <input type="checkbox" checked={row.is_closed}
                        onChange={(e) => setHours((current) => current.map((h, i) => i === index
                          ? { ...h, is_closed: e.target.checked, opens_at: e.target.checked ? null : (h.opens_at || '08:00'), closes_at: e.target.checked ? null : (h.closes_at || '17:00') }
                          : h))} />
                      Closed
                    </label>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="min-h-11" onClick={saveHours} disabled={busy}>Save opening hours</Button>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}

type StaffEditorProps = {
  member: GarageStaffOperatingRecord
  branches: GarageOperatingBranch[]
  departments: GarageDepartment[]
  onSaved: () => Promise<void>
}

function StaffEditor({ member, branches, departments, onSaved }: StaffEditorProps) {
  const api = useCarUpApi()
  const [profile, setProfile] = useState({
    employee_code: member.profile?.employee_code || '',
    job_title: member.profile?.job_title || '',
    department_id: member.profile?.department_id || '',
    employment_type: member.profile?.employment_type || '',
    work_phone: member.profile?.work_phone || '',
    started_on: member.profile?.started_on || '',
  })
  const [branchId, setBranchId] = useState('')
  const [primary, setPrimary] = useState(false)
  const [skill, setSkill] = useState('')
  const [cert, setCert] = useState({ name: '', issuer: '', credential_ref: '', issued_on: '', expires_on: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setProfile({
      employee_code: member.profile?.employee_code || '',
      job_title: member.profile?.job_title || '',
      department_id: member.profile?.department_id || '',
      employment_type: member.profile?.employment_type || '',
      work_phone: member.profile?.work_phone || '',
      started_on: member.profile?.started_on || '',
    })
  }, [member])

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setNotice(null)
    try {
      await action()
      await onSaved()
      setNotice(success)
    } catch (e) {
      setError(errorMessage(e, 'That change did not save.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-0 card-shadow" data-testid="garage-staff-card">
      <CardContent className="p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{member.display_name || 'Unnamed member'}</h3>
            <p className="text-sm text-gray-500">{member.email || 'No email recorded'}</p>
          </div>
          <Badge variant="outline">{member.role || 'role not recorded'}</Badge>
        </div>

        {notice && <p className="text-sm text-green-800 bg-green-50 rounded-lg p-3" role="status">{notice}</p>}
        {error && <p className="text-sm text-red-800 bg-red-50 rounded-lg p-3" role="alert">{error}</p>}

        <section className="space-y-3">
          <h4 className="font-medium">Work profile</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">Employee code
              <input className="mt-1 w-full min-h-11 rounded-lg border px-3 uppercase" value={profile.employee_code}
                onChange={(e) => setProfile((p) => ({ ...p, employee_code: e.target.value.toUpperCase() }))} />
            </label>
            <label className="text-sm">Job title
              <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={profile.job_title}
                onChange={(e) => setProfile((p) => ({ ...p, job_title: e.target.value }))} />
            </label>
            <label className="text-sm">Department
              <select className="mt-1 w-full min-h-11 rounded-lg border px-3 bg-white" value={profile.department_id}
                onChange={(e) => setProfile((p) => ({ ...p, department_id: e.target.value }))}>
                <option value="">No department</option>
                {departments.filter((d) => d.is_active).map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">Employment type
              <select className="mt-1 w-full min-h-11 rounded-lg border px-3 bg-white" value={profile.employment_type}
                onChange={(e) => setProfile((p) => ({ ...p, employment_type: e.target.value }))}>
                <option value="">Not recorded</option>
                <option value="owner">Owner</option>
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
                <option value="apprentice">Apprentice</option>
              </select>
            </label>
            <label className="text-sm">Work phone
              <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={profile.work_phone}
                onChange={(e) => setProfile((p) => ({ ...p, work_phone: e.target.value }))} />
            </label>
            <label className="text-sm">Started on
              <input type="date" className="mt-1 w-full min-h-11 rounded-lg border px-3" value={profile.started_on}
                onChange={(e) => setProfile((p) => ({ ...p, started_on: e.target.value }))} />
            </label>
          </div>
          <Button className="min-h-11" disabled={busy}
            onClick={() => act(() => api.saveGarageStaffProfile(member.user_id, {
              employee_code: profile.employee_code || null,
              job_title: profile.job_title || null,
              department_id: profile.department_id || null,
              employment_type: profile.employment_type || null,
              work_phone: profile.work_phone || null,
              started_on: profile.started_on || null,
            }), 'Work profile saved.')}>
            Save work profile
          </Button>
        </section>

        <section className="space-y-3 border-t pt-5">
          <h4 className="font-medium">Site assignments</h4>
          {member.branch_assignments.length ? (
            <ul className="space-y-2">
              {member.branch_assignments.map((assignment) => (
                <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span>{assignment.branch?.name || 'Unknown site'}{assignment.is_primary ? ' · Primary' : ''}</span>
                  <Button variant="outline" size="sm" className="min-h-10" disabled={busy}
                    onClick={() => act(
                      () => api.endGarageStaffBranchAssignment(member.user_id, assignment.id),
                      'Site assignment ended.',
                    )}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">No site assignment recorded.</p>}
          <div className="flex flex-wrap gap-2">
            <select className="min-h-11 rounded-lg border px-3 bg-white flex-1 min-w-52" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Choose an active site</option>
              {branches.filter((b) => b.is_active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <label className="flex items-center gap-2 min-h-11 px-3 rounded-lg border">
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Primary site
            </label>
            <Button variant="outline" className="min-h-11" disabled={busy || !branchId}
              onClick={() => act(
                () => api.assignGarageStaffToBranch(member.user_id, branchId, primary),
                'Site assignment saved.',
              )}>
              Assign
            </Button>
          </div>
        </section>

        <section className="space-y-3 border-t pt-5">
          <h4 className="font-medium">Skills</h4>
          <div className="flex flex-wrap gap-2">
            {member.skills.map((item) => (
              <span key={item.skill_code} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
                {item.skill_name}
                <button type="button" aria-label={`Remove ${item.skill_name}`} disabled={busy}
                  onClick={() => act(() => api.removeGarageStaffSkill(member.user_id, item.skill_code), 'Skill removed.')}>
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="min-h-11 rounded-lg border px-3 flex-1" placeholder="e.g. brake diagnostics" value={skill}
              onChange={(e) => setSkill(e.target.value)} />
            <Button variant="outline" className="min-h-11" disabled={busy || skill.trim().length < 2}
              onClick={() => act(async () => {
                await api.addGarageStaffSkill(member.user_id, skill.trim())
                setSkill('')
              }, 'Skill recorded.')}>
              Add skill
            </Button>
          </div>
        </section>

        <section className="space-y-3 border-t pt-5">
          <h4 className="font-medium">Certifications</h4>
          {member.certifications.length ? (
            <ul className="space-y-2">
              {member.certifications.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-gray-500">
                      {[item.issuer, item.expires_on ? `expires ${item.expires_on}` : null].filter(Boolean).join(' · ') || 'No issuer/expiry recorded'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="min-h-10" disabled={busy}
                    onClick={() => act(() => api.removeGarageStaffCertification(member.user_id, item.id), 'Certification removed.')}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">No certifications recorded.</p>}
          <div className="grid gap-2 md:grid-cols-2">
            <input className="min-h-11 rounded-lg border px-3" placeholder="Certification name" value={cert.name}
              onChange={(e) => setCert((c) => ({ ...c, name: e.target.value }))} />
            <input className="min-h-11 rounded-lg border px-3" placeholder="Issuer" value={cert.issuer}
              onChange={(e) => setCert((c) => ({ ...c, issuer: e.target.value }))} />
            <input className="min-h-11 rounded-lg border px-3" placeholder="Credential / licence reference" value={cert.credential_ref}
              onChange={(e) => setCert((c) => ({ ...c, credential_ref: e.target.value }))} />
            <label className="text-sm">Expiry
              <input type="date" className="mt-1 min-h-11 rounded-lg border px-3 w-full" value={cert.expires_on}
                onChange={(e) => setCert((c) => ({ ...c, expires_on: e.target.value }))} />
            </label>
          </div>
          <Button variant="outline" className="min-h-11" disabled={busy || cert.name.trim().length < 2}
            onClick={() => act(async () => {
              await api.addGarageStaffCertification(member.user_id, {
                name: cert.name.trim(),
                issuer: cert.issuer.trim() || null,
                credential_ref: cert.credential_ref.trim() || null,
                expires_on: cert.expires_on || null,
              })
              setCert({ name: '', issuer: '', credential_ref: '', issued_on: '', expires_on: '' })
            }, 'Certification recorded.')}>
            Add certification
          </Button>
        </section>
      </CardContent>
    </Card>
  )
}

export default function GarageOperations() {
  const api = useCarUpApi()
  const [tab, setTab] = useState<'sites' | 'staff'>('sites')
  const [branches, setBranches] = useState<GarageOperatingBranch[]>([])
  const [staff, setStaff] = useState<GarageStaffOperatingRecord[]>([])
  const [departments, setDepartments] = useState<GarageDepartment[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [branchForm, setBranchForm] = useState<BranchDraft>(EMPTY_BRANCH)
  const [department, setDepartment] = useState({ code: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [siteData, staffData] = await Promise.all([
        api.fetchGarageOperatingBranches(),
        api.fetchGarageStaffOperations(),
      ])
      setBranches(siteData.branches || [])
      setStaff(staffData.staff || [])
      setDepartments(staffData.departments || [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [api.fetchGarageOperatingBranches, api.fetchGarageStaffOperations])

  useEffect(() => { load() }, [load])

  const admins = useMemo(() => staff.filter((member) => String(member.role).toLowerCase() === 'admin'), [staff])

  async function createBranch() {
    setBusy(true); setError(null); setNotice(null)
    try {
      await api.createGarageOperatingBranch({
        name: branchForm.name,
        code: branchForm.code || null,
        location_city: branchForm.location_city || null,
        location_province: branchForm.location_province || null,
        address_public: branchForm.address_public || null,
        contact_phone: branchForm.contact_phone || null,
        contact_email: branchForm.contact_email || null,
        manager_user_id: branchForm.manager_user_id || null,
      })
      setBranchForm(EMPTY_BRANCH)
      await load()
      setNotice('Site created.')
    } catch (e) {
      setError(errorMessage(e, 'The site could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  async function createDepartment() {
    setBusy(true); setError(null); setNotice(null)
    try {
      await api.createGarageDepartment({ code: department.code, name: department.name })
      setDepartment({ code: '', name: '' })
      await load()
      setNotice('Department created.')
    } catch (e) {
      setError(errorMessage(e, 'The department could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return <div className="p-8 flex items-center gap-3" role="status"><Loader2 className="w-5 h-5 animate-spin" />Loading sites and staff…</div>
  }

  if (state === 'error') {
    return (
      <Card className="border-0 card-shadow max-w-3xl mx-auto">
        <CardContent className="p-8 text-center">
          <p className="font-semibold">Sites and staff could not be loaded</p>
          <p className="text-sm text-gray-500 mt-1">This is a read failure, not an empty-business result.</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>Try again</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={SN_PAGE} data-testid="garage-operations">
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sites & staff</h1>
          <p className="text-gray-500">Where your garage operates and where your current members work</p>
        </div>
        <Link to="/garage/team">
          <Button variant="outline" className="min-h-11"><Users className="w-4 h-4 mr-2" /> Invitations & access</Button>
        </Link>
      </header>

      {notice && <p className="text-sm text-green-800 bg-green-50 rounded-lg p-3" role="status">{notice}</p>}
      {error && <p className="text-sm text-red-800 bg-red-50 rounded-lg p-3" role="alert">{error}</p>}

      <div className="flex gap-2" role="tablist" aria-label="Garage operations sections">
        <button role="tab" aria-selected={tab === 'sites'} onClick={() => setTab('sites')}
          className={`min-h-11 px-4 rounded-full border text-sm ${tab === 'sites' ? 'bg-gray-900 text-white' : 'bg-white'}`}>
          <Building2 className="w-4 h-4 inline mr-2" /> Sites
        </button>
        <button role="tab" aria-selected={tab === 'staff'} onClick={() => setTab('staff')}
          className={`min-h-11 px-4 rounded-full border text-sm ${tab === 'staff' ? 'bg-gray-900 text-white' : 'bg-white'}`}>
          <UserCog className="w-4 h-4 inline mr-2" /> Staff operations
        </button>
      </div>

      {tab === 'sites' ? (
        <>
          <Card className="border-0 card-shadow">
            <CardContent className="p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-lg">Create a site</h2>
                <p className="text-sm text-gray-500">Each site is a real branch under this selected Garage tenant.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">Branch name
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.name}
                    onChange={(e) => setBranchForm((b) => ({ ...b, name: e.target.value }))} />
                </label>
                <label className="text-sm">Branch code
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3 uppercase" value={branchForm.code}
                    onChange={(e) => setBranchForm((b) => ({ ...b, code: e.target.value.toUpperCase() }))} />
                </label>
                <label className="text-sm">City
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.location_city}
                    onChange={(e) => setBranchForm((b) => ({ ...b, location_city: e.target.value }))} />
                </label>
                <label className="text-sm">Province
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.location_province}
                    onChange={(e) => setBranchForm((b) => ({ ...b, location_province: e.target.value }))} />
                </label>
                <label className="text-sm md:col-span-2">Address
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.address_public}
                    onChange={(e) => setBranchForm((b) => ({ ...b, address_public: e.target.value }))} />
                </label>
                <label className="text-sm">Contact phone
                  <input className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.contact_phone}
                    onChange={(e) => setBranchForm((b) => ({ ...b, contact_phone: e.target.value }))} />
                </label>
                <label className="text-sm">Contact email
                  <input type="email" className="mt-1 w-full min-h-11 rounded-lg border px-3" value={branchForm.contact_email}
                    onChange={(e) => setBranchForm((b) => ({ ...b, contact_email: e.target.value }))} />
                </label>
                <label className="text-sm md:col-span-2">Branch manager
                  <select className="mt-1 w-full min-h-11 rounded-lg border px-3 bg-white" value={branchForm.manager_user_id}
                    onChange={(e) => setBranchForm((b) => ({ ...b, manager_user_id: e.target.value }))}>
                    <option value="">No manager assigned</option>
                    {admins.map((member) => (
                      <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Button className="min-h-11" disabled={busy || branchForm.name.trim().length < 2} onClick={createBranch}>
                <Plus className="w-4 h-4 mr-2" /> Create site
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {branches.length ? branches.map((branch) => (
              <BranchEditor key={branch.id} branch={branch} admins={admins} onSaved={load} />
            )) : (
              <Card className="border-0 card-shadow"><CardContent className="p-8 text-center">
                <Building2 className="w-7 h-7 mx-auto text-gray-300" />
                <p className="font-medium mt-2">No sites configured yet</p>
              </CardContent></Card>
            )}
          </div>
        </>
      ) : (
        <>
          <Card className="border-0 card-shadow">
            <CardContent className="p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-lg">Departments</h2>
                <p className="text-sm text-gray-500">Departments organize current Garage members; they do not grant system access.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {departments.map((item) => (
                  <Badge key={item.id} variant="outline" className={item.is_active ? '' : 'opacity-50'}>
                    {item.name} · {item.code}
                  </Badge>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <input className="min-h-11 rounded-lg border px-3 uppercase" placeholder="Code" value={department.code}
                  onChange={(e) => setDepartment((d) => ({ ...d, code: e.target.value.toUpperCase() }))} />
                <input className="min-h-11 rounded-lg border px-3" placeholder="Department name" value={department.name}
                  onChange={(e) => setDepartment((d) => ({ ...d, name: e.target.value }))} />
                <Button variant="outline" className="min-h-11" disabled={busy || department.code.trim().length < 2 || department.name.trim().length < 2}
                  onClick={createDepartment}>
                  <Plus className="w-4 h-4 mr-2" /> Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {staff.length ? staff.map((member) => (
              <StaffEditor key={member.membership_id} member={member} branches={branches} departments={departments} onSaved={load} />
            )) : (
              <Card className="border-0 card-shadow"><CardContent className="p-8 text-center">
                <Users className="w-7 h-7 mx-auto text-gray-300" />
                <p className="font-medium mt-2">No current members</p>
                <p className="text-sm text-gray-500 mt-1">Use Invitations & access to onboard staff.</p>
              </CardContent></Card>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4 text-sm text-gray-600 flex gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" aria-hidden="true" />
            <p>Work profiles, departments, skills, certifications and site placement describe operations only. Garage access still comes exclusively from current tenant membership and its governed role.</p>
          </div>
        </>
      )}
    </div>
  )
}
