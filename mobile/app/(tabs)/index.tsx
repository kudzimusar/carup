import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useRouter } from 'expo-router';

export default function DashboardScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const loading = useAuthStore((state) => state.loading);
  const logout = useAuthStore((state) => state.logout);
  const switchRole = useAuthStore((state) => state.switchRole);
  const [roleSwitchWarning, setRoleSwitchWarning] = useState<string | null>(null);

  const goToLogin = () => router.replace('/(auth)/login');

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  // Role switching is optional convenience. A failure shows a non-blocking
  // warning and NEVER disables Start Verification Flow (which depends only on
  // being authenticated).
  const handleRoleSwitch = async (role: 'owner' | 'dealer' | 'mechanic') => {
    setRoleSwitchWarning(null);
    const result = await switchRole(role);
    if (!result.ok) {
      setRoleSwitchWarning(result.error || 'Role switch is unavailable right now. You can still continue.');
    }
  };

  // While the secure store hydrates we must NOT flash a signed-in-looking
  // header before auth state is known.
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F97316" />
      </View>
    );
  }

  // ---- Signed-out state: never imply an authenticated session -------------
  if (!isAuthenticated) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center' }}
        style={{ backgroundColor: '#F8FAFC' }}
      >
        <View style={{ backgroundColor: '#0F172A', padding: 24, borderRadius: 16, marginBottom: 24 }}>
          <Text style={{ color: '#F97316', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>CarUp</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginTop: 6 }} testID="dashboard-signed-out-title">You're signed out</Text>
          <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 6 }}>Sign in to access your dashboard and identity verification.</Text>
        </View>

        <Pressable
          onPress={goToLogin}
          testID="sign-in-to-carup"
          style={({ pressed }) => ({
            width: '100%', backgroundColor: '#0F172A', borderRadius: 12,
            paddingVertical: 18, justifyContent: 'center', alignItems: 'center',
            marginBottom: 16, opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Sign In to CarUp</Text>
        </Pressable>

        <Pressable
          onPress={goToLogin}
          testID="verification-requires-login"
          style={({ pressed }) => ({
            width: '100%', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA',
            borderRadius: 12, paddingVertical: 18, justifyContent: 'center', alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: '#EA580C', fontSize: 15, fontWeight: '600' }}>Sign in to start verification</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ---- Authenticated state ------------------------------------------------
  return (
    <ScrollView contentContainerStyle={{ padding: 24 }} style={{ backgroundColor: '#F8FAFC' }}>
      {/* Welcome Block */}
      <View style={{ backgroundColor: '#0F172A', padding: 24, borderRadius: 16, marginBottom: 24 }}>
        <Text style={{ color: '#F97316', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>Welcome Back</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginTop: 4 }}>{user?.name || 'CarUp Stakeholder'}</Text>
        {user?.email ? <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>{user.email}</Text> : null}
        {user?.role ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(249,115,22,0.2)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 16 }}>
            <Text style={{ color: '#F97316', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>Active Role: {user.role}</Text>
          </View>
        ) : null}
      </View>

      {/* Multi-Tenant Stakeholder Switcher */}
      <View style={{ backgroundColor: '#FFFFFF', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 24 }}>
        <Text style={{ color: '#0F172A', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Stakeholder Portal Switching</Text>
        <Text style={{ color: '#64748B', fontSize: 12, marginBottom: 16 }}>Shift your authorization context across multi-tenant ledger systems.</Text>
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
                style={({ pressed }) => ({
                  padding: 16, borderRadius: 12, borderWidth: 1, marginTop: idx === 0 ? 0 : 12,
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

      {/* Non-blocking notice if an optional role switch failed. Does NOT gate
          verification — Start Verification Flow stays enabled while signed in. */}
      {roleSwitchWarning && (
        <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '600', marginBottom: 2 }}>Role switch unavailable</Text>
          <Text style={{ color: '#B45309', fontSize: 11 }} testID="role-switch-warning">{roleSwitchWarning}</Text>
        </View>
      )}

      {/* Identity verification entry point — enabled because the user is
          authenticated (independent of any role-switch outcome). */}
      <Pressable
        onPress={() => router.push('/(auth)/verification/intro')}
        testID="start-verification-flow"
        style={({ pressed }) => ({
          width: '100%', backgroundColor: '#F97316', borderRadius: 12,
          paddingVertical: 18, justifyContent: 'center', alignItems: 'center',
          marginBottom: 16, opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Start Verification Flow</Text>
      </Pressable>

      {/* Account actions */}
      <Pressable
        onPress={handleLogout}
        testID="sign-out-session"
        style={({ pressed }) => ({
          width: '100%', backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
          borderRadius: 12, paddingVertical: 18, justifyContent: 'center', alignItems: 'center',
          marginBottom: 40, opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: '#DC2626', fontSize: 16, fontWeight: '600' }}>Sign Out Session</Text>
      </Pressable>
    </ScrollView>
  );
}
