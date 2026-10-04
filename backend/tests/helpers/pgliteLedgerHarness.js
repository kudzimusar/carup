/**
 * OC-3D harness — CarUp's hash-chained audit ledger on a REAL PostgreSQL (PGlite, in process).
 *
 * The schema is the repository's own migration SQL, applied in order (Up sections only):
 *   supabase_schema.sql → 014 → 015 → 20260621120000 (evidence provenance) → 20260809100000 +
 *   20260810120000 (rolling checkpoints) → public_keys → the issue-158 chain (custody, activation
 *   boundary, terminal uniqueness, operation identity).
 * One deviation, stated: `public_keys` is created from the `CREATE TABLE public.public_keys` block of
 * 20260814080000_issue101_staging_parity.sql, verbatim — that file as a whole refuses to run without
 * eleven unrelated relations (it reproduces production-measured objects). 20260814085000 (public_keys
 * RLS hardening) is not applied: it needs signature_verification_logs and changes no ledger behaviour.
 *
 * `supabaseOver(db)` is a minimal supabase-js query builder over PGlite, covering exactly what the
 * ledger and provenance services use (select/count/eq/gt/order/limit/single/maybeSingle/insert/upsert/
 * update/delete). JSON/JSONB columns are written the way PostgREST writes them: a JS string becomes a
 * JSON string scalar, an object becomes a JSONB object — whose key order PostgreSQL then normalizes.
 * PGlite runs as its superuser (RLS bypassed, as the backend's service_role does).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { assertNotSqliteDialect } from '../../db/migrationParser.js';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../database/migrations');
export const CANDIDATES_DIR = path.resolve(here, '../../../database/migration-candidates/oc3d');

export const LEDGER_MIGRATION_CHAIN = Object.freeze([
  'supabase_schema.sql',
  '014_passport_evidence_architecture.sql',
  '015_vehicle_evidence_timeline.sql',
  '20260621120000_vehicle_life_evidence_taxonomy_provenance.sql',
  '20260809100000_trust_side_tables.sql',
  '20260810120000_trust_side_convergence.sql',
  '@public_keys',
  '20260828210000_issue158_private_key_custody.sql',
  '20260829003000_issue158_custody_rollout_upgrade.sql',
  '20260829020000_issue158_activation_boundary_hardening.sql',
  '20260829040000_issue158_terminal_event_uniqueness.sql',
  '20260830060000_issue158_terminal_operation_identity.sql',
]);

export const LEDGER_CANDIDATES = Object.freeze([
  '20261004130000_oc3d_ledger_append_only.sql',
  '20261004130100_oc3d_ledger_fork_guard_and_retention.sql',
]);

const upSection = (sql) => sql.split(/^-- \+migrate Down/m)[0];

/** The Up SQL of a migration file — refused for an enumerated SQLite-only file (OC-4A 1.5). */
export function migrationUpSql(file) {
  assertNotSqliteDialect(file);
  return upSection(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}
const downSection = (sql) => (sql.split(/^-- \+migrate Down/m)[1] || '');

function publicKeysDdl() {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, '20260814080000_issue101_staging_parity.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE public.public_keys (');
  const index = sql.indexOf('CREATE INDEX idx_public_keys_user', start);
  if (start < 0 || index < 0) throw new Error('public_keys DDL block not found in 20260814080000');
  return sql.slice(start, sql.indexOf(';', index) + 1);
}

/** A fresh PostgreSQL with the real ledger schema. `candidates: true` also applies the OC-3D candidates. */
export async function createLedgerDatabase({ candidates = false } = {}) {
  const db = new PGlite({
    extensions: { uuid_ossp, pgcrypto },
    // PostgREST returns bigint ids and timestamps as JSON numbers/strings, not BigInt/Date objects.
    parsers: { 20: (value) => Number(value), 1184: (value) => value, 1114: (value) => value },
  });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  `);
  for (const file of LEDGER_MIGRATION_CHAIN) {
    const sql = file === '@public_keys' ? publicKeysDdl() : migrationUpSql(file);
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`ledger harness: ${file} did not apply: ${error.message}`);
    }
  }
  if (candidates) await applyLedgerCandidates(db);
  return db;
}

export async function applyLedgerCandidates(db) {
  for (const file of LEDGER_CANDIDATES) {
    await db.exec(upSection(readFileSync(path.join(CANDIDATES_DIR, file), 'utf8')));
  }
}

export async function revertLedgerCandidates(db) {
  for (const file of [...LEDGER_CANDIDATES].reverse()) {
    await db.exec(downSection(readFileSync(path.join(CANDIDATES_DIR, file), 'utf8')));
  }
}

// ── OC-4A: the evidence histories that sit beside the ledger ─────────────────────────────────────
// partsentry_logs in its governed shape, ocr_documents, and trust_audit_events (the record every
// governed PartSentry change must write), each from its own migration — and the session-token contract
// (20260617120000), so HTTP tests authenticate against real session rows instead of a hand-written double. The stated deviations are
// verbatim blocks, because the files as a whole rebuild unrelated domains:
//   @vehicles_owner     010_phase5_schema.sql's `owner_id` DO block (vehicle object authority reads it)
//   @vehicles_seller    013's `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_seller_id` line
//   @tenants            the `CREATE TABLE IF NOT EXISTS tenants` block of 002_multi_tenant_and_auth_schema.sql
//   @tenant_users       002's `tenant_users` block (x-tenant-id membership, read by authorizeRole)
//   @vehicles_tenant    002's `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tenant_id …` line (tenant scope
//                       is read by the review workflow and by vehicle object authority)
//   @partsentry_tenant  002's `ALTER TABLE partsentry_logs ADD COLUMN IF NOT EXISTS tenant_id …` line
//                       (the real writer stamps tenant_id; the FK is ON DELETE CASCADE from tenants)
//   @ocr_documents      the ocr_documents block of 20260613000000 (table, index, RLS, grants)
export const OC4A_CANDIDATES_DIR = path.resolve(here, '../../../database/migration-candidates/oc4a');

export const EVIDENCE_HISTORY_MIGRATIONS = Object.freeze([
  '@tenants',
  '@tenant_users',
  '20260617120000_user_sessions_auth_contract_align.sql',
  '@vehicles_owner',
  '@vehicles_seller',
  '@vehicles_tenant',
  '@partsentry_tenant',
  '20260603233640_governance_foundation_trust_audit_events.sql',
  '20260710130000_partsentry_review_requests.sql',
  '@ocr_documents',
]);

export const EVIDENCE_HISTORY_CANDIDATES = Object.freeze([
  '20261004140000_oc4a_evidence_history_protection.sql',
]);

function verbatimBlock(file, startMarker, endMarker) {
  assertNotSqliteDialect(file);
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`evidence harness: block "${startMarker}" not found in ${file}`);
  return sql.slice(start, end + endMarker.length);
}

function evidenceHistorySql(item) {
  if (item === '@tenants') return verbatimBlock('002_multi_tenant_and_auth_schema.sql', 'CREATE TABLE IF NOT EXISTS tenants (', ');');
  if (item === '@tenant_users') return verbatimBlock('002_multi_tenant_and_auth_schema.sql', 'CREATE TABLE IF NOT EXISTS tenant_users (', ');');
  if (item === '@vehicles_owner') {
    return verbatimBlock('010_phase5_schema.sql', 'DO $$ \nBEGIN\n    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=\'vehicles\' AND column_name=\'owner_id\')', 'END $$;');
  }
  if (item === '@vehicles_seller') {
    return verbatimBlock('013_zimbabwe_plate_and_owner_privacy.sql', 'ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_seller_id', ';');
  }
  if (item === '@vehicles_tenant') {
    return verbatimBlock('002_multi_tenant_and_auth_schema.sql', 'ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tenant_id', ';');
  }
  if (item === '@partsentry_tenant') {
    return verbatimBlock('002_multi_tenant_and_auth_schema.sql', 'ALTER TABLE partsentry_logs ADD COLUMN IF NOT EXISTS tenant_id', ';');
  }
  if (item === '@ocr_documents') {
    return verbatimBlock('20260613000000_phase7b_supabase_auth_and_identity.sql', 'CREATE TABLE IF NOT EXISTS ocr_documents (',
      'GRANT ALL ON TABLE ocr_documents TO service_role;');
  }
  return migrationUpSql(item);
}

/** The ledger schema plus the OC-4A evidence histories. `candidates: true` also applies the OC-4A candidate. */
export async function createEvidenceHistoryDatabase({ candidates = false } = {}) {
  const db = await createLedgerDatabase();
  for (const item of EVIDENCE_HISTORY_MIGRATIONS) {
    try {
      await db.exec(evidenceHistorySql(item));
    } catch (error) {
      throw new Error(`evidence harness: ${item} did not apply: ${error.message}`);
    }
  }
  if (candidates) await applyEvidenceHistoryCandidates(db);
  return db;
}

export async function applyEvidenceHistoryCandidates(db) {
  for (const file of EVIDENCE_HISTORY_CANDIDATES) {
    await db.exec(upSection(readFileSync(path.join(OC4A_CANDIDATES_DIR, file), 'utf8')));
  }
}

export async function revertEvidenceHistoryCandidates(db) {
  for (const file of [...EVIDENCE_HISTORY_CANDIDATES].reverse()) {
    await db.exec(downSection(readFileSync(path.join(OC4A_CANDIDATES_DIR, file), 'utf8')));
  }
}

export async function seedVehicle(db, vin) {
  await db.query('INSERT INTO vehicles (vin, make, model, year, mileage, price) VALUES ($1, $2, $3, $4, $5, $6)', [vin, 'Toyota', 'Hilux', 2020, 42000, 21000]);
}

export async function seedEvidence(db, vin) {
  // vehicle_evidence.uploaded_by references users(id): the uploader must exist.
  await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES ('user-1', 'Uploader', 'uploader@example.invalid', 'owner', '2026-01-01')
                  ON CONFLICT (id) DO NOTHING`);
  const { rows } = await db.query(
    `INSERT INTO vehicle_evidence (vehicle_id, vin, event_type, evidence_type, file_url, storage_bucket, file_path, mime_type, file_size, uploaded_by, uploader_role)
     VALUES ($1, $1, 'inspection', 'inspection_photo', 'https://storage.invalid/x.jpg', 'evidence', 'x.jpg', 'image/jpeg', 10, 'user-1', 'owner')
     RETURNING id`, [vin]);
  return rows[0].id;
}

// ── a minimal supabase-js over PGlite ───────────────────────────────────────────────────────────

const quote = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

export function supabaseOver(db) {
  const columnTypes = new Map();
  async function typesOf(table) {
    if (!columnTypes.has(table)) {
      const { rows } = await db.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1', [table]);
      columnTypes.set(table, Object.fromEntries(rows.map((r) => [r.column_name, r.data_type])));
    }
    return columnTypes.get(table);
  }
  const toError = (error) => ({ message: error.message, code: error.code || null, details: error.detail || null });

  return {
    from(table) {
      const state = { op: 'select', columns: '*', filters: [], orders: [], limit: null, single: null, payload: null, onConflict: null, count: null, head: false, returning: null };
      const builder = {
        select(columns = '*', options = {}) {
          if (state.op === 'select') state.columns = columns;
          else state.returning = columns;
          if (options.count) state.count = options.count;
          if (options.head) state.head = true;
          return builder;
        },
        insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
        upsert(payload, options = {}) { state.op = 'upsert'; state.payload = payload; state.onConflict = options.onConflict || null; return builder; },
        update(payload) { state.op = 'update'; state.payload = payload; return builder; },
        delete() { state.op = 'delete'; return builder; },
        eq(column, value) { state.filters.push([column, '=', value]); return builder; },
        gt(column, value) { state.filters.push([column, '>', value]); return builder; },
        lte(column, value) { state.filters.push([column, '<=', value]); return builder; },
        neq(column, value) { state.filters.push([column, '<>', value]); return builder; },
        in(column, values) { state.filters.push([column, 'IN', values]); return builder; },
        order(column, { ascending = true } = {}) { state.orders.push(`${quote(column)} ${ascending ? 'ASC' : 'DESC'}`); return builder; },
        limit(n) { state.limit = Number(n); return builder; },
        single() { state.single = 'single'; return run(); },
        maybeSingle() { state.single = 'maybe'; return run(); },
        then(resolve, reject) { return run().then(resolve, reject); },
      };

      async function encode(columns, row) {
        const types = await typesOf(table);
        return columns.map((column) => {
          const value = row[column];
          if ((types[column] === 'jsonb' || types[column] === 'json') && value !== null && value !== undefined) return JSON.stringify(value);
          return value === undefined ? null : value;
        });
      }
      function cast(types, column, index) {
        return types[column] === 'jsonb' || types[column] === 'json' ? `$${index}::${types[column]}` : `$${index}`;
      }
      function where(params) {
        if (!state.filters.length) return '';
        return ` WHERE ${state.filters.map(([column, operator, value]) => {
          if (operator === 'IN') {
            const list = Array.isArray(value) ? value : [value];
            if (!list.length) return 'FALSE';
            return `${quote(column)} IN (${list.map((item) => { params.push(item); return `$${params.length}`; }).join(', ')})`;
          }
          params.push(value);
          return `${quote(column)} ${operator} $${params.length}`;
        }).join(' AND ')}`;
      }
      const projection = (columns) => (columns === '*' ? '*' : String(columns).split(',').map((c) => quote(c.trim())).join(', '));

      async function run() {
        try {
          const types = await typesOf(table);
          const params = [];
          let sql;
          if (state.op === 'select') {
            if (state.head && state.count) {
              const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${quote(table)}${where(params)}`, params);
              return { data: null, error: null, count: rows[0].n };
            }
            sql = `SELECT ${projection(state.columns)} FROM ${quote(table)}${where(params)}`;
            if (state.orders.length) sql += ` ORDER BY ${state.orders.join(', ')}`;
            if (state.limit !== null) sql += ` LIMIT ${state.limit}`;
          } else if (state.op === 'insert' || state.op === 'upsert') {
            const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
            const columns = Object.keys(rows[0]);
            const values = [];
            for (const row of rows) {
              const encoded = await encode(columns, row);
              values.push(`(${encoded.map((value, i) => { params.push(value); return cast(types, columns[i], params.length); }).join(', ')})`);
            }
            sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${values.join(', ')}`;
            if (state.op === 'upsert' && state.onConflict) {
              const keys = state.onConflict.split(',').map((c) => c.trim());
              const updates = columns.filter((c) => !keys.includes(c)).map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`);
              sql += ` ON CONFLICT (${keys.map(quote).join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
            }
            if (state.returning) sql += ` RETURNING ${projection(state.returning)}`;
          } else if (state.op === 'update') {
            const columns = Object.keys(state.payload);
            const encoded = await encode(columns, state.payload);
            const sets = columns.map((column, i) => { params.push(encoded[i]); return `${quote(column)} = ${cast(types, column, params.length)}`; });
            sql = `UPDATE ${quote(table)} SET ${sets.join(', ')}${where(params)}`;
            if (state.returning) sql += ` RETURNING ${projection(state.returning)}`;
          } else {
            sql = `DELETE FROM ${quote(table)}${where(params)}`;
            if (state.returning) sql += ` RETURNING ${projection(state.returning)}`;
          }
          const result = await db.query(sql, params);
          const rows = result.rows || [];
          if (state.single) {
            if (rows.length === 1) return { data: rows[0], error: null };
            if (rows.length === 0 && state.single === 'maybe') return { data: null, error: null };
            return { data: null, error: { message: `expected one row, got ${rows.length}`, code: 'PGRST116' } };
          }
          const writesWithoutReturning = state.op !== 'select' && !state.returning;
          return { data: writesWithoutReturning ? null : rows, error: null, count: state.count ? rows.length : null };
        } catch (error) {
          return { data: null, error: toError(error), count: null };
        }
      }
      return builder;
    },
  };
}

export default {
  LEDGER_MIGRATION_CHAIN,
  LEDGER_CANDIDATES,
  EVIDENCE_HISTORY_MIGRATIONS,
  EVIDENCE_HISTORY_CANDIDATES,
  createLedgerDatabase,
  createEvidenceHistoryDatabase,
  applyLedgerCandidates,
  revertLedgerCandidates,
  applyEvidenceHistoryCandidates,
  revertEvidenceHistoryCandidates,
  seedVehicle,
  seedEvidence,
  supabaseOver,
};
