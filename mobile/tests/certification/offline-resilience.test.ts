/**
 * MOBILE CERTIFICATION — offline resilience of the native evidence workflow (canonical §132-154).
 *
 * Run with:  npx tsx tests/certification/offline-resilience.test.ts   (from mobile/)
 *
 * Exercises the REAL durable upload queue (mobile/store/uploadQueueStore.ts) + drain worker
 * (mobile/utils/uploadQueueDrain.ts) end-to-end for the certification-required offline behaviors:
 *   1. offline capture -> the queue persists it (metadata index written to the injected adapter);
 *   2. simulated PROCESS RESTART -> in-memory truth wiped, then re-hydrated from durable storage;
 *   3. reconnect -> drain uploads EXACTLY ONCE, sending the idempotency key;
 *   4. duplicate prevention -> the same capture enqueued twice drains once;
 *   5. account/tenant isolation -> account B never sees account A's queue;
 *   6. logout cleanup -> queue + persisted blobs cleared.
 *
 * HONEST SCOPE (recorded in MOBILE_CERTIFICATION_REPORT.md): this proves the store + drain
 * invariants and the persistence SEAM contract using an INJECTED in-memory adapter. It is NOT an
 * on-device run: the real expo-secure-store Keychain/Keystore adapter, real OS process termination,
 * camera and live radio can only be certified on a physical device / emulator (external gate).
 */
import { strict as assert } from 'node:assert';
import {
  useUploadQueueStore,
  __resetUploadQueueForTest,
  type UploadQueueItem,
  type QueuePersistence,
} from '../../store/uploadQueueStore';
import { drainUploadQueue } from '../../utils/uploadQueueDrain';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) return r.then(() => { console.log(`[PASS] ${name}`); passed++; }, (e) => { console.error(`[FAIL] ${name}`); throw e; });
    console.log(`[PASS] ${name}`); passed++;
  } catch (e) { console.error(`[FAIL] ${name}`); throw e; }
}

/**
 * A DURABLE in-memory adapter: its `saved` array survives a `__resetUploadQueueForTest` (which only
 * wipes in-memory store state), letting us model "the app was killed and relaunched" — durable
 * storage keeps the rows, memory does not.
 */
function makeDurableStore(seed: UploadQueueItem[] = []) {
  let saved: UploadQueueItem[] = [...seed];
  const clearedBlobRefs: string[][] = [];
  const adapter: QueuePersistence = {
    async load() { return [...saved]; },
    async save(items) { saved = [...items]; },
    async clearBlobs(refs) { clearedBlobRefs.push(refs); saved = []; },
  };
  return { adapter, getSaved: () => saved, clearedBlobRefs };
}

const capA = {
  userId: 'userA', tenantId: 'tenantA', vin: 'VINCERT0001',
  evidenceType: 'odometer_photo', localFileRef: 'file:///cap/odo-a.jpg', checksum: 'sha256-a',
};

async function main() {
  console.log('\n=== MOBILE CERTIFICATION — OFFLINE RESILIENCE (store + drain) ===\n');

  await test('offline capture is enqueued AND durably persisted (adapter received the row)', () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    const item = useUploadQueueStore.getState().enqueue(capA);
    assert.equal(item.status, 'queued');
    // The persistence adapter captured the row synchronously (fire-and-forget save resolved).
    assert.equal(durable.getSaved().length, 1);
    assert.equal(durable.getSaved()[0].idempotencyKey, item.idempotencyKey);
  });

  await test('survives a simulated PROCESS RESTART: rehydrates the queued capture from durable storage', async () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    const enq = useUploadQueueStore.getState().enqueue(capA);
    assert.equal(useUploadQueueStore.getState().items.length, 1);

    // ---- process death: memory is gone, durable storage remains ----
    __resetUploadQueueForTest(durable.adapter); // same adapter, fresh (empty) in-memory store
    assert.equal(useUploadQueueStore.getState().items.length, 0);
    assert.equal(useUploadQueueStore.getState().hydrated, false);

    // ---- relaunch: hydrate from durable storage ----
    await useUploadQueueStore.getState().hydrate();
    const items = useUploadQueueStore.getState().items;
    assert.equal(items.length, 1);
    assert.equal(items[0].idempotencyKey, enq.idempotencyKey);
    assert.equal(items[0].status, 'queued'); // still pending upload after restart
  });

  await test('reconnect -> drain uploads EXACTLY ONCE and sends the idempotency key', async () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    const enq = useUploadQueueStore.getState().enqueue(capA);

    const uploads: string[] = [];
    const res = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: async (it) => { uploads.push(it.idempotencyKey); return `ev-${it.vin}`; },
    });
    assert.equal(res.uploaded, 1);
    assert.deepEqual(uploads, [enq.idempotencyKey]);
    const done = useUploadQueueStore.getState().items[0];
    assert.equal(done.status, 'uploaded');
    assert.equal(done.backendEvidenceId, 'ev-VINCERT0001');

    // Draining AGAIN must not re-upload (terminal item is never re-dequeued) — exactly-once.
    const res2 = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: async (it) => { uploads.push(it.idempotencyKey); return 'DUP'; },
    });
    assert.equal(res2.uploaded, 0);
    assert.equal(uploads.length, 1); // still exactly one upload total
  });

  await test('duplicate prevention: the SAME capture enqueued twice drains once', async () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    useUploadQueueStore.getState().enqueue(capA);
    useUploadQueueStore.getState().enqueue({ ...capA }); // identical capture
    assert.equal(useUploadQueueStore.getState().items.length, 1);

    let calls = 0;
    const res = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => { calls++; return 'ev'; } });
    assert.equal(calls, 1);
    assert.equal(res.uploaded, 1);
  });

  await test('a failed upload is KEPT (not lost) for a backoff retry, then drains on the next attempt', async () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    useUploadQueueStore.getState().enqueue(capA);
    // First attempt fails (network dropped mid-upload).
    const r1 = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => { throw new Error('HTTP 503'); } });
    assert.equal(r1.failed, 1);
    const failed = useUploadQueueStore.getState().items[0];
    assert.equal(failed.status, 'failed');
    assert.ok(failed.retryCount >= 1 && failed.nextRetryAt);
    // Not yet due -> skipped now.
    const rNow = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => 'ev', now: () => Date.now() });
    assert.equal(rNow.uploaded, 0);
    // Far enough in the future -> becomes ready and drains.
    const rLater = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => 'ev-late', now: () => Date.now() + 60 * 60 * 1000 });
    assert.equal(rLater.uploaded, 1);
    assert.equal(useUploadQueueStore.getState().items[0].status, 'uploaded');
  });

  await test('account/tenant isolation: account B never sees account A queued captures', () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    useUploadQueueStore.getState().enqueue(capA); // userA / tenantA
    useUploadQueueStore.getState().enqueue({ ...capA, userId: 'userB', tenantId: 'tenantB', checksum: 'sha256-b' });
    useUploadQueueStore.getState().enqueue({ ...capA, userId: 'userA', tenantId: 'tenantB', checksum: 'sha256-c' }); // cross-tenant same user

    const forA = useUploadQueueStore.getState().isolateByAccount('userA', 'tenantA');
    assert.equal(forA.length, 1);
    assert.equal(forA[0].userId, 'userA');
    assert.equal(forA[0].tenantId, 'tenantA');

    const forB = useUploadQueueStore.getState().isolateByAccount('userB', 'tenantB');
    assert.equal(forB.length, 1);
    assert.equal(forB.some((i) => i.userId === 'userA'), false);
  });

  await test('logout cleanup: wipes ALL items, purges persisted blobs, empties the durable index', async () => {
    const durable = makeDurableStore();
    __resetUploadQueueForTest(durable.adapter);
    useUploadQueueStore.getState().enqueue(capA);
    useUploadQueueStore.getState().enqueue({ ...capA, checksum: 'sha256-b', localFileRef: 'file:///cap/odo-b.jpg' });
    assert.equal(useUploadQueueStore.getState().items.length, 2);

    await useUploadQueueStore.getState().clearForLogout();
    assert.equal(useUploadQueueStore.getState().items.length, 0);
    assert.equal(durable.clearedBlobRefs.length, 1);
    assert.equal(durable.clearedBlobRefs[0].length, 2);
    assert.ok(durable.clearedBlobRefs[0].includes('file:///cap/odo-a.jpg'));
    assert.equal(durable.getSaved().length, 0); // durable index emptied

    // A relaunch after logout hydrates to an empty queue (no sensitive refs survive).
    __resetUploadQueueForTest(durable.adapter);
    await useUploadQueueStore.getState().hydrate();
    assert.equal(useUploadQueueStore.getState().items.length, 0);
  });

  console.log(`\nALL OFFLINE-RESILIENCE CERTIFICATION CHECKS PASSED (${passed} checks)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
