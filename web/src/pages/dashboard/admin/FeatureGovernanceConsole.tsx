import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Clock, FlaskConical, Ban, EyeOff, AlertTriangle, CheckCircle2, Lock, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  FEATURE_LIFECYCLE_STATES, getAllRoles, getFeatureById,
  type FeatureLifecycleState,
} from '@/config/featureRegistry'
import { getNavigationPlacements } from '@/config/navigationManifest'
import {
  useFeatureGovernanceApi, type AdminFeatureRow, type RolloutPatch,
} from '@/hooks/useFeatureGovernanceApi'
import type { UserRole } from '@shared/types'

const ENVIRONMENTS = ['development', 'staging', 'production'] as const

const STATE_BADGE: Record<FeatureLifecycleState, string> = {
  active: 'bg-green-100 text-green-800',
  beta: 'bg-blue-100 text-blue-800',
  planned: 'bg-gray-100 text-gray-700',
  hidden: 'bg-slate-100 text-slate-600',
  disabled: 'bg-red-100 text-red-800',
  deprecated: 'bg-amber-100 text-amber-800',
}

const STATE_ICON: Record<FeatureLifecycleState, LucideIcon> = {
  active: CheckCircle2,
  beta: FlaskConical,
  planned: Clock,
  hidden: EyeOff,
  disabled: Ban,
  deprecated: AlertTriangle,
}

function StateBadge({ state }: { state: FeatureLifecycleState }) {
  // Status conveyed by an icon + the visible text (not colour alone), so
  // low-vision / greyscale users can distinguish e.g. planned vs hidden.
  const Icon = STATE_ICON[state]
  return (
    <Badge className={`${STATE_BADGE[state]} font-medium gap-1`}>
      <Icon className="w-3 h-3" aria-hidden="true" />{state}
    </Badge>
  )
}

interface EditForm {
  lifecycle_state: FeatureLifecycleState | ''
  enabled: boolean
  allowed_roles: string[]
  beta_message: string
  reason: string
  starts_at: string
  ends_at: string
  allowed_tenant_ids: string
  denied_tenant_ids: string
}

function formFromRow(row: AdminFeatureRow): EditForm {
  const o = row.override
  return {
    lifecycle_state: (o?.lifecycle_state ?? '') as FeatureLifecycleState | '',
    enabled: o?.enabled ?? true,
    allowed_roles: o?.allowed_roles ?? [],
    beta_message: o?.beta_message ?? '',
    reason: o?.reason ?? '',
    starts_at: o?.starts_at ? o.starts_at.slice(0, 16) : '',
    ends_at: o?.ends_at ? o.ends_at.slice(0, 16) : '',
    allowed_tenant_ids: (o?.allowed_tenant_ids ?? []).join(', '),
    denied_tenant_ids: (o?.denied_tenant_ids ?? []).join(', '),
  }
}

export default function FeatureGovernanceConsole() {
  const api = useFeatureGovernanceApi()
  const [environment, setEnvironment] = useState<string>('staging')
  const [rows, setRows] = useState<AdminFeatureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const [search, setSearch] = useState('')
  const [filterLifecycle, setFilterLifecycle] = useState('')
  const [filterDomain, setFilterDomain] = useState('')
  const [filterOverride, setFilterOverride] = useState('')

  const [selected, setSelected] = useState<AdminFeatureRow | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'save' | 'reset' }>(null)
  const [audit, setAudit] = useState<{ loading: boolean; error: boolean; items: any[] }>({ loading: false, error: false, items: [] })

  const load = useCallback(async () => {
    setLoading(true); setError(null); setPermissionDenied(false)
    try {
      const res = await api.listFeatures(environment)
      setRows(res.features)
    } catch (err: any) {
      const msg = String(err?.message || '')
      if (/forbidden|unauthorized|403|401/i.test(msg)) setPermissionDenied(true)
      else setError(msg || 'Failed to load features')
    } finally {
      setLoading(false)
    }
  }, [api, environment])

  useEffect(() => { load() }, [load])

  const domains = useMemo(() => Array.from(new Set(rows.map(r => r.domain))).sort(), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!(r.id.toLowerCase().includes(q) || (r.label ?? '').toLowerCase().includes(q) || r.route.toLowerCase().includes(q))) return false
    }
    if (filterLifecycle && r.effective.state !== filterLifecycle) return false
    if (filterDomain && r.domain !== filterDomain) return false
    if (filterOverride === 'overridden' && !r.override) return false
    if (filterOverride === 'default' && r.override) return false
    if (filterOverride === 'deprecated' && r.effective.state !== 'deprecated') return false
    if (filterOverride === 'disabled' && r.effective.state !== 'disabled') return false
    return true
  }), [rows, search, filterLifecycle, filterDomain, filterOverride])

  const openDetail = (row: AdminFeatureRow) => {
    setSelected(row); setForm(formFromRow(row)); setConflict(false)
    setAudit({ loading: true, error: false, items: [] })
    api.getAudit(row.id)
      .then(res => setAudit({ loading: false, error: false, items: res.audit || [] }))
      .catch(() => setAudit({ loading: false, error: true, items: [] }))
  }

  const buildPatch = (row: AdminFeatureRow, f: EditForm): RolloutPatch => ({
    environment,
    lifecycle_state: f.lifecycle_state || null,
    enabled: f.enabled,
    allowed_roles: f.allowed_roles.length ? f.allowed_roles : null,
    beta_message: f.beta_message || null,
    reason: f.reason || null,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    allowed_tenant_ids: f.allowed_tenant_ids.split(',').map(s => s.trim()).filter(Boolean),
    denied_tenant_ids: f.denied_tenant_ids.split(',').map(s => s.trim()).filter(Boolean),
    expectedVersion: row.override?.version,
  })

  const doSave = async () => {
    if (!selected || !form) return
    setSaving(true); setConflict(false)
    try {
      await api.updateRollout(selected.id, buildPatch(selected, form))
      toast.success(`Override saved for ${selected.id}`)
      setConfirm(null); setSelected(null); setForm(null)
      await load()
    } catch (err: any) {
      if (/version_conflict/i.test(String(err?.message))) {
        setConflict(true)
        setConfirm(null)
        toast.error('Version conflict — refresh and re-apply your change.')
      } else {
        toast.error(`Save failed: ${String(err?.message || 'error')}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const doReset = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await api.resetRollout(selected.id, environment)
      toast.success(`Override reset for ${selected.id} — reverted to static default`)
      setConfirm(null); setSelected(null); setForm(null)
      await load()
    } catch (err: any) {
      toast.error(`Reset failed: ${String(err?.message || 'error')}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="feature-governance-console" className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Governance</h1>
          <p className="text-sm text-gray-500">Inspect the Feature Registry and manage runtime rollout overrides.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="fg-env-select" className="text-xs text-gray-500">Environment</Label>
          <select
            id="fg-env-select" data-testid="fg-env-select" value={environment}
            onChange={e => setEnvironment(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          >
            {ENVIRONMENTS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={load} data-testid="fg-refresh">Refresh</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Input placeholder="Search id, label or route…" value={search} onChange={e => setSearch(e.target.value)} data-testid="fg-search" aria-label="Search features" />
        <select aria-label="Filter lifecycle" data-testid="fg-filter-lifecycle" value={filterLifecycle} onChange={e => setFilterLifecycle(e.target.value)} className="border rounded-md px-2 py-2 text-sm">
          <option value="">All lifecycles</option>
          {FEATURE_LIFECYCLE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter domain" data-testid="fg-filter-domain" value={filterDomain} onChange={e => setFilterDomain(e.target.value)} className="border rounded-md px-2 py-2 text-sm">
          <option value="">All domains</option>
          {domains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="Filter override status" data-testid="fg-filter-override" value={filterOverride} onChange={e => setFilterOverride(e.target.value)} className="border rounded-md px-2 py-2 text-sm">
          <option value="">All</option>
          <option value="overridden">Overridden</option>
          <option value="default">Default</option>
          <option value="deprecated">Deprecated</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {/* States */}
      {loading && <div data-testid="fg-loading" className="flex items-center gap-2 text-gray-500 py-10 justify-center"><Spinner className="size-5" /> Loading features…</div>}
      {permissionDenied && <div data-testid="fg-permission-denied" role="alert" className="text-red-700 bg-red-50 border border-red-100 rounded-md p-4">You do not have permission to view feature governance.</div>}
      {error && !permissionDenied && <div data-testid="fg-error" role="alert" className="text-red-700 bg-red-50 border border-red-100 rounded-md p-4">{error}</div>}
      {!loading && !error && !permissionDenied && filtered.length === 0 && <div data-testid="fg-empty" className="text-gray-500 text-center py-10">No features match your filters.</div>}

      {/* Table (desktop) / cards (mobile) */}
      {!loading && !error && !permissionDenied && filtered.length > 0 && (
        <>
          <p className="text-xs text-gray-400">{filtered.length} of {rows.length} features</p>
          <div className="hidden md:block overflow-x-auto border rounded-lg">
            <table className="w-full text-sm" data-testid="fg-table">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Feature</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Domain</th>
                  <th className="px-3 py-2">Static</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Enabled</th>
                  <th className="px-3 py-2">Override</th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} data-testid={`fg-row-${r.id}`} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2"><div className="font-medium">{r.label || r.id}</div><div className="text-xs text-gray-400">{r.id}</div></td>
                    <td className="px-3 py-2 text-gray-500">{r.route}</td>
                    <td className="px-3 py-2">{r.domain}</td>
                    <td className="px-3 py-2"><StateBadge state={r.defaultLifecycle} /></td>
                    <td className="px-3 py-2"><StateBadge state={r.effective.state} /></td>
                    <td className="px-3 py-2">{r.effective.enabled ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2">{r.override ? <Badge className="bg-purple-100 text-purple-800">overridden v{r.override.version}</Badge> : <span className="text-gray-400 text-xs">default</span>}</td>
                    <td className="px-3 py-2"><Button size="sm" variant="outline" data-testid={`fg-open-${r.id}`} onClick={() => openDetail(r)}>Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {filtered.map(r => (
              <button key={r.id} data-testid={`fg-card-${r.id}`} onClick={() => openDetail(r)} className="w-full text-left border rounded-lg p-3 hover:bg-gray-50">
                <div className="flex items-center justify-between"><span className="font-medium">{r.label || r.id}</span><StateBadge state={r.effective.state} /></div>
                <div className="text-xs text-gray-400">{r.id} · {r.route}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Detail + edit dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setForm(null); setConflict(false) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="fg-detail-dialog">
          {selected && form && (() => {
            const immutable = (getFeatureById(selected.id)?.immutableRoles ?? selected.immutableRoles ?? selected.defaultRoles) as UserRole[]
            const allRoles = getAllRoles()
            const surfaces = getNavigationPlacements(selected.id).map(n => n.surface)
            const placements = getFeatureById(selected.id)?.placements ?? []
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{selected.label || selected.id}</DialogTitle>
                  <DialogDescription>{selected.id} · {selected.route} · {selected.domain}</DialogDescription>
                </DialogHeader>

                {conflict && (
                  <div data-testid="fg-conflict" role="alert" className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
                    This override changed since you opened it (version conflict). Refresh and re-apply your change.
                    <Button size="sm" variant="outline" className="ml-2" onClick={load}>Refresh</Button>
                  </div>
                )}

                {/* Read-only summary */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-400">Static lifecycle</span><div><StateBadge state={selected.defaultLifecycle} /></div></div>
                  <div><span className="text-gray-400">Effective</span><div><StateBadge state={selected.effective.state} /> {selected.effective.enabled ? '' : '(disabled)'}</div></div>
                  <div><span className="text-gray-400">Static roles</span><div>{selected.defaultRoles.join(', ') || '—'}</div></div>
                  <div><span className="text-gray-400">Immutable role bound</span><div>{immutable.join(', ') || '—'}</div></div>
                  <div className="col-span-2"><span className="text-gray-400">Navigation surfaces</span><div className="text-xs">{[...new Set([...placements, ...surfaces])].join(', ') || 'none'}</div></div>
                  <div><span className="text-gray-400">Override version</span><div>{selected.override?.version ?? '—'}</div></div>
                  <div><span className="text-gray-400">Last updated by</span><div>{selected.override?.updated_by ?? '—'}</div></div>
                </div>

                <hr />

                {/* Mutation form */}
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="fg-edit-lifecycle">Lifecycle override</Label>
                    <select id="fg-edit-lifecycle" data-testid="fg-edit-lifecycle" value={form.lifecycle_state}
                      onChange={e => setForm({ ...form, lifecycle_state: e.target.value as FeatureLifecycleState | '' })}
                      className="w-full border rounded-md px-2 py-2 text-sm">
                      <option value="">(keep static default: {selected.defaultLifecycle})</option>
                      {FEATURE_LIFECYCLE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" data-testid="fg-edit-enabled" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
                    Enabled
                  </label>

                  <div>
                    <Label>Allowed roles (within immutable bound)</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {allRoles.map(r => {
                        const allowedByPolicy = immutable.includes(r)
                        const checked = form.allowed_roles.includes(r)
                        return (
                          <label
                            key={r}
                            title={allowedByPolicy ? undefined : 'Locked by immutable policy — an override cannot grant this role'}
                            className={`flex items-center gap-1 text-xs border rounded px-2 py-1 ${allowedByPolicy ? '' : 'opacity-50 bg-gray-50'}`}
                          >
                            <input type="checkbox" disabled={!allowedByPolicy} checked={checked} data-testid={`fg-edit-role-${r}`}
                              onChange={e => setForm({ ...form, allowed_roles: e.target.checked ? [...form.allowed_roles, r] : form.allowed_roles.filter(x => x !== r) })} />
                            {r}
                            {!allowedByPolicy && <Lock className="w-3 h-3 text-gray-400" aria-hidden="true" />}
                          </label>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Roles outside the immutable bound are disabled — an override can never broaden access.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="fg-edit-starts">Starts at</Label><Input id="fg-edit-starts" type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></div>
                    <div><Label htmlFor="fg-edit-ends">Ends at</Label><Input id="fg-edit-ends" type="datetime-local" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="fg-edit-allow-tenants">Allowed tenants (csv)</Label><Input id="fg-edit-allow-tenants" value={form.allowed_tenant_ids} onChange={e => setForm({ ...form, allowed_tenant_ids: e.target.value })} /></div>
                    <div><Label htmlFor="fg-edit-deny-tenants">Denied tenants (csv)</Label><Input id="fg-edit-deny-tenants" value={form.denied_tenant_ids} onChange={e => setForm({ ...form, denied_tenant_ids: e.target.value })} /></div>
                  </div>

                  <div><Label htmlFor="fg-edit-beta">Beta message</Label><Input id="fg-edit-beta" value={form.beta_message} onChange={e => setForm({ ...form, beta_message: e.target.value })} /></div>
                  <div><Label htmlFor="fg-edit-reason">Reason (audited)</Label><Input id="fg-edit-reason" data-testid="fg-edit-reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
                </div>

                {/* Audit */}
                <div className="text-sm">
                  <div className="text-gray-400 mb-1">Audit history</div>
                  {audit.loading && <div data-testid="fg-audit-loading" className="text-gray-400 text-xs">Loading audit…</div>}
                  {audit.error && <div data-testid="fg-audit-error" className="text-red-600 text-xs">Failed to load audit.</div>}
                  {!audit.loading && !audit.error && audit.items.length === 0 && <div className="text-gray-400 text-xs">No governance changes yet.</div>}
                  {!audit.loading && audit.items.length > 0 && (
                    <ul className="text-xs space-y-1 max-h-32 overflow-y-auto" data-testid="fg-audit-list">
                      {audit.items.slice(0, 20).map((a: any, i) => (
                        <li key={i} className="text-gray-600">{a.event_type} · {a.created_at}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setConfirm({ kind: 'reset' })} data-testid="fg-edit-reset" disabled={!selected.override}>Reset to default</Button>
                  <Button onClick={() => setConfirm({ kind: 'save' })} data-testid="fg-edit-save" disabled={saving}>Save override</Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Confirmation with before/after */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent data-testid="fg-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'reset' ? 'Reset override?' : 'Apply override change?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {selected && form && confirm?.kind === 'save' && (
                <>Environment <b>{environment}</b>. Effective lifecycle <b>{selected.effective.state}</b> → <b>{form.lifecycle_state || selected.defaultLifecycle}</b>; enabled <b>{String(selected.effective.enabled)}</b> → <b>{String(form.enabled)}</b>. This is audited.</>
              )}
              {selected && confirm?.kind === 'reset' && (
                <>This removes the {environment} override for <b>{selected.id}</b> and reverts it to the static default <b>{selected.defaultLifecycle}</b>. This is audited.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="fg-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="fg-confirm-accept" onClick={confirm?.kind === 'reset' ? doReset : doSave}>
              {confirm?.kind === 'reset' ? 'Reset' : 'Apply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
