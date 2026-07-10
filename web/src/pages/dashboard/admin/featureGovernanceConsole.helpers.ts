/**
 * Pure, non-component helpers for the Feature Governance Console.
 *
 * These live in a separate module (not the `.tsx`) so React Fast Refresh keeps
 * working — a file that exports a component must not also export shared
 * constants/functions. The console component and its unit tests both import
 * from here.
 */
import type { FeatureLifecycleState } from '@/config/featureRegistry'
import type { AdminFeatureRow, RolloutPatch } from '@/hooks/useFeatureGovernanceApi'

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

export interface EditForm {
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

/** Discriminated result of parsing a rollout-percentage form string. */
export type ParsedPercentage =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Pure parser for the rollout-percentage input.
 *
 * Semantics (blank must NEVER silently become 0% / fully-gated):
 *   - blank or whitespace-only → { ok:true, value:100 } (default to full rollout);
 *   - an integer string '0'..'100' → { ok:true, value:n } (explicit '0' is a valid 0%);
 *   - non-numeric / NaN / negative / > 100 / non-integer (decimal) → { ok:false, error }.
 *
 * NOTE: this deliberately does NOT use Number('') (=== 0) — an empty string is a
 * distinct "no value entered" signal, not zero.
 */
export function parseRolloutPercentage(raw: string): ParsedPercentage {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: 100 }
  // Only a bare run of digits is a valid integer percentage. This rejects
  // decimals ('12.5'), signs ('-1', '+5'), exponents ('1e2') and stray text.
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a whole number between 0 and 100.' }
  }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return { ok: false, error: 'Enter a whole number between 0 and 100.' }
  }
  return { ok: true, value }
}

/**
 * Build the rollout patch from the form. The percentage is taken from the
 * already-validated parse result (the caller MUST gate the confirm dialog on a
 * successful parse); when the raw value is unparseable we fall back to the
 * safe full-rollout default rather than silently storing 0%.
 */
export function buildRolloutPatch(environment: string, row: AdminFeatureRow, f: EditForm): RolloutPatch {
  const parsed = parseRolloutPercentage(f.rollout_percentage)
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
    rollout_percentage: parsed.ok ? parsed.value : 100,
    rollout_seed: f.rollout_seed.trim() ? f.rollout_seed.trim().slice(0, 64) : null,
    expectedVersion: row.override?.version,
  }
}
