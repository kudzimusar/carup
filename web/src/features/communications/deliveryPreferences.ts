/**
 * CARUP-MVP-STAB-01 F-018 (web) — delivery preferences: what was read, and what can be changed.
 *
 * Mirrors the native D2 semantics (mobile/utils/communicationPreferences.ts):
 *  - a preference set is shown only when CarUp returned one; a failed or malformed read is a
 *    failure state, never an empty object rendered as "everything off";
 *  - nothing can change before a successful read, and a change sends only the one preference the
 *    person changed;
 *  - a save is reported as saved only when CarUp's answer confirms the new value.
 *
 * Channel switches follow runtime readiness (shared/communication/channelReadiness.ts via
 * `@/lib/communicationChannels`): a saved preference is never provider readiness, so a channel is
 * offered as a working switch only while `channelAvailability` says `available`. Transactional and
 * marketing are consent categories, not channels — they stay editable whatever the channels can do.
 * There are no Facebook or Instagram preference keys anywhere, so none are offered.
 */
import {
  CHANNEL_AVAILABILITY_LABEL,
  channelAvailability,
  type ChannelAvailability,
  type CommunicationCapability,
} from '@/lib/communicationChannels'

export type DeliveryPreferences = Record<string, unknown>

export type PreferenceView =
  | { state: 'loading' }
  | { state: 'ready'; preferences: DeliveryPreferences }
  | { state: 'read_failed' }

export const PREFERENCES_READ_FAILED = 'Delivery preferences could not be loaded.'
export const PREFERENCE_SAVE_FAILED = 'Preferences were not saved. Try again.'
export const PREFERENCE_SAVED = 'Preference saved.'

/** The preferences object a response carries, or null when it carries none. */
export function preferencesFrom(body: unknown): DeliveryPreferences | null {
  const preferences = (body as { preferences?: unknown } | null | undefined)?.preferences
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return null
  return preferences as DeliveryPreferences
}

/** Read the current preferences into a view state. Never throws, never invents values. */
export async function readPreferenceView(read: () => Promise<unknown>): Promise<PreferenceView> {
  try {
    const preferences = preferencesFrom(await read())
    return preferences ? { state: 'ready', preferences } : { state: 'read_failed' }
  } catch {
    return { state: 'read_failed' }
  }
}

export interface ConsentRow {
  key: string
  label: string
  description: string
}

export interface ChannelRow {
  key: string
  label: string
  /** The channel name in the readiness reading. */
  channel: string
}

export const CONSENT_ROWS: readonly ConsentRow[] = [
  {
    key: 'transactional_enabled',
    label: 'Transactional updates',
    description: 'Messages about your own conversations, listings and purchases.',
  },
  {
    key: 'marketing_enabled',
    label: 'Marketing',
    description: 'Consent only: allows CarUp to send you offers and news. It does not switch on any channel.',
  },
]

export const CHANNEL_ROWS: readonly ChannelRow[] = [
  { key: 'in_app_enabled', label: 'In-app', channel: 'in_app' },
  { key: 'email_enabled', label: 'Email', channel: 'email' },
  { key: 'push_enabled', label: 'Push', channel: 'push' },
  { key: 'whatsapp_enabled', label: 'WhatsApp', channel: 'whatsapp' },
  { key: 'sms_enabled', label: 'SMS', channel: 'sms' },
]

export interface ChannelControl {
  availability: ChannelAvailability
  /** True only when the runtime can deliver on this channel now. */
  editable: boolean
  /** "Available", "Temporarily unavailable", … plus, when not available, why — in plain words. */
  note: string
}

function explanation(channel: string, availability: ChannelAvailability): string | null {
  const internal = channel === 'in_app'
  switch (availability) {
    case 'available':
    case 'checking':
      return null
    case 'temporarily_unavailable':
      return internal
        ? 'In-app delivery is paused right now.'
        : "CarUp isn't sending outside the app right now. Your messages stay in your CarUp Inbox."
    case 'setup_pending':
      return internal ? 'In-app delivery is not switched on for CarUp yet.' : 'Not set up for CarUp yet.'
    case 'not_offered':
      return 'CarUp does not offer this channel.'
    case 'unknown':
    default:
      return 'Could not check this channel right now.'
  }
}

export function channelControl(
  capability: CommunicationCapability,
  channel: string,
  { checking = false }: { checking?: boolean } = {},
): ChannelControl {
  const availability = channelAvailability(capability, channel, { checking })
  const why = explanation(channel, availability)
  const label = CHANNEL_AVAILABILITY_LABEL[availability]
  return {
    availability,
    editable: availability === 'available',
    note: why ? `${label} — ${why}` : label,
  }
}
