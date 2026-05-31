import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { SecureSessionProvider } from '../providers/SecureSessionProvider';

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

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (loading) {
    // In a production layout, return a premium custom native splash/loading screen
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SecureSessionProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'slide_from_right' }} />
          </Stack>
        </SecureSessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
