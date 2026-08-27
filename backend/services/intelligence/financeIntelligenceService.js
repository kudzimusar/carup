/**
 * CarUp Intelligence 1.0 — I11 finance COMMERCIAL demand intelligence.
 *
 * Strictly the commercial side, mirroring I10: eligibility (prequalification)
 * activity and application volume where CarUp has actually observed it. Credit
 * risk, underwriting and collateral are a separate governed domain and are
 * deliberately absent — combining them is how a demand figure starts being read
 * as a credit signal.
 *
 * The position established from the live schema:
 *
 *   - eligibility requests for `capability = 'finance'` exist, but every one is
 *     `mode = 'sandbox'` against a simulated provider;
 *   - `lender_profiles` is empty — no lender is onboarded;
 *   - `finance_provider_decisions` is empty — no lender decision has ever been
 *     recorded, and no application carries a `decision_recorded_at`;
 *   - there is NO disbursement state anywhere in the schema.
 *
 * So approvals, offers and disbursements are unobserved, and this module refuses
 * to derive them. In particular a `requested_amount` is what a borrower ASKED
 * for on a pending application — treating it as lent money is the single easiest
 * way to manufacture a loan book, and it is explicitly not done here.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  rate,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';

export const FINANCE_INTELLIGENCE_VERSION = 'finance_demand@1';

const LENDER_ROLES = new Set(['bank', 'finance', 'admin', 'platform_admin', 'super_admin']);

/** Statuses that represent a recorded lender OUTCOME rather than a request. */
const DECIDED_STATUSES = new Set(['approved', 'declined', 'rejected', 'disbursed']);

export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'approvals',
    label: 'Approvals',
    reason: 'no_lender_decision_recorded',
    detail: 'No finance provider decision has ever been recorded and no application carries a decision timestamp, so an approval count would be inferred from a status nobody authoritative set.',
  },
  {
    key: 'offers',
    label: 'Offers',
    reason: 'no_lender_decision_recorded',
    detail: 'An offer is only observable once a lender makes one, and no lender is onboarded to make one.',
  },
  {
    key: 'disbursements',
    label: 'Disbursements',
    reason: 'no_disbursement_state',
    detail: 'CarUp records no disbursement anywhere. A requested amount is what a borrower asked for on a pending application, and treating it as money lent would manufacture a loan book.',
  },
  {
    key: 'portfolio_value',
    label: 'Portfolio value',
    reason: 'no_disbursement_state',
    detail: 'Without disbursements there is no portfolio. Summing requested amounts would report applications as assets.',
  },
  {
    key: 'portfolio_apr',
    label: 'Average portfolio APR',
    reason: 'no_disbursed_book',
    detail: 'An APR on a pending application is a quoted rate, not a rate anyone is paying; averaging quotes would describe a book that does not exist.',
  },
  {
    key: 'default_risk',
    label: 'Default and delinquency',
    reason: 'no_repayment_state',
    detail: 'CarUp records no repayment, arrears or default state, so no delinquency figure can be derived.',
  },
  {
    key: 'collateral_binding',
    label: 'Collateral tracking',
    reason: 'no_finance_collateral_binding',
    detail: 'Vehicle telemetry carries no finance, loan or collateral reference, so a telemetry record cannot be attributed to a financed asset.',
  },
  {
    key: 'source_attribution',
    label: 'Source and channel attribution',
    reason: 'attribution_stream_not_certified',
    detail: 'Attribution is not yet certified for finance demand, so crediting an application to a channel would overstate what CarUp knows.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function requireLenderScope(actor) {
  const role = String(actor?.platformRole || actor?.role || '');
  if (!LENDER_ROLES.has(role)) {
    throw new AuthorizationError('A lender role is required for finance intelligence.');
  }
  return role;
}

/**
 * The scope key, derived server-side and deliberately identical to the one the
 * authoritative application queue already uses.
 *
 * `GET /api/finance/applications` narrows a `bank` actor by `bank_id = actor.id`
 * and lets the platform lending-ops roles see everything. Scoping this projection
 * any differently would put a count next to that queue that disagrees with it —
 * on staging every finance row has a null `tenant_id` and a populated `bank_id`,
 * so a tenant-keyed filter would have reported zero applications directly above a
 * queue listing the lender's own.
 */
export function resolveFinanceScope(actor) {
  const role = requireLenderScope(actor);
  if (role !== 'bank') return { role, platformScope: true, bankId: null, tenantId: null };

  const bankId = actor?.id ? String(actor.id) : null;
  if (!bankId) {
    throw new AuthorizationError('A verified lender identity is required for finance intelligence.');
  }
  return {
    role,
    platformScope: false,
    bankId,
    tenantId: actor?.tenantId ? String(actor.tenantId) : null,
  };
}

export function splitByMode(requests) {
  const live = requests.filter((row) => String(row.mode) === 'live');
  return { live, sandbox: requests.filter((row) => String(row.mode) !== 'live') };
}

/**
 * An application counts as DECIDED only when an authoritative decision was
 * recorded — a `decision_recorded_at` stamp or a decision source. A bare status
 * string is not a lender outcome: nothing in CarUp sets it on a lender's behalf.
 */
export function isAuthoritativelyDecided(application) {
  if (application?.decision_recorded_at) return true;
  if (application?.decision_source) return true;
  return false;
}

export async function getFinanceDemandIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const scope = resolveFinanceScope(actor);
  const { platformScope, bankId, tenantId } = scope;

  const { start, end } = windowBounds(windowDays);

  let requests;
  let applications;
  let lenders;
  try {
    // A lender's own provider registration, which is what decides whether their
    // applications can reach a decision at all. Never the platform roster: how
    // many lenders exist is a competitor's business, not this lender's.
    lenders = await readAllPages(() => {
      let query = client
        .from('lender_profiles')
        .select('id, provider_id, active, contract_status, tenant_id');
      // A caller with no verified tenant matches an impossible sentinel rather
      // than dropping the filter, so an absent tenant can never widen the read to
      // the whole roster.
      if (!platformScope) query = query.eq('tenant_id', tenantId ?? '__no_tenant__');
      return query;
    });

    // Eligibility traffic belongs to the provider it was routed to. A lender with
    // no registered provider has no live traffic — which `provider_state` explains
    // rather than leaving as a bare zero.
    const providerIds = lenders.map((row) => row.provider_id).filter(Boolean);
    requests = (!platformScope && providerIds.length === 0)
      ? []
      : await readAllPages(() => {
        let query = client
          .from('eligibility_requests')
          .select('id, capability, mode, status, provider_id, tenant_id, created_at')
          .eq('capability', 'finance');
        if (!platformScope) query = query.in('provider_id', providerIds);
        return query;
      });

    applications = await readAllPages(() => {
      let query = client
        .from('finance_applications')
        .select('id, vin, status, requested_amount, apr, created_at, bank_id, tenant_id, decision_source, decision_recorded_at');
      // The same key the authoritative queue uses, so the two never disagree.
      if (!platformScope) query = query.eq('bank_id', bankId);
      return query;
    });
  } catch (error) {
    return {
      window_days: windowDays,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'finance_read_failed'),
      calculation_version: FINANCE_INTELLIGENCE_VERSION,
      message: 'Finance demand could not be read. These figures are NOT zero.',
      not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
    };
  }

  const inWindow = (rows) => rows.filter((row) => row.created_at && row.created_at >= start && row.created_at < end);
  const { live, sandbox } = splitByMode(inWindow(requests));
  const windowApplications = inWindow(applications);
  const decided = windowApplications.filter(isAuthoritativelyDecided);
  const activeLenders = lenders.filter((row) => row.active === true).length;

  // An application nobody can attribute to a lender is invisible to every lender
  // view, so a count of zero could mean "no demand" or "demand nobody can see".
  // A platform reader is told how many; a lender is told only that the gap
  // exists, since the size of it is a platform figure.
  const unattributed = platformScope
    ? windowApplications.filter((row) => !row.bank_id).length
    : null;

  return {
    scope: 'finance_commercial',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: FINANCE_INTELLIGENCE_VERSION,

    provider_state: {
      // Platform scope counts the roster; a lender counts only its own
      // registrations, so this never discloses how many lenders exist.
      active_lenders: metric(activeLenders),
      live_market: activeLenders > 0,
      note: activeLenders > 0
        ? null
        : platformScope
          ? 'No lender is onboarded, so no application can reach a live provider and no decision or disbursement can be recorded through CarUp.'
          : 'No active lender registration is on file for you, so your applications cannot reach a live provider and no decision or disbursement can be recorded through CarUp.',
    },

    /**
     * What this view cannot see, stated rather than absorbed into the counts.
     */
    attribution: {
      basis: platformScope ? 'platform' : 'bank_id',
      unattributed_applications: platformScope ? metric(unattributed) : null,
      note: platformScope
        ? 'Applications with no lender attached are counted here but appear in no lender view.'
        : 'You see applications routed to you. CarUp also holds applications that are attached to no lender, and those appear in no lender view — so this count is not a measure of total market demand.',
    },

    /** Applications CarUp genuinely holds. Volume only — never treated as a book. */
    application_demand: {
      applications_received: metric(windowApplications.length),
      // Only decisions somebody authoritative recorded.
      decisions_recorded: metric(decided.length),
      awaiting_decision: metric(windowApplications.length - decided.length),
      decision_rate: rate(decided.length, windowApplications.length, { min: 10 }),
    },

    /** Live prequalification demand. */
    live_eligibility: {
      requests: metric(live.length),
      eligible: metric(live.filter((r) => String(r.status) === 'eligible').length),
      not_eligible: metric(live.filter((r) => String(r.status) === 'not_eligible').length),
    },

    /** Simulated activity, never added to live demand. */
    sandbox_activity: {
      requests: metric(sandbox.length),
      note: 'Simulated prequalification against a sandbox provider. These are not market demand and are never combined with live figures.',
    },

    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),

    domain_boundary: 'Commercial demand only. Credit risk, underwriting and collateral are a separate governed domain and are not represented here.',
  };
}
