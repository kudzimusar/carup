import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';

interface TimelineEvent {
  title: string;
  type: string;
  timestamp: string;
  description: string;
}

interface PassportData {
  vehicle: {
    vin: string;
    make: string;
    model: string;
    year: number;
    color: string;
    mileage: number;
    fuel_type: string;
    transmission: string;
    import_source: string;
    status: string;
    trust_score: number;
    price: number;
    currency: string;
    duty_paid: boolean;
    police_verified: boolean;
  };
  timeline: TimelineEvent[];
  trustReport: {
    trustScore: number;
    riskLevel: string;
    verifiedChecksCount: number;
    odometerConsistent: boolean;
    stolenChecked: boolean;
  };
  chainVerification: {
    valid: boolean;
    compromisedIndex: number | null;
    totalBlocks: number;
  };
}

export default function VehicleDetailScreen() {
  const router = useRouter();
  const { vin } = useLocalSearchParams();
  const token = useAuthStore((state) => state.token);

  // Fetch full trust passport details
  const { data, isLoading, error } = useQuery<PassportData>({
    queryKey: ['vehicle-passport', vin],
    queryFn: async () => {
      const response = await fetch(`http://localhost:5001/api/vehicles/${vin}/passport`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to retrieve vehicle passport');
      }
      return response.json();
    },
    enabled: !!vin,
  });

  const handleCreateEscrow = () => {
    // Navigate user to Phase 5 SafePay escrow checkout (or show confirmation)
    if (data?.vehicle) {
      router.push({
        pathname: '/(tabs)/marketplace', // Stub redirection for tabs, can launch direct escrow modal
      });
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-50 justify-center items-center">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="flex-1 bg-slate-50 justify-center items-center px-6">
        <Text className="text-red-500 text-sm font-semibold mb-4 text-center">
          Error retrieving vehicle trust passport details.
        </Text>
        <Pressable onPress={() => router.back()} className="bg-slate-900 px-6 py-3 rounded-xl">
          <Text className="text-white text-xs font-semibold">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const { vehicle, timeline, trustReport, chainVerification } = data;

  return (
    <View className="flex-1 bg-slate-50">
      {/* Header Back Button Navigation */}
      <View className="bg-slate-900 px-6 pt-12 pb-4 flex-row items-center justify-between">
        <Pressable onPress={() => router.back()} className="py-2 pr-4">
          <Text className="text-white text-base font-semibold">← Back</Text>
        </Pressable>
        <Text className="text-white font-bold text-base">Trust Passport</Text>
        <View className="w-10" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1 px-6 py-6">
        {/* Main Title Block */}
        <View className="mb-6">
          <Text className="text-slate-400 text-xxs uppercase font-semibold tracking-widest">
            {vehicle.vin}
          </Text>
          <Text className="text-slate-900 text-3xl font-extrabold mt-1">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Text>
          <Text className="text-slate-500 text-sm mt-1">
            {vehicle.color} • {vehicle.mileage.toLocaleString()} km • {vehicle.transmission}
          </Text>
        </View>

        {/* Dynamic Trust Score Visualizer Gauge */}
        <View className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-slate-900 text-lg font-bold">Vehicle Trust Index</Text>
            <Text className="text-slate-500 text-xs mt-1">
              Platform credibility score computed via cryptographic ledger entries and odometer integrity scans.
            </Text>
            <View className="flex-row gap-2 mt-3 flex-wrap">
              <View className="bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
                <Text className="text-emerald-600 text-xxs font-bold">
                  {chainVerification.valid ? 'Chain Validated' : 'Chain Compromised'}
                </Text>
              </View>
              <View className="bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1">
                <Text className="text-slate-600 text-xxs font-bold">Risk: {trustReport.riskLevel}</Text>
              </View>
            </View>
          </View>

          {/* Simple Radial Badge Gauge representation in Native Tailwind */}
          <View className="bg-slate-950 p-6 rounded-full w-24 h-24 items-center justify-center border-4 border-orange-500 shadow-md">
            <Text className="text-white text-xl font-extrabold">{vehicle.trust_score.toFixed(0)}</Text>
            <Text className="text-orange-500 text-xxs font-semibold uppercase tracking-wider mt-0.5">Score</Text>
          </View>
        </View>

        {/* Verification Checks Block */}
        <View className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-6">
          <Text className="text-slate-900 text-base font-bold mb-4">Ecosystem Audits</Text>
          
          <View className="space-y-4">
            {/* Odometer integrity check */}
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-4">
                <Text className="text-slate-800 text-sm font-semibold">Odometer Progression</Text>
                <Text className="text-slate-400 text-xxs mt-0.5">Sequential mileage check</Text>
              </View>
              <Text className={`text-xs font-bold ${trustReport.odometerConsistent ? 'text-emerald-600' : 'text-red-500'}`}>
                {trustReport.odometerConsistent ? 'Consistent' : 'Suspicious'}
              </Text>
            </View>

            {/* ZIMRA duty check */}
            <View className="flex-row items-center justify-between mt-3">
              <View className="flex-1 pr-4">
                <Text className="text-slate-800 text-sm font-semibold">Import Customs Duty</Text>
                <Text className="text-slate-400 text-xxs mt-0.5">ZIMRA tax clearance</Text>
              </View>
              <Text className={`text-xs font-bold ${vehicle.duty_paid ? 'text-emerald-600' : 'text-slate-500'}`}>
                {vehicle.duty_paid ? 'Paid' : 'Unconfirmed'}
              </Text>
            </View>

            {/* Police security flag */}
            <View className="flex-row items-center justify-between mt-3">
              <View className="flex-1 pr-4">
                <Text className="text-slate-800 text-sm font-semibold">Police Safety Network</Text>
                <Text className="text-slate-400 text-xxs mt-0.5">CVR / C.I.D. stolen flags check</Text>
              </View>
              <Text className={`text-xs font-bold ${vehicle.police_verified ? 'text-emerald-600' : 'text-amber-500'}`}>
                {vehicle.police_verified ? 'No Stolen Flag' : 'Under Investigation'}
              </Text>
            </View>
          </View>
        </View>

        {/* Ledger Event Timeline Section */}
        <View className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-12">
          <Text className="text-slate-900 text-base font-bold mb-4">Immutable Ledger History</Text>
          
          {timeline.length === 0 ? (
            <Text className="text-slate-400 text-xs">No ledger transactions minted yet.</Text>
          ) : (
            timeline.map((event: TimelineEvent, idx: number) => (
              <View key={idx} className="flex-row items-start mb-4 mt-2">
                {/* Visual bullet points for timeline */}
                <View className="mr-3 items-center">
                  <View className="w-2.5 h-2.5 rounded-full bg-orange-500 mt-1.5" />
                  {idx < timeline.length - 1 && <View className="w-0.5 h-12 bg-slate-200 mt-1" />}
                </View>
                
                <View className="flex-1">
                  <Text className="text-slate-900 text-sm font-bold">{event.title}</Text>
                  <Text className="text-slate-400 text-xxs mt-0.5">
                    {new Date(event.timestamp).toLocaleDateString()} at {new Date(event.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text className="text-slate-600 text-xs mt-1 leading-relaxed">{event.description}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Dynamic Checkout safe area button footer */}
      <View className="bg-white border-t border-slate-100 px-6 pt-4 pb-8 flex-row justify-between items-center shadow-md">
        <View>
          <Text className="text-slate-400 text-xxs uppercase tracking-wider">Purchase Total</Text>
          <Text className="text-slate-900 text-2xl font-extrabold mt-0.5">
            {vehicle.currency === 'USD' ? '$' : ''}{vehicle.price.toLocaleString()} {vehicle.currency !== 'USD' ? vehicle.currency : ''}
          </Text>
        </View>

        <Pressable
          onPress={handleCreateEscrow}
          className="bg-orange-500 px-8 py-3.5 rounded-xl shadow-md active:opacity-90"
        >
          <Text className="text-white text-base font-bold">Secure Purchase</Text>
        </Pressable>
      </View>
    </View>
  );
}
