/**
 * Source hygiene.
 *
 * A single NUL byte reached `financeIntelligenceService.js` during I11, written
 * where a sentinel string was intended. It survived every gate: the syntax was
 * valid, the unit tests passed because the test double compares JavaScript values,
 * and the typechecker never sees backend JavaScript.
 *
 * What it broke was invisible until something looked. `grep` treats a file
 * containing a NUL as binary and silently skips it, so the file quietly dropped
 * out of every source-wide search — including the ones other tests in this suite
 * use to assert that a fabrication is gone. At runtime the value would have gone
 * to PostgREST as a query parameter Postgres rejects, turning "a lender with no
 * tenant" into a read error rather than an empty result.
 *
 * The check is cheap; the failure mode was not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const ROOTS = [
  'backend/services/intelligence',
  'backend/routes',
  'backend/services/referral',
  'web/src/components/intelligence',
];

/** Tab, newline and carriage return are the only control characters source needs. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function collect(dir) {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    return /\.(js|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test('no source file contains a control character', () => {
  const offenders = [];
  for (const rel of ROOTS.flatMap(collect)) {
    const bytes = fs.readFileSync(path.join(REPO, rel));
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i];
      if (byte < 0x20 && !ALLOWED.has(byte)) {
        offenders.push(`${rel} @${i} (0x${byte.toString(16).padStart(2, '0')})`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [],
    'a control character makes a file binary to grep, so it silently vanishes from every source-wide assertion');
});

test('the finance tenant filter uses a readable sentinel', () => {
  const source = fs.readFileSync(
    path.join(REPO, 'backend/services/intelligence/financeIntelligenceService.js'),
    'utf8',
  );
  assert.ok(
    source.includes("tenantId ?? '__no_tenant__'"),
    'an absent tenant must match an impossible sentinel, and that sentinel must be readable',
  );
  // The original defect, expressed without embedding the byte itself.
  assert.equal(source.indexOf(String.fromCharCode(0)), -1);
});
