import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator, Image } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { captureDocumentPhoto, formatFileSize, type CapturedAsset } from '../../../utils/camera';

const { width } = Dimensions.get('window');

export default function CaptureBack() {
  const router = useRouter();
  const { docType, doubleSided, capturedFront } = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
    capturedFront: string;
  }>();

  const [capturedAsset, setCapturedAsset] = useState<CapturedAsset | null>(null);
  const [isAligned, setIsAligned] = useState<boolean>(false);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Tap the shutter to capture back of document');

  /**
   * Launch the native camera to capture the back side of the document.
   * Uses expo-image-picker with rear camera, 4:3 aspect, and 0.7 quality compression.
   */
  const handleCapture = useCallback(async () => {
    if (capturing) return;

    setCapturing(true);
    setStatusText('Launching camera...');

    try {
      const asset = await captureDocumentPhoto();

      if (!asset) {
        setCapturing(false);
        setStatusText('Capture cancelled. Tap shutter to retry.');
        return;
      }

      setCapturedAsset(asset);
      setIsAligned(true);
      setStatusText(`Captured back! Compressed to ${formatFileSize(asset.fileSizeBytes)}`);

      // Brief preview delay before navigating to selfie
      setTimeout(() => {
        setCapturing(false);
        router.push({
          pathname: '/(auth)/verification/selfie',
          params: {
            docType,
            doubleSided,
            capturedFront,
            capturedBack: asset.dataUri
          }
        });
      }, 1200);

    } catch (err) {
      console.error('[CaptureBack] Camera error:', err);
      setCapturing(false);
      setStatusText('Camera error. Please try again.');
    }
  }, [capturing, docType, doubleSided, capturedFront, router]);

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
          <Text className="text-slate-400 font-semibold text-xs tracking-widest uppercase">Step 4 of 9: BACK</Text>
        </View>

        {/* Viewfinder Area */}
        <View className="flex-1 justify-center items-center my-6 relative">
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
                Position Back of Document here
              </Text>
            )}

            <View className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
            <View className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
            <View className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
            <View className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />
          </View>
        </View>

        {/* Shutter Panel */}
        <View className="space-y-4">
          <View className="items-center">
            <Text className={`text-sm font-semibold text-center ${
              capturedAsset ? 'text-emerald-400' : 'text-slate-300'
            }`}>
              {statusText}
            </Text>
            {capturedAsset && (
              <Text className="text-emerald-500 text-xs mt-1">
                {capturedAsset.width}×{capturedAsset.height}px • {formatFileSize(capturedAsset.fileSizeBytes)}
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
            Ensure barcodes or back details are clean, readable, and fit within the guideline marks.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
