/**
 * Shared Issue #158 ledger harness: a PostgREST-shaped supabase double backed by a REAL
 * PostgreSQL (PGlite) database running the REAL migrations.
 *
 * The sibling issue-158-boundary-upgrade-postgres suite carries its own copy of this
 * shape. That copy is deliberately left in place: it is a certified artifact of the
 * boundary-upgrade scenario and re-pointing it at this module would rewrite a suite whose
 * evidence has already been accepted. New suites use this module so the duplication does
 * not grow further.
 *
 * Everything here is test scaffolding. It never runs in production and it never holds real
 * credentials: the caller supplies placeholder env values.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';
export const TERMINAL = '9999-12-31T23:59:59.999Z';

const MIGRATIONS_DIR = new URL('../../../database/migrations/', import.meta.url);

/** Read a migration's Up section exactly as the runner would apply it. */
export function up(fileName) {
  const raw = readFileSync(new URL(fileName, MIGRATIONS_DIR), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

/** The Issue #158 migration chain, in published order. */
export const ISSUE_158_MIGRATIONS = [
  '20260828210000_issue158_private_key_custody.sql',
  '20260829003000_issue158_custody_rollout_upgrade.sql',
  '20260829020000_issue158_activation_boundary_hardening.sql',
  '20260829040000_issue158_terminal_event_uniqueness.sql',
  '20260830010000_issue158_ledger_operation_identity.sql',
];

const quote = (col) => `"${String(col).trim()}"`;
const cols = (spec) => String(spec).split(',').map(quote).join(',');

/**
 * Fault-injection hooks shared with the client. Reset between tests by the caller.
 *   failNextEventInsert - one transient ledger insert failure, modelling the real split
 *                         between a committed boundary allocation and event persistence.
 *   eventInsertGate     - a barrier every ledger insert parks on, so competing writes can
 *                         all finish boundary allocation before any insert lands.
 */
export const injected = {
  failNextEventInsert: false,
  eventInsertGate: null,
  eventInsertsWaiting: 0,
};

export function resetInjection() {
  injected.failNextEventInsert = false;
  injected.eventInsertGate = null;
  injected.eventInsertsWaiting = 0;
}

export function makeClient(db) {
  function builder(table) {
    const st = {
      table, op: 'select', select: '*', filters: [], gt: null, order: null, limit: null,
      single: false, maybe: false, head: false, payload: null, conflict: null,
    };
    const chain = {
      select(spec, opts) {
        if (spec) st.select = spec;
        if (opts?.head) st.head = true;
        return chain;
      },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      upsert(p, opts) { st.op = 'upsert'; st.payload = p; st.conflict = opts?.onConflict || null; return chain; },
      eq(k, v) { st.filters.push([k, v]); return chain; },
      gt(k, v) { st.gt = [k, v]; return chain; },
      order(k, opts) { st.order = [k, opts?.ascending !== false]; return chain; },
      limit(n) { st.limit = n; return chain; },
      single() { st.single = true; return chain; },
      maybeSingle() { st.maybe = true; return chain; },
      then(res, rej) { return exec(st).then(res, rej); },
    };
    return chain;
  }

  async function exec(st) {
    const params = [];
    const where = [];
    for (const [k, v] of st.filters) { params.push(v); where.push(`${quote(k)}=$${params.length}`); }
    if (st.gt) { params.push(st.gt[1]); where.push(`${quote(st.gt[0])}>$${params.length}`); }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    try {
      if (st.op === 'insert' && st.table === 'blockchain_events' && injected.failNextEventInsert) {
        injected.failNextEventInsert = false;
        return { data: null, error: { message: 'transient ledger persistence failure' } };
      }

      if (st.op === 'insert' && st.table === 'blockchain_events' && injected.eventInsertGate) {
        injected.eventInsertsWaiting += 1;
        await injected.eventInsertGate;
      }

      if (st.op === 'insert' || st.op === 'upsert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        const keys = Object.keys(list[0]);
        const values = list.map((row) => `(${keys.map((k) => { params.push(row[k]); return `$${params.length}`; }).join(',')})`);
        const conflict = st.op === 'upsert' && st.conflict
          ? ` ON CONFLICT (${cols(st.conflict)}) DO UPDATE SET ${keys.filter((k) => k !== st.conflict).map((k) => `${quote(k)}=EXCLUDED.${quote(k)}`).join(',')}`
          : '';
        const returning = st.select === '*' ? '*' : cols(st.select);
        const { rows } = await db.query(
          `INSERT INTO public.${quote(st.table)}(${keys.map(quote).join(',')}) VALUES ${values.join(',')}${conflict} RETURNING ${returning}`,
          params,
        );
        return { data: st.single ? rows[0] ?? null : rows, error: null };
      }

      if (st.head) {
        const { rows } = await db.query(`SELECT count(*)::int AS count FROM public.${quote(st.table)}${whereSql}`, params);
        return { count: rows[0].count, data: null, error: null };
      }

      const orderSql = st.order ? ` ORDER BY ${quote(st.order[0])} ${st.order[1] ? 'ASC' : 'DESC'}` : '';
      const limitSql = st.limit != null ? ` LIMIT ${Number(st.limit)}` : '';
      const { rows } = await db.query(
        `SELECT ${st.select === '*' ? '*' : cols(st.select)} FROM public.${quote(st.table)}${whereSql}${orderSql}${limitSql}`,
        params,
      );
      if (st.maybe) return { data: rows[0] ?? null, error: null };
      if (st.single) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }
  }

  return {
    from: builder,
    rpc: async (name, args = {}) => {
      const keys = Object.keys(args);
      const call = keys.length ? `${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}` : '';
      try {
        const { rows, fields } = await db.query(
          `SELECT * FROM public.${quote(name)}(${call})`,
          keys.map((k) => args[k]),
        );
        if (rows.length === 1 && (fields?.length ?? Object.keys(rows[0]).length) === 1) {
          return { data: Object.values(rows[0])[0], error: null };
        }
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message, code: error.code } };
      }
    },
  };
}

const BASE_SCHEMA = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

  CREATE TABLE public_keys (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    public_key_pem text NOT NULL,
    private_key_pem text,
    key_type text DEFAULT 'secp256k1',
    status text DEFAULT 'ACTIVE',
    created_at text NOT NULL,
    revoked_at text
  );
  CREATE TABLE blockchain_events (
    id bigserial PRIMARY KEY,
    previous_hash text,
    current_hash text,
    vin text,
    event_type text,
    payload text,
    "timestamp" text,
    signature text
  );
  CREATE TABLE rolling_integrity_checkpoints (
    vin text PRIMARY KEY,
    last_verified_event_id bigint,
    rolling_hash text,
    verified_at text
  );
  GRANT ALL ON public_keys,blockchain_events,rolling_integrity_checkpoints TO service_role;
`;

/**
 * A database that has already completed the protected Issue #158 finalization, holding one
 * ACTIVE key for `signerId`, with the requested migrations applied.
 *
 * @param {object} opts
 * @param {string} opts.keyPem        - the ACTIVE public key PEM
 * @param {string} opts.keyCreatedAt  - its created_at
 * @param {string} opts.signerId
 * @param {string[]} [opts.migrations] - migration file names applied AFTER finalization
 */
export async function finalizedLedgerDb({ keyPem, keyCreatedAt, signerId, migrations = [] }) {
  const db = await PGlite.create();
  await db.exec(BASE_SCHEMA);
  await db.exec(up('20260828210000_issue158_private_key_custody.sql'));
  await db.exec(up('20260829003000_issue158_custody_rollout_upgrade.sql'));

  await db.query(`
    INSERT INTO public_keys(
      id,user_id,public_key_pem,private_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
    ) VALUES (
      'key-historical',$1::text,$2::text,'LEGACY-PRIVATE-MATERIAL','secp256k1','ACTIVE',$3::text,
      'derived:test:hv1:historical','hv1','derived_master_secret'
    )
  `, [signerId, keyPem, keyCreatedAt]);

  await db.exec(`
    UPDATE public.public_keys SET private_key_pem=NULL WHERE private_key_pem IS NOT NULL;
    ALTER TABLE public.public_keys
      ADD CONSTRAINT public_keys_private_material_absent CHECK (private_key_pem IS NULL);
    REVOKE SELECT,INSERT,UPDATE,DELETE ON TABLE public.public_keys FROM service_role;
    GRANT SELECT (
      id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
      key_ref,key_version,custody_provider
    ) ON public.public_keys TO service_role;
    UPDATE public.blockchain_custody_rollout
       SET state='FINALIZED',old_writers_drained=TRUE,finalized_at=clock_timestamp()
     WHERE singleton=TRUE;
  `);

  for (const migration of migrations) {
    await db.exec(up(migration));
  }
  return db;
}

/** Park a signer one millisecond below the terminal instant so the next write lands on it. */
export async function parkAtTerminalMinusOne(db, signerId) {
  await db.query(`
    INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
    VALUES ($1::text,TIMESTAMPTZ '9999-12-31 23:59:59.998+00')
    ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
  `, [signerId]);
}
