import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { CameraView, type FlashMode } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Notice, StatusPill } from '../ui/NativePrimitives';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';
import type { CaptureStage } from '../../utils/captureState';
import { CAPTURE_STAGE_META } from '../../utils/captureState';
import {
  CAMERA_CAPTURE_CONFIG,
  capturedPictureToAsset,
  getCameraPermissionState,
  openCameraSettings,
  requestCameraPermissionState,
  type CameraCaptureMode,
  type CameraPermissionState,
  type CapturedAsset,
} from '../../utils/camera';

export function CaptureShell({
  step,
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  step?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const theme = useNativeTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.canvas }} edges={['top', 'bottom']}>
      <View style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[4], paddingBottom: footer ? spacing[4] : spacing[8] }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget.minimum }}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={onBack}
                style={({ pressed }) => ({
                  width: touchTarget.minimum,
                  height: touchTarget.minimum,
                  borderRadius: radius.control,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.background.surface,
                  borderWidth: 1,
                  borderColor: theme.border.default,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Ionicons name="arrow-back" size={22} color={theme.text.primary} />
              </Pressable>
            ) : <View style={{ width: touchTarget.minimum }} />}
            {step ? <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{step}</Text> : null}
          </View>
          <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[6] }}>{title}</Text>
          {subtitle ? <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, marginTop: spacing[2] }}>{subtitle}</Text> : null}
          <View style={{ marginTop: spacing[6] }}>{children}</View>
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: spacing[5], paddingBottom: spacing[3] }}>{footer}</View> : null}
      </View>
    </SafeAreaView>
  );
}

export function DocumentTypePicker({
  options,
  onSelect,
}: {
  options: {
    id: string;
    title: string;
    description: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    note?: string;
  }[];
  onSelect: (id: string) => void;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ gap: spacing[3] }}>
      {options.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityHint={item.description}
          onPress={() => onSelect(item.id)}
          style={({ pressed }) => ({
            minHeight: 76,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: theme.border.default,
            backgroundColor: theme.background.surface,
            padding: spacing[4],
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[4],
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View style={{ width: 48, height: 48, borderRadius: radius.control, backgroundColor: theme.background.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={item.icon} size={24} color={theme.text.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>{item.title}</Text>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}>{item.description}</Text>
            {item.note ? <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary, marginTop: 6 }}>{item.note}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
        </Pressable>
      ))}
    </View>
  );
}

export function CaptureGuide({
  title,
  instructions,
  actionLabel,
  onCapture,
  busy,
  icon = 'camera-outline',
}: {
  title: string;
  instructions: string[];
  actionLabel: string;
  onCapture: () => void;
  busy?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ gap: spacing[5] }}>
      <View style={{ borderRadius: radius.imageCard, backgroundColor: theme.background.surfaceSunken, minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: spacing[6] }}>
        <Ionicons name={icon} size={52} color={theme.text.secondary} />
        <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary, textAlign: 'center', marginTop: spacing[4] }}>{title}</Text>
        <View style={{ marginTop: spacing[4], gap: spacing[2], alignSelf: 'stretch' }}>
          {instructions.map((instruction) => (
            <View key={instruction} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] }}>
              <Ionicons name="information-circle-outline" size={18} color={theme.text.secondary} />
              <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, flex: 1 }}>{instruction}</Text>
            </View>
          ))}
        </View>
      </View>
      <Button label={actionLabel} onPress={onCapture} loading={busy} icon={<Ionicons name="camera-outline" size={21} color={theme.brand.onPrimary} />} />
    </View>
  );
}

function CameraFrame({ mode }: { mode: CameraCaptureMode }) {
  const frame = CAMERA_CAPTURE_CONFIG[mode].frame;
  const common = {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent' as const,
  };
  if (frame === 'face') {
    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ ...common, width: '62%', aspectRatio: 0.78, borderRadius: 999 }}
      />
    );
  }
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        ...common,
        width: frame === 'odometer' ? '88%' : '84%',
        aspectRatio: frame === 'odometer' ? 16 / 7 : 1.58,
        borderRadius: radius.control,
      }}
    />
  );
}

export function CarUpCameraViewfinder({
  mode,
  title,
  instruction,
  onCaptured,
  onClose,
  onPermissionState,
  onError,
}: {
  mode: CameraCaptureMode;
  title?: string;
  instruction?: string;
  onCaptured: (asset: CapturedAsset) => void;
  onClose?: () => void;
  onPermissionState?: (state: CameraPermissionState) => void;
  onError?: (message: string) => void;
}) {
  const theme = useNativeTheme();
  const config = CAMERA_CAPTURE_CONFIG[mode];
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, setPermission] = useState<CameraPermissionState>('not_requested');
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [flash, setFlash] = useState<FlashMode>('off');

  useEffect(() => {
    let active = true;
    void getCameraPermissionState().then((state) => {
      if (!active) return;
      setPermission(state);
      onPermissionState?.(state);
    });
    return () => { active = false; };
  }, [onPermissionState]);

  const requestPermission = async () => {
    const state = await requestCameraPermissionState();
    setPermission(state);
    onPermissionState?.(state);
  };

  const capture = async () => {
    if (!ready || taking || permission !== 'granted' || !cameraRef.current) return;
    setTaking(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        base64: true,
        exif: false,
        quality: config.quality,
        shutterSound: true,
      });
      const asset = capturedPictureToAsset(picture);
      if (!asset) {
        const message = 'The photo could not be prepared. Please take it again.';
        onError?.(message);
        return;
      }
      onCaptured(asset);
    } catch {
      onError?.('The camera could not capture a photo. Please try again.');
    } finally {
      setTaking(false);
    }
  };

  if (permission !== 'granted') {
    return (
      <View style={{ gap: spacing[3] }}>
        <View
          style={{
            minHeight: 72,
            borderRadius: radius.card,
            backgroundColor: theme.brand.primaryPressed,
            paddingHorizontal: spacing[4],
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[3],
          }}
        >
          {onClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back from camera"
              onPress={onClose}
              style={{ width: touchTarget.minimum, height: touchTarget.minimum, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="arrow-back" size={23} color={theme.brand.onPrimary} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.brand.onPrimary }}>CarUp Camera</Text>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.brand.onPrimary, marginTop: 2 }}>{title || 'Capture evidence'}</Text>
          </View>
        </View>
        <PermissionPanel
          title={permission === 'blocked' ? 'Camera access is blocked' : permission === 'unavailable' ? 'Camera is unavailable' : 'Camera access is needed'}
          body={permission === 'blocked'
            ? 'Enable camera access for CarUp in device Settings, then return here.'
            : permission === 'unavailable'
              ? 'This device could not access the camera.'
              : 'Allow camera access so CarUp can show the live viewfinder.'}
          onRetry={permission === 'not_requested' || permission === 'denied' ? () => void requestPermission() : undefined}
          onOpenSettings={permission === 'blocked' ? () => void openCameraSettings() : undefined}
        />
      </View>
    );
  }

  return (
    <View
      style={{
        overflow: 'hidden',
        borderRadius: radius.imageCard,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: '#000000',
      }}
    >
      <View
        style={{
          minHeight: 64,
          backgroundColor: theme.brand.primaryPressed,
          paddingHorizontal: spacing[3],
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[2],
        }}
      >
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back from camera"
            onPress={onClose}
            style={{ width: touchTarget.minimum, height: touchTarget.minimum, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={23} color={theme.brand.onPrimary} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.brand.onPrimary }}>CarUp Camera</Text>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.brand.onPrimary, marginTop: 2 }}>{title || 'Capture evidence'}</Text>
        </View>
        {config.facing === 'back' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={flash === 'off' ? 'Turn flash on' : 'Turn flash off'}
            accessibilityState={{ selected: flash !== 'off' }}
            onPress={() => setFlash((current) => current === 'off' ? 'on' : 'off')}
            style={{
              width: touchTarget.minimum,
              height: touchTarget.minimum,
              borderRadius: touchTarget.minimum / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Ionicons name={flash === 'off' ? 'flash-off-outline' : 'flash-outline'} size={22} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      <View style={{ position: 'relative', width: '100%', aspectRatio: config.aspectRatio, backgroundColor: '#000000' }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing={config.facing}
          flash={flash}
          mode="picture"
          mirror={config.facing === 'front'}
          animateShutter
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            setReady(false);
            onError?.('The camera could not start. Please try again.');
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CameraFrame mode={mode} />
        </View>
      </View>

      <View style={{ backgroundColor: theme.background.surface, padding: spacing[4], gap: spacing[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] }}>
          <Ionicons name="information-circle-outline" size={20} color={theme.text.secondary} />
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, flex: 1 }}>
            {instruction || config.instruction}
          </Text>
        </View>
        {mode === 'document' ? (
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
            Avoid glare and hold the phone steady. The frame is a placement guide, not automatic document detection.
          </Text>
        ) : mode === 'selfie' ? (
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
            Use even light where possible. This viewfinder does not perform face or liveness detection.
          </Text>
        ) : (
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
            Hold the phone steady so the odometer display is readable. CarUp does not claim automatic quality detection here.
          </Text>
        )}

        <View style={{ alignItems: 'center', paddingVertical: spacing[1] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={taking ? 'Capturing photo' : 'Take photo'}
            accessibilityState={{ disabled: !ready || taking, busy: taking }}
            disabled={!ready || taking}
            onPress={() => void capture()}
            style={({ pressed }) => ({
              width: 68,
              height: 68,
              borderRadius: 34,
              borderWidth: 5,
              borderColor: theme.brand.primary,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !ready || taking ? 0.45 : pressed ? 0.75 : 1,
            })}
          >
            {taking ? <ActivityIndicator color={theme.brand.primaryPressed} /> : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.brand.primary }} />}
          </Pressable>
          {!ready ? (
            <Text accessibilityLiveRegion="polite" allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[2] }}>
              Starting camera…
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function CapturePreview({
  uri,
  label,
  onRetake,
  onUse,
  useLabel = 'Use photo',
  checkBody = 'Make sure the whole document is visible, the text is readable, and glare does not cover important details.',
}: {
  uri: string;
  label: string;
  onRetake: () => void;
  onUse: () => void;
  useLabel?: string;
  checkBody?: string;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ gap: spacing[4] }}>
      <View style={{ borderRadius: radius.imageCard, overflow: 'hidden', backgroundColor: theme.background.surfaceSunken }}>
        <Image source={{ uri }} resizeMode="contain" accessibilityLabel={label} style={{ width: '100%', aspectRatio: 4 / 3 }} />
      </View>
      <Notice title="Check this photo" body={checkBody} tone="info" />
      <View style={{ flexDirection: 'row', gap: spacing[3] }}>
        <Button label="Retake" onPress={onRetake} variant="secondary" style={{ flex: 1 }} />
        <Button label={useLabel} onPress={onUse} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export function UploadProgress({
  stage,
  progress,
}: {
  stage: CaptureStage;
  progress?: number | null;
}) {
  const theme = useNativeTheme();
  const meta = CAPTURE_STAGE_META[stage];
  const tone = meta.tone === 'neutral' ? 'info' : meta.tone;
  const clamped = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;
  return (
    <View accessibilityLiveRegion="polite" style={{ borderRadius: radius.card, backgroundColor: theme.background.surface, borderWidth: 1, borderColor: theme.border.default, padding: spacing[5], gap: spacing[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        {(stage === 'UPLOADING' || stage === 'OCR_READING') ? <ActivityIndicator color={theme.state.info} /> : <Ionicons name="document-text-outline" size={22} color={theme.text.secondary} />}
        <View style={{ flex: 1 }}>
          <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>{meta.label}</Text>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>{meta.description}</Text>
        </View>
        <StatusPill label={stage === 'DOMAIN_VERIFIED' ? 'Verified' : meta.label} tone={tone} />
      </View>
      {clamped !== null ? (
        <View style={{ height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.background.surfaceSunken }}>
          <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: theme.state.info }} />
        </View>
      ) : null}
    </View>
  );
}

export function ExtractionField({
  label,
  value,
  state = 'read',
}: {
  label: string;
  value?: string | null;
  state?: 'read' | 'uncertain' | 'missing' | 'corrected';
}) {
  const theme = useNativeTheme();
  const stateCopy =
    state === 'uncertain' ? 'Please check' :
    state === 'missing' ? 'We could not read this clearly' :
    state === 'corrected' ? 'You corrected this' :
    'Read from your document';
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.border.default, paddingVertical: spacing[3] }}>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{label}</Text>
      <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, marginTop: 4 }}>{value || 'Not read'}</Text>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: state === 'missing' || state === 'uncertain' ? theme.state.warning : theme.text.muted, marginTop: 4 }}>{stateCopy}</Text>
    </View>
  );
}

export function EvidenceStatus({ stage }: { stage: CaptureStage }) {
  const meta = CAPTURE_STAGE_META[stage];
  const tone = meta.tone === 'neutral' ? 'info' : meta.tone;
  return <Notice title={meta.label} body={meta.description} tone={tone} />;
}

export function RetryPanel({
  title,
  body,
  actionLabel,
  onRetry,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <View style={{ gap: spacing[4] }}>
      <Notice title={title} body={body} tone="warning" />
      <Button label={actionLabel} onPress={onRetry} />
    </View>
  );
}

export function PermissionPanel({
  title,
  body,
  onOpenSettings,
  onRetry,
}: {
  title: string;
  body: string;
  onOpenSettings?: () => void;
  onRetry?: () => void;
}) {
  return (
    <View style={{ gap: spacing[3] }}>
      <Notice title={title} body={body} tone="warning" />
      {onRetry ? <Button label="Try again" onPress={onRetry} /> : null}
      {onOpenSettings ? <Button label="Open Settings" onPress={onOpenSettings} variant="secondary" /> : null}
    </View>
  );
}
