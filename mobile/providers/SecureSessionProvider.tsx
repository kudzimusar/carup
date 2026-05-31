import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { View, Text, Pressable, AppState, AppStateStatus, Platform } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { authenticateWithBiometrics, checkBiometricsSupport } from '../utils/biometric';

interface SecureSessionContextType {
  isLocked: boolean;
  unlock: () => Promise<void>;
  requireLock: () => void;
  isBiometricAvailable: boolean;
}

const SecureSessionContext = createContext<SecureSessionContextType | null>(null);

export function useSecureSession() {
  const context = useContext(SecureSessionContext);
  if (!context) {
    throw new Error('useSecureSession must be used within a SecureSessionProvider');
  }
  return context;
}

interface SecureSessionProviderProps {
  children: ReactNode;
}

// 5-minute background grace period (in milliseconds)
const GRACE_PERIOD = 5 * 60 * 1000; 

export function SecureSessionProvider({ children }: SecureSessionProviderProps) {
  const { isAuthenticated } = useAuthStore();
  const [isLocked, setIsLocked] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const appState = useRef(AppState.currentState);
  const backgroundTime = useRef<number | null>(null);

  useEffect(() => {
    async function checkSupport() {
      const available = await checkBiometricsSupport();
      setBiometricsAvailable(available);
    }
    if (isAuthenticated) {
      checkSupport();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (!isAuthenticated) return;

      // Returning from background to active state
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        const now = Date.now();
        if (backgroundTime.current && now - backgroundTime.current > GRACE_PERIOD) {
          // Grace period elapsed, enforce screen lock
          setIsLocked(true);
          await triggerBiometrics();
        }
      }

      // App moving to background
      if (nextAppState.match(/inactive|background/)) {
        backgroundTime.current = Date.now();
      }

      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [isAuthenticated]);

  const triggerBiometrics = async (): Promise<boolean> => {
    const success = await authenticateWithBiometrics('Verify biometric signature to unlock session');
    if (success) {
      setIsLocked(false);
      return true;
    }
    return false;
  };

  const unlock = async () => {
    await triggerBiometrics();
  };

  const requireLock = () => {
    if (isAuthenticated) {
      setIsLocked(true);
    }
  };

  // Render a premium lock overlay directly over children when isLocked is active
  if (isLocked && isAuthenticated) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center px-6">
        <View className="items-center mb-12">
          <View className="bg-orange-500/10 border border-orange-500/20 p-5 rounded-full mb-6">
            {/* Standard padlock indicator inside native layout */}
            <Text className="text-orange-500 text-3xl">🔒</Text>
          </View>
          <Text className="text-white text-2xl font-bold tracking-tight text-center">Session Secured</Text>
          <Text className="text-slate-400 text-sm mt-2 text-center">
            Your CarUp Kimi session is locked to secure platform transactions.
          </Text>
        </View>

        <View className="w-full space-y-4">
          <Pressable
            onPress={unlock}
            className="w-full bg-orange-500 rounded-xl h-14 justify-center items-center shadow-lg active:opacity-90"
            style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
          >
            <Text className="text-white text-base font-semibold">
              {biometricsAvailable ? 'Unlock with Biometrics' : 'Enter PIN / Passcode'}
            </Text>
          </Pressable>
        </View>

        <Text className="text-slate-600 text-xxs mt-16 tracking-wider uppercase">
          fintech bank-escrow safety protocol active
        </Text>
      </View>
    );
  }

  return (
    <SecureSessionContext.Provider value={{ isLocked, unlock, requireLock, isBiometricAvailable: biometricsAvailable }}>
      {children}
    </SecureSessionContext.Provider>
  );
}
