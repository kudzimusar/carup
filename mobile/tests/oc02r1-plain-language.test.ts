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
  communicationSendFailureMessage,
  communicationThreadContext,
  communicationThreadTitle,
} from '../utils/communicationPresentation';
import { getTradeRecordDetail } from '../utils/tradeApi';

/**
 * OC-NATIVE-FINAL-02-R1 P2-A — the Owner found implementation language on the Native Passport, Inbox,
 * Trade and Trade-detail screens: "Canonical Trust", "Lifecycle projection", "This R5-R4 gateway",
 * "governed Trade authority", "No governed Native destination", raw UUIDs as conversation context,
 * a raw "Communication API returned HTTP 500" as a send error, and ISO timestamps as dates.
 *
 * What a person reads is checked here, not identifiers: prose is taken from string literals and JSX
 * text with comments and `${…}` expressions removed.
 */
const SCREENS = [
  'app/vehicle/[vin]/passport.tsx',
  'app/(tabs)/inbox.tsx',
  'app/inbox/[threadId].tsx',
  'app/(tabs)/trade.tsx',
  'app/trade/[kind].tsx',
  'app/trade/[kind]/[id].tsx',
];

const INTERNAL = /\b(canonical|governed|authoritative|authority|projection|runtime|synthetic|participant-scoped|audience|certified|payload|transport|backend|capability|capabilities|read route|re-resolves|R5-R4)\b/i;
const NATIVE_AS_ACTOR = /\bNative\b/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function visibleProse(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
  const literals = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
  const jsxText = [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1]);
  return [...literals, ...jsxText]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => /[A-Za-z]{2,}\s+[A-Za-z]/.test(value) && !value.startsWith('/') && !value.includes('../'));
}

function failingProse(file: string): string[] {
  const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
  return visibleProse(source).filter((value) => INTERNAL.test(value) || NATIVE_AS_ACTOR.test(value));
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('OC-NATIVE-FINAL-02-R1 P2-A · the Passport, Inbox and Trade screens speak plainly', () => {
  it('finds prose to check on every screen (anti-vacuity)', () => {
    for (const file of SCREENS) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(visibleProse(source).length, file).toBeGreaterThan(3);
    }
  });

  it.each(SCREENS)('%s shows no implementation language', (file) => {
    expect(failingProse(file)).toEqual([]);
  });

  it('a Passport returned for a different VIN is not shown under this vehicle', () => {
    const passport = readFileSync(resolve(__dirname, '../app/vehicle/[vin]/passport.tsx'), 'utf8');
    const guard = passport.indexOf('{sameVin ? (');
    expect(guard, 'the Passport sections render only for the same VIN').toBeGreaterThan(-1);
    for (const section of ['title="Identity"', 'title="Trust assessment"', 'title="Passport evidence"', 'title="Vehicle history"']) {
      expect(passport.indexOf(section), section).toBeGreaterThan(guard);
    }
  });

  it('a trade conversation is named like the web inbox names it, never by its internal type', () => {
    expect(communicationThreadTitle({
      business_workflow: 'marketplace',
      thread_type: 'marketplace_inquiry',
      subject_type: 'diaspora_rfq',
      subject_id: '87b14d63-82f7-4f55-9c46-1c159b0b61a0:qa-supplier',
    })).toBe('Sourcing request RFQ-87B14D63');
    expect(communicationThreadTitle({
      business_workflow: 'marketplace',
      thread_type: 'marketplace_inquiry',
      subject_type: 'marketplace_inquiry',
      subject_id: '5d0f4c1e-2b7a-4c39-9d7e-0a1b2c3d4e5f',
    })).toBe('Marketplace conversation');
  });

  it('conversation context never shows a raw identifier', () => {
    const rows = communicationThreadContext({
      marketplace_listing_id: '9b2f6a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      subject_type: 'marketplace_inquiry',
      subject_id: '5d0f4c1e-2b7a-4c39-9d7e-0a1b2c3d4e5f',
      business_workflow: 'marketplace',
      participant_role: 'seller',
    });
    expect(rows.some((row) => UUID.test(row.value))).toBe(false);
    expect(rows).toContainEqual({ label: 'Your role', value: 'Seller' });
    // A VIN is how people know a car, so it stays.
    expect(communicationThreadContext({ marketplace_listing_id: 'GFC27-027051' })).toContainEqual({ label: 'Listing', value: 'GFC27-027051' });
  });

  it('a failed send is explained in plain words, never as the raw API error', () => {
    const serverError = communicationSendFailureMessage(new CommunicationApiError('Communication API returned HTTP 500', 500));
    expect(serverError).not.toMatch(/HTTP|API|500/);
    expect(serverError).toMatch(/not sent/i);
    expect(communicationSendFailureMessage(new CommunicationApiError('Unauthorized', 401))).toMatch(/sign in/i);
    expect(communicationSendFailureMessage(new TypeError('Network request failed'))).toMatch(/connection/i);
  });

  it('Trade detail shows no raw identifiers or ISO timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/diaspora/documents/doc-1')) {
        return response(200, {
          id: 'doc-1',
          import_order_id: '0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f',
          ocr_document_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          document_type: 'bill_of_lading',
          file_name: 'bill-of-lading.pdf',
          verification_status: 'verified',
          reviewed_at: '2026-10-01T09:30:00.000Z',
          created_at: '2026-09-30T18:05:00.000Z',
        });
      }
      return response(404, {});
    }));
    const detail = await getTradeRecordDetail('documents', 'doc-1');
    vi.unstubAllGlobals();
    for (const field of detail.fields) {
      expect(UUID.test(field.value), `${field.label}: ${field.value}`).toBe(false);
      expect(ISO_TIMESTAMP.test(field.value), `${field.label}: ${field.value}`).toBe(false);
    }
    expect(detail.fields).toContainEqual({ label: 'Document type', value: 'Bill Of Lading' });
    expect(detail.fields.some((field) => field.label === 'Created')).toBe(true);
  });

  it('the Trade capability labels and notes are plain, available or not', () => {
    // Scoped to the strings the gateway shows (labels and notes); thrown error messages are not displayed.
    const tradeApi = readFileSync(resolve(__dirname, '../utils/tradeApi.ts'), 'utf8');
    const start = tradeApi.indexOf('function capabilityFromResult(');
    const end = tradeApi.indexOf('export function isTradeRecordKind(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const shown = visibleProse(tradeApi.slice(start, end));
    expect(shown.length, 'anti-vacuity: the notes were found').toBeGreaterThan(8);
    expect(shown.filter((value) => INTERNAL.test(value) || NATIVE_AS_ACTOR.test(value))).toEqual([]);
  });
});
