import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { Redirect, useRouter } from 'expo-router';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { getFeatureById } from '../../navigation/featureManifest';

function DashboardScreenInner() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const switchRole = useAuthStore((state) => state.switchRole);

  const handleLogout = async () => {
    if (isAuthenticated) {
      await logout();
    }
    router.replace('/(auth)/login');
  };

  const handleRoleSwitch = async (role: 'owner' | 'dealer' | 'mechanic') => {
    await switchRole(role);
  };

  return (
    <ScrollView className="flex-1 bg-slate-50 px-6 py-6">
      {/* Welcome Block */}
      <View className="bg-slate-900 p-6 rounded-2xl shadow-lg mb-6">
        <Text className="text-white text-xs font-semibold uppercase tracking-wider text-orange-500">Welcome Back</Text>
        <Text className="text-white text-2xl font-bold mt-1">{user?.name || 'CarUp Stakeholder'}</Text>
        <Text className="text-slate-400 text-sm mt-1">{user?.email}</Text>
        
        {/* Role Tag */}
        <View className="bg-orange-500/20 border border-orange-500/30 rounded-full px-3 py-1 self-start mt-4">
          <Text className="text-orange-500 text-xs font-semibold uppercase tracking-wider">Active Role: {user?.role}</Text>
        </View>
      </View>

      {/* Multi-Tenant Stakeholder Switcher */}
      <View className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-6">
        <Text className="text-slate-900 text-base font-bold mb-2">Stakeholder Portal Switching</Text>
        <Text className="text-slate-500 text-xs mb-4">
          Instantly shift your authorization context across multi-tenant ledger systems.
        </Text>

        <View>
          {([
            { role: 'owner' as const, title: 'Vehicle Owner Portal', subtitle: 'Manage private garages, service logs, and listings.' },
            { role: 'dealer' as const, title: 'Dealership Portal', subtitle: 'Review showroom inventories, active sales, and buyer leads.' },
            { role: 'mechanic' as const, title: 'Certified Mechanic Portal', subtitle: 'Mint immutable Partsentry logs and authorize inspection hashes.' },
          ]).map((portal, idx) => {
            const active = user?.role === portal.role;
            return (
              <Pressable
                key={portal.role}
                onPress={() => handleRoleSwitch(portal.role)}
                testID={`switch-role-${portal.role}`}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${portal.title}`}
                accessibilityHint={portal.subtitle}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  // Min 44px touch target for accessibility.
                  minHeight: 44,
                  marginTop: idx === 0 ? 0 : 12,
                  backgroundColor: active ? '#FFF7ED' : '#F8FAFC',
                  borderColor: active ? '#F97316' : '#E2E8F0',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontWeight: '600', fontSize: 15, color: active ? '#EA580C' : '#1E293B' }}>{portal.title}</Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>{portal.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Identity verification entry point */}
      <Pressable
        onPress={() => router.push('/(auth)/verification/intro')}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Start verification flow"
        style={({ pressed }) => ({
          width: '100%',
          backgroundColor: '#F97316',
          borderRadius: 12,
          paddingVertical: 18,
          paddingHorizontal: 16,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 16,
          opacity: pressed ? 0.8 : 1,
        })}
        testID="start-verification-flow"
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
          Start Verification Flow
        </Text>
      </Pressable>

      {/* Account actions */}
      <Pressable
        onPress={handleLogout}
        accessible
        accessibilityRole="button"
        accessibilityLabel={isAuthenticated ? 'Sign out session' : 'Sign in to CarUp'}
        style={({ pressed }) => ({
          width: '100%',
          backgroundColor: '#FEF2F2',
          borderWidth: 1,
          borderColor: '#FECACA',
          borderRadius: 12,
          paddingVertical: 18,
          paddingHorizontal: 16,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 40,
          opacity: pressed ? 0.8 : 1,
        })}
        testID="sign-out-session"
      >
        <Text style={{ color: '#DC2626', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
          {isAuthenticated ? 'Sign Out Session' : 'Sign In to CarUp'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Governed route boundary (Milestone C). The dashboard tab is role-resolved: it
 * is owned by the active role's `${role}.overview` feature (owner.overview,
 * dealer.overview, …), so a direct / deep-link / initial navigation is gated by
 * the SAME governed decision per role. The route is resolved from the manifest
 * (never fabricated), defaulting to `/dashboard`.
 *
 * Anonymous (no role): every `*.overview` feature is `requiresAuth`, so there is
 * no role-owned feature to gate against. We short-circuit to the sign-in route
 * so an unauthenticated deep link to the dashboard redirects to auth instead of
 * rendering. (Once signed in, role resolves and the overview boundary governs.)
 */
export default function DashboardScreen() {
  const role = useAuthStore((s) => s.user?.role ?? null);

  if (!role) {
    return <Redirect href="/login" />;
  }

  const featureId = `${role}.overview`;
  const route = getFeatureById(featureId)?.route ?? '/dashboard';

  return (
    <NativeFeatureBoundary route={route} featureId={featureId} hasNativeScreen>
      <DashboardScreenInner />
    </NativeFeatureBoundary>
  );
}
