import React from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CaptureShell } from '../../../components/capture/CaptureSystem';
import { EvidenceThumbnail } from '../../../components/media/NativeMedia';
import { Button, Notice, StatusPill } from '../../../components/ui/NativePrimitives';
import { spacing, typeScale, useNativeTheme } from '../../../theme/tokens';
import { useVerificationStore } from '../../../store/verificationStore';

export default function VerificationReview() {
  const theme = useNativeTheme();
  const params = useLocalSearchParams<{ docType: string; doubleSided: string; livenessMode?: string }>();
  const front = useVerificationStore((state) => state.capturedFront);
  const back = useVerificationStore((state) => state.capturedBack);
  const selfie = useVerificationStore((state) => state.capturedSelfie);

  const rows = [
    { key: 'front', label: 'Document front', uri: front },
    ...(params.doubleSided === 'true' ? [{ key: 'back', label: 'Document back', uri: back }] : []),
    { key: 'selfie', label: 'Selfie', uri: selfie },
  ];

  const submit = () => {
    router.push({
      pathname: '/(auth)/verification/processing',
      params: { docType: params.docType, doubleSided: params.doubleSided },
    });
  };

  const retake = () => {
    useVerificationStore.getState().clear();
    router.replace('/(auth)/verification/document-select');
  };

  return (
    <CaptureShell
      step="Step 7 of 9"
      title="Review your photos"
      subtitle="Captured means the photo is ready to send. It does not mean the document has been verified."
      onBack={() => router.back()}
      footer={
        <View style={{ gap: spacing[2] }}>
          <Button label="Submit" onPress={submit} disabled={rows.some((row) => !row.uri)} />
          <Button label="Retake photos" onPress={retake} variant="secondary" />
        </View>
      }
    >
      <View style={{ gap: spacing[3] }}>
        {rows.map((row) => (
          <View
            key={row.key}
            style={{
              minHeight: 88,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.border.default,
              backgroundColor: theme.background.surface,
              padding: spacing[3],
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[4],
            }}
          >
            <EvidenceThumbnail uri={row.uri} label={row.label} privateMedia />
            <View style={{ flex: 1 }}>
              <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>{row.label}</Text>
              <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}>
                {row.uri ? 'Captured on this device' : 'Missing'}
              </Text>
            </View>
            <StatusPill label={row.uri ? 'Captured' : 'Missing'} tone={row.uri ? 'neutral' : 'warning'} />
          </View>
        ))}
      </View>
      <View style={{ marginTop: spacing[5] }}>
        <Notice title="Before you submit" body="Check that the whole document is visible and important text is readable." tone="info" />
      </View>
      {params.livenessMode === 'simulated_not_authoritative' ? (
        <View style={{ marginTop: spacing[3] }}>
          <Notice title="Liveness not active" body="This development build did not perform biometric liveness detection." tone="warning" />
        </View>
      ) : null}
    </CaptureShell>
  );
}
