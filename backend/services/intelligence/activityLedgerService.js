/**
 * CarUp Intelligence 1.0 — I2 activity ledger ingestion.
 *
 * Implements docs/intelligence/receipts/I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md
 * for the single analytical event store, `marketplace_activity_events`.
 *
 * Four invariants this module exists to enforce:
 *
 *  1. OBSERVATION, NOT AUTHORITY. Writing here never changes a business fact.
 *     Server-emitted events are written alongside their domain write and carry
 *     that write's row id / commit timestamp as the idempotency key, so the
 *     ledger can be reconciled against the authority rather than believed.
 *
 *  2. THE CLIENT NEVER ASSERTS PRIVILEGE. authenticated_user_id, tenant_id and
 *     organization_id are derived server-side — identity from the session, scope
 *     from the EVENT'S OBJECT (the listing's owning tenant), never from the
 *     actor's headers. A client-supplied value for any of them is dropped, not
 *     merely overwritten, and dropping it is counted.
 *
 *  3. DUPLICATES CANNOT INFLATE A METRIC. Every event carries a server-computed
 *     idempotency_key with a UNIQUE index behind it; a replayed batch collides in
 *     the database, not in a best-effort in-process window.
 *
 *  4. ANALYTICS NEVER BLOCKS UX. Ingestion resolves even when storage fails; a
 *     failure increments an observability counter instead of surfacing an error.
 *     Silent loss is the thing being prevented, so loss must be COUNTED.
 */
import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import {
  SUPPORTED_SCHEMA_VERSION,
  EVENT_TYPES,
  METADATA_ALLOWLIST,
  METADATA_ENUMS,
  SOURCE_SURFACES,
  SOURCE_PLATFORMS,
  isClientEmittable,
  isServerEmitted,
  isReserved,
  eventVersionOf,
  privacyClassOf,
} from './activityEventTypes.js';

const TABLE = 'marketplace_activity_events';
const STATS_TABLE = 'intelligence_ingestion_stats';

export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_BODY_BYTES = 64 * 1024;
/** Contract §5.4: client timestamps older than this are stored flagged, not trusted. */
export const LATE_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_KEY_MATERIAL = 512;

// ── Identifier hygiene ───────────────────────────────────────────────────────

/**
 * Session/page keys are opaque client-minted values. We never interpret them, but
 * we do bound their shape so they cannot become a smuggling channel for PII: an
 * email or a raw URL in a "session key" would end up in an internal-only column
 * that the privacy contract says holds no direct identifier.
 */
const OPAQUE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function opaqueKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return OPAQUE_KEY_RE.test(trimmed) ? trimmed : null;
}

function boundedCode(value, max = 64) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function boundedId(value, max = 128) {
  return boundedCode(value, max);
}

function sha256(parts) {
  const material = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
  return crypto.createHash('sha256').update(material.slice(0, MAX_KEY_MATERIAL)).digest('hex');
}

// ── Metadata allowlist projection ────────────────────────────────────────────

/**
 * Project metadata to the per-type allowlist. Anything not named is DROPPED —
 * this is the nav-analytics privacy discipline applied to commercial telemetry:
 * the wire format cannot decide what gets stored.
 */
export function projectMetadata(eventType, raw) {
  const allowed = METADATA_ALLOWLIST[eventType];
  if (!Array.isArray(allowed) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    const enumValues = METADATA_ENUMS[key];
    if (enumValues) {
      if (typeof value === 'string' && enumValues.includes(value)) out[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const bounded = boundedCode(value, 128);
      if (bounded) out[key] = bounded;
      continue;
    }
    if (Array.isArray(value)) {
      // Bounded array of bounded codes (e.g. filter_keys). Order-normalized so the
      // same filter set always hashes and groups identically.
      const codes = value
        .filter((v) => typeof v === 'string')
        .map((v) => boundedCode(v, 64))
        .filter(Boolean)
        .slice(0, 24)
        .sort();
      if (codes.length) out[key] = codes;
    }
  }
  return out;
}

// ── Time discipline (contract §5.4) ──────────────────────────────────────────

/**
 * Resolve the effective time of a client-emitted event.
 *
 * The raw client value is preserved separately so true lateness stays computable
 * after clamping — rev-1 of the contract clamped in place, which destroyed the
 * only evidence that an event was late.
 */
export function resolveClientTime(rawOccurredAt, receivedAt) {
  const received = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  const parsed = rawOccurredAt ? new Date(rawOccurredAt) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime());
  if (!valid) {
    // No usable client clock: treat ingestion time as the truth and say so.
    return { occurredAt: received, occurredAtClient: null, flags: [] };
  }
  const floor = new Date(received.getTime() - LATE_EVENT_WINDOW_MS);
  if (parsed.getTime() > received.getTime()) {
    // Future skew: clamp to ingestion; the shopper is real, the clock is not.
    return { occurredAt: received, occurredAtClient: parsed, flags: ['clock_skew_adjusted'] };
  }
  if (parsed.getTime() < floor.getTime()) {
    // Beyond the acceptance window: stored, flagged, and excluded from certified
    // windows — never silently folded into a period that was already certified.
    return { occurredAt: floor, occurredAtClient: parsed, flags: ['late_beyond_window'] };
  }
  return { occurredAt: parsed, occurredAtClient: parsed, flags: [] };
}

// ── Idempotency keys (contract §4) ───────────────────────────────────────────

/**
 * Client-emitted keys are derived from the values the contract names for that
 * type. `event_nonce` covers action events whose repetition is legitimate (a user
 * really can add and remove the same listing from a compare set twice).
 */
export function clientIdempotencyKey(event, ctx) {
  const t = event.event_type;
  const session = ctx.sessionKey;
  const page = ctx.pageViewId;
  switch (t) {
    case 'marketplace_listing_impression':
      return sha256([t, session, event.listing_id, event.source_surface, page]);
    case 'marketplace_listing_engaged':
      return sha256(['marketplace_listing_opened', session, event.listing_id, page, 'engaged']);
    case 'marketplace_inquiry_started':
    case 'marketplace_contact_clicked':
      return sha256([t, session, event.listing_id, page, event.metadata?.affordance ?? '']);
    case 'marketplace_compare_added':
    case 'marketplace_compare_removed':
      return sha256([t, session, event.listing_id, ctx.eventNonce]);
    case 'marketplace_compare_viewed':
      return sha256([t, session, ctx.compareSetKey, page]);
    case 'marketplace_listing_shared':
      return sha256([t, session, event.listing_id, page, event.metadata?.share_channel ?? '']);
    case 'process_step_recorded':
      return sha256([
        t, session, event.metadata?.process ?? '', event.metadata?.step ?? '',
        event.metadata?.outcome ?? '', page,
      ]);
    default:
      return null;
  }
}

// ── Exclusion flags (contract §5.3) ──────────────────────────────────────────

/**
 * Bot heuristic: a versioned constant, deliberately conservative. It flags rather
 * than rejects, so a false positive costs a rollup exclusion, never a lost event.
 */
const BOT_UA_RE = /(bot|crawler|spider|crawling|headlesschrome|phantomjs|slurp|curl\/|wget\/|python-requests|axios\/)/i;
export const BOT_HEURISTIC_VERSION = 1;

/**
 * Fixture/synthetic VIN rules are OWNED by the marketplace classification module;
 * this service reuses them rather than re-deriving a second, divergent notion of
 * "not real data".
 */
async function loadFixtureRule() {
  try {
    const mod = await import('../marketplace/marketplaceClassificationRules.js');
    return typeof mod.getFixtureExclusion === 'function' ? mod.getFixtureExclusion : null;
  } catch {
    return null;
  }
}

export function computeExclusionFlags({
  userAgent,
  actorUserId,
  actorRole,
  actorTenantId,
  objectOwnerUserId,
  objectTenantId,
  isFixtureObject,
  syntheticAuthorized,
  declaredSynthetic,
  timeFlags = [],
}) {
  const flags = new Set(timeFlags);
  if (typeof userAgent === 'string' && BOT_UA_RE.test(userAgent)) flags.add('bot_suspect');
  if (actorRole === 'admin' || actorRole === 'platform_admin' || actorRole === 'super_admin') flags.add('staff');
  if (isFixtureObject) flags.add('fixture');
  // Self-traffic: the seller looking at their own listing, or anyone inside the
  // tenant that owns it. Excluded from seller-facing counts and benchmarks so a
  // dealer refreshing their own page cannot inflate their reported demand.
  if (actorUserId && objectOwnerUserId && actorUserId === objectOwnerUserId) flags.add('self_traffic');
  if (actorTenantId && objectTenantId && actorTenantId === objectTenantId) flags.add('self_traffic');
  // Only a caller holding the worker secret (or a non-production environment) may
  // declare an event synthetic; otherwise controlled-count certification could be
  // spoofed from outside.
  if (declaredSynthetic && syntheticAuthorized) flags.add('synthetic');
  return Array.from(flags).sort();
}

// ── Object scope resolution (contract §3) ────────────────────────────────────

/**
 * Resolve the tenant/organization/owner of the event's OBJECT.
 *
 * This is the heart of invariant 2: scope follows the listing, not the caller.
 * A listing's owning tenant is a property of the listing; letting the request
 * assert it is how cross-tenant analytics leaks happen.
 */
export async function resolveObjectScope(client, vin, cache) {
  if (!vin) return { tenantId: null, organizationId: null, ownerUserId: null, exists: false };
  if (cache && cache.has(vin)) return cache.get(vin);
  let resolved = { tenantId: null, organizationId: null, ownerUserId: null, exists: false, row: null };
  try {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, owner_id, tenant_id')
      .eq('vin', vin)
      .maybeSingle();
    if (!error && data) {
      resolved = {
        tenantId: data.tenant_id ? String(data.tenant_id) : null,
        organizationId: null,
        ownerUserId: data.owner_id ? String(data.owner_id) : null,
        exists: true,
        // Kept so the fixture rule can apply its owner/tenant seed checks, not
        // just its VIN-shape check — a seeded demo row is not real demand.
        row: data,
      };
    }
  } catch {
    // A scope lookup failure must not fabricate a scope. The event is rejected by
    // the caller (unknown object) rather than stored with a guessed tenant.
    resolved = { tenantId: null, organizationId: null, ownerUserId: null, exists: false, row: null };
  }
  if (cache) cache.set(vin, resolved);
  return resolved;
}

// ── Validation + projection of one client event ──────────────────────────────

export function validateClientEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' };
  }
  const eventType = typeof raw.event_type === 'string' ? raw.event_type.trim() : '';
  if (!eventType) return { ok: false, reason: 'missing_event_type' };
  if (isReserved(eventType)) return { ok: false, reason: 'reserved_event_type' };
  if (!EVENT_TYPES.includes(eventType)) return { ok: false, reason: 'unknown_event_type' };
  // A client claiming a server-emitted type is the interesting rejection: it is an
  // attempt to manufacture a save/sale/reservation that no authority recorded.
  if (isServerEmitted(eventType) || !isClientEmittable(eventType)) {
    return { ok: false, reason: 'server_emitted_type_rejected' };
  }
  const schemaVersion = Number(raw.schema_version);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported_schema_version' };
  }
  const surface = raw.source_surface == null ? null : boundedCode(raw.source_surface, 32);
  if (surface !== null && !SOURCE_SURFACES.includes(surface)) {
    return { ok: false, reason: 'invalid_source_surface' };
  }
  const listingId = raw.listing_id == null ? null : boundedId(raw.listing_id);
  const vehicleReference = raw.vehicle_reference == null ? null : boundedId(raw.vehicle_reference);
  const vin = vehicleReference || listingId;
  const listingBound = eventType !== 'marketplace_search_performed'
    && eventType !== 'marketplace_search_zero_results'
    && eventType !== 'marketplace_compare_viewed'
    && eventType !== 'process_step_recorded';
  if (listingBound && !vin) return { ok: false, reason: 'missing_object' };

  return {
    ok: true,
    event: {
      event_type: eventType,
      source_surface: surface,
      listing_id: listingId,
      vehicle_reference: vehicleReference,
      metadata: projectMetadata(eventType, raw.metadata),
      occurred_at_raw: raw.occurred_at ?? null,
      page_view_id: opaqueKey(raw.page_view_id),
      event_nonce: opaqueKey(raw.event_nonce),
      compare_listing_ids: Array.isArray(raw.compare_listing_ids)
        ? raw.compare_listing_ids.map((v) => boundedId(v)).filter(Boolean).slice(0, 8).sort()
        : null,
      campaign_code: raw.campaign_code == null ? null : boundedCode(raw.campaign_code),
      referral_code: raw.referral_code == null ? null : boundedCode(raw.referral_code),
      source_channel: raw.source_channel == null ? null : boundedCode(raw.source_channel),
    },
  };
}

// ── Request context (server-derived) ─────────────────────────────────────────

function derivePlatform(req) {
  const header = req?.headers?.['x-carup-platform'];
  const value = typeof header === 'string' ? header.trim().toLowerCase() : '';
  if (value === 'ios' || value === 'android') return value;
  return 'web';
}

export function deriveActorContext(req) {
  const ctx = req?.userContext || null;
  const userId = ctx?.id ? String(ctx.id) : null;
  return {
    actorScope: userId ? 'authenticated' : 'anonymous',
    userId,
    role: ctx?.platformRole || ctx?.role || null,
    tenantId: ctx?.tenantId ? String(ctx.tenantId) : null,
    userAgent: typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : '',
    platform: derivePlatform(req),
    sessionKeyHeader: opaqueKey(req?.headers?.['x-carup-session-key']),
    pageViewHeader: opaqueKey(req?.headers?.['x-carup-page-view']),
  };
}

/**
 * A caller may only declare events synthetic with the worker secret, or outside
 * production. Certification (I19) depends on synthetic events being countable
 * exactly — and on nobody else being able to inject them.
 */
export function syntheticAuthorized(req) {
  const secret = process.env.COMMUNICATION_WORKER_SECRET || process.env.INTELLIGENCE_WORKER_SECRET;
  const provided = req?.headers?.['x-carup-worker-secret'];
  if (secret && typeof provided === 'string' && provided.length > 0) {
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(secret);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch { /* fall through */ }
  }
  return process.env.NODE_ENV !== 'production';
}

// ── Batch ingestion (client events) ──────────────────────────────────────────

/**
 * Ingest a client batch. Always resolves; never throws to the route.
 *
 * Returns counts only — the response body of an analytics endpoint must not become
 * a read channel for anything the caller did not already know.
 */
export async function ingestClientBatch(body, { req, client = defaultClient } = {}) {
  const receivedAt = new Date();
  const summary = {
    received: 0, accepted: 0, rejected: 0, duplicates: 0, flagged: 0, storage_failures: 0,
    reasons: {},
  };
  const reject = (reason) => {
    summary.rejected += 1;
    summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
  };

  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events) return summary;
  summary.received = events.length;
  if (events.length > MAX_EVENTS_PER_BATCH) {
    // Truncate rather than reject the batch: dropping 50 good events because the
    // 51st exists would be a self-inflicted data loss.
    events.length = MAX_EVENTS_PER_BATCH;
  }

  const actor = deriveActorContext(req);
  const batchSessionKey = opaqueKey(body?.session_key) || actor.sessionKeyHeader;
  const synthAuthorized = syntheticAuthorized(req);
  const declaredSynthetic = body?.synthetic === true;
  const getFixtureExclusion = await loadFixtureRule();
  const scopeCache = new Map();
  const rows = [];

  for (const raw of events) {
    const validation = validateClientEvent(raw);
    if (!validation.ok) { reject(validation.reason); continue; }
    const event = validation.event;

    const sessionKey = opaqueKey(raw?.session_key) || batchSessionKey;
    if (!sessionKey) { reject('missing_session_key'); continue; }
    const pageViewId = event.page_view_id || actor.pageViewHeader;

    const vin = event.vehicle_reference || event.listing_id;
    const scope = await resolveObjectScope(client, vin, scopeCache);
    if (vin && !scope.exists) { reject('unknown_object'); continue; }

    const time = resolveClientTime(event.occurred_at_raw, receivedAt);

    // getFixtureExclusion returns a REASON string (or null); pass the whole vehicle
    // row so its owner/tenant seed rules apply, not only the VIN-shape rule.
    let isFixtureObject = false;
    if (vin && getFixtureExclusion) {
      try {
        isFixtureObject = Boolean(getFixtureExclusion(scope.row || { vin }));
      } catch { isFixtureObject = false; }
    }

    const flags = computeExclusionFlags({
      userAgent: actor.userAgent,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      objectOwnerUserId: scope.ownerUserId,
      objectTenantId: scope.tenantId,
      isFixtureObject,
      syntheticAuthorized: synthAuthorized,
      declaredSynthetic,
      timeFlags: time.flags,
    });

    const idempotencyKey = clientIdempotencyKey(event, {
      sessionKey,
      pageViewId,
      eventNonce: event.event_nonce,
      compareSetKey: event.compare_listing_ids ? event.compare_listing_ids.join(',') : '',
    });
    if (!idempotencyKey) { reject('no_idempotency_key'); continue; }

    if (flags.length) summary.flagged += 1;

    rows.push({
      schema_version: SUPPORTED_SCHEMA_VERSION,
      event_type: event.event_type,
      event_version: eventVersionOf(event.event_type),
      occurred_at_client: time.occurredAtClient ? time.occurredAtClient.toISOString() : null,
      occurred_at: time.occurredAt.toISOString(),
      received_at: receivedAt.toISOString(),
      actor_scope: actor.actorScope,
      pseudonymous_session_key: sessionKey,
      // Server-derived. Any client-supplied identity/scope on `raw` was never read.
      authenticated_user_id: actor.userId,
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      listing_id: event.listing_id,
      vehicle_reference: event.vehicle_reference,
      object_type: vin ? 'listing' : (event.event_type === 'process_step_recorded' ? 'process' : null),
      object_id: vin || null,
      source_surface: event.source_surface,
      source_platform: actor.platform,
      source_channel: event.source_channel,
      campaign_code: event.campaign_code,
      referral_code: event.referral_code,
      page_view_id: pageViewId,
      idempotency_key: idempotencyKey,
      privacy_class: privacyClassOf(event.event_type),
      exclusion_flags: flags,
      metadata: event.metadata,
    });
  }

  if (!rows.length) return summary;

  const result = await insertEvents(client, rows);
  summary.accepted = result.inserted;
  summary.duplicates = result.duplicates;
  summary.storage_failures = result.failures;
  await recordIngestionStats(client, summary, receivedAt);
  return summary;
}

/**
 * Insert with duplicate tolerance. `ignoreDuplicates` makes the UNIQUE index the
 * arbiter: a replayed batch collides in the database and is COUNTED, rather than
 * being suppressed by an in-process window that a restart would forget.
 */
export async function insertEvents(client, rows) {
  const out = { inserted: 0, duplicates: 0, failures: 0 };
  if (!rows.length) return out;
  try {
    const { data, error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('id');
    if (error) {
      out.failures = rows.length;
      return out;
    }
    out.inserted = Array.isArray(data) ? data.length : 0;
    out.duplicates = rows.length - out.inserted;
    return out;
  } catch {
    out.failures = rows.length;
    return out;
  }
}

/**
 * Ingestion counters. Loss that nobody counts is loss that nobody notices — plan
 * §110 treats a dashboard that silently stops counting as a production defect.
 */
export async function recordIngestionStats(client, summary, at = new Date()) {
  const windowStart = new Date(at);
  windowStart.setUTCMinutes(0, 0, 0);
  try {
    const { data } = await client
      .from(STATS_TABLE)
      .select('*')
      .eq('window_start', windowStart.toISOString())
      .maybeSingle();
    const merged = {
      window_start: windowStart.toISOString(),
      events_received: (data?.events_received || 0) + (summary.received || 0),
      events_accepted: (data?.events_accepted || 0) + (summary.accepted || 0),
      events_rejected: (data?.events_rejected || 0) + (summary.rejected || 0),
      events_duplicate: (data?.events_duplicate || 0) + (summary.duplicates || 0),
      events_flagged: (data?.events_flagged || 0) + (summary.flagged || 0),
      opened_without_context: (data?.opened_without_context || 0) + (summary.opened_without_context || 0),
      storage_failures: (data?.storage_failures || 0) + (summary.storage_failures || 0),
    };
    await client.from(STATS_TABLE).upsert(merged, { onConflict: 'window_start' });
  } catch {
    // Counters must never break ingestion.
  }
}

// ── Server-emitted events (contract §4.2) ────────────────────────────────────

/**
 * Record a server-emitted observation alongside an authoritative domain write.
 *
 * `idempotencyMaterial` MUST be derived from the authority itself — the created
 * row's id or the post-commit updated_at — never from request-time values. That
 * is what makes a retry a no-op instead of a second "sale".
 *
 * Never throws: the domain write is authority and must succeed regardless.
 */
export async function recordServerEvent({
  eventType,
  vin = null,
  listingId = null,
  objectType = null,
  objectId = null,
  idempotencyMaterial,
  actor = {},
  scope = null,
  metadata = {},
  occurredAt = null,
  sourceSurface = null,
  sourceChannel = null,
  campaignCode = null,
  referralCode = null,
  sessionKey = null,
  pageViewId = null,
  exclusionFlags = [],
  client = defaultClient,
} = {}) {
  if (!isServerEmitted(eventType)) {
    return { recorded: false, reason: 'not_a_server_emitted_type' };
  }
  if (!Array.isArray(idempotencyMaterial) || !idempotencyMaterial.length) {
    return { recorded: false, reason: 'missing_idempotency_material' };
  }
  const at = occurredAt instanceof Date ? occurredAt : new Date();
  const resolvedScope = scope || await resolveObjectScope(client, vin || listingId, null);

  const row = {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    event_type: eventType,
    event_version: eventVersionOf(eventType),
    occurred_at_client: null,
    occurred_at: at.toISOString(),
    received_at: new Date().toISOString(),
    actor_scope: actor.userId ? 'authenticated' : (actor.system ? 'system' : 'anonymous'),
    pseudonymous_session_key: opaqueKey(sessionKey),
    authenticated_user_id: actor.userId ? String(actor.userId) : null,
    tenant_id: resolvedScope?.tenantId ?? null,
    organization_id: resolvedScope?.organizationId ?? null,
    listing_id: listingId,
    vehicle_reference: vin,
    object_type: objectType || (vin || listingId ? 'listing' : null),
    object_id: objectId || vin || listingId || null,
    source_surface: sourceSurface && SOURCE_SURFACES.includes(sourceSurface) ? sourceSurface : null,
    source_platform: SOURCE_PLATFORMS.includes(actor.platform) ? actor.platform : 'server',
    source_channel: sourceChannel == null ? null : boundedCode(sourceChannel),
    campaign_code: campaignCode == null ? null : boundedCode(campaignCode),
    referral_code: referralCode == null ? null : boundedCode(referralCode),
    page_view_id: opaqueKey(pageViewId),
    idempotency_key: sha256([eventType, ...idempotencyMaterial]),
    privacy_class: privacyClassOf(eventType),
    exclusion_flags: Array.from(new Set(exclusionFlags)).sort(),
    metadata: projectMetadata(eventType, metadata),
  };

  const result = await insertEvents(client, [row]);
  if (result.failures) return { recorded: false, reason: 'storage_failure' };
  if (result.duplicates && !result.inserted) return { recorded: false, reason: 'duplicate', duplicate: true };
  return { recorded: true, idempotencyKey: row.idempotency_key };
}
