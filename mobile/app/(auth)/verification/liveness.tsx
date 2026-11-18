import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

export default function LivenessUnavailable() {
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.content}>
          <Text style={styles.label}>IDENTITY VERIFICATION</Text>
          <Text accessibilityRole="header" style={styles.title}>Liveness check unavailable</Text>
          <Text style={styles.body}>
            Biometric liveness is not available right now. No liveness or face-match check has been performed.
          </Text>
          <Text style={styles.body}>
            You can continue to review your photos and submit them for manual review. Submitting photos does not verify your identity.
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.button}
          onPress={() => router.push({ pathname: '/(auth)/verification/review', params: { docType: params.docType, doubleSided: params.doubleSided } })}
        >
          <Text style={styles.buttonText}>Continue to photo review</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0E1A' },
  container: { flex: 1, padding: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 12, paddingRight: 20 },
  backText: { color: '#fff', fontSize: 16 },
  content: { flex: 1, justifyContent: 'center', gap: 16 },
  label: { color: '#94a3b8', fontSize: 11, fontWeight: '600', letterSpacing: 2 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  body: { color: '#cbd5e1', fontSize: 16, lineHeight: 24 },
  button: { backgroundColor: '#3b82f6', padding: 18, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
