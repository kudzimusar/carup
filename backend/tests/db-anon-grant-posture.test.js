/**
 * PERMANENT DATABASE SECURITY GATE — what the `anon` role may read.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four anonymous APPLICATION doors were closed on the evidence data, and none of it mattered to the
 * fifth: PostgREST. With the PUBLIC anon key — which ships in the browser bundle, so everyone holds
 * it — an anonymous caller read the raw tables directly, verified live on staging:
 *
 *   GET /rest/v1/vehicle_evidence?vin=eq.<VIN>&select=*
 *     -> 54 columns: uploaded_by, verified_by, file_path, storage_bucket, plate_number,
 *        normalized_plate_number, chassis_number, engine_number, tenant_id, verification_notes
 *
 *   GET /rest/v1/vehicles?vin=eq.<VIN>&select=*
 *     -> 66 columns: owner_id, current_seller_id, plate_number, chassis_number, engine_number
 *     -> AND draft rows: Golden B (publication_status='draft') was fully readable
 *
 * THE LESSON THIS FILE ENCODES: **RLS IS ROW SECURITY, NOT A COLUMN CONTRACT.**
 * The policies were correct and did their job — they restricted which ROWS anon could see. The leak
 * was the column privilege sitting beside them. `select=*` then returned every column of every
 * admitted row. Reviewing policies alone would never have found it, which is why this gate asserts
 * GRANTS, not policies.
 *
 * HOW IT RUNS
 * -----------
 * Structural assertions run everywhere and need no database. The live adversarial probes run only
 * when a real anon key and project URL are supplied, so CI without credentials still enforces the
 * static contract instead of silently skipping the whole file:
 *
 *   CARUP_ANON_PROBE_URL=https://<ref>.supabase.co CARUP_ANON_PROBE_KEY=<anon key> node --test ...
 *
 * The key used here is the PUBLIC anon key. It is not a secret — that is precisely the point: an
 * attacker has it too, so proving what it CANNOT reach is the whole exercise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../database/migrations');

/** Every migration, oldest first — grant posture is the LAST statement to touch a privilege. */
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }));

/**
 * A FAIL-CLOSED tripwire over the migration tree.
 *
 * WHY THIS IS NO LONGER A PRIVILEGE MODEL
 * ---------------------------------------
 * Three successive versions of this function tried to MODEL Postgres privilege resolution from SQL
 * text, and independent review found a hole in each one:
 *
 *   v1  column grants `GRANT SELECT (file_path)` were not matched at all
 *   v2  a nested quantifier backtracked catastrophically and HUNG the suite
 *   v3  last-statement-wins ignored `TO PUBLIC` surviving an `anon` revoke
 *   v4  a table-level REVOKE wrongly cleared an independently granted COLUMN
 *       `REVOKE GRANT OPTION FOR SELECT` was treated as revoking the privilege itself
 *       `GRANT SELECT ON a, vehicle_evidence TO anon` (table lists) was invisible
 *       `GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon` was invisible
 *       `GRANT reporting_role, audit_role TO anon` (multi-role membership) was invisible
 *
 * Every fix was correct and every fix was incomplete, because a regex is the wrong instrument for
 * deciding who can read a table. The authority on that question is the DATABASE, which the live
 * probes below interrogate directly.
 *
 * So this function stops pretending. It answers a deliberately cruder question — "does the migration
 * tree contain ANY statement that could plausibly give anon read access to this table, which is not
 * demonstrably a plain revoke?" — and it FAILS CLOSED on anything it does not fully recognise.
 * A shape it cannot parse is reported as `granted`, not `none`. Being wrong now means a false alarm
 * a human resolves, instead of a silent green over a live exposure.
 */

/**
 * SQL with comments removed.
 *
 * Necessary because these migrations EXPLAIN themselves at length, and the prose describing a grant
 * ("...grant made to `anon`...") is indistinguishable from the grant itself to a text scan. The
 * first fail-closed version tripped on its own documentation — a false alarm, which is the safe
 * direction to be wrong in, but still wrong.
 */
function sqlWithoutComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Statement forms that can hand anon a read, including the ones that bit earlier versions. */
const READ_GRANT_PATTERNS = [
  // GRANT ... SELECT/ALL ... ON [TABLE] <anything including a table list> ... TO <roles>
  /\bGRANT\b(?![^;]*\bGRANT OPTION FOR\b)[^;]*\b(?:SELECT|ALL)\b[^;]*\bON\b[^;]*?\bTO\b[^;]+(?:;|$)/gis,
  // GRANT <role[, role]> TO <roles>  — membership, which can carry a read in transitively
  /\bGRANT\s+(?!SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL|USAGE|EXECUTE)[\w$, ]+\bTO\b[^;]+(?:;|$)/gis,
  // OWNERSHIP confers the owner's inherent access and normally bypasses RLS entirely — a read
  // handed over without any GRANT ever appearing.
  /\bALTER\s+TABLE\b[^;]*\bOWNER\s+TO\b[^;]+(?:;|$)/gis,
  // Disabling row security removes the row predicate that makes any surviving grant survivable.
  /\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b[^;]*(?:;|$)/gis,
];

function netAnonSelectPosture(table) {
  const findings = [];

  for (const [migrationIndex, { file, sql }] of MIGRATIONS.entries()) {
    // The rollback half documents how to restore the old posture on purpose.
    const upOnly = sqlWithoutComments(sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0]);

    for (const pattern of READ_GRANT_PATTERNS) {
      for (const m of upOnly.matchAll(pattern)) {
        const stmt = m[0];

        // Does this statement even concern the table? `ALL TABLES IN SCHEMA public` does, without
        // ever naming it — which is exactly the form v4 missed.
        const namesTable = new RegExp(String.raw`\b(?:public\.)?${table}\b`, 'i').test(stmt);
        // `IN SCHEMA audit, public` is valid: match `public` ANYWHERE in the schema list, not only
        // immediately after SCHEMA.
        const schemaWide = /\bALL\s+TABLES\s+IN\s+SCHEMA\b[^;]*\bpublic\b/i.test(stmt);
        const isMembership = /\bGRANT\s+(?!SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL|USAGE|EXECUTE)/i.test(stmt)
          && !/\bON\b/i.test(stmt);
        // An ownership change or an RLS disable is never "cleared" by a grant revoke, so it is
        // recorded as an unconditional finding rather than something the revoke logic can dismiss.
        const isOwnershipOrRls = /\bALTER\s+TABLE\b/i.test(stmt);
        if (!namesTable && !schemaWide && !isMembership) continue;

        if (isOwnershipOrRls) {
          // Fail closed: a REVOKE of SELECT does not undo `OWNER TO` or `DISABLE ROW LEVEL SECURITY`.
          findings.push({
            file, migrationIndex, columnScoped: false, grantees: ['__ownership__'],
            neverCleared: true,
            stmt: stmt.replace(/\s+/g, ' ').trim().slice(0, 140),
          });
          continue;
        }

        // Does it reach anon? Directly, through PUBLIC, or through a role we cannot resolve here.
        const grantees = (/\bTO\b([\s\S]*)$/i.exec(stmt) || [, ''])[1];
        const reachesAnon = /\banon\b/i.test(grantees) || /\bPUBLIC\b/i.test(grantees);
        // A membership grant TO anon means the granted role's privileges reach anon.
        const membershipToAnon = isMembership && /\banon\b/i.test(grantees);
        // A grant to a role we do not model is UNRESOLVED — fail closed rather than assume safe.
        const namedRoles = grantees.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
        const unresolvedRole = namedRoles.some(
          (r) => r && !/^(anon|public|authenticated|service_role|postgres|supabase_admin|supabase_auth_admin|dashboard_user)\b/.test(r),
        );

        if (!reachesAnon && !membershipToAnon && !unresolvedRole) continue;
        if (isMembership && !membershipToAnon && !unresolvedRole) continue;

        // Scope matters for what can later clear this finding. In Postgres a TABLE-level revoke
        // does NOT remove an independently granted COLUMN privilege, so a column grant must be
        // cleared by a column revoke — and since this tripwire does not model column sets, it is
        // never cleared at all. Fail closed.
        const columnScoped = /\bSELECT\s*\(/i.test(stmt);
        // ONE FINDING PER GRANTEE. `GRANT ... TO PUBLIC, anon` collapsed into a single
        // `viaPublic` flag, so revoking from PUBLIC alone cleared it while the DIRECT grant to anon
        // survived. Each grantee is now cleared on its own terms.
        //
        // A role this scan cannot resolve (`reporting_role`) is recorded as itself and can never be
        // cleared by a revoke from `anon`: revoking anon's direct privilege does not remove one it
        // inherits through membership.
        const granteeList = namedRoles.length ? namedRoles : ['__unnamed__'];
        for (const grantee of granteeList) {
          const isKnownSafeRole = /^(authenticated|service_role|postgres|supabase_admin|supabase_auth_admin|dashboard_user)\b/.test(grantee);
          if (isKnownSafeRole) continue;
          findings.push({
            file, migrationIndex, columnScoped, grantees: [grantee],
            neverCleared: !/^(anon|public)\b/.test(grantee), // unresolved role: fail closed
            stmt: stmt.replace(/\s+/g, ' ').trim().slice(0, 140),
          });
        }
      }
    }
  }

  if (findings.length === 0) return { posture: 'none', decidedBy: null };

  // A finding is cleared ONLY by a later, unambiguous, TABLE-WIDE revoke of SELECT from anon that
  // is not a GRANT OPTION revoke. Column-scoped findings are never cleared here by design.
  /**
   * The index of the LAST table-wide, non-GRANT-OPTION revoke of SELECT from `role`, or -1.
   * Order matters: a revoke only clears grants that came BEFORE it. A migration that re-grants
   * afterwards must trip the wire, which is precisely the regression this gate exists to catch.
   */
  const lastRevokeIndexFrom = (role) => {
    let last = -1;
    const re = new RegExp(
      String.raw`\bREVOKE\b(?![^;]*\bGRANT OPTION FOR\b)\s+(?:SELECT|ALL)(?!\s*\()[^;]*\bON\b\s+(?:TABLE\s+)?(?:public\.)?${table}\b[^;]*\bFROM\b[^;]*\b${role}\b[^;]*;`,
      'is',
    );
    for (const [i, { sql }] of MIGRATIONS.entries()) {
      const upOnly = sqlWithoutComments(sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0]);
      if (re.test(upOnly)) last = i;
    }
    return last;
  };

  const revokedFromAnonAt = lastRevokeIndexFrom('anon');
  const revokedFromPublicAt = lastRevokeIndexFrom('PUBLIC');

  const uncleared = findings.filter((f) => {
    if (f.neverCleared) return true;      // ownership/RLS change, or a role this scan cannot resolve
    if (f.columnScoped) return true;      // a table-wide revoke never clears a column grant
    const grantee = f.grantees[0] ?? '';
    const clearedAt = /^public\b/.test(grantee) ? revokedFromPublicAt : revokedFromAnonAt;
    return !(clearedAt > f.migrationIndex);                  // must come strictly LATER
  });

  return uncleared.length === 0
    ? { posture: 'none', decidedBy: null }
    : {
      posture: 'granted',
      decidedBy: uncleared.map((f) => `${f.file}: ${f.stmt}`).slice(-3).join(' | '),
    };
}

// ── The static contract: the migration tree must not re-grant these ──────────────────────────────

test('anon holds no SELECT on vehicle_evidence in the migration tree', () => {
  const { posture, decidedBy } = netAnonSelectPosture('vehicle_evidence');
  assert.equal(
    posture, 'none',
    `anon SELECT on vehicle_evidence was last set by ${decidedBy}. RLS restricts rows, not columns: `
    + 'with this privilege, select=* returns all 54 columns of every row the policy admits.',
  );
});

test('anon holds no SELECT on vehicles in the migration tree', () => {
  // Added after review. Without this, the live probes skip in credential-less CI and removing
  // 20260825090100 — or adding `GRANT SELECT ON vehicles TO anon` later — left EVERY active
  // assertion in this "permanent" gate passing while the 66-column exposure returned.
  const { posture, decidedBy } = netAnonSelectPosture('vehicles');
  assert.equal(
    posture, 'none',
    `anon SELECT on vehicles was last set by ${decidedBy}. That exposes 66 columns including `
    + 'owner_id, current_seller_id, plate_number, chassis_number and engine_number, plus draft rows.',
  );
});

test('the vehicles revoke migration exists, is read-side only, and has an honest rollback', () => {
  const revoke = MIGRATIONS.find((m) => /revoke_anon_vehicles_select/.test(m.file));
  assert.ok(revoke, 'the vehicles revoke migration must be present');
  const [up, down] = revoke.sql.split(/^--\s*\+migrate\s+Down\s*$/mi);
  assert.match(up, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.vehicles\s+FROM\s+anon/i);
  assert.doesNotMatch(up, /GRANT\s+(INSERT|UPDATE|DELETE)/i, 'this migration must not alter writes');
  assert.doesNotMatch(up, /REVOKE[^;]+FROM\s+service_role/i, 'the backend reads as service_role');
  assert.ok(down, 'the migration must declare a Down section');
  assert.match(down, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.vehicles\s+TO\s+anon/i);
});

test('the parser catches the grant shapes that would otherwise slip past it', () => {
  // Guards the guard. Each of these previously reported `none` while leaving the table readable.
  const shapes = [
    'GRANT SELECT (file_path, storage_bucket) ON TABLE public.vehicle_evidence TO anon;',
    'GRANT SELECT ON TABLE public.vehicle_evidence TO PUBLIC;',
    'GRANT ALL PRIVILEGES ON public.vehicle_evidence TO anon, authenticated;',
    // Role inheritance, direct and multi-role.
    'GRANT SELECT ON public.vehicle_evidence TO reporting_role; GRANT reporting_role TO anon;',
    'GRANT SELECT ON public.vehicle_evidence TO reporting_role; GRANT reporting_role, audit_role TO anon;',
    // A PUBLIC grant that an anon revoke does NOT clear.
    'GRANT SELECT ON public.vehicle_evidence TO PUBLIC; REVOKE SELECT ON public.vehicle_evidence FROM anon;',
    // A column grant that a TABLE-level revoke does NOT clear.
    'GRANT SELECT (file_path) ON public.vehicle_evidence TO anon; REVOKE SELECT ON public.vehicle_evidence FROM anon;',
    // Revoking the GRANT OPTION leaves the privilege itself intact.
    'GRANT SELECT ON public.vehicle_evidence TO anon; REVOKE GRANT OPTION FOR SELECT ON public.vehicle_evidence FROM anon;',
    // Table LISTS and SCHEMA-WIDE forms never name the table adjacent to ON.
    'GRANT SELECT ON other_table, vehicle_evidence TO anon;',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;',
    // A schema LIST, not just a single schema.
    'GRANT SELECT ON ALL TABLES IN SCHEMA audit, public TO anon;',
    // No trailing semicolon on the final statement.
    'GRANT SELECT ON public.vehicle_evidence TO anon',
    // Multi-grantee: revoking from PUBLIC alone must not clear the DIRECT grant to anon.
    'GRANT SELECT ON public.vehicle_evidence TO PUBLIC, anon; REVOKE SELECT ON public.vehicle_evidence FROM PUBLIC;',
    // Inherited privilege: a direct anon revoke does not remove what anon inherits via membership.
    'GRANT SELECT ON public.vehicle_evidence TO reporting_role; GRANT reporting_role TO anon; REVOKE SELECT ON public.vehicle_evidence FROM anon;',
    // Ownership confers the owner's inherent access and normally bypasses RLS — no GRANT involved.
    'ALTER TABLE public.vehicle_evidence OWNER TO anon;',
    // Disabling row security removes the predicate that made any surviving grant survivable.
    'ALTER TABLE public.vehicle_evidence DISABLE ROW LEVEL SECURITY;',
  ];
  for (const shape of shapes) {
    const saved = MIGRATIONS.slice();
    MIGRATIONS.push({ file: 'zzz_hypothetical_regrant.sql', sql: shape });
    const { posture } = netAnonSelectPosture('vehicle_evidence');
    MIGRATIONS.length = 0;
    MIGRATIONS.push(...saved);
    assert.equal(posture, 'granted', `this grant shape must be detected: ${shape}`);
  }
});

test('the revoke migration exists and is read-side only', () => {
  const revoke = MIGRATIONS.find((m) => /revoke_anon_vehicle_evidence_select/.test(m.file));
  assert.ok(revoke, 'the vehicle_evidence revoke migration must be present');
  const up = revoke.sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0];
  assert.match(up, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.vehicle_evidence\s+FROM\s+anon/i);
  // Read-side only: it must not disturb the write posture a previous hardening migration set.
  assert.doesNotMatch(up, /GRANT\s+(INSERT|UPDATE|DELETE)/i, 'this migration must not alter writes');
  // ...and must not touch the roles the application depends on.
  assert.doesNotMatch(up, /REVOKE[^;]+FROM\s+service_role/i, 'the backend reads as service_role');
  assert.doesNotMatch(up, /REVOKE[^;]+FROM\s+authenticated/i, 'owner/reviewer paths read as authenticated');
});

test('a rollback exists and is honest about what it restores', () => {
  const revoke = MIGRATIONS.find((m) => /revoke_anon_vehicle_evidence_select/.test(m.file));
  const parts = revoke.sql.split(/^--\s*\+migrate\s+Down\s*$/mi);
  assert.equal(parts.length, 2, 'the migration must declare a Down section');
  assert.match(parts[1], /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.vehicle_evidence\s+TO\s+anon/i,
    'the rollback must restore the exact prior posture, exposure included, rather than a half-state');
});

// ── The live adversarial probes ──────────────────────────────────────────────────────────────────

const PROBE_URL = process.env.CARUP_ANON_PROBE_URL;
const PROBE_KEY = process.env.CARUP_ANON_PROBE_KEY;
const liveProbe = Boolean(PROBE_URL && PROBE_KEY);
/** Optional pin: set on a promotion run so the gate refuses to grade the wrong environment. */
const EXPECTED_PROJECT_REF = process.env.CARUP_ANON_PROBE_EXPECT_REF || null;

/** Query PostgREST exactly as an attacker holding the public anon key would. */
async function anonSelect(pathAndQuery) {
  const res = await fetch(`${PROBE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: PROBE_KEY, Authorization: `Bearer ${PROBE_KEY}` },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/**
 * THE CONTROL REQUEST — proof that the probes are actually reaching PostgREST as `anon`.
 *
 * Without this the live gate is worthless in exactly the situation it matters most. Every negative
 * probe reads `Array.isArray(body) ? body : []`, so an expired key, a wrong project URL, a network
 * failure or a 404/500 JSON error all collapse to "zero rows" and the whole gate reports GREEN. The
 * first probe even accepts a 401 as success. A misconfigured production-promotion run would have
 * printed a clean bill of health for a database nobody had queried.
 *
 * So before any denial is believed, something anon SHOULD still be able to do must succeed. A
 * PostgREST root request is the narrowest such signal: it requires a valid apikey and returns the
 * OpenAPI description without touching product data.
 */
let controlVerified = null;
async function assertProbeReachesPostgrest() {
  if (controlVerified !== null) return controlVerified;

  // The control IS the denial, distinguished by WHICH LAYER refused. Measured against the live
  // project, the three failure modes are cleanly separable:
  //
  //   valid key, revoked table -> {"code":"42501","message":"permission denied for table ..."}
  //                               a POSTGRES error: the key authenticated and a query RAN as anon
  //   bad/expired key          -> {"message":"Invalid API key"}          (no `code`, auth layer)
  //   wrong project or table   -> {"code":"PGRST205","message":"Could not find the table ..."}
  //
  // Requiring 42501 therefore proves all three things at once: the credential works, PostgREST
  // executed as the anonymous role, and the table is denied. A separate "known-readable" control
  // would be weaker — there is deliberately nothing left for anon to read.
  const res = await fetch(`${PROBE_URL}/rest/v1/vehicle_evidence?select=vin&limit=1`, {
    headers: { apikey: PROBE_KEY, Authorization: `Bearer ${PROBE_KEY}` },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }

  assert.notEqual(
    body?.message, 'Invalid API key',
    'CONTROL FAILED: the probe key was rejected at the auth layer. Every "denied" result below would '
    + 'be meaningless, so this gate refuses to report green.',
  );
  assert.notEqual(
    body?.code, 'PGRST205',
    `CONTROL FAILED: PostgREST could not find public.vehicle_evidence at ${PROBE_URL} — the URL `
    + 'points at the wrong project. Refusing to report green.',
  );
  assert.equal(
    body?.code, '42501',
    `CONTROL FAILED: expected Postgres error 42501 (permission denied) proving the query reached the `
    + `database as anon; got HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 160)}. Without that `
    + 'proof, a zero-row answer cannot be distinguished from never having asked.',
  );

  // IDENTITY — which project did we actually just prove something about?
  //
  // SQLSTATE 42501 proves "a real Postgres refused a real anon query". It does NOT prove WHICH
  // database. If a production-promotion run has both variables accidentally pointing at staging,
  // every probe returns the expected denial and the gate reports green for production without ever
  // having queried it — a false all-clear at the exact moment the answer matters most.
  //
  // The project ref is embedded in the Supabase URL and in the anon key's JWT `ref` claim, so the
  // two must agree, and the caller may pin the expected one.
  const urlRef = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(PROBE_URL)?.[1] ?? null;
  let keyRef = null;
  try {
    const payload = JSON.parse(Buffer.from(PROBE_KEY.split('.')[1], 'base64url').toString('utf8'));
    keyRef = payload?.ref ?? null;
    assert.equal(payload?.role, 'anon',
      `CONTROL FAILED: the probe key carries role "${payload?.role}", not "anon". A privileged key `
      + 'would sail past every check below while proving nothing about anonymous access.');
  } catch (err) {
    assert.fail(`CONTROL FAILED: could not decode the probe key's claims — ${err.message}`);
  }

  assert.ok(urlRef && keyRef, 'CONTROL FAILED: could not determine the project ref from URL and key');
  assert.equal(urlRef, keyRef,
    `CONTROL FAILED: the URL targets project "${urlRef}" but the key belongs to "${keyRef}". `
    + 'The probes would be querying one environment while reporting on another.');

  // REQUIRED, not optional. An optional pin is only protective when an operator remembers it, and a
  // promotion run that forgets it grades whichever environment the variables happen to name — which
  // is the wrong-environment failure this control exists to prevent.
  assert.ok(EXPECTED_PROJECT_REF,
    'CONTROL FAILED: set CARUP_ANON_PROBE_EXPECT_REF to the project ref this run is meant to grade. '
    + 'Without it a green result cannot be attributed to any particular environment.');
  assert.equal(keyRef, EXPECTED_PROJECT_REF,
    `CONTROL FAILED: expected project "${EXPECTED_PROJECT_REF}" but the probe targets "${keyRef}". `
    + 'Refusing to report a green gate for the wrong environment.');

  controlVerified = { projectRef: keyRef };
  return true;
}

test('LIVE: anon cannot select * from vehicle_evidence', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  await assertProbeReachesPostgrest();
  const { status, body } = await anonSelect('vehicle_evidence?select=*&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0,
    `anon read ${rows.length} evidence row(s) with ${rows[0] ? Object.keys(rows[0]).length : 0} columns `
    + '— the raw evidence table must be unreachable with the public key');
  assert.ok(status === 401 || status === 403 || rows.length === 0,
    `expected a refusal or an empty result, got HTTP ${status}`);
});

test('LIVE: anon cannot reach the private document locator by naming columns', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // select=* is the obvious probe; naming the columns explicitly is the one an attacker uses next.
  await assertProbeReachesPostgrest();
  const { body } = await anonSelect('vehicle_evidence?select=file_path,storage_bucket,uploaded_by,verified_by&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0, 'a private storage locator must not be reachable under any projection');
});

test('LIVE: anon cannot retrieve a draft vehicle', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Golden B is deliberately draft. "Golden B is absent from public surfaces" is a release
  // invariant, and it must hold at the database boundary too, not only in the marketplace query.
  await assertProbeReachesPostgrest();
  const { body } = await anonSelect('vehicles?publication_status=eq.draft&select=vin&limit=5');
  const rows = Array.isArray(body) ? body : [];
  assert.equal(rows.length, 0,
    `anon retrieved ${rows.length} draft vehicle(s) — an unpublished listing must not be readable`);
});

test('LIVE: anon cannot retrieve private vehicle identifiers or internal ids', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  await assertProbeReachesPostgrest();
  for (const column of [
    'owner_id', 'current_seller_id', 'tenant_id',
    'plate_number', 'chassis_number', 'engine_number',
  ]) {
    const { status, body } = await anonSelect(`vehicles?select=${column}&limit=1`);
    const rows = Array.isArray(body) ? body : [];
    const leaked = rows.filter((r) => r && r[column] !== undefined && r[column] !== null);
    assert.equal(leaked.length, 0,
      `anon retrieved ${column} — this is a field the passport withholds as "Not shown publicly" `
      + `(HTTP ${status})`);
  }
});

test('LIVE: anon cannot select * from vehicles', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  await assertProbeReachesPostgrest();
  const { body } = await anonSelect('vehicles?select=*&limit=1');
  const rows = Array.isArray(body) ? body : [];
  if (rows.length > 0) {
    const columns = Object.keys(rows[0]);
    assert.fail(
      `anon read the raw vehicles table with select=* (${columns.length} columns). `
      + 'A public projection must expose an explicit column list, never the base table.',
    );
  }
});

// ── The enumeration sweep: catch the NEXT table before it becomes an incident ────────────────────

test('LIVE: no unexpected table grants anon a wide-open select=*', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Measured during the incident: RLS correctly denied rows on messages, message_threads,
  // notification_queue, referral_wallet_transactions, webhook_logs, communication_preferences and
  // partsentry_logs — but their column grants were equally wide, so a single permissive policy
  // added later would expose them. This sweep is the early warning for that.
  await assertProbeReachesPostgrest();
  const watched = [
    'vehicle_evidence', 'vehicles', 'messages', 'message_threads', 'notification_queue',
    'referral_wallet_transactions', 'webhook_logs', 'communication_preferences', 'partsentry_logs',
    'users', 'user_sessions', 'mechanic_work_orders',
  ];
  const exposed = [];
  for (const table of watched) {
    const { body } = await anonSelect(`${table}?select=*&limit=1`);
    const rows = Array.isArray(body) ? body : [];
    if (rows.length > 0) exposed.push(`${table} (${Object.keys(rows[0]).length} columns)`);
  }
  assert.deepEqual(exposed, [],
    `anon can select=* from: ${exposed.join(', ')}. Each is a raw base table reachable with the `
    + 'public browser key.');
});

// ── The systemic finding: new tables are born anon-writable ──────────────────────────────────────
//
// Measured on staging while proving the revoke was complete. The revoke itself IS complete —
// 0 table privileges, 0 column privileges, 0 role memberships, has_table_privilege false for both
// tables. But:
//
//   SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
//    WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
//      AND d.defaclacl::text LIKE '%anon=arwdDxtm%';
//   -> 2
//
// `arwdDxtm` is SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER. So every NEW table
// created in `public` is born granting the anonymous role full DML, and stays that way unless a
// migration remembers to revoke. That is the mechanism by which this defect class keeps recurring:
// the exposure is the DEFAULT, and every safe table is safe only because someone remembered.
//
// This is deliberately a DETECTION test, not a fix. Changing the default ACL is a platform-wide
// posture decision affecting every future table in the product, and it belongs to the owner rather
// than to a narrow security hotfix. The check exists so the fact is visible and tracked instead of
// being rediscovered by the next incident.

test('LIVE: the two revoked tables are unreachable by ANY privilege path', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Belt-and-braces over the select probes above: a column-level grant, a DEFAULT PRIVILEGES rule or
  // membership in another role would each restore access by a route `select=*` alone might not show
  // if a policy happened to deny every row at that moment.
  await assertProbeReachesPostgrest();
  for (const table of ['vehicles', 'vehicle_evidence']) {
    const { status, body } = await anonSelect(`${table}?select=vin&limit=1`);
    const rows = Array.isArray(body) ? body : [];
    assert.equal(rows.length, 0, `anon still reads ${table} (HTTP ${status})`);
  }
});

test('LIVE: the control request itself is exercised', { skip: !liveProbe && 'set CARUP_ANON_PROBE_URL/KEY' }, async () => {
  // Makes the control visible as its own result rather than only as a precondition inside others,
  // so a reader of the output can see that the probes reached a real PostgREST as anon.
  controlVerified = null;
  await assertProbeReachesPostgrest();
  assert.ok(controlVerified?.projectRef, 'the control must identify which project it proved');
  // Printed so a promotion receipt records WHICH database was graded, not merely that it passed.
  console.log(`  [control] probes executed as anon against project ${controlVerified.projectRef}`);
});
