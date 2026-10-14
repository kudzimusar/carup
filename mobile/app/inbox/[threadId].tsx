import React, { useEffect, useMemo, useState } from 'react';
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
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function channelLabel(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('whatsapp')) return 'WhatsApp';
  if (raw.includes('telegram')) return 'Telegram';
  if (raw.includes('email')) return 'Email';
  if (raw.includes('push')) return 'Push';
  return 'CarUp';
}

function channelIcon(label: string): React.ComponentProps<typeof Ionicons>['name'] {
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
    message?.author?.stakeholder_role ||
    'CarUp participant'
  );
}

export default function NativeConversationScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const enabled = Boolean(!loading && isAuthenticated && user?.role === 'owner' && threadId);
  const query = useQuery({
    queryKey: ['native-conversation', threadId],
    queryFn: () => getCommunicationThread(String(threadId)),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !threadId) return;
    void markCommunicationThreadRead(String(threadId))
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['native-inbox-threads'] });
      })
      .catch(() => {
        // Keep server unread truth if the receipt cannot be persisted.
      });
  }, [enabled, queryClient, threadId]);

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
      await queryClient.invalidateQueries({ queryKey: ['native-inbox-threads'] });
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : 'CarUp could not send this message.');
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
          body="Sign in with an account that can use the native CarUp Inbox."
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
          onSecondary={() => router.back()}
        />
      </View>
    );
  }

  const thread = query.data.thread || {};
  const messages = query.data.messages || [];
  const subject =
    thread?.metadata?.vehicle_title ||
    thread?.metadata?.subject ||
    thread?.subject ||
    (thread?.thread_type === 'support' ? 'CarUp support' : 'CarUp conversation');
  const vehicleContext =
    thread?.metadata?.vehicle_label ||
    thread?.metadata?.listing_title ||
    thread?.metadata?.vin ||
    thread?.marketplace_listing_id ||
    null;
  const primaryChannel = channelLabel(thread?.primary_channel || thread?.channel);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[8] }}
        keyboardShouldPersistTaps="handled"
      >
        <Button label="Back to Inbox" variant="tertiary" onPress={() => router.back()} />

        <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, marginTop: spacing[4] }}>
          {subject}
        </Text>
        {vehicleContext ? (
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
            {String(vehicleContext)}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] }}>
          <Ionicons name={channelIcon(primaryChannel)} size={18} color={theme.text.secondary} />
          <StatusPill label={primaryChannel} />
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, flex: 1 }}>
            Delivery channel
          </Text>
        </View>

        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="CarUp is the conversation record"
            body="WhatsApp, Telegram, Email or Push may carry a message when enabled, but they do not replace this CarUp conversation."
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
              const channel = channelLabel(message?.channel);
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[2] }}>
                    <Ionicons name={channelIcon(channel)} size={14} color={theme.text.muted} />
                    <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
                      {channel}
                    </Text>
                  </View>
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
