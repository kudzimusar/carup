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
  ALLOWED_HTTP_METHOD, REQUIRED_SECTIONS, CLASSIFICATIONS,
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
  for (const row of s.RLS_OFF_TABLE_REACHABILITY) assert.equal(row.classification, 'INDETERMINATE');
});

test('classification is one of the three fixed values', () => {
  const set = new Set(['vehicles']);
  assert.equal(classify('vehicles', set, true), 'API_ADVERTISED');
  assert.equal(classify('other', set, true), 'NOT_API_ADVERTISED');
  assert.equal(classify('vehicles', set, false), 'INDETERMINATE');
  for (const c of ['API_ADVERTISED', 'NOT_API_ADVERTISED', 'INDETERMINATE']) assert.ok(CLASSIFICATIONS.includes(c));
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
