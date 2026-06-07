import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Image, InteractionManager, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { captureSelfiePhoto, formatFileSize, type CapturedAsset } from '../../../utils/camera';
import { useVerificationStore } from '../../../store/verificationStore';

const { width } = Dimensions.get('window');

export default function SelfieCapture() {
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
  }>();

  const setCapturedSelfie = useVerificationStore(state => state.setCapturedSelfie);
  const [capturedAsset, setCapturedAsset] = useState<CapturedAsset | null>(null);
  const [isFaceAligned, setIsFaceAligned] = useState<boolean>(false);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Tap the shutter to take a selfie');

  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleCapture = useCallback(async () => {
    if (capturing) return;

    setCapturing(true);
    setStatusText('Launching front camera...');

    try {
      const asset = await captureSelfiePhoto();

      if (!asset) {
        if (mountedRef.current) {
          setCapturing(false);
          setStatusText('Capture cancelled. Tap shutter to retry.');
        }
        return;
      }

      setCapturedAsset(asset);
      setCapturedSelfie(asset.dataUri);
      setIsFaceAligned(true);
      setStatusText(`Selfie Captured! ${formatFileSize(asset.fileSizeBytes)}`);

      InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        setCapturing(false);
        router.push({
          pathname: '/(auth)/verification/liveness',
          params,
        });
      });
    } catch (err) {
      console.error('[SelfieCapture] Camera error:', err);
      if (mountedRef.current) {
        setCapturing(false);
        setStatusText('Camera error. Please try again.');
      }
    }
  }, [capturing, params, setCapturedSelfie]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>

        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>Step 5 of 9: SELFIE</Text>
        </View>

        <View style={styles.viewfinderArea}>
          <View 
            style={[
              styles.ovalFrame,
              { width: width * 0.7, height: width * 0.7 * 1.35 },
              isFaceAligned ? styles.frameAligned : styles.frameDefault,
            ]}
          >
            {capturedAsset ? (
              <Image
                source={{ uri: capturedAsset.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : capturing ? (
              <ActivityIndicator size="large" color="#10B981" />
            ) : (
              <Text style={styles.placeholderText}>
                Align face inside oval
              </Text>
            )}

            <View style={[styles.alignCorner, { top: 32, left: 48 }]} />
            <View style={[styles.alignCorner, { top: 32, right: 48 }]} />
          </View>

          <View style={styles.tipBadge}>
            <Text style={styles.tipText}>
              Remove glasses - Keep a neutral expression
            </Text>
          </View>
        </View>

        <View style={styles.actionPanel}>
          <View style={styles.statusContainer}>
            <Text style={[styles.statusText, capturedAsset ? styles.statusOk : styles.statusNeutral]}>
              {statusText}
            </Text>
            {capturedAsset && (
              <Text style={styles.assetInfo}>
                {capturedAsset.width}x{capturedAsset.height}px - {capturedAsset.mimeType}
              </Text>
            )}
          </View>

          <View style={styles.shutterRow}>
            <TouchableOpacity
              onPress={handleCapture}
              disabled={capturing}
              style={styles.shutterButton}
            >
              <View style={[styles.shutterInner, capturing ? styles.shutterActive : styles.shutterReady]} />
            </TouchableOpacity>
          </View>

          <Text style={styles.helpText}>
            Automatic portrait scanning is highly optimized for fast verification.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0E1A' },
  container: { flex: 1, justifyContent: 'space-between', padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  backButton: {
    width: 40, height: 40,
    backgroundColor: 'rgba(22,28,44,0.8)',
    borderWidth: 1, borderColor: '#2B3552',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { color: '#fff', fontSize: 18 },
  stepLabel: { color: '#94a3b8', fontWeight: '600', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' },
  viewfinderArea: { flex: 1, justifyContent: 'center', alignItems: 'center', marginVertical: 24 },
  ovalFrame: {
    borderWidth: 4, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  frameDefault: { borderColor: '#3b82f6', borderStyle: 'dashed', backgroundColor: 'rgba(15,23,42,0.1)' },
  frameAligned: { borderColor: '#10b981', backgroundColor: 'rgba(15,23,42,0.1)' },
  placeholderText: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center', paddingHorizontal: 24 },
  alignCorner: { position: 'absolute', width: 16, height: 16, borderTopWidth: 2, borderLeftWidth: 2, borderColor: '#60a5fa', opacity: 0.6 },
  tipBadge: {
    position: 'absolute', bottom: 8,
    backgroundColor: 'rgba(2,6,23,0.8)', paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1e293b', borderRadius: 20,
  },
  tipText: { color: '#94a3b8', fontSize: 10, textAlign: 'center' },
  actionPanel: { gap: 16 },
  statusContainer: { alignItems: 'center' },
  statusText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  statusOk: { color: '#34d399' },
  statusNeutral: { color: '#cbd5e1' },
  assetInfo: { color: '#10b981', fontSize: 11, marginTop: 4 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  shutterButton: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#fff', borderWidth: 4, borderColor: '#1e293b',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 44, height: 44, borderRadius: 22 },
  shutterActive: { backgroundColor: '#f59e0b' },
  shutterReady: { backgroundColor: '#2563eb' },
  helpText: { fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 16 },
});
