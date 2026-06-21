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
import { createContext, useContext, type ReactNode } from 'react'
import type { EffectiveFeatureState } from '@/config/featureRegistry'

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

/** Effective feature states (empty until governance hydration lands). */
export function useFeatureEffectiveStates(): EffectiveStateMap {
  return useContext(FeatureGovernanceContext)
}
