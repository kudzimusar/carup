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
import NavigationAnalyticsPanel from '@/components/admin/NavigationAnalyticsPanel'
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

/**
 * Tri-state role override:
 *   'default' → no role override (null) — inherit the feature's static roles;
 *   'none'    → explicit deny-all ([]) — the feature is allowed to NO role;
 *   'custom'  → an explicit role subset (['owner', …]).
 * `[]` and `null` are DISTINCT values that must round-trip unchanged.
 */
export type RolesMode = 'default' | 'none' | 'custom'

export function rolesModeOf(allowed: string[] | null | undefined): RolesMode {
  if (allowed == null) return 'default'
  return allowed.length === 0 ? 'none' : 'custom'
}

/** The wire value for a tri-state role selection (null | [] | [...]). */
export function allowedRolesValue(form: Pick<EditForm, 'rolesMode' | 'allowed_roles'>): string[] | null {
  if (form.rolesMode === 'default') return null
  if (form.rolesMode === 'none') return []
  return form.allowed_roles
}

/** Human label distinguishing Default roles vs No roles vs a subset (confirmation UI). */
export function roleSummary(allowed: string[] | null | undefined, staticRoles: string[]): string {
  if (allowed == null) return `Default roles (${staticRoles.join(', ') || '—'})`
  if (allowed.length === 0) return 'No roles (deny all)'
  return allowed.join(', ')
}

interface EditForm {
  lifecycle_state: FeatureLifecycleState | ''
  enabled: boolean
  /** Tri-state selector; the wire value is derived via allowedRolesValue(). */
  rolesMode: RolesMode
  /** The role subset for 'custom' mode (ignored when mode is default/none). */
  allowed_roles: string[]
  beta_message: string
  reason: string
  starts_at: string
  ends_at: string
  allowed_tenant_ids: string
  denied_tenant_ids: string
  /** 0–100 as a string (number input). Empty → treated as 100. */
  rollout_percentage: string
  rollout_seed: string
}

export function formFromRow(row: AdminFeatureRow): EditForm {
  const o = row.override
  const allowed = o?.allowed_roles ?? null // preserve null vs [] vs [...]
  return {
    lifecycle_state: (o?.lifecycle_state ?? '') as FeatureLifecycleState | '',
    enabled: o?.enabled ?? true,
    rolesMode: rolesModeOf(allowed),
    allowed_roles: allowed ?? [],
    beta_message: o?.beta_message ?? '',
    reason: o?.reason ?? '',
    starts_at: o?.starts_at ? o.starts_at.slice(0, 16) : '',
    ends_at: o?.ends_at ? o.ends_at.slice(0, 16) : '',
    allowed_tenant_ids: (o?.allowed_tenant_ids ?? []).join(', '),
    denied_tenant_ids: (o?.denied_tenant_ids ?? []).join(', '),
    rollout_percentage: String(o?.rollout_percentage ?? 100),
    rollout_seed: o?.rollout_seed ?? '',
  }
}

/** Clamp a percentage form string to an int 0–100 (default 100 when empty/invalid). */
export function buildRolloutPatch(environment: string, row: AdminFeatureRow, f: EditForm): RolloutPatch {
  return {
    environment,
    lifecycle_state: f.lifecycle_state || null,
    enabled: f.enabled,
    // Tri-state: 'default' → null (inherit static); 'none' → [] (deny all);
    // 'custom' → the subset. null and [] are sent distinctly.
    allowed_roles: allowedRolesValue(f),
    beta_message: f.beta_message || null,
    reason: f.reason || null,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    allowed_tenant_ids: f.allowed_tenant_ids.split(',').map(s => s.trim()).filter(Boolean),
    denied_tenant_ids: f.denied_tenant_ids.split(',').map(s => s.trim()).filter(Boolean),
    rollout_percentage: parsePercentage(f.rollout_percentage),
    rollout_seed: f.rollout_seed.trim() ? f.rollout_seed.trim().slice(0, 64) : null,
    expectedVersion: row.override?.version,
  }
}

function parsePercentage(raw: string): number {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return 100
  return Math.max(0, Math.min(100, n))
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
  const [tab, setTab] = useState<'governance' | 'analytics'>('governance')

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

  const buildPatch = (row: AdminFeatureRow, f: EditForm): RolloutPatch =>
    buildRolloutPatch(environment, row, f)

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

      {/* Section tabs */}
      <div className="flex gap-1 border-b" role="tablist" aria-label="Feature governance sections" data-testid="fg-tabs">
        <button
          role="tab" type="button" data-testid="fg-tab-governance"
          aria-selected={tab === 'governance'}
          onClick={() => setTab('governance')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'governance' ? 'border-orange-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >Rollout governance</button>
        <button
          role="tab" type="button" data-testid="fg-tab-analytics"
          aria-selected={tab === 'analytics'}
          onClick={() => setTab('analytics')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'analytics' ? 'border-orange-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >Navigation analytics</button>
      </div>

      {tab === 'analytics' && (
        <div role="tabpanel" aria-label="Navigation analytics" data-testid="fg-analytics-panel">
          <NavigationAnalyticsPanel />
        </div>
      )}

      {tab === 'governance' && (
      <>
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
          <p className="text-xs text-gray-500">Showing <span className="font-medium text-gray-700">{filtered.length}</span> of {rows.length} features</p>
          <div className="hidden md:block overflow-x-auto border rounded-lg">
            <table className="w-full text-sm" data-testid="fg-table">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Feature</th><th className="px-3 py-2.5 font-semibold">Route</th><th className="px-3 py-2.5 font-semibold">Domain</th>
                  <th className="px-3 py-2.5 font-semibold">Static</th><th className="px-3 py-2.5 font-semibold">Effective</th><th className="px-3 py-2.5 font-semibold">Enabled</th>
                  <th className="px-3 py-2.5 font-semibold">Override</th><th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} data-testid={`fg-row-${r.id}`} className="border-t hover:bg-orange-50/40 transition-colors">
                    <td className="px-3 py-2.5"><div className="font-medium text-gray-900">{r.label || r.id}</div><div className="text-xs text-gray-400 font-mono">{r.id}</div></td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.route}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.domain}</td>
                    <td className="px-3 py-2.5"><StateBadge state={r.defaultLifecycle} /></td>
                    <td className="px-3 py-2.5"><StateBadge state={r.effective.state} /></td>
                    <td className="px-3 py-2.5">{r.effective.enabled ? <span className="text-green-700">Yes</span> : <span className="text-gray-400">No</span>}</td>
                    <td className="px-3 py-2.5">{r.override ? <div className="flex flex-col items-start gap-0.5"><Badge className="bg-purple-100 text-purple-800 font-medium">overridden v{r.override.version}</Badge>{r.override.rollout_percentage < 100 && <span data-testid={`fg-pct-${r.id}`} className="text-[11px] font-medium text-amber-700">{r.override.rollout_percentage}% rollout</span>}</div> : <span className="text-gray-400 text-xs">default</span>}</td>
                    <td className="px-3 py-2.5 text-right"><Button size="sm" variant="outline" data-testid={`fg-open-${r.id}`} onClick={() => openDetail(r)}>Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {filtered.map(r => (
              <button key={r.id} data-testid={`fg-card-${r.id}`} onClick={() => openDetail(r)} className="w-full text-left border rounded-lg p-3 hover:bg-orange-50/40 transition-colors">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-gray-900 truncate">{r.label || r.id}</span><StateBadge state={r.effective.state} /></div>
                <div className="text-xs text-gray-400 font-mono mt-0.5 truncate">{r.id} · {r.route}</div>
                {r.override && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge className="bg-purple-100 text-purple-800 text-[10px]">overridden v{r.override.version}</Badge>
                    {r.override.rollout_percentage < 100 && <span className="text-[11px] font-medium text-amber-700">{r.override.rollout_percentage}% rollout</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
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
                    <Label htmlFor="fg-edit-roles-mode">Allowed roles (within immutable bound)</Label>
                    {/* Tri-state: Default (null, inherit static) · No roles ([], deny all) · Specific (subset). */}
                    <select
                      id="fg-edit-roles-mode" data-testid="fg-edit-roles-mode"
                      className="mt-1 block w-full border rounded px-2 py-1 text-sm"
                      value={form.rolesMode}
                      onChange={e => {
                        const mode = e.target.value as RolesMode
                        setForm({
                          ...form,
                          rolesMode: mode,
                          // Entering 'custom' from default/none seeds with the
                          // existing subset (empty), so the checkboxes are usable;
                          // default/none ignore allowed_roles via allowedRolesValue.
                          allowed_roles: mode === 'custom' ? form.allowed_roles : form.allowed_roles,
                        })
                      }}
                    >
                      <option value="default">Default roles (inherit static: {selected.defaultRoles.join(', ') || '—'})</option>
                      <option value="none">No roles (deny all)</option>
                      <option value="custom">Specific roles…</option>
                    </select>
                    {form.rolesMode === 'custom' && (
                      <div className="flex flex-wrap gap-2 mt-2" data-testid="fg-edit-roles-custom">
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
                    )}
                    <p className="text-[11px] text-gray-400 mt-1">
                      <b>Default</b> inherits the feature's static roles; <b>No roles</b> denies all (an explicit empty override); <b>Specific</b> restricts to a subset. Roles outside the immutable bound stay disabled — an override can never broaden access.
                    </p>
                  </div>

                  {/* Percentage rollout — deterministic, never broadens role/tenant */}
                  {(() => {
                    const pct = parsePercentage(form.rollout_percentage)
                    const originalSeed = selected.override?.rollout_seed ?? ''
                    const seedChanged = form.rollout_seed.trim() !== originalSeed
                    return (
                      <div className="rounded-md border border-gray-200 p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2 items-end">
                          <div>
                            <Label htmlFor="fg-edit-percentage">Rollout percentage (0–100)</Label>
                            <Input
                              id="fg-edit-percentage" data-testid="fg-edit-percentage"
                              type="number" min={0} max={100} step={1}
                              value={form.rollout_percentage}
                              onChange={e => setForm({ ...form, rollout_percentage: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="fg-edit-percentage-slider">Adjust</Label>
                            <input
                              id="fg-edit-percentage-slider" data-testid="fg-edit-percentage-slider"
                              type="range" min={0} max={100} step={1} value={pct}
                              onChange={e => setForm({ ...form, rollout_percentage: e.target.value })}
                              className="w-full" aria-label="Rollout percentage slider"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="fg-edit-seed">Rotation seed (optional, ≤64 chars)</Label>
                          <Input
                            id="fg-edit-seed" data-testid="fg-edit-seed" maxLength={64}
                            value={form.rollout_seed}
                            onChange={e => setForm({ ...form, rollout_seed: e.target.value })}
                            placeholder="Rotating this reshuffles which subjects are in the rollout"
                          />
                        </div>
                        <p className="text-[11px] text-gray-500">
                          Exposure is deterministic: each subject (logged-in user, or an opaque
                          anonymous cohort id) is hashed into a stable 0–99 bucket. A subject is in
                          the rollout when its bucket is below the percentage — so the same subject
                          stays consistently in or out. The percentage only NARROWS exposure; it
                          never grants a role or tenant that policy denies. Anonymous callers without
                          a cohort id are treated as NOT in a partial rollout (the feature stays
                          gated for them).
                        </p>
                        {pct === 0 && (
                          <p data-testid="fg-warn-zero" role="alert" className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                            0% — the feature is fully gated for every subject (no one is in the rollout). Use a lifecycle/disabled override if you intend a hard kill-switch.
                          </p>
                        )}
                        {pct > 0 && pct < 100 && (
                          <p data-testid="fg-warn-partial" className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                            Partial rollout — only ~{pct}% of deterministically-bucketed subjects will see this feature.
                          </p>
                        )}
                        {seedChanged && (
                          <p data-testid="fg-warn-seed" role="alert" className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            Changing the rotation seed RESHUFFLES cohorts — subjects currently in the rollout may move out and vice-versa.
                          </p>
                        )}
                        {environment === 'production' && pct < 100 && (
                          <p data-testid="fg-warn-prod" role="alert" className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">
                            Production environment — a partial percentage gates real users. Double-check before applying.
                          </p>
                        )}
                      </div>
                    )
                  })()}

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
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {selected && form && confirm?.kind === 'save' && (
                  <>
                    <p>Applying to environment <b className="text-gray-900">{environment}</b>:</p>
                    <ul className="space-y-1 text-sm rounded-md bg-gray-50 border border-gray-100 p-2.5">
                      <li className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Lifecycle</span>
                        <span><b>{selected.effective.state}</b> <span className="text-gray-400">→</span> <b className="text-gray-900">{form.lifecycle_state || selected.defaultLifecycle}</b></span>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Enabled</span>
                        <span><b>{String(selected.effective.enabled)}</b> <span className="text-gray-400">→</span> <b className="text-gray-900">{String(form.enabled)}</b></span>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Rollout</span>
                        <span><b>{selected.override?.rollout_percentage ?? 100}%</b> <span className="text-gray-400">→</span> <b className="text-gray-900">{parsePercentage(form.rollout_percentage)}%</b></span>
                      </li>
                      <li className="flex items-center justify-between gap-2" data-testid="fg-confirm-roles">
                        <span className="text-gray-500">Roles</span>
                        <span><b>{roleSummary(selected.override?.allowed_roles, selected.defaultRoles)}</b> <span className="text-gray-400">→</span> <b className="text-gray-900">{roleSummary(allowedRolesValue(form), selected.defaultRoles)}</b></span>
                      </li>
                    </ul>
                    {form.rollout_seed.trim() !== (selected.override?.rollout_seed ?? '') && (
                      <p className="text-amber-700">Seed rotated — cohorts will reshuffle.</p>
                    )}
                    <p className="text-xs text-gray-400">This change is audited.</p>
                  </>
                )}
                {selected && confirm?.kind === 'reset' && (
                  <>
                    <p>This removes the <b className="text-gray-900">{environment}</b> override for <b className="text-gray-900">{selected.id}</b> and reverts it to the static default <b className="text-gray-900">{selected.defaultLifecycle}</b>.</p>
                    <p className="text-xs text-gray-400">This change is audited.</p>
                  </>
                )}
              </div>
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
