import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';

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
    description: 'ZRP issued driving disc or card',
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
  {
    id: 'registration_book',
    title: 'Vehicle Registration Book',
    description: 'Blue-green vehicle registration logbook',
    doubleSided: false,
    icon: '📖',
  },
];

export default function DocumentSelect() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (doc: DocumentOption) => {
    setSelectedId(doc.id);
    // Move to front document capture screen, passing selection as query params
    router.push({
      pathname: '/(auth)/verification/capture-front',
      params: { docType: doc.id, doubleSided: doc.doubleSided ? 'true' : 'false' }
    });
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
            <Text className="text-slate-500 font-semibold text-xs tracking-widest uppercase">Step 2 of 9</Text>
          </View>

          <Text className="text-white text-3xl font-extrabold tracking-tight mb-3">
            Select Document
          </Text>
          <Text className="text-slate-400 text-sm leading-relaxed mb-8">
            Please choose the primary document you will capture. The document must be valid and clearly show your legal details and photo.
          </Text>

          {/* Document list */}
          <View className="space-y-4">
            {SUPPORTED_DOCUMENTS.map((doc) => {
              const isSelected = selectedId === doc.id;
              return (
                <TouchableOpacity
                  key={doc.id}
                  onPress={() => handleSelect(doc)}
                  activeOpacity={0.85}
                  className={`flex-row items-center p-5 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-blue-600/10 border-blue-500'
                      : 'bg-[#161C2C]/65 border-[#2B3552]/40 active:border-slate-700'
                  }`}
                >
                  <View className="w-12 h-12 bg-slate-800/80 rounded-xl items-center justify-center mr-4 border border-slate-700/50">
                    <Text className="text-2xl">{doc.icon}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-base mb-1">{doc.title}</Text>
                    <Text className="text-slate-400 text-xs">{doc.description}</Text>
                  </View>
                  <Text className="text-slate-500 text-lg font-bold">➔</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View className="mt-8 pt-4 items-center">
          <Text className="text-xs text-slate-500 text-center leading-relaxed">
            By continuing, you agree to allow our secure backend systems to run automated OCR extraction on the captured image.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
