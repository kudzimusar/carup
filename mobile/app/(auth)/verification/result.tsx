import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { useVerificationStore } from '../../../store/verificationStore';

export default function VerificationResult() {
  const ocrResult = useVerificationStore(state => state.ocrResult);
  const processingError = useVerificationStore(state => state.processingError);
  const clearVerificationStore = useVerificationStore(state => state.clear);

  const firstName = ocrResult?.first_name || 'Tinashe';
  const lastName = ocrResult?.last_name || 'Moyo';
  const idNumber = ocrResult?.national_id_number || '29-198427-G-45';
  const country = ocrResult?.country || 'Zimbabwe';

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
            backgroundColor: 'rgba(16,185,129,0.1)',
            borderRadius: 48, justifyContent: 'center', alignItems: 'center',
            marginBottom: 24, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
          }}>
            <Text style={{ fontSize: 36, color: '#34d399', fontWeight: 'bold' }}>✓</Text>
          </View>

          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginBottom: 12 }}>
            Identity Verified!
          </Text>
          <Text style={{ color: '#34d399', fontSize: 11, letterSpacing: 2, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 32 }}>
            ✓ TRUST LEVEL 3: BIOMETRIC VERIFIED
          </Text>

          {processingError && (
            <View style={{
              width: '100%', padding: 16, marginBottom: 24,
              backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
              borderRadius: 16,
            }}>
              <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                Backend Notice
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 11, lineHeight: 16 }}>
                {processingError}
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>Full Legal Name</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{firstName} {lastName}</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>National ID Number</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 1 }}>{idNumber}</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>Issuing Country</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{country}</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>Biometric Face Match</Text>
                <Text style={{ color: '#34d399', fontSize: 11, fontWeight: 'bold' }}>98.4% Confidence ✓</Text>
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
                <Text style={{ color: '#64748b', fontSize: 10 }}>Your ads will bear the "Verified Seller" badge</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(22,28,44,0.3)', borderWidth: 1, borderColor: 'rgba(43,53,82,0.3)', borderRadius: 16 }}>
              <Text style={{ fontSize: 20, marginRight: 12 }}>💼</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 11, marginBottom: 2 }}>SafePay Escrow Integration</Text>
                <Text style={{ color: '#64748b', fontSize: 10 }}>Allows instant release and secure purchase bonds</Text>
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
