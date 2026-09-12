#!/usr/bin/env node
/**
 * O2 post-Ready review closure — workbook receipt identity and target-link check (C4/C5/C7).
 *
 * These three findings are DATABASE facts, so they are proven against real PostgreSQL (PGlite)
 * running the authoritative migration DDL — not against a mock that happens to accept anything.
 * The in-memory client the X5A suite uses enforces no index and no column type, which is exactly
 * why all three survived a green suite.
 *
 * Proven here, in order:
 *   1. uq_diaspora_workbook_receipt_row really is (batch_id, row_number, attempt) with NO
 *      sheet_name, so a vehicle receipt and an evidence receipt for the same row collide.  [C4]
 *   2. Re-running a PARTIALLY_IMPORTED batch at attempt 1 collides with its own first pass. [C5]
 *   3. diaspora_workbook_import_rows.target_record_id really is uuid, so a VIN cannot be
 *      written into it.                                                                    [C7]
 * and then that the chosen fix model (one receipt per row per attempt; attempt = max+1;
 * never a VIN in a uuid column) satisfies the same schema.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const results = [];
function ok(name, condition, detail = '') {
  const pass = Boolean(condition);
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${!pass && detail ? ` — ${detail}` : ''}`);
}

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const phase1b = read('../migrations/20260611061849_diaspora_trade_os_phase1b_foundation.sql');
const gtm = read('../migrations/20260727120000_diaspora_gtm_activation_foundation.sql');
const loosening = read('../migrations/20260904090000_workbook_store_scope_loosening.sql');

function extractCreateTable(sql, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${escaped} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!m) throw new Error(`Could not extract DDL for ${table}`);
  return `CREATE TABLE ${table} (${m[1]}\n);`;
}
function extractIndex(sql, name) {
  const m = new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}[\\s\\S]*?;`).exec(sql);
  if (!m) throw new Error(`Could not extract index ${name}`);
  return m[0].replace(/public\./g, '');
}

const db = new PGlite();
// gen_random_uuid() is core since PostgreSQL 13; pgcrypto is neither needed nor available here.

// Batches first (rows reference it), then rows and receipts, then the real unique index.
await db.exec(extractCreateTable(phase1b, 'diaspora_workbook_import_batches').replace(/REFERENCES[^,\n]*/g, ''));
await db.exec(extractCreateTable(phase1b, 'diaspora_workbook_import_rows'));
await db.exec(extractCreateTable(gtm, 'diaspora_workbook_import_receipts').replace(/REFERENCES[^,\n]*/g, ''));
await db.exec(extractIndex(gtm, 'uq_diaspora_workbook_receipt_row'));
// The X5A loosening is part of the authoritative schema: receipts.tenant_id is nullable.
const receiptsAlter = /ALTER TABLE public\.diaspora_workbook_import_receipts\s+ALTER COLUMN tenant_id DROP NOT NULL;/
  .exec(loosening);
if (!receiptsAlter) throw new Error('Could not find the X5A receipts tenant_id loosening in its migration');
await db.exec(receiptsAlter[0].replace('public.', ''));

// ── the index really is (batch_id, row_number, attempt) and excludes sheet_name ──────────
const idx = await db.query(`
  SELECT a.attname FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE c.relname = 'uq_diaspora_workbook_receipt_row' ORDER BY a.attname;`);
const cols = idx.rows.map((r) => r.attname).sort();
ok('C4/C5 premise — the unique index is exactly (attempt, batch_id, row_number)',
  JSON.stringify(cols) === JSON.stringify(['attempt', 'batch_id', 'row_number']), JSON.stringify(cols));
ok('C4 premise — sheet_name is NOT part of the unique key', !cols.includes('sheet_name'));

const batch = (await db.query(
  `INSERT INTO diaspora_workbook_import_batches (uploaded_by, template_type, idempotency_key)
   VALUES ('u_synthetic', 'dealer_vehicle_inventory', 'idem-1') RETURNING id;`)).rows[0].id;

async function insertReceipt({ rowNumber, sheet, attempt, entityType }) {
  return db.query(
    `INSERT INTO diaspora_workbook_import_receipts
       (tenant_id, batch_id, row_number, sheet_name, outcome, entity_type, attempt)
     VALUES (NULL, $1, $2, $3, 'accepted', $4, $5) RETURNING id;`,
    [batch, rowNumber, sheet, entityType, attempt]);
}

// ── C4 — vehicle receipt + evidence receipt, same row, same attempt ──────────────────────
await insertReceipt({ rowNumber: 1, sheet: 'EVIDENCE_NOTES', attempt: 1, entityType: 'vehicle_evidence' });
let c4 = null;
try { await insertReceipt({ rowNumber: 1, sheet: 'VEHICLES', attempt: 1, entityType: 'vehicle' }); }
catch (e) { c4 = e; }
ok('C4 REPRODUCED — an evidence receipt and its vehicle receipt collide on (batch,row,attempt)',
  c4 && /duplicate key|23505/i.test(`${c4.message}`), c4 ? c4.message : 'the second insert SUCCEEDED');

// ── C5 — a retry that writes attempt 1 again ────────────────────────────────────────────
let c5 = null;
try { await insertReceipt({ rowNumber: 2, sheet: 'VEHICLES', attempt: 1, entityType: 'vehicle' });
      await insertReceipt({ rowNumber: 2, sheet: 'VEHICLES', attempt: 1, entityType: 'vehicle' }); }
catch (e) { c5 = e; }
ok('C5 REPRODUCED — a PARTIALLY_IMPORTED retry at attempt 1 collides with its own first pass',
  c5 && /duplicate key|23505/i.test(`${c5.message}`), c5 ? c5.message : 'the retry insert SUCCEEDED');

// ── C7 — target_record_id is uuid; a VIN cannot go in it ────────────────────────────────
const targetType = (await db.query(
  `SELECT data_type FROM information_schema.columns
    WHERE table_name='diaspora_workbook_import_rows' AND column_name='target_record_id';`)).rows[0].data_type;
ok('C7 premise — diaspora_workbook_import_rows.target_record_id is uuid', targetType === 'uuid', targetType);

const importRow = (await db.query(
  `INSERT INTO diaspora_workbook_import_rows (batch_id, sheet_name, workbook_row_number, workbook_record_id, target_table)
   VALUES ($1,'VEHICLES',1,'JT123456789012345','vehicles') RETURNING id;`, [batch])).rows[0].id;
let c7 = null;
try { await db.query(`UPDATE diaspora_workbook_import_rows SET target_record_id = $1 WHERE id = $2;`,
  ['JT123456789012345', importRow]); }
catch (e) { c7 = e; }
ok('C7 REPRODUCED — writing a VIN into the uuid target_record_id is refused by PostgreSQL',
  c7 && /invalid input syntax for type uuid|22P02/i.test(`${c7.message}`),
  c7 ? c7.message : 'PostgreSQL ACCEPTED a VIN in a uuid column');

// ── the fix model satisfies the same schema ─────────────────────────────────────────────
const nextAttempt = async (rowNumber) => {
  const r = await db.query(
    `SELECT COALESCE(MAX(attempt),0)+1 AS next FROM diaspora_workbook_import_receipts
      WHERE batch_id=$1 AND row_number=$2;`, [batch, rowNumber]);
  return Number(r.rows[0].next);
};
let fixed = true; let fixedErr = '';
try {
  await insertReceipt({ rowNumber: 2, sheet: 'VEHICLES', attempt: await nextAttempt(2), entityType: 'vehicle' });
  await insertReceipt({ rowNumber: 2, sheet: 'VEHICLES', attempt: await nextAttempt(2), entityType: 'vehicle' });
} catch (e) { fixed = false; fixedErr = e.message; }
ok('FIX MODEL — one receipt per row per pass with attempt = max+1 replays cleanly', fixed, fixedErr);

let nullTarget = true; let nullErr = '';
try { await db.query(`UPDATE diaspora_workbook_import_rows SET target_record_id = NULL WHERE id = $1;`, [importRow]); }
catch (e) { nullTarget = false; nullErr = e.message; }
ok('FIX MODEL — a vehicle row links by its text VIN (workbook_record_id) and leaves the uuid null',
  nullTarget, nullErr);

const attempts = (await db.query(
  `SELECT attempt FROM diaspora_workbook_import_receipts WHERE batch_id=$1 AND row_number=2 ORDER BY attempt;`,
  [batch])).rows.map((r) => Number(r.attempt));
ok('FIX MODEL — every pass is retained, so the audit trail grows instead of being overwritten',
  JSON.stringify(attempts) === JSON.stringify([1, 2, 3]), JSON.stringify(attempts));

await db.close();
const failed = results.filter((r) => !r.pass);
console.log(`\nO2 workbook receipt identity check: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:', failed.map((f) => f.name).join(' · ')); process.exit(1); }
