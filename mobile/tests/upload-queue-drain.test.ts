/**
 * Workstream G — offline upload-queue DRAIN worker tests (npx tsx tests/upload-queue-drain.test.ts).
 *
 * Proves the drain worker that connects the durable queue to the backend:
 *   - drains ready items, sends each item's idempotencyKey, marks uploaded
 *   - a failing upload marks the item failed (stays for backoff retry), not lost
 *   - the same capture enqueued twice drains ONCE (queue dedupe)
 *   - the HTTP uploader puts the idempotency key in the Idempotency-Key header
 *
 * HONEST SCOPE: proves the drain logic + idempotency-key propagation with an injected
 * uploader/fetch. Real device camera, SecureStore durability across app restart, and live
 * network drain require a device/simulator (see FINAL report — mobile e2e SKIPPED).
 */
import { strict as assert } from 'node:assert';
import { useUploadQueueStore, __resetUploadQueueForTest, type UploadQueueItem, type QueuePersistence } from '../store/uploadQueueStore';
import { drainUploadQueue, makeHttpUploader } from '../utils/uploadQueueDrain';

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) return r.then(() => console.log(`[PASS] ${name}`), (e) => { console.error(`[FAIL] ${name}`); throw e; });
    console.log(`[PASS] ${name}`);
  } catch (e) { console.error(`[FAIL] ${name}`); throw e; }
}
function memPersistence(): QueuePersistence {
  let saved: UploadQueueItem[] = [];
  return { async load() { return [...saved]; }, async save(i) { saved = [...i]; }, async clearBlobs() { saved = []; } };
}
const ENQ = (over: Partial<{ vin: string; checksum: string }> = {}) => ({
  userId: 'u1', tenantId: 't1', vin: over.vin || 'VIN1', evidenceType: 'odometer_reading',
  localFileRef: 'data:image/png;base64,AAAA', checksum: over.checksum || 'sum-1',
});

async function main() {
  await test('drains ready items, sends idempotency keys, marks uploaded', async () => {
    __resetUploadQueueForTest(memPersistence());
    const s = useUploadQueueStore.getState();
    const a = s.enqueue(ENQ({ vin: 'VINA', checksum: 'a' }));
    const b = s.enqueue(ENQ({ vin: 'VINB', checksum: 'b' }));
    const seenKeys: string[] = [];
    const res = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: async (it) => { seenKeys.push(it.idempotencyKey); return `ev-${it.vin}`; },
    });
    assert.equal(res.uploaded, 2);
    assert.ok(seenKeys.includes(a.idempotencyKey) && seenKeys.includes(b.idempotencyKey));
    const items = useUploadQueueStore.getState().items;
    assert.ok(items.every((i) => i.status === 'uploaded' && i.backendEvidenceId));
  });

  await test('a failing upload marks the item failed (kept for retry), not lost', async () => {
    __resetUploadQueueForTest(memPersistence());
    useUploadQueueStore.getState().enqueue(ENQ({ vin: 'VINF', checksum: 'f' }));
    const res = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: async () => { throw new Error('HTTP 503'); },
    });
    assert.equal(res.failed, 1);
    const item = useUploadQueueStore.getState().items[0];
    assert.equal(item.status, 'failed');
    assert.ok(item.lastError && item.retryCount >= 1);
  });

  await test('same capture enqueued twice drains once (dedupe)', async () => {
    __resetUploadQueueForTest(memPersistence());
    const s = useUploadQueueStore.getState();
    s.enqueue(ENQ({ vin: 'VINX', checksum: 'dup' }));
    s.enqueue(ENQ({ vin: 'VINX', checksum: 'dup' }));
    let calls = 0;
    const res = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => { calls++; return 'ev'; } });
    assert.equal(calls, 1);
    assert.equal(res.uploaded, 1);
  });

  await test('makeHttpUploader sends the Idempotency-Key header', async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, json: async () => ({ id: 'ev-99' }) };
    };
    const uploader = makeHttpUploader('https://staging.example', 'tok');
    const item = { vin: 'VINH', idempotencyKey: 'idem-h', evidenceType: 'odometer_reading', pageOrder: 0 } as UploadQueueItem;
    const id = await uploader(item, 'data:image/png;base64,AAAA');
    assert.equal(id, 'ev-99');
    assert.equal(calls[0].headers['Idempotency-Key'], 'idem-h');
    assert.ok(String(calls[0].url).includes('/api/vehicles/VINH/evidence/upload'));
  });

  console.log('\nALL WORKSTREAM G DRAIN TESTS PASSED');
}
main().catch((e) => { console.error(e); process.exit(1); });
