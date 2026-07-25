/**
 * H7/H9 — gated live staging integration suite.
 *
 * Runs only against the authorized CarUp staging project and imports the three independent
 * concurrency scenarios: stock reservation, RFQ acceptance, and container capacity approval.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_PREFIX,
  TEST_TIMEOUT_MS,
  connectClient,
  skipReason,
} from './diaspora-staging-test-utils.js';
import './diaspora-staging-stock-scenario.js';
import './diaspora-staging-rfq-scenario.js';
import './diaspora-staging-capacity-scenario.js';

test('staging: hardening RPCs and oauth-state table exist', { skip: skipReason, timeout: TEST_TIMEOUT_MS }, async () => {
  const client = await connectClient(`${RUN_PREFIX}_preflight`);
  try {
    const functions = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])`,
      [['diaspora_append_stock_movement_atomic', 'diaspora_accept_quote_atomic', 'diaspora_approve_cargo_reservation_atomic']],
    );
    assert.deepEqual(
      functions.rows.map((row) => row.proname).sort(),
      ['diaspora_accept_quote_atomic', 'diaspora_append_stock_movement_atomic', 'diaspora_approve_cargo_reservation_atomic'],
    );

    const oauthTable = await client.query(
      `SELECT to_regclass('public.diaspora_oauth_states') AS table_name`,
    );
    assert.ok(oauthTable.rows[0].table_name, 'diaspora_oauth_states must exist');
  } finally {
    await client.end();
  }
});
