// CARUP-MVP-STAB-01 F-016: imported first, so `process_start` is taken as early as the app's own
// code runs; the one `[carup-startup]` line is written when Home renders or recovery shows.
import {
  markColdStartUsable,
  markStartupPhase,
  markWarmResumeStart,
  markWarmResumeUsable,
} from '../utils/nativePerformance';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, InteractionManager, Text, View } from 'react-native';
import { Stack, useNavigationContainerRef, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  startupScreenFor,
  STARTUP_SLOW_NOTICE_MS,
  useAuthStore,
  type StartupScreen,
} from '../store/authStore';
import { SecureSessionProvider } from '../providers/SecureSessionProvider';
import { ensurePushRegistration } from '../utils/pushRegistration';
import { queryClient } from '../utils/queryClient';
import { communicationQueryKeys } from '../utils/communicationQueries';
import { getCommunicationThread } from '../utils/communicationApi';
import { getMarketplaceListingDetail } from '../utils/marketplaceApi';
import { routeCanonicalPushPayload } from '../utils/pushNavigation';
import { signInHref } from '../utils/vehicleNavigation';
import { CarUpWordmark } from '../components/brand/CarUpBrand';
import { Button } from '../components/ui/NativePrimitives';
import { palette, spacing, typeScale, useNativeTheme } from '../theme/tokens';
import '../global.css';

/**
 * CARUP-MVP-STAB-01 F-014: the tabs are the root anchor, so a cold deep link such as
 * carup://vehicle/<vin> opens with the tabs beneath the vehicle and Back lands in the app instead of
 * closing it. expo-router 6 reads `unstable_settings.anchor` (build/getRoutesCore.js getLayoutNode).
 */
export const unstable_settings = {
  anchor: '(tabs)',
};

/** CarUp navy — the same colour as the native splash window (app.json), so start-up never flashes white. */
const STARTUP_BACKGROUND = palette.navy980;

/** True once the root navigator can take navigation actions. */
function useRouterReady(): boolean {
  const navigationRef = useNavigationContainerRef();
  const [ready, setReady] = useState(() => Boolean(navigationRef?.isReady?.()));
  useEffect(() => {
    if (ready) return undefined;
    if (navigationRef?.isReady?.()) {
      setReady(true);
      return undefined;
    }
    const unsubscribe = navigationRef?.addListener?.('ready', () => setReady(true));
    return () => unsubscribe?.();
  }, [navigationRef, ready]);
  return ready;
}

/**
 * CARUP-MVP-STAB-01 F-015 / F-016: what the person sees while CarUp restores their session — the
 * brand on navy from the first frame, a notice if it takes long, and an honest recovery screen when
 * CarUp cannot be reached. Never a signed-in Home it could not confirm.
 */
function StartupView({ screen, onRetry }: { screen: StartupScreen; onRetry: () => void }) {
  const theme = useNativeTheme();
  const recovery = screen === 'recovery';
  return (
    <View
      accessibilityRole={recovery ? undefined : 'progressbar'}
      accessibilityLabel={recovery ? undefined : 'Restoring your CarUp session'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: STARTUP_BACKGROUND,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing[6],
        zIndex: 9999,
      }}
    >
      <CarUpWordmark tone="light" />
      {recovery ? (
        <View style={{ alignSelf: 'stretch', alignItems: 'center', marginTop: spacing[8] }}>
          <Text
            allowFontScaling
            accessibilityRole="header"
            style={{ ...typeScale.title, color: theme.brand.onHero, textAlign: 'center' }}
          >
            Still connecting to CarUp
          </Text>
          <Text
            allowFontScaling
            style={{ ...typeScale.body, color: theme.brand.onHeroMuted, textAlign: 'center', marginTop: spacing[3] }}
          >
            CarUp could not confirm your sign-in yet. Check your internet connection, then try again. Your sign-in is still saved on this device.
          </Text>
          <Button label="Try again" onPress={onRetry} style={{ alignSelf: 'stretch', marginTop: spacing[6] }} />
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: spacing[8] }}>
          <ActivityIndicator size="large" color={theme.brand.primary} />
          <Text
            allowFontScaling
            style={{ ...typeScale.body, color: theme.brand.onHeroMuted, textAlign: 'center', marginTop: spacing[4] }}
          >
            Restoring your CarUp session
          </Text>
          {screen === 'restoring_slow' ? (
            <Text
              allowFontScaling
              accessibilityLiveRegion="polite"
              style={{ ...typeScale.label, color: theme.brand.onHero, textAlign: 'center', marginTop: spacing[2] }}
            >
              Still connecting…
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const initializeAuth = useAuthStore((state) => state.initialize);
  const loading = useAuthStore((state) => state.loading);
  const restoration = useAuthStore((state) => state.restoration);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sessionToken = useAuthStore((state) => state.token);
  const appState = useRef(AppState.currentState);
  const handledPushResponses = useRef(new Set<string>());
  const routerReady = useRouterReady();
  const [slowRestore, setSlowRestore] = useState(false);

  useEffect(() => {
    markStartupPhase('js_mounted');
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (routerReady) markStartupPhase('router_ready');
  }, [routerReady]);

  // "Still connecting…" appears before the hard limit on the session check.
  useEffect(() => {
    if (restoration !== 'restoring') {
      setSlowRestore(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlowRestore(true), STARTUP_SLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [restoration]);

  useEffect(() => {
    if (restoration === 'recovery') markStartupPhase('recovery_shown');
  }, [restoration]);

  // CarUp refused the saved session: it is already cleared; open Sign In once, saying why.
  useEffect(() => {
    if (restoration !== 'session_ended' || !routerReady) return;
    useAuthStore.getState().acknowledgeSessionEnded();
    router.push(signInHref({ reason: 'session_ended' }) as never);
  }, [restoration, routerReady, router]);

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

  const startupScreen = startupScreenFor(restoration, slowRestore);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SecureSessionProvider>
          <StatusBar style={startupScreen ? 'light' : 'auto'} />
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'slide_from_right' }} />
            </Stack>
            {startupScreen ? (
              <StartupView screen={startupScreen} onRetry={() => void initializeAuth()} />
            ) : null}
          </View>
        </SecureSessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
