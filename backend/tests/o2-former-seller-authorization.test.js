/**
 * O2/P1 CORRECTION — a completed ownership transfer must end the former owner's EFFECTIVE Seller
 * authorization, not merely flip a row.
 *
 * The defect this closes, found in independent Product Owner review of P1:
 *
 *   Hazard A — historical evidence recreated Seller scope. `hasVerifiedOwnershipAuthorityEvidence`
 *   asks only "does a verified ownership/registration document uploaded by this user exist?", which
 *   stays TRUE forever after a sale. The reuse path fed that into `existingSellerRelationship` and
 *   then wrote `current_seller_id: <caller>` — handing publish/price/status scope over B's vehicle
 *   back to A on the strength of a document that only ever proved what was true before the sale.
 *
 *   Hazard B — supersession is best-effort by design (legal ownership must stand even when the
 *   derived write fails), so a stale `confirmed` authority row can physically survive a completed
 *   transfer. Read paths treated that row as sufficient.
 *
 * These tests assert the BUSINESS invariant — can A still offer the vehicle? — not row contents.
 * Journeys A, B and C mirror the directive's required proofs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { transitionOwnershipTransfer } from '../services/passport/passportOwnershipTransferService.js';
import {
  getSellerAuthorityState,
  isSellerAuthoritySatisfied,
  isSellerAuthorityEffectivelyDenied,
  hasSupersedingOwnershipTransfer,
  hasVerifiedOwnershipAuthorityEvidence,
} from '../services/seller/sellerAuthorityService.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw)
    .replace('-- +migrate Up', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
}

const VIN = 'VIN-FORMER-SELLER-1';
const A = 'owner-old';   // sells the vehicle
const B = 'owner-new';   // buys it
const GOVERNANCE = { id: 'reviewer-1', role: 'government' };

async function db() {
  const pg = await PGlite.create();
  await pg.exec(`
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
    CREATE TABLE vehicle_evidence (
      id text PRIMARY KEY, vin text, evidence_type text,
      evidence_class text, evidence_subtype text,
      verification_status text, uploaded_by text
    );
    CREATE TABLE domain_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL, payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
      tenant_id text, created_at timestamptz DEFAULT now()
    );

    INSERT INTO users(id,role) VALUES ('${A}','owner'),('${B}','owner'),('reviewer-1','government');
    INSERT INTO vehicles(vin,owner_id,current_seller_id,current_seller_type,current_seller_type_source,publication_status,tenant_id)
    VALUES ('${VIN}','${A}','${A}','private','seller_declared','published',NULL);

    -- A's genuinely verified registration document. It is REAL history and must be preserved.
    INSERT INTO vehicle_evidence(id,vin,evidence_type,evidence_class,evidence_subtype,verification_status,uploaded_by)
    VALUES ('ev-reg-A','${VIN}','registration_document','registration','registration_book','verified','${A}');
  `);
  await pg.exec(up('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql'));
  // The correction: completion also retires the dealer-organisation relationship.
  await pg.exec(up('../../database/migrations/20260903120000_ownership_transfer_retires_tenant_relationship.sql'));
  await pg.exec(up('../../database/migrations/20260902160000_vehicle_seller_authority.sql'));
  await pg.exec(up('../../database/migrations/20260603233640_governance_foundation_trust_audit_events.sql'));
  await pg.query(`
    INSERT INTO vehicle_seller_authority
      (vin, seller_user_id, claim_type, status, basis, reason, decided_by, decided_by_role, decided_at)
    VALUES ($1,$2,'owner','confirmed','existing_relationship','governed review','reviewer-1','admin', now())
  `, [VIN, A]);
  return pg;
}

/** Supabase-shaped adapter over PGlite covering exactly the calls these services make. */
function adapter(pg, { failAuthorityUpdate = false } = {}) {
  return {
    rpc: async (fn, params) => {
      const keys = Object.keys(params);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const { rows } = await pg.query(`SELECT to_jsonb(t) AS row FROM public.${fn}(${args}) t`, keys.map((k) => params[k]));
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
          // Journey B: force ONLY the authority supersession write to fail, leaving the stale row.
          if (state.patch && table === 'vehicle_seller_authority' && failAuthorityUpdate) {
            return { data: null, error: { message: 'authority update refused (injected failure)' } };
          }
          if (state.insert) {
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
            await pg.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')})`, params);
            return { data: [row], error: null };
          }
          const where = state.filters.length
            ? ` WHERE ${state.filters.map(([c], i) => `"${c}" = $${i + 1}`).join(' AND ')}`
            : '';
          const params = state.filters.map(([, v]) => v);
          if (state.patch) {
            const cols = Object.keys(state.patch);
            const set = cols.map((c, i) => `"${c}" = $${params.length + i + 1}`).join(', ');
            const { rows } = await pg.query(`UPDATE ${table} SET ${set}${where} RETURNING *`, [...params, ...cols.map((c) => state.patch[c])]);
            return { data: rows, error: null };
          }
          const { rows } = await pg.query(`SELECT * FROM ${table}${where}`, params);
          return { data: rows, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      }
      return chain;
    },
  };
}

async function completeTransfer(client, pg) {
  const { rows } = await pg.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_atomic($1::text,$2::text,$3::text,$4::text,$5::text)`,
    [VIN, B, A, 'owner', 'former-seller-idem-1'],
  );
  const transfer = rows[0];
  await transitionOwnershipTransfer(client, { transferId: transfer.id, toState: 'under_review' }, { id: A, role: 'owner' });
  const result = await transitionOwnershipTransfer(client, {
    transferId: transfer.id,
    toState: 'complete',
    registryAuthority: 'manual_governed_review',
    completionReference: 'former-seller-case-1',
  }, GOVERNANCE);
  return { transfer, result };
}

/** The business question: may this person offer/list/publish this vehicle? */
async function mayOffer(client, pg, userId) {
  const { rows } = await pg.query('SELECT * FROM vehicles WHERE vin=$1', [VIN]);
  const vehicle = rows[0];
  const state = await getSellerAuthorityState(client, { vin: VIN, sellerUserId: userId, vehicle });
  return { satisfied: isSellerAuthoritySatisfied(state), state, vehicle };
}

/**
 * The exact authorization expression POST /api/vehicles/add uses for existing-Passport reuse,
 * evaluated against the live services. Mirrors backend/server.js so the invariant is proven at the
 * decision the route actually makes, not at a paraphrase of it.
 */
async function mayReuseExistingPassport(client, pg, userId, { tenantId = null } = {}) {
  const { rows } = await pg.query('SELECT * FROM vehicles WHERE vin=$1', [VIN]);
  const existing = rows[0];
  const denial = await isSellerAuthorityEffectivelyDenied(client, { vin: VIN, userId, vehicle: existing });
  const governedSellerEvidence = denial.denied
    ? false
    : await hasVerifiedOwnershipAuthorityEvidence(client, VIN, userId);
  const relationship = Boolean(existing && !denial.denied && (
    existing.owner_id === userId
    || (existing.current_seller_id && existing.current_seller_id === userId)
    || (existing.tenant_id && tenantId && existing.tenant_id === tenantId)
    || governedSellerEvidence
  ));
  return { allowed: relationship, denial, governedSellerEvidence };
}

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY A — normal transfer supersession
// ═══════════════════════════════════════════════════════════════════════════

test('Journey A — after a completed transfer, A cannot re-list from historical evidence and B gets no fabricated authority', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);

    // 4. A can legitimately offer the vehicle BEFORE the transfer.
    const before = await mayOffer(client, pg, A);
    assert.equal(before.satisfied, true, 'A must be authorized before the sale');
    assert.equal((await mayReuseExistingPassport(client, pg, A)).allowed, true, 'A may re-list before the sale');

    // 5-7. Governed transfer A -> B, completed with registry authority + reference.
    const { result } = await completeTransfer(client, pg);
    assert.equal(result.legal_ownership_completed, true);
    const vehicle = (await pg.query('SELECT owner_id, current_seller_id FROM vehicles WHERE vin=$1', [VIN])).rows[0];
    assert.equal(vehicle.owner_id, B, 'canonical ownership is B');

    // 8. A's Seller Authority is superseded.
    const row = (await pg.query('SELECT status, reason FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id=$2', [VIN, A])).rows[0];
    assert.equal(row.status, 'revoked');
    assert.match(row.reason, /superseded_by_ownership_transfer:/);

    // 10-11. THE DEFECT: A re-attempts reuse with the SAME historical verified evidence. REFUSED.
    assert.equal(await hasVerifiedOwnershipAuthorityEvidence(client, VIN, A), true,
      'the historical document is still genuinely verified — it is real history');
    const reuse = await mayReuseExistingPassport(client, pg, A);
    assert.equal(reuse.allowed, false, 'a historical document must not be an immortal permission token');
    assert.equal(reuse.governedSellerEvidence, false, 'evidence must not even be consulted once ownership superseded A');
    assert.equal(reuse.denial.denied, true);

    // 12. current_seller_id must not become A again. The reuse write is never reached, and the
    //     transfer itself cleared the stale pointer.
    assert.notEqual(vehicle.current_seller_id, A, 'the former owner must not hold the current-seller pointer');

    // 13-14. A cannot publish or mutate seller-scoped state: effective authority is denied.
    const afterA = await mayOffer(client, pg, A);
    assert.equal(afterA.satisfied, false, 'A must not satisfy the publication authority gate');
    assert.equal(afterA.state.status, 'revoked');

    // 15. B receives NO fabricated confirmed authority.
    const bRows = await pg.query('SELECT count(*)::int AS n FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id=$2', [VIN, B]);
    assert.equal(bRows.rows[0].n, 0, 'authority for the incoming owner must be earned, never fabricated');

    // 16. B follows the ordinary governed lifecycle: as canonical owner, the relationship recognizes them.
    const afterB = await mayOffer(client, pg, B);
    assert.equal(afterB.satisfied, true, 'the new owner proceeds through the normal owner lifecycle');
    assert.equal(afterB.state.status, 'recognized');
  } finally {
    await pg.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY B — supersession failure after legal transfer (the critical fail-closed proof)
// ═══════════════════════════════════════════════════════════════════════════

test('Journey B — a FAILED supersession leaves ownership completed and STILL denies the former seller', async () => {
  const pg = await db();
  try {
    // The authority UPDATE is forced to fail; everything else behaves normally.
    const client = adapter(pg, { failAuthorityUpdate: true });

    const { result } = await completeTransfer(client, pg);

    // 1-2. Ownership remains legally completed to B — NOT rolled back for a derived-state failure.
    assert.equal(result.legal_ownership_completed, true, 'registry-backed ownership must stand');
    const vehicle = (await pg.query('SELECT owner_id FROM vehicles WHERE vin=$1', [VIN])).rows[0];
    assert.equal(vehicle.owner_id, B);

    // 3. The failure is reported explicitly, never swallowed.
    assert.equal(result.authority_supersession?.failed, true, JSON.stringify(result.authority_supersession));
    assert.match(String(result.authority_supersession.error), /refused|failed/i);

    // 4. The stale `confirmed` row IS physically still present — this is the hazard.
    const stale = (await pg.query('SELECT status FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id=$2', [VIN, A])).rows[0];
    assert.equal(stale.status, 'confirmed', 'the injected failure genuinely left a stale row (otherwise this proves nothing)');

    // ...and it does NOT grant effective authority.
    const afterA = await mayOffer(client, pg, A);
    assert.equal(afterA.satisfied, false, 'a stale confirmed row must not authorize a former owner');
    assert.equal(afterA.state.status, 'revoked', 'effective state outranks the stored row');
    assert.equal(afterA.state.effective_denial_reason, 'ownership_transferred_away');
    assert.equal(afterA.state.stale_authority_row_status, 'confirmed', 'the inconsistency is exposed, not hidden');

    // 5-6. Historical evidence grants nothing, and the Passport cannot be reused as Seller.
    assert.equal(await hasVerifiedOwnershipAuthorityEvidence(client, VIN, A), true, 'the document still exists');
    const reuse = await mayReuseExistingPassport(client, pg, A);
    assert.equal(reuse.allowed, false, 'fail closed on stale secondary state');
    assert.equal(reuse.denial.reason, 'ownership_transferred_away');

    // 7-8. A cannot publish and cannot reset current_seller_id (the reuse write is unreachable).
    const current = (await pg.query('SELECT current_seller_id FROM vehicles WHERE vin=$1', [VIN])).rows[0];
    assert.notEqual(current.current_seller_id, A);

    // 9. B remains canonical owner.
    assert.equal((await pg.query('SELECT owner_id FROM vehicles WHERE vin=$1', [VIN])).rows[0].owner_id, B);

    // 10. The secondary inconsistency is exposed for Operations recovery.
    assert.equal(hasSupersedingOwnershipTransfer.name, 'hasSupersedingOwnershipTransfer');
    assert.equal(await hasSupersedingOwnershipTransfer(client, { vin: VIN, userId: A }), true);
  } finally {
    await pg.close();
  }
});

test('Journey B — even a stale current_seller_id pointing at the former owner does not authorize', async () => {
  const pg = await db();
  try {
    const client = adapter(pg, { failAuthorityUpdate: true });
    await completeTransfer(client, pg);
    // Simulate the worst surviving secondary state: the pointer was never cleared.
    await pg.query('UPDATE vehicles SET current_seller_id=$1 WHERE vin=$2', [A, VIN]);

    const afterA = await mayOffer(client, pg, A);
    assert.equal(afterA.satisfied, false, 'a stale current_seller_id must not resurrect authority');
    assert.equal(afterA.state.existing_relationship, false, 'the derived relationship is stripped once ownership superseded');
    const reuse = await mayReuseExistingPassport(client, pg, A);
    assert.equal(reuse.allowed, false);
  } finally {
    await pg.close();
  }
});

test('Journey B — a surviving dealer tenant relationship does not authorize the former seller either', async () => {
  const pg = await db();
  try {
    const client = adapter(pg, { failAuthorityUpdate: true });
    await pg.query(`UPDATE vehicles SET tenant_id='tenant-a' WHERE vin=$1`, [VIN]);
    await completeTransfer(client, pg);

    const reuse = await mayReuseExistingPassport(client, pg, A, { tenantId: 'tenant-a' });
    assert.equal(reuse.allowed, false, 'a previous tenant relationship must not outlive the transfer for the former seller');
  } finally {
    await pg.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY C — history integrity
// ═══════════════════════════════════════════════════════════════════════════

test('Journey C — evidence, authority history and ownership history all survive; nothing is deleted to pass', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    await completeTransfer(client, pg);

    // Evidence preserved, still verified, still attributed to A.
    const evidence = (await pg.query('SELECT id, verification_status, uploaded_by FROM vehicle_evidence WHERE vin=$1', [VIN])).rows;
    assert.equal(evidence.length, 1, 'the historical document is not deleted');
    assert.equal(evidence[0].verification_status, 'verified', 'it remains genuinely verified history');
    assert.equal(evidence[0].uploaded_by, A);

    // Authority row preserved (revoked, not removed) with its original basis intact.
    const authority = (await pg.query('SELECT status, basis, decided_by_role FROM vehicle_seller_authority WHERE vin=$1 AND seller_user_id=$2', [VIN, A])).rows;
    assert.equal(authority.length, 1, 'authority history is revoked, never deleted');
    assert.equal(authority[0].status, 'revoked');
    assert.equal(authority[0].basis, 'existing_relationship', 'the basis that supported the original decision is preserved');

    // The supersession is in the audit ledger with its previous value.
    const audit = (await pg.query(
      `SELECT previous_value, new_value FROM trust_audit_events WHERE vin=$1 AND event_type='SELLER_AUTHORITY_SUPERSEDED'`, [VIN],
    )).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].previous_value.status, 'confirmed');

    // Ownership history preserved.
    const history = (await pg.query('SELECT previous_owner_id, new_owner_id FROM vehicle_ownership_history WHERE vin=$1', [VIN])).rows;
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_owner_id, A);
    assert.equal(history[0].new_owner_id, B);
  } finally {
    await pg.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Precedence and non-regression of the ordinary paths
// ═══════════════════════════════════════════════════════════════════════════

test('the canonical current owner is never denied by their own transfer history', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    await completeTransfer(client, pg);
    // B is the canonical owner; the ledger holds a completed transfer for this VIN.
    assert.equal(await hasSupersedingOwnershipTransfer(client, { vin: VIN, userId: B }), false);
    const denial = await isSellerAuthorityEffectivelyDenied(client, { vin: VIN, userId: B });
    assert.equal(denial.denied, false);
  } finally {
    await pg.close();
  }
});

test('with no completed transfer, historical evidence still legitimately supports a non-owner seller', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    // A dealer-style seller who is not owner_id but holds verified evidence, no transfer anywhere.
    await pg.query(`INSERT INTO users(id,role) VALUES ('seller-c','dealer')`);
    await pg.query(`INSERT INTO vehicle_evidence(id,vin,evidence_type,evidence_class,evidence_subtype,verification_status,uploaded_by)
      VALUES ('ev-reg-C',$1,'registration_document','registration','registration_book','verified','seller-c')`, [VIN]);
    const denial = await isSellerAuthorityEffectivelyDenied(client, { vin: VIN, userId: 'seller-c' });
    assert.equal(denial.denied, false, 'the correction must not deny sellers who never transferred anything away');
    const reuse = await mayReuseExistingPassport(client, pg, 'seller-c');
    assert.equal(reuse.governedSellerEvidence, true, 'evidence is still a legitimate basis absent a superseding transfer');
    assert.equal(reuse.allowed, true);
  } finally {
    await pg.close();
  }
});

test('an unreadable ownership ledger fails CLOSED for a non-owner', async () => {
  const pg = await db();
  try {
    const broken = {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle: () => Promise.resolve(
            table === 'vehicles'
              ? { data: { vin: VIN, owner_id: B }, error: null }
              : { data: null, error: { message: 'ledger unavailable' } },
          ),
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: { message: 'ledger unavailable' } }).then(resolve, reject);
          },
        };
        return chain;
      },
    };
    assert.equal(await hasSupersedingOwnershipTransfer(broken, { vin: VIN, userId: A }), true,
      'an unreadable ownership ledger must not authorize');
    // ...but the canonical owner is still answered from the vehicle row without needing the ledger.
    assert.equal(await hasSupersedingOwnershipTransfer(broken, { vin: VIN, userId: B }), false);
  } finally {
    await pg.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOT CAUSE — the surviving dealer-organisation relationship
// ═══════════════════════════════════════════════════════════════════════════

test('completion retires the dealer tenant relationship, closing the shared scope test at its root', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    await pg.query(`UPDATE vehicles SET tenant_id='tenant-a' WHERE vin=$1`, [VIN]);
    await completeTransfer(client, pg);

    const vehicle = (await pg.query('SELECT owner_id, current_seller_id, tenant_id FROM vehicles WHERE vin=$1', [VIN])).rows[0];
    assert.equal(vehicle.owner_id, B);
    assert.equal(vehicle.current_seller_id, null);
    assert.equal(vehicle.tenant_id, null,
      'the dealer relationship retires with the sale, exactly as the current-seller pointer does');

    // The `isOwner || isCurrentSeller || isDealerTenant` triple — repeated verbatim across eleven
    // authorization sites — now refuses the former owner on every clause simultaneously.
    const formerOwnerCtx = { id: A, tenantId: 'tenant-a' };
    const isOwner = vehicle.owner_id === formerOwnerCtx.id;
    const isCurrentSeller = Boolean(vehicle.current_seller_id) && vehicle.current_seller_id === formerOwnerCtx.id;
    const isDealerTenant = Boolean(vehicle.tenant_id) && vehicle.tenant_id === formerOwnerCtx.tenantId;
    assert.equal(isOwner || isCurrentSeller || isDealerTenant, false,
      'publish / unpublish / price / status / media / evidence scope all key off this expression');
  } finally {
    await pg.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The claim and review paths the sweep found (D3, D9)
// ═══════════════════════════════════════════════════════════════════════════

test('the canonical claim API refuses a superseded former owner instead of silently recognizing them', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    await completeTransfer(client, pg);
    const { submitSellerClaim } = await import('../services/seller/sellerAuthorityService.js');
    await assert.rejects(
      submitSellerClaim(client, {
        vin: VIN,
        claimType: 'owner',
        userContext: { id: A, role: 'owner', tenantId: null },
      }),
      (err) => err.code === 'SELLER_AUTHORITY_SUPERSEDED' && err.status === 403,
    );
  } finally {
    await pg.close();
  }
});

test('a reviewer cannot re-confirm authority for an owner whose vehicle has already transferred away', async () => {
  const pg = await db();
  try {
    const client = adapter(pg);
    await completeTransfer(client, pg);
    const { reviewSellerAuthority } = await import('../services/seller/sellerAuthorityService.js');
    await assert.rejects(
      reviewSellerAuthority(client, {
        vin: VIN,
        sellerUserId: A,
        decision: 'confirmed',
        reason: 'attempting to restore the former owner',
        actor: { id: 'reviewer-1', role: 'admin' },
      }),
      (err) => err.code === 'SELLER_AUTHORITY_SUPERSEDED',
    );
    // Refusing them remains available — only re-fabricating authority is blocked.
    const revoke = await reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: A, decision: 'insufficient',
      reason: 'closing out the superseded claim', actor: { id: 'reviewer-1', role: 'admin' },
    });
    assert.equal(revoke.changed, true);
  } finally {
    await pg.close();
  }
});
