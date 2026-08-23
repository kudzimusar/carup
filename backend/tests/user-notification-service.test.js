import test from 'node:test';
import assert from 'node:assert/strict';
import { listUserNotifications } from '../services/notifications/userNotificationService.js';

function query(result, calls) {
  const chain = {
    select(value) { calls.push(['select', value]); return chain; },
    eq(column, value) { calls.push(['eq', column, value]); return chain; },
    is(column, value) { calls.push(['is', column, value]); return chain; },
    order(column, options) { calls.push(['order', column, options]); return chain; },
    limit(value) { calls.push(['limit', value]); return chain; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

test('notification lookup uses canonical recipient and only NULL-canonical legacy rows', async () => {
  const currentCalls = [];
  const legacyCalls = [];
  let index = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'notification_queue');
      index += 1;
      return index === 1
        ? query({ data: [{ id: 'current', created_at: '2026-07-30T10:00:00Z' }], error: null }, currentCalls)
        : query({ data: [{ id: 'legacy', created_at: '2026-07-30T09:00:00Z' }], error: null }, legacyCalls);
    },
  };

  const rows = await listUserNotifications(supabase, 'user-a');
  assert.deepEqual(rows.map(row => row.id), ['current', 'legacy']);
  assert.ok(currentCalls.some(call => call[0] === 'eq' && call[1] === 'recipient_user_id' && call[2] === 'user-a'));
  assert.ok(legacyCalls.some(call => call[0] === 'is' && call[1] === 'recipient_user_id' && call[2] === null));
  assert.ok(legacyCalls.some(call => call[0] === 'eq' && call[1] === 'recipient_id' && call[2] === 'user-a'));
  assert.ok(currentCalls.some(call => call[0] === 'limit' && call[1] === 100));
  assert.ok(legacyCalls.some(call => call[0] === 'limit' && call[1] === 100));
});

test('notification lookup deduplicates and sorts the bounded result', async () => {
  let index = 0;
  const supabase = {
    from() {
      index += 1;
      return query({
        data: index === 1
          ? [{ id: 'same', created_at: '2026-07-30T08:00:00Z' }, { id: 'new', created_at: '2026-07-30T11:00:00Z' }]
          : [{ id: 'same', created_at: '2026-07-30T08:00:00Z' }, { id: 'old', created_at: '2026-07-29T11:00:00Z' }],
        error: null,
      }, []);
    },
  };

  const rows = await listUserNotifications(supabase, 'user-a');
  assert.deepEqual(rows.map(row => row.id), ['new', 'same', 'old']);
});
