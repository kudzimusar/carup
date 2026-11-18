// Copy to tests/integration in a standalone backend artifact. Use synthetic input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { runLocalIdentityOcr } from '../../services/identity/localIdentityOcr.js';

const [fixture, expected] = process.argv.slice(2);
assert.ok(fixture && expected, 'Supply a synthetic passport fixture and its expected number.');
const artifactRoot = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const fromArtifact = createRequire(import.meta.url);
const core = createRequire(fromArtifact.resolve('tesseract.js/package.json')).resolve('tesseract.js-core/package.json');
const assets = [
  join(dirname(fromArtifact.resolve('@tesseract.js-data/eng')), '4.0.0_best_int/eng.traineddata.gz'),
  join(dirname(core), 'tesseract-core-lstm.wasm'),
  join(dirname(core), 'tesseract-core-simd-lstm.wasm'),
];
for (const file of assets) {
  assert.ok((await realpath(file)).startsWith(artifactRoot + sep), 'OCR asset outside artifact.');
  const bytes = await readFile(file);
  console.log(`asset ${file.slice(artifactRoot.length + 1)} ${bytes.length} ${createHash('sha256').update(bytes).digest('hex')}`);
}
assert.ok((await realpath(fromArtifact.resolve('sharp'))).startsWith(artifactRoot + sep));
console.log(`runtime ${process.version} ${process.platform} ${process.arch} libvips ${sharp.versions.vips}`);

const image = await readFile(fixture);
async function recognize() {
  const started = performance.now();
  const result = await runLocalIdentityOcr(image, 'passport');
  assert.equal(result.fields.national_id_number, expected);
  console.log(`OCR elapsed_ms ${Math.round(performance.now() - started)} peak_rss_kib ${result.peakRssKiB}`);
}
const parallel = [recognize(), recognize()];
await assert.rejects(() => runLocalIdentityOcr(image, 'passport'), /capacity is occupied/u);
await Promise.all(parallel);

async function waitForSlot(operation) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { return await operation(); } catch (error) {
      if (!error.message.includes('capacity is occupied')) throw error;
      await delay(25);
    }
  }
  throw new Error('OCR process slot did not release.');
}

await assert.rejects(() => waitForSlot(() => runLocalIdentityOcr(image, 'passport', { timeoutMs: 1 })), /timed out/u);
const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' } }).png().toBuffer();
await assert.rejects(() => waitForSlot(() => runLocalIdentityOcr(oversized, 'passport')), /exited without observations/u);
await waitForSlot(recognize);
console.log('PASS artifact model/WASM, subprocess, simultaneous workload, overload, timeout, decoded-pixel limit and recovery');
