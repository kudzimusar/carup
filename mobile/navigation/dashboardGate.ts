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
 *   2. confirmed anonymous     → 'redirect' to the PUBLIC Marketplace (init finished, still no role).
 *      PC01-J-R1: this sent every guest to Login, so a guest could not browse at all — not the
 *      Marketplace, not a vehicle, not its trust position. Browsing never needs an account; the
 *      app asks for one at the point of messaging, saving or selling.
 *   3. role-owned boundary     → 'boundary' (governed by `${role}.overview`)
 */
import type { UserRole } from '@shared/types';
import { getFeatureById } from './featureManifest';

export type DashboardGate =
  | { kind: 'loading' }
  | { kind: 'redirect'; to: '/marketplace' }
  | { kind: 'boundary'; role: UserRole; featureId: string; route: string };

export function resolveDashboardGate(input: {
  loading: boolean;
  role: UserRole | null;
}): DashboardGate {
  // 1. Auth bootstrap — never decide while the saved session is still restoring.
  if (input.loading) return { kind: 'loading' };
  // 2. Confirmed anonymous (init finished, no role) → the public Marketplace.
  if (!input.role) return { kind: 'redirect', to: '/marketplace' };
  // 3. Role-owned governed boundary (role known → never a fabricated owner).
  const featureId = `${input.role}.overview`;
  const route = getFeatureById(featureId)?.route ?? '/dashboard';
  return { kind: 'boundary', role: input.role, featureId, route };
}
