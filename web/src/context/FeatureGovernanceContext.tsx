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
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { EffectiveFeatureState } from '@/config/featureRegistry'
import { resolveApiBaseUrl } from '@/lib/apiClient'

export type EffectiveStateMap = Record<string, EffectiveFeatureState>

const FeatureGovernanceContext = createContext<EffectiveStateMap>({})

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
  const [states, setStates] = useState<EffectiveStateMap>({})

  useEffect(() => {
    let cancelled = false
    const base = resolveApiBaseUrl(
      import.meta.env.VITE_API_URL,
      typeof window !== 'undefined' ? window.location.hostname : undefined,
    )
    fetch(`${base}/features/effective`, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then((body: { features?: EffectiveFeatureState[] } | null) => {
        if (cancelled || !body?.features) return
        const map: EffectiveStateMap = {}
        for (const f of body.features) map[f.featureId] = f
        setStates(map)
      })
      .catch(() => {
        /* keep static defaults on failure */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <FeatureGovernanceProvider value={states}>{children}</FeatureGovernanceProvider>
}

/** Effective feature states (empty until governance hydration lands). */
export function useFeatureEffectiveStates(): EffectiveStateMap {
  return useContext(FeatureGovernanceContext)
}
