import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { router } from 'expo-router';

export default function VerificationIntro() {

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}>
        
        {/* Header & Title */}
        <View className="mt-8">
          <View className="flex-row items-center justify-between mb-8">
            <TouchableOpacity 
              onPress={() => router.back()}
              className="w-10 h-10 bg-[#161C2C] border border-[#2B3552] rounded-xl items-center justify-center"
            >
              <Text className="text-white text-lg">←</Text>
            </TouchableOpacity>
            <Text className="text-slate-500 font-semibold text-xs tracking-widest uppercase">Step 1 of 9</Text>
          </View>

          <Text className="text-white text-3xl font-extrabold tracking-tight mb-4 leading-tight">
            Trust & Identity Verification
          </Text>
          <Text className="text-slate-400 text-sm leading-relaxed mb-8">
            To prevent fraud and enable features like CBZ SafePay Escrow, vehicle listings, and automatic ownership transfer, we need to verify your physical identity.
          </Text>

          {/* Benefits Grid */}
          <View className="space-y-4">
            <View className="flex-row items-start p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
              <View className="w-10 h-10 bg-blue-500/10 rounded-xl items-center justify-center mr-4 border border-blue-500/20">
                <Text className="text-blue-500 font-bold">✓</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold text-sm mb-1">List & Sell Vehicles</Text>
                <Text className="text-slate-400 text-xs leading-relaxed">
                  Only verified owners and dealerships can post vehicle listings onto the CarUp network.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
              <View className="w-10 h-10 bg-green-500/10 rounded-xl items-center justify-center mr-4 border border-green-500/20">
                <Text className="text-green-500 font-bold">$</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold text-sm mb-1">Escrow & Financing Ready</Text>
                <Text className="text-slate-400 text-xs leading-relaxed">
                  Unlock access to direct secure bank transfers and CBZ pre-approval loans.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start p-4 bg-[#161C2C]/50 border border-[#2B3552]/40 rounded-2xl">
              <View className="w-10 h-10 bg-indigo-500/10 rounded-xl items-center justify-center mr-4 border border-indigo-500/20">
                <Text className="text-indigo-500 font-bold">🔒</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold text-sm mb-1">Secure & Compliant</Text>
                <Text className="text-slate-400 text-xs leading-relaxed">
                  Your document images are fully encrypted locally before being transmitted via secure channels.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Button & Time Estimate */}
        <View className="mt-8">
          <View className="items-center mb-4">
            <Text className="text-slate-500 text-xs font-medium">
              Requires National ID, Passport or License • Takes ~2 mins
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/verification/document-select')}
            activeOpacity={0.8}
            className="w-full h-14 bg-blue-600 rounded-2xl justify-center items-center shadow-lg shadow-blue-500/25 active:bg-blue-700"
          >
            <Text className="text-white font-semibold text-base">Start Identity Verification</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
