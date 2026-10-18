import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import { CaptureShell } from '../../../components/capture/CaptureSystem';
import { Button, Notice, TrustSignal } from '../../../components/ui/NativePrimitives';
import { spacing } from '../../../theme/tokens';

function VerificationIntro() {
  return (
    <CaptureShell
      step="Step 1 of 9"
      title="Verify your identity"
      subtitle="CarUp may require an identity check before sensitive actions such as selling a vehicle."
      onBack={() => router.back()}
      footer={
        <Button
          label="Choose a document"
          onPress={() => router.push('/(auth)/verification/document-select')}
        />
      }
    >
      <View style={{ gap: spacing[5] }}>
        <TrustSignal
          label="Your evidence stays private"
          detail="Document photos are submitted for review and are not shown as Marketplace media."
        />
        <TrustSignal
          label="You review every photo"
          detail="After capture, you can retake the image before it is submitted."
        />
        <TrustSignal
          label="Reading is not approval"
          detail="CarUp may read details from your document, but that reading does not make the final decision."
        />
      </View>

      <View style={{ marginTop: spacing[6] }}>
        <Notice
          title="Have a document ready"
          body="You can use a supported National ID, passport, driver's licence or residence permit. Some documents require both sides."
          tone="info"
        />
      </View>
    </CaptureShell>
  );
}

export default function GuardedVerificationIntro(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <VerificationIntro />
    </VerificationEntryGuard>
  );
}
