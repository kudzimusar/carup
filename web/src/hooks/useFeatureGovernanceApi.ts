/**
 * Admin client for the Feature Governance API (Milestone 7).
 *
 * Reuses the shared apiRequest (auth headers + CSRF). Server authority is what
 * actually enforces admin access — this hook only attaches the caller's
 * server-issued session; it cannot grant privileges.
 */
import { useCallback, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import type { FeatureLifecycleState } from '@/config/featureRegistry'

const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

export interface FeatureOverrideRow {
  id: string
  feature_id: string
  environment: string
  lifecycle_state: FeatureLifecycleState | null
  enabled: boolean
  allowed_roles: string[] | null
  allowed_tenant_ids: string[]
  denied_tenant_ids: string[]
  starts_at: string | null
  ends_at: string | null
  beta_message: string | null
  reason: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface AdminFeatureRow {
  id: string
  label?: string
  route: string
  domain: string
  defaultLifecycle: FeatureLifecycleState
  defaultRoles: string[]
  immutableRoles: string[]
  requiresAuth: boolean
  deprecatedTo?: string
  override: FeatureOverrideRow | null
  effective: {
    featureId: string
    state: FeatureLifecycleState
    enabled: boolean
    visible: boolean
    accessible: boolean
    beta: boolean
    deprecatedTo?: string
    betaMessage?: string
    overridden?: boolean
    allowedRoles?: string[]
  }
}

export interface RolloutPatch {
  environment: string
  lifecycle_state?: FeatureLifecycleState | null
  enabled?: boolean
  allowed_roles?: string[] | null
  allowed_tenant_ids?: string[]
  denied_tenant_ids?: string[]
  starts_at?: string | null
  ends_at?: string | null
  beta_message?: string | null
  reason?: string | null
  expectedVersion?: number
}

export class GovernanceApiError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.code = message
    this.name = 'GovernanceApiError'
  }
}

export function useFeatureGovernanceApi() {
  const { user, token } = useAuth()

  const authHeaders = useMemo<AuthHeaders>(() => {
    const h: AuthHeaders = {}
    if (token) h['x-session-token'] = token
    if (user?.id) h['x-user-id'] = user.id
    if (user?.role) h['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) h['x-tenant-id'] = user.active_tenant_id
    return h
  }, [user, token])

  const call = useCallback(
    async <T = unknown>(path: string, options?: RequestInit): Promise<T> => {
      try {
        return await apiRequest<T>({ baseUrl: BASE_URL, path, options, authHeaders })
      } catch (err) {
        throw new GovernanceApiError(err instanceof Error ? err.message : 'request_failed')
      }
    },
    [authHeaders],
  )

  const listFeatures = useCallback(
    (environment: string) =>
      call<{ environment: string; features: AdminFeatureRow[] }>(`/admin/features?environment=${encodeURIComponent(environment)}`),
    [call],
  )

  const getFeature = useCallback(
    (id: string, environment: string) =>
      call<AdminFeatureRow>(`/admin/features/${encodeURIComponent(id)}?environment=${encodeURIComponent(environment)}`),
    [call],
  )

  const getAudit = useCallback(
    (id: string) => call<{ featureId: string; audit: unknown[] }>(`/admin/features/${encodeURIComponent(id)}/audit`),
    [call],
  )

  const updateRollout = useCallback(
    (id: string, patch: RolloutPatch) =>
      call<{ ok: boolean; override: FeatureOverrideRow }>(`/admin/features/${encodeURIComponent(id)}/rollout`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    [call],
  )

  const resetRollout = useCallback(
    (id: string, environment: string) =>
      call<{ ok: boolean; reset: boolean; alreadyDefault: boolean }>(`/admin/features/${encodeURIComponent(id)}/rollout`, {
        method: 'DELETE',
        body: JSON.stringify({ environment }),
      }),
    [call],
  )

  // Stable object reference so consumers' effects don't re-run every render.
  return useMemo(
    () => ({ listFeatures, getFeature, getAudit, updateRollout, resetRollout }),
    [listFeatures, getFeature, getAudit, updateRollout, resetRollout],
  )
}
