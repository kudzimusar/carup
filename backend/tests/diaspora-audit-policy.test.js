/**
 * H5 — critical vs best-effort audit policy.
 *
 * appendCriticalAudit throws (fail-loud) when the audit row cannot be written; appendBestEffortAudit
 * never throws. The integrity-critical mutations (stock/quote/container approval) additionally audit
 * INSIDE their atomic RPC transactions, so audit failure rolls the whole mutation back — proven by
 * the H1/H2/H3 rollback tests (diaspora-stock / diaspora-rfq / diaspora-container-marketplace).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { appendCriticalAudit, appendBestEffortAudit, appendAudit } = await import('../services/diaspora/diasporaServiceUtils.js');

function client(result) {
  return { from: () => ({ insert: () => ({ select: () => ({ single: async () => result }) }) }) };
}
const okClient = () => client({ data: { id: 'aud-1' }, error: null });
const failClient = () => client({ data: null, error: { message: 'audit table unavailable' } });
const fields = { actorId: 'u1', action: 'STOCK_RESERVE', resourceType: 'diaspora_stock_item', resourceId: 's1' };

test('appendCriticalAudit returns the row on success', async () => {
  const data = await appendCriticalAudit(okClient(), fields);
  assert.equal(data.id, 'aud-1');
});

test('appendCriticalAudit throws (fail-loud) when audit write fails', async () => {
  await assert.rejects(() => appendCriticalAudit(failClient(), fields), /Critical audit write failed/i);
});

test('appendBestEffortAudit returns null and does not throw when audit write fails', async () => {
  const data = await appendBestEffortAudit(failClient(), fields);
  assert.equal(data, null);
});

test('appendAudit is the best-effort alias (never throws)', async () => {
  assert.equal(appendAudit, appendBestEffortAudit);
  const data = await appendAudit(failClient(), fields);
  assert.equal(data, null);
});
