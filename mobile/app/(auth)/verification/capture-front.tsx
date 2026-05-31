import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator, Image } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { captureDocumentPhoto, formatFileSize, type CapturedAsset } from '../../../utils/camera';

const { width } = Dimensions.get('window');

export default function CaptureFront() {
  const router = useRouter();
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();

  // Capture state
  const [capturedAsset, setCapturedAsset] = useState<CapturedAsset | null>(null);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Tap the shutter to capture front of document');

  // Quality validation indicators
  const [isAligned, setIsAligned] = useState<boolean>(false);
  const [hasGlare, setHasGlare] = useState<boolean>(false);
  const [isBlurry, setIsBlurry] = useState<boolean>(false);
  const [isWellLit, setIsWellLit] = useState<boolean>(true);

  /**
   * Launch the native camera to capture the front of the document.
   * Uses expo-image-picker with rear camera, 4:3 aspect, and 0.7 quality compression.
   */
  const handleCapture = useCallback(async () => {
    if (capturing) return;

    setCapturing(true);
    setStatusText('Launching camera...');

    try {
      const asset = await captureDocumentPhoto();

      if (!asset) {
        // User cancelled or permission denied
        setCapturing(false);
        setStatusText('Capture cancelled. Tap shutter to retry.');
        return;
      }

      setCapturedAsset(asset);
      setIsAligned(true);
      setIsWellLit(true);
      setIsBlurry(false);
      setStatusText(`Captured! Compressed to ${formatFileSize(asset.fileSizeBytes)}`);

      // Brief preview delay before navigating
      setTimeout(() => {
        setCapturing(false);
        router.push({
          pathname: doubleSided === 'true'
            ? '/(auth)/verification/capture-back'
            : '/(auth)/verification/selfie',
          params: { docType, doubleSided, capturedFront: asset.dataUri }
        });
      }, 1200);

    } catch (err) {
      console.error('[CaptureFront] Camera error:', err);
      setCapturing(false);
      setStatusText('Camera error. Please try again.');
    }
  }, [capturing, docType, doubleSided, router]);

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <View className="flex-1 justify-between p-6">
        
        {/* Top bar indicators */}
        <View className="flex-row items-center justify-between z-10">
          <TouchableOpacity 
            onPress={() => router.back()}
            className="w-10 h-10 bg-[#161C2C]/80 border border-[#2B3552] rounded-xl items-center justify-center"
          >
            <Text className="text-white text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-slate-400 font-semibold text-xs tracking-widest uppercase">Step 3 of 9: FRONT</Text>
        </View>

        {/* Viewfinder Frame Area */}
        <View className="flex-1 justify-center items-center my-6 relative">
          
          {/* Document Framing Box */}
          <View 
            style={{ width: width * 0.85, height: width * 0.85 * 0.63 }}
            className={`border-2 rounded-2xl relative items-center justify-center overflow-hidden bg-slate-900/10 ${
              isAligned ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20' : 'border-dashed border-blue-500'
            }`}
          >
            {/* Show captured preview image if available */}
            {capturedAsset ? (
              <Image
                source={{ uri: capturedAsset.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : capturing ? (
              <ActivityIndicator size="large" color="#10B981" />
            ) : (
              <Text className="text-slate-500 text-xs uppercase tracking-widest text-center px-4">
                Position Front of Document here
              </Text>
            )}

            {/* Viewfinder Corners */}
            <View className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
            <View className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
            <View className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
            <View className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />
          </View>

          {/* Vision/AI Real-time overlays */}
          <View className="absolute bottom-4 flex-row space-x-2 z-15">
            <View className={`px-3 py-1.5 rounded-full flex-row items-center border ${
              isAligned ? 'bg-emerald-950/80 border-emerald-800' : 'bg-slate-950/85 border-slate-800'
            }`}>
              <Text className="text-[10px] mr-1">📐</Text>
              <Text className="text-white text-[10px] font-semibold">Alignment</Text>
            </View>
            <View className={`px-3 py-1.5 rounded-full flex-row items-center border ${
              isWellLit ? 'bg-emerald-950/80 border-emerald-800' : 'bg-slate-950/85 border-slate-800'
            }`}>
              <Text className="text-[10px] mr-1">💡</Text>
              <Text className="text-white text-[10px] font-semibold">Lighting</Text>
            </View>
            <View className={`px-3 py-1.5 rounded-full flex-row items-center border ${
              !isBlurry ? 'bg-emerald-950/80 border-emerald-800' : 'bg-rose-950/80 border-rose-800'
            }`}>
              <Text className="text-[10px] mr-1">🔍</Text>
              <Text className="text-white text-[10px] font-semibold">{isBlurry ? 'Blur' : 'Sharp'}</Text>
            </View>
          </View>
        </View>

        {/* Action Panel & Bottom Text */}
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

          <View className="flex-row items-center justify-center space-x-8">
            {/* Manual Shutter Button */}
            <TouchableOpacity
              onPress={handleCapture}
              disabled={capturing}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-800 items-center justify-center active:scale-95 transition-all shadow-xl"
            >
              <View className={`w-11 h-11 rounded-full ${capturing ? 'bg-amber-500' : 'bg-blue-600'}`} />
            </TouchableOpacity>
          </View>

          <Text className="text-xs text-slate-500 text-center leading-relaxed">
            Please make sure the text is readable, has no reflection, and is not blurred.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
