import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NATIVE_SHELL_TABS, nativeShellNames } from '../navigation/nativeShell';
import {
  EMPTY_MARKETPLACE_FILTERS,
  MARKETPLACE_TRUST_FILTERS,
  activeMarketplaceFilterCount,
  clearMarketplaceFilters,
  marketplaceApiQuery,
  serializeMarketplaceFilters,
} from '../utils/marketplaceFilters';
import { TRADE_READ_AUTHORITIES } from '../utils/tradeApi';

const root = path.resolve(process.cwd());
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const layout = read('app/(tabs)/_layout.tsx');
const home = read('app/(tabs)/index.tsx');
const buy = read('app/(tabs)/marketplace.tsx');
const results = read('app/market/results.tsx');
const sheet = read('components/marketplace/MarketplaceFilterSheet.tsx');
const header = read('components/navigation/NativeSharedHeader.tsx');
const account = read('app/(tabs)/account.tsx');
const trade = read('app/(tabs)/trade.tsx');
const sellTab = read('app/(tabs)/sell.tsx');
const tradeApi = read('utils/tradeApi.ts');
const verify = read('app/check-car.tsx');

assert.deepEqual(nativeShellNames(), ['index', 'marketplace', 'verify', 'sell', 'trade']);
assert.deepEqual(NATIVE_SHELL_TABS.map((item) => item.title), ['Home', 'Buy', 'Verify', 'Sell', 'Trade']);
assert.equal(NATIVE_SHELL_TABS.length, 5);
assert.match(layout, /name="trade" options=\{stableOptions\('trade', 'Trade'\)\}/);
assert.match(layout, /name="account" options=\{\{ href: null \}\}/);
assert.match(layout, /header: \(\) => <NativeSharedHeader \/>/);
assert.match(layout, /tabBarAccessibilityLabel: title/);
assert.doesNotMatch(layout, /stableOptions\('account'/);
assert.doesNotMatch(layout, /stableOptions\('marketplace', 'Market'\)/);
assert.match(sellTab, /SellStartExperience/);
assert.doesNotMatch(sellTab, /Redirect/);

assert.match(header, /notifications-outline/);
assert.match(header, /person-outline/);
assert.match(header, /accessibilityLabel="Notifications and Profile"/);
assert.match(header, /listCommunicationThreads/);
assert.match(header, /unread_count/);
assert.match(header, /router\.push\('\/\(tabs\)\/inbox'/);
assert.match(header, /router\.push\('\/\(tabs\)\/account'/);
assert.match(account, /Inbox \/ Messages/);
assert.match(account, /router\.push\('\/\(tabs\)\/inbox'/);

for (const invariant of ['ONE CARUP · ONE VEHICLE THREAD', 'Buy. Sell. Verify.', 'Browse cars', 'All filters']) {
  assert.ok(home.includes(invariant), `Home lost R5-R4 invariant: ${invariant}`);
}
assert.match(home, /theme\.brand\.hero/);
assert.match(home, /theme\.brand\.primary/);

for (const label of [
  'Make', 'Model', 'Year', 'Colour', 'Body style', 'Location', 'Fuel', 'Transmission',
  'Minimum price', 'Maximum price', 'Condition', 'Trust / verification', 'Sort',
]) {
  assert.ok(sheet.includes(label), `filter sheet missing ${label}`);
}
assert.deepEqual(
  MARKETPLACE_TRUST_FILTERS.map((item) => [item.value, item.label]),
  [
    ['passport_verified', 'Passport Verified'],
    ['partsentry_checked', 'PartSentry Checked'],
    ['dealer_verified', 'Dealer Verified'],
  ],
);

const full = {
  ...EMPTY_MARKETPLACE_FILTERS,
  q: 'hilux',
  make: 'Toyota',
  model: 'Hilux',
  year: '2022',
  color: 'white',
  bodyStyle: 'pickup',
  location: 'Harare',
  fuel: 'diesel',
  transmission: 'automatic',
  minPrice: '10000',
  maxPrice: '50000',
  condition: 'second_hand',
  tags: ['passport_verified', 'partsentry_checked', 'dealer_verified'],
  sort: 'price-low' as const,
};
assert.deepEqual(marketplaceApiQuery(full), {
  q: 'hilux',
  make: 'Toyota',
  model: 'Hilux',
  year: '2022',
  color: 'white',
  bodyStyle: 'pickup',
  location: 'Harare',
  fuel: 'diesel',
  transmission: 'automatic',
  minPrice: '10000',
  maxPrice: '50000',
  condition: 'second_hand',
  tag: 'passport_verified,partsentry_checked,dealer_verified',
  sort: 'price-low',
});
assert.equal(activeMarketplaceFilterCount(full), 14);
assert.match(serializeMarketplaceFilters(full), /tag=passport_verified%2Cpartsentry_checked%2Cdealer_verified/);
assert.deepEqual(clearMarketplaceFilters(), { ...EMPTY_MARKETPLACE_FILTERS, tags: [] });

assert.match(buy, /All filters/);
assert.match(buy, /MarketplaceFilterSheet/);
assert.match(buy, /marketplaceResultsHref/);

assert.match(results, /getMarketplaceListings\(apiQuery\)/);
assert.match(results, /marketplaceApiQuery\(filters\)/);
assert.match(results, /Filters \(\$\{filterCount\}\)/);
assert.match(results, /Sort: \$\{sortLabel\}/);
assert.match(results, /activeMarketplaceFilterChips/);
assert.match(results, /marketplaceQuery\.data\?\.total \?\? 0/);
assert.match(results, /0 matching vehicles/);
assert.match(results, /CarUp will not substitute unrelated or fabricated inventory/);
assert.match(results, /if \(!savedMode\) return marketplaceQuery\.data\?\.listings \|\| \[\]/);

const endpoints = Object.fromEntries(TRADE_READ_AUTHORITIES.map((item) => [item.key, item.endpoint]));
assert.equal(endpoints.importOrders, '/api/diaspora/import-orders?limit=20');
assert.equal(endpoints.tradeProfile, '/api/diaspora/trade-profiles/me');
assert.equal(endpoints.containers, '/api/diaspora/containers?limit=20');
assert.equal(endpoints.containerSpace, '/api/diaspora/reservations?importOrderId=<authorized-order>');
assert.equal(endpoints.shipments, '/api/diaspora/shipments?importOrderId=<authorized-order>');
assert.equal(endpoints.documents, '/api/diaspora/documents?importOrderId=<authorized-order>');
assert.match(trade, /getTradeGatewaySnapshot/);
assert.match(trade, /Trade gateway/);
assert.match(trade, /Start Import/);
assert.match(trade, /CarUp will not show example orders, containers, shipments, documents or counts/);
assert.match(tradeApi, /state: 'unavailable'/);
assert.match(tradeApi, /readOrderScopedCollection/);
assert.match(tradeApi, /importOrderId/);
assert.doesNotMatch(trade + tradeApi, /mock|demo order|fake count/i);
assert.doesNotMatch(trade, /AccountScreen|Your CarUp account/);

assert.ok(verify.includes('Check CarUp record'));
assert.ok(verify.includes('does not prove ownership or government registration'));

console.log('native-r5-r4-discovery-navigation.test: PASS');
