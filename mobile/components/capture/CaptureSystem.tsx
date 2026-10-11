import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Notice, StatusPill } from '../ui/NativePrimitives';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';
import type { CaptureStage } from '../../utils/captureState';
import { CAPTURE_STAGE_META } from '../../utils/captureState';

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
              <Ionicons name="checkmark" size={18} color={theme.text.secondary} />
              <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, flex: 1 }}>{instruction}</Text>
            </View>
          ))}
        </View>
      </View>
      <Button label={actionLabel} onPress={onCapture} loading={busy} icon={<Ionicons name="camera-outline" size={21} color={theme.brand.onPrimary} />} />
    </View>
  );
}

export function CapturePreview({
  uri,
  label,
  onRetake,
  onUse,
  useLabel = 'Use photo',
}: {
  uri: string;
  label: string;
  onRetake: () => void;
  onUse: () => void;
  useLabel?: string;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ gap: spacing[4] }}>
      <View style={{ borderRadius: radius.imageCard, overflow: 'hidden', backgroundColor: theme.background.surfaceSunken }}>
        <Image source={{ uri }} resizeMode="contain" accessibilityLabel={label} style={{ width: '100%', aspectRatio: 4 / 3 }} />
      </View>
      <Notice title="Check this photo" body="Make sure the whole document is visible, the text is readable, and glare does not cover important details." tone="info" />
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
