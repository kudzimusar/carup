#!/usr/bin/env node
/**
 * The staging runner's function-ACL detector must be able to FIRE (Issue #127).
 *
 * `backend/scripts/diaspora-staging-apply-gtm.mjs` verifies, after applying each ledger, that no
 * client role can execute the RPCs it created. That check previously parsed `p.proacl::text` and
 * matched `/(^|,)=[a-zA-Z]/` for a PUBLIC grant — and that pattern is structurally unmatchable.
 *
 * An aclitem[] renders as `{entry,entry,...}`. The PUBLIC entry is grantee 0, which prints with an
 * EMPTY grantee name, and it is always element ZERO — so it is preceded by `{`, never by a comma and
 * never by start-of-string. The `anon=` and `authenticated=` checks do not compensate: a role
 * inherits EXECUTE through PUBLIC without ever gaining an ACL entry of its own.
 *
 * The consequence was not theoretical. A SECURITY DEFINER function shipped without its
 * `REVOKE ALL ... FROM PUBLIC` line would be executable by anon, running as the table owner and
 * therefore BYPASSING RLS — and the staging run would have printed "contract verified" and exited 0.
 *
 * This harness proves three things against real PostgreSQL, in order:
 *   1. the hazard is reproducible here — a function granted only to service_role really is
 *      executable by anon (if this ever stops being true, everything below passes vacuously);
 *   2. the OLD text-parsing detector cannot see it;
 *   3. the NEW has_function_privilege detector does see it, and stays quiet on a correctly locked
 *      function — a detector that fires on everything is as useless as one that fires on nothing.
 */
import { PGlite } from '@electric-sql/pglite';

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
};

/** The detector as it was written before this fix. Kept here as the negative control. */
const OLD_DETECTOR = {
  anon: (acl) => /(^|,)anon=/.test(acl),
  authenticated: (acl) => /(^|,)authenticated=/.test(acl),
  public: (acl) => /(^|,)=[a-zA-Z]/.test(acl),
};

/** The detector as the runner now implements it: effective privilege, however acquired. */
async function newDetector(db, oid, role) {
  const { rows } = await db.query('SELECT has_function_privilege($1, $2::oid, $3) h', [role, oid, 'EXECUTE']);
  return rows[0].h;
}

async function main() {
  const db = new PGlite();
  try {
    await db.query('CREATE ROLE anon');
    await db.query('CREATE ROLE authenticated');
    await db.query('CREATE ROLE service_role');

    console.log('\n── 1. the hazard is live in this harness (positive control) ──');

    // LEAKY: created and granted to service_role, but PUBLIC is never revoked. This is exactly what a
    // migration looks like when its REVOKE line is forgotten or its DO-block loop matches zero rows.
    await db.query(`
      CREATE FUNCTION public.leaky_fn(p_x text) RETURNS text
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT p_x $$`);
    await db.query('GRANT EXECUTE ON FUNCTION public.leaky_fn(text) TO service_role');

    // LOCKED: the contract every Diaspora ledger is supposed to meet.
    await db.query(`
      CREATE FUNCTION public.locked_fn(p_x text) RETURNS text
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT p_x $$`);
    await db.query('REVOKE ALL ON FUNCTION public.locked_fn(text) FROM PUBLIC');
    await db.query('REVOKE ALL ON FUNCTION public.locked_fn(text) FROM anon');
    await db.query('REVOKE ALL ON FUNCTION public.locked_fn(text) FROM authenticated');
    await db.query('GRANT EXECUTE ON FUNCTION public.locked_fn(text) TO service_role');

    const meta = {};
    for (const name of ['leaky_fn', 'locked_fn']) {
      const { rows } = await db.query(
        `SELECT p.oid oid, p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=$1`, [name]);
      meta[name] = rows[0];
    }

    console.log(`     leaky  proacl = ${meta.leaky_fn.acl}`);
    console.log(`     locked proacl = ${meta.locked_fn.acl}`);

    const anonCanLeaky = await newDetector(db, meta.leaky_fn.oid, 'anon');
    ok('a function with no PUBLIC revoke IS executable by anon (the hazard exists)', anonCanLeaky === true,
      'if this is false the harness proves nothing — every assertion below would pass vacuously');

    const anonCanLocked = await newDetector(db, meta.locked_fn.oid, 'anon');
    ok('a correctly locked function is NOT executable by anon', anonCanLocked === false);

    console.log('\n── 2. the OLD text-parsing detector is blind to it (negative control) ──');

    const oldSawIt = OLD_DETECTOR.anon(meta.leaky_fn.acl)
      || OLD_DETECTOR.authenticated(meta.leaky_fn.acl)
      || OLD_DETECTOR.public(meta.leaky_fn.acl);
    ok('the old detector reports the leaky function as CLEAN (this is the defect)', oldSawIt === false,
      `old detector fired unexpectedly on ${meta.leaky_fn.acl}`);
    ok('specifically, the PUBLIC pattern cannot match a real aclitem[] rendering',
      OLD_DETECTOR.public(meta.leaky_fn.acl) === false && meta.leaky_fn.acl.startsWith('{=X/'),
      'the PUBLIC entry is element zero, preceded by "{" — never by "^" or ","');

    console.log('\n── 3. the NEW effective-privilege detector sees it ──');

    ok('the new detector FIRES on the leaky function via anon', await newDetector(db, meta.leaky_fn.oid, 'anon'));
    ok('the new detector FIRES on the leaky function via authenticated',
      await newDetector(db, meta.leaky_fn.oid, 'authenticated'));
    ok('the new detector FIRES on the leaky function via PUBLIC',
      await newDetector(db, meta.leaky_fn.oid, 'public'));

    ok('the new detector stays QUIET on the locked function via anon',
      (await newDetector(db, meta.locked_fn.oid, 'anon')) === false);
    ok('the new detector stays QUIET on the locked function via authenticated',
      (await newDetector(db, meta.locked_fn.oid, 'authenticated')) === false);
    ok('the new detector stays QUIET on the locked function via PUBLIC',
      (await newDetector(db, meta.locked_fn.oid, 'public')) === false);
    ok('service_role still holds EXECUTE on the locked function',
      (await newDetector(db, meta.locked_fn.oid, 'service_role')) === true);

    console.log('\n── 4. inheritance through PUBLIC leaves no role-specific ACL entry ──');
    // This is WHY the anon= and authenticated= checks could never compensate for the PUBLIC hole.
    ok('anon can execute the leaky function while holding NO "anon=" ACL entry',
      anonCanLeaky === true && !/anon=/.test(meta.leaky_fn.acl),
      `acl was ${meta.leaky_fn.acl}`);

    console.log('\n── 5. the runner really uses the new instrument ──');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const runner = readFileSync(
      fileURLToPath(new URL('../../backend/scripts/diaspora-staging-apply-gtm.mjs', import.meta.url)), 'utf8');
    const fnBlock = runner.slice(runner.indexOf('async function verifyFunctionContract'));
    const fnBody = fnBlock.slice(0, fnBlock.indexOf('\n}\n') + 3);
    ok('verifyFunctionContract calls has_function_privilege', /has_function_privilege/.test(fnBody));
    ok('verifyFunctionContract checks anon, authenticated AND public',
      /'anon', 'authenticated', 'public'/.test(fnBody));
    // Comments are stripped first: the runner's own header quotes the broken pattern to explain WHY
    // it was removed, and counting that explanation would make this assertion fail for describing
    // the very hazard it guards against.
    const runnerCode = runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    ok('the comment stripper left live code behind (control for the check below)',
      /async function verifyFunctionContract/.test(runnerCode));
    ok('the unmatchable PUBLIC text pattern is gone from the runner CODE',
      !/\(\^\|,\)=\[a-zA-Z\]/.test(runnerCode));
  } finally {
    await db.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${JSON.stringify({ total: results.length, failed: failed.length, ok: failed.length === 0 }, null, 2)}`);
  if (failed.length) {
    for (const f of failed) console.error(`FAILED: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
