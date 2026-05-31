import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

interface Vehicle {
  vin: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: string;
  mileage: number;
  trust_score: number;
  status: string;
}

export default function MarketplaceScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const [search, setSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState<string | null>(null);

  // Fetch marketplace available vehicles
  const { data: vehicles = [], isLoading, error, refetch } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', selectedMake],
    queryFn: async () => {
      const makeQuery = selectedMake ? `?make=${selectedMake}` : '';
      const response = await fetch(`http://localhost:5001/api/vehicles${makeQuery}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to retrieve listings');
      }
      return response.json();
    },
  });

  const filteredVehicles = vehicles.filter((v: Vehicle) => 
    v.make.toLowerCase().includes(search.toLowerCase()) ||
    v.model.toLowerCase().includes(search.toLowerCase()) ||
    v.vin.toLowerCase().includes(search.toLowerCase())
  );

  const renderVehicleCard = ({ item }: { item: Vehicle }) => {
    return (
      <Pressable
        onPress={() => router.push(`/vehicle/${item.vin}`)}
        className="bg-white border border-slate-100 rounded-2xl p-4 mb-4 shadow-sm active:opacity-90"
        style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
      >
        <View className="flex-row justify-between items-start">
          <View>
            <Text className="text-slate-900 text-lg font-bold">{item.make} {item.model}</Text>
            <Text className="text-slate-400 text-xs mt-0.5">{item.year} • {item.mileage.toLocaleString()} km</Text>
          </View>
          
          <View className="bg-orange-500/10 px-2.5 py-1 rounded-full border border-orange-500/20">
            <Text className="text-orange-500 text-xs font-bold">{item.trust_score} Trust</Text>
          </View>
        </View>

        {/* Horizontal separator line */}
        <View className="h-px bg-slate-100 my-3" />

        <View className="flex-row justify-between items-center">
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-wider">Market Price</Text>
            <Text className="text-slate-900 text-xl font-extrabold mt-0.5">
              {item.currency === 'USD' ? '$' : ''}{item.price.toLocaleString()} {item.currency !== 'USD' ? item.currency : ''}
            </Text>
          </View>

          <View className="bg-slate-900 px-4 py-2 rounded-xl">
            <Text className="text-white text-xs font-semibold">Inspect Passport</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-slate-50 px-6 pt-6">
      {/* Search Header */}
      <View className="mb-6">
        <TextInput
          className="bg-white border border-slate-200 text-slate-900 p-4 rounded-xl text-sm h-12 shadow-xxs"
          placeholder="Search by make, model, or VIN..."
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        
        {/* Horizontal filters filter buttons */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mt-3 gap-2">
          <Pressable 
            onPress={() => setSelectedMake(null)}
            className={`px-4 py-1.5 rounded-full border ${selectedMake === null ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-200'}`}
          >
            <Text className={`text-xs font-medium ${selectedMake === null ? 'text-white' : 'text-slate-600'}`}>All Makes</Text>
          </Pressable>
          {['Toyota', 'Mercedes-Benz', 'Mazda'].map((make) => (
            <Pressable 
              key={make}
              onPress={() => setSelectedMake(make)}
              className={`px-4 py-1.5 rounded-full border ml-1.5 ${selectedMake === make ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-200'}`}
            >
              <Text className={`text-xs font-medium ${selectedMake === make ? 'text-white' : 'text-slate-600'}`}>{make}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Main FlashList */}
      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-red-500 text-sm font-semibold mb-4">Error loading vehicle listings</Text>
          <Pressable onPress={() => refetch()} className="bg-slate-900 px-4 py-2.5 rounded-xl">
            <Text className="text-white text-xs font-semibold">Retry Fetch</Text>
          </Pressable>
        </View>
      ) : filteredVehicles.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-slate-400 text-sm font-medium">No matching listings found.</Text>
        </View>
      ) : (
        <View className="flex-1" style={{ minHeight: 2 }}>
          <FlashList
            data={filteredVehicles}
            renderItem={renderVehicleCard}
            estimatedItemSize={150}
            showsVerticalScrollIndicator={false}
            onRefresh={refetch}
            refreshing={isLoading}
          />
        </View>
      )}
    </View>
  );
}
