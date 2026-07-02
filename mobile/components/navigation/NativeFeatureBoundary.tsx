/**
 * Native feature boundary (Milestone A).
 *
 * Wraps a native screen and enforces the governed route decision at the route
 * level, so a deep link or typed route resolves the same way the navigation
 * does. Reads auth (useAuthStore) + governance (useFeatureGovernanceStore),
 * computes the decision via evaluateNativeRouteAccess, and renders the matching
 * outcome. Native-safe: only react-native, expo-router, and local imports.
 *
 * Identity-transition readiness (fail-closed): before evaluating a GOVERNED
 * route (one with a `featureId`), it asks `isGovernanceReadyForIdentity` whether
 * the governed states are loaded FOR THE CURRENT identity. On an A→B identity
 * transition the store has cleared A's map (loadedForKey→null, loading→true), so
 * the boundary blocks with a spinner until B's states load — never evaluating B
 * against A's accessible:true map. A FAILED B load surfaces a retryable
 * "Temporarily unavailable" state instead of silently un-gating. The never-loaded
 * COLD-START boot proceeds with the documented static-manifest fallback (and
 * kicks a one-shot refresh); protected routes still gate via auth in evaluate.
 */
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import {
  useFeatureGovernanceStore,
  currentIdentityKey,
  isGovernanceReadyForIdentity,
} from '../../store/featureGovernanceStore';
import { evaluateNativeRouteAccess } from '../../navigation/evaluateNativeRouteAccess';

interface NativeFeatureBoundaryProps {
  route: string;
  featureId?: string;
  hasNativeScreen?: boolean;
  children: React.ReactNode;
}

function StateView({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  const router = useRouter();
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        style={styles.action}
        accessibilityRole="button"
        onPress={() => router.replace('/')}
      >
        <Text style={styles.actionText}>Go to Dashboard</Text>
      </Pressable>
    </View>
  );
}

/**
 * Safe, retryable state for a governed route whose identity-state fetch FAILED.
 * The button re-runs `refresh()` once per press (no effect loop) so a transient
 * backend/network failure is user-recoverable without un-gating the route.
 */
function RetryableStateView({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        onPress={() => {
          void useFeatureGovernanceStore.getState().refresh();
        }}
      >
        <Text style={styles.actionText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function BetaBanner(): React.ReactElement {
  return (
    <View style={styles.betaBanner}>
      <Text style={styles.betaText}>Beta feature — still being refined.</Text>
    </View>
  );
}

export function NativeFeatureBoundary({
  route,
  featureId,
  hasNativeScreen = true,
  children,
}: NativeFeatureBoundaryProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const role = user?.role ?? null;
  const isBootstrapping = useAuthStore((s) => s.loading);
  const effectiveStates = useFeatureGovernanceStore((s) => s.effectiveStates);
  const loadedForKey = useFeatureGovernanceStore((s) => s.loadedForKey);
  const govLoading = useFeatureGovernanceStore((s) => s.loading);
  const govError = useFeatureGovernanceStore((s) => s.error);

  // Identity-transition readiness — only gates GOVERNED routes (featureId set).
  // Ungoverned public/static boot routes (no featureId) are never blocked by
  // this contract; they evaluate as before.
  const currentKey = currentIdentityKey(user, token);
  const readiness = featureId
    ? isGovernanceReadyForIdentity(currentKey, loadedForKey, govLoading, govError)
    : { ready: true, reason: 'ready' as const };

  // Cold-start (never-loaded boot): proceed with the static fallback but kick a
  // one-shot refresh so the governed truth arrives. Guarded so it fires only
  // once per cold-start window (loadedForKey null, not loading, no error) — a
  // button-free, loop-free effect. `(tabs)/_layout` also refreshes on identity
  // change; this only covers a governed route mounted before that ran.
  useEffect(() => {
    if (
      featureId &&
      !isBootstrapping &&
      loadedForKey === null &&
      !govLoading &&
      !govError
    ) {
      void useFeatureGovernanceStore.getState().refresh();
    }
  }, [featureId, isBootstrapping, loadedForKey, govLoading, govError]);

  // Block a governed route until the CURRENT identity's states are ready.
  if (featureId && !readiness.ready) {
    if (readiness.reason === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      );
    }
    // reason === 'error' — failed identity load: safe + retryable, never un-gated.
    return (
      <RetryableStateView
        title="Temporarily unavailable"
        message="We could not confirm your access. Please try again."
      />
    );
  }

  const decision = evaluateNativeRouteAccess({
    route,
    featureId,
    isBootstrapping,
    isAuthenticated,
    role,
    effectiveStates,
    hasNativeScreen,
  });

  switch (decision.kind) {
    case 'loading':
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      );

    case 'render':
      return <>{children}</>;

    case 'render-beta':
      return (
        <>
          <BetaBanner />
          {children}
        </>
      );

    case 'redirect-auth':
      return <Redirect href="/login" />;

    case 'redirect-role':
      // The wrong-role target is always the role's own dashboard (the tabs
      // index, which expo-router exposes as `/`).
      return <Redirect href="/" />;

    case 'planned':
      return (
        <StateView
          title="Coming soon"
          message="This feature is planned and not available yet."
        />
      );

    case 'hidden':
      return (
        <StateView
          title="Not available"
          message="This feature is not available right now."
        />
      );

    case 'disabled':
      return (
        <StateView
          title="Unavailable"
          message="This feature is currently turned off."
        />
      );

    case 'deprecated':
      return (
        <StateView
          title="Moved"
          message={
            decision.to
              ? `This feature has moved${decision.to ? ` to ${decision.to}` : ''}.`
              : 'This feature has been retired.'
          }
        />
      );

    case 'native-unavailable':
      return (
        <StateView
          title="Not on mobile"
          message="This feature is available on the web app. Open it in your browser to continue."
        />
      );

    case 'backend-inaccessible':
      return (
        <StateView
          title="Temporarily unavailable"
          message="We could not load this feature. Please try again."
        />
      );

    default:
      return <>{children}</>;
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  action: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  betaBanner: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  betaText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default NativeFeatureBoundary;
