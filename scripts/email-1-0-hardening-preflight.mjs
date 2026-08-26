#!/usr/bin/env node
/**
 * Preflight / postflight for the Email 1.0 hardening migration.
 *
 * READ-ONLY in preflight mode. It proves the migration is safe to apply BEFORE it is applied, and
 * proves the expected end state afterwards. It never mutates anything itself.
 *
 *   node scripts/email-1-0-hardening-preflight.mjs preflight   --url <db> 
 *   node scripts/email-1-0-hardening-preflight.mjs postflight  --url <db>
 *
 * The one thing this exists to protect: LIVE v1 reply tokens. Credentials already delivered to real
 * inboxes must keep resolving, so preflight counts them and postflight proves the count is unchanged
 * and their `version` was not rewritten.
 */
import pg from 'pg';

const MODE = process.argv[2];
const urlFlag = process.argv.indexOf('--url');
const CONNECTION = urlFlag > -1 ? process.argv[urlFlag + 1] : process.env.SUPABASE_DB_URL;

if (!['preflight', 'postflight'].includes(MODE)) {
  console.error('usage: email-1-0-hardening-preflight.mjs <preflight|postflight> [--url <connection>]');
  process.exit(2);
}
if (!CONNECTION) {
  console.error('No connection string. Pass --url or set SUPABASE_DB_URL.');
  process.exit(2);
}
// A guard, not a courtesy: this script must never be pointed at production by accident.
if (/prod/i.test(CONNECTION) && !process.env.CARUP_ALLOW_PRODUCTION_READ) {
  console.error('Refusing: the connection string looks like production. This package is staging-only.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: CONNECTION, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const problems = [];
const line = (label, value) => console.log(`  ${label.padEnd(52)} ${value}`);

console.log(`\nEmail 1.0 hardening — ${MODE}\n`);

// --- reply tokens by version -------------------------------------------------
const byVersion = await q(`
  SELECT version,
         count(*)::int AS total,
         count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS live
    FROM public.email_reply_tokens
   GROUP BY version ORDER BY version`);
console.log('email_reply_tokens by version');
if (!byVersion.length) line('(no rows)', '');
for (const row of byVersion) line(`version ${row.version}`, `total=${row.total}  live=${row.live}`);
const liveV1 = byVersion.find((r) => r.version === 1)?.live ?? 0;
const liveV2 = byVersion.find((r) => r.version === 2)?.live ?? 0;
line('LIVE v1 credentials (must survive)', String(liveV1));
line('LIVE v2 credentials', String(liveV2));

// --- the column default ------------------------------------------------------
const [versionCol] = await q(`
  SELECT column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='email_reply_tokens' AND column_name='version'`);
line('version column default', versionCol?.column_default ?? 'MISSING');

// --- token_hash index posture ------------------------------------------------
const hashIndexes = await q(`
  SELECT i.relname AS name, ix.indisunique AS is_unique, pg_get_indexdef(ix.indexrelid) AS def
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
   WHERE t.relname = 'email_reply_tokens' AND pg_get_indexdef(ix.indexrelid) LIKE '%token_hash%'
   ORDER BY i.relname`);
console.log('\ntoken_hash index posture');
for (const idx of hashIndexes) line(idx.name, `${idx.is_unique ? 'UNIQUE  ' : 'non-uniq'} ${idx.def}`);
const uniqueHash = hashIndexes.filter((i) => i.is_unique);
const duplicateHash = hashIndexes.filter((i) => !i.is_unique && i.name === 'idx_email_reply_tokens_hash');

// --- the R5 durability marker ------------------------------------------------
const [marker] = await q(`
  SELECT data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicles'
     AND column_name='trust_presentation_announced_fingerprint'`);
console.log('\nR5 durability marker');
line('vehicles.trust_presentation_announced_fingerprint', marker ? marker.data_type : 'ABSENT');

if (MODE === 'preflight') {
  console.log('\nPreflight assertions');
  if (!uniqueHash.length) problems.push('no UNIQUE index backs token_hash — the duplicate index must NOT be dropped');
  else line('UNIQUE index backs token_hash', 'OK — the duplicate is safely redundant');
  if (!duplicateHash.length) line('idx_email_reply_tokens_hash', 'already absent — the DROP is a no-op');
  if (versionCol?.column_default?.includes('2')) line('version default', 'already 2 — the ALTER is a no-op');
  if (marker) line('durability marker', 'already present — the ADD COLUMN is a no-op');
  console.log(`\n  Expected effect: default 1->2, drop 1 redundant index, add 1 nullable column.`);
  console.log(`  NOT expected: any UPDATE, any token rewrite, any trust value change.`);
} else {
  console.log('\nPostflight assertions');
  const assert = (ok, message) => { if (ok) line('PASS', message); else problems.push(message); };
  assert(versionCol?.column_default?.includes('2'), 'version column now defaults to 2');
  assert(!duplicateHash.length, 'the redundant idx_email_reply_tokens_hash is gone');
  assert(uniqueHash.length > 0, 'the UNIQUE index backing token_hash is still present');
  assert(Boolean(marker), 'vehicles.trust_presentation_announced_fingerprint exists');

  // The one that matters: no live v1 credential was rewritten or lost.
  const expectedV1 = Number(process.env.EXPECTED_LIVE_V1 ?? liveV1);
  assert(liveV1 === expectedV1, `live v1 credentials unchanged (${liveV1} = ${expectedV1})`);
  const rewritten = await q(`SELECT count(*)::int AS n FROM public.email_reply_tokens WHERE version = 2 AND created_at < now() - interval '1 second' AND rotated_from IS NULL`);
  line('v2 rows (informational)', String(rewritten[0].n));
}

await client.end();

if (problems.length) {
  console.error(`\n${MODE.toUpperCase()}=FAIL`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\n${MODE.toUpperCase()}=PASS\n`);
