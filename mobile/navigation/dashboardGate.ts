/**
 * Native Dashboard (tabs/index) cold-start gate — pure, node-safe.
 *
 * Extracted from `app/(tabs)/index.tsx` so the bootstrap ORDERING is unit-tested
 * without the React Native / expo-router runtime.
 *
 * The native auth store starts `loading:true` while `initialize()` restores a
 * saved user + token from SecureStore. On a cold launch or a direct Dashboard
 * deep link with an existing session, `user` is briefly null before the restore
 * completes — so the screen MUST wait for bootstrap before redirecting, or it
 * would eject an already-signed-in user. Ordering is strictly:
 *   1. auth bootstrap/loading  → 'loading'  (never redirect mid-restore)
 *   2. confirmed anonymous     → 'redirect' (init finished, still no role)
 *   3. role-owned boundary     → 'boundary' (governed by `${role}.overview`)
 */
import type { UserRole } from '@shared/types';
import { getFeatureById } from './featureManifest';

export type DashboardGate =
  | { kind: 'loading' }
  | { kind: 'redirect'; to: '/login' }
  | { kind: 'boundary'; role: UserRole; featureId: string; route: string };

export function resolveDashboardGate(input: {
  loading: boolean;
  role: UserRole | null;
}): DashboardGate {
  // 1. Auth bootstrap — never decide while the saved session is still restoring.
  if (input.loading) return { kind: 'loading' };
  // 2. Confirmed anonymous (init finished, no role) → login.
  if (!input.role) return { kind: 'redirect', to: '/login' };
  // 3. Role-owned governed boundary (role known → never a fabricated owner).
  const featureId = `${input.role}.overview`;
  const route = getFeatureById(featureId)?.route ?? '/dashboard';
  return { kind: 'boundary', role: input.role, featureId, route };
}
