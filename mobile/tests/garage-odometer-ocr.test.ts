/**
 * OC-4C — native Garage odometer OCR convergence (npx tsx tests/garage-odometer-ocr.test.ts).
 *
 *   capture → durable queue (capture-first) → idempotent evidence upload → governed vehicle-evidence OCR
 *   (Document Intelligence → Qwen, server-side) → candidate reading pending review.
 *
 * Proves, with injected fetch (no device, no network):
 *   - the client sides of the wire match shared/contracts/native-odometer-capture.contract.json;
 *   - an uploaded capture gets its governed OCR read, and an OCR failure never un-uploads it;
 *   - a capture that cannot upload stays queued (offline, restart-safe) and later uploads ONCE;
 *   - the owner is told only what is true (candidate ≠ mileage; "saved" only when it was);
 *   - the garage screen no longer calls the retired /api/ai/ocr, calls no AI endpoint, and writes no mileage.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useUploadQueueStore, __resetUploadQueueForTest, type UploadQueueItem, type QueuePersistence } from '../store/uploadQueueStore';
import { drainUploadQueue, makeHttpUploader, NATIVE_EVIDENCE_CONTRACTS } from '../utils/uploadQueueDrain';
import {
  ODOMETER_NATIVE_EVIDENCE_TYPE, ODOMETER_UPLOAD_CONTRACT, odometerOcrUrl, odometerOutcomeMessage, requestOdometerReading,
} from '../utils/odometerCapture';

// Plain string paths: the mobile tsconfig mixes the DOM and Node `URL` types, and readFileSync(URL) fails
// to typecheck under the @types/node the lockfile resolves.
const repoPath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url).href);
const CONTRACT = JSON.parse(readFileSync(repoPath('../../shared/contracts/native-odometer-capture.contract.json'), 'utf8'));
const GARAGE: string = readFileSync(repoPath('../app/(tabs)/garage.tsx'), 'utf8');

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
const CAPTURE = { userId: 'owner-1', tenantId: 'default', vin: 'OC4CVIN0000000001', evidenceType: ODOMETER_NATIVE_EVIDENCE_TYPE, localFileRef: 'data:image/jpeg;base64,/9j/AAAA', checksum: '1234:abcd' };

async function main() {
  await test('contract: the client constants ARE the shared contract', () => {
    assert.equal(ODOMETER_NATIVE_EVIDENCE_TYPE, CONTRACT.nativeEvidenceType);
    assert.deepEqual({ ...ODOMETER_UPLOAD_CONTRACT }, CONTRACT.upload.body);
    assert.deepEqual({ ...NATIVE_EVIDENCE_CONTRACTS[CONTRACT.nativeEvidenceType] }, CONTRACT.upload.body);
    assert.equal(odometerOcrUrl('https://b', 'V1', 'e1'), `https://b${CONTRACT.ocr.path.replace(':vin', 'V1').replace(':evidenceId', 'e1')}`);
  });

  // PC01-J-R1: both mutating calls (upload, run-ocr) carry a session-bound CSRF token, fetched from
  // the security endpoint first. The stubs answer that endpoint and record which token each call sent.
  const CSRF_PATH = '/api/security/csrf-token';
  const csrfSent: string[] = [];
  const csrfAware = (handler: (url: string, init: any) => any) => async (url: string, init: any = {}) => {
    if (String(url).endsWith(CSRF_PATH)) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: `csrf-for-${init.headers?.['x-session-token'] ?? 'guest'}` }) };
    }
    if (init.headers?.['x-csrf-token']) csrfSent.push(`${String(url).split('/').pop()}:${init.headers['x-csrf-token']}`);
    return handler(url, init);
  };

  await test('journey: upload → governed OCR read of THAT evidence → a candidate pending review', async () => {
    __resetUploadQueueForTest(memPersistence());
    const queued = useUploadQueueStore.getState().enqueue(CAPTURE);
    const urls: string[] = [];
    csrfSent.length = 0;
    (globalThis as any).fetch = csrfAware((url: string) => {
      urls.push(String(url));
      if (String(url).endsWith('/evidence/upload')) return { ok: true, status: 200, json: async () => ({ id: 'ev-1' }) };
      return { ok: true, status: 200, json: async () => ({ success: true, reading: { odometer_reading: 84213, odometer_unit: 'km', status: CONTRACT.ocr.candidateStatus }, authority_effects: { mileage_recorded: false } }) };
    });
    let outcome: any = null;
    const res = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: makeHttpUploader('https://api.example', 'tok'),
      onUploaded: async (it, evidenceId) => { if (it.localId === queued.localId) outcome = await requestOdometerReading('https://api.example', 'tok', it.vin, evidenceId); },
    });
    assert.equal(res.uploaded, 1);
    assert.deepEqual(outcome, { kind: 'candidate', evidenceId: 'ev-1', reading: 84213, unit: 'km' });
    assert.deepEqual(urls, [
      `https://api.example/api/vehicles/${CAPTURE.vin}/evidence/upload`,
      `https://api.example/api/vehicles/${CAPTURE.vin}/evidence/ev-1/run-ocr`,
    ]);
    assert.ok(urls.every((u) => !u.includes('/api/ai/')), 'the app never calls an AI endpoint for OCR');
    assert.deepEqual(csrfSent, ['upload:csrf-for-tok', 'run-ocr:csrf-for-tok'], 'both mutating calls carry the session-bound CSRF token');
  });

  await test('an OCR failure never un-uploads the capture: the evidence stays stored for manual review', async () => {
    __resetUploadQueueForTest(memPersistence());
    useUploadQueueStore.getState().enqueue(CAPTURE);
    (globalThis as any).fetch = csrfAware((url: string) => (String(url).endsWith('/evidence/upload')
      ? { ok: true, status: 200, json: async () => ({ id: 'ev-2' }) }
      : { ok: false, status: 503, json: async () => ({}) }));
    let outcome: any = null;
    await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: makeHttpUploader('https://api.example', 'tok'),
      onUploaded: async (it, evidenceId) => { outcome = await requestOdometerReading('https://api.example', 'tok', it.vin, evidenceId); },
    });
    assert.deepEqual(outcome, { kind: 'ocr_unavailable', evidenceId: 'ev-2' });
    assert.equal(useUploadQueueStore.getState().items[0].status, 'uploaded');
    assert.equal(useUploadQueueStore.getState().items[0].backendEvidenceId, 'ev-2');
  });

  await test('a follow-up that THROWS after the upload still never un-uploads the capture', async () => {
    __resetUploadQueueForTest(memPersistence());
    useUploadQueueStore.getState().enqueue(CAPTURE);
    (globalThis as any).fetch = csrfAware(() => ({ ok: true, status: 200, json: async () => ({ id: 'ev-thrown' }) }));
    const res = await drainUploadQueue({
      resolvePayload: async (it) => it.localFileRef,
      uploadOne: makeHttpUploader('https://api.example', 'tok'),
      onUploaded: async () => { throw new Error('ocr follow-up exploded'); },
    });
    assert.equal(res.uploaded, 1);
    assert.equal(res.failed, 0);
    const [item] = useUploadQueueStore.getState().items;
    assert.equal(item.status, 'uploaded');
    assert.equal(item.backendEvidenceId, 'ev-thrown');
  });

  await test('offline: the capture stays queued, survives a restart (persisted), and uploads ONCE when back online', async () => {
    const persistence = memPersistence();
    __resetUploadQueueForTest(persistence);
    useUploadQueueStore.getState().enqueue(CAPTURE);
    (globalThis as any).fetch = async () => { throw new TypeError('Network request failed'); };
    await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: makeHttpUploader('https://api.example', 'tok') });
    assert.equal(useUploadQueueStore.getState().items[0].status, 'failed', 'kept for retry, not lost');
    // App restart: a fresh store hydrates from the durable persistence.
    __resetUploadQueueForTest(persistence);
    await useUploadQueueStore.getState().hydrate();
    const restored = useUploadQueueStore.getState().items;
    assert.equal(restored.length, 1);
    let uploads = 0;
    (globalThis as any).fetch = csrfAware((url: string) => {
      if (String(url).endsWith('/evidence/upload')) uploads += 1;
      return { ok: true, status: 200, json: async () => ({ id: 'ev-3' }) };
    });
    const later = Date.now() + 24 * 3600 * 1000; // past any backoff
    await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: makeHttpUploader('https://api.example', 'tok'), now: () => later });
    await drainUploadQueue({ resolvePayload: async (it) => it.localFileRef, uploadOne: makeHttpUploader('https://api.example', 'tok'), now: () => later });
    assert.equal(uploads, 1, 'uploaded once — the second drain finds nothing ready');
    assert.equal(useUploadQueueStore.getState().items[0].status, 'uploaded');
  });

  await test('the owner is told only what is true', () => {
    const candidate = odometerOutcomeMessage({ kind: 'candidate', evidenceId: 'e', reading: 84213, unit: 'km' });
    assert.match(candidate.body, /84,213 km/);
    assert.match(candidate.body, /pending review/);
    assert.match(candidate.body, /does not change your vehicle's recorded mileage/);
    for (const kind of ['not_read', 'ocr_unavailable'] as const) {
      const message = odometerOutcomeMessage({ kind, evidenceId: 'e' });
      assert.match(message.body, /stored as private evidence/);
      assert.match(message.body, /reviewed manually/);
    }
    const queued = odometerOutcomeMessage({ kind: 'queued' });
    assert.match(queued.body, /saved on this device/);
    assert.doesNotMatch(queued.body, /evidence/, 'nothing is claimed stored server-side before it is');
  });

  await test('source guard: the garage screen uses the governed path — no retired route, no AI endpoint, no mileage write', () => {
    assert.ok(!GARAGE.replace(/\/\/.*$/gm, '').includes(CONTRACT.retiredRoute), 'the retired /api/ai/ocr is not called');
    assert.doesNotMatch(GARAGE.replace(/\/\/.*$/gm, ''), /\/api\/ai\//, 'no AI endpoint is called from the garage');
    assert.doesNotMatch(GARAGE, /base64Data/);
    assert.doesNotMatch(GARAGE, /method:\s*'(PATCH|PUT)'/, 'the garage screen writes no vehicle field');
    const handler = GARAGE.slice(GARAGE.indexOf('const handleOdometerScan'), GARAGE.indexOf('const handleKycScan'));
    assert.ok(handler.indexOf('enqueueUpload(') > 0 && handler.indexOf('enqueueUpload(') < handler.indexOf('drainUploadQueue('),
      'capture-first: the photo is queued durably before any network call');
    assert.match(handler, /requestOdometerReading\(/);
    assert.match(handler, /odometerOutcomeMessage\(/);
  });

  console.log('\nALL OC-4C GARAGE ODOMETER TESTS PASSED');
}
main().catch((e) => { console.error(e); process.exit(1); });
