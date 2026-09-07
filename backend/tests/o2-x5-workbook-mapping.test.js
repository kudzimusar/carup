/**
 * O2-X5 — dealer workbook migration: advisory mapping, human confirmation, the engine stays
 * the truth gate.
 *
 * Held here:
 *   · deterministic aliases resolve WITHOUT AI (the AI double proves the negative);
 *   · AI proposals cover only leftovers, HEADERS ONLY (no row values in the prompt), are
 *     validated against the template's own allowlist, and remain proposals until a human
 *     confirms — the mapper has no path to execute anything;
 *   · arbitrary client target columns are refused by name;
 *   · a confirmation binds to the exact workbook bytes: different bytes ⇒ different checksum
 *     ⇒ MAPPING_CONFIRMATION_REQUIRED, never silent reuse;
 *   · the dry-run route feeds the UNCHANGED runAndPersistDiasporaWorkbookDryRun and the
 *     engine's own blockers still refuse imported authority outcomes (a workbook saying
 *     VERIFIED cannot make anything verified);
 *   · direct import stays refused (source pin on the sync service's guard).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

process.env.NODE_ENV = 'test';
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

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

// ── deterministic vs AI ────────────────────────────────────────────────────────────────

test('X5: deterministic aliases resolve without AI — the AI double is only consulted for leftovers, headers only', async () => {
  const aiCalls = [];
  const ai = async (system, user) => {
    aiCalls.push(user);
    return JSON.stringify({ mappings: [{ source: 'Weird Col', target: 'NOTES', confidence: 0.7 }] });
  };

  const result = await proposeSemanticMapping({
    headers: ['Reg_No', 'Chassis', 'Cust Tel', 'Weird Col', 'Untranslatable'],
    templateType: 'buyer',
    sheetName: 'DIASPORA_IMPORT_ORDERS',
  }, { ai });

  const bySource = Object.fromEntries(result.proposals.map((p) => [p.source, p]));
  assert.equal(bySource.Reg_No.proposed_target, 'VIN');
  assert.equal(bySource.Reg_No.provider, 'deterministic');
  assert.equal(bySource.Chassis.proposed_target, 'CHASSIS_NUMBER');
  // 'Cust Tel' aliases to RECEIVER_PHONE, which is NOT a column on this sheet — so the alias
  // correctly does NOT fire and the header goes to the AI leg like any other leftover.
  assert.notEqual(bySource['Cust Tel'].provider, 'deterministic');
  assert.equal(bySource['Weird Col'].provider, 'ai');
  assert.equal(bySource['Weird Col'].proposed_target, 'NOTES');
  assert.equal(bySource.Untranslatable.proposed_target, null, 'ambiguity stays PROPOSED-null until a human decides');
  assert.equal(bySource.Untranslatable.provider, 'unmapped');

  assert.equal(aiCalls.length, 1, 'one AI call, leftovers only');
  assert.doesNotMatch(aiCalls[0], /Reg_No|Chassis\b/, 'deterministically-resolved headers never reach the AI');
  assert.doesNotMatch(aiCalls[0], /\+263|@|Toyota/, 'headers only — no row values, no PII, ever');
});

test('X5: AI answers outside the allowlist are dropped, and AI failure degrades to unmapped — never to a guess', async () => {
  const evilAi = async () => JSON.stringify({ mappings: [{ source: 'X1', target: 'users.password_hash', confidence: 0.99 }] });
  const evil = await proposeSemanticMapping({ headers: ['X1'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }, { ai: evilAi });
  assert.equal(evil.proposals[0].proposed_target, null, 'a non-allowlisted AI target is discarded');

  const brokenAi = async () => { throw new Error('provider down'); };
  const broken = await proposeSemanticMapping({ headers: ['X1'], templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS' }, { ai: brokenAi });
  assert.equal(broken.proposals[0].provider, 'unmapped');
});

// ── confirmation: allowlist + checksum binding ─────────────────────────────────────────

function mockClient(state) {
  return {
    from(table) {
      const st = { op: 'select', filters: {}, payload: null, single: false };
      const chain = {
        select() { return chain; },
        insert(p) { st.op = 'insert'; st.payload = p; return chain; },
        eq(k, v) { st.filters[k] = v; return chain; },
        single() { st.single = true; return chain; },
        maybeSingle() { st.single = true; return chain; },
        then(res, rej) {
          try {
            const rows = (state[table] = state[table] || []);
            if (st.op === 'insert') {
              const row = { id: `${table}-${rows.length + 1}`, seq: rows.length + 1, ...st.payload };
              rows.push(row);
              return Promise.resolve({ data: st.single ? row : [row], error: null }).then(res, rej);
            }
            const out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
            if (st.single) return Promise.resolve(out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } }).then(res, rej);
            return Promise.resolve({ data: out, error: null }).then(res, rej);
          } catch (e) { return rej ? rej(e) : Promise.reject(e); }
        },
      };
      return chain;
    },
  };
}

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const ACTOR = Object.freeze({ id: 'dealer-app-1', role: 'owner' });

test('X5: confirmation validates targets against the template allowlist and binds to the workbook checksum', async () => {
  const state = { trust_audit_events: [] };
  const client = mockClient(state);

  await assert.rejects(
    () => confirmSemanticMapping(client, ACTOR, {
      dealerId: 'dealer-1', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
      workbookChecksum: CHECKSUM_A,
      mappings: [{ source: 'Reg_No', target: 'arbitrary_db_column' }],
    }),
    /not an allowlisted canonical column/,
  );

  const confirmation = await confirmSemanticMapping(client, ACTOR, {
    dealerId: 'dealer-1', templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
    workbookChecksum: CHECKSUM_A,
    mappings: [
      { source: 'Reg_No', target: 'VIN' },
      { source: 'Notes col', target: 'NOTES' },
      { source: 'Junk', target: 'ignore' },
    ],
  });
  assert.equal(confirmation.workbook_checksum, CHECKSUM_A);
  assert.equal(confirmation.mapping_version, 'dealer_workbook_mapping.v1');

  const live = await requireLiveMappingConfirmation(client, {
    userId: 'dealer-app-1', workbookChecksum: CHECKSUM_A, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
  });
  assert.equal(live.id, confirmation.id);

  // Different bytes ⇒ different checksum ⇒ the old confirmation is stale by construction.
  await assert.rejects(
    () => requireLiveMappingConfirmation(client, {
      userId: 'dealer-app-1', workbookChecksum: CHECKSUM_B, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
    }),
    /MAPPING_CONFIRMATION_REQUIRED/,
  );
  // Another user cannot ride this user's confirmation either.
  await assert.rejects(
    () => requireLiveMappingConfirmation(client, {
      userId: 'someone-else', workbookChecksum: CHECKSUM_A, templateType: 'buyer', sheetName: 'DIASPORA_IMPORT_ORDERS',
    }),
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
});

// ── the engine remains the truth gate ──────────────────────────────────────────────────

test('X5: the engine blockers still refuse imported authority outcomes on mapped dealer rows', () => {
  const canonical = canonicalColumnsFor('buyer', 'DIASPORA_IMPORT_ORDERS');
  assert.ok(canonical.includes('VERIFICATION_STATUS'));

  // A dealer workbook that says "VERIFIED" cannot make anything verified: the EXISTING
  // classifier turns it into a blocked action, exactly as it always has.
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
  assert.doesNotMatch(
    mapper,
    /from '[^']*(diasporaWorkbookSync|ImportExecution|ConfirmedImport|Persistence)/,
    'the mapping service imports no import-execution path at all',
  );
});

// ── the migration runs on real PostgreSQL ──────────────────────────────────────────────

test('X5: the onboarding-extensions migration executes on real PostgreSQL (additive columns + confirmation table)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const up = (path) => {
    const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
    const down = raw.indexOf('-- +migrate Down');
    return (down >= 0 ? raw.slice(0, down) : raw)
      .replace('-- +migrate Up', '')
      .replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
  };
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    CREATE TABLE users (id text PRIMARY KEY, role text);
    INSERT INTO users(id,role) VALUES ('dealer-app-1','owner');
  `);
  // The dealer migration's append-only trigger uses the governance foundation's function; the
  // harness supplies the same-behaviour stub rather than loading that whole earlier migration.
  await db.exec(`
    CREATE OR REPLACE FUNCTION governance_block_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'append-only'; END; $$ LANGUAGE plpgsql;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid $$ LANGUAGE sql;
  `);
  await db.exec(up('../../database/migrations/20260626150000_dealer_compliance.sql'));
  await db.exec(up('../../database/migrations/20260903220000_dealer_onboarding_extensions.sql'));

  const { rows: [profile] } = await db.query(
    "INSERT INTO dealer_profiles (user_id, legal_name) VALUES ('dealer-app-1','Moyo Motors') RETURNING id",
  );
  await db.query(
    `INSERT INTO dealer_compliance_documents (dealer_id, doc_type, extraction_candidates, extraction_provider, extraction_confidence, extracted_at)
     VALUES ($1,'company_registration','{"legal_name":{"state":"machine_candidate","value":"Moyo Motors"}}'::jsonb,'test-ocr',0.9,now())`,
    [profile.id],
  );
  await db.query(
    `INSERT INTO dealer_workbook_mapping_confirmations (user_id, dealer_id, template_type, sheet_name, workbook_checksum, mapping, mapping_version)
     VALUES ('dealer-app-1',$1,'buyer','DIASPORA_IMPORT_ORDERS','${'a'.repeat(64)}','[{"source":"Reg_No","target":"VIN"}]'::jsonb,'dealer_workbook_mapping.v1')`,
    [profile.id],
  );
  const { rows } = await db.query('SELECT mapping_version, workbook_checksum FROM dealer_workbook_mapping_confirmations');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mapping_version, 'dealer_workbook_mapping.v1');
  await db.close();
});
