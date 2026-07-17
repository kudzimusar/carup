import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Switch } from 'react-native';
import {
  createCommunicationShare,
  createCommunicationThread,
  getCommunicationPreferences,
  listCommunicationNotifications,
  listCommunicationThreads,
  sendCommunicationMessage,
  updateCommunicationPreferences,
} from '../../utils/communicationApi';

export default function CommunicationsScreen() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [preferences, setPreferences] = useState<any>({});
  const [message, setMessage] = useState('');
  const [listingId, setListingId] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function load() {
    const [notificationRes, threadRes, prefRes] = await Promise.all([
      listCommunicationNotifications().catch(() => ({ notifications: [] })),
      listCommunicationThreads().catch(() => ({ threads: [] })),
      getCommunicationPreferences().catch(() => ({ preferences: {} })),
    ]);
    setNotifications(notificationRes.notifications || []);
    setThreads(threadRes.threads || []);
    setPreferences(prefRes.preferences || {});
  }

  useEffect(() => {
    load();
  }, []);

  async function sendSupport() {
    if (!message.trim()) return;
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send message');
    }
  }

  async function savePreferences(next: any) {
    setPreferences(next);
    const saved = await updateCommunicationPreferences(next);
    setPreferences(saved.preferences || next);
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
        {notifications.length === 0 ? (
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
        {[
          ['in_app_enabled', 'In-app'],
          ['push_enabled', 'Push'],
          ['email_enabled', 'Email'],
          ['whatsapp_enabled', 'WhatsApp'],
          ['sms_enabled', 'SMS'],
        ].map(([key, label]) => (
          <View key={key} className="flex-row items-center justify-between py-2">
            <Text className="text-slate-700">{label}</Text>
            <Switch
              value={Boolean(preferences?.[key])}
              onValueChange={(value) => savePreferences({ ...(preferences || {}), [key]: value })}
              testID={`communication-pref-${key}`}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

