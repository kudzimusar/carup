/**
 * ISSUE #101 — PRODUCTION DATA API SURFACE PROBE (METADATA DISCOVERY ONLY).
 *
 * Probe #1 answered DB AUTHORIZATION. Probe #2 answered DB REACHABILITY and proved
 * anon/authenticated cannot hold a direct session (rolcanlogin = false), but it could
 * NOT read the PostgREST exposed-schema configuration — API_EXPOSURE came back
 * INDETERMINABLE. Dimension B (API_REACHABLE) is therefore still open.
 *
 * This probe closes dimension B the only safe way: by asking the Data API what it
 * ADVERTISES, and nothing else.
 *
 * HARD LIMITS, enforced by construction and by test:
 *   · exactly one HTTP method is ever used — GET. There is no code path that can
 *     issue POST/PATCH/PUT/DELETE/HEAD/OPTIONS;
 *   · exactly one URL shape is ever requested — the PostgREST/OpenAPI root. No
 *     /rpc/* path is ever called, so no RPC is invoked;
 *   · no table resource is ever requested, so no application row can be returned.
 *     There is no fallback that probes individual tables;
 *   · response bodies are PARSED for path identifiers and then discarded. No body,
 *     no fragment of a body, and no row is emitted;
 *   · the API key and the project ref are never printed, logged or interpolated.
 *
 * FAIL-CLOSED: if metadata is unavailable for ANY reason — missing secret, non-2xx,
 * non-JSON, OpenAPI disabled, no paths object — the result is
 * DATA_API_SURFACE = INDETERMINATE and the probe STOPS. It never degrades to a
 * more invasive technique.
 *
 * ADVERTISED != EXPLOITABLE. This probe reports only what the API surface names.
 * Combining that with the DB authorization from probes #1/#2 is a separate,
 * deliberate analysis step.
 */
import { fileURLToPath } from 'url';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const REQUEST_TIMEOUT_MS = 20000;

/** The ONLY HTTP method this probe may use. */
export const ALLOWED_HTTP_METHOD = 'GET';

/**
 * CREDENTIAL MODEL — metadata-only ELEVATED key.
 *
 * On the current Supabase platform the /rest/v1/ OpenAPI root requires an elevated
 * secret/service-role key; publishable/anon access to the OpenAPI document has been
 * removed. The secret is therefore named PRODUCTION_DATA_API_METADATA_KEY to make
 * its class unambiguous, and it is used for ONE read of the OpenAPI root and nothing
 * else. It is never used to read a table, invoke an RPC, or fetch a row.
 *
 * TRANSPORT: the key is sent ONLY as the `apikey` header. It is NOT placed in an
 * `Authorization: Bearer` header, because modern sb_secret_* keys are not JWTs and
 * bearer-framing them is both wrong and a needless second place for a secret to land.
 *
 * PRE-FLIGHT REFUSAL: an obviously publishable-class credential is refused BEFORE any
 * request is made. A legacy JWT cannot be distinguished by prefix, so if one is
 * supplied and the endpoint rejects it the result is INDETERMINATE — never a fallback.
 */
export const METADATA_KEY_ENV = 'PRODUCTION_DATA_API_METADATA_KEY';

/** Credential classes accepted for metadata reads. Detected internally, never printed. */
export function classifyMetadataKey(key) {
  if (typeof key !== 'string' || key.length < 20) return 'MISSING_OR_TOO_SHORT';
  if (key.startsWith('sb_publishable_')) return 'PUBLISHABLE_REFUSED';
  if (key.startsWith('sb_secret_')) return 'SECRET_KEY';
  if (key.startsWith('eyJ')) return 'LEGACY_JWT';
  return 'UNRECOGNISED';
}

/** The 14 RLS-disabled production tables (probe #1, run 31749657530). */
export const RLS_OFF_TABLES = [
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
];

/** The three owner-rights views (probe #2 confirmed only the middle one is updatable). */
export const FOCUS_VIEWS = [
  'communication_inbox_threads',
  'evidence_sources_public',
  'source_verification_coverage_public',
];

/**
 * The reconciled DB-callable NON-TRIGGER functions from run 31759906271.
 * Arithmetic: 34 total = 14 trigger + 20 non-trigger; 19 DB-callable = 12 trigger +
 * 7 non-trigger; 15 not DB-callable. 12 + 7 = 19 and 19 + 15 = 34.
 */
export const DB_CALLABLE_NON_TRIGGER_FUNCTIONS = [
  'current_tenant_id',
  'diaspora_can_access_order',
  'diaspora_trade_os_can_access_row',
  'diaspora_trade_os_current_user_id',
  'diaspora_trade_os_is_platform_admin',
  'diaspora_trade_os_is_tenant_member',
  'is_diaspora_platform_admin',
];

/** The 12 DB-callable TRIGGER functions — reported separately; invoking one errors. */
export const DB_CALLABLE_TRIGGER_FUNCTIONS = [
  'carup_extraction_guard', 'carup_listing_snapshot_block_mutation',
  'carup_provenance_block_mutation', 'carup_report_version_guard',
  'check_blockchain_events_tamper', 'check_financial_ledger_tamper',
  'check_ocr_documents_tamper', 'check_partsentry_logs_tamper',
  'feature_rollout_overrides_touch_updated_at', 'fraud_cases_touch_updated_at',
  'governance_block_mutation', 'prevent_override_mutation',
];

/** The 14 sequences from run 31759906271, all granting anon SELECT,UPDATE,USAGE. */
export const SEQUENCES = [
  'administrative_overrides_id_seq', 'blockchain_events_id_seq', 'notification_queue_id_seq',
  'organization_audit_logs_id_seq', 'partsentry_logs_id_seq', 'performance_telemetry_id_seq',
  'role_switch_logs_id_seq', 'server_health_id_seq', 'signature_verification_logs_id_seq',
  'system_audit_logs_id_seq', 'system_failures_id_seq', 'trust_score_history_id_seq',
  'vehicle_ownership_history_id_seq', 'vehicle_telemetry_id_seq',
];

export const REQUIRED_SECTIONS = [
  'DATA_API_METADATA_AVAILABLE',
  'EXPOSED_TABLE_RESOURCES',
  'RLS_OFF_TABLE_REACHABILITY',
  'FOCUS_VIEW_REACHABILITY',
  'RPC_RESOURCES',
  'NON_TRIGGER_RPC_REACHABILITY',
  'TRIGGER_FUNCTION_RPC_REACHABILITY',
  'SEQUENCE_RESOURCE_REACHABILITY',
  'SEQUENCE_BRIDGE_EVIDENCE',
  'TOTALS',
];

/**
 * EVIDENCE TAXONOMY — three layers, never conflated.
 *
 * The OpenAPI document is read with an ELEVATED key, so it establishes only that an
 * object lives in an exposed Data API schema. It does NOT establish that the object
 * is advertised to anon or to authenticated — those roles see a filtered surface, and
 * deriving role-specific advertisement from an elevated-key document would be wrong.
 *
 *   layer 1 (probe #3, this run) SCHEMA_ADVERTISED
 *   layer 2 (probes #1/#2, frozen) ANON_DB_AUTHORIZED / AUTHENTICATED_DB_AUTHORIZED
 *   layer 3 (probe #2, frozen) role/reachability state
 *
 * A role-specific reachability verdict requires layer 1 AND layer 2 together.
 */
export const CLASSIFICATIONS = [
  'SCHEMA_ADVERTISED',
  'NOT_SCHEMA_ADVERTISED',
  'ANON_DB_AUTHORIZED',
  'AUTHENTICATED_DB_AUTHORIZED',
  'ANON_DATA_API_REACHABLE',
  'AUTHENTICATED_DATA_API_REACHABLE',
  'INDETERMINATE',
];

/**
 * FROZEN layer-2/3 evidence from production runs 31749657530 (probe #1) and
 * 31759906271 (probe #2). Embedded so this probe can combine layers WITHOUT an
 * authenticated user session and WITHOUT any application-row request.
 */
export const FROZEN_DB_AUTHORIZATION = Object.freeze({
  provenance: 'probe #1 run 31749657530 + probe #2 run 31759906271',
  // The 14 RLS-off tables: RLS disabled, anon+authenticated hold full DML =>
  // EFFECTIVE_EXPOSURE_CONFIRMED for both roles.
  rls_off_tables: { anon: true, authenticated: true },
  // All three views carry full anon+authenticated relation grants; they execute with
  // owner rights (security_invoker false), so base RLS does not filter them.
  views: { anon: true, authenticated: true },
  // Per-function EXECUTE, measured by probe #2.
  functions: Object.freeze({
    current_tenant_id: { anon: true, authenticated: true },
    diaspora_can_access_order: { anon: false, authenticated: true },
    diaspora_trade_os_can_access_row: { anon: false, authenticated: true },
    diaspora_trade_os_current_user_id: { anon: false, authenticated: true },
    diaspora_trade_os_is_platform_admin: { anon: false, authenticated: true },
    diaspora_trade_os_is_tenant_member: { anon: false, authenticated: true },
    is_diaspora_platform_admin: { anon: false, authenticated: true },
  }),
  // All 14 sequences grant anon+authenticated SELECT,UPDATE,USAGE.
  sequences: { anon: true, authenticated: true },
  // Layer 3: neither API role can hold a direct session.
  role_state: { anon_can_login: false, authenticated_can_login: false, anon_bypassrls: false, authenticated_bypassrls: false },
});

/**
 * Combine layer 1 (advertised in an exposed schema) with layer 2 (role DB
 * authorization) into a role-specific verdict. Either layer missing => INDETERMINATE.
 */
export function combineEvidence(advertised, metadataAvailable, dbAuth) {
  if (!metadataAvailable) {
    return {
      schema: 'INDETERMINATE',
      anon: 'INDETERMINATE',
      authenticated: 'INDETERMINATE',
    };
  }
  const schema = advertised ? 'SCHEMA_ADVERTISED' : 'NOT_SCHEMA_ADVERTISED';
  return {
    schema,
    anon: !advertised ? 'NOT_SCHEMA_ADVERTISED'
      : dbAuth.anon ? 'ANON_DATA_API_REACHABLE' : 'SCHEMA_ADVERTISED',
    authenticated: !advertised ? 'NOT_SCHEMA_ADVERTISED'
      : dbAuth.authenticated ? 'AUTHENTICATED_DATA_API_REACHABLE' : 'SCHEMA_ADVERTISED',
    anon_db_authorized: dbAuth.anon ? 'ANON_DB_AUTHORIZED' : null,
    authenticated_db_authorized: dbAuth.authenticated ? 'AUTHENTICATED_DB_AUTHORIZED' : null,
  };
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

export class ProbeError extends Error {
  constructor(code) { super(code); this.name = 'ProbeError'; this.code = code; }
}

const KNOWN_ERROR_CLASSES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'AggregateError', 'ProbeError', 'DOMException',
]);

/** Bounded class/code only — an HTTP or URL error message can embed the key. */
export function sanitizeError(err) {
  const rawName = err && err.name != null ? String(err.name) : 'Error';
  const cls = KNOWN_ERROR_CLASSES.has(rawName) ? rawName : 'Error';
  const raw = err && err.code != null ? String(err.code) : '';
  const code = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,30}|[A-Z][A-Z0-9_]{2,31})$/.test(raw) ? raw : 'UNSPECIFIED';
  return `${cls}/${code}`;
}

/**
 * Identity gate. Returns the Data API origin; never prints the key or the ref.
 * The origin is DERIVED from the project ref so no separate URL secret is needed
 * and no arbitrary host can be targeted.
 */
export function assertProductionIdentity(projectRef, apiKey) {
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.' };
  }
  if (projectRef === STAGING_REF) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF is the STAGING ref; refusing.' };
  }
  const cls = classifyMetadataKey(apiKey);
  if (cls === 'MISSING_OR_TOO_SHORT') {
    return { ok: false, reason: `${METADATA_KEY_ENV} is not configured; cannot read the Data API metadata surface.` };
  }
  if (cls === 'PUBLISHABLE_REFUSED') {
    // Neutral wording: the rejected credential's class is not echoed.
    return { ok: false, reason: `${METADATA_KEY_ENV} is not an accepted metadata credential; an elevated metadata-only key is required.` };
  }
  if (cls === 'UNRECOGNISED') {
    return { ok: false, reason: `${METADATA_KEY_ENV} is not a recognised credential class; refusing to send it.` };
  }
  const origin = `https://${projectRef}.supabase.co`;
  if (origin.includes(STAGING_REF)) {
    return { ok: false, reason: 'derived origin references the STAGING project; refusing.' };
  }
  return { ok: true, origin, metadataUrl: `${origin}/rest/v1/` };
}

/** Resource names advertised by an OpenAPI document, split into tables and RPCs. */
export function parseOpenApiPaths(doc) {
  if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') return null;
  const tables = new Set();
  const rpcs = new Set();
  for (const raw of Object.keys(doc.paths)) {
    if (typeof raw !== 'string' || !raw.startsWith('/')) continue;
    const path = raw.slice(1);
    if (path === '') continue;
    if (path.startsWith('rpc/')) {
      const name = path.slice(4).split(/[/?]/)[0];
      if (name) rpcs.add(name);
    } else {
      const name = path.split(/[/?]/)[0];
      if (name) tables.add(name);
    }
  }
  return { tables: [...tables].sort(), rpcs: [...rpcs].sort() };
}

export function classify(name, advertisedSet, metadataAvailable) {
  if (!metadataAvailable) return 'INDETERMINATE';
  return advertisedSet.has(name) ? 'API_ADVERTISED' : 'NOT_API_ADVERTISED';
}

/**
 * Fetch the OpenAPI document. GET only, one URL, bounded timeout.
 * Returns { ok, doc, reason } — never throws a body into the caller.
 */
export async function fetchMetadata(metadataUrl, apiKey, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(metadataUrl, {
      method: ALLOWED_HTTP_METHOD,
      // apikey ONLY. The key is never bearer-framed: sb_secret_* keys are not JWTs,
      // and one transport header is one place for a secret rather than two.
      headers: { apikey: apiKey, Accept: 'application/openapi+json, application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) return { ok: false, reason: `metadata endpoint returned HTTP ${res.status}` };
    let doc;
    try {
      doc = await res.json();
    } catch {
      return { ok: false, reason: 'metadata response was not JSON (OpenAPI may be disabled)' };
    }
    const parsed = parseOpenApiPaths(doc);
    if (!parsed) return { ok: false, reason: 'metadata document carried no paths object' };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, reason: `metadata request failed (${sanitizeError(err)})` };
  } finally {
    clearTimeout(timer);
  }
}

export function buildSections(parsed) {
  const available = !!parsed;
  const tableSet = new Set(parsed ? parsed.tables : []);
  const rpcSet = new Set(parsed ? parsed.rpcs : []);
  const s = {};

  s.DATA_API_METADATA_AVAILABLE = [{
    available,
    method: ALLOWED_HTTP_METHOD,
    surface: 'PostgREST OpenAPI root (/rest/v1/)',
    note: available
      ? 'exposed surface parsed from advertised paths; identifiers only'
      : 'DATA_API_SURFACE = INDETERMINATE — no fallback probing was performed',
  }];

  s.EXPOSED_TABLE_RESOURCES = (parsed ? parsed.tables : []).map((t) => ({ resource: t }));
  s.RPC_RESOURCES = (parsed ? parsed.rpcs : []).map((f) => ({ resource: f }));

  const row = (name, set, dbAuth) => {
    const ev = combineEvidence(set.has(name), available, dbAuth);
    return {
      classification: ev.schema,
      anon_classification: ev.anon,
      authenticated_classification: ev.authenticated,
      anon_db_authorized: ev.anon_db_authorized,
      authenticated_db_authorized: ev.authenticated_db_authorized,
    };
  };

  s.RLS_OFF_TABLE_REACHABILITY = RLS_OFF_TABLES.map((t) => ({
    table: t, ...row(t, tableSet, FROZEN_DB_AUTHORIZATION.rls_off_tables),
  }));
  s.FOCUS_VIEW_REACHABILITY = FOCUS_VIEWS.map((v) => ({
    view: v, ...row(v, tableSet, FROZEN_DB_AUTHORIZATION.views),
  }));
  s.NON_TRIGGER_RPC_REACHABILITY = DB_CALLABLE_NON_TRIGGER_FUNCTIONS.map((f) => ({
    function: f, ...row(f, rpcSet, FROZEN_DB_AUTHORIZATION.functions[f]),
  }));
  s.TRIGGER_FUNCTION_RPC_REACHABILITY = DB_CALLABLE_TRIGGER_FUNCTIONS.map((f) => ({
    function: f,
    classification: classify(f, rpcSet, available),
    note: 'a trigger function invoked as an RPC errors regardless; advertised here would be untidy, not exploitable',
  }));
  s.SEQUENCE_RESOURCE_REACHABILITY = SEQUENCES.map((q) => ({
    sequence: q, ...row(q, tableSet, FROZEN_DB_AUTHORIZATION.sequences),
  }));

  // Sequence bridge: is any ADVERTISED rpc one that could manipulate a sequence?
  // Determined WITHOUT invoking anything — by name comparison against the reconciled
  // function inventory, whose bodies were already classified by probe #2.
  const advertisedRpcs = [...rpcSet];
  const knownFns = new Set([...DB_CALLABLE_NON_TRIGGER_FUNCTIONS, ...DB_CALLABLE_TRIGGER_FUNCTIONS]);
  const unknownRpcs = advertisedRpcs.filter((f) => !knownFns.has(f));
  // An advertised callable function that has never been classified is exactly the
  // shape a sequence bridge would take. While one exists the answer is INDETERMINATE
  // — NO_ADVERTISED_SEQUENCE_BRIDGE_FOUND may never be emitted alongside it.
  const bridgeClassification = !available
    ? 'INDETERMINATE'
    : unknownRpcs.length > 0
      ? 'INDETERMINATE'
      : 'NO_ADVERTISED_SEQUENCE_BRIDGE_FOUND';
  s.SEQUENCE_BRIDGE_EVIDENCE = [{
    classification: bridgeClassification,
    advertised_rpc_count: advertisedRpcs.length,
    advertised_rpcs_not_in_known_inventory: unknownRpcs,
    indeterminate_reason: !available
      ? 'metadata unavailable'
      : unknownRpcs.length > 0
        ? `${unknownRpcs.length} advertised callable function(s) are not in the classified inventory; each must be classified before any bridge conclusion`
        : null,
    sequence_primitive_source_evidence:
      'SOURCE EVIDENCE ONLY (not production proof): zero occurrences of setval/nextval/currval in any function body across the 106 migrations on main',
    caveat:
      'probe #2 did not test bodies for sequence primitives, and two SECURITY DEFINER functions exist that no migration defines — a definitive answer needs a body-level regex probe',
    scope_note:
      'B1-SEQ may remain probe-gated on this. It does NOT gate B2: the 14 RLS-off tables carry independent production DB-authorization evidence from run 31749657530.',
  }];

  const count = (arr, c) => arr.filter((x) => x.classification === c).length;
  const countRole = (arr, role, c) => arr.filter((x) => x[`${role}_classification`] === c).length;
  s.TOTALS = {
    metadata_available: available,
    exposed_table_resources: s.EXPOSED_TABLE_RESOURCES.length,
    exposed_rpc_resources: s.RPC_RESOURCES.length,
    rls_off_schema_advertised: count(s.RLS_OFF_TABLE_REACHABILITY, 'SCHEMA_ADVERTISED'),
    rls_off_indeterminate: count(s.RLS_OFF_TABLE_REACHABILITY, 'INDETERMINATE'),
    rls_off_anon_reachable: countRole(s.RLS_OFF_TABLE_REACHABILITY, 'anon', 'ANON_DATA_API_REACHABLE'),
    rls_off_authenticated_reachable: countRole(s.RLS_OFF_TABLE_REACHABILITY, 'authenticated', 'AUTHENTICATED_DATA_API_REACHABLE'),
    focus_views_schema_advertised: count(s.FOCUS_VIEW_REACHABILITY, 'SCHEMA_ADVERTISED'),
    focus_views_anon_reachable: countRole(s.FOCUS_VIEW_REACHABILITY, 'anon', 'ANON_DATA_API_REACHABLE'),
    non_trigger_rpc_schema_advertised: count(s.NON_TRIGGER_RPC_REACHABILITY, 'SCHEMA_ADVERTISED'),
    non_trigger_rpc_anon_reachable: countRole(s.NON_TRIGGER_RPC_REACHABILITY, 'anon', 'ANON_DATA_API_REACHABLE'),
    non_trigger_rpc_authenticated_reachable: countRole(s.NON_TRIGGER_RPC_REACHABILITY, 'authenticated', 'AUTHENTICATED_DATA_API_REACHABLE'),
    trigger_rpc_advertised: count(s.TRIGGER_FUNCTION_RPC_REACHABILITY, 'API_ADVERTISED'),
    sequences_schema_advertised: count(s.SEQUENCE_RESOURCE_REACHABILITY, 'SCHEMA_ADVERTISED'),
    sequence_bridge: s.SEQUENCE_BRIDGE_EVIDENCE[0].classification,
    evidence_provenance: FROZEN_DB_AUTHORIZATION.provenance,
    function_arithmetic: {
      total: 34, trigger: 14, non_trigger: 20,
      db_callable_trigger: 12, db_callable_non_trigger: 7, db_callable_total: 19,
      not_db_callable: 15,
    },
  };
  return s;
}

export function assertComplete(s) {
  const missing = REQUIRED_SECTIONS.filter((k) => !(k in s));
  if (missing.length) return { ok: false, reason: `missing section(s): ${missing.join(', ')}` };
  const notArray = REQUIRED_SECTIONS.filter((k) => k !== 'TOTALS' && !Array.isArray(s[k]));
  if (notArray.length) return { ok: false, reason: `section(s) not arrays: ${notArray.join(', ')}` };
  if (s.RLS_OFF_TABLE_REACHABILITY.length !== RLS_OFF_TABLES.length) {
    return { ok: false, reason: 'RLS_OFF_TABLE_REACHABILITY did not cover all 14 tables' };
  }
  if (s.FOCUS_VIEW_REACHABILITY.length !== FOCUS_VIEWS.length) {
    return { ok: false, reason: 'FOCUS_VIEW_REACHABILITY did not cover all three views' };
  }
  if (s.NON_TRIGGER_RPC_REACHABILITY.length !== DB_CALLABLE_NON_TRIGGER_FUNCTIONS.length) {
    return { ok: false, reason: 'NON_TRIGGER_RPC_REACHABILITY did not cover all seven functions' };
  }
  if (s.TRIGGER_FUNCTION_RPC_REACHABILITY.length !== DB_CALLABLE_TRIGGER_FUNCTIONS.length) {
    return { ok: false, reason: 'TRIGGER_FUNCTION_RPC_REACHABILITY did not cover all twelve functions' };
  }
  if (s.SEQUENCE_RESOURCE_REACHABILITY.length !== SEQUENCES.length) {
    return { ok: false, reason: 'SEQUENCE_RESOURCE_REACHABILITY did not cover all fourteen sequences' };
  }
  return { ok: true };
}

function report(s) {
  const L = console.log;
  const line = (arr, key) => arr.forEach((x) => L(
    `   ${String(x[key]).padEnd(38)} schema=${x.classification}` +
    (x.anon_classification ? `  anon=${x.anon_classification}  auth=${x.authenticated_classification}` : '')));
  L('');
  L('══ EVIDENCE MODEL ══');
  L('   layer 1 (this probe, elevated key): SCHEMA_ADVERTISED — object lives in an exposed Data API schema');
  L('   layer 2 (probes #1/#2, frozen)    : ANON_/AUTHENTICATED_DB_AUTHORIZED');
  L('   layer 3 (probe #2, frozen)        : anon/authenticated cannot hold a direct session');
  L('   role reachability requires layer 1 AND layer 2. The elevated-key document alone');
  L('   NEVER establishes advertisement to anon or authenticated.');
  L('');
  L('══ DATA_API_METADATA_AVAILABLE ══');
  const m = s.DATA_API_METADATA_AVAILABLE[0];
  L(`   available=${m.available} method=${m.method} surface=${m.surface}`);
  L(`   ${m.note}`);
  L('');
  L('══ EXPOSED_TABLE_RESOURCES (identifiers only) ══');
  L(`   count = ${s.EXPOSED_TABLE_RESOURCES.length}`);
  for (const r of s.EXPOSED_TABLE_RESOURCES) L(`   ${r.resource}`);
  L('');
  L('══ RLS_OFF_TABLE_REACHABILITY (the 14) ══');
  line(s.RLS_OFF_TABLE_REACHABILITY, 'table');
  L('');
  L('══ FOCUS_VIEW_REACHABILITY ══');
  line(s.FOCUS_VIEW_REACHABILITY, 'view');
  L('');
  L('══ RPC_RESOURCES (identifiers only) ══');
  L(`   count = ${s.RPC_RESOURCES.length}`);
  for (const r of s.RPC_RESOURCES) L(`   ${r.resource}`);
  L('');
  L('══ NON_TRIGGER_RPC_REACHABILITY (the reconciled 7) ══');
  line(s.NON_TRIGGER_RPC_REACHABILITY, 'function');
  L('');
  L('══ TRIGGER_FUNCTION_RPC_REACHABILITY (the 12) ══');
  line(s.TRIGGER_FUNCTION_RPC_REACHABILITY, 'function');
  L('');
  L('══ SEQUENCE_RESOURCE_REACHABILITY (the 14) ══');
  line(s.SEQUENCE_RESOURCE_REACHABILITY, 'sequence');
  L('');
  L('══ SEQUENCE_BRIDGE_EVIDENCE ══');
  const b = s.SEQUENCE_BRIDGE_EVIDENCE[0];
  L(`   classification=${b.classification} advertised_rpcs=${b.advertised_rpc_count}`);
  if (b.indeterminate_reason) L(`   indeterminate because: ${b.indeterminate_reason}`);
  L(`   scope: ${b.scope_note}`);
  L(`   advertised RPCs not in the known inventory: ${JSON.stringify(b.advertised_rpcs_not_in_known_inventory)}`);
  L(`   source evidence: ${b.sequence_primitive_source_evidence}`);
  L(`   caveat: ${b.caveat}`);
  L('');
  L('══ TOTALS ══');
  for (const [k, v] of Object.entries(s.TOTALS)) L(`   ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}

async function main() {
  const projectRef = process.env.PRODUCTION_PROJECT_REF;
  const apiKey = process.env[METADATA_KEY_ENV];

  const identity = assertProductionIdentity(projectRef, apiKey);
  if (!identity.ok) {
    // Missing configuration is INDETERMINATE, not an excuse to probe differently.
    console.log(`::warning::${identity.reason}`);
    console.log('DATA_API_SURFACE = INDETERMINATE');
    const s = buildSections(null);
    report(s);
    console.log('');
    console.log('DATA_API_SURFACE_JSON_BEGIN');
    console.log(JSON.stringify(s, null, 2));
    console.log('DATA_API_SURFACE_JSON_END');
    console.log('');
    console.log('SURFACE PROBE COMPLETE — INDETERMINATE. No request was made; no fallback probing was performed.');
    return;
  }
  console.log('Production identity asserted (ref matched; staging ref refused). Key and ref are never printed.');
  console.log(`Requesting metadata: ${ALLOWED_HTTP_METHOD} <origin>/rest/v1/ (origin withheld)`);

  const result = await fetchMetadata(identity.metadataUrl, apiKey);
  if (!result.ok) {
    console.log(`::warning::metadata discovery failed: ${result.reason}`);
    console.log('DATA_API_SURFACE = INDETERMINATE');
  }

  const s = buildSections(result.ok ? result.parsed : null);
  const complete = assertComplete(s);
  if (!complete.ok) fail(`SURFACE PROBE INCOMPLETE — ${complete.reason}`);

  report(s);
  console.log('');
  console.log('DATA_API_SURFACE_JSON_BEGIN');
  console.log(JSON.stringify(s, null, 2));
  console.log('DATA_API_SURFACE_JSON_END');
  console.log('');
  console.log(result.ok
    ? 'SURFACE PROBE COMPLETE — metadata only. No RPC was invoked, no table resource was requested, no application row was read.'
    : 'SURFACE PROBE COMPLETE — INDETERMINATE. No fallback probing was performed.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`surface probe failed (sanitized): ${sanitizeError(err)}`));
}
