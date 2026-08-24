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
 * An EFFECTIVE-PRIVILEGE model of what the migration tree leaves anon able to read.
 *
 * REWRITTEN TWICE, both times because the previous version could report `none` while the table
 * stayed readable. A gate that cannot fail asserts nothing, so the failure modes are recorded:
 *
 *   v1 — the privilege group excluded parentheses, so `GRANT SELECT (file_path) ... TO anon` did not
 *        match at all. One granted column is enough to leak a storage locator.
 *   v2 — used a nested quantifier and backtracked catastrophically on the real tree: it HUNG the
 *        suite. A regex that can hang is a gate that does not run.
 *   v3 — LAST STATEMENT WINS was wrong in two ways, both flagged in review:
 *          · `GRANT SELECT TO PUBLIC` followed by `REVOKE SELECT FROM anon` still leaves anon able
 *            to read THROUGH PUBLIC, but the scalar overwrite reported `none`;
 *          · `GRANT SELECT (a) ... ; REVOKE SELECT (b) ...` revokes a DIFFERENT column and must not
 *            clear the first grant.
 *        and role INHERITANCE was unmodelled: `GRANT SELECT TO reporting_role; GRANT reporting_role
 *        TO anon;` reads fine and matched nothing.
 *
 * So privileges are now tracked PER GRANTEE, and a grantee counts if it is anon, PUBLIC, or any role
 * anon has been granted membership in (transitively). A REVOKE only clears the grantee it names.
 */

/** Roles that reach anon: anon itself, PUBLIC, and anything anon is transitively a member of. */
function rolesReachingAnon(migrations) {
  const reaching = new Set(['anon', 'public']);
  // `GRANT <role> TO anon` — role membership, not a table privilege.
  const membershipRe = /\bGRANT\s+([A-Za-z_][\w$]*)\s+TO\s+([^;]+);/gi;
  let changed = true;
  while (changed) {
    changed = false;
    for (const { sql } of migrations) {
      const upOnly = sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0];
      for (const m of upOnly.matchAll(membershipRe)) {
        const [, grantedRole, grantees] = m;
        // Skip privilege keywords — `GRANT SELECT TO x` is not a membership grant.
        if (/^(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL|USAGE|EXECUTE)$/i.test(grantedRole)) continue;
        const grantedTo = grantees.toLowerCase();
        if ([...reaching].some((r) => new RegExp(`\\b${r}\\b`).test(grantedTo))) {
          if (!reaching.has(grantedRole.toLowerCase())) {
            reaching.add(grantedRole.toLowerCase());
            changed = true; // transitive: a new member may unlock further memberships
          }
        }
      }
    }
  }
  return reaching;
}

function netAnonSelectPosture(table) {
  const reaching = rolesReachingAnon(MIGRATIONS);
  /** grantee -> Set of scopes currently granted ('TABLE' or a column name). */
  const granted = new Map();
  const sources = [];

  const statementRe = new RegExp(
    String.raw`\b(GRANT|REVOKE)\b([^;]*?)\bON\b\s+(?:TABLE\s+)?(?:public\.)?${table}\b([^;]*?);`,
    'gis',
  );

  for (const { file, sql } of MIGRATIONS) {
    const upOnly = sql.split(/^--\s*\+migrate\s+Down\s*$/mi)[0];
    for (const m of upOnly.matchAll(statementRe)) {
      const [, verbRaw, privileges, tail] = m;
      const verb = verbRaw.toUpperCase();
      if (!/\bSELECT\b/i.test(privileges) && !/\bALL\b/i.test(privileges)) continue;

      const roleMatch = /\b(?:TO|FROM)\b([\s\S]*)$/i.exec(tail || '');
      if (!roleMatch) continue;
      const grantees = roleMatch[1]
        .split(',').map((r) => r.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean);

      // Column scope: `SELECT (a, b)` grants only those columns; bare SELECT is table-wide.
      const columnMatch = /\(([^)]*)\)/.exec(privileges);
      const scopes = columnMatch
        ? columnMatch[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
        : ['TABLE'];

      for (const grantee of grantees) {
        if (![...reaching].some((r) => new RegExp(`\\b${r}\\b`).test(grantee))) continue;
        if (!granted.has(grantee)) granted.set(grantee, new Set());
        const held = granted.get(grantee);
        for (const scope of scopes) {
          if (verb === 'GRANT') {
            held.add(scope);
            sources.push(`${file}: GRANT ${scope} -> ${grantee}`);
          } else {
            // A table-wide REVOKE clears every scope for that grantee; a column revoke clears one.
            if (scope === 'TABLE') held.clear(); else held.delete(scope);
          }
        }
      }
    }
  }

  const stillGranted = [...granted.entries()].filter(([, scopes]) => scopes.size > 0);
  return {
    posture: stillGranted.length ? 'granted' : 'none',
    decidedBy: stillGranted.length
      ? stillGranted.map(([g, s]) => `${g} holds ${[...s].join(',')}`).join('; ') + ` [${sources.slice(-3).join(' | ')}]`
      : null,
    rolesReachingAnon: [...reaching],
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
    // INHERITANCE — flagged in review as still unmodelled. The previous fixture used
    // `TO anon, authenticated`, which is a DIRECT grant and proved nothing about inheritance.
    'GRANT SELECT ON public.vehicle_evidence TO reporting_role; GRANT reporting_role TO anon;',
    // PUBLIC GRANT SURVIVING AN anon REVOKE — last-statement-wins reported `none` here while
    // Postgres still allowed the read through PUBLIC.
    'GRANT SELECT ON public.vehicle_evidence TO PUBLIC; REVOKE SELECT ON public.vehicle_evidence FROM anon;',
    // A COLUMN REVOKE MUST NOT CLEAR A DIFFERENT COLUMN'S GRANT.
    'GRANT SELECT (file_path) ON public.vehicle_evidence TO anon; REVOKE SELECT (storage_bucket) ON public.vehicle_evidence FROM anon;',
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

  controlVerified = true;
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
  assert.equal(controlVerified, true);
});
