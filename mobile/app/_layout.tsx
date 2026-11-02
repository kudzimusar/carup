import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { SecureSessionProvider } from '../providers/SecureSessionProvider';
import { ensurePushRegistration } from '../utils/pushRegistration';
import '../global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes stale time
    },
  },
});

export default function RootLayout() {
  const initializeAuth = useAuthStore((state) => state.initialize);
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sessionToken = useAuthStore((state) => state.token);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // OC-EXPO-02 — register for push only once the session is KNOWN: after initialization has
  // validated any restored token, and again for each new session. Fire-and-forget by design:
  // registration never resolves to an error and is never awaited, so it cannot hold up start-up.
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
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
                <ActivityIndicator size="large" color="#f97316" />
              </View>
            )}
          </View>
        </SecureSessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
