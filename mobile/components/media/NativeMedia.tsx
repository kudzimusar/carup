import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

export function VehicleImage({
  uri,
  label,
  aspectRatio = 16 / 10,
}: {
  uri?: string | null;
  label: string;
  aspectRatio?: number;
}) {
  const theme = useNativeTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View
        accessibilityLabel={`${label}. No image available`}
        style={{
          width: '100%',
          aspectRatio,
          backgroundColor: theme.background.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[2],
        }}
      >
        <Ionicons name="car-sport-outline" size={36} color={theme.text.muted} />
        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>No image available</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityLabel={label}
      style={{ width: '100%', aspectRatio, backgroundColor: theme.background.surfaceSunken }}
    />
  );
}

export function EvidenceThumbnail({
  uri,
  label,
  privateMedia = true,
}: {
  uri?: string | null;
  label: string;
  privateMedia?: boolean;
}) {
  const theme = useNativeTheme();
  return (
    <View
      style={{
        width: 84,
        height: 64,
        borderRadius: radius.control,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surfaceSunken,
      }}
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" accessibilityLabel={label} style={{ width: '100%', height: '100%' }} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={privateMedia ? 'document-lock-outline' : 'image-outline'} size={24} color={theme.text.muted} />
        </View>
      )}
    </View>
  );
}

export function PrivateDocumentPreview({
  uri,
  label,
}: {
  uri: string;
  label: string;
}) {
  const theme = useNativeTheme();
  return (
    <View style={{ borderRadius: radius.imageCard, overflow: 'hidden', backgroundColor: theme.background.surfaceSunken }}>
      <Image source={{ uri }} resizeMode="contain" accessibilityLabel={label} style={{ width: '100%', aspectRatio: 4 / 3 }} />
      <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center', padding: spacing[3], backgroundColor: theme.background.surface }}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.text.muted} />
        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Private evidence — not Marketplace media</Text>
      </View>
    </View>
  );
}

export function ImageGallery({
  images,
  onSelect,
}: {
  images: { id: string; uri: string; label: string }[];
  onSelect?: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[3] }}>
      {images.map((item) => (
        <Pressable key={item.id} onPress={() => onSelect?.(item.id)} accessibilityRole={onSelect ? 'button' : undefined} accessibilityLabel={item.label}>
          <VehicleImage uri={item.uri} label={item.label} aspectRatio={4 / 3} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
