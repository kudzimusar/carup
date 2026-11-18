/** Offline measurement for the fictional corpus from generate-identity-mrz-qualification.py. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { inspectTd3Structure, observedTd3Rows } from '../../services/identity/localOcrStructure.js';
import { runLocalIdentityOcr } from '../../services/identity/localIdentityOcr.js';

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int');
const [directory] = process.argv.slice(2);
assert.ok(directory, 'Provide the fictional fixture directory.');
const fixtures = JSON.parse(await readFile(join(directory, 'ground-truth.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const spans = { document_number: [0, 9], nationality: [10, 13], birth: [13, 19], expiry: [21, 27], optional_and_checks: [28, 44] };

function score(text, truth) {
  const rows = observedTd3Rows(text);
  return {
    observation: inspectTd3Structure(text),
    fullExact: !!truth && !!rows && rows.every((row, index) => row === truth[index]),
    fields: truth && Object.fromEntries([
      ['name', rows?.[0].slice(5) === truth[0]?.slice(5)],
      ...Object.entries(spans).map(([field,[start,end]]) => [
        field, !!rows && rows[1].length >= end && rows[1].slice(start, end) === truth[1]?.slice(start, end),
      ]),
    ]),
  };
}

async function experimentalRows(pixels, worker) {
  const { data, info: { width, height, channels } } = await sharp(pixels).normalize().greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(channels, 1);
  const lines = [];
  for (let y = Math.floor(height * 0.59); y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (data[y * width + x] < 150) count++;
    if (count <= width * 0.055) continue;
    const last = lines.at(-1);
    if (last && y - last[1] <= 4) last[1] = y;
    else lines.push([y, y]);
  }
  const regions = lines.filter(([top, bottom]) => bottom - top >= 8);
  if (regions.length !== 2) return '';
  await worker.setParameters({ tessedit_pageseg_mode: '13', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<' });
  const recognized = [];
  for (const [start, end] of regions) {
    const top = Math.max(start - 6, 0);
    const cropHeight = Math.min(end + 7, height) - top;
    const crop = await sharp(pixels).extract({ left: 0, top, width, height: cropHeight }).normalize().threshold(165).png().toBuffer();
    const framed = await sharp(crop).trim({ background: '#fff', threshold: 18 })
      .extend({ top: 16, bottom: 16, left: 12, right: 12, background: '#fff' }).png().toBuffer();
    recognized.push((await worker.recognize(framed)).data.text.replace(/[\r\n]/gu, ''));
  }
  return recognized.join('\n');
}

const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
try {
  const report = [];
  for (const fixture of fixtures) {
    assert.match(fixture.file, /^[a-z0-9-]+\.(png|jpg)$/u);
    const input = await readFile(join(directory, fixture.file));
    assert.equal(hash(input), fixture.sha256);
    const start = performance.now();
    const actual = await runLocalIdentityOcr(input, 'passport');
    const elapsedMs = Math.round(performance.now() - start);
    const pixels = await sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' })
      .rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).greyscale().png().toBuffer();
    await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
    const baseline = score((await worker.recognize(pixels)).data.text, fixture.lines);
    const isolated = score(await experimentalRows(pixels, worker), fixture.lines);
    report.push({ file: fixture.file, group: fixture.group, expected: fixture.expected, deployedObservation: actual.td3Mrz,
      elapsedMs, peakRssKiB: actual.peakRssKiB, wholePage: baseline, experimentalSegments: isolated });
  }
  const groups = Object.fromEntries([...new Set(report.map(r => r.group))].map(group => {
    const rows = report.filter(r => r.group === group);
    const counts = key => Object.fromEntries(['name', ...Object.keys(spans)].map(field => [field, rows.filter(row => row[key].fields?.[field]).length]));
    return [group, {
      count: rows.length,
      deployedChecksumPass: rows.filter(r => r.deployedObservation === 'checksums_pass').length,
      wholePageExact: rows.filter(r => r.wholePage.fullExact).length,
      segmentedChecksumPass: rows.filter(r => r.experimentalSegments.observation === 'checksums_pass').length,
      segmentedExact: rows.filter(r => r.experimentalSegments.fullExact).length,
      wholePageFieldExact: counts('wholePage'),
      segmentFieldExact: counts('experimentalSegments'),
    }];
  }));
  const parser = await readFile(new URL('../../services/identity/localOcrStructure.js', import.meta.url));
  const model = await readFile(join(langPath, 'eng.traineddata.gz'));
  console.log(JSON.stringify({ runtime: `${process.version} ${process.platform} ${process.arch}`, parserSha256: hash(parser),
    modelSha256: hash(model), recognizer: require('tesseract.js/package.json').version, groups, report }, null, 2));
  assert.equal(groups.negative.deployedChecksumPass, 0);
  assert.equal(groups.negative.segmentedChecksumPass, 0);
} finally {
  await worker.terminate();
}
