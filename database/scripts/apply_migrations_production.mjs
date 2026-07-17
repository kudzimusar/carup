/**
 * Production migration runner — applies the 16 approved Up-only migrations to CarUp
 * production (vhmnajoeicasaigiophh) via `supabase db query --linked` (Supabase Management
 * API; the CLI is linked to production and authenticated — no DB password handled here).
 *
 * Safety:
 *   - verifies each file's SHA-256 against the PR #103 manifest before applying;
 *   - extracts ONLY the `-- +migrate Up` section (everything before `-- +migrate Down`);
 *   - wraps each migration in BEGIN; … COMMIT; (one transaction per migration);
 *   - applies one at a time; STOPS on the first error;
 *   - records a ledger row per applied migration;
 *   - never prints credentials.
 *
 * Guard: refuses to run unless the linked ref is exactly vhmnajoeicasaigiophh.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = join(ROOT, 'database', 'migrations');
const TMP = join(ROOT, 'database', 'scripts', '.prod_mig_tmp.sql');
const PROD = 'vhmnajoeicasaigiophh';

const MANIFEST = [
  ['20260621120000_vehicle_life_evidence_taxonomy_provenance.sql', '983393661b71d518'],
  ['20260621130000_external_source_ingestion.sql', 'd3da9207544c6c41'],
  ['20260621140000_ai_temporal_disclosure_intelligence.sql', '8400808f9e5f4a1d'],
  ['20260621150000_report_versions.sql', '249f85792561ba34'],
  ['20260621160000_governance_disputes_corrections.sql', '5923050b5dec8f5d'],
  ['20260621170000_outbox_dead_letter.sql', 'a9be2252d2d9da89'],
  ['20260624120000_vehicle_trust_security_hardening.sql', 'b392d486c73b44b6'],
  ['20260624130000_vehicle_document_extractions.sql', '1fdba1a69c503367'],
  ['20260624140000_listing_publication_lifecycle.sql', '5640753d403de17f'],
  ['20260624150000_trust_change_log_immutability.sql', '04a2438aeefd7175'],
  ['20260626120000_source_verification_network.sql', 'e958180029648a08'],
  ['20260626130000_partner_api.sql', 'a73e5ae7fc54c8d0'],
  ['20260626140000_fraud_engine.sql', 'acdd3bd052cefaf1'],
  ['20260626150000_dealer_compliance.sql', '2648893ff03463c6'],
  ['20260626160000_eligibility_framework.sql', 'afdf089871a100e2'],
  ['20260626180000_escrow_trust_sessions.sql', '7f7055c8ed6954a4'],
];

function upSection(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const i = raw.indexOf('-- +migrate Down');
  const up = (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '').trim();
  if (!up) throw new Error(`no Up section in ${file}`);
  if (up.includes('-- +migrate Down')) throw new Error(`Down marker leaked into Up for ${file}`);
  return up;
}

function q(sql, { json = false } = {}) {
  writeFileSync(TMP, sql);
  const out = execSync(`supabase db query --linked ${json ? '--output json' : '--output csv'} -f ${JSON.stringify(TMP)}`, {
    cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
  return out;
}

// GUARD: confirm linked ref is production.
const ref = existsSync(join(ROOT, 'supabase/.temp/project-ref')) ? readFileSync(join(ROOT, 'supabase/.temp/project-ref'), 'utf-8').trim() : '';
if (ref !== PROD) { console.error(`GUARD FAIL: linked ref is '${ref}', expected ${PROD}`); process.exit(2); }

const startArg = parseInt(process.argv[2] || '1', 10); // 1-based start index (for resume)
const endArg = parseInt(process.argv[3] || String(MANIFEST.length), 10); // 1-based inclusive end
const results = [];
for (let idx = startArg - 1; idx < endArg; idx++) {
  const [file, expectHash] = MANIFEST[idx];
  const n = idx + 1;
  const actualHash = crypto.createHash('sha256').update(readFileSync(join(MIG, file))).digest('hex').slice(0, 16);
  if (actualHash !== expectHash) { console.error(`[${n}/16] HASH MISMATCH ${file}: ${actualHash} != ${expectHash}`); process.exit(3); }

  const version = file.slice(0, 14);
  const name = file.slice(15).replace(/\.sql$/, '');
  const up = upSection(file);
  const started = new Date().toISOString();
  process.stdout.write(`[${n}/16] applying ${file} (hash ${actualHash} ok) ... `);
  try {
    q(`BEGIN;\n${up}\nCOMMIT;`);
    // record ledger (idempotent)
    q(`insert into supabase_migrations.schema_migrations(version, name, statements) values ('${version}', '${name.replace(/'/g, "''")}', array[]::text[]) on conflict (version) do nothing;`);
    const done = new Date().toISOString();
    console.log(`OK (${started} -> ${done})`);
    results.push({ n, file, status: 'OK', started, done });
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || err).replace(/Bearer\s+\S+/g, '<redacted>').slice(0, 400);
    console.error(`FAIL\n    ${msg}`);
    results.push({ n, file, status: 'FAIL', error: msg });
    console.error(`\nSTOPPED at migration ${n}/16 (${file}). ${idx} applied before this.`);
    process.exit(1);
  }
}
console.log(`\n=== PRODUCTION MIGRATIONS: ${results.filter(r => r.status === 'OK').length}/${MANIFEST.length - (startArg - 1)} applied (from #${startArg}) ===`);
