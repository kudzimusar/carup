import React, { useState, useCallback } from 'react';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { useVerificationStore } from '../../../store/verificationStore';

interface DocumentOption {
  id: string;
  title: string;
  description: string;
  doubleSided: boolean;
  icon: string;
}

const SUPPORTED_DOCUMENTS: DocumentOption[] = [
  {
    id: 'national_id',
    title: 'Zimbabwe National ID',
    description: 'Metal card, plastic card, or paper slip',
    doubleSided: true,
    icon: '🪪',
  },
  {
    id: 'passport',
    title: 'Passport',
    description: 'International biometric photo page',
    doubleSided: false,
    icon: '🛂',
  },
  {
    id: 'driver_license',
    title: "Driver's License",
    description: 'Personal driving licence card with your photo (not a vehicle licence disc)',
    doubleSided: true,
    icon: '🚗',
  },
  {
    id: 'residence_permit',
    title: 'Residence Permit',
    description: 'Official permit slip with photograph',
    doubleSided: false,
    icon: '📝',
  },
];

function DocumentSelect() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((doc: DocumentOption) => {
    setSelectedId(doc.id);
    useVerificationStore.getState().clear();
    router.push({
      pathname: '/(auth)/verification/capture-front',
      params: { docType: doc.id, doubleSided: doc.doubleSided ? 'true' : 'false' }
    });
  }, []);

  const handleBack = useCallback(() => {
    useVerificationStore.getState().clear();
    router.back();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0E1A' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>
        
        <View style={{ marginTop: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <TouchableOpacity 
              onPress={handleBack}
              style={{
                width: 40, height: 40,
                backgroundColor: '#161C2C', borderWidth: 1, borderColor: '#2B3552',
                borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18 }}>←</Text>
            </TouchableOpacity>
            <Text style={{ color: '#64748b', fontWeight: '600', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>Step 2 of 9</Text>
          </View>

          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 }}>
            Select Document
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 14, lineHeight: 20, marginBottom: 32 }}>
            Please choose the primary document you will capture. The document must be valid and clearly show your legal details and photo.
          </Text>

          <View style={{ gap: 16 }}>
            {SUPPORTED_DOCUMENTS.map((doc) => {
              const isSelected = selectedId === doc.id;
              return (
                <TouchableOpacity
                  key={doc.id}
                  onPress={() => handleSelect(doc)}
                  activeOpacity={0.85}
                  style={{
                    flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 16, borderWidth: 1,
                    backgroundColor: isSelected ? 'rgba(37,99,235,0.1)' : 'rgba(22,28,44,0.65)',
                    borderColor: isSelected ? '#3b82f6' : 'rgba(43,53,82,0.4)',
                  }}
                >
                  <View style={{
                    width: 48, height: 48,
                    backgroundColor: 'rgba(30,41,59,0.8)', borderRadius: 12,
                    alignItems: 'center', justifyContent: 'center', marginRight: 16,
                    borderWidth: 1, borderColor: 'rgba(51,65,85,0.5)',
                  }}>
                    <Text style={{ fontSize: 22 }}>{doc.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16, marginBottom: 4 }}>{doc.title}</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 11 }}>{doc.description}</Text>
                  </View>
                  <Text style={{ color: '#64748b', fontSize: 18, fontWeight: 'bold' }}>➔</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ marginTop: 32, paddingTop: 16, alignItems: 'center' }}>
          <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 16 }}>
            By continuing, you agree to allow our secure backend systems to run automated OCR extraction on the captured image.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ENTRY PREFLIGHT (device Gate 2 round 3): a terminally-rejected applicant is
// stopped BEFORE this screen mounts — including deep links — so no document
// selection or camera capture is possible until a reviewer reopens the case.
export default function GuardedDocumentSelect(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <DocumentSelect />
    </VerificationEntryGuard>
  );
}
