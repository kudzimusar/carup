import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Notice, SectionHeader, StatusPill } from '../../components/ui/NativePrimitives';
import { listCommunicationNotifications, listCommunicationThreads } from '../../utils/communicationApi';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function conversationTitle(thread: any): string {
  return (
    thread?.metadata?.vehicle_title ||
    thread?.metadata?.subject ||
    thread?.subject ||
    (thread?.thread_type === 'support' ? 'CarUp support' : 'CarUp conversation')
  );
}

function conversationContext(thread: any): string | null {
  const vehicle =
    thread?.metadata?.vehicle_label ||
    thread?.metadata?.listing_title ||
    thread?.metadata?.vin ||
    null;
  return typeof vehicle === 'string' && vehicle.trim() ? vehicle.trim() : null;
}

function channelLabel(thread: any): string | null {
  const raw = String(thread?.primary_channel || thread?.channel || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('whatsapp')) return 'WhatsApp';
  if (raw.includes('telegram')) return 'Telegram';
  if (raw.includes('email')) return 'Email';
  if (raw.includes('push')) return 'Push';
  if (raw.includes('mobile') || raw.includes('in_app')) return 'CarUp';
  return null;
}

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
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  const enabled = !loading && isAuthenticated && user?.role === 'owner';
  const threadsQuery = useQuery({
    queryKey: ['native-inbox-threads', user?.id],
    queryFn: () => listCommunicationThreads(),
    enabled,
  });
  const notificationsQuery = useQuery({
    queryKey: ['native-inbox-notifications', user?.id],
    queryFn: () => listCommunicationNotifications(),
    enabled,
  });

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
          body="Your account stays signed in. CarUp will only show native conversation capabilities that are enabled for your current workspace."
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
      refreshControl={undefined}
    >
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Inbox</Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1], marginBottom: spacing[4] }}>
        CarUp is the conversation record. Delivery channels can carry messages without replacing the conversation.
      </Text>

      {hasError ? (
        <Notice
          title="Inbox could not refresh"
          body="Check your connection and try again. CarUp will not invent conversation state while the service is unavailable."
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
            const channel = channelLabel(thread);
            const context = conversationContext(thread);
            const unread = Number(thread?.unread_count || 0);
            return (
              <Pressable
                key={String(thread.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${conversationTitle(thread)}`}
                accessibilityHint={context ? `Vehicle context: ${context}` : 'Open this CarUp conversation'}
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
                    {conversationTitle(thread)}
                  </Text>
                  {context ? (
                    <Text allowFontScaling numberOfLines={1} style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}>
                      {context}
                    </Text>
                  ) : null}
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
          {notifications.slice(0, 3).map((item: any) => (
            <View key={String(item.id)} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border.default }}>
              <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                {item.title || 'CarUp update'}
              </Text>
              {item.message ? (
                <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
                  {item.message}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {hasError ? (
        <Button
          label="Try again"
          variant="secondary"
          onPress={() => {
            void threadsQuery.refetch();
            void notificationsQuery.refetch();
          }}
          style={{ marginTop: spacing[5] }}
        />
      ) : null}
    </ScrollView>
  );
}
