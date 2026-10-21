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
 * `@/lib/communicationChannels`): a saved preference is never provider readiness, so a channel can be
 * turned ON only while `channelAvailability` says `available`. Turning a channel OFF is always
 * allowed — withdrawing consent is never blocked by provider readiness — so a switch that is on stays
 * operable whatever the channel can do (lead decision, CARUP-MVP-STAB-01). The save path enforces the
 * same rule on its own (`savePreferenceChange`), so the refusal does not depend on a disabled control.
 *
 * Transactional and marketing are consent categories, not channels — they stay editable whatever the
 * channels can do. There are no Facebook or Instagram preference keys anywhere, so none are offered.
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
  /** True only when the runtime can deliver on this channel now. Turning OFF never needs this. */
  canEnable: boolean
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
    canEnable: availability === 'available',
    note: why ? `${label} — ${why}` : label,
  }
}

/**
 * Whether a channel switch can be operated from where it stands: one that is ON can always be
 * turned off; one that is OFF can be turned on only while the channel is available.
 */
export function channelSwitchOperable(control: ChannelControl, checked: boolean): boolean {
  return checked || control.canEnable
}

export type PreferenceRefusal = 'not_read' | 'not_offered' | 'channel_unavailable'

export type PreferenceSaveOutcome =
  /** CarUp confirmed the new value; `preferences` is its answer over the last confirmed values. */
  | { outcome: 'saved'; preferences: DeliveryPreferences }
  /** CarUp answered without confirming the change; `preferences` is what it did confirm. */
  | { outcome: 'not_confirmed'; preferences: DeliveryPreferences }
  /** The request failed or answered with no preferences: the last confirmed values stand. */
  | { outcome: 'failed' }
  /** Nothing was sent. */
  | { outcome: 'refused'; reason: PreferenceRefusal }

export function preferenceRefusalCopy(reason: PreferenceRefusal, label?: string): string {
  switch (reason) {
    case 'channel_unavailable':
      return `${label || 'This channel'} can't be turned on until it is available. You can turn it off at any time.`
    case 'not_read':
      return 'Your current delivery preferences have not been read, so nothing was changed.'
    case 'not_offered':
    default:
      return 'This preference cannot be changed here.'
  }
}

/**
 * The one save path. Refuses before a successful read (D2), refuses keys this page does not offer,
 * and refuses ENABLING a channel the runtime cannot deliver on — disabling is always sent. Sends only
 * the one key that changed.
 */
export async function savePreferenceChange({
  view,
  key,
  value,
  capability,
  checking = false,
  save,
}: {
  view: PreferenceView
  key: string
  value: boolean
  capability: CommunicationCapability
  checking?: boolean
  save: (patch: Record<string, boolean>) => Promise<unknown>
}): Promise<PreferenceSaveOutcome> {
  if (view.state !== 'ready') return { outcome: 'refused', reason: 'not_read' }
  const channelRow = CHANNEL_ROWS.find((row) => row.key === key)
  const consentRow = CONSENT_ROWS.find((row) => row.key === key)
  if (!channelRow && !consentRow) return { outcome: 'refused', reason: 'not_offered' }
  if (channelRow && value && !channelControl(capability, channelRow.channel, { checking }).canEnable) {
    return { outcome: 'refused', reason: 'channel_unavailable' }
  }
  let body: unknown
  try {
    body = await save({ [key]: value })
  } catch {
    return { outcome: 'failed' }
  }
  const confirmed = preferencesFrom(body)
  if (!confirmed) return { outcome: 'failed' }
  const preferences = { ...view.preferences, ...confirmed }
  return Boolean(preferences[key]) === value
    ? { outcome: 'saved', preferences }
    : { outcome: 'not_confirmed', preferences }
}
