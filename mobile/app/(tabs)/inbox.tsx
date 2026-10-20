import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Notice, SectionHeader, StatusPill } from '../../components/ui/NativePrimitives';
import {
  listCommunicationNotifications,
  listCommunicationThreads,
  markCommunicationNotificationRead,
} from '../../utils/communicationApi';
import {
  communicationChannelLabel,
  communicationThreadContext,
  communicationThreadTitle,
} from '../../utils/communicationPresentation';
import { communicationQueryKeys, communicationQueryScope } from '../../utils/communicationQueries';
import {
  canonicalObjectRouteFromCommunicationNotification,
  nativeCanonicalObjectHref,
} from '../../utils/nativeObjectRouting';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function channelIcon(label: string | null): React.ComponentProps<typeof Ionicons>['name'] {
  if (label === 'WhatsApp') return 'logo-whatsapp';
  if (label === 'Telegram') return 'paper-plane-outline';
  if (label === 'Email') return 'mail-outline';
  if (label === 'Push') return 'notifications-outline';
  return 'chatbubbles-outline';
}

export default function InboxScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const scope = communicationQueryScope(user);

  const enabled = !loading && isAuthenticated && user?.role === 'owner';
  const threadsQuery = useQuery({
    queryKey: communicationQueryKeys.threads(scope),
    queryFn: () => listCommunicationThreads(),
    enabled,
  });
  const notificationsQuery = useQuery({
    queryKey: communicationQueryKeys.notifications(scope),
    queryFn: () => listCommunicationNotifications(),
    enabled,
  });

  const refreshInbox = async () => {
    await Promise.all([threadsQuery.refetch(), notificationsQuery.refetch()]);
  };

  const openNotification = async (item: any) => {
    const target = canonicalObjectRouteFromCommunicationNotification(item);
    if (!target) return;
    if (item?.id) {
      await markCommunicationNotificationRead(String(item.id)).catch(() => null);
      await queryClient.invalidateQueries({ queryKey: communicationQueryKeys.notifications(scope) });
    }
    router.push(nativeCanonicalObjectHref(target) as never);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Inbox" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Your messages live here"
          body="Sign in to continue CarUp conversations about vehicles, support and transactions."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
        />
      </View>
    );
  }

  if (user?.role !== 'owner') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Inbox is not available for this workspace yet"
          body="You are still signed in. Your conversations will appear here once the Inbox is available for this workspace in the app."
          actionLabel="Go to Account"
          onAction={() => router.push('/(tabs)/account' as never)}
        />
      </View>
    );
  }

  const threads = threadsQuery.data?.threads || [];
  const notifications = notificationsQuery.data?.notifications || [];
  const hasError = threadsQuery.isError || notificationsQuery.isError;
  const isLoading = threadsQuery.isLoading || notificationsQuery.isLoading;
  const refreshing = threadsQuery.isRefetching || notificationsQuery.isRefetching;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshInbox()} />}
    >
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Inbox</Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1], marginBottom: spacing[4] }}>
        Your conversations stay in CarUp. WhatsApp or email can carry messages, but the conversation is kept here.
      </Text>

      {hasError ? (
        <Notice
          title="Inbox could not refresh"
          body="Check your connection and try again. Nothing is shown in place of conversations CarUp could not load."
          tone="danger"
        />
      ) : null}

      {isLoading ? (
        <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading conversations" />
        </View>
      ) : threads.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No conversations yet"
          body="When you message a seller or contact CarUp, the conversation will appear here."
          secondaryLabel="Browse cars"
          onSecondary={() => router.push('/(tabs)/marketplace' as never)}
        />
      ) : (
        <View style={{ gap: spacing[3] }}>
          <SectionHeader title="Conversations" />
          {threads.map((thread: any) => {
            const title = communicationThreadTitle(thread);
            const contextRows = communicationThreadContext(thread);
            const channel = communicationChannelLabel(thread?.primary_channel);
            const unread = Math.max(0, Number(thread?.unread_count || 0));
            return (
              <Pressable
                key={String(thread.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${title}`}
                accessibilityHint={contextRows.length
                  ? contextRows.map((row) => `${row.label}: ${row.value}`).join('. ')
                  : 'Open this CarUp conversation'}
                onPress={() => router.push(`/inbox/${thread.id}` as never)}
                style={({ pressed }) => ({
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: theme.border.default,
                  backgroundColor: theme.background.surface,
                  padding: spacing[4],
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: spacing[3],
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: theme.background.surfaceSunken,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={channelIcon(channel)} size={22} color={theme.text.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                    {title}
                  </Text>
                  {contextRows
                    .filter((row) => row.label !== 'Channel')
                    .slice(0, 3)
                    .map((row) => (
                      <Text
                        key={`${row.label}:${row.value}`}
                        allowFontScaling
                        numberOfLines={1}
                        style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}
                      >
                        {row.label}: {row.value}
                      </Text>
                    ))}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] }}>
                    {channel ? <StatusPill label={channel} tone="neutral" /> : null}
                    {unread > 0 ? <StatusPill label={`${unread} unread`} tone="info" /> : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {notifications.length > 0 ? (
        <View style={{ marginTop: spacing[6] }}>
          <SectionHeader title="Recent updates" />
          {notifications.slice(0, 3).map((item: any) => {
            const target = canonicalObjectRouteFromCommunicationNotification(item);
            return (
              <Pressable
                key={String(item.id)}
                accessibilityRole={target ? 'button' : undefined}
                accessibilityLabel={target ? `Open ${item.title || 'CarUp update'}` : undefined}
                disabled={!target}
                onPress={() => void openNotification(item)}
                style={({ pressed }) => ({
                  paddingVertical: spacing[3],
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border.default,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                    {item.title || 'CarUp update'}
                  </Text>
                  {item.message ? (
                    <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
                      {item.message}
                    </Text>
                  ) : null}
                  {!target ? (
                    <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1] }}>
                      There is nothing to open for this update in the app.
                    </Text>
                  ) : null}
                </View>
                {target ? <Ionicons name="chevron-forward" size={18} color={theme.text.muted} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {hasError ? (
        <Button
          label="Try again"
          variant="secondary"
          onPress={() => void refreshInbox()}
          style={{ marginTop: spacing[5] }}
        />
      ) : null}
    </ScrollView>
  );
}
