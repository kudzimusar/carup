import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VehicleImage } from '../media/NativeMedia';
import { Price, StatusPill, TrustSignal } from '../ui/NativePrimitives';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';
import { resolveMarketplacePrimaryImage, type MobileListingSummary } from '../../utils/marketplaceApi';

export function vehicleName(item: MobileListingSummary): string {
  return [item.year, item.make, item.model]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ') || [item.make, item.model].filter(Boolean).join(' ');
}

function factLine(item: MobileListingSummary): string {
  const facts: string[] = [];
  if (typeof item.mileage === 'number' && Number.isFinite(item.mileage)) facts.push(`${item.mileage.toLocaleString()} km`);
  if (item.fuel_type) facts.push(item.fuel_type);
  if (item.transmission) facts.push(item.transmission);
  return facts.join(' · ');
}

export function VehicleCard({
  item,
  onPress,
  compact = false,
  saved = false,
  onToggleSave,
  saveBusy = false,
}: {
  item: MobileListingSummary;
  onPress: () => void;
  compact?: boolean;
  saved?: boolean;
  onToggleSave?: () => void;
  saveBusy?: boolean;
}) {
  const theme = useNativeTheme();
  const name = vehicleName(item);
  const image = resolveMarketplacePrimaryImage(item);
  const facts = factLine(item);
  const evaluated =
    item.trust?.evaluation_state === 'evaluated' &&
    typeof item.trust?.score === 'number' &&
    Number.isFinite(item.trust.score);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name || 'vehicle'}`}
      onPress={onPress}
      style={({ pressed }) => ({
        overflow: 'hidden',
        borderRadius: radius.imageCard,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View style={{ position: 'relative' }}>
        <VehicleImage uri={image} label={`${name || 'Vehicle'} listing photo`} />
        {item.reservation_summary?.reserved === true ? (
          <View style={{ position: 'absolute', top: spacing[3], left: spacing[3] }}>
            <StatusPill label="Reserved" tone="warning" />
          </View>
        ) : null}
        {onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${name || 'vehicle'} from saved cars` : `Save ${name || 'vehicle'}`}
            accessibilityState={{ selected: saved, busy: saveBusy, disabled: saveBusy }}
            disabled={saveBusy}
            onPress={(event) => {
              event.stopPropagation();
              onToggleSave();
            }}
            style={({ pressed }) => ({
              position: 'absolute',
              top: spacing[3],
              right: spacing[3],
              width: touchTarget.minimum,
              height: touchTarget.minimum,
              borderRadius: touchTarget.minimum / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.background.surface,
              borderWidth: 1,
              borderColor: saved ? theme.brand.primary : theme.border.default,
              opacity: saveBusy ? 0.55 : pressed ? 0.78 : 0.96,
            })}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={saved ? theme.brand.primaryPressed : theme.text.primary}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={{ padding: compact ? spacing[3] : spacing[4], gap: spacing[2] }}>
        <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }} numberOfLines={2}>
          {name || 'Vehicle'}
        </Text>
        <Price amount={item.price} currency={item.currency} compact={compact} />
        {facts ? (
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}

        {evaluated ? (
          <TrustSignal
            label="CarUp Trust evaluation available"
            detail={item.trust?.band ? String(item.trust.band).replace(/[_-]+/g, ' ') : undefined}
            tone="success"
          />
        ) : typeof item.evidence_count === 'number' && item.evidence_count > 0 ? (
          <TrustSignal
            label="Vehicle evidence available"
            detail={`${item.evidence_count} evidence record${item.evidence_count === 1 ? '' : 's'}`}
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], marginTop: spacing[1] }}>
          <View style={{ flex: 1 }}>
            {item.location ? (
              <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary }} numberOfLines={1}>
                {item.location}
              </Text>
            ) : null}
            {item.seller_display_label ? (
              <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }} numberOfLines={1}>
                {item.seller_display_label}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
        </View>
      </View>
    </Pressable>
  );
}
