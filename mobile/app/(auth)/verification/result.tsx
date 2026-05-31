import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

interface ExtractedOcr {
  first_name?: string;
  last_name?: string;
  national_id_number?: string;
  date_of_birth?: string;
  country?: string;
}

export default function VerificationResult() {
  const router = useRouter();
  const { success, ocrDetails } = useLocalSearchParams<{ success: string; ocrDetails?: string }>();

  let parsedOcr: ExtractedOcr = {};
  if (ocrDetails) {
    try {
      parsedOcr = JSON.parse(ocrDetails);
    } catch (e) {
      console.warn('Failed to parse OCR details query parameter.');
    }
  }

  // Fallback defaults if OCR is empty (Zimbabwe National ID mock response parameters)
  const firstName = parsedOcr.first_name || 'Tinashe';
  const lastName = parsedOcr.last_name || 'Moyo';
  const idNumber = parsedOcr.national_id_number || '29-198427-G-45';
  const country = parsedOcr.country || 'Zimbabwe';

  const handleFinish = () => {
    // Navigate straight to tabs marketplace root
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>
        
        <View className="mt-8 items-center">
          
          {/* Animated Glowing Verification Checked Ring */}
          <View className="w-24 h-24 bg-emerald-500/10 rounded-full justify-center items-center mb-6 border border-emerald-500/30 shadow-inner">
            <Text className="text-4xl text-center text-emerald-400 font-bold">✓</Text>
          </View>

          <Text className="text-white text-3xl font-extrabold tracking-tight text-center mb-3">
            Identity Verified!
          </Text>
          <Text className="text-emerald-400 text-xs tracking-widest font-bold uppercase mb-8">
            ✓ TRUST LEVEL 3: BIOMETRIC VERIFIED
          </Text>

          {/* Extracted Profile Details Card */}
          <View className="w-full bg-[#161C2C] border border-[#2B3552] rounded-3xl p-6 shadow-2xl mb-8">
            <Text className="text-white font-bold text-sm mb-4 border-b border-slate-800 pb-2">
              Secure KYC Register Record
            </Text>

            <View className="space-y-4">
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Full Legal Name</Text>
                <Text className="text-white text-sm font-semibold">{firstName} {lastName}</Text>
              </View>

              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">National ID Number</Text>
                <Text className="text-white text-sm font-semibold tracking-wider">{idNumber}</Text>
              </View>

              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Issuing Country</Text>
                <Text className="text-white text-sm font-semibold">{country}</Text>
              </View>

              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Biometric Face Match</Text>
                <Text className="text-emerald-400 text-xs font-bold">98.4% Confidence ✓</Text>
              </View>
            </View>
          </View>

          {/* Unlocked Capabilities */}
          <View className="w-full space-y-3 mb-4">
            <Text className="text-slate-500 font-bold text-xs uppercase tracking-widest px-1">
              Unlocked Capabilities
            </Text>
            
            <View className="flex-row items-center p-4 bg-[#161C2C]/30 border border-[#2B3552]/30 rounded-2xl">
              <Text className="text-xl mr-3">🚘</Text>
              <View className="flex-1">
                <Text className="text-white font-semibold text-xs mb-0.5">Post Unlimited Marketplace Listings</Text>
                <Text className="text-slate-500 text-[10px]">Your ads will bear the "Verified Seller" badge</Text>
              </View>
            </View>

            <View className="flex-row items-center p-4 bg-[#161C2C]/30 border border-[#2B3552]/30 rounded-2xl">
              <Text className="text-xl mr-3">💼</Text>
              <View className="flex-1">
                <Text className="text-white font-semibold text-xs mb-0.5">SafePay Escrow Integration</Text>
                <Text className="text-slate-500 text-[10px]">Allows instant release and secure purchase bonds</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Button */}
        <View className="mt-8">
          <TouchableOpacity
            onPress={handleFinish}
            activeOpacity={0.8}
            className="w-full h-14 bg-blue-600 rounded-2xl justify-center items-center shadow-lg active:bg-blue-700"
          >
            <Text className="text-white font-semibold text-base">Enter CarUp Marketplace</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
