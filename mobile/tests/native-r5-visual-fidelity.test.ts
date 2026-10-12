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

for (const copy of ['ONE CARUP · ONE VEHICLE THREAD', 'Buy. Sell. Verify.', 'Browse cars']) {
  assert.ok(home.includes(copy), 'Home is missing binding owner copy: ' + copy);
}
assert.match(home, /theme\.brand\.hero/, 'Home hero must use the structural dark brand surface');
assert.match(home, /theme\.brand\.primary/, 'Home must use structural CarUp orange');
assert.match(home, /getMarketplaceListings/, 'Home must preserve real Marketplace data');
assert.doesNotMatch(home, /mock|placeholder car/i, 'Home must not introduce fake inventory');

assert.ok(check.includes('Check CarUp record'), 'Check primary action must remain present');
assert.match(
  check,
  /backgroundColor:\s*theme\.brand\.primary[\s\S]*borderColor:\s*theme\.brand\.primary/,
  'Check primary action must explicitly render the orange primary container',
);
assert.ok(check.includes('does not prove ownership or government registration'), 'Check authority boundary must remain explicit');
assert.doesNotMatch(check, /government verified|registry verified/i, 'Check must not overclaim registry authority');

console.log('native-r5-visual-fidelity.test: PASS');
