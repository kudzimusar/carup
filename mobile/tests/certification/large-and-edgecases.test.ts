/**
 * MOBILE CERTIFICATION — large payloads + capture edge cases (canonical §132-154).
 *
 * Run with:  npx tsx tests/certification/large-and-edgecases.test.ts   (from mobile/)
 *
 * Certifies the capture-admission gate (mobile/utils/evidenceCapturePolicy.ts) together with the
 * REAL durable queue (mobile/store/uploadQueueStore.ts) for:
 *   - large payload handling (a big-but-within-budget capture is admitted, queued and drained);
 *   - unsupported format rejection (a wrong MIME / oversize / empty capture is REFUSED at the gate,
 *     never enqueued);
 *   - multi-page evidence ordering (pages captured out of order upload in pageOrder sequence);
 *   - low-storage simulation (the durable adapter returns a QUOTA error on save -> the item stays
 *     queued in memory and still drains after reconnect — a persistence failure never drops data).
 *
 * HONEST SCOPE: proves the admission LOGIC + store resilience with injected adapters. Real device
 * disk-full / low-memory pressure, camera MIME reporting and HEIC handling need a device/simulator.
 */
import { strict as assert } from 'node:assert';
import {
  useUploadQueueStore,
  __resetUploadQueueForTest,
  type UploadQueueItem,
  type QueuePersistence,
} from '../../store/uploadQueueStore';
import { drainUploadQueue } from '../../utils/uploadQueueDrain';
import {
  evaluateCapture,
  orderPages,
  MAX_EVIDENCE_BYTES,
  isSupportedEvidenceFormat,
  mimeFromFileName,
} from '../../utils/evidenceCapturePolicy';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) return r.then(() => { console.log(`[PASS] ${name}`); passed++; }, (e) => { console.error(`[FAIL] ${name}`); throw e; });
    console.log(`[PASS] ${name}`); passed++;
  } catch (e) { console.error(`[FAIL] ${name}`); throw e; }
}

function memPersistence(): QueuePersistence {
  let saved: UploadQueueItem[] = [];
  return { async load() { return [...saved]; }, async save(i) { saved = [...i]; }, async clearBlobs() { saved = []; } };
}

/**
 * A LOW-STORAGE adapter: durable writes fail because the store (Keychain/Keystore/disk) is full.
 * Per the QueuePersistence contract, a correct adapter (like the real createSecureStorePersistence)
 * MUST NOT throw across the boundary — it catches its own quota error and degrades to a no-op
 * durable layer. We model exactly that: `save` records the quota hit and returns WITHOUT persisting
 * anything, so `getSaved()` stays empty while the in-memory queue keeps the capture.
 */
function lowStoragePersistence() {
  let saved: UploadQueueItem[] = [];
  let quotaHits = 0;
  const adapter: QueuePersistence = {
    async load() { return [...saved]; },
    async save() { quotaHits++; /* full store: nothing durably written, but we never throw */ },
    async clearBlobs() { saved = []; },
  };
  return { adapter, getSaved: () => saved, getQuotaHits: () => quotaHits };
}

/**
 * Simulate the capture screen: run the admission gate, and ONLY enqueue when accepted. Returns the
 * decision so the test can assert both the gate and the queue side-effect.
 */
function captureAndMaybeEnqueue(descriptor: { mimeType?: string; byteSize?: number; fileName?: string }, enqueueInput: any) {
  const decision = evaluateCapture(descriptor);
  if (decision.accepted) useUploadQueueStore.getState().enqueue(enqueueInput);
  return decision;
}

const baseEnq = {
  userId: 'userA', tenantId: 'tenantA', vin: 'VINEDGE0001',
  evidenceType: 'registration_document', localFileRef: 'file:///cap/reg.pdf', checksum: 'sha256-edge',
};

async function main() {
  console.log('\n=== MOBILE CERTIFICATION — LARGE PAYLOADS + EDGE CASES ===\n');

  await test('large but within-budget capture is admitted, queued and drains', async () => {
    __resetUploadQueueForTest(memPersistence());
    const bigButOk = MAX_EVIDENCE_BYTES - 1; // just under the 25 MB ceiling
    const decision = captureAndMaybeEnqueue(
      { mimeType: 'image/jpeg', byteSize: bigButOk, fileName: 'damage.jpg' },
      { ...baseEnq, evidenceType: 'damage_photo', localFileRef: 'file:///cap/damage.jpg', checksum: 'sha256-big' },
    );
    assert.equal(decision.accepted, true);
    assert.equal(useUploadQueueStore.getState().items.length, 1);
    const res = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => 'ev-big' });
    assert.equal(res.uploaded, 1);
  });

  await test('unsupported format is REJECTED at the gate and never enqueued', () => {
    __resetUploadQueueForTest(memPersistence());
    const decision = captureAndMaybeEnqueue(
      { mimeType: 'video/mp4', byteSize: 1_000_000, fileName: 'clip.mp4' },
      { ...baseEnq, checksum: 'sha256-vid' },
    );
    assert.equal(decision.accepted, false);
    assert.equal(decision.reason, 'unsupported_format');
    assert.equal(useUploadQueueStore.getState().items.length, 0); // nothing queued
  });

  await test('oversize capture (> budget) is rejected as too_large', () => {
    __resetUploadQueueForTest(memPersistence());
    const decision = captureAndMaybeEnqueue(
      { mimeType: 'image/png', byteSize: MAX_EVIDENCE_BYTES + 1, fileName: 'huge.png' },
      { ...baseEnq, checksum: 'sha256-huge' },
    );
    assert.equal(decision.accepted, false);
    assert.equal(decision.reason, 'too_large');
    assert.equal(useUploadQueueStore.getState().items.length, 0);
  });

  await test('empty / aborted capture (0 bytes) is rejected', () => {
    __resetUploadQueueForTest(memPersistence());
    const decision = evaluateCapture({ mimeType: 'image/jpeg', byteSize: 0, fileName: 'x.jpg' });
    assert.equal(decision.accepted, false);
    assert.equal(decision.reason, 'empty_capture');
  });

  await test('capture with no MIME falls back to the file extension (heic/pdf accepted; unknown refused)', () => {
    assert.equal(mimeFromFileName('scan.pdf'), 'application/pdf');
    assert.equal(isSupportedEvidenceFormat(mimeFromFileName('photo.heic')), true);
    // Missing MIME + supported extension -> accepted.
    assert.equal(evaluateCapture({ byteSize: 2048, fileName: 'reg.pdf' }).accepted, true);
    // Missing MIME + unknown extension (no resolvable MIME) -> refused (never enqueued).
    assert.equal(evaluateCapture({ byteSize: 2048, fileName: 'note.txt' }).accepted, false);
    // An explicit unsupported MIME is labelled unsupported_format.
    assert.equal(evaluateCapture({ mimeType: 'text/plain', byteSize: 2048, fileName: 'note.txt' }).reason, 'unsupported_format');
    // No MIME and no usable name -> missing_mime.
    assert.equal(evaluateCapture({ byteSize: 2048 }).reason, 'missing_mime');
  });

  await test('multi-page evidence: pages captured out of order upload in pageOrder sequence', async () => {
    __resetUploadQueueForTest(memPersistence());
    const s = useUploadQueueStore.getState();
    // Capture page 3, then 1, then 2 (out of order).
    s.enqueue({ ...baseEnq, checksum: 'p3', localFileRef: 'file:///cap/p3.jpg', pageOrder: 3 });
    s.enqueue({ ...baseEnq, checksum: 'p1', localFileRef: 'file:///cap/p1.jpg', pageOrder: 1 });
    s.enqueue({ ...baseEnq, checksum: 'p2', localFileRef: 'file:///cap/p2.jpg', pageOrder: 2 });
    assert.equal(useUploadQueueStore.getState().items.length, 3);

    // The uploader assembles pages in pageOrder using the ordering helper.
    const ready = useUploadQueueStore.getState().dequeueReady();
    const ordered = orderPages(ready);
    assert.deepEqual(ordered.map((i) => i.pageOrder), [1, 2, 3]);
    assert.deepEqual(ordered.map((i) => i.localFileRef), ['file:///cap/p1.jpg', 'file:///cap/p2.jpg', 'file:///cap/p3.jpg']);
  });

  await test('LOW STORAGE: a full durable store (quota) never drops the capture — it stays queued and still drains', async () => {
    const low = lowStoragePersistence();
    __resetUploadQueueForTest(low.adapter);
    // enqueue triggers a best-effort durable save; the store is FULL so nothing is persisted, but
    // in-memory truth must be unaffected (the store never blocks/loses a capture on a save failure).
    const item = useUploadQueueStore.getState().enqueue({ ...baseEnq, checksum: 'sha256-lowstore' });
    await Promise.resolve(); // let the fire-and-forget save settle
    assert.ok(low.getQuotaHits() >= 1);         // the adapter hit its quota on save
    assert.equal(low.getSaved().length, 0);      // nothing durably written (store full)
    assert.equal(useUploadQueueStore.getState().items.length, 1); // capture retained in memory
    assert.equal(useUploadQueueStore.getState().items[0].localId, item.localId);
    assert.equal(useUploadQueueStore.getState().items[0].status, 'queued');

    // On reconnect it still drains from in-memory truth despite durable storage being full.
    const res = await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: async () => 'ev-lowstore' });
    assert.equal(res.uploaded, 1);
    assert.equal(useUploadQueueStore.getState().items[0].status, 'uploaded');
  });

  console.log(`\nALL LARGE-PAYLOAD + EDGE-CASE CERTIFICATION CHECKS PASSED (${passed} checks)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
