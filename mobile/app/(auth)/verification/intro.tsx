import React from 'react';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router } from 'expo-router';

const benefitCardStyle = {
  flexDirection: 'row' as const,
  alignItems: 'flex-start' as const,
  padding: 16,
  backgroundColor: 'rgba(22, 28, 44, 0.5)',
  borderWidth: 1,
  borderColor: 'rgba(43, 53, 82, 0.4)',
  borderRadius: 16,
};

const benefitIconStyle = {
  width: 40,
  height: 40,
  borderRadius: 12,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  marginRight: 16,
  borderWidth: 1,
};

const benefitTitleStyle = {
  color: '#FFFFFF',
  fontWeight: '600' as const,
  fontSize: 14,
  marginBottom: 4,
};

const benefitBodyStyle = {
  color: '#94A3B8',
  fontSize: 12,
  lineHeight: 19,
};

function VerificationIntro() {

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0E1A' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>

        {/* Header & Title */}
        <View style={{ marginTop: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                width: 40,
                height: 40,
                backgroundColor: '#161C2C',
                borderWidth: 1,
                borderColor: '#2B3552',
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 18 }}>←</Text>
            </TouchableOpacity>
            <Text style={{ color: '#64748B', fontWeight: '600', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Step 1 of 9
            </Text>
          </View>

          <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16, lineHeight: 38 }}>
            Trust & Identity Verification
          </Text>
          <Text style={{ color: '#94A3B8', fontSize: 14, lineHeight: 22, marginBottom: 32 }}>
            To prevent fraud and enable features like CBZ SafePay Escrow, vehicle listings, and automatic ownership transfer, we need to verify your physical identity.
          </Text>

          {/* Benefits Grid */}
          <View>
            <View style={benefitCardStyle}>
              <View style={[benefitIconStyle, { backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Text style={{ color: '#3B82F6', fontWeight: '700' }}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={benefitTitleStyle}>List & Sell Vehicles</Text>
                <Text style={benefitBodyStyle}>
                  Only verified owners and dealerships can post vehicle listings onto the CarUp network.
                </Text>
              </View>
            </View>

            <View style={[benefitCardStyle, { marginTop: 16 }]}>
              <View style={[benefitIconStyle, { backgroundColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.2)' }]}>
                <Text style={{ color: '#22C55E', fontWeight: '700' }}>$</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={benefitTitleStyle}>Escrow & Financing Ready</Text>
                <Text style={benefitBodyStyle}>
                  Unlock access to direct secure bank transfers and CBZ pre-approval loans.
                </Text>
              </View>
            </View>

            <View style={[benefitCardStyle, { marginTop: 16 }]}>
              <View style={[benefitIconStyle, { backgroundColor: 'rgba(99, 102, 241, 0.1)', borderColor: 'rgba(99, 102, 241, 0.2)' }]}>
                <Text style={{ color: '#6366F1', fontWeight: '700' }}>🔒</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={benefitTitleStyle}>Secure & Compliant</Text>
                <Text style={benefitBodyStyle}>
                  Your document images are fully encrypted locally before being transmitted via secure channels.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Button & Time Estimate */}
        <View style={{ marginTop: 32 }}>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '500' }}>
              Requires National ID, Passport or License • Takes ~2 mins
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/verification/document-select')}
            activeOpacity={0.8}
            testID="start-identity-verification"
            style={{
              width: '100%',
              height: 56,
              backgroundColor: '#2563EB',
              borderRadius: 16,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 16 }}>Start Identity Verification</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ENTRY PREFLIGHT (device Gate 2 round 3): a terminally-rejected applicant is
// stopped BEFORE this screen mounts — including deep links — so no document
// selection or camera capture is possible until a reviewer reopens the case.
export default function GuardedVerificationIntro(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <VerificationIntro />
    </VerificationEntryGuard>
  );
}
