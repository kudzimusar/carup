/**
 * VerificationEntryGuard — wraps EVERY entry/capture screen of the identity
 * verification flow (intro, document-select, capture-front, capture-back,
 * selfie) so a terminally-rejected applicant is stopped BEFORE document
 * selection or camera activation, including via deep links that bypass intro.
 *
 * Children are rendered ONLY on an explicit 'allow' decision:
 *  - loading      → spinner (no capture surface ever mounts);
 *  - blocked      → terminal "Verification Closed — Not Approved" screen with
 *                   the reviewer reason and the support/reopen path;
 *  - error        → retryable network-failure screen (fail-closed: a fetch
 *                   failure never silently allows capture);
 *  - unauthenticated → redirect to login.
 *
 * After a reviewer reopens the case (Request Resubmission), the refetch on the
 * next mount returns a non-terminal latest session and entry is allowed again.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { getLatestVerificationSession } from '../../utils/verificationApi';
import {
  evaluateVerificationEntry,
  type VerificationEntryDecision,
} from '../../utils/verificationEntry';

export function VerificationEntryGuard({ children }: { children: React.ReactNode }): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.loading);
  const [decision, setDecision] = useState<VerificationEntryDecision | null>(null);

  const runPreflight = useCallback(async () => {
    setDecision(null);
    try {
      const session = await getLatestVerificationSession();
      setDecision(evaluateVerificationEntry({ session }));
    } catch {
      setDecision(evaluateVerificationEntry({ error: true }));
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) void runPreflight();
  }, [authLoading, isAuthenticated, runPreflight]);

  if (authLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#f97316" />
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  if (decision === null) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', alignItems: 'center' }}
        testID="verification-entry-loading"
      >
        <ActivityIndicator size="large" color="#f97316" />
        <Text style={{ color: '#94a3b8', fontSize: 13, marginTop: 16 }}>Checking your verification status…</Text>
      </SafeAreaView>
    );
  }

  if (decision.kind === 'blocked-terminal') {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', padding: 24 }}
        testID="verification-entry-blocked"
      >
        <View style={{ alignItems: 'center' }}>
          <View style={{
            width: 96, height: 96, borderRadius: 48, marginBottom: 24,
            backgroundColor: 'rgba(248,113,113,0.1)', borderWidth: 1, borderColor: '#f87171',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <Text style={{ fontSize: 36, color: '#f87171', fontWeight: 'bold' }}>!</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>
            Verification Closed — Not Approved
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 16 }}>
            A reviewer examined your previous submission and closed this verification. This decision is
            final in the app — you cannot start a new attempt yourself.
          </Text>
          {decision.reason ? (
            <View style={{
              width: '100%', padding: 16, marginBottom: 16, borderRadius: 16,
              backgroundColor: 'rgba(248,113,113,0.1)', borderWidth: 1, borderColor: '#f87171',
            }}>
              <Text style={{ color: '#f87171', fontSize: 12, fontWeight: '600', marginBottom: 4 }}>Reviewer reason</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 18 }}>{decision.reason}</Text>
            </View>
          ) : null}
          <Text style={{ color: '#64748b', fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 24 }}>
            If you believe this is a mistake, contact CarUp support — a reviewer can reopen the case by
            requesting a new submission, after which this screen will let you continue.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.8}
            style={{
              width: '100%', height: 52, borderRadius: 16, backgroundColor: '#1e293b',
              borderWidth: 1, borderColor: '#2B3552', justifyContent: 'center', alignItems: 'center',
            }}
          >
            <Text style={{ color: '#cbd5e1', fontWeight: '600', fontSize: 15 }}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (decision.kind === 'error') {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', padding: 24 }}
        testID="verification-entry-error"
      >
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
            Cannot check your verification status
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 24 }}>
            We could not reach CarUp to confirm whether you can start a verification. Check your
            connection and try again — capture stays locked until your status is confirmed.
          </Text>
          <TouchableOpacity
            onPress={() => void runPreflight()}
            activeOpacity={0.8}
            style={{
              width: '100%', height: 52, borderRadius: 16, backgroundColor: '#f97316',
              justifyContent: 'center', alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}

export default VerificationEntryGuard;
