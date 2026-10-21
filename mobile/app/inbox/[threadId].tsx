import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  EmptyState,
  Field,
  Notice,
  StatusPill,
} from '../../components/ui/NativePrimitives';
import {
  getCommunicationThread,
  markCommunicationThreadRead,
  sendCommunicationMessage,
} from '../../utils/communicationApi';
import {
  communicationChannelLabel,
  communicationParticipantContext,
  communicationSendFailureMessage,
  communicationThreadContext,
  communicationThreadTitle,
  communicationTitleCase,
} from '../../utils/communicationPresentation';
import { communicationQueryKeys, communicationQueryScope } from '../../utils/communicationQueries';
import { canonicalObjectRouteFromThread } from '../../utils/nativeObjectRouting';
import { vehicleHref } from '../../utils/vehicleNavigation';
import { useAuthStore } from '../../store/authStore';
import { outsideDeliveryNotice, useChannelReadiness } from '../../utils/channelReadiness';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function channelIcon(label: string | null): React.ComponentProps<typeof Ionicons>['name'] {
  if (label === 'WhatsApp') return 'logo-whatsapp';
  if (label === 'Telegram') return 'paper-plane-outline';
  if (label === 'Email') return 'mail-outline';
  if (label === 'Push') return 'notifications-outline';
  return 'chatbubbles-outline';
}

function messageText(message: any): string {
  return String(message?.text || message?.content_text || message?.message || '').trim();
}

function messageAuthor(message: any): string {
  if (message?.author?.is_self) return 'You';
  return (
    message?.author?.display_name ||
    message?.sender_display_name ||
    message?.sender_name ||
    communicationTitleCase(message?.author?.stakeholder_role) ||
    'CarUp participant'
  );
}

export default function NativeConversationScreen() {
  const readiness = useChannelReadiness();
  const theme = useNativeTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const scope = communicationQueryScope(user);
  const threadListKey = communicationQueryKeys.threads(scope);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const enabled = Boolean(!loading && isAuthenticated && user?.role === 'owner' && threadId);
  const query = useQuery({
    queryKey: communicationQueryKeys.thread(scope, String(threadId || '')),
    queryFn: () => getCommunicationThread(String(threadId)),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !threadId) return;
    void markCommunicationThreadRead(String(threadId))
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: threadListKey });
        await queryClient.refetchQueries({ queryKey: threadListKey });
      })
      .catch(() => {
        // Keep server unread truth if the receipt cannot be persisted.
      });
  }, [enabled, queryClient, threadId, scope.userId, scope.tenantId, scope.role]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const text = draft.trim();
      if (!text || !threadId) return null;
      setSendError(null);
      return sendCommunicationMessage(String(threadId), {
        channel: 'in_app',
        message: text,
      });
    },
    onSuccess: async () => {
      setDraft('');
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: threadListKey });
      await queryClient.refetchQueries({ queryKey: threadListKey });
    },
    onError: (error) => {
      // OC-NATIVE-FINAL-02-R1 P2-A: the raw API error ("Communication API returned HTTP 500") was shown.
      setSendError(communicationSendFailureMessage(error));
    },
  });

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading conversation" />
      </View>
    );
  }

  if (!isAuthenticated || user?.role !== 'owner') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Conversation unavailable"
          body="Sign in to your personal CarUp account to see this conversation."
          actionLabel="Back to Inbox"
          onAction={() => router.replace('/(tabs)/inbox' as never)}
        />
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading conversation" />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Conversation could not load"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void query.refetch()}
          secondaryLabel="Back to Inbox"
          onSecondary={() => router.replace('/(tabs)/inbox' as never)}
        />
      </View>
    );
  }

  const thread = query.data.thread || {};
  const messages = query.data.messages || [];
  const subject = communicationThreadTitle(thread);
  const contextRows = communicationThreadContext(thread);
  const participantRows = communicationParticipantContext(query.data.participants || []);
  const primaryChannel = communicationChannelLabel(thread?.primary_channel);
  const productRoute = canonicalObjectRouteFromThread(thread);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[8] }}
        keyboardShouldPersistTaps="handled"
      >
        <Button label="Back to Inbox" variant="tertiary" onPress={() => router.replace('/(tabs)/inbox' as never)} />

        <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, marginTop: spacing[4] }}>
          {subject}
        </Text>

        {(contextRows.length > 0 || participantRows.length > 0) ? (
          <View
            style={{
              marginTop: spacing[3],
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: theme.border.default,
              backgroundColor: theme.background.surface,
              padding: spacing[3],
              gap: spacing[2],
            }}
          >
            {[...contextRows.filter((row) => row.label !== 'Channel'), ...participantRows].map((row) => (
              <View key={`${row.label}:${row.value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] }}>
                <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{row.label}</Text>
                <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {primaryChannel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] }}>
            <Ionicons name={channelIcon(primaryChannel)} size={18} color={theme.text.secondary} />
            <StatusPill label={primaryChannel} />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, flex: 1 }}>
              Primary delivery channel
            </Text>
          </View>
        ) : null}

        {productRoute ? (
          <View style={{ marginTop: spacing[3] }}>
            <Button
              label="Open vehicle"
              variant="secondary"
              // CARUP-MVP-STAB-01 F-003: Back from the vehicle returns to this conversation.
              onPress={() => router.push(vehicleHref(productRoute.id, { from: 'inbox', threadId: String(threadId) }) as never)}
              icon={<Ionicons name="car-outline" size={19} color={theme.text.primary} />}
            />
          </View>
        ) : null}

        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="Your conversation stays in CarUp"
            body={[outsideDeliveryNotice(readiness), 'A message shows its channel only when CarUp recorded one.'].filter(Boolean).join(' ')}
            tone="info"
          />
        </View>

        <View style={{ marginTop: spacing[6], gap: spacing[3] }}>
          {messages.length === 0 ? (
            <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted }}>
              No messages in this conversation yet.
            </Text>
          ) : (
            messages.map((message: any, index: number) => {
              const text = messageText(message);
              if (!text) return null;
              const mine = Boolean(message?.author?.is_self);
              const channel = communicationChannelLabel(message?.channel);
              return (
                <View
                  key={String(message.id || index)}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '86%',
                    borderRadius: radius.card,
                    backgroundColor: mine ? theme.brand.primarySubtle : theme.background.surface,
                    borderWidth: 1,
                    borderColor: mine ? theme.brand.primary : theme.border.default,
                    padding: spacing[3],
                  }}
                >
                  <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
                    {messageAuthor(message)}
                  </Text>
                  <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.primary, marginTop: spacing[1] }}>
                    {text}
                  </Text>
                  {channel ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[2] }}>
                      <Ionicons name={channelIcon(channel)} size={14} color={theme.text.muted} />
                      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
                        {channel}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.border.default,
          backgroundColor: theme.background.surface,
          padding: spacing[4],
          gap: spacing[2],
        }}
      >
        <Field
          label="Message"
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="Write a message"
          style={{ minHeight: 72, textAlignVertical: 'top' }}
          error={sendError}
        />
        <Button
          label="Send through CarUp"
          onPress={() => sendMutation.mutate()}
          loading={sendMutation.isPending}
          disabled={!draft.trim()}
        />
      </View>
    </View>
  );
}
