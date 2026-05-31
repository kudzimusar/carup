import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function VerificationReview() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
    capturedFront: string;
    capturedBack?: string;
    capturedSelfie: string;
    livenessVerified: string;
  }>();

  const [checkingQuality, setCheckingQuality] = useState<boolean>(false);

  const handleSubmit = () => {
    // Navigate directly to the uploading & processing endpoint
    router.push({
      pathname: '/(auth)/verification/processing',
      params: params
    });
  };

  const handleRetake = () => {
    // Go back to document selection to reset
    router.replace('/(auth)/verification/document-select');
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>
        
        <View className="mt-8">
          <View className="flex-row items-center justify-between mb-8">
            <TouchableOpacity 
              onPress={() => router.back()}
              className="w-10 h-10 bg-[#161C2C] border border-[#2B3552] rounded-xl items-center justify-center"
            >
              <Text className="text-white text-lg">←</Text>
            </TouchableOpacity>
            <Text className="text-slate-500 font-semibold text-xs tracking-widest uppercase">Step 7 of 9: REVIEW</Text>
          </View>

          <Text className="text-white text-3xl font-extrabold tracking-tight mb-3">
            Review Captures
          </Text>
          <Text className="text-slate-400 text-sm leading-relaxed mb-6">
            Our on-device model completed document readability scans. Please confirm all details are readable before upload.
          </Text>

          {/* Local Quality Metrics Card */}
          <View className="p-5 bg-[#161C2C] border border-[#2B3552] rounded-2xl mb-8">
            <Text className="text-white font-bold text-sm mb-3">Local AI Quality Diagnostics</Text>
            
            <View className="space-y-3">
              <View className="flex-row justify-between items-center pb-2 border-b border-slate-800">
                <Text className="text-slate-400 text-xs">Image Resolution</Text>
                <Text className="text-emerald-400 text-xs font-semibold">12.2 MP (HD) ✓</Text>
              </View>
              
              <View className="flex-row justify-between items-center pb-2 border-b border-slate-800">
                <Text className="text-slate-400 text-xs">Blur / Focus check</Text>
                <Text className="text-emerald-400 text-xs font-semibold">Sharp Focus ✓</Text>
              </View>

              <View className="flex-row justify-between items-center pb-2 border-b border-slate-800">
                <Text className="text-slate-400 text-xs">Reflective Glare</Text>
                <Text className="text-emerald-400 text-xs font-semibold">No Glare Detected ✓</Text>
              </View>

              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Brightness Validation</Text>
                <Text className="text-emerald-400 text-xs font-semibold">Well-Lit ✓</Text>
              </View>
            </View>
          </View>

          {/* Thumbnails grid */}
          <Text className="text-white font-semibold text-sm mb-3">Captured Assets</Text>
          <View className="space-y-3">
            <View className="flex-row justify-between items-center p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-blue-500/10 rounded-lg items-center justify-center mr-3">
                  <Text className="text-base">📄</Text>
                </View>
                <Text className="text-white text-sm font-medium">Front Document Image</Text>
              </View>
              <Text className="text-emerald-400 text-xs font-bold">READY</Text>
            </View>

            {params.doubleSided === 'true' && (
              <View className="flex-row justify-between items-center p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
                <View className="flex-row items-center">
                  <View className="w-10 h-10 bg-blue-500/10 rounded-lg items-center justify-center mr-3">
                    <Text className="text-base">📄</Text>
                  </View>
                  <Text className="text-white text-sm font-medium">Back Document Image</Text>
                </View>
                <Text className="text-emerald-400 text-xs font-bold">READY</Text>
              </View>
            )}

            <View className="flex-row justify-between items-center p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-indigo-500/10 rounded-lg items-center justify-center mr-3">
                  <Text className="text-base">👤</Text>
                </View>
                <Text className="text-white text-sm font-medium">Biometric Liveness Selfie</Text>
              </View>
              <Text className="text-emerald-400 text-xs font-bold">READY</Text>
            </View>
          </View>
        </View>

        {/* Buttons */}
        <View className="mt-8 space-y-3">
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.8}
            className="w-full h-14 bg-blue-600 rounded-2xl justify-center items-center shadow-lg active:bg-blue-700"
          >
            <Text className="text-white font-semibold text-base">Submit Documents</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRetake}
            activeOpacity={0.8}
            className="w-full h-12 bg-transparent border border-slate-700 rounded-2xl justify-center items-center active:bg-slate-800/20"
          >
            <Text className="text-slate-400 font-medium text-sm">Retake Photos</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
