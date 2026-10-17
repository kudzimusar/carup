/**
 * OC-3D 4J — one canonical write boundary for the hash-chained audit ledger.
 *
 * Before OC-3D two modules wrote `blockchain_events`: blockchainService.addEvent and
 * diasporaOwnershipHandoffService, which re-implemented the envelope (tail lookup, previous_hash,
 * current_hash, system signature) against its injected client. Two writers of one chain is two places
 * for the envelope to drift — and both raced on the tail. Now domain code submits an event REQUEST;
 * addEvent alone produces the envelope, through the caller's client if it has one.
 *
 * Scope of the source contract: every .js file under backend/services, backend/routes,
 * backend/middleware and backend/config, plus backend/server.js. Out of scope (stated): tests, scripts,
 * and the golden fixture's teardown DELETE (an owner decision recorded in the ledger doc — it removes
 * rows, it builds no envelope).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_LEDGER_HASH_VERSION;

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(here, '..');
const { createLedgerDatabase, seedVehicle, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { supabase } = await import('../db/supabase.js');
const { addEvent, verifyChain } = await import('../services/blockchain/blockchainService.js');

function runtimeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) out.push(full);
    }
  };
  for (const root of ['services', 'routes', 'middleware', 'config']) walk(path.join(backend, root));
  out.push(path.join(backend, 'server.js'));
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LEDGER_INSERT = /from\(\s*(['"]blockchain_events['"]|TIMELINE_EVENTS)\s*\)\s*\.(insert|upsert|update)\(/;
const ENVELOPE_LITERAL = /previous_hash\s*:[\s\S]{0,200}current_hash\s*:/;
const ENVELOPE_PRIMITIVE = /\b(calculateHash|calculateHashV2|computeLedgerHash|signSystemLedgerHash|signLedgerHash)\s*\(/;
const BOUNDARY = 'services/blockchain/blockchainService.js';
const KEY_CUSTODY = 'services/blockchain/blockchainKeyCustodyService.js';

test('OC-3D 4J source: only the ledger service inserts ledger rows or builds a ledger envelope', () => {
  const files = runtimeFiles();
  assert.ok(files.length > 150, `anti-vacuity: scanned ${files.length} runtime files`);
  const found = { insert: [], envelope: [], primitive: [] };
  for (const file of files) {
    const rel = path.relative(backend, file).split(path.sep).join('/');
    const code = stripComments(readFileSync(file, 'utf8'));
    if (LEDGER_INSERT.test(code)) found.insert.push(rel);
    if (ENVELOPE_LITERAL.test(code)) found.envelope.push(rel);
    if (ENVELOPE_PRIMITIVE.test(code) && rel !== KEY_CUSTODY) found.primitive.push(rel);
  }
  // Positive control: each pattern finds the one module that legitimately does this.
  assert.deepEqual(found.insert, [BOUNDARY], `ledger inserts outside the boundary: ${found.insert.join(', ')}`);
  assert.deepEqual(found.envelope, [BOUNDARY], `hand-built envelopes outside the boundary: ${found.envelope.join(', ')}`);
  assert.deepEqual(found.primitive, [BOUNDARY], `hash/signature primitives used outside the boundary: ${found.primitive.join(', ')}`);
});

let db;
const realFrom = supabase.from;
before(async () => { db = await createLedgerDatabase(); });
after(async () => { supabase.from = realFrom; await db?.close(); });

test('OC-3D 4J behaviour: a domain request through an injected client — the boundary writes ONLY through it', async () => {
  const vin = 'OC3DBOUNDARY00001';
  await seedVehicle(db, vin);
  const client = supabaseOver(db);
  // The global client must not be touched: any use of it is a failure.
  supabase.from = () => { throw new Error('the global client was used instead of the injected one'); };
  let event;
  try {
    event = await addEvent(vin, 'CROSS_BORDER_OWNERSHIP_HANDOFF', { importOrderId: 'order-1', statement: 'handed off' }, 'SYSTEM_SIGNATURE', { client, signerId: 'system' });
  } finally {
    supabase.from = (table) => client.from(table);
  }
  assert.ok(event.id, 'the boundary returns the row it wrote');
  assert.match(event.signature, /^system:[0-9a-f]{64}$/);
  const report = await verifyChain(vin);
  assert.equal(report.verified, true);
  assert.equal(report.authenticated, true);
});

test('OC-3D 4J behaviour: the signer is named by the request, not inferred from payload keys', async () => {
  const vin = 'OC3DBOUNDARY00002';
  await seedVehicle(db, vin);
  const client = supabaseOver(db);
  // `mechanicId` used to select a stakeholder signer implicitly; an explicit signerId wins.
  const event = await addEvent(vin, 'SERVICE_LOG', { mechanicId: 'mechanic-77', note: 'oil' }, 'SYSTEM_SIGNATURE', { client, signerId: 'system' });
  assert.match(event.signature, /^system:/);
});
