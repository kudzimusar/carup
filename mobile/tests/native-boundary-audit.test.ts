/**
 * OC-NATIVE-LR1 route-boundary audit.
 *
 * The branded consumer shell is Home / Market / Verify / Sell / Account. Home is public. Inbox remains governed and reachable contextually.
 * Hidden workflow routes keep their original domain authorization boundaries.
 */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function source(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const governed: Array<{ file: string; featureId: string }> = [
  { file: 'app/(tabs)/marketplace.tsx', featureId: 'product.marketplace' },
  { file: 'app/(tabs)/garage.tsx', featureId: 'owner.garage' },
  { file: 'app/(tabs)/escrow.tsx', featureId: 'owner.listings' },
  { file: 'app/(tabs)/referral.tsx', featureId: 'owner.referrals' },
  { file: 'app/(tabs)/communications.tsx', featureId: 'owner.communications' },
];

for (const item of governed) {
  const src = source(item.file);
  assert.match(src, /NativeFeatureBoundary/, item.file + ' must retain a governed route boundary');
  const doubleQuoted = 'featureId="' + item.featureId + '"';
  const singleQuoted = "featureId='" + item.featureId + "'";
  assert.ok(
    src.includes(doubleQuoted) || src.includes(singleQuoted),
    item.file + ' must remain owned by ' + item.featureId,
  );
}

const home = source('app/(tabs)/index.tsx');
assert.doesNotMatch(home, /NativeFeatureBoundary|role\.overview|resolveDashboardGate/, ¶»§q«^