import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

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
  const router = useRouter();
  const params = useLocalSearchParams<{
    docType: string;
    doubleSided: string;
    capturedFront: string;
    capturedBack?: string;
    capturedSelfie: string;
  }>();

  const [currentChallengeIdx, setCurrentChallengeIdx] = useState<number>(0);
  const [challengeProgress, setChallengeProgress] = useState<number>(0);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const currentChallenge = LIVENESS_CHALLENGES[currentChallengeIdx];

  useEffect(() => {
    // Simulator challenge solver loop
    if (currentChallengeIdx >= LIVENESS_CHALLENGES.length) {
      handleLivenessComplete();
      return;
    }

    setAnalyzing(true);
    const analysisTimer = setTimeout(() => {
      setAnalyzing(false);
    }, 1000);

    // Simulate progress trigger
    let progressTimer: ReturnType<typeof setTimeout>;
    if (currentChallenge.id === 1) {
      // Blink challenge requires 3 blinks
      let blinkCount = 0;
      progressTimer = setInterval(() => {
        blinkCount += 1;
        setChallengeProgress(blinkCount);
        if (blinkCount >= currentChallenge.maxProgress) {
          clearInterval(progressTimer);
          setTimeout(() => {
            setCurrentChallengeIdx(prev => prev + 1);
            setChallengeProgress(0);
          }, 600);
        }
      }, 1000);
    } else {
      // Turn and nod challenges resolve in 2 seconds
      progressTimer = setTimeout(() => {
        setChallengeProgress(1);
        setTimeout(() => {
          setCurrentChallengeIdx(prev => prev + 1);
          setChallengeProgress(0);
        }, 600);
      }, 2000);
    }

    return () => {
      clearTimeout(analysisTimer);
      if (progressTimer) clearInterval(progressTimer as any);
      clearTimeout(progressTimer);
    };
  }, [currentChallengeIdx]);

  const handleLivenessComplete = () => {
    setSuccess(true);
    setTimeout(() => {
      router.push({
        pathname: '/(auth)/verification/review',
        params: {
          ...params,
          livenessVerified: 'true'
        }
      });
    }, 1200);
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0A0E1A]">
      <View className="flex-1 justify-between p-6">
        
        {/* Header */}
        <View className="flex-row items-center justify-between z-10">
          <TouchableOpacity 
            onPress={() => router.back()}
            className="w-10 h-10 bg-[#161C2C]/80 border border-[#2B3552] rounded-xl items-center justify-center"
          >
            <Text className="text-white text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-slate-400 font-semibold text-xs tracking-widest uppercase">Step 6 of 9: LIVENESS</Text>
        </View>

        {/* Viewfinder Circle Overlay */}
        <View className="flex-1 justify-center items-center my-6 relative">
          <View 
            style={{ width: width * 0.65, height: width * 0.65 }}
            className={`border-4 rounded-full relative items-center justify-center bg-slate-900/10 ${
              success ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20' : 'border-blue-500'
            }`}
          >
            {analyzing ? (
              <ActivityIndicator size="large" color="#3B82F6" />
            ) : success ? (
              <Text className="text-emerald-500 text-6xl">✓</Text>
            ) : (
              <Text className="text-4xl">{currentChallenge?.icon}</Text>
            )}

            {/* Glowing outer scanning ring */}
            <View className="absolute -inset-2 border-2 border-dashed border-blue-500/35 rounded-full animate-spin" />
          </View>
        </View>

        {/* Challenge Instructions */}
        <View className="space-y-6">
          {success ? (
            <View className="items-center p-6 bg-emerald-950/40 border border-emerald-800 rounded-3xl">
              <Text className="text-emerald-400 font-bold text-lg mb-1">Spoof Check Passed</Text>
              <Text className="text-slate-400 text-xs text-center leading-relaxed">
                Biometric active liveness was confirmed. Redirecting to Quality Review.
              </Text>
            </View>
          ) : (
            <View className="items-center p-6 bg-[#161C2C] border border-[#2B3552] rounded-3xl shadow-xl">
              <Text className="text-slate-400 text-xs uppercase tracking-widest mb-2 font-bold text-blue-500">
                Active Spoof Protection
              </Text>
              <Text className="text-white text-base font-semibold text-center leading-normal mb-4">
                {currentChallenge?.instruction}
              </Text>
              
              {/* Custom challenge step indicator dots */}
              <View className="flex-row space-x-2">
                {LIVENESS_CHALLENGES.map((ch, idx) => {
                  const isActive = idx === currentChallengeIdx;
                  const isDone = idx < currentChallengeIdx;
                  return (
                    <View 
                      key={ch.id}
                      className={`h-2.5 rounded-full transition-all ${
                        isDone ? 'bg-emerald-500 w-6' : isActive ? 'bg-blue-500 w-6' : 'bg-slate-700 w-2.5'
                      }`}
                    />
                  );
                })}
              </View>

              {/* Progress counter if multi-step */}
              {currentChallenge?.maxProgress > 1 && (
                <Text className="text-slate-400 text-xs mt-3">
                  Progress: {challengeProgress} of {currentChallenge.maxProgress}
                </Text>
              )}
            </View>
          )}

          <Text className="text-xs text-slate-500 text-center leading-relaxed">
            Active biometric checks block fraudulent attempts, video replay scams, and deepfakes to keep the marketplace secure.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
