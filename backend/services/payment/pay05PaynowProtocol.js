/**
 * CARUP-PAY-05-LR01 — the Paynow merchant-API wire protocol (pure functions, no I/O).
 *
 * Everything here follows Paynow's developer documentation, not its SDKs (which disagree with the docs and with each
 * other: three lowercase the key, two hash URL-encoded values, one never verifies). Pinned by
 * backend/tests/pay05-paynow-protocol.test.js against Paynow's two published hash vectors.
 *
 *   Messages      application/x-www-form-urlencoded both ways; values in message order.
 *   Hash          UPPER(HEX(SHA512(UTF8(value1 ‖ … ‖ valueN ‖ IntegrationKey)))), every field except `hash`,
 *                 values URL-decoded (docs: generating_hash, validating_hash).
 *   Endpoints     https://www.paynow.co.zw/interface/{initiatetransaction,remotetransaction,trace}; poll = an empty
 *                 POST to the poll URL Paynow returned. Error replies carry NO hash and authenticate nothing.
 */
import crypto from 'node:crypto';
import { Pay05Error, PAY05_CURRENCIES } from './pay05Contract.js';

export const PAYNOW_HOST = 'www.paynow.co.zw';
export const PAYNOW_ENDPOINTS = Object.freeze({
  initiate: 'https://www.paynow.co.zw/interface/initiatetransaction',
  remote: 'https://www.paynow.co.zw/interface/remotetransaction',
  trace: 'https://www.paynow.co.zw/interface/trace',
});
export const PAYNOW_REAL_ALLOWLIST = Object.freeze({ hosts: Object.freeze([PAYNOW_HOST]) });

const MAX_MESSAGE_CHARS = 64 * 1024;
const malformed = () => new Pay05Error('PAY05_PROVIDER_MESSAGE_MALFORMED', 502);

/** A value as Paynow hashes it: trimmed (generating_hash's own example; its published vector matches only trimmed text). */
const hashValue = (v) => (v === null || v === undefined ? '' : String(v).trim());

export function paynowHash(values, integrationKey) {
  if (typeof integrationKey !== 'string' || integrationKey.length === 0) throw new Pay05Error('PAY05_CREDENTIAL_UNAVAILABLE', 503);
  const material = values.map(hashValue).join('') + integrationKey;
  return crypto.createHash('sha512').update(material, 'utf8').digest('hex').toUpperCase();
}

export function encodeForm(pairs) {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value === null || value === undefined ? '' : String(value));
  return params.toString();
}

const decode = (text) => decodeURIComponent(text.replace(/\+/g, ' '));

/** Ordered [key, value] pairs, keys lower-cased (Paynow mixes Status/status). Duplicates are ambiguous: refused. */
export function parseForm(body) {
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_MESSAGE_CHARS) throw malformed();
  const pairs = [];
  const seen = new Set();
  for (const part of body.split('&')) {
    if (part === '') continue;
    const at = part.indexOf('=');
    if (at <= 0) throw malformed();
    let key;
    let value;
    try {
      key = decode(part.slice(0, at)).trim().toLowerCase();
      value = decode(part.slice(at + 1));
    } catch {
      throw malformed();
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || seen.has(key)) throw malformed();
    seen.add(key);
    pairs.push([key, value]);
  }
  if (!pairs.length) throw malformed();
  return pairs;
}

/** The message to send, signed: values are sent exactly as hashed (trimmed), so Paynow can never disagree about spaces. */
export function signPairs(pairs, integrationKey) {
  const body = pairs.filter(([k]) => String(k).toLowerCase() !== 'hash').map(([k, v]) => [k, hashValue(v)]);
  return [...body, ['hash', paynowHash(body.map(([, v]) => v), integrationKey)]];
}

/** { valid, fields } — `fields` is a Map of the message (hash excluded); `valid` only for the right key and order. */
export function verifyPairs(pairs, integrationKey) {
  const fields = new Map();
  let received = null;
  const values = [];
  for (const [key, value] of pairs) {
    if (String(key).toLowerCase() === 'hash') { received = String(value ?? ''); continue; }
    fields.set(String(key).toLowerCase(), value);
    values.push(value);
  }
  if (!received || !/^[0-9A-Fa-f]{128}$/.test(received)) return { valid: false, fields };
  const expected = Buffer.from(paynowHash(values, integrationKey), 'utf8');
  const actual = Buffer.from(received.toUpperCase(), 'utf8');
  return { valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual), fields };
}

// ── Status vocabulary (docs: status_update; test_mode for FAILED) ────────────────────────────────────────────

const STATUSES = Object.freeze({
  paid: Object.freeze({ code: 'paid', snapshot: 'paid', moneyReceived: true }),
  'awaiting delivery': Object.freeze({ code: 'awaiting_delivery', snapshot: 'pending', moneyReceived: true }),
  delivered: Object.freeze({ code: 'delivered', snapshot: 'pending', moneyReceived: true }),
  created: Object.freeze({ code: 'created', snapshot: 'pending', moneyReceived: false }),
  sent: Object.freeze({ code: 'sent', snapshot: 'pending', moneyReceived: false }),
  cancelled: Object.freeze({ code: 'cancelled', snapshot: 'cancelled', moneyReceived: false }),
  // test_mode: "Paynow will send a FAILED status update … This simulates the user cancelling"
  failed: Object.freeze({ code: 'failed', snapshot: 'cancelled', moneyReceived: false }),
  // money held in suspense by Paynow: never a payment-state transition by itself (a review is opened instead)
  disputed: Object.freeze({ code: 'disputed', snapshot: null, moneyReceived: true }),
  refunded: Object.freeze({ code: 'refunded', snapshot: 'refunded', moneyReceived: false }),
  // used by Paynow's own .NET SDK and plugins for a request the customer has not paid yet: pending, never money
  'created but not paid': Object.freeze({ code: 'created', snapshot: 'pending', moneyReceived: false }),
  'awaiting redirect': Object.freeze({ code: 'created', snapshot: 'pending', moneyReceived: false }),
});
const UNRECOGNIZED = Object.freeze({ code: 'unrecognized', snapshot: null, moneyReceived: false });

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A pasted integration key as Paynow renders it: trimmed, and a GUID in lower case (as its C# example concatenates it). */
export function normalizeIntegrationKey(key) {
  const k = String(key ?? '').trim();
  return GUID.test(k) ? k.toLowerCase() : k;
}

const AUTH_EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$/;
/** The payer e-mail an express (mobile) request carries as Paynow's `authemail`. */
export function isPaynowAuthEmail(value) {
  return AUTH_EMAIL.test(String(value ?? ''));
}

export function classifyPaynowStatus(raw) {
  const word = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return STATUSES[word] ?? UNRECOGNIZED;
}

// ── Amounts: Paynow takes major units with two decimals and carries no currency (one integration per currency) ──

function requireCurrency(currency) {
  if (!PAY05_CURRENCIES.includes(currency)) throw new Pay05Error('PAY05_CURRENCY_NOT_SUPPORTED', 422);
}

export function formatPaynowAmount(amountMinor, currency) {
  requireCurrency(currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Pay05Error('PAY05_AMOUNT_INVALID', 422);
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, '0')}`;
}

export function parsePaynowAmountMinor(text) {
  const m = /^(\d{1,12})\.(\d{2})$/.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

// ── Outbound URL allowlist (SSRF): Paynow-returned URLs are followed only to Paynow itself ────────────────────

/**
 * `allow` is either { hosts: ['www.paynow.co.zw'] } (real Paynow: https, that exact host, default port) or
 * { origins: ['http://127.0.0.1:5061'] } (the local protocol simulator, exact origin). Never both, never neither.
 */
export function assertProviderUrl(url, allow) {
  const refuse = () => new Pay05Error('PAY05_PROVIDER_URL_REFUSED', 502);
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    throw refuse();
  }
  if (parsed.username || parsed.password) throw refuse();
  const origins = allow?.origins ?? [];
  const hosts = allow?.hosts ?? [];
  if (origins.length) {
    if (!origins.includes(parsed.origin)) throw refuse();
    return parsed.href;
  }
  if (!hosts.length || parsed.protocol !== 'https:' || parsed.port !== '' || !hosts.includes(parsed.hostname)) throw refuse();
  return parsed.href;
}

// ── Identifiers ─────────────────────────────────────────────────────────────────────────────────────────────

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** The opaque, stable payment identifier CarUp stores for a Paynow transaction: derived from its poll URL. */
export function pollIdFor(pollUrl) {
  return `pn_poll_${sha256(String(pollUrl)).slice(0, 40)}`;
}

const TRACE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** "Must be unique per merchant … up to 32 characters" (docs: initiate_transaction). */
export function newMerchantTrace() {
  let out = '';
  for (let i = 0; i < 32; i += 1) out += TRACE_ALPHABET[crypto.randomInt(TRACE_ALPHABET.length)];
  return out;
}

/**
 * A status update's identity: the same message resent (Paynow retries up to ten times) while CarUp's view is unchanged
 * is the same event. Paynow's messages carry no sequence number — "Paid" after a dispute is byte-identical to the first
 * "Paid" — so the previous message CarUp applied is part of the identity: a repeat right after itself is a resend, a
 * repeat after a different message is a new event.
 */
export function eventIdFor(collectionId, pairs, priorMessageHash = null) {
  return `evt_pn_${sha256(`${collectionId}\n${encodeForm(pairs)}\n${priorMessageHash ?? ''}`).slice(0, 40)}`;
}

/** The SHA-256 of a whole message as received (its identity, independent of the collection). */
export function messageHashFor(pairs) {
  return sha256(encodeForm(pairs));
}

/** Paynow documents mobile numbers as 07XXXXXXXX (test numbers 0771111111…0774444444). */
export function normalizeZimbabweMobile(phone) {
  const compact = String(phone ?? '').replace(/[\s()-]/g, '');
  let local = compact;
  if (/^\+263\d{9}$/.test(compact)) local = `0${compact.slice(4)}`;
  else if (/^263\d{9}$/.test(compact)) local = `0${compact.slice(3)}`;
  if (!/^07[1-9]\d{7}$/.test(local)) throw new Pay05Error('PAY05_PHONE_INVALID', 422);
  return local;
}
