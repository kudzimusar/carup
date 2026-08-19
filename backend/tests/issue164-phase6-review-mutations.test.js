import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');

function source(relative) {
  return fs.readFileSync(path.resolve(BACKEND, relative), 'utf8');
}

async function importMutant(relative, mutate, label) {
  const originalPath = path.resolve(BACKEND, relative);
  const original = fs.readFileSync(originalPath, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `${label}: mutation did not match source anchor`);
  const temp = path.join(
    path.dirname(originalPath),
    `.issue164-phase6-review-${label}-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`,
  );
  fs.writeFileSync(temp, mutated, 'utf8');
  try {
    return await import(`${pathToFileURL(temp).href}?mutation=${Date.now()}-${Math.random()}`);
  } finally {
    fs.unlinkSync(temp);
  }
}

function upSql(raw) {
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

test('Phase 6 mutation M14 — reservation cache status cannot contaminate immutable listing snapshot', async () => {
  const mutant = await importMutant(
    'services/transaction/marketplaceTransactionAuthority.js',
    (s) => s.replace(
      'publication_status: vehicle.publication_status || null,\n    amount:',
      'publication_status: vehicle.publication_status || null,\n    listing_status: vehicle.status || null,\n    amount:',
    ),
    'm14-reservation-cache-in-snapshot',
  );
  const listing = {
    vin: 'VIN-M14',
    current_seller_type: 'private',
    current_seller_type_source: 'seller',
    publication_status: 'published',
    status: 'Available',
  };
  const terms = { amount: 12500, currency: 'USD', currencySource: 'seller' };
  const before = mutant.buildMarketplaceListingSnapshot(listing, 'seller-1', terms);
  const afterReserve = mutant.buildMarketplaceListingSnapshot({ ...listing, status: 'Reserved' }, 'seller-1', terms);
  assert.notEqual(
    before,
    afterReserve,
    'M14 mutant survived: reservation cache state did not change the deliberately contaminated snapshot',
  );
});

test('Phase 6 mutation M15 — reviewer governance cannot be coupled back to buyer/seller actor identity', async () => {
  const mutant = await importMutant(
    'services/transaction/marketplaceTransactionAuthority.js',
    (s) => s.replace(
      'if (!requireActorParticipant) return true;',
      'if (!requireActorParticipant) return Boolean(recordedText(actorId) && (recordedText(actorId) === buyer || recordedText(actorId) === seller));',
    ),
    'm15-reviewer-must-not-impersonate-participant',
  );
  const allowed = mutant.resolveMarketplaceParticipantAuthorization({
    inquiryCurrent: true,
    actorId: 'reviewer-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    requireActorParticipant: false,
  });
  assert.equal(
    allowed,
    false,
    'M15 mutant survived: reviewer governance unexpectedly retained valid lineage authorization',
  );
});

async function terminalInvariantHolds(migrationSql) {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE finance_applications (
        id text PRIMARY KEY,
        vin text NOT NULL,
        user_id text NOT NULL,
        bank_id text NOT NULL,
        requested_amount numeric(14,2) NOT NULL,
        status text NOT NULL DEFAULT 'Pending',
        monthly_payment numeric(14,2) NOT NULL,
        apr numeric(8,3) NOT NULL,
        created_at timestamptz DEFAULT now()
      );
    `);
    await db.exec(upSql(migrationSql));
    await db.exec(`
      INSERT INTO finance_applications(
        id,vin,user_id,bank_id,requested_amount,status,monthly_payment,apr,
        requested_currency,requested_currency_source,decision_source,decision_recorded_at
      ) VALUES ('m16','VIN-M16','buyer-1','bank-1',10000,'Approved',250,8.5,
        'USD','seller','lender:bank-1',now())
    `);
    try {
      await db.exec(`UPDATE finance_applications SET decision_source=NULL WHERE id='m16'`);
      return false;
    } catch (error) {
      return /terminal finance decision requires attributable decision source and time/.test(String(error?.message || error));
    }
  } finally {
    await db.close();
  }
}

test('Phase 6 mutation M16 — terminal finance invariant cannot regress to transition-only guarding', async () => {
  const migration = source('../database/migrations/20260819123000_issue164_phase6_finance_truth.sql');
  assert.equal(await terminalInvariantHolds(migration), true, 'clean migration must preserve terminal decision truth');

  const mutant = migration.replace(
    'IF v_terminal THEN',
    "IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND v_terminal) THEN",
  );
  assert.notEqual(mutant, migration, 'M16 mutation did not match');
  assert.equal(
    await terminalInvariantHolds(mutant),
    false,
    'M16 mutant survived: transition-only guard still blocked same-status provenance erasure',
  );
});
