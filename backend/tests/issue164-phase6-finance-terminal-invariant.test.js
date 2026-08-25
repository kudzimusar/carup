import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

async function setup() {
  const db = await PGlite.create();
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
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
  await db.exec(up('../../database/migrations/20260819123000_issue164_phase6_finance_truth.sql'));
  return db;
}

async function insertApproved(db, id = 'approved-1') {
  await db.query(`
    INSERT INTO finance_applications(
      id,vin,user_id,bank_id,requested_amount,status,monthly_payment,apr,
      requested_currency,requested_currency_source,decision_source,decision_recorded_at
    ) VALUES ($1,'VIN-FIN-P6','buyer-1','bank-1',10000,'Approved',250,8.5,
      'USD','seller','lender:bank-1',now())
  `, [id]);
}

test('Phase 6: terminal finance provenance survives every same-status forward update', async () => {
  const db = await setup();
  try {
    await insertApproved(db);

    await assert.rejects(
      () => db.exec(`UPDATE finance_applications SET decision_source=NULL WHERE id='approved-1'`),
      /terminal finance decision requires attributable decision source and time/,
    );
    await assert.rejects(
      () => db.exec(`UPDATE finance_applications SET decision_recorded_at=NULL WHERE id='approved-1'`),
      /terminal finance decision requires attributable decision source and time/,
    );

    const { rows } = await db.query(`
      SELECT status,decision_source,decision_recorded_at,monthly_payment,apr
        FROM finance_applications WHERE id='approved-1'
    `);
    assert.equal(rows[0].status, 'Approved');
    assert.equal(rows[0].decision_source, 'lender:bank-1');
    assert.ok(rows[0].decision_recorded_at);
    assert.equal(Number(rows[0].monthly_payment), 250);
    assert.equal(Number(rows[0].apr), 8.5);
  } finally {
    await db.close();
  }
});

test('Phase 6: approved/disbursed terms cannot be erased while terminal status remains', async () => {
  const db = await setup();
  try {
    await insertApproved(db, 'approved-terms');

    await assert.rejects(
      () => db.exec(`UPDATE finance_applications SET monthly_payment=NULL WHERE id='approved-terms'`),
      /approved\/disbursed finance decision requires real APR and monthly payment terms/,
    );
    await assert.rejects(
      () => db.exec(`UPDATE finance_applications SET apr=NULL WHERE id='approved-terms'`),
      /approved\/disbursed finance decision requires real APR and monthly payment terms/,
    );

    await db.exec(`
      INSERT INTO finance_applications(
        id,vin,user_id,bank_id,requested_amount,status,monthly_payment,apr,
        requested_currency,requested_currency_source,decision_source,decision_recorded_at
      ) VALUES ('rejected-1','VIN-FIN-P6','buyer-1','bank-1',10000,'Rejected',NULL,NULL,
        'USD','seller','lender:bank-1',now())
    `);
    await assert.rejects(
      () => db.exec(`UPDATE finance_applications SET decision_source=NULL WHERE id='rejected-1'`),
      /terminal finance decision requires attributable decision source and time/,
    );

    const rejected = await db.query(`
      SELECT status,monthly_payment,apr,decision_source
        FROM finance_applications WHERE id='rejected-1'
    `);
    assert.equal(rejected.rows[0].status, 'Rejected');
    assert.equal(rejected.rows[0].monthly_payment, null);
    assert.equal(rejected.rows[0].apr, null);
    assert.equal(rejected.rows[0].decision_source, 'lender:bank-1');
  } finally {
    await db.close();
  }
});
