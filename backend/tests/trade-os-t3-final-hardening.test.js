import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../database/migrations/20260905150000_trade_os_t3_final_hardening.sql', import.meta.url), 'utf8');

test('T3 final hardening pins submitted quote terms and terminal lifecycle states', () => {
  assert.match(migration, /guard_diaspora_logistics_quote_transition/);
  assert.match(migration, /OLD\.status <> 'DRAFT'/);
  assert.match(migration, /IMMUTABLE_SUBMITTED_QUOTE/);
  assert.match(migration, /OLD\.status IN \('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'\)/);
  assert.match(migration, /TERMINAL_QUOTE_STATE/);
});

test('T3 final hardening refuses an expired submitted quote at the database transition boundary', () => {
  assert.match(migration, /OLD\.status = 'SUBMITTED'/);
  assert.match(migration, /NEW\.status = 'ACCEPTED'/);
  assert.match(migration, /OLD\.valid_until <= now\(\)/);
  assert.match(migration, /DIASPORA_LOGISTICS\/EXPIRED/);
});

test('T3 final hardening makes a live logistics-request reservation unique', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_cargo_reservation_live_logistics_request/);
  assert.match(migration, /metadata->>'logistics_request_id'/);
  assert.match(migration, /reservation_status IN \('REQUESTED', 'APPROVED'\)/);
  assert.match(migration, /deleted_at IS NULL/);
});
