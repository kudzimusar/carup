/**
 * The staging runner's LEDGERS manifest must agree with the migrations it applies (Issue #127).
 *
 * `backend/scripts/diaspora-staging-apply-gtm.mjs` declares, per ledger, the tables and functions
 * whose ACL/RLS/EXECUTE contract it will verify after applying. That manifest is hand-maintained and
 * the migrations are not, so the two drift — and the drift is only discovered against the real
 * staging database, halfway through a run, with a credential in scope.
 *
 * Two directions of drift, both real and both silent:
 *
 *   · **Declared but not created.** The runner applies the migration, then verifies a table the
 *     migration never creates. That fails AFTER the apply committed, so staging is left one ledger
 *     ahead of where the run reports it stopped.
 *   · **Created but not declared.** Worse, because it PASSES. A table created without an entry in
 *     `tables` is never checked, so Supabase's `ALTER DEFAULT PRIVILEGES` grant to `anon` and
 *     `authenticated` — the platform behaviour that caused compensating ledgers #17, #19 and #20 —
 *     survives unnoticed on that one table, and the run reports a clean contract.
 *
 * This is a static check on purpose: it needs no database, so it runs in the ordinary backend suite
 * on every commit rather than only when someone dispatches a staging run.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../scripts/diaspora-staging-apply-gtm.mjs', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

const runnerSource = readFileSync(RUNNER, 'utf8');

/**
 * Read the LEDGERS array out of the runner without importing it.
 *
 * Importing would execute the script, which connects to a database. Evaluating just the array
 * literal keeps this test hermetic; the literal contains only strings, numbers and arrays.
 */
function readLedgers() {
  const start = runnerSource.indexOf('const LEDGERS = [');
  assert.notEqual(start, -1, 'LEDGERS array not found in the runner — was it renamed?');
  const open = runnerSource.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < runnerSource.length; i += 1) {
    if (runnerSource[i] === '[') depth += 1;
    else if (runnerSource[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, 'LEDGERS array is unterminated');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${runnerSource.slice(open, end + 1)}`)();
}

const LEDGERS = readLedgers();

/** The Up half only. A table dropped in Down must not count as created. */
function upSection(ledger) {
  const sql = readFileSync(`${MIGRATIONS}${ledger.version}_${ledger.name}.sql`, 'utf8');
  return {
    sql,
    up: sql.split(/^-- \+migrate Down/m)[0],
    sha12: createHash('sha256').update(sql).digest('hex').slice(0, 12),
  };
}

/** Strip SQL line and block comments so a commented-out CREATE is not read as a creation. */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
}

/** Strip JavaScript comments. The runner is JS, and its `//` comments are not SQL `--` comments. */
function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function createdTables(up) {
  const out = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  for (const m of stripComments(up).matchAll(re)) out.add(m[1].toLowerCase());
  return out;
}

/**
 * Functions a migration creates, split by whether they are callable.
 *
 * A `RETURNS trigger` function is NOT an RPC: it cannot be invoked through PostgREST, and its ACL is
 * left at the default because EXECUTE on it is meaningless — the trigger fires as the invoker. So it
 * must NOT appear in a ledger's `functions` list, which asserts service_role-only EXECUTE and would
 * fail against it. What still matters for a trigger function is its search_path, checked separately
 * below: an unpinned search_path on a function that fires inside someone else's transaction is a
 * genuine hijack surface.
 */
function createdFunctions(up) {
  const rpcs = new Set();
  const triggers = new Set();
  const clean = stripComments(up);
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?)\bAS\s+\$/gi;
  for (const m of clean.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (/RETURNS\s+trigger\b/i.test(m[2])) triggers.add(name);
    else rpcs.add(name);
  }
  return { rpcs, triggers };
}

/** Every function header in a migration, with the text between its name and its body. */
function functionHeaders(up) {
  const out = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?)\bAS\s+\$/gi;
  for (const m of stripComments(up).matchAll(re)) out.push({ name: m[1].toLowerCase(), header: m[2] });
  return out;
}

describe('diaspora staging runner manifest', () => {
  test('the parser found the manifest and it is not empty', () => {
    assert.ok(Array.isArray(LEDGERS), 'LEDGERS did not evaluate to an array');
    assert.ok(LEDGERS.length > 0, 'LEDGERS is empty — every check below would pass vacuously');
    for (const l of LEDGERS) {
      assert.equal(typeof l.n, 'number', 'ledger has no number');
      assert.match(l.version, /^\d{14}$/, `#${l.n} version is not a 14-digit timestamp`);
      assert.match(l.sha12, /^[0-9a-f]{12}$/, `#${l.n} sha12 is not a 12-hex checksum`);
    }
  });

  test('the parser can actually read a known entry (positive control)', () => {
    // If readLedgers() silently returned the wrong array, every other test would pass against it.
    const l21 = LEDGERS.find((l) => l.n === 21);
    assert.ok(l21, 'ledger #21 is absent from the manifest');
    assert.ok(
      l21.tables.includes('diaspora_safetrade_operations'),
      'the parsed manifest does not contain a table #21 is known to declare — the parse is wrong',
    );
  });

  test('every ledger file exists and matches its frozen checksum', () => {
    for (const l of LEDGERS) {
      const { sha12 } = upSection(l);
      assert.equal(
        sha12,
        l.sha12,
        `#${l.n} ${l.version}_${l.name}.sql checksum is ${sha12}, manifest says ${l.sha12}. ` +
          'The runner refuses on drift before connecting, so staging would fail closed — but fix the manifest.',
      );
    }
  });

  test('versions are unique and strictly increasing', () => {
    // Two ledgers sharing a version collide on supabase_migrations.schema_migrations' key, and the
    // collision surfaces mid-run against the real database rather than here.
    const seen = new Map();
    let previous = '';
    for (const l of LEDGERS) {
      assert.equal(seen.has(l.version), false, `version ${l.version} is used by #${seen.get(l.version)} and #${l.n}`);
      seen.set(l.version, l.n);
      assert.ok(l.version > previous, `#${l.n} version ${l.version} does not follow ${previous} — apply order is ambiguous`);
      previous = l.version;
    }
  });

  test('ledger numbers are unique and ascending', () => {
    const ns = LEDGERS.map((l) => l.n);
    assert.deepEqual(ns, [...new Set(ns)], 'duplicate ledger numbers');
    assert.deepEqual(ns, [...ns].sort((a, b) => a - b), 'ledger numbers are not in ascending order');
  });

  test('every declared table is actually created by its migration', () => {
    for (const l of LEDGERS) {
      const created = createdTables(upSection(l).up);
      for (const t of l.tables) {
        assert.ok(
          created.has(t.toLowerCase()),
          `#${l.n} declares table "${t}" but ${l.name}.sql never creates it. The runner would apply ` +
            'the migration and then fail verification, leaving staging one ledger ahead of the report.',
        );
      }
    }
  });

  test('every table a migration creates is declared, so none escapes the ACL contract', () => {
    for (const l of LEDGERS) {
      const declared = new Set(l.tables.map((t) => t.toLowerCase()));
      for (const t of createdTables(upSection(l).up)) {
        assert.ok(
          declared.has(t),
          `#${l.n} creates table "${t}" but does not declare it. It would never be checked, so ` +
            "Supabase's ALTER DEFAULT PRIVILEGES grant to anon/authenticated would survive on it and " +
            'the run would still report a clean contract — the exact failure ledgers #17/#19/#20 exist to compensate.',
        );
      }
    }
  });

  test('every declared function is actually created by its migration', () => {
    for (const l of LEDGERS) {
      const { rpcs } = createdFunctions(upSection(l).up);
      for (const f of l.functions) {
        assert.ok(rpcs.has(f.toLowerCase()), `#${l.n} declares function "${f}" but ${l.name}.sql never creates it as a callable function`);
      }
    }
  });

  test('every callable function a migration creates is declared, so none escapes the EXECUTE contract', () => {
    for (const l of LEDGERS) {
      const declared = new Set(l.functions.map((f) => f.toLowerCase()));
      for (const f of createdFunctions(upSection(l).up).rpcs) {
        assert.ok(
          declared.has(f),
          `#${l.n} creates callable function "${f}" but does not declare it, so its service_role-only ` +
            'EXECUTE and pinned search_path are never verified',
        );
      }
    }
  });

  test('trigger functions are excluded from the EXECUTE contract but must still pin search_path', () => {
    // A trigger function has no meaningful EXECUTE grant — declaring it would make the runner fail on
    // an ACL it is correct for it not to have. What it must not lack is a pinned search_path: it runs
    // inside whatever transaction fires it, so an unpinned one is resolvable by the caller.
    let checked = 0;
    for (const l of LEDGERS) {
      const { up } = upSection(l);
      const { triggers } = createdFunctions(up);
      for (const t of triggers) {
        assert.equal(
          l.functions.map((f) => f.toLowerCase()).includes(t),
          false,
          `#${l.n} declares trigger function "${t}" in functions[]; the runner would assert a ` +
            'service_role-only EXECUTE that a trigger function correctly does not have',
        );
        const header = functionHeaders(up).find((h) => h.name === t)?.header || '';
        assert.match(
          header,
          /SET\s+search_path\s*=/i,
          `#${l.n} trigger function "${t}" does not pin search_path — it fires inside the caller's ` +
            'transaction, so an unpinned search_path is resolvable by whoever triggers it',
        );
        checked += 1;
      }
    }
    // Guard against the whole test passing because the parser found no trigger functions at all.
    assert.ok(checked > 0, 'no trigger functions were found in any ledger — the parser is not working');
  });

  test('singleOverload only names functions the ledger actually declares', () => {
    for (const l of LEDGERS) {
      for (const f of l.singleOverload || []) {
        assert.ok(
          l.functions.includes(f),
          `#${l.n} marks "${f}" singleOverload but does not declare it — the check would never run`,
        );
      }
    }
  });

  test('a prerequisite is satisfied by an earlier ledger or predates this program', () => {
    // A prerequisite created by a LATER ledger means the manifest's own order cannot succeed.
    const createdSoFar = new Set();
    for (const l of LEDGERS) {
      for (const t of l.requiresTables || []) {
        const laterOwner = LEDGERS.find((o) => o.n > l.n && o.tables.some((x) => x.toLowerCase() === t.toLowerCase()));
        assert.equal(
          laterOwner === undefined,
          true,
          `#${l.n} requires "${t}", which is created by the LATER ledger #${laterOwner?.n}. Applied in ` +
            'manifest order this can never succeed.',
        );
        // Anything not created by an earlier ledger in this manifest must predate the program; that
        // is legitimate and is exactly what the runner's own prerequisite check confirms at runtime.
        void createdSoFar;
      }
      for (const t of l.tables) createdSoFar.add(t.toLowerCase());
    }
  });

  test('the runner still refuses the production ref and requires the staging ref', () => {
    // These two guards are the reason this script may hold a database credential at all. A refactor
    // that dropped either would be invisible to every other test in the suite.
    assert.match(runnerSource, /FORBIDDEN_PROD_REF/, 'the production-ref refusal constant is gone');
    assert.match(runnerSource, /rawUrl\.includes\(FORBIDDEN_PROD_REF\)/, 'the production-ref refusal is no longer applied');
    assert.match(runnerSource, /rawUrl\.includes\(STAGING_REF\)/, 'the positive staging-ref requirement is gone');
  });

  test('TLS verification is never disabled on a default path', () => {
    // rejectUnauthorized:false may appear exactly once in CODE, behind the explicit, loudly-warned
    // DIASPORA_STAGING_TLS_INSECURE escape hatch. A second occurrence means some other path silently
    // stopped verifying — which is how the pre-#127 appliers were written.
    //
    // Comments are stripped first: the runner's header explains at length why the older appliers'
    // `rejectUnauthorized: false` was wrong, and counting that explanation as an occurrence would
    // make this test fail for describing the very hazard it guards against.
    const code = stripJsComments(runnerSource);
    // Positive control: the stripper must not have eaten the code it is meant to leave behind.
    assert.match(code, /function tlsConfig\(\)/, 'the comment stripper removed live code — the count below is meaningless');
    const occurrences = code.match(/rejectUnauthorized:\s*false/g) || [];
    assert.equal(
      occurrences.length,
      1,
      `rejectUnauthorized:false appears ${occurrences.length} times; exactly one (the explicit ` +
        'DIASPORA_STAGING_TLS_INSECURE escape hatch) is permitted',
    );
    assert.match(runnerSource, /DIASPORA_STAGING_TLS_INSECURE/, 'the insecure path is no longer gated by its env flag');
  });
});
