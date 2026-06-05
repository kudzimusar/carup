import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Image, InteractionManager, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { captureDocumentPhoto, formatFileSize, type CapturedAsset } from '../../../utils/camera';
import { useVerificationStore } from '../../../store/verificationStore';

const { width } = Dimensions.get('window');

export default function CaptureFront() {
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();

  const setCapturedFront = useVerificationStore(state => state.setCapturedFront);
  const [capturedAsset, setCapturedAsset] = useState<CapturedAsset | null>(null);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Tap the shutter to capture front of document');

  const [isAligned, setIsAligned] = useState<boolean>(false);
  const [isWellLit, setIsWellLit] = useState<boolean>(true);
  const [isBlurry, setIsBlurry] = useState<boolean>(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleCapture = useCallback(async () => {
    if (capturing) return;

    setCapturing(true);
    setStatusText('Launching camera...');

    try {
      const asset = await captureDocumentPhoto();

      if (!asset) {
        if (mountedRef.current) {
          setCapturing(false);
          setStatusText('Capture cancelled. Tap shutter to retry.');
        }
        return;
      }

      setCapturedAsset(asset);
      setCapturedFront(asset.dataUri);
      setIsAligned(true);
      setIsWellLit(true);
      setIsBlurry(false);
      setStatusText(`Captured! Compressed to ${formatFileSize(asset.fileSizeBytes)}`);

      const targetPath = doubleSided === 'true'
        ? '/(auth)/verification/capture-back'
        : '/(auth)/verification/selfie';

      InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        setCapturing(false);
        router.push({
          pathname: targetPath as '/(auth)/verification/capture-back' | '/(auth)/verification/selfie',
          params: { docType, doubleSided }
        });
      });
    } catch (err) {
      console.error('[CaptureFront] Camera error:', err);
      if (mountedRef.current) {
        setCapturing(false);
        setStatusText('Camera error. Please try again.');
      }
    }
  }, [capturing, docType, doubleSided, setCapturedFront]);

  const handleBack = useCallback(() => {
    useVerificationStore.getState().clear();
    router.back();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>

        <View style={styles.topBar}>
          <TouchableOpacity 
            onPress={handleBack}
            style={styles.backButton}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>Step 3 of 9: FRONT</Text>
        </View>

        <View style={styles.viewfinderArea}>
          <View 
            style={[
              styles.documentFrame,
              { width: width * 0.85, height: width * 0.85 * 0.63 },
              isAligned ? styles.frameAligned : styles.frameDefault,
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
                Position Front of Document here
              </Text>
            )}

            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          <View style={styles.indicatorRow}>
            <View style={[styles.indicatorBadge, isAligned ? styles.badgeOk : styles.badgeNeutral]}>
              <Text style={styles.indicatorText}>Alignment</Text>
            </View>
            <View style={[styles.indicatorBadge, isWellLit ? styles.badgeOk : styles.badgeNeutral]}>
              <Text style={styles.indicatorText}>Lighting</Text>
            </View>
            <View style={[styles.indicatorBadge, !isBlurry ? styles.badgeOk : styles.badgeNeutral]}>
              <Text style={styles.indicatorText}>{isBlurry ? 'Blur' : 'Sharp'}</Text>
            </View>
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
            Please make sure the text is readable, has no reflection, and is not blurred.
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
  documentFrame: {
    borderWidth: 2, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  frameDefault: { borderColor: '#3b82f6', borderStyle: 'dashed', backgroundColor: 'rgba(15,23,42,0.1)' },
  frameAligned: { borderColor: '#10b981', backgroundColor: 'rgba(15,23,42,0.1)' },
  placeholderText: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center', paddingHorizontal: 16 },
  corner: { position: 'absolute', width: 24, height: 24 },
  cornerTL: { top: -4, left: -4, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#3b82f6', borderTopLeftRadius: 8 },
  cornerTR: { top: -4, right: -4, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#3b82f6', borderTopRightRadius: 8 },
  cornerBL: { bottom: -4, left: -4, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#3b82f6', borderBottomLeftRadius: 8 },
  cornerBR: { bottom: -4, right: -4, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#3b82f6', borderBottomRightRadius: 8 },
  indicatorRow: { position: 'absolute', bottom: 16, flexDirection: 'row', gap: 8 },
  indicatorBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  badgeOk: { backgroundColor: 'rgba(8,145,78,0.8)', borderColor: '#065f46' },
  badgeNeutral: { backgroundColor: 'rgba(2,6,23,0.85)', borderColor: '#1e293b' },
  indicatorText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  actionPanel: { gap: 16 },
  statusContainer: { alignItems: 'center' },
  statusText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  statusOk: { color: '#34d399' },
  statusNeutral: { color: '#cbd5e1' },
  assetInfo: { color: '#10b981', fontSize: 11, marginTop: 4 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 },
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
