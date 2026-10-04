import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Drift guard for the T3 staging certification fixture (Spec 47).
 *
 * Spec 47 used to fill ONE long-lived staging sailing. Each certification approved ~3 CBM into it
 * and never gave the capacity back, so used volume ratcheted upward run after run (measured at
 * 9.000/47 across three runs) until a perfectly healthy run failed at 45.296/47 — the container
 * product correctly refusing to overfill. The product was right; the certification was depending
 * on capacity earlier runs had consumed, and on a human periodically resetting it.
 *
 * The fix is structural: the run creates its own sailing, so it cannot inherit capacity that did
 * not exist when it started. This guard pins that ARCHITECTURE — not any particular id, which
 * would just be the same brittleness one level up. It runs in ordinary CI, not only on staging,
 * because the failure it prevents is silent everywhere else.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = readFileSync(join(repoRoot, 'tests/agents/47-trade-os-t3-staging.spec.ts'), 'utf8');
const containerPage = readFileSync(
  join(repoRoot, 'web/src/pages/diaspora/DiasporaContainerMarketplace.tsx'), 'utf8');

/** Comment prose legitimately discusses the old model; only executable lines are evidence. */
const code = spec
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')
  // Assertion messages are matched as prose, so a source-level escape must not change the match.
  .replace(/\\'/g, "'");

test('the certification creates its own sailing through the governed operator API', () => {
  assert.match(code, /createRunSailing/,
    'Spec 47 must create a run-owned sailing.');
  assert.match(code, /apiAs\(page,\s*'POST',\s*`\$\{CONTAINER_API\}\/containers`/,
    'the sailing must be created through POST /container-marketplace/containers, not seeded behind the product.');
});

test('no shared sailing is pinned as a default — that is the accumulation bug', () => {
  const uuidDefaults = code.match(/\|\|\s*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi) || [];
  const attached = code.match(/selectOption\(([A-Za-z_.]+)\)/);

  assert.ok(attached, 'the spec must attach a sailing to the offer.');
  assert.equal(attached[1], 'runSailing.id',
    `the attached sailing must be the one this run created, not a fixed fixture (found ${attached[1]}).`);

  // Exactly one hardcoded container id may remain: the FOREIGN sailing used for the refusal proof.
  // A refused attach writes nothing, so it accumulates no capacity and cannot drift.
  assert.equal(uuidDefaults.length, 1,
    `only the foreign-sailing id may be hardcoded; found ${uuidDefaults.length} hardcoded container defaults.`);
  assert.match(code, /FOREIGN_CONTAINER_ID\s*=\s*process\.env\.TRADEOS_T3_FOREIGN_CONTAINER_ID/,
    'the one hardcoded id must be the foreign sailing, and must stay overridable.');
});

test('the run-owned sailing is proven empty before the run measures anything', () => {
  assert.match(code, /a freshly created sailing must consume nothing/,
    'creation must assert zero used capacity.');
  assert.match(code, /a run-owned sailing inherited reservations from an earlier run/,
    'creation must assert the sailing inherits no reservations.');
  assert.match(code, /this run's sailing started with capacity already consumed/,
    'the journey must re-assert an empty starting ledger before measuring the conversion.');
});

test('capacity is measured on the run-owned sailing by id, never by position or capacity text', () => {
  assert.doesNotMatch(code, /getByTestId\('diaspora-container-card'\)[\s\S]{0,120}\.first\(\)/,
    'a container card must never be selected with .first() — that has silently read a stranger\'s sailing.');
  assert.match(code, /data-container-id="\$\{containerId\}"/,
    'cards must be addressed by container id.');
  assert.match(code, /capacityOf\(page,\s*runSailing\.id\)/,
    'capacity must be read for the run-owned sailing explicitly.');
});

test('the sailing reference is scoped to the run, not to a fixed name', () => {
  assert.match(code, /sailingReferenceFor\s*=\s*\(project: string\)\s*=>\s*`golden\.t3\.sailing\.\$\{RUN_TAG\}\.\$\{project\}`/,
    'the sailing reference must carry the run id and the viewport project.');
  assert.match(code, /RUN_TAG\s*=\s*process\.env\.STAGING_RUN_ID\s*\|\|/,
    'RUN_TAG must come from the workflow run id where one exists.');
});

test('the capacity invariants the certification exists to prove are still asserted', () => {
  for (const invariant of [
    /a REQUESTED reservation consumed capacity/,
    /a REQUESTED reservation reduced availability/,
    /replay created a SECOND reservation/,
    /foreign container attach returned/,
    /approval did not consume exactly the reserved volume/,
    /availability did not fall by exactly the reserved volume/,
    /consumed capacity a second time/,
  ]) {
    assert.match(code, invariant, `Spec 47 lost the assertion matching ${invariant}`);
  }
});

test('the container surface exposes the identities the certification selects by', () => {
  assert.match(containerPage, /data-testid="diaspora-container-card"[\s\S]{0,400}data-container-id=\{c\.id\}/,
    'the container card must expose data-container-id for unambiguous test selection.');
  assert.match(containerPage, /data-testid="diaspora-container-reservation-row" data-reservation-id=\{r\.id\}/,
    'the reservation row must expose data-reservation-id.');
});

test('cleanup is best-effort and never a precondition for the next run', () => {
  assert.match(code, /retireRunSailing/, 'the run should retire the sailing it created.');
  assert.match(code, /catch\s*\{\s*return 'not closed \(request failed\)';/,
    'cleanup must swallow its own failure — the next run creates its own sailing regardless.');
});
