import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_TAB_ROUTES, NATIVE_SHELL_TABS, nativeShellNames } from '../navigation/nativeShell';

assert.deepEqual(nativeShellNames(), ['index', 'marketplace', 'verify', 'sell', 'account']);
assert.equal(NATIVE_SHELL_TABS.length, 5);
assert.equal(new Set(nativeShellNames()).size, 5);

for (const hidden of ['inbox', 'garage', 'escrow', 'referral', 'communications', 'more']) {
  assert.ok(LEGACY_TAB_ROUTES.includes(hidden as (typeof LEGACY_TAB_ROUTES)[number]));
  assert.equal(nativeShellNames().includes(hidden as never), false);
}

const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/(tabs)/_layout.tsx'), 'utf8');
for (const stable of ['index', 'marketplace', 'verify', 'sell', 'account']) {
  assert.ok(
    layout.includes('name="' + stable + '"') || layout.includes("name='" + stable + "'"),
    'layout is missing stable tab ' + stable,
  );
}
for (const hidden of ['inbox', 'garage', 'escrow', 'referral', 'communications', 'more']) {
  const doubleQuoted = 'name="' + hidden + '"';
  const singleQuoted = "name='" + hidden + "'";
  const start = Math.max(layout.indexOf(doubleQuoted), layout.indexOf(singleQuoted));
  assert.ok(start >= 0, 'layout is missing hidden route ' + hidden);
  const block = layout.slice(start, start + 180);
  assert.ok(block.includes('href: null'), 'route ' + hidden + ' must be hidden from the branded bottom shell');
}

assert.ok(layout.includes(¶»§q«^