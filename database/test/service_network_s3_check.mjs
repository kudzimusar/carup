/**
 * Service Network S3 — Marketplace bridge migration proof.
 *
 * Proves 20260901140000_service_network_s3_inquiry_target_garage.sql against REAL
 * PostgreSQL (PGlite):
 *   1. the additive column lands on the REAL marketplace_inquiries table without
 *      disturbing existing rows or the seller columns;
 *   2. legacy service inquiries created before the bridge keep working (the column
 *      is nullable — no fabricated routing is backfilled);
 *   3. the partial index exists and covers only non-NULL targets;
 *   4. Down removes column and index cleanly, and re-Up re-applies.
 *
 * Run:  node database/test/service_network_s3_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260901120000_service_network_s1_garage_identity.sql';
const S2 = '20260901130000_service_network_s2_service_cases.sql';
const S3 = '20260901140000_service_network_s3_inquiry_target_garage.sql';

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  if (!raw.includes('-- +migrate Up')) throw new Error(`${file}: missing "-- +migrate Up" marker`);
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down };
}

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  -- pglite (PG17) has gen_random_uuid() in core; shim the uuid-ossp name 002 uses.
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, role TEXT, is_verified BOOLEAN DEFAULT false
  );
  -- 002's own seed maps user 'u3' into the seed tenant; that user pre-existed in production.
  INSERT INTO users(id, name, role) VALUES ('u3','Croco Dealer','dealer') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS vehicles (
    vin TEXT PRIMARY KEY, owner_id TEXT, trust_score NUMERIC, status TEXT
  );
  -- Pre-002 legacy tables 002 ALTERs (represent pre-existing production schema):
  CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT, type TEXT);
  CREATE TABLE IF NOT EXISTS safepay_escrows (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS partsentry_logs (id BIGSERIAL PRIMARY KEY, vin TEXT);
  CREATE TABLE IF NOT EXISTS blockchain_events (id BIGSERIAL PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS finance_applications (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS insurance_records (id TEXT PRIMARY KEY);
`;

let failures = 0;
const db = new PGlite();
async function must(label, fn) {
  try { await fn(); console.log(`OK   ${label}`); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
async function mustReject(label, sql, codeOrMsg) {
  try { await db.exec(sql); failures++; console.error(`FAIL ${label}: statement unexpectedly succeeded`); }
  catch (e) {
    const s = `${e.code || ''} ${e.message}`;
    if (codeOrMsg && !s.includes(codeOrMsg)) { failures++; console.error(`FAIL ${label}: rejected but wrong error (${s})`); }
    else console.log(`OK   ${label}`);
  }
}
const q = async (sql) => (await db.query(sql)).rows;



const s3 = splitMigration(S3);
const inquiries = splitMigration('20260616120000_marketplace_v1_inquiries.sql');

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real marketplace inquiries migration applies', () => db.exec(inquiries.up));

await must('a LEGACY service inquiry exists before the bridge', () => db.exec(`
  INSERT INTO public.marketplace_inquiries(id, listing_id, inquiry_type, message, source_channel, seller_id, seller_tenant_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','VINLEGACY01','garage_service_request','pre-bridge request','web','seller-x','tenant-x')`));

await must('S3 Up applies', () => db.exec(s3.up));

await must('the additive column exists and is nullable', async () => {
  const [c] = await q(`SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_name='marketplace_inquiries' AND column_name='target_provider_tenant_id'`);
  if (!c) throw new Error('column missing');
  if (c.data_type !== 'uuid') throw new Error(`expected uuid, got ${c.data_type}`);
  if (c.is_nullable !== 'YES') throw new Error('column must be nullable for legacy rows');
});

await must('the legacy row survives untouched — no fabricated routing is backfilled', async () => {
  const [r] = await q(`SELECT target_provider_tenant_id, seller_id, seller_tenant_id, message
    FROM public.marketplace_inquiries WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'`);
  if (r.target_provider_tenant_id !== null) throw new Error('legacy routing was fabricated');
  if (r.seller_id !== 'seller-x' || r.seller_tenant_id !== 'tenant-x') throw new Error('seller columns disturbed');
  if (r.message !== 'pre-bridge request') throw new Error('row content changed');
});

await must('a routed service inquiry records its target garage', async () => {
  await db.exec(`INSERT INTO public.marketplace_inquiries(id, listing_id, inquiry_type, source_channel, target_provider_tenant_id)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','VINCASE0001','garage_service_request','qr','11111111-1111-1111-1111-111111111111')`);
  const [r] = await q(`SELECT target_provider_tenant_id, seller_tenant_id FROM public.marketplace_inquiries WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'`);
  if (r.target_provider_tenant_id !== '11111111-1111-1111-1111-111111111111') throw new Error('target not stored');
  if (r.seller_tenant_id !== null) throw new Error('seller semantics were overloaded');
});

await mustReject('the column is typed — a non-UUID target is refused',
  `INSERT INTO public.marketplace_inquiries(id, listing_id, inquiry_type, target_provider_tenant_id)
   VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','VIN','garage_service_request','not-a-uuid')`, '22P02');

await must('the partial index exists and is predicated on non-NULL targets', async () => {
  const [r] = await q(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_mpi_target_provider_tenant'`);
  if (!r) throw new Error('index missing');
  if (!/WHERE .*target_provider_tenant_id IS NOT NULL/i.test(r.indexdef)) {
    throw new Error(`index is not partial: ${r.indexdef}`);
  }
});

await must('S3 Down removes column and index', () => db.exec(s3.down));
await must('column and index are gone after Down', async () => {
  const c = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_name='marketplace_inquiries' AND column_name='target_provider_tenant_id'`);
  if (c.length) throw new Error('column survived Down');
  const i = await q(`SELECT indexname FROM pg_indexes WHERE indexname='idx_mpi_target_provider_tenant'`);
  if (i.length) throw new Error('index survived Down');
});
await must('rows survive the Down (the bridge is additive, not destructive to leads)', async () => {
  const [r] = await q(`SELECT count(*)::int n FROM public.marketplace_inquiries`);
  if (r.n !== 2) throw new Error(`expected 2 inquiries, got ${r.n}`);
});
await must('S3 re-Up applies (idempotent after rollback)', () => db.exec(s3.up));

await db.close();
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S3 migration checks passed.');
process.exit(0);
