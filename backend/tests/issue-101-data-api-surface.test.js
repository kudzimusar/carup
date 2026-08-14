/**
 * Guards for the Issue #101 Data API surface probe.
 *
 * This probe talks to the production Data API, so its safety properties are HTTP
 * properties, not SQL ones: exactly one method, exactly one URL shape, no RPC
 * invocation, no table-resource request, no application-row fallback, and a
 * fail-closed INDETERMINATE result whenever metadata cannot be obtained.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  ALLOWED_HTTP_METHOD, REQUIRED_SECTIONS, CLASSIFICATIONS, METADATA_KEY_ENV,
  FROZEN_DB_AUTHORIZATION, classifyMetadataKey, combineEvidence,
  RLS_OFF_TABLES, FOCUS_VIEWS, DB_CALLABLE_NON_TRIGGER_FUNCTIONS,
  DB_CALLABLE_TRIGGER_FUNCTIONS, SEQUENCES,
  assertProductionIdentity, assertComplete, buildSections, classify,
  parseOpenApiPaths, fetchMetadata, sanitizeError,
} from '../scripts/production-data-api-surface.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/production-data-api-surface.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');

const PROD_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FAKE_KEY = ['eyJ', 'FaKeAnonKey', 'NotReal', '0123456789'].join('');

// ------------------------------------------------------- no mutation methods

test('GET is the only allowed method and no mutating verb appears anywhere', () => {
  assert.equal(ALLOWED_HTTP_METHOD, 'GET');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const verb of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.ok(!new RegExp(`method:\\s*['"\`]${verb}`, 'i').test(code), `must never issue ${verb}`);
    assert.ok(!new RegExp(`['"\`]${verb}['"\`]`).test(code), `${verb} must not appear as a method literal`);
  }
  const methods = [...src.matchAll(/method:\s*([A-Za-z_]+|['"`][A-Z]+['"`])/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methods)], ['ALLOWED_HTTP_METHOD'], 'the method must come only from the constant');
});

test('exactly one URL shape is requested — the OpenAPI root', () => {
  assert.match(src, /\/rest\/v1\//);
  // No /rpc/ path may ever be constructed for a request.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/`\$\{[^`]*\}\/rpc\//.test(code), 'must never build an /rpc/ request URL');
  assert.ok(!/fetchImpl\([^)]*rpc/i.test(code), 'must never fetch an rpc path');
  const fetches = [...src.matchAll(/fetchImpl\(\s*([A-Za-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(fetches)], ['metadataUrl'], 'only the metadata URL may be fetched');
});

test('no RPC is invoked and no table resource is requested', () => {
  // parseOpenApiPaths only READS the advertised names; nothing calls them.
  assert.match(src, /rpc\//, 'rpc paths are parsed');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const fetchCalls = (code.match(/fetchImpl\(/g) || []).length;
  assert.equal(fetchCalls, 1, 'exactly one fetch call site may exist');
});

test('there is no application-row fallback', () => {
  assert.match(src, /no fallback probing was performed/);
  assert.ok(!/select=/i.test(src), 'must never build a PostgREST select query');
  assert.ok(!/limit=1/i.test(src), 'must never request rows');
  // Precise: a Range REQUEST HEADER, not the substring (RangeError is a class name).
  assert.ok(!/['"`]Range['"`]\s*:/.test(src), 'must never set a Range request header to fetch rows');
  assert.ok(!/offset=/i.test(src), 'must never paginate rows');
});

// ------------------------------------------------------------- identity gate

test('staging ref is refused', () => {
  const r = assertProductionIdentity(STAGING_REF, FAKE_KEY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /STAGING/i);
});

test('production ref is required and validated', () => {
  assert.equal(assertProductionIdentity('', FAKE_KEY).ok, false);
  assert.equal(assertProductionIdentity('short', FAKE_KEY).ok, false);
  assert.equal(assertProductionIdentity(PROD_REF, FAKE_KEY).ok, true);
});

test('a missing API key yields INDETERMINATE rather than an unauthenticated probe', () => {
  const r = assertProductionIdentity(PROD_REF, '');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured/i);
  assert.match(src, /Missing configuration is INDETERMINATE, not an excuse to probe differently/);
});

test('the origin is derived from the ref, so no arbitrary host can be targeted', () => {
  const r = assertProductionIdentity(PROD_REF, FAKE_KEY);
  assert.equal(r.origin, `https://${PROD_REF}.supabase.co`);
  assert.equal(r.metadataUrl, `https://${PROD_REF}.supabase.co/rest/v1/`);
  assert.ok(!/PRODUCTION_DATA_API_URL/.test(src), 'must not accept an arbitrary URL secret');
});

// ------------------------------------------------------------- no secrets

test('the API key and ref are never printed', () => {
  const logged = [...src.matchAll(/console\.(log|error)\(([^\n]*)/g)].map((m) => m[2]);
  for (const l of logged) {
    for (const f of ['apiKey', 'projectRef', 'PRODUCTION_DATA_API_KEY', 'PRODUCTION_PROJECT_REF', 'metadataUrl', 'origin']) {
      assert.ok(!new RegExp(`\\$\\{[^}]*\\b${f}\\b[^}]*\\}`).test(l), `must not interpolate ${f}: ${l.slice(0, 90)}`);
    }
  }
  assert.match(src, /origin withheld/);
});

test('response bodies are never emitted wholesale', () => {
  // Only parsed identifiers reach the sections.
  assert.match(src, /identifiers only/i);
  const logged = [...src.matchAll(/console\.log\(([^\n]*)/g)].map((m) => m[1]);
  for (const l of logged) {
    assert.ok(!/\bdoc\b/.test(l), `must not print the OpenAPI document: ${l.slice(0, 80)}`);
    assert.ok(!/res\.json|await res/.test(l), 'must not print a response');
  }
  assert.ok(!/JSON\.stringify\(doc/.test(src), 'must never serialise the raw document');
});

test('a hostile error cannot leak the key', () => {
  const e = new Error(`fetch failed for https://x.supabase.co?apikey=${FAKE_KEY}`);
  e.name = `Err ${FAKE_KEY}`;
  e.code = FAKE_KEY;
  const out = sanitizeError(e);
  assert.equal(out, 'Error/UNSPECIFIED');
  assert.ok(!out.includes(FAKE_KEY));
});

// --------------------------------------------------------------- parsing

test('OpenAPI paths split into table and rpc identifiers', () => {
  const doc = { paths: { '/': {}, '/vehicles': {}, '/currency_rates': {}, '/rpc/current_tenant_id': {}, '/rpc/diaspora_can_access_order': {} } };
  const p = parseOpenApiPaths(doc);
  assert.deepEqual(p.tables, ['currency_rates', 'vehicles']);
  assert.deepEqual(p.rpcs, ['current_tenant_id', 'diaspora_can_access_order']);
});

test('a document without paths yields null, which becomes INDETERMINATE', () => {
  assert.equal(parseOpenApiPaths(null), null);
  assert.equal(parseOpenApiPaths({}), null);
  assert.equal(parseOpenApiPaths({ paths: 'nope' }), null);
  const s = buildSections(null);
  assert.equal(s.DATA_API_METADATA_AVAILABLE[0].available, false);
  for (const row of s.RLS_OFF_TABLE_REACHABILITY) {
    assert.equal(row.classification, 'INDETERMINATE');
    assert.equal(row.anon_classification, 'INDETERMINATE');
    assert.equal(row.authenticated_classification, 'INDETERMINATE');
  }
});

// ============== FINAL CORRECTION (PR #154 review) ==============

test('CRED: the metadata key env is explicitly named as elevated/metadata-only', () => {
  assert.equal(METADATA_KEY_ENV, 'PRODUCTION_DATA_API_METADATA_KEY');
  assert.ok(!/PRODUCTION_DATA_API_KEY\b/.test(src), 'the ambiguous old name must be gone');
  assert.match(src, /metadata-only ELEVATED key/i);
  assert.match(src.replace(/\s+/g, ' '), /publishable\/anon access to the OpenAPI document has been \* removed/i);
});

test('CRED: a publishable key is refused BEFORE any request, without echoing its class', () => {
  assert.equal(classifyMetadataKey('sb_publishable_abcdefghijklmnop'), 'PUBLISHABLE_REFUSED');
  const r = assertProductionIdentity(PROD_REF, 'sb_publishable_abcdefghijklmnop');
  assert.equal(r.ok, false);
  assert.ok(!/publishable/i.test(r.reason), 'the refusal must not echo the credential class');
  assert.match(r.reason, /elevated metadata-only key is required/);
});

test('CRED: secret keys and legacy JWTs are accepted classes', () => {
  assert.equal(classifyMetadataKey('sb_secret_abcdefghijklmnopqrst'), 'SECRET_KEY');
  assert.equal(classifyMetadataKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x'), 'LEGACY_JWT');
  assert.equal(assertProductionIdentity(PROD_REF, 'sb_secret_abcdefghijklmnopqrst').ok, true);
  assert.equal(classifyMetadataKey('random-thing-that-is-long-enough'), 'UNRECOGNISED');
  assert.equal(assertProductionIdentity(PROD_REF, 'random-thing-that-is-long-enough').ok, false);
});

test('CRED: sb_secret_* is NEVER placed in an Authorization Bearer header', async () => {
  const SECRET = 'sb_secret_abcdefghijklmnopqrst';
  let seen = null;
  await fetchMetadata('https://x/rest/v1/', SECRET, async (url, opts) => {
    seen = opts;
    return { ok: true, status: 200, json: async () => ({ paths: {} }) };
  });
  assert.equal(seen.headers.apikey, SECRET, 'the key travels as apikey');
  assert.ok(!('Authorization' in seen.headers), 'no Authorization header may exist');
  assert.ok(!JSON.stringify(seen.headers).includes('Bearer'), 'the key must never be bearer-framed');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/Authorization:\s*`Bearer/.test(code), 'no Bearer construction may remain in code');
});

test('EVIDENCE: OpenAPI proves schema advertisement, not anon/auth advertisement', () => {
  assert.match(src.replace(/\s+/g, ' '), /It does NOT establish that the object \* is advertised to anon or to authenticated/);
  assert.match(src, /NEVER establishes advertisement to anon or authenticated/);
  for (const c of ['SCHEMA_ADVERTISED', 'ANON_DB_AUTHORIZED', 'AUTHENTICATED_DB_AUTHORIZED',
                   'ANON_DATA_API_REACHABLE', 'AUTHENTICATED_DATA_API_REACHABLE', 'INDETERMINATE']) {
    assert.ok(CLASSIFICATIONS.includes(c), `${c} must be in the taxonomy`);
  }
});

test('EVIDENCE: role reachability requires layer 1 AND the frozen layer-2 evidence', () => {
  // advertised + db-authorized => reachable
  let ev = combineEvidence(true, true, { anon: true, authenticated: true });
  assert.equal(ev.schema, 'SCHEMA_ADVERTISED');
  assert.equal(ev.anon, 'ANON_DATA_API_REACHABLE');
  assert.equal(ev.authenticated, 'AUTHENTICATED_DATA_API_REACHABLE');
  // advertised but NOT db-authorized => stays schema-advertised only
  ev = combineEvidence(true, true, { anon: false, authenticated: true });
  assert.equal(ev.anon, 'SCHEMA_ADVERTISED');
  assert.equal(ev.authenticated, 'AUTHENTICATED_DATA_API_REACHABLE');
  // not advertised => not reachable regardless of db authorization
  ev = combineEvidence(false, true, { anon: true, authenticated: true });
  assert.equal(ev.anon, 'NOT_SCHEMA_ADVERTISED');
  // metadata missing => everything indeterminate
  ev = combineEvidence(true, false, { anon: true, authenticated: true });
  assert.equal(ev.anon, 'INDETERMINATE');
});

test('EVIDENCE: frozen layer-2/3 facts carry their provenance', () => {
  assert.match(FROZEN_DB_AUTHORIZATION.provenance, /31749657530/);
  assert.match(FROZEN_DB_AUTHORIZATION.provenance, /31759906271/);
  // current_tenant_id is the only anon-executable function measured by probe #2.
  assert.equal(FROZEN_DB_AUTHORIZATION.functions.current_tenant_id.anon, true);
  assert.equal(FROZEN_DB_AUTHORIZATION.functions.diaspora_can_access_order.anon, false);
  assert.equal(FROZEN_DB_AUTHORIZATION.role_state.anon_can_login, false);
});

test('BRIDGE: an unknown advertised RPC forces INDETERMINATE', () => {
  const s = buildSections({ tables: [], rpcs: ['current_tenant_id', 'mystery_fn'] });
  const b = s.SEQUENCE_BRIDGE_EVIDENCE[0];
  assert.equal(b.classification, 'INDETERMINATE');
  assert.deepEqual(b.advertised_rpcs_not_in_known_inventory, ['mystery_fn']);
  assert.match(b.indeterminate_reason, /not in the classified inventory/);
});

test('BRIDGE: NO_ADVERTISED_SEQUENCE_BRIDGE_FOUND only when every advertised RPC is classified', () => {
  const s = buildSections({ tables: [], rpcs: ['current_tenant_id'] });
  assert.equal(s.SEQUENCE_BRIDGE_EVIDENCE[0].classification, 'NO_ADVERTISED_SEQUENCE_BRIDGE_FOUND');
  assert.equal(s.SEQUENCE_BRIDGE_EVIDENCE[0].indeterminate_reason, null);
});

test('BRIDGE: the migration grep is labelled SOURCE EVIDENCE ONLY', () => {
  const s = buildSections({ tables: [], rpcs: [] });
  assert.match(s.SEQUENCE_BRIDGE_EVIDENCE[0].sequence_primitive_source_evidence, /SOURCE EVIDENCE ONLY \(not production proof\)/);
});

test('BRIDGE: sequence uncertainty is scoped away from B2', () => {
  const s = buildSections({ tables: [], rpcs: [] });
  assert.match(s.SEQUENCE_BRIDGE_EVIDENCE[0].scope_note, /does NOT gate B2/);
  assert.match(s.SEQUENCE_BRIDGE_EVIDENCE[0].scope_note, /B1-SEQ may remain probe-gated/);
});

test('SAFETY: no new HTTP call sites, row requests or RPC invocations were introduced', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.equal((code.match(/fetchImpl\(/g) || []).length, 1, 'still exactly one fetch call site');
  const fetches = [...src.matchAll(/fetchImpl\(\s*([A-Za-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(fetches)], ['metadataUrl']);
  assert.ok(!/select=|limit=|offset=/.test(code));
  assert.ok(!/['"`]rpc\/\$/.test(code), 'no rpc URL may be constructed');
});

test('classify() still yields the three fixed values for trigger-function rows', () => {
  const set = new Set(['vehicles']);
  assert.equal(classify('vehicles', set, true), 'API_ADVERTISED');
  assert.equal(classify('other', set, true), 'NOT_API_ADVERTISED');
  assert.equal(classify('vehicles', set, false), 'INDETERMINATE');
});

// ------------------------------------------------- fail-closed on failure

test('a non-2xx response yields INDETERMINATE, never a retry with another technique', async () => {
  const r = await fetchMetadata('https://x/rest/v1/', FAKE_KEY, async () => ({ ok: false, status: 404 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 404/);
});

test('a non-JSON response yields INDETERMINATE', async () => {
  const r = await fetchMetadata('https://x/rest/v1/', FAKE_KEY, async () => ({
    ok: true, status: 200, json: async () => { throw new Error('not json'); },
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /not JSON/);
});

test('a thrown request yields a SANITIZED INDETERMINATE reason', async () => {
  const r = await fetchMetadata('https://x/rest/v1/', FAKE_KEY, async () => { throw new Error(`boom ${FAKE_KEY}`); });
  assert.equal(r.ok, false);
  assert.ok(!r.reason.includes(FAKE_KEY), 'the failure reason must not carry the key');
});

test('the fetch uses GET, the allowlisted headers, and refuses redirects', async () => {
  let seen = null;
  await fetchMetadata('https://x/rest/v1/', FAKE_KEY, async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ paths: { '/vehicles': {} } }) };
  });
  assert.equal(seen.opts.method, 'GET');
  assert.equal(seen.opts.redirect, 'error');
  assert.ok(seen.opts.signal, 'must carry an abort signal (bounded timeout)');
});

// ---------------------------------------------------- coverage + arithmetic

test('all ten required sections are declared', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'DATA_API_METADATA_AVAILABLE', 'EXPOSED_TABLE_RESOURCES', 'FOCUS_VIEW_REACHABILITY',
    'NON_TRIGGER_RPC_REACHABILITY', 'RLS_OFF_TABLE_REACHABILITY', 'RPC_RESOURCES',
    'SEQUENCE_BRIDGE_EVIDENCE', 'SEQUENCE_RESOURCE_REACHABILITY',
    'TOTALS', 'TRIGGER_FUNCTION_RPC_REACHABILITY',
  ]);
});

test('the reconciled function arithmetic is exact', () => {
  const s = buildSections({ tables: [], rpcs: [] });
  const a = s.TOTALS.function_arithmetic;
  assert.equal(a.trigger + a.non_trigger, a.total, '14 + 20 = 34');
  assert.equal(a.db_callable_trigger + a.db_callable_non_trigger, a.db_callable_total, '12 + 7 = 19');
  assert.equal(a.db_callable_total + a.not_db_callable, a.total, '19 + 15 = 34');
  assert.equal(DB_CALLABLE_NON_TRIGGER_FUNCTIONS.length, a.db_callable_non_trigger);
  assert.equal(DB_CALLABLE_TRIGGER_FUNCTIONS.length, a.db_callable_trigger);
});

test('comparison sets match the measured production inventories', () => {
  assert.equal(RLS_OFF_TABLES.length, 14);
  assert.equal(FOCUS_VIEWS.length, 3);
  assert.equal(SEQUENCES.length, 14);
  assert.ok(RLS_OFF_TABLES.includes('ocr_national_ids'));
  assert.ok(FOCUS_VIEWS.includes('evidence_sources_public'));
});

test('a partial result fails rather than reporting completion', () => {
  const s = buildSections({ tables: [], rpcs: [] });
  assert.equal(assertComplete(s).ok, true);
  for (const k of REQUIRED_SECTIONS) {
    const bad = buildSections({ tables: [], rpcs: [] });
    delete bad[k];
    assert.equal(assertComplete(bad).ok, false, `${k} missing must fail`);
  }
  const short = buildSections({ tables: [], rpcs: [] });
  short.RLS_OFF_TABLE_REACHABILITY = short.RLS_OFF_TABLE_REACHABILITY.slice(0, 3);
  assert.match(assertComplete(short).reason, /all 14 tables/);
});

test('advertised is never conflated with exploitable', () => {
  assert.match(src, /ADVERTISED != EXPLOITABLE/);
  assert.match(src, /Combining that with the DB authorization/);
});
