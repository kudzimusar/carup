/**
 * Issue #158 — TERMINAL WRITE OPERATION IDENTITY: adversarial battery.
 *
 * The terminal instant is the only timestamp two ledger writes can ever share, so it is
 * the only place a uniqueness conflict must be classified as "this write landed twice" or
 * "a different write lost a race". The previously shipped rule classified by CONTENT
 * (signer + VIN + event type + payload). Content describes WHAT was written, never WHICH
 * INVOCATION wrote it, so two genuinely independent calls with the same subject data were
 * indistinguishable from one call retried after a lost response — and the loser of the race
 * was told its write had persisted when it had not.
 *
 * This suite proves the replacement contract end to end against a REAL PostgreSQL (PGlite)
 * database running the REAL migrations, with REAL secp256k1 signatures:
 *
 *   same operation id + same persisted content -> idempotent return of the existing row
 *   same operation id + different content      -> explicit refusal (identity reuse)
 *   different operation id + identical content -> explicit refusal (distinct operation)
 *   no operation id at the terminal instant    -> explicit refusal before anything is written
 *
 * and that the identity is DURABLE: it survives commit, a lost response, a caller crash and
 * a process restart, because it is derived from state the caller has already committed.
 *
 * It complements issue-158-boundary-upgrade-postgres.test.js, which owns the boundary and
 * race scenarios. This suite owns payload normalization, identity validation, the
 * database-level guards, the pre-migration upgrade path, and mutation coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET = 'issue158-operation-identity-master-secret';
process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET = 'issue158-operation-identity-system-secret';

const {
  finalizedLedgerDb, makeClient, parkAtTerminalMinusOne, up,
  ISSUE_158_MIGRATIONS, resetInjection, TERMINAL, GENESIS,
} = await import('./helpers/issue158LedgerHarness.mjs');

const { supabase } = await import('../db/supabase.js');
const {
  addEvent, verifyChain, calculateHash, normalizePersistedPayload,
} = await import('../services/blockchain/blockchainService.js');
const {
  custodyGeneration, deriveStakeholderKey, signLedgerHash,
} = await import('../services/blockchain/blockchainKeyCustodyService.js');

const SERVICE_SOURCE_URL = new URL('../services/blockchain/blockchainService.js', import.meta.url);
const IDENTITY_MIGRATION = '20260830060000_issue158_terminal_operation_identity.sql';

// Migrations applied on top of the finalized custody baseline.
const TERMINAL_MIGRATIONS = ISSUE_158_MIGRATIONS.slice(2);

/** Standard fixture: a finalized DB with one ACTIVE key, parked one ms below terminal. */
async function terminalReadyDb(signerId, { migrations = TERMINAL_MIGRATIONS } = {}) {
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const derived = deriveStakeholderKey(signerId);
  const db = await finalizedLedgerDb({
    keyPem: derived.publicKeyPem, keyCreatedAt, signerId, migrations,
  });
  await db.query('SELECT public.blockchain_authorize_custody_generation($1::text)', [custodyGeneration()]);
  await parkAtTerminalMinusOne(db, signerId);
  return db;
}

/** Bind the runtime's supabase singleton to a PGlite database for the duration of a test. */
function bind(t, db) {
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  const client = makeClient(db);
  supabase.from = client.from;
  supabase.rpc = client.rpc;
  t.after(() => {
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
    resetInjection();
  });
}

function withKeyVersion(t, version) {
  const saved = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = version;
  t.after(() => {
    if (saved === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = saved;
  });
}

/** Register an extra signer's ACTIVE key directly (the harness owns the database). */
async function registerSigner(db, signerId, keyVersion) {
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const derived = deriveStakeholderKey(signerId);
  await db.query(`
    INSERT INTO public_keys(id,user_id,public_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider)
    VALUES ($1::text,$2::text,$3::text,'secp256k1','ACTIVE',$4::text,$5::text,$6::text,'derived_master_secret')
  `, [`key-${signerId}`, signerId, derived.publicKeyPem, keyCreatedAt, derived.keyRef, keyVersion]);
  await parkAtTerminalMinusOne(db, signerId);
}

const terminalRowCount = async (db, signerId) => (await db.query(`
  SELECT count(*)::int AS c FROM blockchain_events
   WHERE "timestamp"=$1::text AND split_part(signature,':',1)=$2::text
`, [TERMINAL, signerId])).rows[0].c;

// ═══════════════════════════════════════════════════════════════════════════════════
// 1. PAYLOAD NORMALIZATION — the comparison must run through the SAME serialization the
//    ledger persists, or a legitimate retry is rejected forever.
// ═══════════════════════════════════════════════════════════════════════════════════

// The canonicalizer as it stood BEFORE the fix: structural, applied to the in-memory
// object. Kept here verbatim so the defect it caused can be demonstrated rather than
// asserted, and so the fix's necessity is proven rather than claimed.
function preFixCanonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(preFixCanonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${preFixCanonicalize(value[k])}`).join(',')}}`;
}

test('Issue #158: the pre-fix canonicalizer genuinely diverges from what the ledger persists', () => {
  // Each entry proves the OLD rule compared two different representations of ONE attempted
  // write, so this is a real defect and the normalization guard is load-bearing rather
  // than defensive decoration.
  const divergent = [
    { name: 'undefined object field', payload: { a: 1, b: undefined } },
    { name: 'Date value', payload: { at: new Date('2026-08-30T00:00:00.000Z') } },
    { name: 'nested undefined', payload: { outer: { keep: 'x', drop: undefined } } },
    { name: 'toJSON projection', payload: { wrapped: { toJSON: () => ({ v: 1 }) } } },
  ];
  for (const { name, payload } of divergent) {
    assert.notEqual(
      preFixCanonicalize(payload), preFixCanonicalize(normalizePersistedPayload(payload)),
      `${name}: the pre-fix rule must be shown to compare two different representations`,
    );
  }

  // Not every JSON-lossy shape was broken, and saying so precisely matters: `undefined`
  // inside an ARRAY serializes to null rather than being dropped, and a non-finite number
  // serializes to null, so both sides already agreed. The defect was specific to shapes
  // where serialization CHANGES the key set or the value's type.
  const alreadyAgreed = [
    { name: 'undefined inside an array', payload: { list: [1, undefined, 3] } },
    { name: 'non-finite number', payload: { ratio: Number.POSITIVE_INFINITY } },
    { name: 'NaN', payload: { n: Number.NaN } },
    { name: 'plain scalars', payload: { n: null, t: true, i: 0, s: '' } },
  ];
  for (const { name, payload } of alreadyAgreed) {
    assert.equal(
      preFixCanonicalize(payload), preFixCanonicalize(normalizePersistedPayload(payload)),
      `${name}: must be reported honestly as a shape the old rule already handled`,
    );
  }
});

test('Issue #158: normalizePersistedPayload fails closed on a non-persistable payload', () => {
  assert.deepEqual(normalizePersistedPayload({ a: 1, b: undefined }), { a: 1 });
  assert.deepEqual(normalizePersistedPayload({ at: new Date('2026-08-30T00:00:00.000Z') }), {
    at: '2026-08-30T00:00:00.000Z',
  });
  assert.deepEqual(normalizePersistedPayload({ list: [1, undefined, 3] }), { list: [1, null, 3] });
  assert.deepEqual(normalizePersistedPayload({ r: Number.POSITIVE_INFINITY }), { r: null });
  // A value JSON cannot represent at all must not be silently written as nothing.
  assert.throws(() => normalizePersistedPayload(undefined), /not JSON-persistable/i);
  assert.throws(() => normalizePersistedPayload(() => {}), /not JSON-persistable/i);
});

test('Issue #158: a lost-response retry is idempotent across every JSON-lossy payload shape', async (t) => {
  withKeyVersion(t, 'pn1');
  const db = await terminalReadyDb('payload-root');
  bind(t, db);
  try {
    const shapes = [
      { id: 'undefinedfield', payload: () => ({ a: 1, b: undefined }) },
      { id: 'datevalue', payload: () => ({ at: new Date('2026-08-30T00:00:00.000Z') }) },
      { id: 'nestedmixed', payload: () => ({ o: { z: 1, a: [1, { q: null }, 'x'] } }) },
      { id: 'scalars', payload: () => ({ n: null, t: true, f: false, i: 0, s: '', d: -1.5 }) },
      { id: 'nonfinite', payload: () => ({ r: Number.POSITIVE_INFINITY, nan: Number.NaN }) },
    ];
    for (const shape of shapes) await registerSigner(db, `payload-${shape.id}`, 'pn1');

    for (const shape of shapes) {
      const signer = `payload-${shape.id}`;
      const vin = `VINPAY${shape.id.slice(0, 10).toUpperCase()}`;
      const operationId = `partsentry_log:${shape.id}`;
      const build = () => ({ ...shape.payload(), mechanicId: signer });

      const first = await addEvent(vin, 'Mechanic Inspection', build(), 'SYSTEM_SIGNATURE', { operationId });
      assert.equal(first.timestamp, TERMINAL, `${shape.id}: must land on the terminal instant`);

      // The response was lost. A fresh retry rebuilds the SAME logical payload from the
      // same source data — including the values JSON.stringify transforms or drops.
      const retry = await addEvent(vin, 'Mechanic Inspection', build(), 'SYSTEM_SIGNATURE', { operationId });
      assert.equal(retry.idempotent, true, `${shape.id}: the retry must be idempotent`);
      assert.equal(retry.id, first.id, `${shape.id}: the retry must resolve to the persisted row`);
      assert.equal(retry.currentHash, first.currentHash, `${shape.id}: the retry must report the stored hash`);

      assert.equal(await terminalRowCount(db, signer), 1, `${shape.id}: exactly one terminal row`);
      const chain = await verifyChain(vin);
      assert.equal(chain.verified, true, `${shape.id}: ${chain.reason || 'chain must verify'}`);
      assert.ok(chain.chain.every((e) => !e.note), `${shape.id}: no signature check may be skipped`);
    }
  } finally {
    await db.close();
  }
});

test('Issue #158: object key order is irrelevant but array order is meaningful', async (t) => {
  withKeyVersion(t, 'ko1');
  const SIGNER = 'order-mech';
  const db = await terminalReadyDb(SIGNER);
  bind(t, db);
  try {
    const VIN = 'VINKEYORDER00001';
    const OP = 'partsentry_log:key-order-1';

    const first = await addEvent(
      VIN, 'Mechanic Inspection',
      { mechanicId: SIGNER, alpha: 1, beta: { x: 1, y: [1, 2, 3] }, gamma: 'g' },
      'SYSTEM_SIGNATURE', { operationId: OP },
    );
    const reordered = await addEvent(
      VIN, 'Mechanic Inspection',
      { gamma: 'g', beta: { y: [1, 2, 3], x: 1 }, alpha: 1, mechanicId: SIGNER },
      'SYSTEM_SIGNATURE', { operationId: OP },
    );
    assert.equal(reordered.idempotent, true, 'object key order must not change the identity');
    assert.equal(reordered.id, first.id);

    // A reordered ARRAY is different content and must be refused as identity reuse.
    await assert.rejects(
      () => addEvent(
        VIN, 'Mechanic Inspection',
        { mechanicId: SIGNER, alpha: 1, beta: { x: 1, y: [3, 2, 1] }, gamma: 'g' },
        'SYSTEM_SIGNATURE', { operationId: OP },
      ),
      /operation id reuse refused/i,
      'array order must remain meaningful',
    );

    assert.equal(await terminalRowCount(db, SIGNER), 1);
    assert.equal((await verifyChain(VIN)).verified, true);
  } finally {
    await db.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 2. IDENTITY VALIDATION AND PROVENANCE.
// ═══════════════════════════════════════════════════════════════════════════════════

test('Issue #158: a malformed operation identity is loud, never silently discarded', async (t) => {
  withKeyVersion(t, 'iv1');
  const SIGNER = 'validate-mech';
  const db = await terminalReadyDb(SIGNER);
  bind(t, db);
  try {
    const payload = { mechanicId: SIGNER, note: 'validation' };
    const call = (operationId) => addEvent('VINVALIDATE00001', 'Mechanic Inspection', payload, 'SYSTEM_SIGNATURE', { operationId });

    // A non-string is a caller BUG. Coercing it to null would silently downgrade a caller
    // that believes it supplied an identity, and it would never learn why its terminal
    // write was refused.
    for (const bad of [42, {}, [], true]) {
      await assert.rejects(() => call(bad), /operation id must be a string/i, `${typeof bad} must be refused`);
    }
    await assert.rejects(() => call('x'.repeat(400)), /maximum representable length/i);

    // Absent / blank is "no identity", which at the terminal instant is itself fatal.
    for (const none of [undefined, null, '   ']) {
      await assert.rejects(() => call(none), /requires a durable operation id/i);
    }

    const written = await db.query('SELECT count(*)::int AS c FROM blockchain_events');
    assert.equal(written.rows[0].c, 0, 'no refused attempt may have written anything');
  } finally {
    await db.close();
  }
});

test('Issue #158: every stakeholder ledger writer supplies a DURABLE operation identity', () => {
  // A durable identity must come from state the caller has ALREADY committed, so a fresh
  // retry recomputes it. An identity minted inside the write path (randomUUID, Date.now)
  // is a new value on every attempt and therefore proves nothing.
  const writers = [
    ['../services/partsentry/partsentryService.js', /operationId: `partsentry_log:\$\{encodeURIComponent\(String\(newId\)\)\}`/],
    ['../services/insurance/insuranceService.js', /operationId: `insurance_policy:\$\{encodeURIComponent\(id\)\}`/],
    ['../services/finance/financeService.js', /operationId: `finance_application:\$\{encodeURIComponent\(id\)\}`/],
    ['../services/security/securityService.js', /operationId: `stolen_alert:/],
    ['../services/eventBus/listeners.js', /operationId: `reservation_recorded:/],
  ];
  for (const [rel, pattern] of writers) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(src, pattern, `${rel} must bind its ledger write to a durable operation identity`);
  }

  // addEvent must never manufacture an identity for itself.
  const service = readFileSync(SERVICE_SOURCE_URL, 'utf8');
  const addEventBody = service.slice(service.indexOf('export async function addEvent'));
  assert.doesNotMatch(addEventBody, /operationId\s*=\s*(crypto\.)?randomUUID/, 'addEvent must not mint an identity');
  assert.doesNotMatch(addEventBody, /operationId\s*=\s*`?[^;]*Date\.now/, 'addEvent must not clock an identity');
});

test('Issue #158: PartSentry refuses to write an unidentifiable ledger event', () => {
  // The durable identity is the COMMITTED parts-log row id. If the insert returned no id
  // there is nothing durable to key on, and the service must abort rather than fall back
  // to an identity a retry could not reproduce.
  const src = readFileSync(new URL('../services/partsentry/partsentryService.js', import.meta.url), 'utf8');
  assert.match(src, /refusing to write an unidentifiable ledger event/i);
  const guardAt = src.indexOf('refusing to write an unidentifiable ledger event');
  const addEventAt = src.indexOf("addEvent(\n    vin,\n    'Mechanic Inspection'");
  assert.ok(guardAt > 0 && addEventAt > guardAt, 'the guard must precede the ledger write');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 3. THE FOUR TERMINAL OUTCOMES, PLUS DATABASE-LEVEL TOTALITY.
// ═══════════════════════════════════════════════════════════════════════════════════

test('Issue #158: the terminal instant separates retries from independent operations', async (t) => {
  withKeyVersion(t, 'to1');
  const SIGNER = 'outcome-mech';
  const db = await terminalReadyDb(SIGNER);
  bind(t, db);
  try {
    const VIN = 'VINOUTCOME000001';
    const OP = 'partsentry_log:outcome-1';
    const content = { mechanicId: SIGNER, part: 'brake-pad', odometer: 120000 };

    // (a) first write
    const first = await addEvent(VIN, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: OP });
    assert.equal(first.timestamp, TERMINAL);
    assert.ok(!first.idempotent, 'a first write is not a retry');
    assert.equal(first.operationId, OP);

    // (b) same operation id + same content -> idempotent
    const retry = await addEvent(VIN, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: OP });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.id, first.id);
    assert.equal(retry.operationId, OP);

    // (c) same operation id + different content -> explicit identity-reuse refusal
    await assert.rejects(
      () => addEvent(VIN, 'Mechanic Inspection', { ...content, odometer: 120001 }, 'SYSTEM_SIGNATURE', { operationId: OP }),
      /operation id reuse refused/i,
    );

    // (d) different operation id + IDENTICAL content -> explicit refusal.
    //     This is the invariant content equality could not express: same signer, same VIN,
    //     same event type and same payload is NOT the same operation.
    await assert.rejects(
      () => addEvent(VIN, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:outcome-2' }),
      /a distinct durable operation already owns the signer terminal instant/i,
    );

    // (e) no operation id at all -> refused BEFORE anything is written
    await assert.rejects(
      () => addEvent(VIN, 'Mechanic Inspection', { ...content }),
      /terminal ledger event requires a durable operation id/i,
    );

    // (f) a different VIN or event type under the same identity is still the same signer's
    //     one terminal slot, and the content guard refuses it.
    await assert.rejects(
      () => addEvent('VINOUTCOME000002', 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: OP }),
      /operation id reuse refused/i,
    );
    await assert.rejects(
      () => addEvent(VIN, 'Damage Report', { ...content }, 'SYSTEM_SIGNATURE', { operationId: OP }),
      /operation id reuse refused/i,
    );

    assert.equal(await terminalRowCount(db, SIGNER), 1, 'exactly one terminal event per signer');
    const total = await db.query('SELECT count(*)::int AS c FROM blockchain_events');
    assert.equal(total.rows[0].c, 1, 'no refusal may have written anything');

    const chain = await verifyChain(VIN);
    assert.equal(chain.verified, true, chain.reason || 'chain must verify');
    assert.equal(chain.count, 1);
    assert.ok(chain.chain.every((e) => !e.note), 'no signature check may be skipped');
  } finally {
    await db.close();
  }
});

test('Issue #158: the database itself refuses an unidentifiable or duplicated terminal row', async (t) => {
  withKeyVersion(t, 'db1');
  const SIGNER = 'dbguard-mech';
  const db = await terminalReadyDb(SIGNER);
  bind(t, db);
  try {
    // The runtime guard is not the only line of defence: a direct writer that bypasses
    // addEvent entirely still cannot create a terminal row whose provenance is undecidable.
    await assert.rejects(
      db.query(`
        INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
        VALUES ('0','h','VINDBGUARD000001','Mechanic Inspection','{}',$1::text,$2::text)
      `, [TERMINAL, `${SIGNER}:sig`]),
      /blockchain_events_terminal_operation_id_required/,
      'the CHECK constraint must make the refusal total',
    );
    // A whitespace-only identity is not an identity.
    await assert.rejects(
      db.query(`
        INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature,operation_id)
        VALUES ('0','h','VINDBGUARD000001','Mechanic Inspection','{}',$1::text,$2::text,'   ')
      `, [TERMINAL, `${SIGNER}:sig`]),
      /blockchain_events_terminal_operation_id_required/,
    );

    // A non-terminal row needs no identity: no guarantee is claimed for it.
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ('0','h2','VINDBGUARD000001','Mechanic Inspection','{}','2026-08-30T00:00:00.000Z','sys:sig')
    `);

    // One signer may consume a given operation identity at most ONCE, at any timestamp.
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature,operation_id)
      VALUES ('0','h3','VINDBGUARD000002','Mechanic Inspection','{}',$1::text,'signer-a:sig','partsentry_log:shared')
    `, [TERMINAL]);
    await assert.rejects(
      db.query(`
        INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature,operation_id)
        VALUES ('0','h4','VINDBGUARD000003','Mechanic Inspection','{}','2026-08-30T00:00:01.000Z','signer-a:sig','partsentry_log:shared')
      `),
      /uq_blockchain_events_signer_operation_id/,
      'one signer may not reuse a durable operation identity for a second ledger event',
    );

    // The index is scoped PER SIGNER, so a different signer may legitimately hold the same
    // identity string. Asserted explicitly so the scope of the guarantee is not overstated.
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature,operation_id)
      VALUES ('0','h5','VINDBGUARD000004','Mechanic Inspection','{}','2026-08-30T00:00:02.000Z','signer-b:sig','partsentry_log:shared')
    `);

    // The pre-existing per-signer terminal invariant is untouched.
    await assert.rejects(
      db.query(`
        INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature,operation_id)
        VALUES ('0','h6','VINDBGUARD000005','Mechanic Inspection','{}',$1::text,'signer-a:sig2','partsentry_log:other')
      `, [TERMINAL]),
      /uq_blockchain_events_terminal_signer/,
      'at most one terminal event per signer must still hold',
    );
  } finally {
    await db.close();
  }
});

test('Issue #158: a terminal row written before the identity migration cannot be silently retried', async (t) => {
  withKeyVersion(t, 'lg1');
  const SIGNER = 'legacy-mech';
  // Apply everything EXCEPT the identity migration, write a terminal row the old way, then
  // upgrade. The backfilled identity must be one no caller can ever reproduce.
  const db = await terminalReadyDb(SIGNER, { migrations: TERMINAL_MIGRATIONS.slice(0, -1) });
  bind(t, db);
  try {
    const VIN = 'VINLEGACYTERM001';
    const content = { mechanicId: SIGNER, note: 'written before identities existed' };
    const hash = calculateHash(GENESIS, VIN, 'Mechanic Inspection', TERMINAL, content);
    const sig = signLedgerHash(SIGNER, hash);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ($1::text,$2::text,$3::text,'Mechanic Inspection',$4::text,$5::text,$6::text)
    `, [GENESIS, hash, VIN, JSON.stringify(content), TERMINAL, `${SIGNER}:${sig.signatureHex}`]);

    await db.exec(up(IDENTITY_MIGRATION));

    const backfilled = await db.query(
      'SELECT operation_id FROM blockchain_events WHERE "timestamp"=$1::text', [TERMINAL],
    );
    assert.match(
      backfilled.rows[0].operation_id, /^legacy-terminal:/,
      'a pre-identity terminal row must be marked unidentifiable',
    );

    // A retry that straddles the upgrade is REFUSED, not acknowledged: the stored row
    // genuinely cannot be proven to be the same invocation.
    await assert.rejects(
      () => addEvent(VIN, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:straddle-1' }),
      /a distinct durable operation already owns the signer terminal instant/i,
      'a straddling retry must fail closed rather than be falsely acknowledged',
    );
    assert.equal(await terminalRowCount(db, SIGNER), 1);
    const chain = await verifyChain(VIN);
    assert.equal(chain.verified, true, chain.reason || 'the legacy chain must still verify');
    assert.ok(chain.chain.every((e) => !e.note));
  } finally {
    await db.close();
  }
});

test('Issue #158: deploy-before-migrate keeps ordinary writes alive and fails terminal ones closed', async (t) => {
  withKeyVersion(t, 'dm1');
  const SIGNER = 'premigrate-mech';
  // The runtime already records identities; the database has NOT applied the identity
  // migration yet. This is the supported rolling-deployment ordering.
  const db = await terminalReadyDb(SIGNER, { migrations: TERMINAL_MIGRATIONS.slice(0, -1) });
  bind(t, db);
  try {
    // A NON-terminal write never references the column, so a rolling deploy cannot break
    // ordinary signing. No uniqueness or idempotency guarantee is claimed for such rows.
    await db.query(`
      INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
      VALUES ($1::text,TIMESTAMPTZ '2026-08-30 00:00:00+00')
      ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
    `, [SIGNER]);
    const ordinary = await addEvent(
      'VINPREMIG0000001', 'Mechanic Inspection', { mechanicId: SIGNER, note: 'rolling deploy' },
      'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:premigrate-1' },
    );
    assert.notEqual(ordinary.timestamp, TERMINAL);
    assert.equal(ordinary.operationId, null, 'a non-terminal row records no identity');
    assert.equal((await verifyChain('VINPREMIG0000001')).verified, true);

    // A TERMINAL write may NOT proceed: its whole contract depends on the column. It fails
    // closed, and the error names the missing column so an operator can diagnose it.
    await parkAtTerminalMinusOne(db, SIGNER);
    await assert.rejects(
      () => addEvent(
        'VINPREMIG0000002', 'Mechanic Inspection', { mechanicId: SIGNER, note: 'terminal without the column' },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:premigrate-2' },
      ),
      /operation_id/,
      'a terminal write must fail closed naming the absent column',
    );
    const written = await db.query(
      'SELECT count(*)::int AS c FROM blockchain_events WHERE vin=$1', ['VINPREMIG0000002'],
    );
    assert.equal(written.rows[0].c, 0, 'the refused terminal write must have persisted nothing');
  } finally {
    await db.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 4. TIMESTAMP AUTHORITY — malformed, NULL, non-finite and unrepresentable values are
//    quarantined by the DATABASE, never by a caller clock.
// ═══════════════════════════════════════════════════════════════════════════════════

test('Issue #158: the boundary parser quarantines every unusable timestamp shape', async (t) => {
  withKeyVersion(t, 'tp1');
  const SIGNER = 'parse-mech';
  const db = await terminalReadyDb(SIGNER);
  bind(t, db);
  try {
    const cases = [
      [null, null, 'SQL NULL'],
      ['', null, 'empty string'],
      ['   ', null, 'blank string'],
      ['not-a-timestamp', null, 'malformed'],
      ['2026-13-45T99:99:99Z', null, 'structurally valid but impossible'],
      ['infinity', null, 'positive infinity'],
      ['-infinity', null, 'negative infinity'],
      ['NaN', null, 'NaN'],
      ['10000-01-01T00:00:00.000Z', null, 'beyond the last representable instant'],
      ['0000-06-01T00:00:00.000Z', null, 'before the first representable instant'],
      // The whole final representable day is legitimate history and must survive.
      ['9999-12-31T00:00:00.000Z', '9999-12-31T00:00:00.000Z', 'start of the final representable day'],
      [TERMINAL, TERMINAL, 'the terminal instant itself'],
      ['2026-08-30T12:34:56.789Z', '2026-08-30T12:34:56.789Z', 'an ordinary instant'],
    ];

    for (const [input, expected, label] of cases) {
      const { rows } = await db.query(
        `SELECT to_char(public.blockchain_boundary_parse_ts($1::text) AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`,
        [input],
      );
      assert.equal(rows[0].t, expected, `${label}: expected ${expected === null ? 'quarantine' : expected}`);
    }

    // A poisoned watermark can never be produced, so signing continues from a finite floor.
    const signed = await addEvent(
      'VINPARSE00000001', 'Mechanic Inspection', { mechanicId: SIGNER, note: 'after the parse battery' },
      'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:parse-1' },
    );
    assert.equal(signed.timestamp, TERMINAL);
    assert.ok(Number.isFinite(Date.parse(signed.timestamp)));
  } finally {
    await db.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 5. MUTATION TESTING — every load-bearing guard is removed in turn and the removal must
//    be OBSERVABLE. A guard whose deletion changes nothing is not protecting anything.
// ═══════════════════════════════════════════════════════════════════════════════════

const MUTANTS = [
  {
    name: 'terminal writes no longer require a durable operation identity',
    find: '  if (timestamp === TERMINAL_EVENT_TIMESTAMP && !operationId) {',
    replace: '  if (false && timestamp === TERMINAL_EVENT_TIMESTAMP && !operationId) {',
    async expectMutantMisbehaves(mutant, ctx) {
      const outcome = await mutant.addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, note: 'unidentified' })
        .then(() => 'accepted', (e) => e.message);
      assert.doesNotMatch(
        String(outcome), /requires a durable operation id/i,
        'the mutant must lose the fail-closed precondition',
      );
    },
    async expectRealHolds(ctx) {
      await assert.rejects(
        () => addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, note: 'unidentified' }),
        /terminal ledger event requires a durable operation id/i,
      );
    },
  },
  {
    name: 'the content consistency guard on a reused operation identity',
    find: '  if (!sameContent) {',
    replace: '  if (false && !sameContent) {',
    async expectMutantMisbehaves(mutant, ctx) {
      const OP = 'partsentry_log:mutant-content-1';
      await mutant.addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, v: 1 }, 'SYSTEM_SIGNATURE', { operationId: OP });
      const reused = await mutant.addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, v: 2 }, 'SYSTEM_SIGNATURE', { operationId: OP })
        .then((r) => r, () => null);
      assert.ok(reused?.idempotent, 'the mutant must wrongly acknowledge a different write');
    },
    async expectRealHolds(ctx) {
      const OP = 'partsentry_log:real-content-1';
      await addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, v: 1 }, 'SYSTEM_SIGNATURE', { operationId: OP });
      await assert.rejects(
        () => addEvent(ctx.vin, 'Mechanic Inspection', { mechanicId: ctx.signer, v: 2 }, 'SYSTEM_SIGNATURE', { operationId: OP }),
        /operation id reuse refused/i,
      );
    },
  },
  {
    name: 'the operation-identity match (reverting to pure content classification)',
    find: "  if (String(signerRow.operation_id || '') !== String(operationId)) {",
    replace: "  if (false && String(signerRow.operation_id || '') !== String(operationId)) {",
    /**
     * This mutant IS the reviewed defect: with the identity comparison gone, classification
     * falls back to content alone, so an INDEPENDENT operation with identical content is
     * acknowledged as a retry of a write it never made.
     */
    async expectMutantMisbehaves(mutant, ctx) {
      const content = { mechanicId: ctx.signer, note: 'same content, different operations' };
      await mutant.addEvent(ctx.vin, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:mutant-lookup-a' });
      const independent = await mutant.addEvent(ctx.vin, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:mutant-lookup-b' })
        .then((r) => r, () => null);
      assert.ok(
        independent?.idempotent,
        'the mutant must reproduce the reviewed defect: an independent write acknowledged as a retry',
      );
    },
    async expectRealHolds(ctx) {
      const content = { mechanicId: ctx.signer, note: 'same content, different operations' };
      await addEvent(ctx.vin, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:real-lookup-a' });
      await assert.rejects(
        () => addEvent(ctx.vin, 'Mechanic Inspection', { ...content }, 'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:real-lookup-b' }),
        /a distinct durable operation already owns the signer terminal instant/i,
      );
    },
  },
];

test('Issue #158: every terminal guard is load-bearing under mutation', async (t) => {
  const source = readFileSync(SERVICE_SOURCE_URL, 'utf8');

  for (const [index, mutant] of MUTANTS.entries()) {
    assert.equal(
      source.split(mutant.find).length - 1, 1,
      `guard ${index} must be uniquely locatable so the mutation is precise: ${mutant.name}`,
    );

    await t.test(`real module holds: ${mutant.name}`, async (st) => {
      withKeyVersion(st, `mu${index}r`);
      const signer = `mutant-real-${index}`;
      const db = await terminalReadyDb(signer);
      bind(st, db);
      try {
        await mutant.expectRealHolds({ signer, vin: `VINMUTREAL0000${index}` });
      } finally {
        await db.close();
      }
    });

    const mutantUrl = new URL(`../services/blockchain/__mutant__${index}.blockchainService.js`, import.meta.url);
    writeFileSync(mutantUrl, source.replace(mutant.find, mutant.replace), 'utf8');
    try {
      await t.test(`mutant fails: ${mutant.name}`, async (st) => {
        withKeyVersion(st, `mu${index}m`);
        const signer = `mutant-broken-${index}`;
        const db = await terminalReadyDb(signer);
        bind(st, db);
        const mutantModule = await import(mutantUrl.href);
        await mutant.expectMutantMisbehaves(mutantModule, { signer, vin: `VINMUTBAD00000${index}` })
          .finally(() => db.close());
      });
    } finally {
      try { unlinkSync(mutantUrl); } catch { /* already removed */ }
    }
  }
});
