import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVerificationStore } from '../../../store/verificationStore';

export default function VerificationReview() {
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
    livenessVerified: string;
  }>();

  const [checkingQuality, setCheckingQuality] = useState<boolean>(false);

  const handleSubmit = useCallback(() => {
    router.push({
      pathname: '/(auth)/verification/processing',
      params: { docType: params.docType, doubleSided: params.doubleSided }
    });
  }, [params.docType, params.doubleSided]);

  const handleRetake = useCallback(() => {
    useVerificationStore.getState().clear();
    router.replace('/(auth)/verification/document-select');
  }, []);

  const handleBack = useCallback(() => {
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
            <Text style={{ color: '#64748b', fontWeight: '600', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
              Step 7 of 9: REVIEW
            </Text>
          </View>

          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 }}>
            Review Captures
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 14, lineHeight: 20, marginBottom: 24 }}>
            Please confirm all details are readable before upload.
          </Text>

          <View style={{ padding: 20, backgroundColor: '#161C2C', borderWidth: 1, borderColor: '#2B3552', borderRadius: 16, marginBottom: 32 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14, marginBottom: 12 }}>Manual Quality Checklist</Text>

            <View style={{ gap: 12 }}>
              {[
                { label: 'Document fully in frame', value: 'Confirm below' },
                { label: 'Text is sharp, not blurred', value: 'Confirm below' },
                { label: 'No reflective glare', value: 'Confirm below' },
                { label: 'Photo is well-lit', value: 'Confirm below' },
              ].map((item) => (
                <View key={item.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>{item.label}</Text>
                  <Text style={{ color: '#34d399', fontSize: 11, fontWeight: '600' }}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14, marginBottom: 12 }}>Captured Assets</Text>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.5)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.4)', borderRadius: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 40, height: 40, backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 16 }}>📄</Text>
                </View>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>Front Document Image</Text>
              </View>
              <Text style={{ color: '#34d399', fontSize: 11, fontWeight: 'bold' }}>READY</Text>
            </View>

            {params.doubleSided === 'true' && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.5)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.4)', borderRadius: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 40, height: 40, backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Text style={{ fontSize: 16 }}>📄</Text>
                  </View>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>Back Document Image</Text>
                </View>
                <Text style={{ color: '#34d399', fontSize: 11, fontWeight: 'bold' }}>READY</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.5)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.4)', borderRadius: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 40, height: 40, backgroundColor: 'rgba(99,102,241,0.1)', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 16 }}>👤</Text>
                </View>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>Selfie (liveness deferred)</Text>
              </View>
              <Text style={{ color: '#34d399', fontSize: 11, fontWeight: 'bold' }}>READY</Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.8}
            style={{ width: '100%', height: 56, backgroundColor: '#2563eb', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Submit Documents</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRetake}
            activeOpacity={0.8}
            style={{ width: '100%', height: 48, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#94a3b8', fontWeight: '500', fontSize: 14 }}>Retake Photos</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
