/**
 * T11-CAP-LR01-R2 — CarUp's CAP does not depend on the external CAP it was first populated from.
 *
 * The certification question is: if the original portal vanished tomorrow, would anything in CarUp stop working? Three independent proofs:
 *
 *   1. NO RUNTIME REFERENCE. No file that ships — backend services, routes, middleware, utils, the web app — names the source's host, a capability URL, or
 *      a token. (The historical facts live in the ingestion script's DATA file, read once at ingestion time and never at request time.)
 *   2. NO NETWORK ON THE READ PATH. The whole Journey — specifications, parties, document delivery, progress, payments, media, the important update — is
 *      composed with `fetch`, `http` and `https` booby-trapped to throw. It still answers, because it reads only CarUp's database.
 *   3. NO SECRET IN THE REPOSITORY. The capability token's shape does not appear in anything tracked by git for this programme.
 *
 * Provenance is retained in the database and shown as attribution; it is not a dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getJourney } from '../services/diaspora/journeyProjectionService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const RUNTIME_DIRS = [
  'backend/services', 'backend/routes', 'backend/middleware', 'backend/utils', 'backend/db', 'backend/validators', 'backend/constants',
  'web/src', 'shared',
];
const SKIP_DIR = /(^|\/)(node_modules|dist|build|coverage|__snapshots__)(\/|$)/;
const isTestFile = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /\/(tests?|__tests__)\//.test(file);

function runtimeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(ROOT, full);
      if (SKIP_DIR.test(rel)) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(js|mjs|cjs|ts|tsx|jsx|json)$/.test(entry.name) && !isTestFile(rel)) out.push(rel);
    }
  };
  for (const dir of RUNTIME_DIRS) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  return out;
}

test('X1: no shipped file names the source\'s host, a capability URL or a token', () => {
  const files = runtimeFiles();
  assert.ok(files.length > 300, `the scan found only ${files.length} runtime files — it is not looking where it thinks it is`);
  const forbidden = [
    /beforward/i, /be-forward/i, /\bcap\.[a-z0-9-]+\.[a-z]{2,}\b.*token/i, /[?&]access_?token=/i, /capability[_-]?token/i,
    // the portal's own CAP page address shapes (an absolute URL: a relative `./cap/…` import is this repository's own folder)
    /https?:\/\/[^\s'"`)]+\/cap\/[A-Za-z0-9_-]{16,}/, /[?&]cap_?id=/i,
  ];
  const hits = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of forbidden) if (re.test(text)) hits.push(`${rel}: ${re}`);
  }
  assert.deepEqual(hits, [], `a shipped file depends on, or names, the external portal: ${hits.join('; ')}`);
});

test('X2: the ingestion reads its facts from a FILE; nothing in the request path imports the ingestion or its data', () => {
  const importers = [];
  for (const rel of runtimeFiles().filter((f) => f.startsWith('backend/'))) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (/t11-cap-r2-ingest|t11-cap-r2-historical-facts|t11-cap-r2-converge/.test(text)) importers.push(rel);
  }
  assert.deepEqual(importers, [], `request-path code reaches the ingestion tooling: ${importers.join(', ')}`);
  const ingest = fs.readFileSync(path.join(ROOT, 'backend/scripts/t11-cap-r2-ingest.mjs'), 'utf8');
  assert.ok(!/\bfetch\s*\(|https?\.request|http\.get|https\.get|XMLHttpRequest|axios|node-fetch/.test(ingest.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the ingestion script makes a network request of its own');
});

// A fixture shaped like the real purchase, carrying a source label as DATA — the only place a source is named.
const VIN = 'FRAME-0000777';
const ORDER = 'ord-independence';
const STAMP = '2026-10-24T23:46:01Z';

function world() {
  return createMockSupabase({
    vehicles: [{ vin: VIN, make: 'Make', model: 'Model', year: 2018, mileage: 100, price: 0, currency: null, owner_id: 'u-owner', passport_verified: false }],
    diaspora_import_orders: [{ id: ORDER, tenant_id: null, buyer_id: 'u-owner', created_by: 'u-owner', linked_vehicle_vin: VIN, status: 'DOCUMENTS_PENDING', deleted_at: null, created_at: STAMP, metadata: { external_reference: { reference: 'REF-1' } } }],
    diaspora_import_order_participants: [], diaspora_container_shipments: [], diaspora_cargo_reservations: [], diaspora_container_loads: [], diaspora_container_load_items: [],
    diaspora_shipments: [{ id: 'ship-1', import_order_id: ORDER, container_id: null, status: 'PLANNED', metadata: {}, deleted_at: null }],
    diaspora_shipment_stage_events: [], diaspora_shipment_legs: [], diaspora_shipment_observations: [],
    trade_document_types: [], diaspora_trade_documents: [], diaspora_trade_document_readiness: [], diaspora_customs_cases: [], diaspora_customs_events: [],
    diaspora_customs_agent_appointments: [], diaspora_import_quotes: [], diaspora_payment_milestones: [],
    diaspora_external_progress_entries: [{
      id: 'l1', import_order_id: ORDER, stage_code: 'BOOKING', entry_sequence: 1, action_sequence: 1, action_taker_reported: 'Provider', action_taker_kind: 'PROVIDER',
      action_text: 'Booking confirmed.', reported_status: 'COMPLETED', event_time: null, verification_status: 'REPORTED', source_system: 'EXT', observed_at: STAMP,
      metadata: { source_label: 'Partner portal' }, deleted_at: null,
    }],
    diaspora_order_parties: [{ id: 'p1', import_order_id: ORDER, party_role: 'CONSIGNEE', party_kind: 'INDIVIDUAL', display_name: 'Consignee', origin: 'EXTERNAL_REPORT', source_system: 'EXT', observed_at: STAMP, metadata: { source_label: 'Partner portal' }, deleted_at: null }],
    diaspora_document_dispatches: [{ id: 'd1', import_order_id: ORDER, document_types: ['bill_of_lading'], dispatch_status: 'DELIVERED', status_reported_text: 'Arrived at delivery address', status_observed_at: STAMP, origin: 'EXTERNAL_REPORT', source_system: 'EXT', metadata: { source_label: 'Partner portal' }, deleted_at: null }],
    vehicle_specification_observations: [{ id: 's1', vin: VIN, spec_key: 'SEAT_COUNT', value_number: 5, verification_status: 'REPORTED', origin: 'EXTERNAL_REPORT', source_system: 'EXT', deleted_at: null }],
    vehicle_media_references: [], vehicle_evidence: [],
  });
}

test('X3: the whole CAP is composed with the network booby-trapped — it reads CarUp\'s database and nothing else', async () => {
  const boom = (what) => () => { throw new Error(`NETWORK ATTEMPTED: ${what}`); };
  const originals = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, connect: net.connect, createConnection: net.createConnection };
  globalThis.fetch = boom('fetch');
  http.request = boom('http.request'); http.get = boom('http.get'); https.request = boom('https.request'); https.get = boom('https.get');
  net.connect = boom('net.connect'); net.createConnection = boom('net.createConnection');
  try {
    const owner = { id: 'u-owner', platformRole: 'member' };
    const signer = { async signMany() { return new Map(); } };
    const journey = await getJourney('vehicle', VIN, owner, { supabaseClient: world(), governedMediaSigner: signer, now: '2026-10-26T00:00:00Z' });
    // Everything the customer's page needs, from the database alone:
    assert.equal(journey.sections.progress.availability, 'composed');
    assert.equal(journey.sections.progress.totals.reported_rows, 1);
    assert.equal(journey.contacts.parties.availability, 'composed');
    assert.equal(journey.sections.document_delivery.items[0].status_reported_text, 'Arrived at delivery address');
    assert.equal(journey.asset.specifications.availability, 'composed');
    assert.equal(journey.important_update.kind, 'document_dispatch');
    assert.equal(journey.sections.payments.recorded, 0);
    // …with the source named only as DATA, in attribution.
    assert.equal(journey.sections.progress.sources[0].source_label, 'Partner portal');
  } finally {
    globalThis.fetch = originals.fetch;
    http.request = originals.httpRequest; http.get = originals.httpGet; https.request = originals.httpsRequest; https.get = originals.httpsGet;
    net.connect = originals.connect; net.createConnection = originals.createConnection;
  }
});

test('X4: no secret of the programme is in the tracked tree — the capability token shape appears nowhere', () => {
  // The token is a long opaque string handed to the original portal's page. It is never written down here, so it is searched for by SHAPE:
  // a CAP address with a long path segment or an access token parameter, and any JWT-looking string, in files tracked for this branch.
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const scan = tracked.filter((f) => /\.(js|mjs|cjs|ts|tsx|json|md|yml|yaml|sql|html|txt|env)$/i.test(f) && !SKIP_DIR.test(f) && !/package-lock\.json$|\.d\.ts$/.test(f));
  assert.ok(scan.length > 1000, `the scan covered only ${scan.length} files`);
  const shapes = [/https?:\/\/[^\s'"`)]+\/cap\/[A-Za-z0-9_-]{24,}/, /[?&]access_?token=[A-Za-z0-9_-]{20,}/i, /beforward\.jp\/[^\s'"`)]*[?&]token=/i];
  const hits = [];
  for (const rel of scan) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    if (text.length > 4_000_000) continue;
    for (const re of shapes) if (re.test(text)) hits.push(`${rel}: ${re}`);
  }
  assert.deepEqual(hits, [], `a capability address or token shape is in the tracked tree: ${hits.join('; ')}`);
});
