import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_TAB_ROUTES, NATIVE_SHELL_TABS, nativeShellNames } from '../navigation/nativeShell';

assert.deepEqual(nativeShellNames(), ['index', 'marketplace', 'inbox', 'account']);
assert.equal(NATIVE_SHELL_TABS.length, 4);
assert.equal(new Set(nativeShellNames()).size, 4);

for (const legacy of ['garage', 'escrow', 'referral', 'communications', 'more']) {
  assert.ok(LEGACY_TAB_ROUTES.includes(legacy as (typeof LEGACY_TAB_ROUTES)[number]));
  assert.equal(nativeShellNames().includes(legacy as never), false);
}

const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/(tabs)/_layout.tsx'), 'utf8');
for (const stable of ['index', 'marketplace', 'inbox', 'account']) {
  assert.match(layout, new RegExp(`name=["']${stable}["']`), `layout is missing stable tab ${stable}`);
}
for (const legacy of ['garage', 'escrow', 'referral', 'communications', 'more']) {
  assert.match(
    layout,
    new RegExp(`name=["']${legacy}["'][\\s\\S]*?href:\\s*null`),
    `legacy route ${legacy} must be hidden from the bottom shell`,
  );
}

assert.doesNotMatch(layout, /resolveTabBar|resolveMoreTab|NativeDrawer/, 'stable shell must not mutate bottom tabs by role');

console.log('native-shell.test: PASS');
