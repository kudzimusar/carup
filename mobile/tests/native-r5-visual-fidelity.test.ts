import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const home = fs.readFileSync(path.join(root, 'app/(tabs)/index.tsx'), 'utf8');
const check = fs.readFileSync(path.join(root, 'app/check-car.tsx'), 'utf8');
const brand = fs.readFileSync(path.join(root, 'components/brand/CarUpBrand.tsx'), 'utf8');
const tokens = fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8');

assert.match(tokens, /orange500:\s*'#F97316'/, 'CarUp structural orange must remain canonical');
assert.match(tokens, /navy900:\s*'#081B2C'/, 'CarUp hero navy must remain canonical');
assert.match(tokens, /heroDisplay/, 'brand display token must exist');
assert.match(tokens, /heroEyebrow/, 'brand eyebrow token must exist');

assert.match(brand, /export function CarUpWordmark\b/, 'CarUp wordmark treatment must be reusable');
assert.match(brand, /export function BrandSearchField\b/, 'branded hero search must be reusable');

for (const copy of ['ONE CARUP Â· ONE VEHICLE THREAD', 'Buy. Sell. Verify.', 'Browse cars']) {
  assert.ok(home.includes(copy), 'Home is missing binding owner copy: ' + copy);
}
assert.match(home, /theme\.brand\.hero/, 'Home hero must use the structural dark brand surface');
assert.match(home, /theme\.brand\.primary/, 'Home must use structural CarUp orange');
assert.match(home, /getMarketplaceListings/, 'Home must preserve real Marketplace data');
assert.doesNotMatch(home, /mock|placeholder car/i, 'Home¶»§q«^