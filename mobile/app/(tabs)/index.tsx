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
        className="w-full bg-orange-500 rounded-xl h-14 justify-center items-center mb-4"
        style={({ pressed }) => pressed ? { opacity: 0.8 } : {}}
        testID="start-verification-flow"
      >
        <Text className="text-white text-base font-semibold">Start Verification Flow</Text>
      </Pressable>

      {/* Account actions */}
      <Pressable
        onPress={handleLogout}
        className="w-full bg-red-50 border border-red-200 rounded-xl h-14 justify-center items-center mb-10"
        style={({ pressed }) => pressed ? { opacity: 0.8 } : {}}
      >
        <Text className="text-red-600 text-base font-semibold">Sign Out Session</Text>
      </Pressable>
    </ScrollView>
  );
}
