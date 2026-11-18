import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useVerificationStore } from '../../../store/verificationStore';
import { runVerificationSessionFlow } from '../../../utils/verificationApi';

export default function VerificationProcessing() {
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const front = useVerificationStore(s => s.capturedFront);
  const back = useVerificationStore(s => s.capturedBack);
  const selfie = useVerificationStore(s => s.capturedSelfie);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    if (!front || !selfie || (params.doubleSided === 'true' && !back)) {
      setMessage('Required photos are missing. Return to capture and try again.'); return;
    }
    inFlight.current = true;
    setBusy(true); setMessage(null);
    try {
      const outcome = await runVerificationSessionFlow({
        docType: params.docType || 'national_id', doubleSided: params.doubleSided === 'true',
        capturedFront: front, capturedBack: back, capturedSelfie: selfie,
        existingSessionId: useVerificationStore.getState().verificationSessionId,
        onSession: id => { if (mounted.current) useVerificationStore.setState({ verificationSessionId: id }); },
        shouldContinue: () => mounted.current,
      });
      if (!mounted.current) return;
      useVerificationStore.getState().setVerificationOutcome(outcome.status, outcome.sessionId, outcome.processingError, outcome.sessionStatus);
      useVerificationStore.getState().setOcrResult(outcome.ocrResult);
      router.replace(outcome.needsConfirmation ? '/(auth)/verification/ocr-confirmation' : '/(auth)/verification/result');
    } catch {
      if (mounted.current) setMessage('The request could not finish. Retry to continue the same saved session.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [front, back, selfie, params.docType, params.doubleSided]);

  useEffect(() => { void run(); }, [run]);
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {busy && <ActivityIndicator size="large" color="#ea580c" />}
        <Text accessibilityRole="header" style={styles.title}>{busy ? 'Sending your verification' : 'Verification interrupted'}</Text>
        <Text style={styles.body}>{message || 'Uploading your photos and waiting for the server. Your identity is not verified by this step.'}</Text>
        {!busy && <TouchableOpacity accessibilityRole="button" onPress={() => void run()} style={styles.button}><Text style={styles.buttonText}>Retry</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.body}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0E1A' },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  body: { color: '#cbd5e1', fontSize: 16, lineHeight: 24 },
  button: { backgroundColor: '#ea580c', borderRadius: 12, padding: 18, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  back: { paddingVertical: 12 },
});
