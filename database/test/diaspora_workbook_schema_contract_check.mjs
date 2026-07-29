#!/usr/bin/env node
/**
 * Workbook schema-contract check.
 *
 * Executes the real table DDL from the authoritative migrations in PGlite, then validates the exact
 * owner predicates and compensation payload columns used by the backend services.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DB_EXPORT_OWNER_COLUMNS_BY_TABLE,
  buildDbExportOwnerPredicate,
} from '../../backend/services/diaspora/workbook/diasporaWorkbookDbExportService.js';
import {
  compensateConfirmedImportAction,
} from '../../backend/services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js';

const results = [];
function ok(name, condition, detail = '') {
  const pass = Boolean(condition);
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${!pass && detail ? ` — ${detail}` : ''}`);
}

const migration013 = readFileSync(
  fileURLToPath(new URL('../migrations/013_diaspora_trade_schema.sql', import.meta.url)),
  'utf8',
);
const phase1b = readFileSync(
  fileURLToPath(
    new URL('../migrations/20260611061849_diaspora_trade_os_phase1b_foundation.sql', import.meta.url),
  ),
  'utf8',
);

function extractCreateTable(sql, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `CREATE TABLE IF NOT EXISTS (?:public\\.)?${escaped} \\(([\\s\\S]*?)\\n\\);`,
  );
  const match = pattern.exec(sql);
  if (!match) throw new Error(`Could not extract DDL for ${table}`);
  return `CREATE TABLE ${table} (${match[1]}\n);`;
}

function predicateToSql(predicate) {
  return predicate
    .split(',')
    .map((clause) => {
      const [column, operator] = clause.split('.');
      if (operator !== 'eq') throw new Error(`Unsupported predicate clause: ${clause}`);
      return `${column} = $1`;
    })
    .join(' OR ');
}

const DDL_ORDER = [
  ['diaspora_import_orders', migration013],
  ['diaspora_trade_profiles', migration013],
  ['diaspora_import_quotes', migration013],
  ['diaspora_trade_documents', migration013],
  ['diaspora_container_shipments', migration013],
  ['diaspora_cargo_reservations', migration013],
  ['diaspora_shipments', migration013],
  ['diaspora_compliance_reviews', migration013],
  ['diaspora_payment_milestones', migration013],
  ['diaspora_reputation_records', migration013],
  ['diaspora_workbook_import_batches', phase1b],
  ['diaspora_ai_commands', phase1b],
];

const COMPENSATION_TARGETS = [
  'diaspora_import_orders',
  'diaspora_import_quotes',
  'diaspora_trade_documents',
  'diaspora_container_shipments',
  'diaspora_cargo_reservations',
  'diaspora_shipments',
  'diaspora_ai_commands',
];

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE tenants (id uuid PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE vehicles (vin text PRIMARY KEY);
      CREATE TABLE organizations (id text PRIMARY KEY);
      CREATE TABLE trade_document_types (code text PRIMARY KEY);
    `);

    for (const [table, sql] of DDL_ORDER) {
      await db.exec(extractCreateTable(sql, table));
    }

    console.log('\n── Export owner predicates execute against authoritative DDL ──');
    for (const table of Object.keys(DB_EXPORT_OWNER_COLUMNS_BY_TABLE)) {
      const predicate = buildDbExportOwnerPredicate(table, 'owner-1');
      try {
        await db.query(`SELECT id FROM ${table} WHERE ${predicateToSql(predicate)} LIMIT 1`, ['owner-1']);
        ok(`${table} predicate resolves only real columns`, true);
      } catch (error) {
        ok(`${table} predicate resolves only real columns`, false, error.message);
      }
    }

    let oldPredicateFailed = false;
    try {
      await db.query(
        `SELECT id FROM diaspora_import_quotes
          WHERE created_by = $1 OR user_id = $1 OR buyer_id = $1
          LIMIT 1`,
        ['owner-1'],
      );
    } catch (error) {
      oldPredicateFailed = /user_id|buyer_id/i.test(error.message)
        && /does not exist/i.test(error.message);
    }
    ok('negative control: the old three-column predicate still fails', oldPredicateFailed);

    console.log('\n── Actual compensation helper executes on every Phase 1F target ──');
    function schemaClient() {
      return {
        from(table) {
          return {
            update(payload) {
              return {
                eq(idColumn, idValue) {
                  return {
                    async is(nullColumn, nullValue) {
                      if (nullValue !== null) return { error: { message: 'expected a null guard' } };
                      const entries = Object.entries(payload);
                      const sets = entries.map(([column], index) => `${column} = $${index + 1}`);
                      const params = entries.map(([, value]) => value);
                      params.push(idValue);
                      try {
                        await db.query(
                          `UPDATE ${table}
                              SET ${sets.join(', ')}
                            WHERE ${idColumn} = $${params.length}
                              AND ${nullColumn} IS NULL`,
                          params,
                        );
                        return { error: null };
                      } catch (error) {
                        return { error: { message: error.message } };
                      }
                    },
                  };
                },
              };
            },
          };
        },
      };
    }

    const client = schemaClient();
    for (const table of COMPENSATION_TARGETS) {
      const outcome = await compensateConfirmedImportAction(
        client,
        { table, recordId: '00000000-0000-4000-8000-000000000001' },
        'user-1',
        '2026-07-29T10:00:00.000Z',
      );
      ok(
        `${table} accepts the actual shared-column compensation helper`,
        outcome.ok,
        outcome.reason || '',
      );
    }

    for (const table of [
      'diaspora_trade_documents',
      'diaspora_cargo_reservations',
      'diaspora_ai_commands',
    ]) {
      let oldStatusFailed = false;
      try {
        await db.query(`UPDATE ${table} SET status = 'CANCELLED' WHERE false`);
      } catch (error) {
        oldStatusFailed = /status/i.test(error.message) && /does not exist/i.test(error.message);
      }
      ok(`negative control: generic status update fails on ${table}`, oldStatusFailed);
    }
  } finally {
    await db.close();
  }

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${JSON.stringify({ total: results.length, failed: failed.length, ok: failed.length === 0 }, null, 2)}`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
