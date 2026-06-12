import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useRouter } from 'expo-router';

export default function DashboardScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const switchRole = useAuthStore((state) => state.switchRole);

  const handleLogout = async () => {
    await logout();
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

        <View className="space-y-3">
          <Pressable 
            onPress={() => handleRoleSwitch('owner')}
            className={`p-4 rounded-xl border ${user?.role === 'owner' ? 'bg-orange-50 border-orange-500' : 'bg-slate-50 border-slate-200'}`}
          >
            <Text className={`font-semibold ${user?.role === 'owner' ? 'text-orange-600' : 'text-slate-800'}`}>Vehicle Owner Portal</Text>
            <Text className="text-slate-400 text-xxs mt-1">Manage private garages, service logs, and listings.</Text>
          </Pressable>

          <Pressable 
            onPress={() => handleRoleSwitch('dealer')}
            className={`p-4 rounded-xl border mt-3 ${user?.role === 'dealer' ? 'bg-orange-50 border-orange-500' : 'bg-slate-50 border-slate-200'}`}
          >
            <Text className={`font-semibold ${user?.role === 'dealer' ? 'text-orange-600' : 'text-slate-800'}`}>Dealership Portal</Text>
            <Text className="text-slate-400 text-xxs mt-1">Review showroom inventories, active sales, and buyer leads.</Text>
          </Pressable>

          <Pressable 
            onPress={() => handleRoleSwitch('mechanic')}
            className={`p-4 rounded-xl border mt-3 ${user?.role === 'mechanic' ? 'bg-orange-50 border-orange-500' : 'bg-slate-50 border-slate-200'}`}
          >
            <Text className={`font-semibold ${user?.role === 'mechanic' ? 'text-orange-600' : 'text-slate-800'}`}>Certified Mechanic Portal</Text>
            <Text className="text-slate-400 text-xxs mt-1">Mint immutable Partsentry logs and authorize inspection hashes.</Text>
          </Pressable>
        </View>
      </View>

      {/* Identity verification entry point */}
      <Pressable
        onPress={() => router.push('/(auth)/verification/intro')}
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
          Sign Out Session
        </Text>
      </Pressable>
    </ScrollView>
  );
}
