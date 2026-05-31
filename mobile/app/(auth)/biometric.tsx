import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { authenticateWithBiometrics, checkBiometricsSupport } from '../../utils/biometric';
import { useAuthStore } from '../../store/authStore';

export default function BiometricUnlockScreen() {
  const router = useRouter();
  const { logout, isAuthenticated } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => {
    async function evaluateSupport() {
      const support = await checkBiometricsSupport();
      setBiometricsAvailable(support);
      if (support && isAuthenticated) {
        // Auto trigger biometrics on mount
        handleAuthenticate();
      }
    }
    evaluateSupport();
  }, [isAuthenticated]);

  const handleAuthenticate = async () => {
    setError(null);
    const success = await authenticateWithBiometrics('Unlock your session and secure transactions');
    if (success) {
      router.replace('/(tabs)');
    } else {
      setError('Biometric validation failed. Please try again.');
    }
  };

  const handleSignOut = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <View className="flex-1 bg-slate-950 justify-center items-center px-6">
      <View className="items-center mb-12">
        <View className="bg-orange-500/10 border border-orange-500/20 p-5 rounded-full mb-6">
          <Text className="text-orange-500 text-3xl">🛡️</Text>
        </View>
        <Text className="text-white text-2xl font-bold tracking-tight text-center">Verify Identity</Text>
        <Text className="text-slate-400 text-sm mt-2 text-center">
          Secure biometric signature required to decrypt transaction tokens.
        </Text>
      </View>

      <View className="w-full space-y-4">
        {error && (
          <Text className="text-red-500 text-xs font-semibold text-center mb-4">{error}</Text>
        )}

        <Pressable
          onPress={handleAuthenticate}
          className="w-full bg-orange-500 rounded-xl h-14 justify-center items-center shadow-lg active:opacity-90"
        >
          <Text className="text-white text-base font-semibold">
            {biometricsAvailable ? 'Unlock with Biometrics' : 'Enter PIN / Passcode'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          className="w-full border border-slate-800 rounded-xl h-14 justify-center items-center mt-4"
          style={({ pressed }) => pressed ? { opacity: 0.8 } : {}}
        >
          <Text className="text-slate-400 text-base font-semibold">Use Different Account</Text>
        </Pressable>
      </View>

      <Text className="text-slate-600 text-xxs mt-16 tracking-wider uppercase">
        fintech bank-escrow safety protocol active
      </Text>
    </View>
  );
}
