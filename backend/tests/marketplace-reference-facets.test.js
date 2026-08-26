import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  summaryMatchesLocationFacet,
  summaryMatchesTextFacet,
} from '../services/marketplace/listingSummaryService.js';

function recorded(value) {
  return { value, state: 'recorded', source: 'seller_asserted' };
}

function notRecorded(value = null) {
  return { value, state: 'not_recorded', source: null };
}

test('fuel and transmission facets are case-insensitive exact matches over canonical summary fields', () => {
  const summary = { fuel_type: 'Diesel', transmission: 'Automatic' };

  assert.equal(summaryMatchesTextFacet(summary, 'diesel', 'fuel_type'), true);
  assert.equal(summaryMatchesTextFacet(summary, 'DIESEL', 'fuel_type'), true);
  assert.equal(summaryMatchesTextFacet(summary, 'Petrol', 'fuel_type'), false);
  assert.equal(summaryMatchesTextFacet(summary, 'automatic', 'transmission'), true);
  assert.equal(summaryMatchesTextFacet(summary, 'Manual', 'transmission'), false);
});

test('text facets fail closed for missing business facts and bypass only for empty/all filters', () => {
  assert.equal(summaryMatchesTextFacet({}, 'Diesel', 'fuel_type'), false);
  assert.equal(summaryMatchesTextFacet({ fuel_type: null }, 'Diesel', 'fuel_type'), false);
  assert.equal(summaryMatchesTextFacet({ fuel_type: '' }, 'Diesel', 'fuel_type'), false);

  assert.equal(summaryMatchesTextFacet({}, '', 'fuel_type'), true);
  assert.equal(summaryMatchesTextFacet({}, 'All', 'fuel_type'), true);
  assert.equal(summaryMatchesTextFacet({}, undefined, 'fuel_type'), true);
});

test('location facet matches only recorded canonical location facts', () => {
  const summary = {
    location: 'Harare, Harare, Zimbabwe',
    location_state: 'recorded',
    claims: {
      location: {
        city: recorded('Harare'),
        province: recorded('Harare'),
        country: recorded('Zimbabwe'),
      },
    },
  };

  assert.equal(summaryMatchesLocationFacet(summary, 'Harare'), true);
  assert.equal(summaryMatchesLocationFacet(summary, 'Zimbabwe'), true);
  assert.equal(summaryMatchesLocationFacet(summary, 'harare, harare, zimbabwe'), true);
  assert.equal(summaryMatchesLocationFacet(summary, 'Bulawayo'), false);
});

test('location facet never converts withheld or unrecorded data into a discoverable public claim', () => {
  const withheld = {
    location: 'Harare',
    location_state: 'withheld',
    claims: { location: { city: recorded('Harare') } },
  };
  const unrecorded = {
    location: 'Harare',
    location_state: 'not_recorded',
    claims: { location: { city: recorded('Harare') } },
  };
  const mixed = {
    location: 'Zimbabwe',
    location_state: 'recorded',
    claims: {
      location: {
        city: notRecorded('Harare'),
        country: recorded('Zimbabwe'),
      },
    },
  };

  assert.equal(summaryMatchesLocationFacet(withheld, 'Harare'), false);
  assert.equal(summaryMatchesLocationFacet(unrecorded, 'Harare'), false);
  assert.equal(summaryMatchesLocationFacet(mixed, 'Harare'), false);
  assert.equal(summaryMatchesLocationFacet(mixed, 'Zimbabwe'), true);
});

test('location facet bypasses only when no location filter is requested', () => {
  assert.equal(summaryMatchesLocationFacet({}, ''), true);
  assert.equal(summaryMatchesLocationFacet({}, 'All'), true);
  assert.equal(summaryMatchesLocationFacet({}, undefined), true);
});

test('buyer-facing canonical facets execute before sorting and result limiting', () => {
  const source = readFileSync(
    new URL('../services/marketplace/listingSummaryService.js', import.meta.url),
    'utf8',
  );

  const listStart = source.indexOf('export async function listMarketplaceListings');
  const locationFilter = source.indexOf('summaryMatchesLocationFacet(summary, params.location)', listStart);
  const fuelFilter = source.indexOf("summaryMatchesTextFacet(summary, params.fuel, 'fuel_type')", listStart);
  const transmissionFilter = source.indexOf("summaryMatchesTextFacet(summary, params.transmission, 'transmission')", listStart);
  const sort = source.indexOf('const sorted = sortSummaries(filtered, params.sort);', listStart);
  const slice = source.indexOf('listings: sorted.slice(0, limit)', listStart);

  assert.ok(listStart >= 0, 'listMarketplaceListings source must exist');
  assert.ok(locationFilter > listStart, 'location facet must be applied by the canonical listing path');
  assert.ok(fuelFilter > listStart, 'fuel facet must be applied by the canonical listing path');
  assert.ok(transmissionFilter > listStart, 'transmission facet must be applied by the canonical listing path');
  assert.ok(sort > transmissionFilter, 'all buyer facets must execute before sorting');
  assert.ok(slice > sort, 'result limiting must occur only after facet filtering and sorting');
});
