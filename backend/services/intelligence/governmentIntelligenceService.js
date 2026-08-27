/**
 * CarUp Intelligence 1.0 — I15 government / regulatory intelligence.
 *
 * The plan's constraint for this phase is a single sentence: **no government
 * "verified" status may be invented**. Everything below follows from taking that
 * seriously against what the live schema actually holds.
 *
 *   - `provider_registry` is EMPTY. No CVR, ZIMRA, ZINARA, CID or VID integration
 *     is registered, so there is no authoritative institutional source at all;
 *   - every registry check CarUp holds is `zimra` in `sandbox` mode. Not one live
 *     registry confirmation exists;
 *   - `registry_verifications` holds two rows with a `checked_by` — these are
 *     CarUp staff notes, not registry responses;
 *   - `vehicle_evidence` and `verification_decisions` are real, but they record
 *     CarUp's OWN review of documents a user supplied.
 *
 * So the central distinction this module exists to hold is between:
 *
 *   CARUP ASSESSED  — CarUp reviewed the evidence it was given, and
 *   REGISTRY CONFIRMED — an authoritative government source said so.
 *
 * The first is available. The second does not exist anywhere in CarUp today. The
 * projection therefore reports the first under names that cannot be mistaken for
 * the second, and reports the second as unavailable with the reason — rather than
 * letting a reviewed document quietly become a government verification.
 *
 * An institutional role is also NOT a super-admin: this projection carries no
 * commercial marketplace behaviour, which is the G5 boundary.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';

export const GOVERNMENT_INTELLIGENCE_VERSION = 'government_provenance@1';

const INSTITUTIONAL_ROLES = new Set(['government', 'admin', 'platform_admin', 'super_admin']);

/** A provider row that is actually usable as an authoritative source. */
const LIVE_ACTIVATION_MODES = new Set(['live', 'production']);

export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'registry_confirmation',
    label: 'Registry-confirmed status',
    reason: 'no_live_registry_integration',
    detail: 'No registry provider is registered and every check CarUp holds ran against a sandbox simulator. Nothing in CarUp has been confirmed by an authoritative government source, so no record may be shown as government-verified.',
  },
  {
    key: 'national_registrations',
    label: 'National registration volumes',
    reason: 'not_a_national_registry',
    detail: 'CarUp is not a national vehicle registry and holds no national registration data. Any count of registered vehicles in the country would be invented.',
  },
  {
    key: 'national_backlog',
    label: 'National verification backlog',
    reason: 'not_a_national_registry',
    detail: 'CarUp can only report its own review queue. A national pending-verification figure describes a system CarUp does not operate.',
  },
  {
    key: 'officer_session_audit',
    label: 'Officer session and MFA audit',
    reason: 'no_officer_directory',
    detail: 'CarUp holds no government officer directory and issues no officer credentials, so it cannot report who authenticated, from where, or when.',
  },
  {
    key: 'enforcement_outcomes',
    label: 'Enforcement outcomes',
    reason: 'no_enforcement_record',
    detail: 'CarUp records no prosecution, penalty or enforcement action, so no regulatory outcome can be reported.',
  },
  {
    key: 'duty_assessment',
    label: 'Official duty assessment',
    reason: 'no_revenue_authority_integration',
    detail: 'CarUp computes a duty estimate from published rates. It is not connected to any revenue authority and its figure is not an assessment, a ruling, or a liability anybody owes.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function requireInstitutionalScope(actor) {
  const role = String(actor?.platformRole || actor?.role || '');
  if (!INSTITUTIONAL_ROLES.has(role)) {
    throw new AuthorizationError('An institutional role is required.');
  }
  return role;
}

/**
 * Whether an authoritative institutional integration exists at all.
 *
 * A provider row only counts when it is BOTH active and in a live activation mode.
 * A registered-but-sandbox provider is a rehearsal, not a source of truth.
 */
export function institutionalContractState(providers) {
  const live = providers.filter((row) => (
    LIVE_ACTIVATION_MODES.has(String(row.activation_mode))
    && String(row.contract_status || '').toLowerCase() === 'signed'
    && row.kill_switch_enabled !== true
  ));
  const registered = providers.length;
  return {
    registered_providers: metric(registered),
    live_providers: metric(live.length),
    contract_established: live.length > 0,
    jurisdictions: [...new Set(live.map((row) => row.jurisdiction).filter(Boolean))],
    note: live.length > 0
      ? null
      : registered === 0
        ? 'No registry or revenue-authority provider is registered with CarUp. There is no authoritative institutional source, so nothing here can carry a government status.'
        : 'Providers are registered but none is live under a signed contract, so no authoritative confirmation is available.',
  };
}

/**
 * CarUp's OWN review of supplied evidence.
 *
 * Every field is named for what it is. `carup_assessed_*` can never be read as a
 * government determination, which is the whole point: the same underlying row
 * would be a very different claim under a name like `verified_vehicles`.
 */
export function carupAssessedProvenance(evidence, decisions) {
  const byDecision = {};
  for (const row of decisions) {
    const key = String(row.decision || 'unknown');
    byDecision[key] = (byDecision[key] || 0) + 1;
  }
  return {
    carup_assessed_evidence: metric(evidence.length),
    carup_assessed_complete: metric(evidence.filter((row) => String(row.verification_status) === 'verified').length),
    carup_awaiting_review: metric(evidence.filter((row) => String(row.verification_status) === 'pending').length),
    carup_review_decisions: metric(decisions.length),
    decisions_by_type: byDecision,
    basis: 'CarUp reviewed documents supplied by a user. No authoritative registry was consulted, and this is not a government determination.',
  };
}

/**
 * Registry checks, split by mode and never combined.
 *
 * A sandbox "match" is a simulator agreeing with itself. Presenting it beside a
 * live confirmation, or summing the two, would turn a rehearsal into evidence.
 */
export function registryCheckActivity(results) {
  const live = results.filter((row) => String(row.mode) === 'live');
  const sandbox = results.filter((row) => String(row.mode) !== 'live');
  const byProvider = {};
  for (const row of sandbox) {
    const key = String(row.provider || 'unknown');
    byProvider[key] = (byProvider[key] || 0) + 1;
  }
  return {
    live_confirmations: metric(live.length),
    sandbox_simulations: metric(sandbox.length),
    sandbox_by_provider: byProvider,
    any_live_confirmation: live.length > 0,
    note: live.length === 0
      ? 'Every registry check CarUp holds ran against a sandbox simulator. A sandbox match confirms nothing about a real vehicle and is never counted as a registry confirmation.'
      : null,
  };
}

/**
 * The audit position, as counts only.
 *
 * An institutional reader is told that an audit trail exists and how much of it
 * there is. The entries themselves are identity-bearing and are not served here.
 */
export function auditPosture(trustEvents, orgEvents) {
  return {
    trust_audit_entries: metric(trustEvents.length),
    organization_audit_entries: metric(orgEvents.length),
    basis: 'Counts only. Audit entries identify people and are not exposed to an institutional projection.',
  };
}

export async function getGovernmentProvenanceIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  requireInstitutionalScope(actor);
  const { start, end } = windowBounds(windowDays);

  let providers;
  let evidence;
  let decisions;
  let registryResults;
  let trustAudit;
  let orgAudit;
  try {
    providers = await readAllPages(() => client
      .from('provider_registry')
      .select('id, provider_key, capability_type, jurisdiction, activation_mode, contract_status, kill_switch_enabled, health_state'));
    evidence = await readAllPages(() => client
      .from('vehicle_evidence')
      .select('id, verification_status, created_at'));
    decisions = await readAllPages(() => client
      .from('verification_decisions')
      .select('id, decision, created_at'));
    registryResults = await readAllPages(() => client
      .from('source_verification_results')
      .select('id, provider, mode, result, created_at'));
    trustAudit = await readAllPages(() => client
      .from('trust_audit_events')
      .select('id, created_at'));
    orgAudit = await readAllPages(() => client
      .from('organization_audit_logs')
      .select('id, created_at'));
  } catch (error) {
    return {
      scope: 'institutional',
      window_days: windowDays,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'institutional_read_failed'),
      calculation_version: GOVERNMENT_INTELLIGENCE_VERSION,
      message: 'Institutional intelligence could not be read. These figures are NOT zero.',
      commercial_behaviour_access: false,
      not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
    };
  }

  const inWindow = (rows) => rows.filter((row) => row.created_at && row.created_at >= start && row.created_at < end);

  return {
    scope: 'institutional',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: GOVERNMENT_INTELLIGENCE_VERSION,

    /** The G5 boundary, restated in the payload so it travels with the data. */
    commercial_behaviour_access: false,

    institutional_contract: institutionalContractState(providers),
    carup_assessment: carupAssessedProvenance(inWindow(evidence), inWindow(decisions)),
    registry_checks: registryCheckActivity(inWindow(registryResults)),
    audit_posture: auditPosture(inWindow(trustAudit), inWindow(orgAudit)),

    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),

    domain_boundary: 'CarUp\'s own review of supplied evidence. Nothing here is a government verification, a registry confirmation, or a national statistic, and no commercial marketplace behaviour is included.',
  };
}
