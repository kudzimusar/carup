/**
 * O2-X5 — dealer workbook migration: advisory mapping, human confirmation, the engine stays the truth
 * gate (ported by OC-5C from PR #208).
 *
 * Held here:
 *   · deterministic aliases resolve WITHOUT AI (the gateway double proves the negative);
 *   · AI proposals cover only leftovers, HEADERS ONLY (no row values in the prompt), go through the
 *     governed advisory adapter (an answer the gateway did not mark executed is no answer), are
 *     validated against the template's own allowlist, carry their provider/model, and remain proposals
 *     until a human confirms — the mapper has no path to execute anything;
 *   · arbitrary client target columns are refused by name;
 *   · a confirmation binds to the exact workbook bytes: different bytes ⇒ different checksum ⇒
 *     MAPPING_CONFIRMATION_REQUIRED, never silent reuse;
 *   · through the shipped app: inspect → confirm → dry run feeds the UNCHANGED engine entry, and a
 *     dry run without a live confirmation is refused;
 *   · the engine's own blockers still refuse imported authority outcomes (a workbook saying VERIFIED
 *     cannot make anything verified); direct import stays refused (source pins);
 *   · the migration runs on real PostgreSQL (PGlite): Up, re-run, Down, Up; RESTRICT references.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const {
  normalizeHeader,
  canonicalColumnsFor,
  proposeSemanticMapping,
  confirmSemanticMapping,
  requireLiveMappingConfirmation,
  applyConfirmedMapping,
  parseRawWorkbookHeaders,
  parseRawWorkbookRows,
} = await import('../services/dealer/workbookSemanticMappingService.js');
const { classifyWorkbookImportRow } = await import('../services/diaspora/diasporaWorkbookImportPlanningService.js');
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
/** A gateway double answering like the canonical one: an executed, advisory machine output. */
function gatewayAnswering(value, calls = []) {
  return {
    generateJson: async (request) => {
      calls.push(request);
      return { ok: true, value, machine_output: true, authority: 'advisory', provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' }, usage: null };
    },
  };
}

// ── deterministic vs AI ────────────────────────────────────────────────────────────────

test('X5: deterministic aliases resolve without AI — the gateway is consulted once, for leftovers, headers only', async () => {
  const calls = [];
  const result = await proposeSemanticMapping({
    headers: ['Reg_No', 'Chassis', 'Cust Tel', 'Weird Col', 'Untranslatable'],
    templateType: 'buyer',
    sheetName: 'DIASPORA_IMPORT_ORDERS',
  }, { gateway: gatewayAnswering({ mappings: [{ source: 'Weird Col', target: 'NOTES', confidence: 0.7 }] }, calls) });

  const bySource = Object.fromEntries(result.proposals.map((p) => [p.source, p]));
  assert.equal(bySource.Reg_No.proposed_target, 'VIN');
  assert.equal(bySource.Reg_No.provider, 'deterministic');
  assert.equal(bySource.Chassis.proposed_target, 'CHASSIS_NUMBER');
  // 'Cust Tel' aliases to RECEIVER_PHONE, which is NOT a column on this sheet — so the alias correctly
  // does NOT fire and the header goes to the AI leg like any other leftover.
  assert.notEqual(bySource['Cust Tel'].provider, 'deterministic');
  assert.deepEqual([bySource['Weird Col'].provider, bySource['Weird Col'].proposed_target, bySource['Weird Col'].model], ['ai', 'NOTES', GEMMA],
    'an AI proposal names the model that made it');
  assert.equal(bySource.Untranslatable.proposed_target, null, 'ambiguity stays PROPOSED-null until a human decides');
  assert.equal(bySource.Untranslatable.provider, 'unmapped');
  assert.deepEqual({ ...result.ai }, { state: 'provider_executed', provider: 'cloudflare', model: GEMMA });

  assert.equal(calls.length, 1, 'one AI call, leftovers only');
  assert.doesNotMatch(calls[0].userPrompt, /Reg_No|Chassis\b/, 'deterministically-resolved headers never reach the AI');
  assert.doesNotMatch(calls[0].userPrompt, /\+263|@|Toyota/, 'headers only — no row values, no PII, ever');
});

test('X5: nothing to ask — when every header resolves deterministically, no AI call is made at all', async () => {
  const calls = [];
  const result = await proposeSemanticMapping({ headers: ['VIN', 'Notes'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' },
    { gateway: gatewayAnswering({ mappings: [] }, calls) });
  assert.equal(calls.length, 0);
  assert.deepEqual({ ...result.ai }, { state: 'not_needed' });
});

test('X5: AI answers outside the allowlist are dropped, and AI failure degrades to unmapped WITH its reason — never to a guess', async () => {
  const evil = await proposeSemanticMapping({ headers: ['X1'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' },
    { gateway: gatewayAnswering({ mappings: [{ source: 'X1', target: 'users.password_hash', confidence: 0.99 }] }) });
  assert.equal(evil.proposals[0].proposed_target, null, 'a non-allowlisted AI target is discarded');
  assert.equal(evil.proposals[0].provider, 'unmapped');

  const down = { generateJson: async () => ({ ok: false, error: { code: 'AI_PROVIDER_TIMEOUT', message: 'timed out', retryable: true }, provenance: { provider: 'cloudflare', model: GEMMA } }) };
  const broken = await proposeSemanticMapping({ headers: ['X1'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }, { gateway: down });
  assert.equal(broken.proposals[0].provider, 'unmapped');
  assert.equal(broken.proposals[0].reason, 'ai_unavailable:AI_PROVIDER_TIMEOUT');
  assert.equal(broken.ai.state, 'unavailable');

  // An answer the gateway did not mark as an executed advisory output is not an answer.
  const notExecuted = { generateJson: async () => ({ ok: true, value: { mappings: [{ source: 'X1', target: 'NOTES' }] }, machine_output: true, authority: 'advisory', provenance: { provider: 'cloudflare', model: GEMMA, execution: 'simulated' } }) };
  const simulated = await proposeSemanticMapping({ headers: ['X1'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }, { gateway: notExecuted });
  assert.equal(simulated.proposals[0].proposed_target, null, 'a non-executed answer proposes nothing');
  assert.equal(simulated.proposals[0].reason, 'ai_unavailable:AI_GATEWAY_CONTRACT_VIOLATION');
});

test('X5: the mapper reaches AI only through the governed adapter — no direct vendor client (source pin)', () => {
  const mapper = readFileSync(new URL('../services/dealer/workbookSemanticMappingService.js', import.meta.url), 'utf8');
  const code = mapper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /from '\.\.\/ai\/domainAdvisoryAdapter\.js'/);
  assert.doesNotMatch(code, /GeminiClient|askGemini|generativelanguage|api\.groq|openai/i);
});

// ── confirmation: allowlist + checksum binding ─────────────────────────────────────────

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const ACTOR = Object.freeze({ id: 'dealer-app-1', role: 'owner' });

test('X5: confirmation validates targets against the template allowlist and binds to the workbook checksum', async () => {
  const world = createSupabaseWorld({ dealer_workbook_mapping_confirmations: [], trust_audit_events: [] });
  const client = world.client;
  await assert.rejects(
    () => confirmSemanticMapping(client, ACTOR, {
      dealerId: 'dealer-1', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS', workbookChecksum: CHECKSUM_A,
      mappings: [{ source: 'Reg_No', target: 'arbitrary_db_column' }],
    }),
    /not an allowlisted canonical column/,
  );
  await assert.rejects(
    () => confirmSemanticMapping(client, ACTOR, {
      dealerId: 'dealer-1', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS', workbookChecksum: CHECKSUM_A,
      mappings: [{ source: 'Junk', target: 'ignore' }],
    }),
    /Map at least one column/,
  );

  const confirmation = await confirmSemanticMapping(client, ACTOR, {
    dealerId: 'dealer-1', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS', workbookChecksum: CHECKSUM_A,
    mappings: [
      { source: 'Reg_No', target: 'VIN' },
      { source: 'Notes col', target: 'NOTES' },
      { source: 'Junk', target: 'ignore' },
    ],
  });
  assert.equal(confirmation.workbook_checksum, CHECKSUM_A);
  assert.equal(confirmation.mapping_version, 'dealer_workbook_mapping.v1');
  assert.equal(confirmation.audit_recorded, true);

  const live = await requireLiveMappingConfirmation(client, {
    userId: 'dealer-app-1', workbookChecksum: CHECKSUM_A, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
  });
  assert.equal(live.id, confirmation.id);

  // Different bytes ⇒ different checksum ⇒ the old confirmation is stale by construction.
  await assert.rejects(
    () => requireLiveMappingConfirmation(client, { userId: 'dealer-app-1', workbookChecksum: CHECKSUM_B, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }),
    /MAPPING_CONFIRMATION_REQUIRED/,
  );
  // Another user cannot ride this user's confirmation either.
  await assert.rejects(
    () => requireLiveMappingConfirmation(client, { userId: 'someone-else', workbookChecksum: CHECKSUM_A, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }),
    /MAPPING_CONFIRMATION_REQUIRED/,
  );
});

test('X5: applying a confirmed mapping renames mapped columns and drops ignored/unmapped ones', () => {
  const rows = [
    { Reg_No: 'AEX1234', 'Cust Tel': '+263771234567', Junk: 'x' },
    { Junk: 'only-junk' },
  ];
  const mapped = applyConfirmedMapping(rows, {
    mapping: [
      { source: 'Reg_No', target: 'VIN' },
      { source: 'Cust Tel', target: 'RECEIVER_PHONE' },
      { source: 'Junk', target: 'ignore' },
    ],
  });
  assert.deepEqual(mapped, [{ VIN: 'AEX1234', RECEIVER_PHONE: '+263771234567' }],
    'rows left with nothing mapped are dropped, not smuggled through');
});

// ── raw parsing ────────────────────────────────────────────────────────────────────────

async function xlsxBuffer(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(headers.map((h) => r[h] ?? null)));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('X5: raw parsing reads arbitrary headers + rows for mapping — nothing template-locked at inspect time', async () => {
  const buffer = await xlsxBuffer(['Reg_No', 'Cust Tel'], [
    { Reg_No: 'AEX1234', 'Cust Tel': '0771 234 567' },
    { Reg_No: 'AEX9999' },
  ]);
  const headers = await parseRawWorkbookHeaders(buffer);
  assert.deepEqual(headers.headers, ['Reg_No', 'Cust Tel']);
  assert.equal(headers.rowCount, 2);
  const rows = await parseRawWorkbookRows(buffer);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Reg_No, 'AEX1234');
  assert.equal(normalizeHeader('Cust Tel'), 'cust_tel');
  await assert.rejects(() => parseRawWorkbookHeaders(Buffer.from('not a workbook')), /could not be read as an \.xlsx/);
  await assert.rejects(async () => parseRawWorkbookHeaders(await xlsxBuffer(['A', 'A'], [])), /share the same header/);
});

// ── the shipped app: inspect → confirm → dry run ──────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
let world; let restoreWorld; let server; let baseUrl; let supabase; let realFetch;
before(async () => {
  ({ supabase } = await import('../db/supabase.js'));
  const { app } = await import('../server.js');
  realFetch = globalThis.fetch;
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [{ id: 'dealer-app-1', role: 'owner', name: 'D', email: 'd@example.invalid' }, { id: 'individual-1', role: 'owner', name: 'I', email: 'i@example.invalid' }],
    user_sessions: [
      { token: 't-dealer', user_id: 'dealer-app-1', is_valid: true, expires_at: FUTURE },
      { token: 't-individual', user_id: 'individual-1', is_valid: true, expires_at: FUTURE },
    ],
    user_registration_profiles: [
      { user_id: 'dealer-app-1', account_kind: 'business', business_type: 'dealer', organization_name: 'Moyo Motors', onboarding_status: 'requested' },
      { user_id: 'individual-1', account_kind: 'individual', business_type: null, onboarding_status: 'not_required' },
    ],
    dealer_profiles: [{ id: '0f6c1b2e-1111-4a2b-8c3d-000000000001', user_id: 'dealer-app-1', legal_name: 'Moyo Motors' }],
    dealer_workbook_mapping_confirmations: [],
    trust_audit_events: [],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
});

async function call(path, { as = 't-dealer', body } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(as ? { 'x-session-token': as } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

test('X5 routes: inspect proposes (no AI needed for known headers), confirm binds the checksum, and a dry run needs THAT confirmation', async () => {
  const workbook = await xlsxBuffer(['VIN', 'Notes'], [{ VIN: 'JTMHY7AJ2K4012399', Notes: 'Stock 12' }]);
  const fileBase64 = workbook.toString('base64');
  const common = { fileBase64, filename: 'stock.xlsx', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' };

  const notDealer = await call('/api/dealer-onboarding/workbook/inspect', { as: 't-individual', body: common });
  assert.equal(notDealer.status, 403);
  const unauthenticated = await call('/api/dealer-onboarding/workbook/inspect', { as: null, body: common });
  assert.equal(unauthenticated.status, 401);

  const inspected = await call('/api/dealer-onboarding/workbook/inspect', { body: common });
  assert.equal(inspected.status, 200, inspected.text.slice(0, 300));
  assert.match(inspected.body.checksum, /^[0-9a-f]{64}$/);
  assert.deepEqual(inspected.body.proposals.map((p) => [p.source, p.proposed_target, p.provider]), [['VIN', 'VIN', 'deterministic'], ['Notes', 'NOTES', 'deterministic']]);
  assert.equal(inspected.body.ai.state, 'not_needed');

  const noConfirmation = await call('/api/dealer-onboarding/workbook/dry-run', { body: common });
  assert.equal(noConfirmation.status, 404);
  assert.match(noConfirmation.text, /MAPPING_CONFIRMATION_REQUIRED/);

  const confirmed = await call('/api/dealer-onboarding/workbook/mapping/confirm', {
    body: { template_type: 'buyer', sheet_name: 'DIASPORA_IMPORT_ORDERS', workbook_checksum: inspected.body.checksum, mappings: [{ source: 'VIN', target: 'VIN' }, { source: 'Notes', target: 'NOTES' }] },
  });
  assert.equal(confirmed.status, 201, confirmed.text.slice(0, 300));
  assert.equal(world.rows('dealer_workbook_mapping_confirmations').length, 1);
  assert.ok(world.rows('trust_audit_events').some((e) => e.event_type === 'DEALER_WORKBOOK_MAPPING_CONFIRMED'));

  // Edited bytes are a different workbook: the confirmation does not carry over.
  const edited = (await xlsxBuffer(['VIN', 'Notes'], [{ VIN: 'JTMHY7AJ2K4012399', Notes: 'Stock 13' }])).toString('base64');
  const stale = await call('/api/dealer-onboarding/workbook/dry-run', { body: { ...common, fileBase64: edited } });
  assert.equal(stale.status, 404);
  assert.match(stale.text, /MAPPING_CONFIRMATION_REQUIRED/);

  // The confirmed bytes reach the EXISTING engine, whose own validation answers.
  const dryRun = await call('/api/dealer-onboarding/workbook/dry-run', { body: common });
  assert.notEqual(dryRun.status, 404, 'the confirmation was found');
  assert.ok(dryRun.status === 200 || dryRun.status === 400 || dryRun.status === 403, `the engine answered: ${dryRun.status} ${dryRun.text.slice(0, 200)}`);
  if (dryRun.status === 200) assert.equal(dryRun.body.mapping_confirmation_id, confirmed.body.confirmation.id);
});

test('X5 routes: the spreadsheet allowlist answers BEFORE a byte is parsed — even genuine workbook bytes named .xlsm are refused', async () => {
  const genuine = (await xlsxBuffer(['VIN'], [{ VIN: 'JTMHY7AJ2K4012399' }])).toString('base64');
  const macro = await call('/api/dealer-onboarding/workbook/inspect', { body: { fileBase64: genuine, filename: 'stock.xlsm', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' } });
  assert.equal(macro.status, 400, macro.text.slice(0, 200));
  assert.match(macro.text, /Only \.xlsx workbooks are accepted/);
  const csv = await call('/api/dealer-onboarding/workbook/inspect', { body: { fileBase64: Buffer.from('a,b\n1,2').toString('base64'), filename: 'stock.csv', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' } });
  assert.equal(csv.status, 400);
});

test('X5 routes: every workbook route needs a real session — the x-user-id fallback spends no AI and confirms nothing', async () => {
  process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
  try {
    const body = { fileBase64: (await xlsxBuffer(['VIN'], [])).toString('base64'), filename: 'a.xlsx', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' };
    for (const path of ['/api/dealer-onboarding/workbook/inspect', '/api/dealer-onboarding/workbook/mapping/confirm', '/api/dealer-onboarding/workbook/dry-run']) {
      const res = await realFetch(`${baseUrl}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', 'x-user-id': 'dealer-app-1' }, body: JSON.stringify(body),
      });
      assert.equal(res.status, 401, path);
    }
    // …while the fallback itself is live for a read (so the refusal above is the session requirement).
    const read = await realFetch(`${baseUrl}/api/dealer-onboarding/overview`, { headers: { 'x-bypass-rate-limit': 'true', 'x-user-id': 'dealer-app-1' } });
    assert.notEqual(read.status, 401);
  } finally {
    delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  }
});

// ── the engine remains the truth gate ──────────────────────────────────────────────────

test('X5: the engine blockers still refuse imported authority outcomes on mapped dealer rows', () => {
  const canonical = canonicalColumnsFor('buyer', 'DIASPORA_IMPORT_ORDERS');
  assert.ok(canonical.includes('VERIFICATION_STATUS'));
  const row = {
    sheetName: 'DIASPORA_IMPORT_ORDERS',
    payload: {
      IMPORT_ORDER_ID: 'ORD-1', BUYER_TRADE_PROFILE_ID: 'TP-1', ORDER_TYPE: 'vehicle',
      ORIGIN_COUNTRY: 'JP', DESTINATION_COUNTRY: 'ZW', STATUS: 'draft', BUDGET_CURRENCY: 'USD',
      VERIFICATION_STATUS: 'VERIFIED',
    },
    validationStatus: 'valid',
  };
  const classified = classifyWorkbookImportRow(row, {}, { id: 'dealer-app-1' });
  const asText = JSON.stringify(classified);
  assert.match(asText, /block/i, 'the governed-outcome guard fired');
  assert.doesNotMatch(asText, /"actionType":"import_verified"/);
});

test('X5: direct import stays refused and the dry-run entry is the one the dealer route feeds (source pins)', () => {
  const sync = readFileSync(new URL('../services/diaspora/diasporaWorkbookSyncService.js', import.meta.url), 'utf8');
  assert.match(sync, /Direct workbook import is not permitted/, 'the engine refusal is byte-stable');

  const route = readFileSync(new URL('../routes/dealerOnboardingRoutes.js', import.meta.url), 'utf8');
  assert.match(route, /runAndPersistDiasporaWorkbookDryRun\(payload, req\.userContext/, 'the dealer lane feeds the EXISTING entry');
  assert.match(route, /requireLiveMappingConfirmation/, 'no dry run without a live checksum-bound mapping confirmation');
  assert.doesNotMatch(route, /importDiasporaWorkbook|executeConfirmed/, 'the mapper cannot execute imports');

  const mapper = readFileSync(new URL('../services/dealer/workbookSemanticMappingService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mapper, /from '[^']*(diasporaWorkbookSync|ImportExecution|ConfirmedImport|Persistence)/,
    'the mapping service imports no import-execution path at all');
});

// ── the migration on real PostgreSQL ───────────────────────────────────────────────────

const MIGRATION = '../../database/migrations/20261004173000_o2_x5_dealer_workbook_mapping_confirmations.sql';
function sections(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const [upPart, downPart] = raw.split(/^-- \+migrate Down/m);
  const strip = (sql) => sql.replace('-- +migrate Up', '').replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
  return { up: strip(upPart), down: downPart };
}

async function dealerDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    CREATE TABLE users (id text PRIMARY KEY, role text);
    INSERT INTO users(id,role) VALUES ('dealer-app-1','owner');
    CREATE OR REPLACE FUNCTION governance_block_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'append-only'; END; $$ LANGUAGE plpgsql;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid $$ LANGUAGE sql;
  `);
  await db.exec(sections('../../database/migrations/20260626150000_dealer_compliance.sql').up);
  return db;
}

test('X5 migration: Up creates the RLS-forced confirmation table; re-run is idempotent; Down removes it; Up again', async () => {
  const db = await dealerDb();
  try {
    const { up, down } = sections(MIGRATION);
    await db.exec(up);
    await db.exec(up);
    const { rows: [profile] } = await db.query("INSERT INTO dealer_profiles (user_id, legal_name) VALUES ('dealer-app-1','Moyo Motors') RETURNING id");
    await db.query(
      `INSERT INTO dealer_workbook_mapping_confirmations (user_id, dealer_id, template_type, sheet_name, workbook_checksum, mapping, mapping_version)
       VALUES ('dealer-app-1',$1,'buyer','DIASPORA_IMPORT_ORDERS','${'a'.repeat(64)}','[{"source":"Reg_No","target":"VIN"}]'::jsonb,'dealer_workbook_mapping.v1')`,
      [profile.id],
    );
    const { rows: [rls] } = await db.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'dealer_workbook_mapping_confirmations'");
    assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, true]);

    await assert.rejects(() => db.query(
      `INSERT INTO dealer_workbook_mapping_confirmations (user_id, dealer_id, template_type, sheet_name, workbook_checksum, mapping, mapping_version)
       VALUES ('dealer-app-1',$1,'buyer','S','not-a-checksum','[]'::jsonb,'v')`, [profile.id]), /check/i, 'a checksum must be a sha-256');
    await assert.rejects(() => db.query("DELETE FROM users WHERE id = 'dealer-app-1'"), /foreign key|violates/i,
      'RESTRICT: deleting the person does not erase what they confirmed');

    await db.exec(down);
    const { rows: gone } = await db.query("SELECT to_regclass('public.dealer_workbook_mapping_confirmations') AS t");
    assert.equal(gone[0].t, null);
    await db.exec(up);
    const { rows: back } = await db.query("SELECT to_regclass('public.dealer_workbook_mapping_confirmations') AS t");
    assert.equal(back[0].t, 'dealer_workbook_mapping_confirmations');
  } finally {
    await db.close();
  }
});
