/**
 * Feature governance context — supplies backend-derived effective feature
 * states to navigation selectors and route boundaries.
 *
 * In Milestone 5 this defaults to an empty map (static lifecycle governs). In
 * Milestone 6/7 the provider hydrates from `GET /api/features/effective`
 * WITHOUT blocking the first paint: static defaults render immediately and
 * runtime overrides apply on hydration. Storage failure leaves the static
 * defaults intact (a disabled feature never becomes enabled because a fetch
 * failed).
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { EffectiveFeatureState } from '@/config/featureRegistry'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { useAuth } from '@/context/AuthContext'
import { FeatureGovernanceContext, type EffectiveStateMap } from './featureGovernanceStore'

const NAV_COHORT_KEY = 'carup_nav_cohort'

/**
 * Return a STABLE, opaque anonymous cohort id (generated once, persisted in
 * localStorage). It is NOT authentication and carries no PII — it exists ONLY so
 * the backend can deterministically bucket an anonymous visitor into a
 * percentage rollout (so the same browser stays consistently in or out). An
 * authenticated identity always takes priority server-side. Returns '' when no
 * storage/crypto is available (SSR / privacy mode) → that visitor is simply
 * treated as having no cohort (conservative: out of partial rollouts).
 */
function getNavCohortId(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return ''
    const existing = window.localStorage.getItem(NAV_COHORT_KEY)
    if (existing) return existing
    const bytes = new Uint8Array(16)
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes)
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    }
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    window.localStorage.setItem(NAV_COHORT_KEY, id)
    return id
  } catch {
    return ''
  }
}

export function FeatureGovernanceProvider({
  value = {},
  children,
}: {
  value?: EffectiveStateMap
  children: ReactNode
}) {
  return (
    <FeatureGovernanceContext.Provider value={value}>
      {children}
    </FeatureGovernanceContext.Provider>
  )
}

/**
 * Production provider: hydrates effective states from the governance API
 * WITHOUT blocking the first paint. Static defaults render immediately; runtime
 * overrides apply once the (non-blocking) fetch resolves. A failed fetch leaves
 * the static defaults intact — a disabled feature never becomes enabled because
 * the request failed.
 */
export function FeatureGovernanceLoader({ children }: { children: ReactNode }) {
  const { user, token } = useAuth()
  // Effective states are keyed to the auth identity they were fetched for. While
  // a fetch for a new identity is in flight we expose an EMPTY map (static
  // defaults), so a just-logged-in user is never wrongly gated by stale
  // anonymous state — and tenant/role-specific results only apply to the
  // matching session.
  const authKey = `${user?.id ?? 'anon'}|${token ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; map: EffectiveStateMap }>({ key: '', map: {} })

  useEffect(() => {
    let cancelled = false
    const base = resolveApiBaseUrl(
      import.meta.env.VITE_API_URL,
      typeof window !== 'undefined' ? window.location.hostname : undefined,
    )
    // Send the trusted session so the backend derives role/tenant server-side.
    // (Client role headers are ignored by the backend.)
    const headers: Record<string, string> = {}
    if (token) headers['x-session-token'] = token
    if (user?.id) headers['x-user-id'] = user.id
    if (user?.active_tenant_id) headers['x-tenant-id'] = user.active_tenant_id
    // Opaque, non-PII anonymous cohort id — buckets anonymous visitors into a
    // deterministic percentage rollout. Authenticated identity still wins.
    const cohortId = getNavCohortId()
    if (cohortId) headers['x-nav-cohort'] = cohortId
    fetch(`${base}/features/effective`, { headers, credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then((body: { features?: EffectiveFeatureState[] } | null) => {
        if (cancelled || !body?.features) return
        const map: EffectiveStateMap = {}
        for (const f of body.features) map[f.featureId] = f
        setLoaded({ key: authKey, map })
      })
      .catch(() => {
        /* keep static defaults on failure */
      })
    return () => {
      cancelled = true
    }
  }, [authKey, user?.id, user?.active_tenant_id, token])

  // Only expose states that belong to the current identity.
  const value = loaded.key === authKey ? loaded.map : {}
  return <FeatureGovernanceProvider value={value}>{children}</FeatureGovernanceProvider>
}
