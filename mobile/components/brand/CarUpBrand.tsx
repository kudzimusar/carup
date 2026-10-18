import React from 'react';
import { Pressable, Text, TextInput, TextInputProps, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';

export function CarUpWordmark({
  tone = 'dark',
  compact = false,
}: {
  tone?: 'dark' | 'light';
  compact?: boolean;
}) {
  const theme = useNativeTheme();
  const ink = tone === 'light' ? theme.brand.onHero : theme.brand.wordmarkInk;
  const markSize = compact ? 34 : 40;
  const fontSize = compact ? 22 : 26;

  return (
    <View accessibilityRole="text" accessibilityLabel="CarUp" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
      <View
        style={{
          width: markSize,
          height: markSize,
          borderRadius: compact ? 11 : 13,
          backgroundColor: theme.brand.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="car-sport" size={compact ? 20 : 23} color={theme.brand.onPrimary} />
      </View>
      <Text allowFontScaling style={{ fontSize, lineHeight: fontSize + 5, fontWeight: '900', letterSpacing: -0.8, color: ink }}>
        Car<Text style={{ color: theme.brand.primary }}>Up</Text>
      </Text>
    </View>
  );
}

export function BrandSearchField({
  value,
  onChangeText,
  placeholder,
  onSubmitEditing,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  accessibilityLabel: string;
}) {
  const theme = useNativeTheme();

  return (
    <View
      style={{
        minHeight: 58,
        borderRadius: 18,
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: spacing[4],
        paddingRight: spacing[2],
        gap: spacing[2],
      }}
    >
      <Ionicons name="search" size={22} color={theme.brand.heroRaised} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        autoCorrect={false}
        returnKeyType="search"
        allowFontScaling
        style={{
          ...typeScale.body,
          flex: 1,
          color: '#0F172A',
          paddingVertical: spacing[3],
        }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={{
            minWidth: touchTarget.minimum,
            minHeight: touchTarget.minimum,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close-circle" size={21} color="#64748B" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function BrandSecondaryAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  const theme = useNativeTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.10)' }}
      style={{
        flex: 1,
        minHeight: touchTarget.minimum,
        borderRadius: radius.button,
        borderWidth: 1,
        borderColor: '#466783',
        backgroundColor: 'rgba(255,255,255,0.035)',
        paddingHorizontal: spacing[3],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[2],
        overflow: 'hidden',
      }}
    >
      <Ionicons name={icon} size={19} color={theme.brand.onHero} />
      <Text allowFontScaling style={{ ...typeScale.button, color: theme.brand.onHero }}>{label}</Text>
    </Pressable>
  );
}
