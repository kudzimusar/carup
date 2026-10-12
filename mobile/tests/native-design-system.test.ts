import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const tokens = fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8');
const primitives = fs.readFileSync(path.join(root, 'components/ui/NativePrimitives.tsx'), 'utf8');

for (const token of [
  'brand.primary',
  'background.canvas',
  'text.primary',
  'state.success',
  'state.warning',
  'state.danger',
  'focus.ring',
]) {
  const [group, key] = token.split('.');
  assert.match(tokens, new RegExp(`${group}[\\s\\S]*${key}`), `missing semantic token ${token}`);
}

for (const name of [
  'navLabel',
  'heroDisplay',
  'heroEyebrow',
  'display',
  'titleLarge',
  'headline',
  'body',
  'bodyStrong',
  'label',
  'metadata',
  'priceLarge',
  'priceCompact',
  'button',
]) {
  assert.match(tokens, new RegExp(`\\b${name}\\b`), `missing type token ${name}`);
}

for (const component of [
  'Screen',
  'SectionHeader',
  'Button',
  'IconButton',
  'SearchField',
  'FilterChip',
  'StatusPill',
  'TrustSignal',
  'EmptyState',
  'Skeleton',
  'Price',
  'Notice',
  'Field',
  'StickyActionBar',
]) {
  assert.match(primitives, new RegExp(`export function ${component}\\b`), `missing primitive ${component}`);
}

assert.match(tokens, /minimum:\s*48/, 'touch target floor must be 48dp');
assert.doesNotMatch(primitives, /fontSize:\s*(?:9|10|11|12)\b/, 'new primitives must not introduce tiny customer-facing type');

console.log('native-design-¶»§q«^