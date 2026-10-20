import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ token: 'test-session', user: { id: 'owner-a', role: 'owner' } }) },
}));
vi.mock('../utils/verificationApi', () => ({
  getVerificationApiBaseUrl: () => 'https://staging.example.test',
  fetchCsrfToken: async () => 'csrf-test',
}));

import { CommunicationApiError } from '../utils/communicationApi';
import {
  canMutatePreferences,
  preferenceFailureCopy,
  preferenceViewState,
  PreferenceMutationBlockedError,
  PreferenceReadError,
  readCommunicationPreferences,
  savePreferenceChange,
  shouldRetryPreferenceRead,
  type PreferenceViewState,
} from '../utils/communicationPreferences';

async function readFailure(read: () => Promise<unknown>): Promise<PreferenceReadError> {
  try {
    await readCommunicationPreferences(read as never);
  } catch (error) {
    if (error instanceof PreferenceReadError) return error;
    throw error;
  }
  throw new Error('expected the preference read to fail');
}

function viewFor(error: unknown): PreferenceViewState {
  return preferenceViewState({ isPending: false, data: undefined, error });
}

describe('OC-NATIVE-FINAL-02-R1 D2 · delivery preferences are read, never assumed', () => {
  it('a successful read is READY with exactly the server values', async () => {
    const server = { in_app_enabled: true, push_enabled: false, email_enabled: true, user_id: 'owner-a', tenant_id: null };
    const preferences = await readCommunicationPreferences((async () => ({ preferences: server })) as never);
    expect(preferences).toEqual(server);
    expect(preferenceViewState({ isPending: false, data: preferences, error: null })).toEqual({ state: 'READY', preferences: server });
  });

  it('an account with no saved row shows the governed defaults CarUp returns, and invents none', async () => {
    const governedDefaults = { in_app_enabled: true, push_enabled: true, email_enabled: true, sms_enabled: false, whatsapp_enabled: false };
    const preferences = await readCommunicationPreferences((async () => ({ preferences: governedDefaults })) as never);
    const view = preferenceViewState({ isPending: false, data: preferences, error: null });
    expect(view).toEqual({ state: 'READY', preferences: governedDefaults });
  });

  it('a backend failure is READ_FAILED with no preference values at all', async () => {
    const error = await readFailure(async () => { throw new CommunicationApiError('Communication API returned HTTP 500', 500); });
    expect(error.kind).toBe('unavailable');
    expect(error.statusCode).toBe(500);
    const view = viewFor(error);
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'unavailable', statusCode: 500 });
    expect(view).not.toHaveProperty('preferences');
    if (view.state !== 'READ_FAILED') throw new Error('unreachable');
    expect(preferenceFailureCopy(view).action).toBe('retry');
  });

  it('401 asks the person to sign in again', async () => {
    const error = await readFailure(async () => { throw new CommunicationApiError('Unauthorized', 401); });
    const view = viewFor(error);
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'unauthenticated', statusCode: 401 });
    if (view.state !== 'READ_FAILED') throw new Error('unreachable');
    expect(preferenceFailureCopy(view).action).toBe('sign_in');
  });

  it('a request that never reaches CarUp is a device/network failure', async () => {
    const error = await readFailure(async () => { throw new TypeError('Network request failed'); });
    expect(viewFor(error)).toEqual({ state: 'READ_FAILED', failure: 'network', statusCode: null });
  });

  it('an unreadable or shapeless answer is a failed read, never an empty preference object', async () => {
    expect((await readFailure(async () => ({ preferences: null }))).kind).toBe('malformed');
    expect((await readFailure(async () => ({ preferences: [] }))).kind).toBe('malformed');
    expect((await readFailure(async () => ({}))).kind).toBe('malformed');
    expect((await readFailure(async () => { throw new SyntaxError('Unexpected token <'); })).kind).toBe('malformed');
  });

  it('retry recovers: a failed read followed by a successful one ends READY', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed');
      return { preferences: { email_enabled: true } };
    };
    const first = await readFailure(read);
    expect(viewFor(first).state).toBe('READ_FAILED');
    const second = await readCommunicationPreferences(read as never);
    expect(preferenceViewState({ isPending: false, data: second, error: null })).toEqual({ state: 'READY', preferences: { email_enabled: true } });
    expect(shouldRetryPreferenceRead(0, first)).toBe(true);
    expect(shouldRetryPreferenceRead(0, new PreferenceReadError('unauthenticated', 401, 'x'))).toBe(false);
  });

  it('PATCH after a successful read sends only the changed preference and keeps the server answer', async () => {
    const ready: PreferenceViewState = { state: 'READY', preferences: { email_enabled: false, sms_enabled: false } };
    expect(canMutatePreferences(ready)).toBe(true);
    const update = vi.fn(async (patch: Record<string, unknown>) => ({ preferences: { email_enabled: true, sms_enabled: false, ...patch } }));
    const saved = await savePreferenceChange(ready, 'email_enabled', true, update as never);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ email_enabled: true });
    expect(saved).toEqual({ email_enabled: true, sms_enabled: false });
  });

  it('PATCH is refused before current preferences have been read', async () => {
    const update = vi.fn(async () => ({ preferences: {} }));
    for (const view of [
      { state: 'LOADING' } as PreferenceViewState,
      { state: 'READ_FAILED', failure: 'network', statusCode: null } as PreferenceViewState,
    ]) {
      expect(canMutatePreferences(view)).toBe(false);
      await expect(savePreferenceChange(view, 'email_enabled', true, update as never)).rejects.toBeInstanceOf(PreferenceMutationBlockedError);
    }
    expect(update).not.toHaveBeenCalled();
  });
});

describe('OC-NATIVE-FINAL-02-R1 D2 · both preference surfaces render the read state', () => {
  const account = readFileSync(resolve(__dirname, '../app/(tabs)/account.tsx'), 'utf8');
  const messages = readFileSync(resolve(__dirname, '../app/(tabs)/communications.tsx'), 'utf8');

  it('Messages no longer converts a failed read into an empty preference object', () => {
    expect(messages).not.toMatch(/getCommunicationPreferences\(\)\.catch\(\(\)\s*=>\s*\(\{\s*preferences:\s*\{\}\s*\}\)\)/);
    expect(messages).toMatch(/readCommunicationPreferences\(/);
    expect(messages).toMatch(/savePreferenceChange\(/);
  });

  it('Account reads, renders and saves through the same truthful helpers', () => {
    expect(account).toMatch(/readCommunicationPreferences\(/);
    expect(account).toMatch(/preferenceViewState\(/);
    expect(account).toMatch(/savePreferenceChange\(/);
  });
});
