/**
 * CARUP-MVP-STAB-01 F-018 — which delivery channels can operate right now, read from CarUp's own
 * `/api/health` evidence through the same shared reading the web uses.
 *
 * A saved preference is never provider readiness. A channel may be turned ON only when this reading
 * says it is `available`; while the reading is in progress, failed or unreadable, no channel is treated
 * as available (in-app included), and the person is told so. Turning a channel OFF is never blocked:
 * withdrawing consent does not depend on provider readiness.
 */
import { useQuery } from '@tanstack/react-query';
import { apiUrl } from './apiBase';
import {
  CHANNEL_AVAILABILITY_LABEL,
  UNKNOWN_CAPABILITY,
  channelAvailability,
  readCommunicationCapability,
  type ChannelAvailability,
  type CommunicationCapability,
} from '@shared/communication/channelReadiness';

export { CHANNEL_AVAILABILITY_LABEL };
export type { ChannelAvailability, CommunicationCapability };

export const CHANNEL_HEALTH_TIMEOUT_MS = 8000;
/** One reading serves every preference surface for this long; a failed reading is never kept. */
export const CHANNEL_READINESS_STALE_MS = 30_000;
export const channelReadinessQueryKey = ['native-channel-readiness'] as const;

export class ChannelReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelReadinessError';
  }
}

type HealthFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/**
 * GET /api/health without any session or identity header. Throws ChannelReadinessError for every
 * failure (no API origin, network, timeout, non-OK answer, unreadable or channel-less body), so a
 * failed check can never be remembered as a reading.
 */
export async function readChannelReadiness({
  fetchImpl = fetch,
  url,
  timeoutMs = CHANNEL_HEALTH_TIMEOUT_MS,
}: { fetchImpl?: HealthFetch; url?: string; timeoutMs?: number } = {}): Promise<CommunicationCapability> {
  let target: string;
  try {
    target = url ?? apiUrl('/api/health');
  } catch (error) {
    throw new ChannelReadinessError(error instanceof Error ? error.message : 'CarUp API origin is not configured');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target, {
      headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) throw new ChannelReadinessError(`CarUp health check answered HTTP ${response.status}`);
    const capability = readCommunicationCapability(await response.json());
    if (capability.unknown) throw new ChannelReadinessError('CarUp health check did not describe its delivery channels');
    return capability;
  } catch (error) {
    if (error instanceof ChannelReadinessError) throw error;
    throw new ChannelReadinessError(error instanceof Error ? error.message : 'CarUp health check failed');
  } finally {
    clearTimeout(timer);
  }
}

export interface ChannelReadinessView {
  capability: CommunicationCapability;
  checking: boolean;
}

/** The reading a screen may rely on. A failed check is unknown even if an older reading exists. */
export function channelReadinessView({
  data,
  error,
  isPending,
}: {
  data: CommunicationCapability | undefined;
  error: unknown;
  isPending: boolean;
}): ChannelReadinessView {
  if (error) return { capability: UNKNOWN_CAPABILITY, checking: false };
  if (isPending || !data) return { capability: UNKNOWN_CAPABILITY, checking: true };
  return { capability: data, checking: false };
}

/** Delivery preference keys as CarUp stores them, and the channel each one controls. */
const PREFERENCE_CHANNEL: Readonly<Record<string, string>> = {
  in_app_enabled: 'in_app',
  push_enabled: 'push',
  email_enabled: 'email',
  whatsapp_enabled: 'whatsapp',
  telegram_enabled: 'telegram',
  sms_enabled: 'sms',
};

export function preferenceChannelAvailability(view: ChannelReadinessView, preferenceKey: string): ChannelAvailability {
  if (!Object.prototype.hasOwnProperty.call(PREFERENCE_CHANNEL, preferenceKey)) return 'not_offered';
  return channelAvailability(view.capability, PREFERENCE_CHANNEL[preferenceKey], { checking: view.checking });
}

/** One plain line beside a switch that cannot be used right now. */
export const CHANNEL_AVAILABILITY_EXPLANATION: Readonly<Record<ChannelAvailability, string | null>> = {
  available: null,
  temporarily_unavailable: "CarUp isn't sending outside the app right now. Your messages stay in your CarUp Inbox.",
  setup_pending: 'Not set up for CarUp yet.',
  not_offered: 'CarUp does not offer this channel.',
  checking: null,
  unknown: 'Could not check this channel right now.',
};

export interface ChannelSwitchPresentation {
  availability: ChannelAvailability;
  /**
   * Whether the channel can deliver now. This is not whether the switch is operable: an ON switch can
   * always be turned off (communicationPreferences.canChangeChannelPreference decides operability).
   */
  available: boolean;
  statusLabel: string;
  explanation: string | null;
}

export function channelSwitchPresentation(view: ChannelReadinessView, preferenceKey: string): ChannelSwitchPresentation {
  const availability = preferenceChannelAvailability(view, preferenceKey);
  return {
    availability,
    available: availability === 'available',
    statusLabel: CHANNEL_AVAILABILITY_LABEL[availability],
    explanation: CHANNEL_AVAILABILITY_EXPLANATION[availability],
  };
}

/** The current reading for preference screens: one health read shared by every surface. */
export function useChannelReadiness({ enabled = true }: { enabled?: boolean } = {}): ChannelReadinessView {
  const query = useQuery<CommunicationCapability>({
    queryKey: channelReadinessQueryKey,
    queryFn: () => readChannelReadiness(),
    enabled,
    staleTime: CHANNEL_READINESS_STALE_MS,
    retry: false,
  });
  return channelReadinessView({ data: query.data, error: query.error, isPending: query.isPending });
}
