/**
 * CarUp Intelligence 1.0 — I16 automotive intelligence command centre.
 *
 * The plan asks for a single admin surface covering Overview, Supply, Demand,
 * Quality, Trust/Evidence, Communications, Transactions, the stakeholder
 * verticals, Marketing, Customer Health, Revenue, Risk and Platform.
 *
 * Two design decisions shape this module, and both are about NOT becoming a
 * second source of truth.
 *
 * IT COMPOSES, IT DOES NOT RECOMPUTE. The verticals already have governed
 * projections — insurance (I10), finance (I11), parts (I12), trade (I13),
 * referral (I14), institutional (I15), dealer (I8), service (I9). The command
 * centre does not restate their figures under new names, because two surfaces
 * quoting the same domain from different code is exactly how they start
 * disagreeing. It points at them instead.
 *
 * EVERY SECTION DECLARES ITS SOURCE OR ITS ABSENCE. A section is either backed by
 * a named authoritative table, or it says what is missing. Three sections have no
 * source at all — revenue, customer health and platform health — and they say so
 * rather than being quietly omitted, because an omitted section reads as an
 * oversight while a declared one reads as a fact about the platform.
 *
 * Trust is deliberately NOT aggregated here. Only the canonical trust authority
 * may state a Trust position, and a distribution assembled from vehicle columns
 * would be a second, unversioned trust source (Issue #164). This module reports
 * how much EVIDENCE has been reviewed and points at the canonical authority for
 * the rest.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';
import { summarizeProvenance, UNKNOWN as UNKNOWN_CLASS } from '../provenance/recordProvenance.js';
import { createProvenanceIndex } from '../provenance/provenanceContext.js';

// command_centre@2 (PC01-K2B): business figures count operational records only, each section states
// how many records it set aside by provenance class, and Supply reads vehicles by `vin`.
export const COMMAND_CENTRE_VERSION = 'command_centre@2';

/** Activity-ledger flags that already mark an event as not customer engagement. */
export const NON_ENGAGEMENT_EVENT_FLAGS = Object.freeze(['self_traffic', 'bot_suspect', 'staff', 'fixture', 'synthetic']);

/**
 * The records a section set aside, so an administrator sees that they exist and why they are not in
 * the business figure. Counts only — no identities.
 */
function setAside(results) {
  const s = summarizeProvenance(results);
  return {
    records_read: s.raw,
    operational: s.operational,
    excluded_non_operational: s.excluded_non_operational,
    unknown_requires_review: s.unknown_requires_review,
    by_class: s.by_class,
  };
}

/** A figure that cannot be separated from test data is stated as such, never as a business number. */
const notSeparable = (reason) => metric(null, { availability: AVAILABILITY.UNAVAILABLE, reason });

const PLATFORM_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

/**
 * The sections that have no source at all, each with the specific reason.
 *
 * These are declared rather than omitted: a missing section looks like an
 * oversight, while a declared one is a statement about what CarUp does not yet do.
 */
export const SECTIONS_WITHOUT_A_SOURCE = Object.freeze([
  {
    key: 'revenue',
    label: 'Revenue',
    reason: 'no_revenue_record',
    detail: 'CarUp records no completed payment. Subscriptions are empty, no finance disbursement exists, no trade milestone has been confirmed and every escrow session used a sandbox provider. There is no revenue to report.',
  },
  {
    key: 'customer_health',
    label: 'Customer health',
    reason: 'no_retention_model',
    detail: 'CarUp holds no churn, retention, satisfaction or account-health model. A health score would be an invention, and an invented one on this surface would drive real decisions about real accounts.',
  },
  {
    key: 'platform_health',
    label: 'Platform health',
    reason: 'no_health_measurement',
    detail: 'No uptime, latency or error-rate measurement is collected into a platform health figure. The admin API previously returned the literal string "Optimal" for this, which asserted a check nobody ran.',
  },
  {
    key: 'fraud_interception_rate',
    label: 'Fraud interception rate',
    reason: 'no_interception_measurement',
    detail: 'CarUp computes no fraud interception rate. The admin API previously returned the literal "98.5%", which an administrator saw as a measured rate.',
  },
]);

/**
 * The verticals, and where each one is actually answered.
 *
 * Pointers, not copies. A figure quoted in two places from two code paths is a
 * figure that will eventually disagree with itself.
 */
export const VERTICAL_SOURCES = Object.freeze([
  { key: 'dealer', label: 'Dealer', endpoint: '/api/dealer/analytics', phase: 'I8' },
  { key: 'service', label: 'Mechanic and garage', endpoint: '/api/mechanic/analytics', phase: 'I9' },
  { key: 'insurance', label: 'Insurance demand', endpoint: '/api/insurance/demand-intelligence', phase: 'I10' },
  { key: 'finance', label: 'Finance demand', endpoint: '/api/finance/demand-intelligence', phase: 'I11' },
  { key: 'parts', label: 'Parts and provenance', endpoint: '/api/admin/parts/intelligence', phase: 'I12' },
  { key: 'trade', label: 'Diaspora trade', endpoint: '/api/trade/intelligence', phase: 'I13' },
  { key: 'marketing', label: 'Referral and marketing', endpoint: '/api/admin/referrals/intelligence', phase: 'I14' },
  { key: 'institutional', label: 'Institutional provenance', endpoint: '/api/government/provenance-intelligence', phase: 'I15' },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function requirePlatformScope(actor) {
  const role = String(actor?.platformRole || actor?.role || '');
  if (!PLATFORM_ROLES.has(role)) {
    throw new AuthorizationError('The command centre requires a platform administrator.');
  }
  // An institutional role is not a platform administrator (gap G5).
  return role;
}

/**
 * A section that could not be read.
 *
 * Distinct from a section with no source: this one HAS a source and the read
 * failed, which is a different thing to tell an administrator.
 */
function unreadableSection(source, reason) {
  return {
    available: false,
    unreadable: true,
    source,
    reason: String(reason || 'read_failed'),
    note: 'This section could not be read. Its figures are NOT zero.',
  };
}

/**
 * The behavioural demand section.
 *
 * The activity ledger exists and is instrumented, but holds no rows on staging.
 * "Instrumented, nothing recorded yet" and "nobody is interested" are completely
 * different statements, and only the first is true.
 */
export function demandSection(inquiries, activityEvents, savedVehicles, { recordedEvents = activityEvents.length } = {}) {
  // "Nothing recorded" is decided on what the ledger RECORDED; once events exist, the figure is the
  // engagement that survived provenance filtering — a measured number, possibly zero.
  return {
    available: true,
    source: 'marketplace_inquiries, marketplace_activity_events, saved_vehicles',
    metrics: {
      inquiries: metric(inquiries.length),
      saved_vehicles: metric(savedVehicles.length),
      behavioural_events: recordedEvents === 0
        ? metric(null, { availability: AVAILABILITY.INSUFFICIENT_DATA, reason: 'ledger_instrumented_but_empty' })
        : metric(activityEvents.length),
    },
    note: recordedEvents === 0
      ? 'The activity ledger is instrumented but holds no events for this period. That is not an absence of interest — it is an absence of recorded events.'
      : null,
  };
}

export async function getCommandCentre(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  requirePlatformScope(actor);
  const { start, end } = windowBounds(windowDays);
  const inWindow = (rows) => rows.filter((row) => row.created_at && row.created_at >= start && row.created_at < end);

  const sections = {};

  /** Read one section's tables; a failure degrades that section only. */
  const load = async (key, source, reader) => {
    try {
      sections[key] = await reader();
      sections[key].source = source;
    } catch (error) {
      sections[key] = unreadableSection(source, error?.message);
    }
  };

  // ONE provenance index for the whole page: every section judges a record by its creator through the
  // same authority the Marketplace and Admin queues use. Users and vehicles are read separately so a
  // failure degrades only the sections that depend on the table that failed — never the whole page.
  const sources = { users: null, vehicles: null };
  const sourceErrors = {};
  try {
    sources.users = await readAllPages(() => client.from('users').select('id, email, name, created_at'));
  } catch (error) {
    sourceErrors.users = error;
  }
  try {
    // Vehicles are keyed by `vin`. The previous projection selected `vehicles.id`, a column that does
    // not exist, so this section could never load (PC01-K2B P1-1).
    sources.vehicles = await readAllPages(() => client
      .from('vehicles')
      .select('vin, owner_id, tenant_id, make, seller_description, publication_status, created_at'));
  } catch (error) {
    sourceErrors.vehicles = error;
  }
  const users = sources.users || [];
  const vehicles = sources.vehicles || [];
  const index = createProvenanceIndex({ users, vehicles });
  /** A section that classifies through a source that could not be read is unreadable, not zero. */
  const needsIndex = (reader, deps = ['users', 'vehicles']) => async () => {
    const failed = deps.find((d) => sources[d] === null);
    if (failed) throw sourceErrors[failed] || new Error(`${failed}_unavailable`);
    return reader();
  };

  await load('overview', 'users, organizations', needsIndex(async () => {
    const orgs = await readAllPages(() => client.from('organizations').select('id, created_at'));
    const classified = users.map((u) => ({ row: u, provenance: index.identity(u.id) }));
    const operational = classified.filter((c) => c.provenance.operational).map((c) => c.row);
    return {
      available: true,
      metrics: {
        users_total: metric(operational.length),
        users_joined_in_window: metric(inWindow(operational).length),
        // Organisations carry no creator to classify. Until they do, a non-empty count cannot be
        // separated from test organisations and is not stated as a business figure.
        organizations_total: orgs.length === 0 ? metric(0) : notSeparable('provenance_not_separable'),
      },
      provenance: setAside(classified.map((c) => c.provenance)),
    };
  }, ['users']));

  await load('supply', 'vehicles', needsIndex(async () => {
    const classified = vehicles.map((v) => ({ row: v, provenance: index.vehicle(v.vin) }));
    const operational = classified.filter((c) => c.provenance?.operational).map((c) => c.row);
    const published = operational.filter((row) => String(row.publication_status) === 'published');
    return {
      available: true,
      metrics: {
        vehicles_total: metric(operational.length),
        vehicles_published: metric(published.length),
        vehicles_unpublished: metric(operational.length - published.length),
        listed_in_window: metric(inWindow(operational).length),
      },
      provenance: setAside(classified.map((c) => c.provenance)),
    };
  }));

  await load('demand', 'marketplace_inquiries, marketplace_activity_events, saved_vehicles', needsIndex(async () => {
    const inquiries = inWindow(await readAllPages(() => client
      .from('marketplace_inquiries')
      .select('id, status, buyer_id, guest_email, guest_name, listing_id, listing_type, created_at')));
    const events = inWindow(await readAllPages(() => client
      .from('marketplace_activity_events')
      .select('id, event_type, authenticated_user_id, listing_id, vehicle_reference, exclusion_flags, occurred_at, created_at')));
    // "Saved" is labelled with the period, so it is counted within the period.
    const saved = inWindow(await readAllPages(() => client
      .from('saved_vehicles').select('id, user_id, vin, created_at')));

    const inquiryResults = inquiries.map((r) => index.inquiry(r));
    const savedOperational = saved.filter((r) => index.identity(r.user_id)?.operational && index.vehicle(r.vin)?.operational === true);
    // An event counts only when its actor is evidenced as operational. Flags, a test actor or a test
    // object set it aside; an ANONYMOUS actor has no evidence either way, so it needs review — on
    // staging that is overwhelmingly unflagged automation browsing, indistinguishable from a visitor.
    const eventState = (e) => {
      const flags = Array.isArray(e.exclusion_flags) ? e.exclusion_flags : [];
      if (flags.some((f) => NON_ENGAGEMENT_EVENT_FLAGS.includes(f))) return 'excluded';
      const object = index.vehicle(e.listing_id || e.vehicle_reference);
      if (object && !object.operational && object.class !== UNKNOWN_CLASS) return 'excluded';
      if (!e.authenticated_user_id) return 'unknown';
      const actor = index.identity(e.authenticated_user_id);
      if (!actor?.operational) return actor?.class === UNKNOWN_CLASS ? 'unknown' : 'excluded';
      if (object && !object.operational) return 'unknown';
      return 'operational';
    };
    const eventStates = events.map(eventState);
    const engagement = events.filter((_, i) => eventStates[i] === 'operational');
    const eventsNeedingReview = eventStates.filter((st) => st === 'unknown').length;
    const section = demandSection(
      inquiries.filter((_, i) => inquiryResults[i].operational),
      engagement,
      savedOperational,
      { recordedEvents: events.length },
    );
    // Engagement that cannot be separated from test traffic is not stated as a business number.
    if (events.length > 0 && eventsNeedingReview > 0) {
      section.metrics.behavioural_events = notSeparable('anonymous_activity_not_separable');
    }
    section.provenance = {
      inquiries: setAside(inquiryResults),
      saved_vehicles: { records_read: saved.length, operational: savedOperational.length, excluded: saved.length - savedOperational.length },
      behavioural_events: {
        records_read: events.length,
        operational: engagement.length,
        excluded_non_operational: eventStates.filter((st) => st === 'excluded').length,
        unknown_requires_review: eventsNeedingReview,
        exclusion_basis: 'activity flags (self/bot/staff/fixture/synthetic), non-operational actor, or non-operational vehicle; anonymous activity needs review',
      },
    };
    return section;
  }));

  await load('trust_evidence', 'vehicle_evidence', needsIndex(async () => {
    const evidence = await readAllPages(() => client
      .from('vehicle_evidence').select('id, vin, verification_status, created_at'));
    const results = evidence.map((r) => index.vehicle(r.vin) || { class: 'unknown_requires_review', operational: false });
    const operational = evidence.filter((_, i) => results[i].operational);
    return {
      available: true,
      metrics: {
        evidence_reviewed: metric(operational.filter((r) => String(r.verification_status) === 'verified').length),
        evidence_awaiting_review: metric(operational.filter((r) => String(r.verification_status) === 'pending').length),
      },
      provenance: setAside(results),
      // A trust distribution assembled here would be a second trust source.
      trust_authority: 'Trust positions are stated only by the canonical trust service. No Trust distribution is aggregated on this surface.',
    };
  }));

  await load('communications', 'message_threads, messages', needsIndex(async () => {
    // Volume of OPERATIONAL conversations. Certification threads stay governed evidence in
    // Communications; they are only left out of this business volume, never removed.
    const threads = await readAllPages(() => client.from('message_threads').select('id, primary_user_id, created_at'));
    const messages = await readAllPages(() => client.from('messages').select('id, thread_id, created_at'));
    const threadResult = new Map(threads.map((t) => [t.id, index.identity(t.primary_user_id) || { class: 'unknown_requires_review', operational: false }]));
    const windowedThreads = inWindow(threads);
    const threadResults = windowedThreads.map((t) => threadResult.get(t.id));
    const windowedMessages = inWindow(messages);
    return {
      available: true,
      metrics: {
        threads: metric(windowedThreads.filter((t) => threadResult.get(t.id)?.operational).length),
        messages: metric(windowedMessages.filter((m) => threadResult.get(m.thread_id)?.operational).length),
      },
      provenance: setAside(threadResults),
      authority: 'Communications remains the authority on conversation state. These are volume counts only, of operational conversations.',
    };
  }, ['users']));

  await load('transactions', 'escrow_trust_sessions', needsIndex(async () => {
    const sessions = await readAllPages(() => client
      .from('escrow_trust_sessions')
      .select('id, vin, status, payment_provider_mode, created_at'));
    const windowed = inWindow(sessions);
    // A sandbox session is a test by definition; a live one is operational only on an operational car.
    const results = windowed.map((row) => (String(row.payment_provider_mode) === 'live'
      ? index.vehicle(row.vin) || { class: 'unknown_requires_review', operational: false }
      : { class: 'uat', operational: false }));
    const live = windowed.filter((row, i) => String(row.payment_provider_mode) === 'live' && results[i].operational);
    const sandbox = windowed.filter((row) => String(row.payment_provider_mode) === 'sandbox');
    return {
      available: true,
      metrics: {
        sessions_opened: metric(live.length),
        live_settlements: metric(live.filter((r) => String(r.status) === 'settled').length),
        sandbox_settlements: metric(sandbox.filter((r) => String(r.status) === 'settled').length),
      },
      provenance: setAside(results),
      note: live.length === 0
        ? 'No operational session used a live payment provider, so no settlement here represents money that moved.'
        : null,
    };
  }));

  await load('risk', 'insurance_claims', needsIndex(async () => {
    const claims = inWindow(await readAllPages(() => client
      .from('insurance_claims').select('id, vin, user_id, created_at')));
    const results = claims.map((r) => index.vehicle(r.vin) || index.identity(r.user_id) || { class: 'unknown_requires_review', operational: false });
    return {
      available: true,
      metrics: { claims_recorded: metric(claims.filter((_, i) => results[i].operational).length) },
      provenance: setAside(results),
      // Counts only. A verdict belongs to the governed risk domain.
      boundary: 'Volume only. Fraud and underwriting adjudication are a separate governed domain and no risk verdict is issued here.',
    };
  }));

  return {
    scope: 'platform',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: COMMAND_CENTRE_VERSION,

    sections,
    verticals: VERTICAL_SOURCES.map((entry) => ({ ...entry })),
    sections_without_a_source: SECTIONS_WITHOUT_A_SOURCE.map((entry) => ({ ...entry })),

    composition_note: 'Each vertical is answered by its own governed projection and is linked rather than restated here, so two surfaces cannot quote the same domain differently.',
  };
}
