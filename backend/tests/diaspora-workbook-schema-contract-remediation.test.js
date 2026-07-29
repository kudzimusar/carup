/**
 * Regression tests for workbook schema contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  DB_EXPORT_OWNER_COLUMNS,
  DB_EXPORT_OWNER_COLUMNS_BY_TABLE,
  getDbExportOwnerColumns,
  buildDbExportOwnerPredicate,
} = await import('../services/diaspora/workbook/diasporaWorkbookDbExportService.js');
const {
  compensateConfirmedImportAction,
} = await import('../services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js');

const EXPECTED_OWNER_COLUMNS = {
  diaspora_trade_profiles: ['created_by', 'user_id'],
  diaspora_import_orders: ['created_by', 'buyer_id'],
  diaspora_import_quotes: ['created_by'],
  diaspora_trade_documents: ['created_by'],
  diaspora_container_shipments: ['created_by'],
  diaspora_cargo_reservations: ['created_by', 'buyer_id'],
  diaspora_shipments: ['created_by'],
  diaspora_compliance_reviews: ['created_by'],
  diaspora_payment_milestones: ['created_by'],
  diaspora_reputation_records: ['created_by'],
};

test('database export uses a table-specific, non-broadening owner-column contract', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(DB_EXPORT_OWNER_COLUMNS_BY_TABLE).map(([table, columns]) => [table, [...columns]]),
    ),
    EXPECTED_OWNER_COLUMNS,
  );
  assert.deepEqual([...DB_EXPORT_OWNER_COLUMNS].sort(), ['buyer_id', 'created_by', 'user_id']);
});

test('owner predicates contain only columns mapped for the selected table', () => {
  for (const [table, expected] of Object.entries(EXPECTED_OWNER_COLUMNS)) {
    const predicate = buildDbExportOwnerPredicate(table, 'owner-1');
    assert.ok(predicate, `${table} needs a bounded predicate`);
    const columns = predicate.split(',').map((clause) => clause.split('.')[0]);
    assert.deepEqual(columns, expected);
    assert.deepEqual([...getDbExportOwnerColumns(table)], expected);
  }
});

test('an unknown table has no owner predicate and therefore fails closed', () => {
  assert.deepEqual([...getDbExportOwnerColumns('unknown_table')], []);
  assert.equal(buildDbExportOwnerPredicate('unknown_table', 'owner-1'), null);
});

function compensationClient({ error = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      return {
        update(payload) {
          calls.push({ table, payload, id: null, deletedAtNullGuard: false });
          return {
            eq(column, value) {
              calls.at(-1).id = { column, value };
              return {
                is(isColumn, isValue) {
                  calls.at(-1).deletedAtNullGuard = isColumn === 'deleted_at' && isValue === null;
                  return Promise.resolve({ error });
                },
              };
            },
          };
        },
      };
    },
  };
  return client;
}

test('confirmed-import compensation writes only shared soft-delete columns', async () => {
  const client = compensationClient();
  const at = '2026-07-29T10:00:00.000Z';
  const outcome = await compensateConfirmedImportAction(
    client,
    { table: 'diaspora_trade_documents', recordId: 'record-1' },
    'user-1',
    at,
  );

  assert.deepEqual(outcome, { ok: true });
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0], {
    table: 'diaspora_trade_documents',
    payload: { deleted_at: at, updated_by: 'user-1' },
    id: { column: 'id', value: 'record-1' },
    deletedAtNullGuard: true,
  });
  assert.equal('status' in client.calls[0].payload, false);
});

test('confirmed-import compensation refuses non-allowlisted targets before a write', async () => {
  const client = compensationClient();
  const outcome = await compensateConfirmedImportAction(
    client,
    { table: 'users', recordId: 'user-1' },
    'user-1',
  );
  assert.deepEqual(outcome, { ok: false, reason: 'TARGET_TABLE_NOT_ALLOW_LISTED' });
  assert.equal(client.calls.length, 0);
});

test('confirmed-import compensation preserves a database failure for NEEDS_OPERATOR handling', async () => {
  const client = compensationClient({ error: { message: 'simulated failure' } });
  const outcome = await compensateConfirmedImportAction(
    client,
    { table: 'diaspora_ai_commands', recordId: 'record-2' },
    'user-1',
  );
  assert.deepEqual(outcome, { ok: false, reason: 'simulated failure' });
});
