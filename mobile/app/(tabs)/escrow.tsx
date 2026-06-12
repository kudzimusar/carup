import React from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';

interface EscrowTransaction {
  id: string;
  vin: string;
  status: 'Pending' | 'Escrowed' | 'Inspecting' | 'Completed' | 'Disputed';
  current_stage: string;
  amount: number;
  currency: string;
  feeEscrow: number;
  feeZimra: number;
  vehicle: string;
  buyer_name: string;
  seller_name: string;
  created_at: string;
}

export default function EscrowDashboardScreen() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  // Fetch escrow listings
  const { data: escrows = [], isLoading, error, refetch } = useQuery<EscrowTransaction[]>({
    queryKey: ['escrows'],
    queryFn: async () => {
      const response = await fetch('http://localhost:5001/api/safepay/list', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to retrieve escrows');
      }
      return response.json();
    },
  });

  // Advance escrow milestones mutation
  const updateEscrowMutation = useMutation({
    mutationFn: async ({ id, status, details }: { id: string; status: string; details?: string }) => {
      const response = await fetch(`http://localhost:5001/api/safepay/${id}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
        body: JSON.stringify({ status, details }),
      });
      if (!response.ok) {
        throw new Error('Failed to update escrow state');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escrows'] });
    },
  });

  const handleAdvanceState = (item: EscrowTransaction) => {
    let nextState = '';
    let details = '';

    if (item.status === 'Pending') {
      nextState = 'Escrowed';
      details = 'Funds successfully deposited into secure digital trust account.';
    } else if (item.status === 'Escrowed') {
      nextState = 'Inspecting';
      details = 'Ecosystem inspector dispatched to verify mechanical safety check.';
    } else if (item.status === 'Inspecting') {
      nextState = 'Completed';
      details = 'Inspector signed off. Escrow funds disbursed, ledger title transferred.';
    }

    if (nextState) {
      updateEscrowMutation.mutate({ id: item.id, status: nextState, details });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      case 'Inspecting': return 'text-blue-600 bg-blue-50 border-blue-100';
      case 'Escrowed': return 'text-purple-600 bg-purple-50 border-purple-100';
      case 'Pending': return 'text-amber-600 bg-amber-50 border-amber-100';
      default: return 'text-rose-600 bg-rose-50 border-rose-100';
    }
  };

  const getStageStepNumber = (status: string) => {
    switch (status) {
      case 'Pending': return 1;
      case 'Escrowed': return 2;
      case 'Inspecting': return 3;
      case 'Completed': return 4;
      default: return 0;
    }
  };

  const renderTimelineProgress = (status: string) => {
    const currentStep = getStageStepNumber(status);
    const steps = ['Pending', 'Escrowed', 'Inspecting', 'Done'];

    return (
      <View className="flex-row items-center justify-between mt-4 mb-2">
        {steps.map((step, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum <= currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <React.Fragment key={step}>
              {/* Node */}
              <View className="items-center flex-1">
                <View 
                  className={`w-7 h-7 rounded-full items-center justify-center border ${
                    isCurrent 
                      ? 'bg-orange-500 border-orange-600' 
                      : isActive 
                      ? 'bg-slate-900 border-slate-900' 
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <Text className={`text-xxs font-bold ${isActive ? 'text-white' : 'text-slate-400'}`}>
                    {stepNum}
                  </Text>
                </View>
                <Text className={`text-xxs mt-1 font-semibold ${isCurrent ? 'text-orange-500' : 'text-slate-500'}`}>
                  {step}
                </Text>
              </View>

              {/* Connector line */}
              {idx < steps.length - 1 && (
                <View className={`h-0.5 flex-1 mx-1 ${idx + 1 < currentStep ? 'bg-slate-900' : 'bg-slate-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  const renderEscrowCard = ({ item }: { item: EscrowTransaction }) => {
    const isBuyer = item.buyer_name === user?.name;
    const canAdvance = item.status !== 'Completed' && item.status !== 'Disputed';

    return (
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-5 shadow-sm">
        {/* Header Block */}
        <View className="flex-row justify-between items-start">
          <View className="flex-1 pr-4">
            <Text className="text-slate-400 text-xxs tracking-wider font-semibold uppercase">Tx: {item.id.slice(0, 8)}</Text>
            <Text className="text-slate-900 text-lg font-bold mt-0.5">{item.vehicle}</Text>
          </View>
          <View className={`px-2.5 py-1 rounded-full border ${getStatusColor(item.status)}`}>
            <Text className="text-xxs font-extrabold uppercase tracking-wider">{item.status}</Text>
          </View>
        </View>

        {/* Dynamic Milestone Timeline */}
        {renderTimelineProgress(item.status)}

        {/* Transaction details panel */}
        <View className="bg-slate-50 rounded-xl p-3.5 mt-3 space-y-2">
          <View className="flex-row justify-between items-center">
            <Text className="text-slate-400 text-xxs font-semibold">Buyer Partner</Text>
            <Text className="text-slate-700 text-xs font-bold">{item.buyer_name} {isBuyer ? '(You)' : ''}</Text>
          </View>
          <View className="flex-row justify-between items-center mt-1.5">
            <Text className="text-slate-400 text-xxs font-semibold">Seller Partner</Text>
            <Text className="text-slate-700 text-xs font-bold">{item.seller_name} {!isBuyer ? '(You)' : ''}</Text>
          </View>
          <View className="flex-row justify-between items-center mt-1.5">
            <Text className="text-slate-400 text-xxs font-semibold">SafePay Escrow Split</Text>
            <Text className="text-slate-700 text-xs font-bold">${item.feeEscrow.toLocaleString()} USD</Text>
          </View>
          <View className="flex-row justify-between items-center mt-1.5">
            <Text className="text-slate-400 text-xxs font-semibold">ZIMRA Customs Levy</Text>
            <Text className="text-slate-700 text-xs font-bold">${item.feeZimra.toLocaleString()} USD</Text>
          </View>
        </View>

        {/* Bottom checkout actions */}
        <View className="flex-row justify-between items-center mt-5 pt-4 border-t border-slate-100">
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-wider">Total Contract</Text>
            <Text className="text-slate-900 text-xl font-black mt-0.5">
              ${item.amount.toLocaleString()} {item.currency}
            </Text>
          </View>

          {canAdvance && (
            <Pressable
              onPress={() => handleAdvanceState(item)}
              disabled={updateEscrowMutation.isPending}
              className="bg-slate-900 px-5 py-2.5 rounded-xl min-h-[44px] flex-row items-center justify-center active:opacity-90"
              style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
            >
              {updateEscrowMutation.isPending ? (
                <ActivityIndicator size="small" color="#ffffff" className="mr-2" />
              ) : null}
              <Text className="text-white text-xs font-bold">
                {item.status === 'Pending' ? 'Establish Escrow' : item.status === 'Escrowed' ? 'Initiate Inspection' : 'Release Funds'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const totalVolume = escrows.reduce((acc: number, curr: EscrowTransaction) => acc + curr.amount, 0);
  const activeCount = escrows.filter((e: EscrowTransaction) => e.status !== 'Completed').length;

  return (
    <View className="flex-1 bg-slate-50">
      {/* Stats Board Banner */}
      <View className="bg-slate-900 px-6 py-6 border-b border-slate-800">
        <View className="flex-row justify-between items-center">
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-widest font-semibold">Transacted Volume</Text>
            <Text className="text-white text-3xl font-extrabold mt-0.5">${totalVolume.toLocaleString()} USD</Text>
          </View>
          
          <View className="bg-orange-500/10 border border-orange-500/20 px-3.5 py-1.5 rounded-xl">
            <Text className="text-orange-500 text-xxs font-bold uppercase tracking-wider">{activeCount} In-Flight</Text>
          </View>
        </View>
      </View>

      {/* Main List */}
      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center px-6">
          <View className="bg-red-50 p-4 rounded-full mb-4">
            <Text className="text-red-500 text-3xl">⚠️</Text>
          </View>
          <Text className="text-slate-800 text-lg font-bold text-center mb-2">Unable to load data</Text>
          <Text className="text-slate-500 text-sm text-center mb-8">We could not reach the server. Please check your connection and try again.</Text>
          <Pressable onPress={() => refetch()} className="bg-slate-900 px-8 py-3.5 min-h-[48px] rounded-xl active:opacity-90">
            <Text className="text-white text-sm font-semibold">Retry Fetch</Text>
          </Pressable>
        </View>
      ) : escrows.length === 0 ? (
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-slate-400 text-sm font-medium text-center">No active SafePay escrow contracts found.</Text>
          <Text className="text-slate-400 text-xxs mt-2 text-center leading-relaxed">
            Create an escrow securely from the Vehicle Detail page inside the Marketplace tab.
          </Text>
        </View>
      ) : (
        <FlatList
          data={escrows}
          renderItem={renderEscrowCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#f97316" />
          }
        />
      )}
    </View>
  );
}
