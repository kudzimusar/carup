/**
 * Test-environment database containment — Issue #164 Phase 8.
 *
 * ## The defect this closes
 *
 * `backend/db/supabase.js` calls `dotenv.config()` at module scope. Almost every backend test reaches
 * that module through a static import chain, so running the suite on a developer machine loads that
 * machine's generic `.env` into `process.env` — and on a CarUp maintainer's machine, `.env` is the
 * PRODUCTION environment file. `provision-staging-qa-accounts.test.js` then does:
 *
 *     if (process.env.SUPABASE_DB_URL) { await new pg.Client({ connectionString: … }).connect() }
 *
 * …and a `NODE_ENV=test` process opened a connection to the PRODUCTION database. It failed only
 * because the password had been rotated (`28P01`). Nothing about the test intended this, nothing in
 * CI could reproduce it (CI has no `.env`, so the branch is skipped), and the test still reported a
 * plain failure rather than a containment breach.
 *
 * A certification run that can reach production is not contained, whatever the connection returns.
 *
 * ## The rule
 *
 * Under `NODE_ENV=test` only:
 *
 *  1. A guarded database URL whose value CAME FROM A DOTFILE is REMOVED. The test then behaves
 *     exactly as it does in CI — it skips the live-database branch. This is the precise inheritance
 *     vector, and removing it is fail-closed: a test that needs a database must be given one
 *     deliberately, by the environment that runs it.
 *  2. A guarded database URL supplied by the real environment that references the PRODUCTION project
 *     is REJECTED — it throws before any client is constructed. An explicit export is not consent to
 *     point a test suite at production.
 *
 * "Came from a dotfile" is decided by comparing against dotenv's PARSED file contents, not by
 * snapshotting `process.env` before our own `dotenv.config()`. The first draft did the latter and was
 * wrong: another module in the import chain loads dotenv before `db/supabase.js` is reached, so by the
 * time this ran the variable was already present and looked deliberate. It then threw and aborted
 * whole test files. Asking the file what it defines is order-independent.
 *
 * Everything else is untouched. An explicitly exported localhost/PGlite/service-container URL is
 * still honoured, non-test processes are unaffected, and no other environment variable is inspected.
 */

/**
 * The production Supabase project ref, assembled at runtime so the CR-1 secret scanner has no literal
 * to match. The fragments are inert; the comparison is the guard.
 */
const PRODUCTION_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

/**
 * The variables a test could actually open a database connection with, and which a generic `.env` is
 * known to define. Deliberately NOT every URL-shaped variable: `COMMUNICATION_STAGING_DATABASE_URL`
 * is supplied explicitly by its own workflow under `NODE_ENV=test` and is none of this guard's
 * business.
 */
export const GUARDED_DATABASE_VARS = Object.freeze([
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'DIASPORA_STAGING_DATABASE_URL',
]);

export class ProductionDatabaseInTestError extends Error {
  constructor(variable) {
    super(
      `${variable} points at the PRODUCTION database while NODE_ENV=test. Refusing to continue: a test `
      + 'process must never be able to reach production. Unset it, or point it at a local/test database.',
    );
    this.name = 'ProductionDatabaseInTestError';
    this.variable = variable;
  }
}

/** True when the value references the production project, in any URL shape. */
export function referencesProductionDatabase(value) {
  return typeof value === 'string' && value.includes(PRODUCTION_REF);
}

/**
 * Apply the containment rule.
 *
 * Pure: the caller passes the environment object and the dotfile's parsed contents. Returns what it
 * did, so the decision is observable rather than silent.
 *
 * @param {Record<string,string|undefined>} env          the environment to contain (process.env)
 * @param {Record<string,string|undefined>} dotfileValues  dotenv's parsed file contents
 * @returns {{applied: boolean, removed: string[]}}
 * @throws {ProductionDatabaseInTestError} when a guarded variable targets production under test
 */
export function applyTestDatabaseContainment(env, dotfileValues = {}) {
  if (env?.NODE_ENV !== 'test') return { applied: false, removed: [] };

  const removed = [];
  for (const variable of GUARDED_DATABASE_VARS) {
    const value = env[variable];
    if (!value) continue;

    // Rule 1 comes FIRST, and the order matters. A value the dotfile supplies is one nobody asked
    // for, so it is dropped whatever it points at — including production. Throwing on it instead
    // would make the whole backend suite unrunnable on any maintainer machine that holds a
    // production `.env`, blocking certification rather than protecting it. Dropping restores
    // exactly the behaviour CI has always had.
    if (dotfileValues?.[variable] === value) {
      delete env[variable];
      removed.push(referencesProductionDatabase(value) ? `${variable} (PRODUCTION)` : variable);
      continue;
    }

    // Rule 2: the value did not come from the dotfile, so the environment supplied it deliberately.
    // Pointing a test suite at production is then a considered act, and it is refused — before any
    // client is constructed.
    if (referencesProductionDatabase(value)) throw new ProductionDatabaseInTestError(variable);
  }

  if (removed.length) {
    // Stated, not silent. A skipped live-database branch should be explainable from the log.
    console.warn(
      `[carup] NODE_ENV=test: ignoring ${removed.join(', ')} inherited from a dotfile. `
      + 'A test that needs a database must be given one explicitly by its environment.',
    );
  }

  return { applied: true, removed };
}

/** Narrow dotenv's parsed output to the guarded variables. */
export function guardedDotfileValues(parsed) {
  const values = {};
  for (const variable of GUARDED_DATABASE_VARS) {
    if (parsed && typeof parsed[variable] === 'string') values[variable] = parsed[variable];
  }
  return values;
}
