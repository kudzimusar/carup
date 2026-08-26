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

/**
 * A fingerprint over everything the DECISION READS for the target — not the cached outputs, the
 * INPUTS: the vehicle's own governed columns (minus the seven trust outputs, which are what apply is
 * allowed to change), plus its evidence, source-verification coverage, fraud cases, escrow trust
 * sessions and eligibility requests.
 *
 * Pinning the seven output columns is not enough. If an input moves between certification and apply,
 * the outputs still look exactly as certified while the decision that gets persisted is one nobody
 * reviewed. Whole rows are hashed rather than named columns, so a change to a column this runner
 * never thought about is still caught.
 */
export const DECISION_INPUT_FINGERPRINT = '2e25e368c18e43c6e8a264b138523f1a';

/**
 * Every VIN-scoped table the decision reads, in fixed order.
 *
 * The first five are read directly by getTrustDecision / getCanonicalTrust. The remaining nine are
 * FACT_INPUT_TABLES from vehicleFactResolver, reached through resolveVehicleFacts — they determine
 * trust_evidence_basis and trust_known_limitations, so a row moving there moves the decision just as
 * surely as a piece of evidence does.
 *
 * An ABSENT table contributes the literal 'absent' rather than being skipped, so a table APPEARING
 * later changes the fingerprint instead of silently widening the input set. trust_fact_requests is
 * absent from production today; that absence is part of what is pinned.
 */
export const DECISION_INPUT_TABLES = Object.freeze([
  'vehicle_evidence', 'source_verification_coverage_public', 'fraud_cases',
  'escrow_trust_sessions', 'eligibility_requests',
  'zimra_declarations', 'cid_clearance_records', 'cvr_ownership_records', 'vid_inspections',
  'insurance_records', 'zinara_licensing_records', 'trust_fact_requests', 'trust_audit_events',
  'source_verification_results',
]);
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
  // ONE SNAPSHOT, NOT THIRTY. The digest is assembled from a query per input table, and the target
  // state is read by yet another. Run loose, a row changing partway through yields a fingerprint
  // that describes no state production was ever in: `vehicles` hashed before the change, a fact
  // table after it. REPEATABLE READ pins every statement in this measurement to a single snapshot,
  // so the fingerprint and the state it is compared against are coherent with each other.
  //
  // READ ONLY as well — asserted by the server, so a measurement can never write.
  await pg.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await measureWithinSnapshot(pg, vin);
  } finally {
    await pg.query('ROLLBACK');
  }
}

async function measureWithinSnapshot(pg, vin) {
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
           (select count(*)::int from supabase_migrations.schema_migrations)      as ledger_rows,
           (select md5($2::text)) as decision_inputs`,
    [vin, await decisionInputDigest(pg, vin)]);
  return rows[0];
}

/**
 * The digest of every decision input, assembled table by table so an absent table can contribute a
 * marker instead of failing the whole statement at parse time.
 */
export async function decisionInputDigest(pg, vin) {
  const parts = [];
  const { rows: v } = await pg.query(
    `select md5(coalesce((select string_agg(t::text, ',' order by t::text) from (
        select to_jsonb(x) - 'trust_score' - 'trust_calculation_version' - 'trust_evaluated_at'
               - 'trust_band' - 'trust_confidence' - 'trust_known_limitations' - 'trust_evidence_basis' as t
          from public.vehicles x where x.vin = $1) s), '')) h`, [vin]);
  parts.push(v[0].h);

  for (const table of DECISION_INPUT_TABLES) {
    const { rows: reg } = await pg.query('select to_regclass($1)::text t', [`public.${table}`]);
    if (!reg[0].t) { parts.push('absent'); continue; }
    const { rows: h } = await pg.query(
      `select md5(coalesce((select string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)
          from public.${table} x where x.vin = $1), '')) h`, [vin]);
    parts.push(h[0].h);
  }
  return parts.join('');
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
  log(`  decision inputs          : ${s.decision_inputs}`);
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
  if (s.decision_inputs !== DECISION_INPUT_FINGERPRINT) {
    f.push(`the DECISION INPUTS for the target have changed (${s.decision_inputs}, certified `
         + `${DECISION_INPUT_FINGERPRINT}) — evidence, coverage, fraud, escrow, eligibility or a `
         + `governed vehicle column moved, so apply would persist a decision nobody certified`);
  }
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
  if (before.decision_inputs !== after.decision_inputs) f.push('a decision INPUT changed');
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

  // PROPOSE, THEN PERSIST, THEN COMPARE. The pinned input fingerprint catches drift between
  // certification and apply; this catches drift DURING apply. The decision is computed once as a dry
  // run, then for real, and the persisted values must match what was proposed moments earlier —
  // otherwise what landed in production is not what this run showed anybody.
  const proposed = await deps.refreshCanonicalTrust(TARGET_VIN, { dryRun: true });
  if (proposed?.written === true) refuse('the dry run inside apply reported a write. Refusing.');
  describePatch(proposed?.record, proposed?.patch, log);

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
  assertPersistedMatchesProposed(proposed?.patch, after.target, log);

  // AND THE INPUTS MUST STILL BE THE CERTIFIED ONES. If an input moved after the writer's last read
  // but before this measurement, the persisted patch still equals the earlier proposal and every
  // other check passes — while the cache that just landed is already stale against the production
  // state this run measured. Success is not declared over a cache known to be behind.
  if (after.decision_inputs !== DECISION_INPUT_FINGERPRINT || after.decision_inputs !== before.decision_inputs) {
    refuse(`the decision INPUTS moved during apply (certified ${DECISION_INPUT_FINGERPRINT}, `
         + `pre-apply ${before.decision_inputs}, post-apply ${after.decision_inputs}). The write `
         + 'succeeded but the cache is already stale against measured production state; re-certify.');
  }
  log('  ok  the decision inputs are unchanged from the certified fingerprint.');

  log('\nok  the target is canonically stamped by the real writer;');
  log(`    all ${NONTARGET_ROWS} non-target rows are byte-identical (${after.nontarget_checksum});`);
  log(`    stamped ${before.stamped} -> ${after.stamped}; unversioned ${before.unversioned} -> ${after.unversioned};`);
  log('    the migrations ledger was not touched.');
  log('APPLY COMPLETE.');
  return { before, after, result };
}

/**
 * What was persisted must be what was proposed. `trust_evaluated_at` is excluded by design — the
 * real apply stamps its own timestamp, and requiring the dry run's would guarantee a false failure.
 */
export function assertPersistedMatchesProposed(patch, target, log = console.log) {
  if (!patch || typeof patch !== 'object') return;   // a writer that proposes nothing is caught elsewhere

  // STRUCTURAL, NOT TEXTUAL. trust_evidence_basis is a JSONB column: Postgres does not preserve the
  // JavaScript object's key order when it hands the value back through row_to_json, so comparing
  // JSON.stringify output reports drift between two identical objects. That failure would land
  // AFTER the production write had already succeeded — reporting a failed cutover for a write that
  // worked. Keys are therefore canonicalized recursively before comparison.
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
    }
    return v;
  };
  const norm = (v) => (v === null || v === undefined ? null
    : (typeof v === 'object' ? JSON.stringify(canon(v)) : String(v)));
  const drift = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'trust_evaluated_at' || !(k in target)) continue;
    if (norm(v) !== norm(target[k])) drift.push(`${k}: proposed ${norm(v)}, persisted ${norm(target[k])}`);
  }
  if (drift.length) {
    refuse(`PERSISTED DECISION DOES NOT MATCH THE ONE PROPOSED SECONDS EARLIER — ${drift.join('; ')}. `
         + 'An input moved mid-apply; what landed in production was never shown.');
  }
  log('  ok  the persisted decision equals the one proposed moments earlier (bar the apply timestamp).');
}

// ── entry point ──────────────────────────────────────────────────────────────────────────────────

/**
 * Supabase's own domains. A credential may be sent to these and nowhere else.
 *
 * A SUBSTRING TEST IS NOT A HOST TEST. `https://<ref>.supabase.co.attacker.example` contains the
 * project ref, as does `https://attacker.example/?x=<ref>`. Either would satisfy `url.includes(ref)`
 * and then receive the production service-role key or the database password. Both URLs are
 * therefore PARSED, and the decision is made on the hostname.
 */
const SUPABASE_DOMAINS = Object.freeze(['supabase.co', 'supabase.com']);

function hostOf(raw, what) {
  let u;
  try { u = new URL(raw); } catch { return refuse(`${what} is not a parseable URL; refusing.`); }
  return u;
}

/** The Data API origin must be exactly https://<ref>.supabase.co — no prefix, suffix or port games. */
export function assertApiOrigin(apiUrl, ref) {
  const u = hostOf(apiUrl, 'the Supabase API URL');
  if (u.protocol !== 'https:') refuse(`the Supabase API URL must be https, got ${u.protocol}; refusing.`);
  if (u.hostname !== `${ref}.supabase.co`) {
    refuse(`the Supabase API host is ${u.hostname}, expected exactly ${ref}.supabase.co; refusing.`);
  }
  if (u.port && u.port !== '443') refuse(`the Supabase API URL carries port ${u.port}; refusing.`);
  return u;
}

/**
 * The database host must be a real Supabase host, and the ref must appear in the URL.
 *
 * The hostname is not required to CONTAIN the ref, because the pooler form carries it in the
 * username (postgres.<ref>@aws-0-<region>.pooler.supabase.com) while the direct form carries it in
 * the host (db.<ref>.supabase.co). Requiring a Supabase-owned host is what stops the credential
 * leaving; requiring the ref somewhere is what pins the project.
 */
export function assertDbHost(dbUrl, ref) {
  const u = hostOf(dbUrl, 'PRODUCTION_DATABASE_URL');
  const host = u.hostname.toLowerCase();
  const owned = SUPABASE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  if (!owned) refuse(`the database host ${host} is not a Supabase host; refusing to send the credential there.`);

  // THE REF MUST BE WHERE POSTGRES ACTUALLY ROUTES. A raw `dbUrl.includes(ref)` is satisfied by the
  // ref sitting in the password, path or query string while the connection routes somewhere else
  // entirely — postgres://postgres.<other>:p@aws-0-eu.pooler.supabase.com/postgres?x=<prod-ref>
  // reads as production and connects to <other>. Only two shapes are accepted, and in both the ref
  // is read from the field Postgres routes on.
  const direct = host === `db.${ref}.supabase.co`;
  const pooler = host.endsWith('.pooler.supabase.com')
    && decodeURIComponent(u.username || '').toLowerCase() === `postgres.${ref}`;
  if (!direct && !pooler) {
    refuse(`the database URL is pinned to neither db.${ref}.supabase.co nor a pooler user postgres.${ref} `
         + `(host=${host}, user=${decodeURIComponent(u.username || '') || '(none)'}); refusing.`);
  }
  return u;
}

export function resolveMode(env) {
  const dbUrl = env.PRODUCTION_DATABASE_URL;
  const ref = env.PRODUCTION_PROJECT_REF;
  const svcKey = env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY;
  const apiUrl = env.PRODUCTION_SUPABASE_URL || (ref ? `https://${ref}.supabase.co` : '');

  if (!dbUrl) refuse('PRODUCTION_DATABASE_URL is not set.');
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) refuse('PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.');
  if (ref === STAGING_REF) refuse('PRODUCTION_PROJECT_REF is the staging ref; refusing.');
  assertDbHost(dbUrl, ref);
  if (dbUrl.includes(STAGING_REF)) refuse('connection string references the STAGING project; refusing.');
  if (!svcKey) refuse('PRODUCTION_SUPABASE_SERVICE_ROLE_KEY is not set — the canonical writer cannot run without it.');
  // The repo also holds generic SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY secrets which are NOT proven
  // to be production. Binding the API ORIGIN to the production ref is what stops one being used here.
  assertApiOrigin(apiUrl, ref);
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
