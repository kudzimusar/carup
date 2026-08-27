/**
 * CarUp Intelligence 1.0 — I10 insurance COMMERCIAL demand intelligence.
 *
 * Strictly the commercial side: product exposure, quote/eligibility starts, and
 * conversion where CarUp has actually observed it. Risk, underwriting, claims and
 * fraud are a separate governed domain and are deliberately absent from this
 * module — combining them is how a demand figure starts being read as an
 * underwriting signal.
 *
 * The honest position today, established from the live schema:
 *
 *   - eligibility requests for `capability = 'insurance'` ARE recorded, but every
 *     one is `mode = 'sandbox'` against a simulated provider;
 *   - no insurer is onboarded (`insurer_profiles` is empty);
 *   - no provider decision has ever been recorded;
 *   - no consent record exists.
 *
 * So sandbox activity is reported SEPARATELY from live activity and never summed
 * into it. A simulated request is a real record of a simulation, not a real record
 * of demand, and presenting the two as one number would be the fabrication this
 * phase exists to remove.
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

export const INSURANCE_INTELLIGENCE_VERSION = 'insurance_demand@1';

const INSURER_ROLES = new Set(['insurance', 'admin', 'platform_admin', 'super_admin']);

/**
 * Commercial capabilities the plan names that CarUp cannot yet observe, each with
 * the reason. Quote submissions, offers, bound policies and renewals all depend on
 * a provider decision, and none has ever been recorded.
 */
export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'product_views',
    label: 'Insurance product views',
    reason: 'no_insurance_surface_instrumentation',
    detail: 'CarUp does not yet record a view of an insurance product; the activity ledger reserves the insurance vocabulary but nothing emits it.',
  },
  {
    key: 'quote_submissions',
    label: 'Quote submissions',
    reason: 'no_provider_decision_recorded',
    detail: 'A submission is only observable once a provider receives it, and no insurer is onboarded to receive one.',
  },
  {
    key: 'offers',
    label: 'Offers',
    reason: 'no_provider_decision_recorded',
    detail: 'No insurance provider decision has ever been recorded.',
  },
  {
    key: 'policies_bound',
    label: 'Policies bound',
    reason: 'no_provider_decision_recorded',
    detail: 'CarUp holds policy records but no evidence of a policy being bound through CarUp, so a conversion count would be inferred rather than observed.',
  },
  {
    key: 'renewals',
    label: 'Renewals',
    reason: 'no_renewal_events',
    detail: 'No renewal event is recorded against an insurance record.',
  },
  {
    key: 'source_attribution',
    label: 'Source and channel attribution',
    reason: 'attribution_stream_not_certified',
    detail: 'Attribution is not yet certified for insurance demand, so crediting a request to a channel would overstate what CarUp knows.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function requireInsurerScope(actor) {
  const role = String(actor?.platformRole || actor?.role || '');
  if (!INSURER_ROLES.has(role)) {
    throw new AuthorizationError('An insurer role is required for insurance intelligence.');
  }
  return role;
}

/**
 * Split observed eligibility activity by MODE.
 *
 * `sandbox` and `live` are never added together. A sandbox request is a genuine
 * record of a simulation; counting it as demand would misrepresent an empty market
 * as an active one.
 */
export function splitByMode(requests) {
  const live = requests.filter((row) => String(row.mode) === 'live');
  const sandbox = requests.filter((row) => String(row.mode) !== 'live');
  return { live, sandbox };
}

const ELIGIBLE_STATUSES = new Set(['eligible', 'approved', 'conditionally_eligible']);

function summarizeRequests(requests) {
  const eligible = requests.filter((row) => ELIGIBLE_STATUSES.has(String(row.status)));
  return {
    requests: requests.length,
    eligible: eligible.length,
    not_eligible: requests.filter((row) => String(row.status) === 'not_eligible').length,
    pending: requests.filter((row) => !ELIGIBLE_STATUSES.has(String(row.status)) && String(row.status) !== 'not_eligible').length,
  };
}

/**
 * Commercial insurance demand for an insurer audience.
 *
 * Tenant scope: an insurer sees the requests routed to their own tenant. A
 * platform admin with no tenant sees the platform view; an insurer without a
 * verified tenant is refused rather than shown everyone's demand.
 */
export async function getInsuranceDemandIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const role = requireInsurerScope(actor);
  const isPlatformAdmin = ['admin', 'platform_admin', 'super_admin'].includes(role);
  const tenantId = actor?.tenantId ? String(actor.tenantId) : null;
  if (!isPlatformAdmin && !tenantId) {
    throw new AuthorizationError('A verified insurer context is required for insurance intelligence.');
  }

  const { start, end } = windowBounds(windowDays);

  let requests;
  let insurers;
  try {
    requests = await readAllPages(() => {
      let query = client
        .from('eligibility_requests')
        .select('id, capability, mode, status, provider_id, tenant_id, created_at')
        .eq('capability', 'insurance');
      // Scope follows verified membership; there is no tenant parameter.
      if (!isPlatformAdmin) query = query.eq('tenant_id', tenantId);
      return query;
    });
    insurers = await readAllPages(() => client
      .from('insurer_profiles')
      .select('id, active, contract_status'));
  } catch (error) {
    return {
      window_days: windowDays,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'insurance_read_failed'),
      calculation_version: INSURANCE_INTELLIGENCE_VERSION,
      message: 'Insurance demand could not be read. These figures are NOT zero.',
      not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
    };
  }

  const inWindow = requests.filter((row) => row.created_at && row.created_at >= start && row.created_at < end);
  const { live, sandbox } = splitByMode(inWindow);
  const liveSummary = summarizeRequests(live);
  const sandboxSummary = summarizeRequests(sandbox);
  const activeInsurers = insurers.filter((row) => row.active === true).length;

  return {
    scope: 'insurance_commercial',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: INSURANCE_INTELLIGENCE_VERSION,

    /**
     * Whether CarUp has a live insurance market at all. A surface reads this
     * before it reads any number, so an empty market is described rather than
     * rendered as poor performance.
     */
    provider_state: {
      active_insurers: metric(activeInsurers),
      live_market: activeInsurers > 0,
      note: activeInsurers > 0
        ? null
        : 'No insurer is onboarded, so no request can reach a live provider and no policy can be bound through CarUp.',
    },

    /** Live demand — the only figures that describe a real market. */
    live_demand: {
      eligibility_requests: metric(liveSummary.requests),
      eligible: metric(liveSummary.eligible),
      not_eligible: metric(liveSummary.not_eligible),
      pending: metric(liveSummary.pending),
      eligibility_rate: rate(liveSummary.eligible, liveSummary.requests, { min: 10 }),
    },

    /**
     * Sandbox activity, reported separately and never added to live demand: it is
     * a real record of a simulation, not a real record of demand.
     */
    sandbox_activity: {
      eligibility_requests: metric(sandboxSummary.requests),
      eligible: metric(sandboxSummary.eligible),
      not_eligible: metric(sandboxSummary.not_eligible),
      note: 'Simulated requests against a sandbox provider. These are not market demand and are never combined with live figures.',
    },

    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),

    /**
     * Stated on the projection itself so no consumer can quietly reuse a demand
     * figure as a risk signal.
     */
    domain_boundary: 'Commercial demand only. Risk, underwriting, claims and fraud are a separate governed domain and are not represented here.',
  };
}
