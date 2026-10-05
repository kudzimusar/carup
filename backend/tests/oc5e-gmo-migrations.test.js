/**
 * OC-5E — the garage onboarding migrations, proven as a set.
 *
 * #209's GMO files carried 20260906* stamps: they sorted BEFORE the garage tables they lock and write
 * (C3, 20260918*), and 20260906150000 collided with a Trade OS migration. Ported, they move into
 * OC-5E's range (2026100419xxxx), after every RC1 and earlier OC-5 migration, in dependency order.
 * Each change of shape is proven where it happens (oc5e-gmo3/gmo4 suites, on PGlite); this file
 * proves the ORDER, and that #209's stale copies are not carried.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const ALL = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

const GMO = {
  gmo3: '20261004190000_gmo3_garage_application_decision.sql',
  gmo4: '20261004190100_gmo4_garage_business_activation.sql',
};

/** What each OC-5E migration references, and the migration that creates it. */
const DEPENDS_ON = {
  gmo3: ['20260918090000_ocr_c3_garage_applications.sql'],
  gmo4: ['20260918090000_ocr_c3_garage_applications.sql', '20261004160000_oc5a_tenant_users_role_catalogue.sql', GMO.gmo3],
};

test('order: every OC-5E migration exists under its OC-5E name, and #209\'s 20260906* copies do not', () => {
  for (const file of Object.values(GMO)) assert.ok(ALL.includes(file), `${file} is missing`);
  const stale = ALL.filter((f) => /^20260906\d{6}_(garage_|tenant_users_role_catalogue)/.test(f));
  assert.deepEqual(stale, [], 'a #209-stamped copy would run before the garage tables it locks');
});

test('order: each file sorts after everything it references', () => {
  for (const [slice, deps] of Object.entries(DEPENDS_ON)) {
    for (const dep of deps) {
      assert.ok(ALL.includes(dep), `${slice}: dependency ${dep} does not exist`);
      assert.ok(dep < GMO[slice], `${GMO[slice]} must sort after ${dep}`);
    }
  }
});

test('order: the set sits after every earlier OC-5 migration, inside OC-5E\'s range, with no shared timestamp', () => {
  const files = Object.values(GMO).sort();
  const serviceNetwork = ALL.filter((f) => /^2026100418\d{4}_/.test(f));
  assert.ok(serviceNetwork.length > 0 && serviceNetwork.every((f) => f < files[0]), 'OC-5E follows OC-5D');
  assert.ok(ALL.filter((f) => !files.includes(f)).every((f) => f < files[0] || f > files[files.length - 1]),
    'no other migration sorts inside the OC-5E set');
  for (const f of files) {
    assert.match(f, /^2026100419\d{4}_/, `${f} is outside OC-5E's 2026100419xxxx range`);
    const sharing = ALL.filter((other) => other !== f && other.slice(0, 14) === f.slice(0, 14));
    assert.deepEqual(sharing, [], `${f} shares its timestamp`);
  }
});

test('shape: every OC-5E function is backend-only, runs as its caller, and pins its search_path', () => {
  for (const file of Object.values(GMO)) {
    const sql = readFileSync(`${MIGRATIONS}${file}`, 'utf8');
    assert.ok(sql.startsWith('-- +migrate Up'), `${file}: "-- +migrate Up" first`);
    assert.ok(sql.includes('-- +migrate Down'), `${file}: has a Down`);
    const up = sql.split('-- +migrate Down')[0];
    const functions = [...up.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)].map((m) => m[1]);
    for (const fn of functions) {
      assert.match(up, /SECURITY INVOKER/, `${file}: ${fn} must not run with its owner's privileges`);
      assert.match(up, /SET search_path = public, pg_temp/, `${file}: ${fn} pins its search_path`);
      assert.match(up, new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace('.', '\\.')}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`), `${file}: ${fn} is revoked from every client role`);
      assert.match(up, new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace('.', '\\.')}\\([^)]*\\) TO service_role;`), `${file}: ${fn} is granted to the backend`);
    }
  }
});
