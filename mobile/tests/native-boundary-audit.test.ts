/**
 * OC-NATIVE-LR1 route-boundary audit.
 *
 * The stable consumer shell is Home / Market / Inbox / Account. Home is public.
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
  assert.match(
    src,
    new RegExp('featureId=["\\\']' + item.featureId.replace(/\\./g, '\\\\.') + '["\\\']'),
    item.file + ' must remain owned by ' + item.featureId,
  );
}

const home = source('app/(tabs)/index.tsx');
assert.doesNotMatch(home, /NativeFeatureBoundary|role\.overview|resolveDashboardGate/, 'public Home must not be a role workspace');

const inbox = source('app/(tabs)/inbox.tsx');
assert.match(inbox, /!isAuthenticated/, 'Inbox must handle anonymous access explicitly');
assert.match(inbox, /user\?\.role\s*!==\s*['\"]owner['\"]/, 'Inbox must refuse unsupported workspace roles');

const account = source('app/(tabs)/account.tsx');
assert.match(account, /!isAuthenticated/, 'Account must handle anonymous access explicitly');

const shell = source('app/(tabs)/_layout.tsx');
for (const legacy of ['garage', 'escrow', 'referral', 'communications', 'more']) {
  assert.match(
    shell,
    new RegExp('name=["\\\']' + legacy + '["\\\'][\\\\s\\\\S]*?href:\\s*null'),
    legacy + ' must stay hidden from the stable bottom shell',
  );
}

console.log('native-boundary-audit.test: PASS');
