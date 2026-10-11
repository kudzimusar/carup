import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';

export function Screen({
  children,
  style,
  padded = true,
  bottomInset = true,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  bottomInset?: boolean;
  testID?: string;
}) {
  const theme = useNativeTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={[
        {
          flex: 1,
          backgroundColor: theme.background.canvas,
          paddingHorizontal: padded ? spacing[5] : 0,
          paddingBottom: bottomInset ? Math.max(insets.bottom, spacing[3]) : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ minHeight: touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({ minHeight: touchTarget.minimum, justifyContent: 'center', opacity: pressed ? 0.72 : 1 })}
        >
          <Text allowFontScaling style={{ ...typeScale.label, color: theme.state.info }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'provider';

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  accessibilityLabel,
  icon,
  providerColor,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  accessibilityLabel?: string;
  icon?: React.ReactNode;
  providerColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useNativeTheme();
  const background =
    variant === 'primary' ? theme.brand.primary :
    variant === 'destructive' ? theme.state.danger :
    variant === 'provider' ? (providerColor || theme.background.surfaceRaised) :
    variant === 'secondary' ? theme.background.surface :
    'transparent';
  const borderColor =
    variant === 'primary' ? theme.brand.primary :
    variant === 'destructive' ? theme.state.danger :
    variant === 'provider' ? (providerColor || theme.border.strong) :
    theme.border.strong;
  const foreground =
    variant === 'primary' ? theme.brand.onPrimary :
    variant === 'destructive' ? '#FFFFFF' :
    variant === 'provider' && providerColor ? '#FFFFFF' :
    theme.text.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: touchTarget.minimum,
          borderRadius: radius.button,
          borderWidth: variant === 'tertiary' ? 0 : 1,
          borderColor,
          backgroundColor: background,
          paddingHorizontal: spacing[5],
          paddingVertical: spacing[3],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[2],
          opacity: disabled ? 0.48 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={foreground} /> : icon}
      <Text allowFontScaling style={{ ...typeScale.button, color: foreground }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const theme = useNativeTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touchTarget.minimum,
        height: touchTarget.minimum,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? theme.brand.primarySubtle : theme.background.surface,
        borderWidth: 1,
        borderColor: selected ? theme.brand.primary : theme.border.default,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={theme.text.primary} />
    </Pressable>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmitEditing,
  accessibilityLabel = 'Search',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  accessibilityLabel?: string;
}) {
  const theme = useNativeTheme();
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3],
        borderWidth: 1,
        borderColor: theme.border.strong,
        borderRadius: radius.input,
        backgroundColor: theme.background.surface,
        paddingHorizontal: spacing[4],
      }}
    >
      <Ionicons name="search-outline" size={22} color={theme.text.muted} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={theme.text.muted}
        returnKeyType="search"
        autoCorrect={false}
        allowFontScaling
        style={{ ...typeScale.body, color: theme.text.primary, flex: 1, paddingVertical: spacing[3] }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close-circle" size={20} color={theme.text.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function FilterChip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useNativeTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget.minimum,
        paddingHorizontal: spacing[4],
        borderRadius: radius.chip,
        borderWidth: 1.5,
        borderColor: selected ? theme.text.primary : theme.border.strong,
        backgroundColor: selected ? theme.background.surfaceSunken : theme.background.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[2],
        opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={theme.text.primary} /> : null}
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.primary }}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const theme = useNativeTheme();
  const colors =
    tone === 'success' ? [theme.state.successSubtle, theme.state.success] :
    tone === 'warning' ? [theme.state.warningSubtle, theme.state.warning] :
    tone === 'danger' ? [theme.state.dangerSubtle, theme.state.danger] :
    tone === 'info' ? [theme.state.infoSubtle, theme.state.info] :
    [theme.background.surfaceSunken, theme.text.secondary];
  return (
    <View
      accessibilityRole="text"
      style={{ alignSelf: 'flex-start', minHeight: 30, justifyContent: 'center', borderRadius: radius.chip, backgroundColor: colors[0], paddingHorizontal: spacing[3] }}
    >
      <Text allowFontScaling style={{ ...typeScale.metadata, color: colors[1] }}>{label}</Text>
    </View>
  );
}

export function TrustSignal({
  label,
  detail,
  tone = 'neutral',
}: {
  label: string;
  detail?: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const theme = useNativeTheme();
  const color = tone === 'success' ? theme.state.success : tone === 'warning' ? theme.state.warning : theme.text.secondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], minHeight: 32 }}>
      <Ionicons name={tone === 'success' ? 'checkmark-circle-outline' : 'shield-checkmark-outline'} size={20} color={color} />
      <View style={{ flex: 1 }}>
        <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.primary }}>{label}</Text>
        {detail ? <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>{detail}</Text> : null}
      </View>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  icon = 'car-outline',
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing[10], paddingHorizontal: spacing[6] }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.background.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={theme.text.secondary} />
      </View>
      <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, textAlign: 'center', marginTop: spacing[5] }}>{title}</Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, textAlign: 'center', marginTop: spacing[2] }}>{body}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing[5], alignSelf: 'stretch' }} /> : null}
      {secondaryLabel && onSecondary ? <Button label={secondaryLabel} onPress={onSecondary} variant="tertiary" style={{ marginTop: spacing[2], alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function Skeleton({
  height = 18,
  width = '100%',
  radiusValue = radius.control,
}: {
  height?: number;
  width?: ViewStyle['width'];
  radiusValue?: number;
}) {
  const theme = useNativeTheme();
  return <View accessible={false} style={{ width, height, borderRadius: radiusValue, backgroundColor: theme.background.surfaceSunken }} />;
}

export function Price({
  amount,
  currency,
  compact,
}: {
  amount: number | null | undefined;
  currency: string | null | undefined;
  compact?: boolean;
}) {
  const theme = useNativeTheme();
  const label =
    typeof amount !== 'number' || !Number.isFinite(amount)
      ? 'Price not recorded'
      : (currency || '').toUpperCase() === 'USD'
        ? `$${amount.toLocaleString()}`
        : currency
          ? `${currency.toUpperCase()} ${amount.toLocaleString()}`
          : amount.toLocaleString();
  return <Text allowFontScaling style={{ ...(compact ? typeScale.priceCompact : typeScale.priceLarge), color: theme.text.primary }}>{label}</Text>;
}

export function Notice({
  title,
  body,
  tone = 'info',
}: {
  title: string;
  body: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  const theme = useNativeTheme();
  const [background, foreground] =
    tone === 'success' ? [theme.state.successSubtle, theme.state.success] :
    tone === 'warning' ? [theme.state.warningSubtle, theme.state.warning] :
    tone === 'danger' ? [theme.state.dangerSubtle, theme.state.danger] :
    [theme.state.infoSubtle, theme.state.info];
  return (
    <View accessibilityRole="text" style={{ backgroundColor: background, borderRadius: radius.card, padding: spacing[4], gap: spacing[1] }}>
      <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: foreground }}>{title}</Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary }}>{body}</Text>
    </View>
  );
}

export function Field({
  label,
  helper,
  error,
  style,
  ...props
}: TextInputProps & {
  label: string;
  helper?: string;
  error?: string | null;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.primary }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error || helper}
        placeholderTextColor={theme.text.muted}
        allowFontScaling
        {...props}
        style={[
          {
            minHeight: touchTarget.minimum,
            borderWidth: 1,
            borderColor: error ? theme.state.danger : theme.border.strong,
            borderRadius: radius.input,
            backgroundColor: theme.background.surface,
            color: theme.text.primary,
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[3],
            ...typeScale.body,
          },
          style,
        ]}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ ...typeScale.metadata, color: theme.state.danger }}>{error}</Text>
      ) : helper ? (
        <Text style={{ ...typeScale.metadata, color: theme.text.muted }}>{helper}</Text>
      ) : null}
    </View>
  );
}

export function StickyActionBar({ children }: { children: React.ReactNode }) {
  const theme = useNativeTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.border.default,
        backgroundColor: theme.background.surface,
        paddingHorizontal: spacing[5],
        paddingTop: spacing[3],
        paddingBottom: Math.max(insets.bottom, spacing[3]),
      }}
    >
      {children}
    </View>
  );
}
