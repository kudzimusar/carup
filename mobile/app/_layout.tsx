import { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, InteractionManager, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { SecureSessionProvider } from '../providers/SecureSessionProvider';
import { ensurePushRegistration } from '../utils/pushRegistration';
import { queryClient } from '../utils/queryClient';
import { communicationQueryKeys } from '../utils/communicationQueries';
import { getCommunicationThread } from '../utils/communicationApi';
import { getMarketplaceListingDetail } from '../utils/marketplaceApi';
import { routeCanonicalPushPayload } from '../utils/pushNavigation';
import {
  markColdStartUsable,
  markWarmResumeStart,
  markWarmResumeUsable,
} from '../utils/nativePerformance';
import { useNativeTheme } from '../theme/tokens';
import '../global.css';

/**
 * CARUP-MVP-STAB-01 F-014: the tabs are the root anchor, so a cold deep link such as
 * carup://vehicle/<vin> opens with the tabs beneath the vehicle and Back lands in the app instead of
 * closing it. expo-router 6 reads `unstable_settings.anchor` (build/getRoutesCore.js getLayoutNode).
 */
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const theme = useNativeTheme();
  const router = useRouter();
  const initializeAuth = useAuthStore((state) => state.initialize);
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sessionToken = useAuthStore((state) => state.token);
  const appState = useRef(AppState.currentState);
  const handledPushResponses = useRef(new Set<string>());

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (!loading) markColdStartUsable();
  }, [loading]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appState.current;
      if (previous !== 'active' && nextState === 'active') {
        markWarmResumeStart();
        if (useAuthStore.getState().isAuthenticated) {
          void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.root });
          void queryClient.refetchQueries({ queryKey: communicationQueryKeys.root, type: 'active' });
        }
        InteractionManager.runAfterInteractions(() => markWarmResumeUsable());
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (loading || !isAuthenticated || !sessionToken) return;
    void ensurePushRegistration();
  }, [loading, isAuthenticated, sessionToken]);

  useEffect(() => {
    if (loading) return;
    let disposed = false;
    let subscription: { remove: () => void } | null = null;

    const handleResponse = async (response: any) => {
      const identifier = String(response?.notification?.request?.identifier || '');
      if (identifier && handledPushResponses.current.has(identifier)) return;
      if (identifier) handledPushResponses.current.add(identifier);

      const data = response?.notification?.request?.content?.data;
      await routeCanonicalPushPayload(data, {
        isAuthenticated: () => useAuthStore.getState().isAuthenticated,
        authorizeConversation: async (threadId) => {
          try {
            await getCommunicationThread(threadId);
            return true;
          } catch {
            return false;
          }
        },
        authorizeVehicle: async (listingId) => {
          try {
            await getMarketplaceListingDetail(listingId);
            return true;
          } catch {
            return false;
          }
        },
        navigate: (href) => router.push(href as never),
        navigateToLogin: () => router.push('/(auth)/login' as never),
        navigateToInbox: () => {
          const currentUser = useAuthStore.getState().user;
          router.push((currentUser?.role === 'owner' ? '/(tabs)/inbox' : '/(tabs)/account') as never);
        },
        navigateToMarketplace: () => router.push('/(tabs)/marketplace' as never),
      });
    };

    void (async () => {
      try {
        const Notifications = await import('expo-notifications');
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse && !disposed) await handleResponse(lastResponse);
        if (disposed) return;
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          void handleResponse(response);
        });
      } catch {
        // Push-response routing is optional infrastructure. Failure must not block app start.
      }
    })();

    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [loading, router]);

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
