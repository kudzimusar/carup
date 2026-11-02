// CA-CERT-04-R2 — executable behavioral mutation recertification.
//
// Certification-only harness. It transiently mutates the checked-out Phase-C migration,
// lets the already-accepted R1 two-session Real PostgreSQL harness install and exercise it
// against a fresh CI service container, proves the installed pg_get_functiondef(), and
// restores the frozen migration byte-for-byte before exit.
//
// Each CA_R2_CASE is run in its own GitHub Actions matrix job and therefore in a distinct,
// disposable PostgreSQL service container. No Supabase/staging/Production database is used.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PHASE_C = ROOT + 'database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql';
const R1 = ROOT + 'backend/tests/realpg/ca-k3-auth-04-r1-temporal-realpg.mjs';
const DB_URL = process.env.CA_R2_DATABASE_URL || '';
const CASE = process.env.CA_R2_CASE || '';
const PRODUCT_SHA = '082c73d85c1ae9e9d3b64674cdcb9d8dccbcd568';
const PHASE_C_BLOB = '747404734641952ca7f80ccaddb2ee2eafa0a677';
if (!DB_URL || !CASE) throw new Error('CA_R2_DATABASE_URL and CA_R2_CASE are required');

const canonical = readFileSync(PHASE_C, 'utf8');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const gitBlob = (s) => {
  const b = Buffer.from(s);
  return createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
};
const must = (x, m) => { if (!x) throw new Error(m); };
must(gitBlob(canonical) === PHASE_C_BLOB, 'frozen Phase-C blob mismatch before mutation');

function fn(sql, name) {
  const marker = 'CREATE OR REPLACE FUNCTION public.' + name + '(';
  const start = sql.indexOf(marker);
  must(start >= 0, name + ': function not found');
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + marker.length);
  return sql.slice(start, next < 0 ? sql.length : next);
}
function changeFn(sql, name, changer) {
  const before = fn(sql, name);
  const after = changer(before);
  must(after !== before, name + ': requested mutation was a no-op');
  return sql.replace(before, () => after);
}
const marker = (id) => 'CA-CERT-04-R2 ' + id;

function removeRequireStale(sql, id) {
  return changeFn(sql, 'corporate_authority_require', (body) => {
    const re = /  IF clock_timestamp\(\) - now\(\) > public\.corporate_authority_max_transaction_age\(\) THEN\n    RAISE EXCEPTION 'CORPORATE_GOVERNANCE\/TRANSACTION_STALE' USING DETAIL = 'a governed call must run in a fresh transaction: time rules are judged against the transaction start';\n  END IF;\n/;
    must(re.test(body), 'require stale gate not found');
    return body.replace(re, '  -- ' + marker(id) + ': post-lock stale gate removed\n');
  });
}
function moveCreateLockAfterRequire(sql, id) {
  return changeFn(sql, 'corporate_authority_apply_direct', (body) => {
    const lock = "    IF p_operation = 'CREATE' THEN\n      PERFORM pg_advisory_xact_lock(hashtextextended('corporate_membership_create|' || v_subject || '|' || v_node, 0));\n    END IF;\n\n";
    const requireCall = "    v_decision := public.corporate_authority_require(p_actor_user_id, v_subject, v_node, v_caps, p_operation = 'END',\n                                                     CASE WHEN p_operation = 'CREATE' THEN NULL ELSE p_membership_id END, TRUE);\n";
    must(body.includes(lock) && body.includes(requireCall), 'CREATE lock/require source not found');
    return body.replace(lock, '').replace(
      requireCall,
      requireCall + "    -- " + marker(id) + ": CREATE serialization moved after authority decision\n" + lock
    );
  });
}
function useTransactionTime(sql, functionName, id) {
  return changeFn(sql, functionName, (body) => {
    const wall = 'v_now timestamptz := clock_timestamp();';
    must(body.includes(wall), functionName + ': wall clock declaration not found');
    return body.replace(wall, 'v_now timestamptz := now(); -- ' + marker(id));
  });
}
function bypassFinalizer(sql, wrapper, id) {
  return changeFn(sql, wrapper, (body) => {
    const start = body.indexOf('  IF v_decision IS NOT NULL THEN\n    v_decision := public.corporate_authority_finalize(');
    const boundary = '  END IF;\n  RETURN v_result';
    const end = body.indexOf(boundary, start);
    must(start >= 0 && end >= 0, wrapper + ': finalizer block not found');
    return body.slice(0, start)
      + "  IF v_decision IS NOT NULL THEN\n    v_decision := v_decision; -- " + marker(id) + ": final rollback-producing validation bypassed\n"
      + boundary + body.slice(end + boundary.length);
  });
}
function removeRequestLock(sql, wrapper, id) {
  return changeFn(sql, wrapper, (body) => {
    const locked = 'FROM public.corporate_membership_requests WHERE request_id = p_request_id FOR UPDATE;';
    must(body.includes(locked), wrapper + ': request FOR UPDATE not found');
    return body.replace(
      locked,
      'FROM public.corporate_membership_requests WHERE request_id = p_request_id; -- ' + marker(id) + ': pre-authority request serialization removed'
    );
  });
}

const apply = {
  BASELINE: (s) => s,
  M1_LITERAL: (s) => removeRequireStale(s, 'M1 literal'),
  M1_SUBSTITUTE: (s) => bypassFinalizer(removeRequireStale(s, 'M1 substitute require'), 'corporate_authority_apply_direct', 'M1 substitute finalizer'),
  M2_LITERAL: (s) => moveCreateLockAfterRequire(s, 'M2 literal'),
  M2_SUBSTITUTE: (s) => bypassFinalizer(moveCreateLockAfterRequire(s, 'M2 substitute order'), 'corporate_authority_apply_direct', 'M2 substitute finalizer'),
  M3_LITERAL: (s) => useTransactionTime(s, 'corporate_authority_evaluate', 'M3 literal'),
  M4_LITERAL: (s) => useTransactionTime(s, 'corporate_authority_assert_a1_wall_clock', 'M4 literal'),
  M5_LITERAL: (s) => bypassFinalizer(s, 'corporate_authority_apply_direct', 'M5 literal'),
  M6_LITERAL: (s) => removeRequestLock(s, 'corporate_authority_request_decide', 'M6 literal'),
  M6_SUBSTITUTE: (s) => bypassFinalizer(removeRequestLock(s, 'corporate_authority_request_decide', 'M6 substitute lock'), 'corporate_authority_request_decide', 'M6 substitute finalizer'),
  M7_LITERAL: (s) => removeRequestLock(s, 'corporate_authority_request_execute', 'M7 literal'),
  M7_SUBSTITUTE: (s) => bypassFinalizer(removeRequestLock(s, 'corporate_authority_request_execute', 'M7 substitute lock'), 'corporate_authority_request_execute', 'M7 substitute finalizer'),
  M8_LITERAL: (s) => removeRequestLock(s, 'corporate_authority_request_cancel', 'M8 literal'),
  M8_SUBSTITUTE: (s) => bypassFinalizer(removeRequestLock(s, 'corporate_authority_request_cancel', 'M8 substitute lock'), 'corporate_authority_request_cancel', 'M8 substitute finalizer'),
};

const targets = {
  BASELINE: ['corporate_authority_apply_direct'],
  M1_LITERAL: ['corporate_authority_require'],
  M1_SUBSTITUTE: ['corporate_authority_require', 'corporate_authority_apply_direct'],
  M2_LITERAL: ['corporate_authority_apply_direct'],
  M2_SUBSTITUTE: ['corporate_authority_apply_direct'],
  M3_LITERAL: ['corporate_authority_evaluate'],
  M4_LITERAL: ['corporate_authority_assert_a1_wall_clock'],
  M5_LITERAL: ['corporate_authority_apply_direct'],
  M6_LITERAL: ['corporate_authority_request_decide'],
  M6_SUBSTITUTE: ['corporate_authority_request_decide'],
  M7_LITERAL: ['corporate_authority_request_execute'],
  M7_SUBSTITUTE: ['corporate_authority_request_execute'],
  M8_LITERAL: ['corporate_authority_request_cancel'],
  M8_SUBSTITUTE: ['corporate_authority_request_cancel'],
};

const safetyLabels = {
  M1: ['CREATE post-lock closure: denied TRANSACTION_STALE after release', 'CREATE: zero membership/request/event writes committed'],
  M2: ['CREATE post-lock closure: denied TRANSACTION_STALE after release', 'CREATE: zero membership/request/event writes committed'],
  M3: ['ASSIGNMENT_EXPIRES_WHILE_WAITING: fails closed after real-world expiry', 'MEMBERSHIP_WINDOW_EXPIRES_WHILE_WAITING: fails closed after real-world expiry'],
  M4: ['SESSION_EXPIRES_WHILE_WAITING: fails closed after real-world expiry', 'A1_EXPIRES_WHILE_WAITING: fails closed after real-world expiry'],
  M5: ['SESSION_EXPIRES_WHILE_WAITING: fails closed after real-world expiry', 'A1_EXPIRES_WHILE_WAITING: fails closed after real-world expiry'],
  M6: ['REQUEST DECIDE post-lock closure: denied TRANSACTION_STALE after release', 'DECIDE: no decision step committed'],
  M7: ['REQUEST EXECUTE post-lock closure: denied TRANSACTION_STALE after release', 'EXECUTE: no activation/restoration, event, or execution step committed'],
  M8: ['REQUEST CANCEL post-lock closure: denied TRANSACTION_STALE after release', 'CANCEL: no cancellation step committed'],
};

function runR1() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [R1], {
      cwd: ROOT,
      env: { ...process.env, CA_R1_DATABASE_URL: DB_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}
async function installedDefinitions(names) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const version = (await client.query('SHOW server_version')).rows[0].server_version;
    const defs = {};
    for (const name of names) {
      const result = await client.query(
        "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=$1 ORDER BY p.oid LIMIT 1",
        [name]
      );
      must(result.rows.length === 1, name + ': installed function definition missing');
      defs[name] = result.rows[0].def;
    }
    return { version, defs };
  } finally {
    await client.end();
  }
}
function requiredMarkers(caseName) {
  if (caseName === 'BASELINE') return [];
  const id = caseName.match(/^M[1-8]/)[0];
  if (caseName.endsWith('_SUBSTITUTE')) return [marker(id + ' substitute')];
  return [marker(id + ' literal')];
}
function targetedSafety(caseName, output) {
  const id = caseName.match(/^M[1-8]/)?.[0];
  if (!id) return true;
  const labels = safetyLabels[id];
  return labels.every((label) => output.includes('PASS  ' + label));
}
function printScenarioEvidence(output, labels = null) {
  for (const line of output.split('\n')) {
    if (/^PASS  /.test(line) && (!labels || labels.some((x) => line.includes(x)))) {
      console.log('BEHAVIOR_EVIDENCE ' + line);
    }
    if (/^FAIL  /.test(line)) console.log('BEHAVIOR_EVIDENCE ' + line);
    if (/REAL-POSTGRES PROOF:/.test(line)) console.log('BEHAVIOR_EVIDENCE ' + line);
  }
}

async function main() {
  must(apply[CASE], 'unknown CA_R2_CASE ' + CASE);
  const mutated = apply[CASE](canonical);
  writeFileSync(PHASE_C, mutated);
  try {
    const execution = await runR1();
    must(!/HARNESS ERROR:/.test(execution.out), CASE + ': install/harness error; this is not a valid behavioral kill\n' + execution.out.slice(-4000));

    const installed = await installedDefinitions(targets[CASE]);
    const joined = Object.values(installed.defs).join('\n');
    for (const needle of requiredMarkers(CASE)) {
      must(joined.includes(needle), CASE + ': pg_get_functiondef did not contain mutation marker "' + needle + '"');
    }

    const proof = {
      isolation: 'dedicated disposable GitHub Actions PostgreSQL service container; run=' + (process.env.GITHUB_RUN_ID || 'local') + '; job=' + (process.env.GITHUB_JOB || 'local'),
      database: new URL(DB_URL).pathname.slice(1),
      postgresql: installed.version,
      mutation_id: CASE,
      canonical_product_sha: PRODUCT_SHA,
      canonical_phase_c_git_blob: PHASE_C_BLOB,
      canonical_phase_c_sha256: sha256(canonical),
      mutated_migration_sha256: sha256(mutated),
      targets: targets[CASE],
      installed_function_sha256: Object.fromEntries(Object.entries(installed.defs).map(([k, v]) => [k, sha256(v)])),
      bounded_pg_get_functiondef_verification: true,
      install_complete: true,
    };
    console.log('INSTALLATION_PROOF ' + JSON.stringify(proof));

    if (CASE === 'BASELINE') {
      printScenarioEvidence(execution.out);
      must(execution.code === 0 && /REAL-POSTGRES PROOF: 52\/52 passed/.test(execution.out), 'canonical baseline failed accepted 52/52 suite');
      console.log('CANONICAL_BASELINE PASS — accepted Phase-C behavior unchanged');
      return;
    }

    const id = CASE.match(/^M[1-8]/)[0];
    const labels = safetyLabels[id];
    printScenarioEvidence(execution.out, labels);
    const safe = targetedSafety(CASE, execution.out) && execution.code === 0;

    if (CASE.endsWith('_SUBSTITUTE')) {
      must(!safe, CASE + ': substitute remained behaviorally safe; invariant-breaking mutant not proven');
      console.log('MUTANT_RESULT ' + CASE + ' KILLED — EXECUTABLE BEHAVIORAL FAILURE PROVEN');
      return;
    }

    if (safe) {
      console.log('MUTANT_RESULT ' + CASE + ' EQUIVALENT — INDEPENDENT CONTROL PRESERVES INVARIANT');
      return;
    }

    console.log('MUTANT_RESULT ' + CASE + ' KILLED — EXECUTABLE BEHAVIORAL FAILURE PROVEN');
    if (['M3_LITERAL', 'M4_LITERAL', 'M5_LITERAL'].includes(CASE)) return;
    // M1/M2/M6/M7/M8 literal mutation is allowed to be killed directly; no substitute is then necessary.
  } finally {
    writeFileSync(PHASE_C, canonical);
    must(gitBlob(readFileSync(PHASE_C, 'utf8')) === PHASE_C_BLOB, 'frozen Phase-C migration was not restored');
  }
}

main().catch((error) => {
  console.error('CA-CERT-04-R2 HARNESS ERROR:', error?.stack || error);
  process.exitCode = 1;
});
