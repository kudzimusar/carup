import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int');
const labelPattern = /^(GIVEN NAME[S]?|FIRST NAME|FAMILY NAME|LAST NAME|SURNAME|DATE OF BIRTH|PASSPORT NUMBER|LICEN[CS]E NUMBER|NATIONAL ID NUMBER|NUMBER)\s*:\s*(.{1,120})$/i;
const fieldForLabel = new Map([
  ['GIVEN NAME', 'first_name'], ['GIVEN NAMES', 'first_name'], ['FIRST NAME', 'first_name'],
  ['FAMILY NAME', 'last_name'], ['LAST NAME', 'last_name'], ['SURNAME', 'last_name'],
  ['DATE OF BIRTH', 'date_of_birth'], ['PASSPORT NUMBER', 'national_id_number'],
  ['LICENCE NUMBER', 'national_id_number'], ['LICENSE NUMBER', 'national_id_number'],
  ['NATIONAL ID NUMBER', 'national_id_number'], ['NUMBER', 'national_id_number'],
]);

function readFields(text, docType) {
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = labelPattern.exec(line.trim());
    if (!match) continue;
    const label = match[1].toUpperCase();
    if ((label === 'PASSPORT NUMBER' && docType !== 'passport')
      || (label === 'NATIONAL ID NUMBER' && docType !== 'national_id')
      || (/^LICEN[CS]E NUMBER$/u.test(label) && !['driver_license', 'drivers_license'].includes(docType))) continue;
    const field = fieldForLabel.get(label);
    const value = match[2].trim();
    const permitted = field === 'national_id_number' ? /^[A-Z0-9 -]{4,40}$/iu.test(value)
      : field === 'date_of_birth' ? /^\d{4}-\d{2}-\d{2}$/u.test(value) : /^[\p{L}\p{M} .'-]{1,120}$/u.test(value);
    if (!permitted) continue;
    if (!values.has(field)) values.set(field, new Set());
    values.get(field).add(value);
  }
  const fields = Object.fromEntries([...values].filter(([, entries]) => entries.size === 1).map(([key, entries]) => [key, [...entries][0]]));

  return fields;
}

process.once('message', async ({ image, docType }) => {
  let worker;
  try {
    const pixels = await sharp(image, { limitInputPixels: 16_000_000, failOn: 'warning' })
      .rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).greyscale().png().toBuffer();
    worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
    const { data: { text } } = await worker.recognize(pixels);
    const fields = readFields(text, docType);
    await worker.terminate();
    process.send({ fields, legible: !!text.trim(), peakRssKiB: process.resourceUsage().maxRSS }, () => process.disconnect());
  } catch {
    if (worker) await worker.terminate().catch(() => {});
    process.exit(1);
  }
});
