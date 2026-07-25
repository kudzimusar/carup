import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
export const runLive = process.env.RUN_DIASPORA_STAGING_INTEGRATION === 'true';
export const AUTHORIZED_STAGING_REF = 'eoyenigwevnxwwhyhaer';
export const FORBIDDEN_REFS = ['vhmnajoeicasaigiophh', 'sfhtlzcgrnrdznhvdrbn'];

if (runLive && !databaseUrl) {
  throw new Error('H9 staging integration requested but DATABASE_URL is missing.');
}
if (runLive && FORBIDDEN_REFS.some((ref) => databaseUrl.includes(ref))) {
  throw new Error('H9 refuses to run against a forbidden production project.');
}
if (runLive && !databaseUrl.includes(AUTHORIZED_STAGING_REF)) {
  throw new Error(`H9 DATABASE_URL must target authorized staging (${AUTHORIZED_STAGING_REF}).`);
}

export const skipReason = runLive
  ? false
  : 'Set RUN_DIASPORA_STAGING_INTEGRATION=true and DATABASE_URL (authorized staging) to run.';
export const RUN_PREFIX = `stgtest_${Date.now()}_${randomUUID().slice(0, 8)}`;
export const TEST_TIMEOUT_MS = 30_000;

export async function connectClient(applicationName) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: databaseUrl,
    application_name: applicationName,
    statement_timeout: 15_000,
    query_timeout: 20_000,
  });
  await client.connect();
  return client;
}

export async function runConcurrentQueries(first, second) {
  const [clientA, clientB] = await Promise.all([
    connectClient(`${RUN_PREFIX}_race_a`),
    connectClient(`${RUN_PREFIX}_race_b`),
  ]);

  try {
    const [pidA, pidB] = await Promise.all([
      clientA.query('SELECT pg_backend_pid() AS pid'),
      clientB.query('SELECT pg_backend_pid() AS pid'),
    ]);
    assert.notEqual(
      pidA.rows[0].pid,
      pidB.rows[0].pid,
      'H9 race must use two independent PostgreSQL backend connections',
    );

    return await Promise.allSettled([
      clientA.query(first.text, first.values),
      clientB.query(second.text, second.values),
    ]);
  } finally {
    await Promise.allSettled([clientA.end(), clientB.end()]);
  }
}

export function assertExactlyOneWinner(outcomes, expectedLoserPattern) {
  const winners = outcomes.filter((result) => result.status === 'fulfilled');
  const losers = outcomes.filter((result) => result.status === 'rejected');

  assert.equal(winners.length, 1, `expected exactly one winner, got ${JSON.stringify(outcomes)}`);
  assert.equal(losers.length, 1, `expected exactly one loser, got ${JSON.stringify(outcomes)}`);
  assert.match(
    String(losers[0].reason?.message || losers[0].reason),
    expectedLoserPattern,
    'losing transaction must fail for the expected integrity reason',
  );
}

export async function seedActor(client, scenario) {
  const actorId = `${RUN_PREFIX}_${scenario}_actor`;
  const email = `${actorId}@carup.test`;
  await client.query(
    `INSERT INTO public.users (id, name, email, role, join_date, is_verified)
     VALUES ($1, $2, $3, 'admin', $4, true)`,
    [actorId, `H9 ${scenario} actor`, email, new Date().toISOString()],
  );
  return actorId;
}

export async function runWithVerifiedCleanup(exercise, cleanup) {
  let exerciseError;
  let cleanupError;

  try {
    await exercise();
  } catch (error) {
    exerciseError = error;
  }

  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (exerciseError && cleanupError) {
    throw new AggregateError([exerciseError, cleanupError], 'H9 scenario and cleanup both failed');
  }
  if (exerciseError) throw exerciseError;
  if (cleanupError) throw cleanupError;
}
