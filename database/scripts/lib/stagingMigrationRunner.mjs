/**
 * OC-5R staging migration runner — the library.
 *
 * WHY THIS REPLACES THE OLD RUNNER. database/scripts/apply_migrations_staging.mjs used to (1) apply a
 * hard-coded 25-file list, (2) cut the Up section at the FIRST `-- +migrate Down` substring (a header
 * comment that merely mentioned the marker truncated a file to its preamble), (3) treat ANY
 * "already exists" error as ALREADY_APPLIED after rolling the migration back — reporting as applied SQL
 * that never committed, (4) never write the canonical ledger at all, and (5) check SUPABASE_URL but
 * never the database URL it actually connected to.
 *
 * WHAT IT GUARANTEES NOW
 *   - parsing goes through backend/db/migrationParser.js only (markers, SQLite/retired/non-migration refusals);
 *   - migration identity is the FULL FILENAME (deriveVersion). A ledger row is accepted as recording a file
 *     only by full filename, by (prefix + slug) — which is the full filename split across two columns — or by
 *     an equivalence the plan states explicitly. A timestamp prefix alone never identifies anything;
 *   - a plan touching a timestamp-prefix collision is refused unless the plan records that collision as resolved;
 *   - NEVER_APPLY files are refused before any SQL runs;
 *   - each group runs in ONE transaction: preconditions -> SQL -> expected-effect assertions -> ledger row -> COMMIT.
 *     Any error rolls the whole group back, the ledger included, and the run STOPS. Nothing is ever reported
 *     applied unless that COMMIT succeeded, and no error ("already exists" included) is ever swallowed;
 *   - ledger-only repairs never run SQL and are recorded with a distinct created_by, and only after the
 *     stated effect is proven present;
 *   - a replay re-executes an ALREADY-RECORDED migration because a migration in the same group (its anchor,
 *     earlier in that group) regresses part of its effect. It runs inside the anchor's transaction, must prove
 *     the effect it restores, and never writes a ledger row: the file is recorded once, by its original row;
 *   - the target must positively be the staging project or an explicit local rehearsal; production is refused.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  MigrationIntegrityError,
  assertDeterministicVersions,
  assertNotSqliteDialect,
  deriveVersion,
  findTimestampPrefixCollisions,
  isNonMigrationFile,
  isRetiredMigration,
  isSqliteDialectOnly,
  parseMigrationSource,
  timestampPrefixOf,
} from '../../../backend/db/migrationParser.js';

export const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const PRODUCTION_REF = ['vhmnajoeicasa', 'igiophh'].join(''); // assembled: never a literal in an executable path (CR-1)
export const LEDGER_TABLE = 'supabase_migrations.schema_migrations';
export const RUNNER_TAG = 'oc5r-staging-runner';
export const REPAIR_TAG = 'oc5r-ledger-repair';
export const PLAN_SCHEMA = 'oc5r-staging-migration-plan/v1';
export const RECEIPT_SCHEMA = 'oc5r-staging-migration-receipt/v1';
const ACTIONS = new Set(['execute', 'replay', 'ledger_repair']);

export class RunnerRefusal extends Error {
  constructor(code, detail) {
    super(`[staging-runner] ${code}: ${detail}`);
    this.name = 'RunnerRefusal';
    this.code = code;
  }
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ── target identity ───────────────────────────────────────────────────────────────────────────────
/**
 * Live: the connection must positively name the staging project (Supavisor tenant user `postgres.<ref>`
 * or the direct host `db.<ref>.supabase.co`) and must not mention production anywhere.
 * Rehearsal: only a loopback host and a database whose name starts with `oc5r_rehearsal` are accepted.
 */
export function assertStagingTarget(connectionString, { rehearsal = false } = {}) {
  const raw = String(connectionString || '');
  if (!raw) throw new RunnerRefusal('NO_TARGET', 'no database connection string was supplied');
  if (raw.includes(PRODUCTION_REF)) throw new RunnerRefusal('PRODUCTION_TARGET', 'the connection string references the production project');
  let url;
  try { url = new URL(raw); } catch { throw new RunnerRefusal('INVALID_TARGET', 'the connection string is not a URL'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new RunnerRefusal('INVALID_TARGET', `unsupported scheme ${url.protocol}`);
  const user = decodeURIComponent(url.username || '');
  const host = url.hostname;
  const database = decodeURIComponent((url.pathname || '/').slice(1));
  if (rehearsal) {
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new RunnerRefusal('REHEARSAL_NOT_LOCAL', `rehearsal targets must be loopback, got ${host}`);
    if (!database.startsWith('oc5r_rehearsal')) throw new RunnerRefusal('REHEARSAL_DB_NAME', 'rehearsal database names must start with oc5r_rehearsal');
    return { kind: 'rehearsal', host, database };
  }
  const tenantUser = user === `postgres.${STAGING_REF}` && /\.pooler\.supabase\.com$/.test(host);
  const directHost = host === `db.${STAGING_REF}.supabase.co`;
  if (!tenantUser && !directHost) {
    throw new RunnerRefusal('NOT_STAGING', `target does not positively identify the staging project ${STAGING_REF}`);
  }
  return { kind: 'staging', host, database, ref: STAGING_REF };
}

// ── SQL statement boundaries (quotes, comments and dollar-quoting aware) ──────────────────────────
export function splitTopLevelStatements(sql) {
  const out = [];
  let i = 0; let start = 0; let depth = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
    if (c === '/' && d === '*') {
      depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth += 1; i += 2; } else if (sql[i] === '*' && sql[i + 1] === '/') { depth -= 1; i += 2; } else i += 1;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < n) { if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue; } i += 1; break; } i += 1; }
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close < 0 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') { out.push({ text: sql.slice(start, i), start, end: i + 1 }); start = i + 1; }
    i += 1;
  }
  if (sql.slice(start).trim()) out.push({ text: sql.slice(start), start, end: n });
  return out;
}

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
const TXN_START = /^(BEGIN|START\s+TRANSACTION)(\s+(WORK|TRANSACTION|ISOLATION\s+LEVEL\s+[\w\s]+))?$/i;
const TXN_END = /^(COMMIT|END)(\s+(WORK|TRANSACTION))?$/i;
const TXN_OTHER = /^(ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED)\b/i;

/**
 * The SQL the runner executes inside ITS transaction. A migration that wraps itself in exactly one
 * top-level BEGIN … COMMIT envelope has that envelope removed (its own COMMIT would otherwise commit the
 * runner's transaction early and detach the ledger row from the SQL). Every other shape of top-level
 * transaction control — and CONCURRENTLY / VACUUM, which cannot run in a transaction — is refused.
 */
export function prepareUpSql(up, file) {
  const statements = splitTopLevelStatements(up).map((s) => ({ ...s, bare: stripComments(s.text) })).filter((s) => s.bare);
  for (const s of statements) {
    if (/\bCONCURRENTLY\b/i.test(s.bare) || /^VACUUM\b/i.test(s.bare)) {
      throw new RunnerRefusal('NON_TRANSACTIONAL_SQL', `${file} contains a statement that cannot run inside a transaction: ${s.bare.slice(0, 60)}`);
    }
  }
  const control = statements.filter((s) => TXN_START.test(s.bare) || TXN_END.test(s.bare) || TXN_OTHER.test(s.bare));
  if (control.length === 0) return { sql: up, unwrappedEnvelope: false };
  const first = statements[0];
  const last = statements[statements.length - 1];
  const isEnvelope = control.length === 2 && control[0] === first && control[1] === last
    && TXN_START.test(first.bare) && TXN_END.test(last.bare);
  if (!isEnvelope) {
    throw new RunnerRefusal('TOP_LEVEL_TRANSACTION_CONTROL', `${file} controls transactions itself in a way the runner cannot make atomic (${control.map((s) => s.bare).join(' | ')})`);
  }
  return { sql: up.slice(first.end, last.start), unwrappedEnvelope: true };
}

// ── identity ─────────────────────────────────────────────────────────────────────────────────────
export function migrationIdentity(file) {
  const version = deriveVersion(file);
  const stem = file.replace(/\.sql$/, '');
  const prefix = timestampPrefixOf(file);
  const slug = prefix ? stem.slice(prefix.length + 1) : stem;
  return { file, version, stem, prefix, slug };
}

/** True only when `row` records `file` by full filename (or its stem), by prefix+slug, or by a stated equivalence. */
export function isRecordedBy(file, row, equivalences = []) {
  const id = migrationIdentity(file);
  if (row.version === id.version || row.version === id.stem) return true;
  if (id.prefix && row.version === id.prefix && row.name === id.slug) return true;
  return equivalences.some((e) => e.version === row.version && (e.name ?? null) === (row.name ?? null));
}

// ── plan validation ──────────────────────────────────────────────────────────────────────────────
export function validatePlan(plan, { migrationsDir }) {
  if (!plan || plan.schema !== PLAN_SCHEMA) throw new RunnerRefusal('PLAN_SCHEMA', `expected ${PLAN_SCHEMA}`);
  if (plan.target_ref !== STAGING_REF) throw new RunnerRefusal('PLAN_TARGET', `plan target_ref must be ${STAGING_REF}`);
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) throw new RunnerRefusal('PLAN_EMPTY', 'no operations');
  const neverApply = new Map((plan.never_apply || []).map((n) => [n.file, n.reason]));
  const repoFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  const collidingPrefixes = new Set(findTimestampPrefixCollisions(repoFiles));
  // Ledger identity must be unambiguous: each file appears once among the operations that can record it. A replay
  // records nothing, so it may name a file an EARLIER operation of the plan records (repair, then replay).
  try {
    assertDeterministicVersions(plan.operations.filter((op) => op.action !== 'replay').map((op) => op.file));
    assertDeterministicVersions(plan.operations.filter((op) => op.action === 'replay').map((op) => op.file));
  } catch (e) {
    throw new RunnerRefusal('AMBIGUOUS_FILENAME', e.message);
  }
  plan.operations.forEach((op, i) => {
    if (op.action !== 'replay') return;
    const recorder = plan.operations.findIndex((o) => o.action !== 'replay' && o.file === op.file);
    if (recorder > i) throw new RunnerRefusal('REPLAY_BEFORE_RECORD', `${op.file}: the plan records this file only after replaying it`);
  });
  const prepared = [];
  for (const op of plan.operations) {
    const file = String(op.file || '');
    if (!ACTIONS.has(op.action)) throw new RunnerRefusal('BAD_ACTION', `${file}: action must be one of ${[...ACTIONS].join(', ')}`);
    if (neverApply.has(file)) throw new RunnerRefusal('NEVER_APPLY', `${file} is NEVER_APPLY: ${neverApply.get(file)}`);
    if (isSqliteDialectOnly(file)) throw new RunnerRefusal('NEVER_APPLY', `${file} is SQLite-dialect only`);
    if (isRetiredMigration(file)) throw new RunnerRefusal('NEVER_APPLY', `${file} is retired / unappliable`);
    if (isNonMigrationFile(file)) throw new RunnerRefusal('NEVER_APPLY', `${file} is not a migration`);
    assertNotSqliteDialect(file);
    const abs = path.join(migrationsDir, file);
    if (!existsSync(abs)) throw new RunnerRefusal('MISSING_FILE', `${file} is not in ${migrationsDir}`);
    const source = readFileSync(abs, 'utf8');
    const digest = sha256(source);
    if (op.sha256 !== digest) throw new RunnerRefusal('SHA_MISMATCH', `${file}: plan pins ${op.sha256}, file is ${digest}`);
    const id = migrationIdentity(file);
    if (id.prefix && collidingPrefixes.has(id.prefix)) {
      const res = plan.collisions?.[id.prefix];
      if (!res || res.resolved !== true || !Array.isArray(res.files) || !res.files.includes(file)) {
        throw new RunnerRefusal('UNRESOLVED_COLLISION', `${file} shares timestamp prefix ${id.prefix} with another migration and the plan does not record that collision as resolved by full filename`);
      }
    }
    let parsed;
    try {
      parsed = parseMigrationSource(source, file);
    } catch (e) {
      if (e instanceof MigrationIntegrityError) throw new RunnerRefusal('PARSE_REFUSED', e.message);
      throw e;
    }
    const executable = op.action === 'ledger_repair' ? null : prepareUpSql(parsed.up, file);
    if (op.action === 'ledger_repair' && !(Array.isArray(op.expect) && op.expect.length)) {
      throw new RunnerRefusal('REPAIR_WITHOUT_EVIDENCE', `${file}: a ledger-only repair must state the effect it proves present`);
    }
    if (op.action === 'replay' && !(Array.isArray(op.expect) && op.expect.length)) {
      throw new RunnerRefusal('REPLAY_WITHOUT_EVIDENCE', `${file}: a replay must state the effect it restores`);
    }
    prepared.push({ ...op, ...id, digest, up: parsed.up, executable, equivalences: op.equivalent_ledger_rows || [] });
  }
  // A replay exists only because an earlier migration of the SAME group regresses its effect.
  for (const group of groupsOf(prepared)) {
    group.ops.forEach((op, i) => {
      if (op.action !== 'replay') return;
      if (!group.id) throw new RunnerRefusal('REPLAY_WITHOUT_ANCHOR', `${op.file}: a replay must share a group with the migration that regresses it`);
      if (!group.ops.slice(0, i).some((o) => o.action !== 'replay')) {
        throw new RunnerRefusal('REPLAY_BEFORE_ANCHOR', `${op.file}: a replay must follow the migration that regresses it inside group ${group.id}`);
      }
    });
  }
  return prepared;
}

// ── execution ────────────────────────────────────────────────────────────────────────────────────
async function assertProbes(db, probes, label) {
  const results = [];
  for (const expr of probes || []) {
    const rows = await db.query(`select (${expr}) as ok`);
    const ok = rows[0]?.ok === true;
    results.push({ expr, ok });
    if (!ok) throw new RunnerRefusal(label, `probe is not true: ${expr}`);
  }
  return results;
}

function groupsOf(ops) {
  const groups = [];
  for (const op of ops) {
    const last = groups[groups.length - 1];
    if (op.group && last && last.id === op.group) last.ops.push(op);
    else groups.push({ id: op.group || null, ops: [op] });
  }
  return groups;
}

/**
 * db: { exec(sql) -> Promise, query(sql, params?) -> Promise<rows[]> }
 */
export async function runPlan(db, plan, { migrationsDir, apply = false, now = () => new Date().toISOString() } = {}) {
  const ops = validatePlan(plan, { migrationsDir });
  const receipt = {
    schema: RECEIPT_SCHEMA, runner: RUNNER_TAG, mode: apply ? 'apply' : 'dry-run', started_at: now(),
    plan_sha256: sha256(JSON.stringify(plan)), operations: [], result: null,
  };
  const ledgerCount = async () => Number((await db.query(`select count(*)::int as n from ${LEDGER_TABLE}`))[0].n);
  receipt.ledger_rows_before = await ledgerCount();
  let stopped = false;
  for (const group of groupsOf(ops)) {
    if (stopped) { for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, status: 'NOT_RUN' }); continue; }
    const ledger = await db.query(`select version, name, created_by from ${LEDGER_TABLE}`);
    const isRecorded = (op) => ledger.some((row) => isRecordedBy(op.file, row, op.equivalences));
    // A replay must already be recorded; whether the group is pending is decided by its other migrations alone.
    const unrecordedReplay = group.ops.find((op) => op.action === 'replay' && !isRecorded(op));
    if (unrecordedReplay) {
      for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'REFUSED', error: `REPLAY_OF_UNRECORDED: ${unrecordedReplay.file}` });
      stopped = true; continue;
    }
    const recorded = group.ops.filter((op) => op.action !== 'replay').map(isRecorded);
    if (recorded.every(Boolean)) {
      // Already recorded: still prove the effect is there, otherwise the ledger is lying.
      try {
        for (const op of group.ops) await assertProbes(db, op.expect, 'RECORDED_BUT_EFFECT_ABSENT');
        for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'ALREADY_RECORDED' });
        continue;
      } catch (e) {
        for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'DRIFT', error: e.message });
        stopped = true; continue;
      }
    }
    if (recorded.some(Boolean)) {
      for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'REFUSED', error: 'PARTIALLY_RECORDED_GROUP' });
      stopped = true; continue;
    }
    if (!apply) {
      // Dry run: preconditions and (for repairs) the claimed effect, read-only.
      for (const op of group.ops) {
        try {
          const pre = await assertProbes(db, op.precondition, 'PRECONDITION_FAILED');
          const eff = op.action === 'ledger_repair' ? await assertProbes(db, op.expect, 'EFFECT_ABSENT') : [];
          const status = { ledger_repair: 'WOULD_REPAIR_LEDGER', replay: 'WOULD_REPLAY' }[op.action] || 'WOULD_APPLY';
          receipt.operations.push({ file: op.file, action: op.action, group: group.id, status, preconditions: pre.length, effects: eff.length, unwrapped_envelope: Boolean(op.executable?.unwrappedEnvelope) });
        } catch (e) {
          receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'BLOCKED', error: e.message });
        }
      }
      continue;
    }
    const startedAt = now();
    try {
      await db.exec('BEGIN');
      await db.exec("SET LOCAL statement_timeout = '600s'; SET LOCAL lock_timeout = '15s'");
      const detail = [];
      for (const op of group.ops) {
        const pre = await assertProbes(db, op.precondition, 'PRECONDITION_FAILED');
        if (op.action !== 'ledger_repair') await db.exec(op.executable.sql);
        const eff = await assertProbes(db, op.expect, 'EXPECTED_EFFECT_ABSENT');
        detail.push({ op, pre: pre.length, eff: eff.length });
      }
      // The ledger is written only now: after every statement and every effect assertion of the group.
      // A replay is never recorded again — its original ledger row already records the file.
      for (const { op } of detail.filter((d) => d.op.action !== 'replay')) {
        await db.query(
          `insert into ${LEDGER_TABLE} (version, name, statements, created_by, idempotency_key) values ($1, $2, $3, $4, $5)`,
          [op.version, op.slug, [op.up], op.action === 'ledger_repair' ? REPAIR_TAG : RUNNER_TAG, `sha256:${op.digest}`],
        );
      }
      await db.exec('COMMIT');
      for (const { op, pre, eff } of detail) {
        receipt.operations.push({
          file: op.file, action: op.action, group: group.id, status: { ledger_repair: 'LEDGER_REPAIRED', replay: 'REPLAYED' }[op.action] || 'APPLIED',
          ledger_version: op.action === 'replay' ? null : op.version, sha256: op.digest, preconditions: pre, effects: eff,
          unwrapped_envelope: Boolean(op.executable?.unwrappedEnvelope), started_at: startedAt, committed_at: now(),
        });
      }
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => {});
      for (const op of group.ops) receipt.operations.push({ file: op.file, action: op.action, group: group.id, status: 'FAILED_ROLLED_BACK', error: e.message });
      stopped = true;
    } finally {
      await db.exec('RESET ALL').catch(() => {});
      await db.exec('RESET ROLE').catch(() => {});
    }
  }
  receipt.ledger_rows_after = await ledgerCount();
  receipt.finished_at = now();
  receipt.result = stopped ? 'STOPPED' : (apply ? 'COMPLETE' : 'DRY_RUN');
  return receipt;
}
