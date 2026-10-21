import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VehicleImage } from '../media/NativeMedia';
import { Price, StatusPill, TrustSignal } from '../ui/NativePrimitives';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';
import { resolveMarketplacePrimaryImage, type MobileListingSummary } from '../../utils/marketplaceApi';
import { presentTrustForCustomer } from '@shared/trust/customerTrustPresentation';

export interface VehicleCardTrustSignal {
  label: string;
  detail?: string;
  tone: 'neutral';
}

function sentenceCase(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : words;
}

/**
 * CARUP-MVP-STAB-01 F-010 / F-013: what a list card says about Trust. An evaluation is labelled with
 * how much it can be relied on (its confidence and how many facts were independently confirmed), and
 * it is never given a success tone: a low or insufficient-evidence result is not good news.
 */
export function vehicleCardTrustSignal(
  item: Pick<MobileListingSummary, 'trust' | 'evidence_count'>,
): VehicleCardTrustSignal | null {
  const presented = presentTrustForCustomer(item.trust);
  if (presented.evaluated && Number.isFinite(item.trust?.score)) {
    const band = item.trust?.band ? sentenceCase(String(item.trust.band)) : '';
    const support = presented.substantiatedFacts !== null && presented.governedFactsTotal !== null
      ? presented.evidenceSupportValue
      : '';
    return {
      label: `Trust evaluated · Confidence ${presented.confidenceValue.toLowerCase()}`,
      detail: [band, support].filter(Boolean).join(' · ') || undefined,
      tone: 'neutral',
    };
  }
  if (typeof item.evidence_count === 'number' && item.evidence_count > 0) {
    return {
      label: 'Vehicle evidence available',
      detail: `${item.evidence_count} evidence record${item.evidence_count === 1 ? '' : 's'}`,
      tone: 'neutral',
    };
  }
  return null;
}

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
  const trustSignal = vehicleCardTrustSignal(item);

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

        {trustSignal ? (
          <TrustSignal label={trustSignal.label} detail={trustSignal.detail} tone={trustSignal.tone} />
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
