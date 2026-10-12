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
  placehold¶»§q«^