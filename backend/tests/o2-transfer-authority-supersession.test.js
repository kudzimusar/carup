/**
 * O2/P1 — a completed ownership transfer supersedes the previous owner's Seller Authority.
 *
 * The gap this closes (M8 ADR §9): `passport_transition_ownership_transfer_atomic` changes
 * `vehicles.owner_id`, but nothing touched `vehicle_seller_authority`, so the former owner kept a
 * standing `confirmed` authority over a vehicle they no longer own.
 *
 * Behavioral proof on real PostgreSQL (PGlite), through the REAL service functions and the REAL
 * migrations — obligations (a)–(g) from CARUP_OPERATIONS_O2_TRANSFER_AUTHORITY_LIFECYCLE.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { transitionOwnershipTransfer } from '../services/passport/passportOwnershipTransferService.js';
import {
  supersedeSellerAuthorityOnOwnershipTransfer,
  SELLER_AUTHORITY_SUPERSEDED_EVENT,
} from '../services/seller/sellerAuthorityService.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw)
    .replace('-- +migrate Up', '')
    // PGlite (PG17) has gen_random_uuid() in core and no pgcrypto — the repo's standard harness shim.
    .replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
}

const VIN = 'VIN-O2-TRANSFER-1';

async function o2Db() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE users (id text PRIMARY KEY, role text);
    CREATE TABLE vehicles (
      vin text PRIMARY KEY,
      owner_id text REFERENCES users(id),
      current_seller_id text,
      current_seller_type text,
      current_seller_type_source text,
      publication_status text NOT NULL DEFAULT 'draft',
      tenant_id text
    );
    CREATE TABLE vehicle_ownership_history (
      id bigserial PRIMARY KEY,
      vin text NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
      previous_owner_id text REFERENCES users(id),
      new_owner_id text NOT NULL REFERENCES users(id),
      transfer_date text NOT NULL,
      transfer_hash text NOT NULL
    );
    CREATE TABLE domain_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      tenant_id text,
      created_at timestamptz DEFAULT now()
    );

    INSERT INTO users(id,role) VALUES
      ('owner-old','owner'),
      ('owner-new','owner'),
      ('reviewer-1','government');

    INSERT INTO vehicles(vin,owner_id,current_seller_id,current_seller_type,current_seller_type_source,publication_status,tenant_id)
    VALUES ('${VIN}','owner-old','owner-old','private','seller_declared','published',NULL);
  `);
  await db.exec(up('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql'));
  await db.exec(up('../../database/migrations/20260902160000_vehicle_seller_authority.sql'));
  await db.exec(up('../../database/migrations/20260603233640_governance_foundation_trust_audit_events.sql'));
  return db;
}

/**
 * Purpose-built supabase-shaped adapter over PGlite for exactly the calls the services under test
 * make: rpc(), and from().select/eq/maybeSingle/single/update/insert. `failAuditInsert` simulates
 * an audit-ledger outage for the loud-failure obligation (g).
 */
function adapter(db, { failAuditInsert = false } = {}) {
  return {
    rpc: async (fn, params) => {
      const keys = Object.keys(params);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const { rows } = await db.query(`SELECT to_jsonb(t) AS row FROM public.${fn}(${args}) t`, keys.map((k) => params[k]));
        return { data: rows[0]?.row ?? null, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message } };
      }
    },
    from(table) {
      const state = { filters: [], patch: null, insert: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { state.filters.push([col, val]); return chain; },
        update(patch) { state.patch = patch; return chain; },
        insert(row) { state.insert = row; return chain; },
        async maybeSingle() { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        async single() {
          const r = await run();
          if (r.error) return { data: null, error: r.error };
          return r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'Row not found' } };
        },
        then(resolve, reject) { run().then(resolve, reject); },
      };
      async function run() {
        try {
          if (state.insert) {
            if (table === 'trust_audit_events' && failAuditInsert) {
              return { data: null, error: { message: 'audit ledger unavailable (test)' } };
            }
            const row = state.insert;
            const cols = Object.keys(row);
            const vals = cols.map((c, i) => {
              const v = row[c];
              if (v !== null && typeof v === 'object' && !Array.isArray(v)) return `$${i + 1}::jsonb`;
              if (Array.isArray(v)) return `$${i + 1}::text[]`;
              return `$${i + 1}`;
            });
            const params = cols.map((c) => {
              const v = row[c];
              return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
            });
            await db.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')})`, params);
            return { data: [row], error: null };
          }
          const where = state.filters.length
            ? ` WHERE ${state.filters.map(([c], i) => `"${c}" = $${i + 1}`).join(' AND ')}`
            : '';
          const params = state.filters.map(([, v]) => v);
          if (state.patch) {
            const cols = Object.keys(state.patch);
            const set = cols.map((c, i) => `"${c}" = $${params.length + i + 1}`).join(', ');
            const { rows } = await db.query(`UPDATE ${table} SET ${set}${where} RETURNING *`, [...params, ...cols.map((c) => state.patch[c])]);
            return { data: rows, error: null };
          }
          const { rows } = await db.query(`SELECT * FROM ${table}${where}`, params);
          return { data: rows, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      }
      return chain;
    },
  };
}

async function seedAuthority(db, { status = 'confirmed', sellerUserId = 'owner-old' } = {}) {
  await db.query(`
    INSERT INTO vehicle_seller_authority
      (vin, seller_user_id, claim_type, status, basis, reason, decided_by, decided_by_role, decided_at)
    VALUES ($1,$2,'owner',$3,'existing_relationship','governed review','reviewer-1','admin', now())
  `, [VIN, sellerUserId, status]);
}

async function begin(db) {
  const { rows } = await db.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_atomic($1::text,$2::text,$3::text,$4::text,$5::text)`,
    [VIN, 'owner-new', 'owner-old', 'owner', 'o2-idem-1'],
  );
  return rows[0];
}

const GOVERNANCE = { id: 'reviewer-1', role: 'government' };

async function completeViaService(client, transferId) {
  await transitionOwnershipTransfer(client, { transferId, toState: 'under_review' }, { id: 'owner-old', role: 'owner' });
  return transitionOwnershipTransfer(client, {
    transferId,
    toState: 'complete',
    registryAuthority: 'manual_governed_review',
    completionReference: 'o2-case-1',
  }, GOVERNANCE);
}

test('(a–d) completion supersedes the previous owner\'s authority, audited, with nothing created for the incoming owner', async () => {
  const db = await o2Db();
  try {
    await seedAuthority(db, { status: 'confirmed' });
    const client = adapter(db);
    const transfer = await begin(db);

    const result = await completeViaService(client, transfer.id);

    // (a) ownership is canonical.
    assert.equal(result.legal_ownership_completed, true);
    const vehicle = await db.query(`SELECT owner_id FROM vehicles WHERE vin=$1`, [VIN]);
    assert.equal(vehicle.rows[0].owner_id, 'owner-new');

    // (b) the previous owner's authority is REVOKED — not deleted — with the transfer-stamped
    // reason and the completing governance actor's attribution.
    assert.equal(result.authority_supersession?.changed, true, JSON.stringify(result.authority_supersession));
    const row = (await db.query(
      `SELECT status, reason, decided_by, decided_by_role, basis FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id='owner-old'`,
      [VIN],
    )).rows[0];
    assert.equal(row.status, 'revoked');
    assert.equal(row.reason, `superseded_by_ownership_transfer:${transfer.id}`);
    assert.equal(row.decided_by, 'reviewer-1');
    assert.equal(row.decided_by_role, 'government');
    assert.equal(row.basis, 'existing_relationship', 'history: the basis that supported the old decision is preserved on the row');

    // (c) the supersession is in the audit ledger with the previous state, BEFORE-mutation semantics.
    const audit = (await db.query(
      `SELECT event_type, previous_value, new_value, reason FROM trust_audit_events WHERE vin=$1 AND event_type=$2`,
      [VIN, SELLER_AUTHORITY_SUPERSEDED_EVENT],
    )).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].previous_value.status, 'confirmed');
    assert.equal(audit[0].new_value.status, 'revoked');

    // (d) NOTHING is fabricated for the incoming owner.
    const incoming = await db.query(
      `SELECT count(*)::int AS n FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id='owner-new'`, [VIN],
    );
    assert.equal(incoming.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('(e) supersession is idempotent — a governed re-run converges without a second audit event', async () => {
  const db = await o2Db();
  try {
    await seedAuthority(db, { status: 'confirmed' });
    const client = adapter(db);
    const transfer = await begin(db);
    await completeViaService(client, transfer.id);

    const again = await supersedeSellerAuthorityOnOwnershipTransfer(client, {
      vin: VIN, previousOwnerId: 'owner-old', transferId: transfer.id, actor: GOVERNANCE,
    });
    assert.equal(again.changed, false);
    assert.equal(again.superseded, 0);
    const audits = await db.query(
      `SELECT count(*)::int AS n FROM trust_audit_events WHERE event_type=$1`, [SELLER_AUTHORITY_SUPERSEDED_EVENT],
    );
    assert.equal(audits.rows[0].n, 1, 'no duplicate audit event on re-run');
  } finally {
    await db.close();
  }
});

test('(f) only canonical completion supersedes — earlier transitions leave authority untouched', async () => {
  const db = await o2Db();
  try {
    await seedAuthority(db, { status: 'confirmed' });
    const client = adapter(db);
    const transfer = await begin(db);

    const result = await transitionOwnershipTransfer(client, { transferId: transfer.id, toState: 'under_review' }, { id: 'owner-old', role: 'owner' });
    assert.equal(result.legal_ownership_completed, false);
    assert.equal('authority_supersession' in result, false, 'a non-completion transition must not even attempt supersession');
    const row = (await db.query(
      `SELECT status FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id='owner-old'`, [VIN],
    )).rows[0];
    assert.equal(row.status, 'confirmed');
  } finally {
    await db.close();
  }
});

test('(g) audit-ledger failure: completion STANDS, authority is untouched (audit-first), and the failure is loud in the response', async () => {
  const db = await o2Db();
  try {
    await seedAuthority(db, { status: 'confirmed' });
    const client = adapter(db, { failAuditInsert: true });
    const transfer = await begin(db);

    const result = await completeViaService(client, transfer.id);

    // Ownership (registry-backed, atomic in the RPC) stands.
    assert.equal(result.legal_ownership_completed, true);
    const vehicle = await db.query(`SELECT owner_id FROM vehicles WHERE vin=$1`, [VIN]);
    assert.equal(vehicle.rows[0].owner_id, 'owner-new');

    // The failure is named in the response — never swallowed.
    assert.equal(result.authority_supersession?.failed, true, JSON.stringify(result.authority_supersession));
    assert.match(String(result.authority_supersession.error), /audit/i);

    // Audit-first, fail closed: with no audit written, the row was NOT mutated.
    const row = (await db.query(
      `SELECT status FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id='owner-old'`, [VIN],
    )).rows[0];
    assert.equal(row.status, 'confirmed', 'a supersession that cannot be attributed does not happen');
  } finally {
    await db.close();
  }
});

test('a disputed authority is still superseded — a dispute over a vehicle you no longer own does not keep authority alive', async () => {
  const db = await o2Db();
  try {
    await seedAuthority(db, { status: 'disputed' });
    const client = adapter(db);
    const transfer = await begin(db);
    const result = await completeViaService(client, transfer.id);
    assert.equal(result.authority_supersession?.changed, true);
    const row = (await db.query(
      `SELECT status, reason FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id='owner-old'`, [VIN],
    )).rows[0];
    assert.equal(row.status, 'revoked');
    assert.match(row.reason, /superseded_by_ownership_transfer:/);
  } finally {
    await db.close();
  }
});

test('no authority row at all is a clean no-op completion', async () => {
  const db = await o2Db();
  try {
    const client = adapter(db);
    const transfer = await begin(db);
    const result = await completeViaService(client, transfer.id);
    assert.equal(result.legal_ownership_completed, true);
    assert.equal(result.authority_supersession?.changed, false);
    assert.equal(result.authority_supersession?.superseded, 0);
  } finally {
    await db.close();
  }
});
