/**
 * Shared feature-governance context object + consumer hook.
 *
 * These live in a NON-component module (separate from the `.tsx` provider file)
 * so React Fast Refresh keeps working: a file that exports React components must
 * not also export the context/hook. The providers in
 * `FeatureGovernanceContext.tsx` import the context from here; navigation
 * selectors and route boundaries import `useFeatureEffectiveStates`.
 */
import { createContext, useContext } from 'react'
import type { EffectiveFeatureState } from '@/config/featureRegistry'

export type EffectiveStateMap = Record<string, EffectiveFeatureState>

export const FeatureGovernanceContext = createContext<EffectiveStateMap>({})

/** Effective feature states (empty until governance hydration lands). */
export function useFeatureEffectiveStates(): EffectiveStateMap {
  return useContext(FeatureGovernanceContext)
}
