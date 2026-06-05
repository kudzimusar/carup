import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { useVerificationStore } from '../../../store/verificationStore';

export default function VerificationResult() {
  const ocrResult = useVerificationStore(state => state.ocrResult);
  const processingError = useVerificationStore(state => state.processingError);
  const verificationStatus = useVerificationStore(state => state.verificationStatus);
  const verificationSessionId = useVerificationStore(state => state.verificationSessionId);
  const clearVerificationStore = useVerificationStore(state => state.clear);

  const firstName = ocrResult?.first_name || null;
  const lastName = ocrResult?.last_name || null;
  const idNumber = ocrResult?.national_id_number || null;
  const country = ocrResult?.country || null;

  const statusCopy = {
    verified: {
      title: 'Identity Verified',
      badge: 'Backend OCR Verified',
      accent: '#34d399',
      panel: 'rgba(16,185,129,0.1)',
    },
    backend_pending: {
      title: 'Verification Captured — Backend Review Pending',
      badge: 'Backend Review Pending',
      accent: '#fbbf24',
      panel: 'rgba(245,158,11,0.1)',
    },
    ocr_failed: {
      title: 'Verification Needs Review',
      badge: 'OCR Review Required',
      accent: '#fbbf24',
      panel: 'rgba(245,158,11,0.1)',
    },
    needs_review: {
      title: 'Verification Needs Review',
      badge: 'Manual Review Required',
      accent: '#fbbf24',
      panel: 'rgba(245,158,11,0.1)',
    },
    incomplete: {
      title: 'Verification Incomplete',
      badge: 'Retake Required',
      accent: '#f87171',
      panel: 'rgba(248,113,113,0.1)',
    },
    rejected: {
      title: 'Verification Failed',
      badge: 'Rejected',
      accent: '#f87171',
      panel: 'rgba(248,113,113,0.1)',
    },
    idle: {
      title: 'Verification Status Unavailable',
      badge: 'No Active Session',
      accent: '#94a3b8',
      panel: 'rgba(148,163,184,0.1)',
    },
  }[verificationStatus];

  const handleFinish = useCallback(() => {
    clearVerificationStore();
    router.replace('/(tabs)');
  }, [clearVerificationStore]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0E1A' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>
        
        <View style={{ marginTop: 32, alignItems: 'center' }}>
          
          <View style={{
            width: 96, height: 96,
            backgroundColor: statusCopy.panel,
            borderRadius: 48, justifyContent: 'center', alignItems: 'center',
            marginBottom: 24, borderWidth: 1, borderColor: statusCopy.accent,
          }}>
            <Text style={{ fontSize: 36, color: statusCopy.accent, fontWeight: 'bold' }}>
              {verificationStatus === 'verified' ? '✓' : '!'}
            </Text>
          </View>

          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginBottom: 12 }}>
            {statusCopy.title}
          </Text>
          <Text style={{ color: statusCopy.accent, fontSize: 11, letterSpacing: 2, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 32, textAlign: 'center' }}>
            {statusCopy.badge}
          </Text>

          {(processingError || verificationSessionId) && (
            <View style={{
              width: '100%', padding: 16, marginBottom: 24,
              backgroundColor: statusCopy.panel, borderWidth: 1, borderColor: statusCopy.accent,
              borderRadius: 16,
            }}>
              <Text style={{ color: statusCopy.accent, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                Verification Status
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 11, lineHeight: 16 }}>
                {processingError || `Session ${verificationSessionId} was processed by the backend.`}
              </Text>
            </View>
          )}

          <View style={{
            width: '100%', backgroundColor: '#161C2C', borderWidth: 1, borderColor: '#2B3552',
            borderRadius: 24, padding: 24, marginBottom: 32,
          }}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingBottom: 8 }}>
              Secure KYC Register Record
            </Text>

            <View style={{ gap: 16 }}>
              {firstName || lastName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>Full Legal Name</Text>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{[firstName, lastName].filter(Boolean).join(' ')}</Text>
                </View>
              ) : null}

              {idNumber ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>National ID Number</Text>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 1 }}>{idNumber}</Text>
                </View>
              ) : null}

              {country ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>Issuing Country</Text>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{country}</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>Selfie Capture</Text>
                <Text style={{ color: statusCopy.accent, fontSize: 11, fontWeight: 'bold' }}>
                  {verificationStatus === 'verified' ? 'Submitted with verified session' : 'Submitted for review'}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ width: '100%', gap: 12, marginBottom: 16 }}>
            <Text style={{ color: '#64748b', fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, paddingLeft: 4 }}>
              Unlocked Capabilities
            </Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.3)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.3)', borderRadius: 16 }}>
              <Text style={{ fontSize: 20, marginRight: 12 }}>🚘</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 11, marginBottom: 2 }}>Post Unlimited Marketplace Listings</Text>
                <Text style={{ color: '#64748b', fontSize: 10 }}>Verified seller labels appear only after backend approval</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.3)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.3)', borderRadius: 16 }}>
              <Text style={{ fontSize: 20, marginRight: 12 }}>💼</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 11, marginBottom: 2 }}>SafePay Escrow Integration</Text>
                <Text style={{ color: '#64748b', fontSize: 10 }}>Escrow access remains subject to backend eligibility checks</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 32 }}>
          <TouchableOpacity
            onPress={handleFinish}
            activeOpacity={0.8}
            style={{ width: '100%', height: 56, backgroundColor: '#2563eb', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Enter CarUp Marketplace</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
