const DEFAULT_LIMIT = 100;

export async function listUserNotifications(supabaseClient, recipientId, { limit = DEFAULT_LIMIT } = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, DEFAULT_LIMIT));
  const [currentResult, legacyResult] = await Promise.all([
    supabaseClient
      .from('notification_queue')
      .select('*')
      .eq('recipient_user_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(boundedLimit),
    supabaseClient
      .from('notification_queue')
      .select('*')
      .is('recipient_user_id', null)
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(boundedLimit),
  ]);

  if (currentResult.error) throw currentResult.error;
  if (legacyResult.error) throw legacyResult.error;

  const byId = new Map();
  for (const notification of [...(currentResult.data || []), ...(legacyResult.data || [])]) {
    if (notification?.id) byId.set(notification.id, notification);
  }
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, boundedLimit);
}
