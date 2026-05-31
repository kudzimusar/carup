import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator, Image } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { captureSelfiePhoto, formatFileSize, type CapturedAsset } from '../../../utils/camera';

const { width } = Dimensions.get('window');

export default function SelfieCapture() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
    capturedFront: string;
    capturedBack?: string;
  }>();

  const [capturedAsset, setCapturedAsset] = useState<CapturedAsset | null>(null);
  const [isFaceAligned, setIsFaceAligned] = useState<boolean>(false);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Tap the shutter to take a selfie');

  /**
   * Launch the native front-facing camera for selfie capture.
   * Uses expo-image-picker with front camera, 1:1 aspect, and 0.8 quality.
   */
  const handleCapture = useCallback(async () => {
    if (capturing) return;

    setCapturing(true);
    setStatusText('Launching front camera...');

    try {
      const asset = await captureSelfiePhoto();

      if (!asset) {
        setCapturing(false);
        setStatusText('Capture cancelled. Tap shutter to retry.');
        return;
      }

      setCapturedAsset(asset);
      setIsFaceAligned(true);
      setStatusText(`Selfie Captured! ${formatFileSize(asset.fileSizeBytes)}`);

      // Brief preview delay before navigating to liveness
      setTimeout(() => {
        setCapturing(false);
        router.push({
          pathname: '/(auth)/verification/liveness',
          params: {
            ...params,
            capturedSelfie: asset.dataUri
          }
        });
      }, 1200);

    } catch (err) {
      console.error('[SelfieCapture] Camera error:', err);
      setCapturing(false);
      setStatusText('Camera error. Please try again.');
    }
  }, [capturing, params, router]);

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <View className="flex-1 justify-between p-6">
        
        {/* Top Header */}
        <View className="flex-row items-center justify-between z-10">
          <TouchableOpacity 
            onPress={() => router.back()}
            className="w-10 h-10 bg-[#161C2C]/80 border border-[#2B3552] rounded-xl items-center justify-center"
          >
            <Text className="text-white text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-slate-400 font-semibold text-xs tracking-widest uppercase">Step 5 of 9: SELFIE</Text>
        </View>

        {/* Viewfinder with Oval Cutout Mask */}
        <View className="flex-1 justify-center items-center my-6 relative">
          
          {/* Oval Guidance Mask */}
          <View 
            style={{ width: width * 0.7, height: width * 0.7 * 1.35 }}
            className={`border-4 rounded-full relative items-center justify-center overflow-hidden bg-slate-900/10 ${
              isFaceAligned 
                ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20' 
                : 'border-dashed border-blue-500'
            }`}
          >
            {/* Show captured selfie preview if available */}
            {capturedAsset ? (
              <Image
                source={{ uri: capturedAsset.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : capturing ? (
              <ActivityIndicator size="large" color="#10B981" />
            ) : (
              <Text className="text-slate-500 text-xs uppercase tracking-widest text-center px-6">
                Align face inside oval
              </Text>
            )}

            {/* Subtle alignment borders */}
            <View className="absolute top-8 left-12 w-4 h-4 border-t-2 border-l-2 border-blue-400 opacity-60" />
            <View className="absolute top-8 right-12 w-4 h-4 border-t-2 border-r-2 border-blue-400 opacity-60" />
          </View>

          {/* Tips Overlay */}
          <View className="absolute bottom-2 bg-slate-950/80 px-4 py-2 border border-slate-800 rounded-full">
            <Text className="text-slate-400 text-[10px] text-center">
              Remove glasses • Keep a neutral expression
            </Text>
          </View>
        </View>

        {/* Shutter controls */}
        <View className="space-y-4">
          <View className="items-center">
            <Text className={`text-sm font-semibold text-center ${
              capturedAsset ? 'text-emerald-400' : 'text-slate-300'
            }`}>
              {statusText}
            </Text>
            {capturedAsset && (
              <Text className="text-emerald-500 text-xs mt-1">
                {capturedAsset.width}×{capturedAsset.height}px • {capturedAsset.mimeType}
              </Text>
            )}
          </View>

          <View className="flex-row items-center justify-center">
            <TouchableOpacity
              onPress={handleCapture}
              disabled={capturing}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-800 items-center justify-center active:scale-95 transition-all shadow-xl"
            >
              <View className={`w-11 h-11 rounded-full ${capturing ? 'bg-amber-500' : 'bg-blue-600'}`} />
            </TouchableOpacity>
          </View>

          <Text className="text-xs text-slate-500 text-center leading-relaxed">
            Automatic portrait scanning is highly optimized for fast verification, even under low Zimbabwean connectivity conditions.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
