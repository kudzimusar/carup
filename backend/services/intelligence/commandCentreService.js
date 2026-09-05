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

export const COMMAND_CENTRE_VERSION = 'command_centre@1';

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
export function demandSection(inquiries, activityEvents, savedVehicles) {
  return {
    available: true,
    source: 'marketplace_inquiries, marketplace_activity_events, saved_vehicles',
    metrics: {
      inquiries: metric(inquiries.length),
      saved_vehicles: metric(savedVehicles.length),
      behavioural_events: activityEvents.length === 0
        ? metric(null, { availability: AVAILABILITY.INSUFFICIENT_DATA, reason: 'ledger_instrumented_but_empty' })
        : metric(activityEvents.length),
    },
    note: activityEvents.length === 0
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

  await load('overview', 'users, organizations', async () => {
    const users = await readAllPages(() => client.from('users').select('id, created_at'));
    const orgs = await readAllPages(() => client.from('organizations').select('id, created_at'));
    return {
      available: true,
      metrics: {
        users_total: metric(users.length),
        users_joined_in_window: metric(inWindow(users).length),
        organizations_total: metric(orgs.length),
      },
    };
  });

  await load('supply', 'vehicles', async () => {
    const vehicles = await readAllPages(() => client
      .from('vehicles')
      .select('id, publication_status, created_at'));
    const published = vehicles.filter((row) => String(row.publication_status) === 'published');
    return {
      available: true,
      metrics: {
        vehicles_total: metric(vehicles.length),
        vehicles_published: metric(published.length),
        vehicles_unpublished: metric(vehicles.length - published.length),
        listed_in_window: metric(inWindow(vehicles).length),
      },
    };
  });

  await load('demand', 'marketplace_inquiries, marketplace_activity_events, saved_vehicles', async () => {
    const inquiries = await readAllPages(() => client
      .from('marketplace_inquiries').select('id, status, created_at'));
    const events = await readAllPages(() => client
      .from('marketplace_activity_events').select('id, event_type, occurred_at, created_at'));
    const saved = await readAllPages(() => client
      .from('saved_vehicles').select('id, created_at'));
    return demandSection(inWindow(inquiries), inWindow(events), saved);
  });

  await load('trust_evidence', 'vehicle_evidence', async () => {
    const evidence = await readAllPages(() => client
      .from('vehicle_evidence').select('id, verification_status, created_at'));
    return {
      available: true,
      metrics: {
        evidence_reviewed: metric(evidence.filter((r) => String(r.verification_status) === 'verified').length),
        evidence_awaiting_review: metric(evidence.filter((r) => String(r.verification_status) === 'pending').length),
      },
      // A trust distribution assembled here would be a second trust source.
      trust_authority: 'Trust positions are stated only by the canonical trust service. No Trust distribution is aggregated on this surface.',
    };
  });

  await load('communications', 'message_threads, messages', async () => {
    const threads = await readAllPages(() => client.from('message_threads').select('id, created_at'));
    const messages = await readAllPages(() => client.from('messages').select('id, created_at'));
    return {
      available: true,
      metrics: {
        threads: metric(inWindow(threads).length),
        messages: metric(inWindow(messages).length),
      },
      authority: 'Communications remains the authority on conversation state. These are volume counts only.',
    };
  });

  await load('transactions', 'escrow_trust_sessions', async () => {
    const sessions = await readAllPages(() => client
      .from('escrow_trust_sessions')
      .select('id, status, payment_provider_mode, created_at'));
    const windowed = inWindow(sessions);
    const live = windowed.filter((row) => String(row.payment_provider_mode) === 'live');
    const sandbox = windowed.filter((row) => String(row.payment_provider_mode) === 'sandbox');
    return {
      available: true,
      metrics: {
        sessions_opened: metric(windowed.length),
        live_settlements: metric(live.filter((r) => String(r.status) === 'settled').length),
        sandbox_settlements: metric(sandbox.filter((r) => String(r.status) === 'settled').length),
      },
      note: live.length === 0
        ? 'No session used a live payment provider, so no settlement here represents money that moved.'
        : null,
    };
  });

  await load('risk', 'insurance_claims', async () => {
    const claims = await readAllPages(() => client
      .from('insurance_claims').select('id, created_at'));
    return {
      available: true,
      metrics: { claims_recorded: metric(inWindow(claims).length) },
      // Counts only. A verdict belongs to the governed risk domain.
      boundary: 'Volume only. Fraud and underwriting adjudication are a separate governed domain and no risk verdict is issued here.',
    };
  });

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
