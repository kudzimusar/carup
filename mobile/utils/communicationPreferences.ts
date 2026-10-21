import { CommunicationApiError, getCommunicationPreferences, updateCommunicationPreferences } from './communicationApi';
import type { ChannelAvailability } from '@shared/communication/channelReadiness';

/**
 * OC-NATIVE-FINAL-02-R1 D2 — delivery preferences are read, never assumed.
 *
 * A failed read is never turned into an empty preference object: toggles are shown only for
 * values CarUp returned, and a change can be saved only after the current values were read.
 * A save sends only the one preference the person changed.
 */

export type CommunicationPreferences = Record<string, unknown>;
export type PreferenceReadFailure = 'unauthenticated' | 'forbidden' | 'unavailable' | 'network' | 'malformed';

export class PreferenceReadError extends Error {
  kind: PreferenceReadFailure;
  statusCode: number | null;

  constructor(kind: PreferenceReadFailure, statusCode: number | null, message: string) {
    super(message);
    this.name = 'PreferenceReadError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export class PreferenceMutationBlockedError extends Error {
  constructor() {
    super('Your current delivery preferences have not been read, so nothing was changed.');
    this.name = 'PreferenceMutationBlockedError';
  }
}

function classify(error: unknown): PreferenceReadError {
  if (error instanceof PreferenceReadError) return error;
  if (error instanceof CommunicationApiError) {
    if (error.statusCode === 401) return new PreferenceReadError('unauthenticated', 401, error.message);
    if (error.statusCode === 403) return new PreferenceReadError('forbidden', 403, error.message);
    return new PreferenceReadError('unavailable', error.statusCode, error.message);
  }
  if (error instanceof SyntaxError) return new PreferenceReadError('malformed', null, error.message);
  return new PreferenceReadError('network', null, error instanceof Error ? error.message : 'Network request failed');
}

function preferencesFrom(body: unknown): CommunicationPreferences {
  const preferences = (body as { preferences?: unknown } | null)?.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new PreferenceReadError('malformed', null, 'CarUp returned no preference values');
  }
  return preferences as CommunicationPreferences;
}

export async function readCommunicationPreferences(
  read: () => Promise<unknown> = getCommunicationPreferences,
): Promise<CommunicationPreferences> {
  let body: unknown;
  try {
    body = await read();
  } catch (error) {
    throw classify(error);
  }
  return preferencesFrom(body);
}

export type PreferenceViewState =
  | { state: 'LOADING' }
  | { state: 'READY'; preferences: CommunicationPreferences }
  | { state: 'READ_FAILED'; failure: PreferenceReadFailure; statusCode: number | null };

export function preferenceViewState({
  isPending,
  data,
  error,
}: {
  isPending: boolean;
  data: CommunicationPreferences | undefined;
  error: unknown;
}): PreferenceViewState {
  if (error) {
    const failure = classify(error);
    return { state: 'READ_FAILED', failure: failure.kind, statusCode: failure.statusCode };
  }
  if (isPending || !data) return { state: 'LOADING' };
  return { state: 'READY', preferences: data };
}

export function canMutatePreferences(view: PreferenceViewState): view is Extract<PreferenceViewState, { state: 'READY' }> {
  return view.state === 'READY';
}

/**
 * CARUP-MVP-STAB-01 F-018 — a delivery preference switch is operable only when both hold: the current
 * values were read (D2), and CarUp's health reading says the channel can deliver right now. A saved
 * preference is never provider readiness.
 */
export function canChangeChannelPreference(view: PreferenceViewState, availability: ChannelAvailability): boolean {
  return canMutatePreferences(view) && availability === 'available';
}

export async function savePreferenceChange(
  view: PreferenceViewState,
  key: string,
  value: boolean,
  update: (patch: Record<string, unknown>) => Promise<unknown> = updateCommunicationPreferences,
): Promise<CommunicationPreferences> {
  if (!canMutatePreferences(view)) throw new PreferenceMutationBlockedError();
  return preferencesFrom(await update({ [key]: value }));
}

export function shouldRetryPreferenceRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const failure = classify(error);
  return failure.kind === 'network' || failure.kind === 'unavailable';
}

export function preferenceFailureCopy(view: Extract<PreferenceViewState, { state: 'READ_FAILED' }>): {
  title: string;
  body: string;
  action: 'retry' | 'sign_in' | 'none';
} {
  switch (view.failure) {
    case 'unauthenticated':
      return { title: 'Sign in again', body: 'CarUp did not accept this session, so your delivery preferences are not shown.', action: 'sign_in' };
    case 'forbidden':
      return { title: 'Preferences not available', body: 'CarUp did not allow this account to read delivery preferences.', action: 'none' };
    case 'network':
      return { title: 'CarUp could not be reached', body: 'This device could not reach CarUp, so your delivery preferences are not shown and cannot be changed yet.', action: 'retry' };
    case 'malformed':
      return { title: 'Preferences could not be read', body: 'CarUp answered in a form this app could not read, so your delivery preferences are not shown.', action: 'retry' };
    case 'unavailable':
    default:
      return {
        title: 'Preferences unavailable',
        body: `CarUp could not provide your delivery preferences right now${view.statusCode ? ` (error ${view.statusCode})` : ''}, so they are not shown and cannot be changed yet.`,
        action: 'retry',
      };
  }
}
