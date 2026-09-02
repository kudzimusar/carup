/**
 * Behavioural verification of the Operations Control Plane Serena-slice
 * migrations against REAL PostgreSQL (PGlite 17, WASM) — no daemon, no staging:
 *
 *   20260902150000_vehicle_life_generic_compat_types.sql   (M1)
 *   20260902160000_vehicle_seller_authority.sql            (M2)
 *
 * WHY: migration_pglite_check.mjs's NEW_MIGRATIONS list stops at 20260810120000,
 * so a migration added after that date is executed by NO gate in this repo —
 * migration-integrity.test.js only parses markers. This harness applies Up,
 * exercises the constraints behaviourally, and re-applies Up (idempotency).
 *
 * Run:  node database/test/operations_serena_slice_pglite_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const M1_FILE = '20260902150000_vehicle_life_generic_compat_types.sql';
const M2_FILE = '20260902160000_vehicle_seller_authority.sql';

function upOf(file) {
  const raw = readFileSync(join(MIG, file), 'utf8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
}

// The pre-existing objects these migrations reference, reduced to what they touch.
const BOOTSTRAP = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE vehicle_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin              TEXT,
  evidence_type    TEXT NOT NULL,
  evidence_class   TEXT,
  evidence_subtype TEXT,
  metadata         JSONB
);
ALTER TABLE vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_evidence_type_check
  CHECK (evidence_type IN (
    'import_photo','auction_photo','customs_photo','inspection_photo','odometer_photo',
    'damage_photo','repair_photo','dealer_listing_photo','owner_handover_photo',
    'registration_document','insurance_document','police_clearance_document','ownership_transfer_document'
  ));
`;

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function expectError(db, sql, codeSubstr, label) {
  try {
    await db.exec(sql);
    ok(false, `${label} (no error was raised)`);
  } catch (err) {
    const text = `${err.code || ''} ${err.message || ''}`;
    ok(text.includes(codeSubstr) || /check|unique|violat/i.test(text), `${label} [${err.code || err.message}]`);
  }
}

const db = new PGlite();
await db.exec(BOOTSTRAP);

console.log('── Apply M1 Up (generic compat types) ──');
await db.exec(upOf(M1_FILE));

console.log('── M1 behaviour ──');
// The historical 13 values still insert.
await db.exec(`INSERT INTO vehicle_evidence (vin, evidence_type, evidence_class, evidence_subtype)
  VALUES ('GFC27-027051', 'registration_document', 'import', 'commercial_invoice');`);
ok(true, 'the exact Serena shape (legacy registration_document + canonical import/commercial_invoice) still inserts');

// Generic values insert ONLY with canonical class + subtype.
await db.exec(`INSERT INTO vehicle_evidence (vin, evidence_type, evidence_class, evidence_subtype)
  VALUES ('GFC27-027051', 'vehicle_life_document', 'import', 'payment_receipt');`);
ok(true, 'vehicle_life_document inserts with canonical class + subtype');

await expectError(db,
  `INSERT INTO vehicle_evidence (vin, evidence_type) VALUES ('GFC27-027051', 'vehicle_life_document');`,
  '23514', 'vehicle_life_document WITHOUT canonical classification is refused');

await expectError(db,
  `INSERT INTO vehicle_evidence (vin, evidence_type) VALUES ('GFC27-027051', 'not_a_type');`,
  '23514', 'an unknown evidence_type is still refused');

console.log('── Apply M2 Up (vehicle_seller_authority) ──');
await db.exec(upOf(M2_FILE));

console.log('── M2 behaviour ──');
await db.exec(`INSERT INTO vehicle_seller_authority (vin, seller_user_id, claim_type)
  VALUES ('GFC27-027051', 'u_seller', 'owner');`);
ok(true, 'a claim row inserts with defaults (evidence_submitted)');

await expectError(db,
  `INSERT INTO vehicle_seller_authority (vin, seller_user_id, claim_type)
   VALUES ('GFC27-027051', 'u_seller', 'owner');`,
  '23505', 'a duplicate (vin, seller) claim is refused (idempotency backstop)');

await expectError(db,
  `UPDATE vehicle_seller_authority SET status = 'confirmed' WHERE seller_user_id = 'u_seller';`,
  '23514', 'a decision state WITHOUT decider attribution is refused');

await db.exec(`UPDATE vehicle_seller_authority
  SET status = 'confirmed', basis = 'existing_relationship',
      decided_by = 'u_reviewer', decided_by_role = 'admin', decided_at = now()
  WHERE seller_user_id = 'u_seller';`);
ok(true, 'an attributed confirmation persists');

await expectError(db,
  `UPDATE vehicle_seller_authority SET status = 'approved' WHERE seller_user_id = 'u_seller';`,
  '23514', 'an unknown status value is refused');

await expectError(db,
  `UPDATE vehicle_seller_authority SET basis = 'gut_feeling' WHERE seller_user_id = 'u_seller';`,
  '23514', 'an unknown basis value is refused');

const rls = await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'vehicle_seller_authority';`);
ok(rls.rows[0]?.relrowsecurity === true, 'RLS is enabled on vehicle_seller_authority');

const anonGrant = await db.query(`
  SELECT count(*)::int AS n FROM information_schema.role_table_grants
  WHERE table_name = 'vehicle_seller_authority' AND grantee IN ('anon', 'authenticated');`);
ok(anonGrant.rows[0].n === 0, 'anon/authenticated hold no grants on vehicle_seller_authority');

console.log('── Idempotent re-apply ──');
await db.exec(upOf(M1_FILE));
await db.exec(upOf(M2_FILE));
ok(true, 'both Up scripts re-apply cleanly');

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll Operations Serena-slice migration checks passed.');
// Explicit exit: PGlite's WASM runtime can otherwise hold the process open /
// distort the exit code (the finance harness ends the same way).
process.exit(0);
