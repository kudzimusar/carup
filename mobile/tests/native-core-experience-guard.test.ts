import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const CORE = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/marketplace.tsx',
  'app/market/results.tsx',
  'app/vehicle/[vin].tsx',
  'app/sell/index.tsx',
  'app/sell/details.tsx',
  'app/(tabs)/garage.tsx',
  'app/(tabs)/inbox.tsx',
  'app/inbox/[threadId].tsx',
  'app/(tabs)/account.tsx',
  'app/check-car.tsx',
  'app/find-garage.tsx',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const source = stripComments(
  CORE.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'),
);

for (const phrase of [
  'Stakeholder Portal Switching',
  'multi-tenant',
  'ledger systems',
  'immutable logs',
  'authorization context',
  'canonical authority',
  'provider gateway',
  'AI gateway',
  'CarUp Kimi',
  'ZIMBABWE RESUMABLE NETWORK BUFFER',
  'system of record',
  'seller authority',
  'governed channel',
]) {
  assert.equal(
    source.toLowerCase().includes(phrase.toLowerCase()),
    false,
    `customer-facing native core contains architecture language: ${phrase}`,
  );
}

for (const fakeTruth of [
  'demo vehicle',
  'mock vehicle',
  'sample listing',
  'fake listing',
  'placeholder price',
]) {
  assert.equal(
    source.toLowerCase().includes(fakeTruth.toLowerCase()),
    false,
    `native core contains synthetic product truth marker: ${fakeTruth}`,
  );
}

assert.match(
  fs.readFileSync(path.join(root, 'app/(tabs)/index.tsx'), 'utf8'),
  /getMarketplaceListings/,
  'Home must consume the real Marketplace API',
);
assert.match(
  fs.readFileSync(path.join(root, 'app/(tabs)/marketplace.tsx'), 'utf8'),
  /getMarketplaceListings/,
  'Market must consume the real Marketplace API',
);
assert.match(
  fs.readFileSync(path.join(root, 'app/market/results.tsx'), 'utf8'),
  /getMarketplaceListings/,
  'Results must consume the real Marketplace API',
);
assert.match(
  fs.readFileSync(path.join(root, 'app/(tabs)/garage.tsx'), 'utf8'),
  /getMyVehicles/,
  'My Garage must consume owner vehicle truth',
);

const results = fs.readFileSync(path.join(root, 'app/market/results.tsx'), 'utf8');
assert.match(results, /getSavedMarketplaceListings/, 'Market results must support authenticated saved discovery');
assert.match(results, /saveMarketplaceListing/, 'Market cards must save through the Marketplace API');
assert.match(results, /unsaveMarketplaceListing/, 'Market cards must unsave through the Marketplace API');
assert.match(results, /FlashList/, 'Marketplace results must retain the performant native list');

const primitives = fs.readFileSync(path.join(root, 'components/ui/NativePrimitives.tsx'), 'utf8');
const tokens = fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8');
assert.match(tokens, /minimum:\s*48/, 'shared touch-target floor must remain 48dp');
assert.match(primitives, /touchTarget\.minimum/, 'shared primitives must consume the touch-target floor');

const shell = fs.readFileSync(path.join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
assert.match(shell, /minHeight:\s*48/, 'bottom navigation targets must remain at least 48dp');

const adaptive = [
  fs.readFileSync(path.join(root, 'app/market/results.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, 'app/(tabs)/garage.tsx'), 'utf8'),
].join('\n');
assert.match(adaptive, /useWindowDimensions/, 'core list experiences must adapt to expanded phone widths');
assert.doesNotMatch(adaptive, /390\s*[x×]\s*844|width:\s*390|height:\s*844/, 'native layout must not target one fixed phone size');

console.log('native-core-experience-guard.test: PASS');
