import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Switch } from 'react-native';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import {
  createCommunicationShare,
  createCommunicationThread,
  listCommunicationNotifications,
  listCommunicationThreads,
  sendCommunicationMessage,
} from '../../utils/communicationApi';
import {
  PreferenceMutationBlockedError,
  preferenceFailureCopy,
  preferenceViewState,
  readCommunicationPreferences,
  savePreferenceChange,
  type PreferenceViewState,
} from '../../utils/communicationPreferences';

function CommunicationsScreenInner() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsFailed, setNotificationsFailed] = useState(false);
  const [threads, setThreads] = useState<any[]>([]);
  const [threadsFailed, setThreadsFailed] = useState(false);
  // OC-NATIVE-FINAL-02-R1 D2: a failed read is a failure state, never an empty preference object.
  const [preferenceView, setPreferenceView] = useState<PreferenceViewState>({ state: 'LOADING' });
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [listingId, setListingId] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function loadPreferences() {
    setPreferenceView({ state: 'LOADING' });
    try {
      setPreferenceView({ state: 'READY', preferences: await readCommunicationPreferences() });
    } catch (error) {
      setPreferenceView(preferenceViewState({ isPending: false, data: undefined, error }));
    }
  }

  async function load() {
    const [notificationRes, threadRes] = await Promise.allSettled([
      listCommunicationNotifications(),
      listCommunicationThreads(),
      loadPreferences(),
    ]);
    if (notificationRes.status === 'fulfilled') {
      setNotifications(notificationRes.value.notifications || []);
      setNotificationsFailed(false);
    } else {
      setNotificationsFailed(true);
    }
    if (threadRes.status === 'fulfilled') {
      setThreads(threadRes.value.threads || []);
      setThreadsFailed(false);
    } else {
      setThreadsFailed(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendSupport() {
    if (!message.trim()) return;
    // Without the current conversation list, sending could open a second support conversation.
    if (threadsFailed) {
      setStatus('Your conversations could not be loaded, so nothing was sent. Try again.');
      return;
    }
    setStatus('Sending');
    try {
      let thread = threads[0];
      if (!thread) {
        const created = await createCommunicationThread({ thread_type: 'support', channel: 'mobile_chat', metadata: { source: 'mobile_support_entry' } });
        thread = created.thread;
      }
      await sendCommunicationMessage(thread.id, { channel: 'mobile_chat', message });
      setMessage('');
      setStatus('Sent');
      await load();
    } catch {
      setStatus('Message not sent. Please try again.');
    }
  }

  async function savePreference(key: string, value: boolean) {
    setPreferenceStatus(null);
    try {
      setPreferenceView({ state: 'READY', preferences: await savePreferenceChange(preferenceView, key, value) });
    } catch (error) {
      setPreferenceStatus(error instanceof PreferenceMutationBlockedError
        ? error.message
        : 'CarUp could not confirm that change. These switches show the last values CarUp returned; try again.');
    }
  }

  async function createShare() {
    if (!listingId.trim()) return;
    const result = await createCommunicationShare({ channel: 'whatsapp', listing_id: listingId.trim(), referral_code: referralCode.trim() || undefined });
    setShareUrl(result.share_url || result.listing_url || null);
  }

  return (
    <ScrollView className="flex-1 bg-slate-50 px-5 py-5">
      <Text className="text-2xl font-bold text-slate-950">Communications</Text>
      <Text className="text-slate-500 mt-1 mb-5">Notifications, support, sharing, and preferences</Text>

      <View className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <Text className="font-bold text-slate-900 mb-3">Notifications</Text>
        {notificationsFailed ? (
          <View>
            <Text className="text-slate-500 text-sm">Your notifications could not be loaded.</Text>
            <Pressable onPress={() => void load()} accessibilityRole="button" className="mt-2">
              <Text className="text-orange-600 text-sm font-semibold">Try again</Text>
            </Pressable>
          </View>
        ) : notifications.length === 0 ? (
          <Text className="text-slate-500 text-sm">No notifications yet.</Text>
        ) : notifications.slice(0, 5).map((item) => (
          <View key={item.id} className="border-b border-slate-100 py-3">
            <Text className="text-slate-900 font-semibold">{item.title || item.notification_type}</Text>
            <Text className="text-slate-500 text-xs mt-1">{item.message}</Text>
          </View>
        ))}
      </View>

      <View className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <Text className="font-bold text-slate-900 mb-3">Support Chat</Text>
        {threads.slice(0, 3).map((thread) => (
          <Text key={thread.id} className="text-xs text-slate-500 mb-1">
            {thread.thread_type} · {thread.status} · {thread.primary_channel || 'mobile'}
          </Text>
        ))}
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Ask CarUp support"
          multiline
          style={{ minHeight: 84, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, marginTop: 12, textAlignVertical: 'top' }}
        />
        <Pressable onPress={sendSupport} className="bg-orange-500 rounded-xl py-3 items-center mt-3">
          <Text className="text-white font-semibold">Send</Text>
        </Pressable>
        {status && <Text className="text-slate-500 text-xs mt-2">{status}</Text>}
      </View>

      <View className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <Text className="font-bold text-slate-900 mb-3">Referral Share</Text>
        <TextInput value={listingId} onChangeText={setListingId} placeholder="Listing ID or VIN" className="border border-slate-200 rounded-xl px-3 py-3 mb-2" />
        <TextInput value={referralCode} onChangeText={setReferralCode} placeholder="Referral code" className="border border-slate-200 rounded-xl px-3 py-3 mb-3" />
        <Pressable onPress={createShare} className="bg-slate-900 rounded-xl py-3 items-center">
          <Text className="text-white font-semibold">Create WhatsApp Link</Text>
        </Pressable>
        {shareUrl && <Text className="text-slate-500 text-xs mt-2">{shareUrl}</Text>}
      </View>

      <View className="bg-white rounded-2xl border border-slate-100 p-4 mb-12">
        <Text className="font-bold text-slate-900 mb-3">Preferences</Text>
        {preferenceView.state === 'LOADING' ? (
          <Text className="text-slate-500 text-sm">Loading your delivery preferences…</Text>
        ) : preferenceView.state === 'READ_FAILED' ? (
          (() => {
            const copy = preferenceFailureCopy(preferenceView);
            return (
              <View>
                <Text className="text-slate-800 text-sm font-semibold">{copy.title}</Text>
                <Text className="text-slate-500 text-sm mt-1">{copy.body}</Text>
                {copy.action === 'retry' ? (
                  <Pressable onPress={() => void loadPreferences()} accessibilityRole="button" className="mt-2">
                    <Text className="text-orange-600 text-sm font-semibold">Try again</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })()
        ) : (
          [
            ['in_app_enabled', 'In-app'],
            ['push_enabled', 'Push'],
            ['email_enabled', 'Email'],
            ['whatsapp_enabled', 'WhatsApp'],
            ['sms_enabled', 'SMS'],
          ].map(([key, label]) => (
            <View key={key} className="flex-row items-center justify-between py-2">
              <Text className="text-slate-700">{label}</Text>
              <Switch
                value={Boolean(preferenceView.preferences[key])}
                onValueChange={(value) => void savePreference(key, value)}
                testID={`communication-pref-${key}`}
              />
            </View>
          ))
        )}
        {preferenceStatus ? <Text className="text-rose-600 text-xs mt-2">{preferenceStatus}</Text> : null}
      </View>
    </ScrollView>
  );
}

/**
 * Owner-protected route boundary (Milestone C). Communications is governed by
 * owner.communications (owner-only, requiresAuth). A deep link / direct nav is
 * gated by the SAME governed decision that hides the tab for non-owners, and
 * the mount-time load() (notifications/threads/preferences) lives in the inner
 * component so no API call fires before the gate admits the user.
 */
export default function CommunicationsScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/communications" featureId="owner.communications">
      <CommunicationsScreenInner />
    </NativeFeatureBoundary>
  );
}

