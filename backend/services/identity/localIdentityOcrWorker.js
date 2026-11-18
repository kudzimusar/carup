import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { normalizeDate } from '../document-intelligence/documentSchemas.js';
import { inspectTd3Structure } from './localOcrStructure.js';

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int');
const labelPattern = /^([A-Za-z .]{2,32}?)(?:\s*:\s*|\s+-\s+)(.{1,120})$/u;
const fieldForLabel = new Map([
  ['GIVEN NAME', 'first_name'], ['GIVEN NAMES', 'first_name'], ['FIRST NAME', 'first_name'],
  ['FAMILY NAME', 'last_name'], ['LAST NAME', 'last_name'], ['SURNAME', 'last_name'],
  ['DATE OF BIRTH', 'date_of_birth'], ['DOB', 'date_of_birth'], ['BIRTH DATE', 'date_of_birth'],
  ['NUMBER', 'national_id_number'],
]);
const numberLabels = {
  passport: new Set(['PASSPORT NUMBER', 'PASSPORT NO']),
  national_id: new Set(['NATIONAL ID NUMBER', 'NATIONAL ID NO', 'ID NUMBER', 'ID NO']),
  drivers_license: new Set(['LICENCE NUMBER', 'LICENCE NO', 'LICENSE NUMBER', 'LICENSE NO']),
};

function readFields(text, docType) {
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = labelPattern.exec(line.trim());
    if (!match) continue;
    const label = match[1].toUpperCase().replaceAll('.', '').replace(/\s+/gu, ' ').trim();
    const declared = docType === 'driver_license' ? 'drivers_license' : docType;
    const field = numberLabels[declared]?.has(label) ? 'national_id_number' : fieldForLabel.get(label);
    if (!field) continue;
    const printed = match[2].trim();
    const value = field === 'date_of_birth' ? normalizeDate(printed).value : printed;
    if (!value || (field === 'national_id_number' && !/^[A-Z0-9-][A-Z0-9 -]{3,39}$/iu.test(value))
      || ((field === 'first_name' || field === 'last_name') && !/^[\p{L}][\p{L}\p{M} .'-]{0,119}$/u.test(value))) continue;
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
    const td3Mrz = docType === 'passport' ? inspectTd3Structure(text) : 'not_applicable';
    process.send({ fields, td3Mrz, legible: !!text.trim(), peakRssKiB: process.resourceUsage().maxRSS }, () => process.disconnect());
  } catch {
    if (worker) await worker.terminate().catch(() => {});
    process.exit(1);
  }
});
