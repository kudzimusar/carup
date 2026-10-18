/**
 * OC-NATIVE-LR1 route-boundary audit.
 *
 * The branded consumer shell is Home / Market / Verify / Sell / Account. Home is public.
 * Inbox remains governed and reachable contextually; hidden workflow routes retain authority boundaries.
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
assert.doesNotMatch(home, /NativeFeatureBoundary|role\.overview|resolveDashboardGate/, 'public Home must not be a role workspace');

const inbox = source('app/(tabs)/inbox.tsx');
assert.match(inbox, /!isAuthenticated/, 'Inbox must handle anonymous access explicitly');
assert.match(inbox, /user\?\.role\s*!==\s*['"]owner['"]/, 'Inbox must refuse unsupported workspace roles');

const account = source('app/(tabs)/account.tsx');
assert.match(account, /!isAuthenticated/, 'Account must handle anonymous access explicitly');

const shell = source('app/(tabs)/_layout.tsx');
for (const hidden of ['inbox', 'garage', 'escrow', 'referral', 'communications', 'more']) {
  const doubleQuoted = 'name="' + hidden + '"';
  const singleQuoted = "name='" + hidden + "'";
  const start = Math.max(shell.indexOf(doubleQuoted), shell.indexOf(singleQuoted));
  assert.ok(start >= 0, hidden + ' screen declaration must exist');
  const block = shell.slice(start, start + 180);
  assert.match(block, /href:\s*null/, hidden + ' must stay hidden from the branded bottom shell');
}

console.log('native-boundary-audit.test: PASS');
