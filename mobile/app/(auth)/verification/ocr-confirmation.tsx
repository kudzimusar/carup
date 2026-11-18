import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmationIdempotencyKey, confirmVerificationOcr, getVerificationSession, type VerificationSession } from '../../../utils/verificationApi';
import { useVerificationStore } from '../../../store/verificationStore';

export default function OcrConfirmation() {
  const sessionId = useVerificationStore(s => s.verificationSessionId);
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!sessionId) { setError('No verification session was found.'); return () => { alive.current = false; }; }
    getVerificationSession(sessionId).then(value => {
      if (!alive.current) return;
      setSession(value);
      const initial: Record<string, string> = {};
      for (const field of value.confirmation_fields || []) {
        const observation = field.source === 'additional' ? value.ocr_result?.additional_fields?.[field.name] : value.ocr_result?.[field.name];
        initial[field.name] = typeof observation === 'string' ? observation : '';
      }
      setFields(initial);
    }).catch(() => { if (alive.current) setError('Could not load document observations. Please retry later.'); });
    return () => { alive.current = false; };
  }, [sessionId]);

  async function submit() {
    if (submitting.current || !session || !sessionId || !session.revision) return;
    const requiredMissing = (session.confirmation_fields || []).some(field => field.required && !fields[field.name]?.trim());
    if (!session.confirmation_fields?.length) { setError('This document type cannot be confirmed through OCR.'); return; }
    if (requiredMissing) { setError('Complete all required fields.'); return; }
    // Stable for retry of this exact session revision; this is not an authentication credential.
    const payload = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()));
    submitting.current = true; setBusy(true); setError(null);
    try {
      const key = confirmationIdempotencyKey(sessionId, session.revision);
      await confirmVerificationOcr(sessionId, session.revision, key, payload);
      if (alive.current) router.replace('/(auth)/verification/result');
    } catch {
      if (alive.current) setError('Could not confirm these details. Your case may have changed; reopen it and try again.');
    } finally {
      submitting.current = false; if (alive.current) setBusy(false);
    }
  }

  return <SafeAreaView style={styles.root} edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>Review document details</Text>
    <Text style={styles.body}>Check what was read and correct any errors. Your confirmation is a declaration; it does not verify your identity.</Text>
    {!session && !error && <ActivityIndicator color="#ea580c" />}
    {session && (session.confirmation_fields || []).map(({ name: key, label, required, source }) => {
      const observed = source === 'additional' ? session.ocr_result?.additional_fields?.[key] : session.ocr_result?.[key];
      const original = typeof observed === 'string' ? observed : '';
      const current = fields[key] || '';
      return <View key={key} style={styles.field}>
        <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
        <Text style={styles.hint}>{original ? `Read from your document: ${original}` : 'Unable to read from your document'}</Text>
        <TextInput accessibilityLabel={label} autoCapitalize="none" style={styles.input} value={current} onChangeText={value => setFields(old => ({ ...old, [key]: value }))} editable={!busy} />
        <Text style={styles.hint}>{current ? (current === original ? 'Confirm this value' : 'Corrected by you') : 'Not provided'}</Text>
      </View>;
    })}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {session && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Saving…' : 'Confirm details'}</Text></TouchableOpacity>}
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={styles.body}>Back</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0E1A' }, content: { padding: 24, gap: 16 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' }, body: { color: '#cbd5e1', lineHeight: 22 },
  field: { gap: 6 }, label: { color: '#fff', fontWeight: '700' }, hint: { color: '#94a3b8', fontSize: 12 },
  input: { color: '#fff', backgroundColor: '#161c2c', borderColor: '#334155', borderWidth: 1, borderRadius: 8, padding: 12 },
  error: { color: '#fca5a5' }, button: { backgroundColor: '#ea580c', borderRadius: 12, padding: 18, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700' },
});
