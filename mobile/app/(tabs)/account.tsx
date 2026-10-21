import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  Notice,
  SectionHeader,
  StatusPill,
} from '../../components/ui/NativePrimitives';
import {
  canChangeChannelPreference,
  channelPreferenceChangeAllowed,
  PreferenceMutationBlockedError,
  preferenceFailureCopy,
  preferenceViewState,
  readCommunicationPreferences,
  savePreferenceChange,
  shouldRetryPreferenceRead,
  type CommunicationPreferences,
} from '../../utils/communicationPreferences';
import { channelSwitchPresentation, preferenceChannelAvailability, useChannelReadiness } from '../../utils/channelReadiness';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';
import { evaluateNativeRouteAccess } from '../../navigation/evaluateNativeRouteAccess';

const CHANNELS = [
  { key: 'push_enabled', label: 'Push', note: 'Device notifications' },
  { key: 'whatsapp_enabled', label: 'WhatsApp', note: 'WhatsApp delivery' },
  { key: 'telegram_enabled', label: 'Telegram', note: 'Telegram delivery' },
  { key: 'email_enabled', label: 'Email', note: 'Email delivery' },
] as const;

export default function AccountScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const effectiveStates = useFeatureGovernanceStore((state) => state.effectiveStates);
  const governanceLoading = useFeatureGovernanceStore((state) => state.loading);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  // OC-NATIVE-FINAL-02-R1 D2: toggles show only values CarUp returned; a failed read shows no toggle.
  const preferenceQuery = useQuery<CommunicationPreferences>({
    queryKey: ['native-communication-preferences', user?.id],
    queryFn: () => readCommunicationPreferences(),
    enabled: !loading && isAuthenticated && user?.role === 'owner',
    retry: shouldRetryPreferenceRead,
  });
  const preferenceView = preferenceViewState({
    isPending: preferenceQuery.isPending,
    data: preferenceQuery.data,
    error: preferenceQuery.error,
  });
  // CARUP-MVP-STAB-01 F-018: a switch works only for a channel CarUp can deliver on right now.
  const readiness = useChannelReadiness({ enabled: !loading && isAuthenticated && user?.role === 'owner' });

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading account" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="person-circle-outline"
          title="Your CarUp account"
          body="Sign in to see your vehicles, selling tools and account settings."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
        />
      </View>
    );
  }

  const canUse = (route: string, featureId: string): boolean => {
    if (governanceLoading) return false;
    const decision = evaluateNativeRouteAccess({
      route,
      featureId,
      isBootstrapping: false,
      isAuthenticated,
      role: user?.role ?? null,
      effectiveStates,
      hasNativeScreen: true,
    });
    return decision.kind === 'render' || decision.kind === 'render-beta';
  };

  const canUseGarage = canUse('/dashboard/garage', 'owner.garage');
  const canUseSafePay = canUse('/dashboard/escrow', 'owner.listings');
  const canUseReferrals = canUse('/dashboard/referral', 'owner.referrals');

  const saveChannel = async (key: string, value: boolean) => {
    // Turning a channel off is never blocked; turning one on needs a channel CarUp can deliver on now.
    if (savingChannel || !channelPreferenceChangeAllowed(preferenceChannelAvailability(readiness, key), value)) return;
    setPreferenceError(null);
    setSavingChannel(key);
    try {
      const saved = await savePreferenceChange(preferenceView, key, value);
      queryClient.setQueryData(['native-communication-preferences', user?.id], saved);
    } catch (error) {
      setPreferenceError(error instanceof PreferenceMutationBlockedError
        ? error.message
        : 'CarUp could not confirm that change. These switches show the last values CarUp returned; try again.');
    } finally {
      setSavingChannel(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ padding: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
    >
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Account</Text>
      {user?.name ? (
        <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, marginTop: spacing[2] }}>
          {user.name}
        </Text>
      ) : null}
      {user?.email ? (
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
          {user.email}
        </Text>
      ) : null}
      {user?.role ? (
        <View style={{ marginTop: spacing[3] }}>
          <StatusPill label={user.role === 'owner' ? 'Personal account' : user.role.replace(/[_-]+/g, ' ')} />
        </View>
      ) : null}

      <View style={{ marginTop: spacing[7] }}>
        <SectionHeader title="My CarUp" />
        <View style={{ gap: spacing[3] }}>
          {user?.role === 'owner' ? (
            <>
              {canUseGarage ? <Button label="My vehicles" variant="secondary" onPress={() => router.push('/(tabs)/garage' as never)} /> : null}
              <Button label="Selling" variant="secondary" onPress={() => router.push('/sell' as never)} />
              <Button label="Inbox / Messages" variant="secondary" onPress={() => router.push('/(tabs)/inbox' as never)} />
              {canUseSafePay ? <Button label="SafePay" variant="secondary" onPress={() => router.push('/(tabs)/escrow' as never)} /> : null}
              {canUseReferrals ? <Button label="Referrals" variant="secondary" onPress={() => router.push('/(tabs)/referral' as never)} /> : null}
            </>
          ) : null}
          <Button label="Verification" variant="secondary" onPress={() => router.push('/(auth)/verification/intro' as never)} />
        </View>
      </View>

      {user?.role === 'owner' ? (
        <View style={{ marginTop: spacing[7] }}>
          <SectionHeader title="Messages & delivery" />
          <Notice
            title="CarUp Inbox is the record"
            body="Your CarUp conversation history stays in CarUp. These settings choose how CarUp may deliver updates around that conversation."
            tone="info"
          />

          {preferenceView.state === 'LOADING' ? (
            <View style={{ paddingVertical: spacing[6], alignItems: 'center' }}>
              <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading delivery preferences" />
            </View>
          ) : preferenceView.state === 'READ_FAILED' ? (
            (() => {
              const copy = preferenceFailureCopy(preferenceView);
              return (
                <View style={{ marginTop: spacing[3] }}>
                  <Notice title={copy.title} body={copy.body} tone="danger" />
                  {copy.action === 'retry' ? (
                    <Button label="Try again" variant="secondary" onPress={() => void preferenceQuery.refetch()} style={{ marginTop: spacing[3] }} />
                  ) : copy.action === 'sign_in' ? (
                    <Button label="Sign in" variant="secondary" onPress={() => router.push('/(auth)/login' as never)} style={{ marginTop: spacing[3] }} />
                  ) : null}
                </View>
              );
            })()
          ) : (
            <View style={{ marginTop: spacing[3] }}>
              {CHANNELS.map((channel) => {
                const delivery = channelSwitchPresentation(readiness, channel.key);
                const current = Boolean(preferenceView.preferences[channel.key]);
                // An ON switch can always be turned off; an OFF one turns on only for an available channel.
                const changeable = canChangeChannelPreference(preferenceView, delivery.availability, current);
                const disabled = Boolean(savingChannel) || !changeable;
                return (
                  <View
                    key={channel.key}
                    style={{
                      minHeight: 64,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: spacing[4],
                      borderBottomWidth: 1,
                      borderBottomColor: theme.border.default,
                      paddingVertical: spacing[2],
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>{channel.label}</Text>
                      {delivery.available ? (
                        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>{channel.note}</Text>
                      ) : (
                        <>
                          <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, marginTop: 2 }}>{delivery.statusLabel}</Text>
                          {delivery.explanation ? (
                            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>{delivery.explanation}</Text>
                          ) : null}
                        </>
                      )}
                    </View>
                    <Switch
                      accessibilityLabel={`${channel.label} delivery`}
                      accessibilityHint={delivery.available ? undefined : [delivery.statusLabel, delivery.explanation].filter(Boolean).join('. ')}
                      accessibilityState={{ disabled }}
                      disabled={disabled}
                      value={current}
                      onValueChange={(value) => void saveChannel(channel.key, value)}
                    />
                  </View>
                );
              })}
            </View>
          )}

          {preferenceError ? (
            <View style={{ marginTop: spacing[3] }}>
              <Notice title="Preference not saved" body={preferenceError} tone="danger" />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: spacing[7] }}>
          <Notice
            title="Professional workspace"
            body="CarUp will show professional tools here only when that workspace is available on mobile. Your account access does not change."
            tone="info"
          />
        </View>
      )}

      <View style={{ marginTop: spacing[8] }}>
        <Button
          label="Sign out"
          variant="tertiary"
          onPress={() => {
            void logout().then(() => router.replace('/(tabs)' as never));
          }}
        />
      </View>
    </ScrollView>
  );
}
