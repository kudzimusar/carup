/**
 * PRODUCTION one-off canonical Trust refresh — Issue #164 final activation step.
 *
 * Materializes canonical Trust for EXACTLY ONE governed production UAT vehicle by invoking the real
 * canonical writer. It changes no governed evidence or fact input: it re-materializes a derived
 * position that has never been computed, and nothing else.
 *
 * ## Why a workflow and not an authenticated session
 *
 * refreshCanonicalTrust() is the sole canonical writer (INV-TRUST-2). In production it is reachable
 * from exactly two HTTP call sites — evidence verify and evidence reject — both requiring
 * admin/government AND an existing evidence row. The target has ZERO evidence rows and its owner
 * holds role `owner`, so no session can reach the writer. The only session-based alternative would
 * be to upload evidence and review it, which fabricates a governed fact to force a score. This
 * runner exists so that nothing has to be fabricated.
 *
 * ## What it must never become
 *
 * The VIN is a module constant. There is no argument, no environment override, no list, no batch,
 * no "all vehicles" path. A second VIN cannot be reached from here by configuration — only by
 * editing this file, which is a reviewable pull request that moves the pin.
 *
 * ## It does not duplicate the decision
 *
 * The runner never computes a score, never writes a trust column, and never issues an UPDATE. It
 * calls refreshCanonicalTrust and then MEASURES what that writer did. Proving the real writer is
 * the entire point; a handwritten UPDATE would prove nothing about production.
 *
 * ## Not a migration
 *
 * This writes no row to supabase_migrations.schema_migrations. It is an application-level
 * re-materialization, and the ledger must not record it as schema history.
 *
 * ## Two independent channels
 *
 * The WRITE goes through the Supabase service client, exactly as production does. The MEASUREMENT
 * goes through a direct Postgres connection. Deliberately different transports: a proof that reads
 * back through the same channel that wrote is a weaker proof.
 *
 * ## Modes
 *
 *   preflight — writes NOTHING. Asserts identity and the pinned baseline, invokes the canonical
 *               decision in DRY-RUN for the target only, prints the proposed patch, then re-asserts
 *               that no target or non-target trust field moved.
 *   apply     — re-reads the full baseline, refuses on ANY drift, performs one refresh, then proves
 *               the target advanced and that all 351 non-target rows are byte-identical.
 */
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

/** HARD PIN. Not an argument. Not an environment variable. Not a list. */
export const TARGET_VIN = 'UATPRD17830287622';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
export const CONFIRM_TOKEN = 'YES_I_AUTHORIZE_THE_CANONICAL_TRUST_REFRESH';

/**
 * The certified pre-apply state, measured read-only on 2026-08-25 and pinned here. Apply refuses
 * unless production still looks exactly like this. Production that has moved is production nobody
 * has certified, and the correct response is to stop rather than to adapt.
 */
export const BASELINE = Object.freeze({
  trust_score: 80,
  trust_calculation_version: null,
  trust_evaluated_at: null,
  trust_band: null,
  trust_confidence: null,
  trust_known_limitations: null,
  trust_evidence_basis: null,
});
export const NONTARGET_CHECKSUM = '0d4ed34f9697df66f87855cce2cdbdc3';
export const NONTARGET_ROWS = 351;
export const EXPECTED_STAMPED_BEFORE = 0;
export const EXPECTED_UNVERSIONED_BEFORE = 352;

export const VALID_BANDS = Object.freeze(['high', 'moderate', 'low', 'insufficient_evidence']);
export const VALID_CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'not_evaluated']);

export class RefreshRefusal extends Error {
  constructor(message) { super(message); this.name = 'RefreshRefusal'; }
}
const refuse = (m) => { throw new RefreshRefusal(m); };

// ── measurement channel (direct Postgres) ────────────────────────────────────────────────────────

/**
 * One statement, both halves of the invariant: the target row in full, and a checksum over all seven
 * trust columns of every OTHER row. Seven columns, not just trust_score — drift on any trust field
 * of a non-target row must be caught regardless of which field moved.
 */
export async function measureTrustState(pg, vin = TARGET_VIN) {
  const { rows } = await pg.query(`
    with tgt as (
      select vin, trust_score, trust_calculation_version, trust_evaluated_at, trust_band,
             trust_confidence, trust_known_limitations, trust_evidence_basis
        from public.vehicles where vin = $1
    ), nontarget as (
      select md5(coalesce(string_agg(
               vin || '|' || coalesce(trust_score::text,'~')
                   || '|' || coalesce(trust_calculation_version,'~')
                   || '|' || coalesce(trust_evaluated_at::text,'~')
                   || '|' || coalesce(trust_band,'~')
                   || '|' || coalesce(trust_confidence,'~')
                   || '|' || coalesce(trust_known_limitations::text,'~')
                   || '|' || coalesce(trust_evidence_basis::text,'~'),
               ',' order by vin), '')) as checksum,
             count(*)::int as rows
        from public.vehicles where vin <> $1
    )
    select (select row_to_json(tgt) from tgt)                                     as target,
           (select checksum from nontarget)                                       as nontarget_checksum,
           (select rows from nontarget)                                           as nontarget_rows,
           (select count(*)::int from public.vehicles
              where trust_calculation_version is not null)                        as stamped,
           (select count(*)::int from public.vehicles
              where trust_score is not null and trust_calculation_version is null) as unversioned,
           (select count(*)::int from public.vehicles)                            as total_vehicles,
           (select count(*)::int from supabase_migrations.schema_migrations)      as ledger_rows`,
    [vin]);
  return rows[0];
}

export function reportState(label, s, log = console.log) {
  log(`\n── ${label} ──`);
  log(`  target ${TARGET_VIN}`);
  if (!s.target) { log('    (ABSENT)'); } else {
    for (const [k, v] of Object.entries(s.target)) {
      if (k === 'vin') continue;
      log(`    ${k.padEnd(26)} ${v === null ? 'null' : JSON.stringify(v)}`);
    }
  }
  log(`  non-target rows          : ${s.nontarget_rows}`);
  log(`  non-target trust checksum: ${s.nontarget_checksum}`);
  log(`  canonically stamped      : ${s.stamped}`);
  log(`  scored but unversioned   : ${s.unversioned}`);
  log(`  total vehicles           : ${s.total_vehicles}`);
}

/** The pinned pre-apply state. Any deviation is a refusal, never an adaptation. */
export function assertBaseline(s) {
  const f = [];
  if (!s.target) f.push(`target ${TARGET_VIN} does not exist in this database`);
  else {
    for (const [k, want] of Object.entries(BASELINE)) {
      const got = s.target[k];
      const same = want === null ? (got === null || got === undefined) : Number(got) === Number(want);
      if (!same) f.push(`target ${k} is ${JSON.stringify(got)}, certified baseline is ${JSON.stringify(want)}`);
    }
  }
  if (s.nontarget_checksum !== NONTARGET_CHECKSUM) {
    f.push(`non-target trust checksum is ${s.nontarget_checksum}, certified ${NONTARGET_CHECKSUM}`);
  }
  if (s.nontarget_rows !== NONTARGET_ROWS) f.push(`non-target row count is ${s.nontarget_rows}, certified ${NONTARGET_ROWS}`);
  if (s.stamped !== EXPECTED_STAMPED_BEFORE) f.push(`${s.stamped} vehicles already stamped, certified ${EXPECTED_STAMPED_BEFORE}`);
  if (s.unversioned !== EXPECTED_UNVERSIONED_BEFORE) f.push(`${s.unversioned} scored-but-unversioned, certified ${EXPECTED_UNVERSIONED_BEFORE}`);
  if (f.length) {
    refuse(`PRODUCTION HAS MOVED SINCE CERTIFICATION — ${f.join('; ')}. Refusing; re-certify rather than adapt.`);
  }
}

/** Nothing at all changed between two measurements. Used by preflight to prove it wrote nothing. */
export function assertUnchanged(before, after, context) {
  const f = [];
  if (JSON.stringify(before.target) !== JSON.stringify(after.target)) f.push('the target row changed');
  if (before.nontarget_checksum !== after.nontarget_checksum) f.push('a non-target trust field changed');
  if (before.stamped !== after.stamped) f.push(`stamped count moved ${before.stamped} -> ${after.stamped}`);
  if (before.unversioned !== after.unversioned) f.push(`unversioned count moved ${before.unversioned} -> ${after.unversioned}`);
  if (before.ledger_rows !== after.ledger_rows) f.push(`the migrations ledger changed ${before.ledger_rows} -> ${after.ledger_rows}; this is not a migration`);
  if (f.length) refuse(`${context} — ${f.join('; ')}.`);
}

// ── the after-state contract ─────────────────────────────────────────────────────────────────────

/**
 * What the canonical writer must have produced. Deliberately does NOT require a high score: with
 * zero evidence, a low or zero score with insufficient_evidence is the honest answer and a PASS.
 */
export function assertTargetAdvanced(after, calculationVersion) {
  const t = after.target;
  const f = [];
  if (!t) return refuse('the target row vanished during apply');

  if (t.trust_calculation_version !== calculationVersion) {
    f.push(`trust_calculation_version is ${JSON.stringify(t.trust_calculation_version)}, expected the running ${JSON.stringify(calculationVersion)}`);
  }
  if (t.trust_evaluated_at === null || t.trust_evaluated_at === undefined) f.push('trust_evaluated_at is null');
  const n = Number(t.trust_score);
  if (t.trust_score === null || Number.isNaN(n) || n < 0 || n > 100) {
    f.push(`trust_score ${JSON.stringify(t.trust_score)} is not numeric within 0..100`);
  }
  if (!VALID_BANDS.includes(t.trust_band)) f.push(`trust_band ${JSON.stringify(t.trust_band)} is not a canonical band`);
  if (!VALID_CONFIDENCE.includes(t.trust_confidence)) f.push(`trust_confidence ${JSON.stringify(t.trust_confidence)} is not a canonical confidence`);
  const empty = (v) => v === null || v === undefined
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
  if (empty(t.trust_evidence_basis)) f.push('trust_evidence_basis is empty');
  if (empty(t.trust_known_limitations)) f.push('trust_known_limitations is empty');

  if (f.length) refuse(`POST-APPLY TARGET VERIFICATION FAILED — ${f.join('; ')}.`);
}

/** The blast radius. Exactly one row moved, and it was the pinned one. */
export function assertBlastRadius(before, after) {
  const f = [];
  if (after.nontarget_checksum !== NONTARGET_CHECKSUM) {
    f.push(`PRODUCTION INCIDENT: a non-target trust field changed (${NONTARGET_CHECKSUM} -> ${after.nontarget_checksum})`);
  }
  if (after.nontarget_rows !== NONTARGET_ROWS) f.push(`non-target row count moved ${before.nontarget_rows} -> ${after.nontarget_rows}`);
  if (after.stamped !== 1) f.push(`canonically stamped is ${after.stamped}, expected exactly 1`);
  if (after.unversioned !== EXPECTED_UNVERSIONED_BEFORE - 1) {
    f.push(`scored-but-unversioned is ${after.unversioned}, expected ${EXPECTED_UNVERSIONED_BEFORE - 1}`);
  }
  if (after.total_vehicles !== before.total_vehicles) f.push(`vehicle count moved ${before.total_vehicles} -> ${after.total_vehicles}`);
  if (after.ledger_rows !== before.ledger_rows) f.push(`the migrations ledger changed; this operation is not a migration`);
  if (f.length) refuse(`BLAST RADIUS VIOLATION — ${f.join('; ')}.`);
}

// ── modes ────────────────────────────────────────────────────────────────────────────────────────

function describePatch(record, patch, log) {
  log('\n── PROPOSED CANONICAL PATCH (dry run — nothing persisted) ──');
  log(`  evaluation_state          ${record?.evaluation_state ?? '(none)'}`);
  if (!patch) {
    log('  patch                     NONE — the decision does not classify as canonical, so the');
    log('                            writer would persist nothing. Apply would be a no-op.');
    return;
  }
  for (const [k, v] of Object.entries(patch)) {
    const s = v === null ? 'null' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    log(`  ${k.padEnd(26)}${s.length > 120 ? s.slice(0, 117) + '…' : s}`);
  }
  log('  NOTE: trust_evaluated_at on a real apply will be the apply-time timestamp, not this one.');
}

export async function runPreflight(pg, deps, log = console.log) {
  const before = await measureTrustState(pg);
  reportState('PRODUCTION PREFLIGHT (read-only) — pinned baseline', before, log);
  assertBaseline(before);
  log('\n  ok  production matches the certified baseline exactly.');

  log(`\n  invoking the canonical decision in DRY RUN for ${TARGET_VIN} only…`);
  const result = await deps.refreshCanonicalTrust(TARGET_VIN, { dryRun: true });
  if (result?.written === true) {
    refuse('DRY RUN REPORTED A WRITE. The canonical writer persisted during preflight. Refusing.');
  }
  describePatch(result?.record, result?.patch, log);
  log(`  writer reason             ${result?.reason ?? '(none)'}`);

  const after = await measureTrustState(pg);
  assertUnchanged(before, after, 'PREFLIGHT MUTATED PRODUCTION');
  log('\n  ok  independently re-measured: no target or non-target trust field changed.');
  log('\nPREFLIGHT COMPLETE — nothing was written.');
  return { before, result };
}

export async function runApply(pg, deps, log = console.log) {
  const before = await measureTrustState(pg);
  reportState('pre-apply', before, log);
  assertBaseline(before);
  log('\n  ok  production still matches the certified baseline; proceeding.');

  log(`\n  calling refreshCanonicalTrust('${TARGET_VIN}') — the real production writer…`);
  const result = await deps.refreshCanonicalTrust(TARGET_VIN);
  log(`  written=${result?.written} reason=${result?.reason ?? '(none)'} state=${result?.record?.evaluation_state ?? '(none)'}`);
  if (result?.written !== true) {
    refuse(`the canonical writer persisted nothing (reason: ${result?.reason ?? 'unknown'}). Nothing to certify.`);
  }

  const after = await measureTrustState(pg);
  reportState('post-apply', after, log);

  assertTargetAdvanced(after, deps.CALCULATION_VERSION);
  assertBlastRadius(before, after);

  log('\nok  the target is canonically stamped by the real writer;');
  log(`    all ${NONTARGET_ROWS} non-target rows are byte-identical (${after.nontarget_checksum});`);
  log(`    stamped ${before.stamped} -> ${after.stamped}; unversioned ${before.unversioned} -> ${after.unversioned};`);
  log('    the migrations ledger was not touched.');
  log('APPLY COMPLETE.');
  return { before, after, result };
}

// ── entry point ──────────────────────────────────────────────────────────────────────────────────

export function resolveMode(env) {
  const dbUrl = env.PRODUCTION_DATABASE_URL;
  const ref = env.PRODUCTION_PROJECT_REF;
  const svcKey = env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY;
  const apiUrl = env.PRODUCTION_SUPABASE_URL || (ref ? `https://${ref}.supabase.co` : '');

  if (!dbUrl) refuse('PRODUCTION_DATABASE_URL is not set.');
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) refuse('PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.');
  if (ref === STAGING_REF) refuse('PRODUCTION_PROJECT_REF is the staging ref; refusing.');
  if (!dbUrl.includes(ref)) refuse('connection string does not reference PRODUCTION_PROJECT_REF; refusing.');
  if (dbUrl.includes(STAGING_REF)) refuse('connection string references the STAGING project; refusing.');
  if (!svcKey) refuse('PRODUCTION_SUPABASE_SERVICE_ROLE_KEY is not set — the canonical writer cannot run without it.');
  // The repo also holds generic SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY secrets which are NOT proven
  // to be production. Binding the API URL to the production ref is what stops one being used here.
  if (!apiUrl.includes(ref)) refuse(`the Supabase API URL does not reference the production project; refusing.`);
  if (apiUrl.includes(STAGING_REF)) refuse('the Supabase API URL references the STAGING project; refusing.');

  const mode = env.MODE === 'apply' ? 'apply' : 'preflight';
  if (mode === 'apply') {
    const supplied = String(env.CONFIRM_APPLY || '').replace(/[   ]/g, ' ').trim();
    if (supplied !== CONFIRM_TOKEN) {
      refuse(`apply mode requires confirm_apply=${CONFIRM_TOKEN}; received a different selection (length ${supplied.length}).`);
    }
  }
  return { mode, dbUrl, apiUrl, svcKey };
}

function tlsConfig(env = process.env, log = console.log) {
  const supplied = env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

async function main() {
  const { mode, dbUrl, apiUrl, svcKey } = resolveMode(process.env);

  // The canonical service builds its client from these at import time, so they are set BEFORE the
  // import — and only from the production-pinned values verified above.
  process.env.SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = svcKey;

  const { refreshCanonicalTrust } = await import('../services/trustDecision/canonicalTrustService.js');
  const { CALCULATION_VERSION } = await import('../services/trustDecision/trustDecisionService.js');
  const deps = { refreshCanonicalTrust, CALCULATION_VERSION };
  console.log(`Canonical writer loaded. Running CALCULATION_VERSION = ${CALCULATION_VERSION}.`);

  const { default: pg } = await import('pg');
  const pgClient = new pg.Client({ connectionString: dbUrl, ssl: tlsConfig(), statement_timeout: 120000 });
  await pgClient.connect();
  try {
    const { rows: ident } = await pgClient.query('select current_database() db');
    console.log(`Connected for MEASUREMENT (db=${ident[0].db}, mode=${mode}). Writes go via the Supabase service client.`);
    const { rows: present } = await pgClient.query("select coalesce(to_regclass('public.vehicles')::text,'ABSENT') t");
    if (present[0].t === 'ABSENT') refuse('public.vehicles is absent — wrong database. Refusing.');

    if (mode === 'preflight') await runPreflight(pgClient, deps);
    else await runApply(pgClient, deps);
  } finally {
    await pgClient.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::${e instanceof RefreshRefusal ? e.message : `runner error: ${e.message}`}`);
    process.exit(1);
  });
}
