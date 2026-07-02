/**
 * Workstream G — durable upload QUEUE store tests (run with: npx tsx tests/upload-queue-store.test.ts).
 *
 * Mirrors the repo's native-test convention (a tiny `test()` runner over
 * node:assert, executed by tsx — see verification-api.test.ts). Exercises the
 * REAL Zustand store (mobile/store/uploadQueueStore.ts) with an INJECTED
 * in-memory persistence adapter, so the store's behavior — not just the pure
 * logic — is proven without a device:
 *   - enqueue computes a stable idempotencyKey and refuses to double-enqueue the
 *     SAME capture
 *   - markFailed applies exponential backoff to nextRetryAt
 *   - dequeueReady honors backoff + status
 *   - isolateByAccount never leaks account A's queue to account B
 *   - clearForLogout wipes ALL items and asks the adapter to clear blobs
 *   - hydrate loads persisted rows back into memory
 *
 * HONEST SCOPE: this proves the store logic + the persistence SEAM contract. It
 * does NOT exercise the real expo-secure-store Keychain adapter or app-restart
 * durability — those require a device/simulator (see agent RETURN).
 */
import { strict as assert } from 'node:assert';
import {
  useUploadQueueStore,
  __resetUploadQueueForTest,
  type UploadQueueItem,
  type QueuePersistence,
} from '../store/uploadQueueStore';
import { DEFAULT_BASE_BACKOFF_MS } from '../utils/uploadQueueLogic';

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => console.log(`[PASS] ${name}`),
        (e) => { console.error(`[FAIL] ${name}`); throw e; },
      );
    }
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    throw e;
  }
}

/** In-memory adapter so no native SecureStore is touched. Records clearBlobs calls. */
function makeMemoryPersistence(seed: UploadQueueItem[] = []) {
  let saved: UploadQueueItem[] = [...seed];
  const clearedBlobRefs: string[][] = [];
  const adapter: QueuePersistence = {
    async load() { return [...saved]; },
    async save(items) { saved = [...items]; },
    async clearBlobs(refs) { clearedBlobRefs.push(refs); saved = []; },
  };
  return { adapter, getSaved: () => saved, clearedBlobRefs };
}

const baseInput = {
  userId: 'userA',
  tenantId: 'tenantA',
  vin: 'VINAAA',
  evidenceType: 'odometer_photo',
  localFileRef: 'file:///cap/a.jpg',
  checksum: 'sum-a',
};

(async () => {
  console.log('\n=== WORKSTREAM G — UPLOAD QUEUE STORE TESTS ===\n');

  await test('enqueue adds a queued item with a stable idempotencyKey', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    const item = useUploadQueueStore.getState().enqueue(baseInput);
    assert.equal(item.status, 'queued');
    assert.equal(item.userId, 'userA');
    assert.equal(item.retryCount, 0);
    assert.equal(item.nextRetryAt, null);
    assert.match(item.idempotencyKey, /^uq_[0-9a-f]{8}_userA_VINAAA$/);
    assert.equal(useUploadQueueStore.getState().items.length, 1);
  });

  await test('enqueueing the SAME capture twice does not create a duplicate', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    const first = useUploadQueueStore.getState().enqueue(baseInput);
    const second = useUploadQueueStore.getState().enqueue({ ...baseInput });
    assert.equal(useUploadQueueStore.getState().items.length, 1);
    assert.equal(first.localId, second.localId);
    assert.equal(first.idempotencyKey, second.idempotencyKey);
  });

  await test('a different checksum (re-capture) enqueues a distinct item', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    useUploadQueueStore.getState().enqueue(baseInput);
    useUploadQueueStore.getState().enqueue({ ...baseInput, checksum: 'sum-b' });
    assert.equal(useUploadQueueStore.getState().items.length, 2);
  });

  await test('markFailed increments retryCount and sets exponential backoff', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    const item = useUploadQueueStore.getState().enqueue(baseInput);
    const before = Date.now();
    useUploadQueueStore.getState().markFailed(item.localId, 'network down');
    const failed1 = useUploadQueueStore.getState().items.find((i) => i.localId === item.localId)!;
    assert.equal(failed1.status, 'failed');
    assert.equal(failed1.retryCount, 1);
    assert.equal(failed1.lastError, 'network down');
    // First failure waits ~ base*2^0 = base.
    assert.ok(failed1.nextRetryAt! >= before + DEFAULT_BASE_BACKOFF_MS - 50);
    assert.ok(failed1.nextRetryAt! <= Date.now() + DEFAULT_BASE_BACKOFF_MS + 50);

    const before2 = Date.now();
    useUploadQueueStore.getState().markFailed(item.localId, 'still down');
    const failed2 = useUploadQueueStore.getState().items.find((i) => i.localId === item.localId)!;
    assert.equal(failed2.retryCount, 2);
    // Second failure waits ~ base*2^1.
    assert.ok(failed2.nextRetryAt! >= before2 + DEFAULT_BASE_BACKOFF_MS * 2 - 50);
  });

  await test('dequeueReady excludes items whose backoff has not elapsed, includes due ones', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    const a = useUploadQueueStore.getState().enqueue(baseInput);                         // queued, ready now
    const b = useUploadQueueStore.getState().enqueue({ ...baseInput, checksum: 'sum-b' });
    useUploadQueueStore.getState().markFailed(b.localId, 'fail'); // future nextRetryAt
    const readyNow = useUploadQueueStore.getState().dequeueReady(Date.now()).map((i) => i.localId);
    assert.deepEqual(readyNow, [a.localId]);
    // Far in the future, the failed item becomes ready too.
    const readyLater = useUploadQueueStore.getState().dequeueReady(Date.now() + 10 * 60 * 1000).map((i) => i.localId);
    assert.ok(readyLater.includes(a.localId));
    assert.ok(readyLater.includes(b.localId));
  });

  await test('markUploaded moves the item to terminal uploaded state with backend id', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    const item = useUploadQueueStore.getState().enqueue(baseInput);
    useUploadQueueStore.getState().markUploading(item.localId);
    useUploadQueueStore.getState().markUploaded(item.localId, 'ev-server-1');
    const done = useUploadQueueStore.getState().items.find((i) => i.localId === item.localId)!;
    assert.equal(done.status, 'uploaded');
    assert.equal(done.backendEvidenceId, 'ev-server-1');
    assert.equal(useUploadQueueStore.getState().dequeueReady().length, 0); // not re-uploaded
  });

  await test('isolateByAccount returns ONLY the active account and never leaks across tenants', () => {
    const { adapter } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    useUploadQueueStore.getState().enqueue(baseInput); // userA / tenantA
    useUploadQueueStore.getState().enqueue({ ...baseInput, userId: 'userB', tenantId: 'tenantB', checksum: 'sum-b' });
    useUploadQueueStore.getState().enqueue({ ...baseInput, userId: 'userA', tenantId: 'tenantB', checksum: 'sum-c' });

    const forA = useUploadQueueStore.getState().isolateByAccount('userA', 'tenantA');
    assert.equal(forA.length, 1);
    assert.equal(forA[0].userId, 'userA');
    assert.equal(forA[0].tenantId, 'tenantA');

    const forB = useUploadQueueStore.getState().isolateByAccount('userB', 'tenantB');
    assert.equal(forB.length, 1);
    assert.equal(forB[0].userId, 'userB');
    // Account B must never see account A captures.
    assert.equal(forB.some((i) => i.userId === 'userA'), false);
  });

  await test('clearForLogout wipes ALL items and asks the adapter to clear blobs', async () => {
    const { adapter, clearedBlobRefs, getSaved } = makeMemoryPersistence();
    __resetUploadQueueForTest(adapter);
    useUploadQueueStore.getState().enqueue(baseInput);
    useUploadQueueStore.getState().enqueue({ ...baseInput, checksum: 'sum-b' });
    assert.equal(useUploadQueueStore.getState().items.length, 2);

    await useUploadQueueStore.getState().clearForLogout();
    assert.equal(useUploadQueueStore.getState().items.length, 0);
    // The adapter received the file refs to purge (sensitive-state cleanup).
    assert.equal(clearedBlobRefs.length, 1);
    assert.equal(clearedBlobRefs[0].length, 2);
    assert.ok(clearedBlobRefs[0].includes('file:///cap/a.jpg'));
    // Persisted index is emptied.
    assert.equal(getSaved().length, 0);
  });

  await test('hydrate loads persisted rows back into memory exactly once', async () => {
    const seeded: UploadQueueItem[] = [
      {
        localId: 'seed-1', userId: 'userA', tenantId: 'tenantA', vin: 'VINAAA',
        evidenceType: 'odometer_photo', localFileRef: 'file:///x.jpg', checksum: 'sum-x',
        pageOrder: 0, idempotencyKey: 'uq_seed', createdAt: Date.now(), retryCount: 0,
        lastError: null, nextRetryAt: null, status: 'queued', backendEvidenceId: null,
      },
    ];
    const { adapter } = makeMemoryPersistence(seeded);
    __resetUploadQueueForTest(adapter);
    await useUploadQueueStore.getState().hydrate();
    assert.equal(useUploadQueueStore.getState().items.length, 1);
    assert.equal(useUploadQueueStore.getState().items[0].localId, 'seed-1');
    // Second hydrate is a no-op (idempotent).
    await useUploadQueueStore.getState().hydrate();
    assert.equal(useUploadQueueStore.getState().items.length, 1);
  });

  console.log('\nALL WORKSTREAM G UPLOAD QUEUE STORE TESTS PASSED');
})();
