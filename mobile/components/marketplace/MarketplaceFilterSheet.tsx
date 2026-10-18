import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { VEHICLE_MAKES } from '@shared/taxonomy/vehicle';
import { Button, Field, FilterChip, SectionHeader } from '../ui/NativePrimitives';
import {
  EMPTY_MARKETPLACE_FILTERS,
  MARKETPLACE_CONDITIONS,
  MARKETPLACE_SORTS,
  MARKETPLACE_TRUST_FILTERS,
  type MarketplaceFilters,
} from '../../utils/marketplaceFilters';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

export function MarketplaceFilterSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: MarketplaceFilters;
  onApply: (filters: MarketplaceFilters) => void;
  onClose: () => void;
}) {
  const theme = useNativeTheme();
  const [draft, setDraft] = useState<MarketplaceFilters>(value);
  const wasVisible = React.useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) setDraft(value);
    wasVisible.current = visible;
  }, [visible, value]);

  const set = <K extends keyof MarketplaceFilters,>(key: K, next: MarketplaceFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: next }));
  };

  const toggleTag = (tag: string) => {
    setDraft((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((item) => item !== tag)
        : [...current.tags, tag],
    }));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.background.canvas }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            paddingHorizontal: spacing[5],
            paddingTop: spacing[5],
            paddingBottom: spacing[3],
            borderBottomWidth: 1,
            borderBottomColor: theme.border.default,
            backgroundColor: theme.background.surface,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, flex: 1 }}>All filters</Text>
            <Button label="Close" variant="tertiary" onPress={onClose} />
          </View>
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
            CarUp sends these selections to the canonical Marketplace API. No downloaded-page filtering or inferred Trust.
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing[5], paddingBottom: spacing[10], gap: spacing[5] }}
        >
          <View>
            <SectionHeader title="Make" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[2] }}>
              <FilterChip label="Any make" selected={!draft.make} onPress={() => set('make', '')} />
              {VEHICLE_MAKES.map((make) => (
                <FilterChip key={make} label={make} selected={draft.make === make} onPress={() => set('make', make)} />
              ))}
            </ScrollView>
          </View>

          <Field label="Model" value={draft.model} onChangeText={(value) => set('model', value)} placeholder="e.g. Hilux" />
          <Field label="Year" value={draft.year} onChangeText={(value) => set('year', value)} keyboardType="number-pad" placeholder="e.g. 2022" />
          <Field label="Colour" value={draft.color} onChangeText={(value) => set('color', value)} placeholder="e.g. white" />
          <Field label="Body style" value={draft.bodyStyle} onChangeText={(value) => set('bodyStyle', value)} placeholder="e.g. SUV, pickup" />
          <Field label="Location" value={draft.location} onChangeText={(value) => set('location', value)} placeholder="City, province or governed listing location" />
          <Field label="Fuel" value={draft.fuel} onChangeText={(value) => set('fuel', value)} placeholder="e.g. diesel" />
          <Field label="Transmission" value={draft.transmission} onChangeText={(value) => set('transmission', value)} placeholder="e.g. automatic" />

          <View style={{ flexDirection: 'row', gap: spacing[3] }}>
            <View style={{ flex: 1 }}>
              <Field label="Minimum price" value={draft.minPrice} onChangeText={(value) => set('minPrice', value)} keyboardType="numeric" placeholder="Minimum" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Maximum price" value={draft.maxPrice} onChangeText={(value) => set('maxPrice', value)} keyboardType="numeric" placeholder="Maximum" />
            </View>
          </View>

          <View>
            <SectionHeader title="Condition" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], paddingTop: spacing[2] }}>
              <FilterChip label="Any condition" selected={!draft.condition} onPress={() => set('condition', '')} />
              {MARKETPLACE_CONDITIONS.map((item) => (
                <FilterChip key={item.value} label={item.label} selected={draft.condition === item.value} onPress={() => set('condition', item.value)} />
              ))}
            </View>
          </View>

          <View>
            <SectionHeader title="Trust / verification" />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1], marginBottom: spacing[2] }}>
              These values are canonical backend tags; the app never infers them.
            </Text>
            <View style={{ gap: spacing[2] }}>
              {MARKETPLACE_TRUST_FILTERS.map((item) => (
                <FilterChip key={item.value} label={item.label} selected={draft.tags.includes(item.value)} onPress={() => toggleTag(item.value)} />
              ))}
            </View>
          </View>

          <View>
            <SectionHeader title="Sort" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], paddingTop: spacing[2] }}>
              {MARKETPLACE_SORTS.map((item) => (
                <FilterChip key={item.value} label={item.label} selected={draft.sort === item.value} onPress={() => set('sort', item.value)} />
              ))}
            </View>
          </View>
        </ScrollView>

        <View
          style={{
            padding: spacing[4],
            borderTopWidth: 1,
            borderTopColor: theme.border.default,
            backgroundColor: theme.background.surface,
            gap: spacing[2],
          }}
        >
          <Button
            label="Show results"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          />
          <Button
            label="Clear all"
            variant="tertiary"
            onPress={() => setDraft({ ...EMPTY_MARKETPLACE_FILTERS, tags: [] })}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
