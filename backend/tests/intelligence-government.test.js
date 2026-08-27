/**
 * CarUp Intelligence 1.0 — I15 government / regulatory intelligence.
 *
 * The plan's constraint for this phase is one sentence: no government "verified"
 * status may be invented. Everything here defends that line.
 *
 * The distinction the projection exists to hold is between what CarUp ASSESSED
 * (its own review of documents a user supplied) and what a registry CONFIRMED
 * (an authoritative government source saying so). The first exists; the second
 * does not exist anywhere in CarUp — no provider is registered and every check on
 * record ran against a sandbox simulator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  getGovernmentProvenanceIntelligence,
  requireInstitutionalScope,
  institutionalContractState,
  carupAssessedProvenance,
  registryCheckActivity,
  NOT_MEASURABLE,
  GOVERNMENT_INTELLIGENCE_VERSION,
} from '../services/intelligence/governmentIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DASHBOARD = codeOnly(read('web/src/pages/dashboard/government/GovernmentDashboard.tsx'));
const REPORTS = codeOnly(read('web/src/pages/dashboard/government/ComplianceReports.tsx'));

const GOV = { id: 'g1', role: 'government' };
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const provider = (o = {}) => ({
  id: o.id || 'p1', provider_key: o.provider_key || 'zimra', capability_type: 'registry',
  jurisdiction: o.jurisdiction || 'ZW',
  activation_mode: o.activation_mode || 'sandbox',
  contract_status: o.contract_status || 'draft',
  kill_switch_enabled: o.kill_switch_enabled ?? false,
  health_state: o.health_state || 'unknown',
});

const evid = (o = {}) => ({ id: o.id || 'e1', verification_status: o.verification_status || 'verified', created_at: o.created_at || today });
const dec = (o = {}) => ({ id: o.id || 'd1', decision: o.decision || 'request_resubmission', created_at: o.created_at || today });
const svr = (o = {}) => ({ id: o.id || 's1', provider: o.provider || 'zimra', mode: o.mode || 'sandbox', result: o.result || 'match', created_at: o.created_at || today });
const aud = (o = {}) => ({ id: o.id || 'x1', created_at: o.created_at || today });

function createClient({ providers = [], evidence = [], decisions = [], registry = [], trust = [], org = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const api = {
      select() { return api },
      eq() { return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        return Promise.resolve({ data: from === 0 ? rows : [], error: null });
      },
    };
    return api;
  };
  return {
    from: (t) => build(t, {
      provider_registry: providers,
      vehicle_evidence: evidence,
      verification_decisions: decisions,
      source_verification_results: registry,
      trust_audit_events: trust,
      organization_audit_logs: org,
    }[t] ?? []),
  };
}

// ── No government verification may be invented ─────────────────────────────

test('CarUp assessment fields are named as CarUp\'s own, never as verification', () => {
  const assessment = carupAssessedProvenance([evid()], [dec()]);
  const keys = Object.keys(assessment).join(' ');
  // A field called `verified_vehicles` would make the same row a government claim.
  for (const forbidden of ['government', 'registry_verified', 'verified_vehicles', 'official']) {
    assert.ok(!keys.includes(forbidden), `no assessment field may be named "${forbidden}"`);
  }
  assert.ok(keys.includes('carup_assessed_evidence'));
  assert.ok(/not a government determination/i.test(assessment.basis));
});

test('a sandbox registry check is never counted as a confirmation', () => {
  const activity = registryCheckActivity([
    svr({ id: '1', mode: 'sandbox', result: 'match' }),
    svr({ id: '2', mode: 'sandbox', result: 'match' }),
    svr({ id: '3', mode: 'sandbox', result: 'match' }),
  ]);
  assert.equal(activity.sandbox_simulations.value, 3);
  assert.equal(activity.live_confirmations.value, 0);
  assert.equal(activity.any_live_confirmation, false);
  assert.ok(/confirms nothing about a real vehicle/i.test(activity.note));
  // No combined total exists for the two to be added into.
  assert.equal(activity.total_checks, undefined);
  assert.equal(activity.confirmations, undefined);
});

test('a live registry confirmation is counted separately when one exists', () => {
  const activity = registryCheckActivity([
    svr({ id: '1', mode: 'live' }),
    svr({ id: '2', mode: 'sandbox' }),
  ]);
  assert.equal(activity.live_confirmations.value, 1);
  assert.equal(activity.sandbox_simulations.value, 1);
  assert.equal(activity.note, null);
});

test('national registry figures and officer audits are refused with reasons', () => {
  const byKey = Object.fromEntries(NOT_MEASURABLE.map((e) => [e.key, e]));
  for (const key of ['registry_confirmation', 'national_registrations', 'national_backlog', 'officer_session_audit', 'duty_assessment']) {
    assert.ok(byKey[key], `${key} must be declared unmeasurable`);
    assert.ok(byKey[key].reason && byKey[key].detail);
  }
  assert.equal(byKey.national_registrations.reason, 'not_a_national_registry');
  assert.equal(byKey.officer_session_audit.reason, 'no_officer_directory');
  assert.ok(/not an assessment/i.test(byKey.duty_assessment.detail));
});

// ── The institutional contract must be real to count ───────────────────────

test('an empty provider registry means no authoritative source at all', () => {
  const contract = institutionalContractState([]);
  assert.equal(contract.registered_providers.value, 0);
  assert.equal(contract.contract_established, false);
  assert.ok(/no authoritative institutional source/i.test(contract.note));
});

test('a registered but sandbox provider is not an established contract', () => {
  const contract = institutionalContractState([provider({ activation_mode: 'sandbox', contract_status: 'signed' })]);
  assert.equal(contract.registered_providers.value, 1);
  assert.equal(contract.live_providers.value, 0);
  assert.equal(contract.contract_established, false);
  assert.ok(/none is live under a signed contract/i.test(contract.note));
});

test('a killed provider is not live even when signed and in live mode', () => {
  const contract = institutionalContractState([
    provider({ activation_mode: 'live', contract_status: 'signed', kill_switch_enabled: true }),
  ]);
  assert.equal(contract.contract_established, false);
});

test('a live signed provider establishes the contract', () => {
  const contract = institutionalContractState([
    provider({ activation_mode: 'live', contract_status: 'signed', jurisdiction: 'ZW' }),
  ]);
  assert.equal(contract.contract_established, true);
  assert.deepEqual(contract.jurisdictions, ['ZW']);
  assert.equal(contract.note, null);
});

// ── An institutional role is not a super-admin ─────────────────────────────

test('the projection carries no commercial marketplace behaviour', async () => {
  const client = createClient({ evidence: [evid()], decisions: [dec()] });
  const result = await getGovernmentProvenanceIntelligence(client, GOV);
  assert.equal(result.commercial_behaviour_access, false);
  const keys = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['"listings"', '"inquiries"', '"sellers"', '"views"', '"price"', '"revenue"']) {
    assert.ok(!keys.includes(forbidden), `gap G5: no commercial field may appear (${forbidden})`);
  }
  assert.equal(result.calculation_version, GOVERNMENT_INTELLIGENCE_VERSION);
});

test('a non-institutional role is refused', () => {
  assert.throws(() => requireInstitutionalScope({ role: 'owner' }), AuthorizationError);
  assert.throws(() => requireInstitutionalScope({ role: 'dealer' }), AuthorizationError);
  assert.throws(() => requireInstitutionalScope({}), AuthorizationError);
});

test('audit entries are served as counts, never as entries', async () => {
  const client = createClient({ trust: [aud({ id: '1' }), aud({ id: '2' })], org: [aud({ id: '3' })] });
  const result = await getGovernmentProvenanceIntelligence(client, GOV);
  assert.equal(result.audit_posture.trust_audit_entries.value, 2);
  assert.equal(result.audit_posture.organization_audit_entries.value, 1);
  assert.ok(/counts only/i.test(result.audit_posture.basis));
  assert.equal(result.audit_posture.entries, undefined);
});

test('a failed read reports unavailable and publishes no counts', async () => {
  const result = await getGovernmentProvenanceIntelligence(createClient({ failTable: 'vehicle_evidence' }), ADMIN);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.carup_assessment, undefined);
  assert.equal(result.commercial_behaviour_access, false);
  assert.ok(/NOT zero/i.test(result.message));
});

// ── The government surfaces no longer assert what CarUp cannot know ────────

test('GovernmentDashboard publishes no national registry figures', () => {
  for (const literal of ["'1.2M'", "'234'", "'89'", "'3 Active'", 'registrationData', 'BarChart', 'recharts']) {
    assert.ok(!DASHBOARD.includes(literal), `GovernmentDashboard must not contain ${literal}`);
  }
});

test('GovernmentDashboard invents no officers, sessions or IP addresses', () => {
  assert.ok(!/mfaLogs|Chihuri|Moyo|10\.20\.\d+\.\d+/.test(DASHBOARD),
    'an invented officer authentication log must not be presented as a regulatory audit');
  assert.ok(!/Hardware FIDO|MFA Handshake/.test(DASHBOARD));
});

test('GovernmentDashboard asserts no unverified access-control guarantee', () => {
  assert.ok(!/fully enforced/i.test(DASHBOARD), 'an RBAC claim with no check behind it must not be published');
  assert.ok(!/CBZ/i.test(DASHBOARD));
});

test('the duty estimate is seeded with nothing and labelled as an estimate', () => {
  // The seed was also masking a real defect: VAT arrives under `breakdown.vat`,
  // so the first genuine calculation left the top-level field undefined.
  assert.ok(!/totalDuty:\s*10125|percentageOfValue:\s*101\.25|vat:\s*1500|surtax:\s*3500/.test(DASHBOARD));
  assert.ok(DASHBOARD.includes('useState<DutyEstimate | null>(null)'));
  assert.ok(DASHBOARD.includes('dutyResult.breakdown?.vat'), 'VAT must be read from the breakdown');
  assert.ok(DASHBOARD.includes('duty-estimate-basis'));
  assert.ok(DASHBOARD.includes('duty-estimate-idle'), 'nothing is shown before a calculation runs');
});

test('ComplianceReports no longer confirms a download that never happened', () => {
  assert.ok(!/downloaded successfully/i.test(REPORTS),
    'the handler resolved a timer and claimed a regulatory report had downloaded');
  assert.ok(!/setTimeout\(resolve, 2000\)/.test(REPORTS));
  assert.ok(REPORTS.includes('report.url'), 'a report is only offered when it has a file');
});

test('ComplianceReports distinguishes a failed read from an empty list', () => {
  assert.ok(REPORTS.includes('compliance-reports-failed'));
  assert.ok(REPORTS.includes('compliance-reports-empty'));
  assert.ok(REPORTS.includes('setLoadFailed(true)'));
});

test('ComplianceReports no longer labels a generation share as a compliance rate', () => {
  assert.ok(!/Compliance Rate/.test(REPORTS),
    'the share of generated reports says nothing about whether anybody is compliant');
  assert.ok(REPORTS.includes('Generated share'));
});

test('the institutional route is gated and takes no caller scope', () => {
  const routes = codeOnly(read('backend/routes/intelligenceProjectionRoutes.js'));
  const block = routes.split("'/api/government/provenance-intelligence'")[1].split('router.get')[0];
  assert.match(block, /authorizeRole\(\['government', 'admin'\]\)/);
  assert.ok(block.includes('req.userContext'));
});
