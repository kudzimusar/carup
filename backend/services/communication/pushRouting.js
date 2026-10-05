/**
 * OC-EXPO-02R — the one definition of what a push routing credential looks like on a payload.
 *
 * A push notification is addressed by `recipient_user_id` / `recipient_identity_id`. The Expo token
 * lives in `channel_identities` and is resolved by the delivery worker at dispatch, so none of these
 * keys may be stored on a push `notification_queue` row, copied into a push fallback, or delivered to
 * the device as notification data.
 */
export const PUSH_ROUTING_KEYS = Object.freeze(['expo_push_token', 'push_token', 'address', 'external_id', 'to']);

export function withoutPushRouting(payload = {}) {
  const durable = { ...(payload || {}) };
  for (const key of PUSH_ROUTING_KEYS) delete durable[key];
  return durable;
}
