import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator, InteractionManager, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

const { width } = Dimensions.get('window');

interface Challenge {
  id: number;
  instruction: string;
  icon: string;
  maxProgress: number;
}

const LIVENESS_CHALLENGES: Challenge[] = [
  { id: 1, instruction: 'Blink 3 times slowly', icon: '👁️', maxProgress: 3 },
  { id: 2, instruction: 'Turn your head slightly to the left', icon: '👤', maxProgress: 1 },
  { id: 3, instruction: 'Nod your head up and down', icon: '↕️', maxProgress: 1 }
];

export default function ActiveLiveness() {
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
  }>();

  const [currentChallengeIdx, setCurrentChallengeIdx] = useState<number>(0);
  const [challengeProgress, setChallengeProgress] = useState<number>(0);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const mountedRef = useRef(true);

  const currentChallenge = LIVENESS_CHALLENGES[currentChallengeIdx];

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (currentChallengeIdx >= LIVENESS_CHALLENGES.length) {
      handleLivenessComplete();
      return;
    }

    setAnalyzing(true);
    const analysisTimer = setTimeout(() => {
      if (mountedRef.current) setAnalyzing(false);
    }, 1000);

    let progressTimer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
    if (currentChallenge.id === 1) {
      let blinkCount = 0;
      progressTimer = setInterval(() => {
        blinkCount += 1;
        if (mountedRef.current) setChallengeProgress(blinkCount);
        if (blinkCount >= currentChallenge.maxProgress) {
          clearInterval(progressTimer);
          setTimeout(() => {
            if (mountedRef.current) {
              setCurrentChallengeIdx(prev => prev + 1);
              setChallengeProgress(0);
            }
          }, 600);
        }
      }, 1000);
    } else {
      progressTimer = setTimeout(() => {
        if (mountedRef.current) setChallengeProgress(1);
        setTimeout(() => {
          if (mountedRef.current) {
            setCurrentChallengeIdx(prev => prev + 1);
            setChallengeProgress(0);
          }
        }, 600);
      }, 2000);
    }

    return () => {
      clearTimeout(analysisTimer);
      if (currentChallenge.id === 1) {
        clearInterval(progressTimer as ReturnType<typeof setInterval>);
      } else {
        clearTimeout(progressTimer as ReturnType<typeof setTimeout>);
      }
    };
  }, [currentChallengeIdx]);

  const handleLivenessComplete = () => {
    if (!mountedRef.current) return;
    setSuccess(true);
    InteractionManager.runAfterInteractions(() => {
      if (!mountedRef.current) return;
      router.push({
        pathname: '/(auth)/verification/review',
        params: {
          ...params,
          livenessVerified: 'true'
        }
      });
    });
  };

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>

        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>Step 6 of 9: LIVENESS</Text>
        </View>

        <View style={styles.viewfinderArea}>
          <View 
            style={[
              styles.circleFrame,
              { width: width * 0.65, height: width * 0.65 },
              success ? styles.frameSuccess : styles.frameDefault,
            ]}
          >
            {analyzing ? (
              <ActivityIndicator size="large" color="#3B82F6" />
            ) : success ? (
              <Text style={styles.checkmark}>✓</Text>
            ) : (
              <Text style={styles.challengeIcon}>{currentChallenge?.icon}</Text>
            )}

            <View style={styles.scanRing} />
          </View>
        </View>

        <View style={styles.challengePanel}>
          {success ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>Liveness Step Complete (Simulated)</Text>
              <Text style={styles.successDesc}>
                This challenge is a simulation for development builds and is not used as biometric confidence. Redirecting to Quality Review.
              </Text>
            </View>
          ) : (
            <View style={styles.challengeCard}>
              <Text style={styles.challengeLabel}>
                Liveness Challenge (Simulated)
              </Text>
              <Text style={styles.challengeInstruction}>
                {currentChallenge?.instruction}
              </Text>
              
              <View style={styles.dotsRow}>
                {LIVENESS_CHALLENGES.map((ch, idx) => {
                  const isActive = idx === currentChallengeIdx;
                  const isDone = idx < currentChallengeIdx;
                  return (
                    <View 
                      key={ch.id}
                      style={[
                        styles.dot,
                        isDone ? styles.dotDone : isActive ? styles.dotActive : styles.dotPending,
                      ]}
                    />
                  );
                })}
              </View>

              {currentChallenge && currentChallenge.maxProgress > 1 && (
                <Text style={styles.progressText}>
                  Progress: {challengeProgress} of {currentChallenge.maxProgress}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.helpText}>
            Real biometric liveness detection is deferred to a later phase. This step is a UI simulation and does not contribute to verification results.
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
  circleFrame: {
    borderWidth: 4, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  frameDefault: { borderColor: '#3b82f6', backgroundColor: 'rgba(15,23,42,0.1)' },
  frameSuccess: { borderColor: '#10b981', backgroundColor: 'rgba(15,23,42,0.1)' },
  checkmark: { color: '#10b981', fontSize: 48, fontWeight: 'bold' },
  challengeIcon: { fontSize: 36 },
  scanRing: {
    position: 'absolute', inset: -8,
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(59,130,246,0.35)',
    borderRadius: 999,
  },
  challengePanel: { gap: 24 },
  successCard: {
    alignItems: 'center', padding: 24,
    backgroundColor: 'rgba(8,145,78,0.4)', borderWidth: 1, borderColor: '#065f46',
    borderRadius: 24,
  },
  successTitle: { color: '#34d399', fontWeight: 'bold', fontSize: 18, marginBottom: 4 },
  successDesc: { color: '#94a3b8', fontSize: 11, textAlign: 'center', lineHeight: 16 },
  challengeCard: {
    alignItems: 'center', padding: 24,
    backgroundColor: '#161C2C', borderWidth: 1, borderColor: '#2B3552',
    borderRadius: 24,
  },
  challengeLabel: { color: '#3b82f6', fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 },
  challengeInstruction: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { height: 10, borderRadius: 5 },
  dotDone: { backgroundColor: '#10b981', width: 24 },
  dotActive: { backgroundColor: '#3b82f6', width: 24 },
  dotPending: { backgroundColor: '#334155', width: 10 },
  progressText: { color: '#94a3b8', fontSize: 11, marginTop: 12 },
  helpText: { fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 16 },
});
