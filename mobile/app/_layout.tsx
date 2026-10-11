import { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { SecureSessionProvider } from '../providers/SecureSessionProvider';
import { ensurePushRegistration } from '../utils/pushRegistration';
import {
  markBackgrounded,
  markColdStartUsable,
  markWarmResume,
} from '../utils/nativePerformance';
import { useNativeTheme } from '../theme/tokens';
import '../global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export default function RootLayout() {
  const theme = useNativeTheme();
  const initializeAuth = useAuthStore((state) => state.initialize);
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sessionToken = useAuthStore((state) => state.token);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (!loading) markColdStartUsable();
  }, [loading]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appState.current;
      if (previous === 'active' && nextState !== 'active') markBackgrounded();
      if (previous !== 'active' && nextState === 'active') markWarmResume();
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (loading || !isAuthenticated || !sessionToken) return;
    void ensurePushRegistration();
  }, [loading, isAuthenticated, sessionToken]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SecureSessionProvider>
          <StatusBar style="auto" />
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'slide_from_right' }} />
            </Stack>
            {loading && (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Restoring your CarUp session"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: theme.background.canvas,
                  justifyContent: 'center',
                  alignItems: 'center',
                  zIndex: 9999,
                }}
              >
                <ActivityIndicator size="large" color={theme.brand.primary} />
              </View>
            )}
          </View>
        </SecureSessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
