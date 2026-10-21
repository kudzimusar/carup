/**
 * CARUP-MVP-STAB-01 F-001 / F-002 (client) — the buyer's message to a seller.
 *
 * "Message seller" used to create a Marketplace inquiry on one tap, with a sentence the buyer never
 * wrote. The composer now writes nothing until the buyer presses Send, and every Send of one
 * composer session carries the same client request id so a retry (or a CSRF re-POST) can be
 * recognised by the server instead of creating a second inquiry.
 *
 * Pure and node-safe: the API calls are injected, so the send contract is unit-tested directly.
 */
import type { MobileInquiryInput } from './marketplaceApi';
import { safeAttributionCode } from './vehicleNavigation';

export const INQUIRY_TYPE = 'vehicle_purchase_interest';
export const INQUIRY_SOURCE_PAGE = 'native_vehicle_detail';
/** The server keeps at most this many characters, so the composer never lets more be typed. */
export const INQUIRY_MESSAGE_MAX_LENGTH = 2000;
export const INQUIRY_MESSAGE_PLACEHOLDER = 'Write your message to the seller';
/** How long the composer waits for one conversation lookup after a successful send. */
export const INQUIRY_THREAD_LOOKUP_TIMEOUT_MS = 6000;
/** The machine code the server answers when one request id is reused with different words. */
export const INQUIRY_IDEMPOTENCY_MISMATCH = 'INQUIRY_IDEMPOTENCY_MISMATCH';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `inq-<base36 time>-<12 random base36 chars>` — created once per composer session. */
export function createInquiryClientRequestId(now: number = Date.now(), random: () => number = Math.random): string {
  const time = Math.max(0, Math.floor(Number.isFinite(now) ? now : 0)).toString(36);
  let suffix = '';
  for (let index = 0; index < 12; index += 1) {
    const value = Math.floor(Math.min(0.999999999, Math.max(0, random())) * 36);
    suffix += BASE36[value];
  }
  return `inq-${time}-${suffix}`;
}

/** The buyer's own words, with only leading and trailing whitespace removed. */
export function normalizeInquiryMessage(text: unknown): string {
  return typeof text === 'string' ? text.trim() : '';
}

export function canSendInquiry(state: {
  text: string;
  signedIn: boolean;
  sending: boolean;
  sent: boolean;
  /** False when the listing is known not to be on the public Marketplace. */
  listingAvailable?: boolean;
}): boolean {
  const message = normalizeInquiryMessage(state.text);
  return state.signedIn
    && !state.sending
    && !state.sent
    && state.listingAvailable !== false
    && message.length > 0
    && message.length <= INQUIRY_MESSAGE_MAX_LENGTH;
}

/** The listing the message is about: the VIN the listing record returned, else the route VIN. */
export function inquiryListingId(canonicalVin: string | null | undefined, routeVin: string): string {
  const canonical = typeof canonicalVin === 'string' ? canonicalVin.trim() : '';
  return canonical || String(routeVin || '').trim();
}

export interface InquiryPayload extends MobileInquiryInput {
  listing_id: string;
  inquiry_type: typeof INQUIRY_TYPE;
  message: string;
  client_request_id: string;
  metadata: { source_page: typeof INQUIRY_SOURCE_PAGE };
}

export function buildInquiryPayload(input: {
  listingId: string;
  message: string;
  clientRequestId: string;
  referralCode?: string | null;
  campaignCode?: string | null;
}): InquiryPayload {
  const referralCode = safeAttributionCode(input.referralCode ?? undefined);
  const campaignCode = safeAttributionCode(input.campaignCode ?? undefined);
  return {
    listing_id: input.listingId,
    inquiry_type: INQUIRY_TYPE,
    message: normalizeInquiryMessage(input.message),
    client_request_id: input.clientRequestId,
    ...(referralCode ? { referral_code: referralCode } : {}),
    ...(campaignCode ? { campaign_code: campaignCode } : {}),
    metadata: { source_page: INQUIRY_SOURCE_PAGE },
  };
}

export type InquirySendFailureKind =
  | 'connection'
  | 'signed_out'
  | 'not_allowed'
  | 'not_listed'
  | 'not_accepting'
  | 'too_many'
  | 'unavailable';

export interface InquirySendFailure {
  kind: InquirySendFailureKind;
  message: string;
  needsSignIn: boolean;
}

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : null;
}

export function isInquiryIdempotencyMismatch(error: unknown): boolean {
  return statusOf(error) === 409 && codeOf(error) === INQUIRY_IDEMPOTENCY_MISMATCH;
}

/** A failed send in plain words. The server's own text is never shown. */
export function inquirySendFailure(error: unknown): InquirySendFailure {
  const status = statusOf(error);
  if (status === null) {
    return {
      kind: 'connection',
      message: 'CarUp could not confirm that your message was sent. Check your connection, then try again.',
      needsSignIn: false,
    };
  }
  if (status === 401) {
    return { kind: 'signed_out', message: 'Your session ended. Sign in again to send your message.', needsSignIn: true };
  }
  if (status === 403) {
    return { kind: 'not_allowed', message: 'Your account cannot send this message right now. Try again in a moment.', needsSignIn: false };
  }
  if (status === 404) {
    return { kind: 'not_listed', message: 'This vehicle is no longer listed, so your message was not sent.', needsSignIn: false };
  }
  if (status === 400 || status === 422) {
    return { kind: 'not_accepting', message: 'This vehicle cannot receive messages right now. Your message was not sent.', needsSignIn: false };
  }
  if (status === 429) {
    return { kind: 'too_many', message: 'You have sent several messages in a short time. Please wait a minute, then try again.', needsSignIn: false };
  }
  return { kind: 'unavailable', message: 'CarUp could not send your message right now. Please try again in a moment.', needsSignIn: false };
}

export interface InquiryCreateResult {
  inquiry?: { id?: string | null } | null;
  idempotent_replay?: boolean;
}

export interface InquiryConversationLookup {
  state: 'resolved' | 'pending';
  thread?: { id?: unknown } | null;
}

export type InquirySendOutcome =
  | { kind: 'ignored'; reason: 'in_flight' | 'already_sent' | 'empty' }
  | { kind: 'failed'; failure: InquirySendFailure }
  /** The same request id was already used for different words: an earlier version reached CarUp. */
  | { kind: 'already_received' }
  | {
      kind: 'sent';
      inquiryId: string | null;
      replay: boolean;
      conversation: { state: 'resolved'; threadId: string } | { state: 'pending' };
    };

export interface InquirySender {
  readonly clientRequestId: string;
  readonly inFlight: boolean;
  readonly sent: boolean;
  send(input: {
    listingId: string;
    message: string;
    referralCode?: string | null;
    campaignCode?: string | null;
    /** The signed-in account sending; a different account never reuses an earlier request id. */
    actorId?: string | null;
    /** Called once, as soon as CarUp has accepted the message and before the conversation lookup. */
    onCreated?: () => void;
  }): Promise<InquirySendOutcome>;
}

/**
 * One sender per composer session. `send` sets its in-flight flag before its first await, so a
 * second tap in the same frame is ignored and exactly one request is made. After a success (or
 * proof that an earlier attempt reached CarUp) it never sends again.
 */
export function createInquirySender(deps: {
  create: (payload: InquiryPayload) => Promise<InquiryCreateResult>;
  resolveConversation: (inquiryId: string, listingId: string) => Promise<InquiryConversationLookup>;
  newClientRequestId?: () => string;
}): InquirySender {
  const newClientRequestId = deps.newClientRequestId ?? (() => createInquiryClientRequestId());
  let clientRequestId = newClientRequestId();
  let attemptedBy: string | null | undefined;
  let inFlight = false;
  let sent = false;

  return {
    get clientRequestId() {
      return clientRequestId;
    },
    get inFlight() {
      return inFlight;
    },
    get sent() {
      return sent;
    },
    async send(input) {
      if (sent) return { kind: 'ignored', reason: 'already_sent' };
      if (inFlight) return { kind: 'ignored', reason: 'in_flight' };
      const message = normalizeInquiryMessage(input.message);
      if (!message) return { kind: 'ignored', reason: 'empty' };
      inFlight = true;

      const actor = input.actorId ?? null;
      if (attemptedBy !== undefined && attemptedBy !== actor) clientRequestId = newClientRequestId();
      attemptedBy = actor;

      let created: InquiryCreateResult;
      try {
        created = await deps.create(buildInquiryPayload({
          listingId: input.listingId,
          message,
          clientRequestId,
          referralCode: input.referralCode,
          campaignCode: input.campaignCode,
        }));
      } catch (error) {
        inFlight = false;
        if (isInquiryIdempotencyMismatch(error)) {
          sent = true;
          return { kind: 'already_received' };
        }
        return { kind: 'failed', failure: inquirySendFailure(error) };
      }

      sent = true;
      inFlight = false;
      try {
        input.onCreated?.();
      } catch {
        // A display callback can never turn a sent message into a failure.
      }
      const replay = created?.idempotent_replay === true;
      const inquiryId = typeof created?.inquiry?.id === 'string' && created.inquiry.id ? created.inquiry.id : null;
      if (!inquiryId) return { kind: 'sent', inquiryId: null, replay, conversation: { state: 'pending' } };

      try {
        const lookup = await deps.resolveConversation(inquiryId, input.listingId);
        const threadId = lookup?.state === 'resolved' && lookup.thread?.id != null ? String(lookup.thread.id).trim() : '';
        return {
          kind: 'sent',
          inquiryId,
          replay,
          conversation: threadId ? { state: 'resolved', threadId } : { state: 'pending' },
        };
      } catch {
        // The message is sent; only the conversation lookup failed. Never report that as unsent.
        return { kind: 'sent', inquiryId, replay, conversation: { state: 'pending' } };
      }
    },
  };
}
