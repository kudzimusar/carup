import React, { useCallback } from 'react';
import { router } from 'expo-router';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import { CaptureShell, DocumentTypePicker } from '../../../components/capture/CaptureSystem';
import { Notice } from '../../../components/ui/NativePrimitives';
import { useVerificationStore } from '../../../store/verificationStore';

interface DocumentOption {
  id: string;
  title: string;
  description: string;
  note?: string;
  doubleSided: boolean;
  icon: 'id-card-outline' | 'book-outline' | 'car-outline' | 'document-text-outline';
}

const SUPPORTED_DOCUMENTS: DocumentOption[] = [
  {
    id: 'national_id',
    title: 'Zimbabwe National ID',
    description: 'Use the identity document you normally present as your National ID.',
    note: 'Have the front and back ready.',
    doubleSided: true,
    icon: 'id-card-outline',
  },
  {
    id: 'passport',
    title: 'Passport',
    description: 'Use the photo and personal-details page.',
    doubleSided: false,
    icon: 'book-outline',
  },
  {
    id: 'driver_license',
    title: "Driver's licence",
    description: 'Use your personal driving licence, not a vehicle licence disc.',
    note: 'Have the front and back ready.',
    doubleSided: true,
    icon: 'car-outline',
  },
  {
    id: 'residence_permit',
    title: 'Residence permit',
    description: 'Use the official permit that shows your photograph and personal details.',
    doubleSided: false,
    icon: 'document-text-outline',
  },
];

function DocumentSelect() {
  const handleSelect = useCallback((docId: string) => {
    const doc = SUPPORTED_DOCUMENTS.find((item) => item.id === docId);
    if (!doc) return;
    useVerificationStore.getState().clear();
    router.push({
      pathname: '/(auth)/verification/capture-front',
      params: { docType: doc.id, doubleSided: doc.doubleSided ? 'true' : 'false' },
    });
  }, []);

  const handleBack = useCallback(() => {
    useVerificationStore.getState().clear();
    router.back();
  }, []);

  return (
    <CaptureShell
      step="Step 2 of 9"
      title="Choose your document"
      subtitle="Pick the identity document you want to submit. CarUp will read details from the photo, then the responsible identity process decides the verification result."
      onBack={handleBack}
    >
      <DocumentTypePicker options={SUPPORTED_DOCUMENTS} onSelect={handleSelect} />
      <Notice
        title="What happens next"
        body="You will photograph the required sides, check each photo, take a selfie, and submit the evidence. Reading a document is not the same as verifying it."
        tone="info"
      />
    </CaptureShell>
  );
}

export default function GuardedDocumentSelect(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <DocumentSelect />
    </VerificationEntryGuard>
  );
}
