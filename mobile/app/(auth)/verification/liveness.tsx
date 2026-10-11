import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CaptureShell } from '../../../components/capture/CaptureSystem';
import { Button, Notice } from '../../../components/ui/NativePrimitives';
import { spacing, typeScale, useNativeTheme } from '../../../theme/tokens';
import { Text, View } from 'react-native';

export default function ActiveLiveness() {
  const theme = useNativeTheme();
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();

  return (
    <CaptureShell
      step="Step 6 of 9"
      title="Liveness check"
      subtitle="CarUp's real biometric liveness provider is not active in this build."
      onBack={() => router.back()}
      footer={
        <Button
          label="Continue to review"
          onPress={() =>
            router.push({
              pathname: '/(auth)/verification/review',
              params: {
                docType: params.docType,
                doubleSided: params.doubleSided,
                livenessMode: 'simulated_not_authoritative',
              },
            })
          }
        />
      }
    >
      <View
        style={{
          alignItems: 'center',
          paddingVertical: spacing[8],
          paddingHorizontal: spacing[5],
          borderRadius: 24,
          backgroundColor: theme.background.surface,
          borderWidth: 1,
          borderColor: theme.border.default,
        }}
      >
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.background.surfaceSunken,
          }}
        >
          <Ionicons name="person-circle-outline" size={48} color={theme.text.secondary} />
        </View>
        <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary, textAlign: 'center', marginTop: spacing[5] }}>
          No biometric decision is being made
        </Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, textAlign: 'center', marginTop: spacing[2] }}>
          This development step does not detect blinking, head movement, or identity confidence. It contributes no verification authority.
        </Text>
      </View>

      <View style={{ marginTop: spacing[4] }}>
        <Notice
          title="Why this screen remains"
          body="The route is preserved so the current identity flow stays compatible while the real liveness integration remains a separate product and security decision."
          tone="warning"
        />
      </View>
    </CaptureShell>
  );
}
