import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertMarketplacePassportParity,
  marketplacePassportParity,
} from '../services/passport/passportMarketplaceConvergence.js';

function clone(value) {
  return structuredClone(value);
}

function pair() {
  const canonicalTrust = {
    score: 52,
    band: 'moderate',
    evaluation_state: 'evaluated',
    confidence: 'medium',
    calculation_version: 'trust-v1',
    evaluated_at: '2026-08-28T10:00:00Z',
  };
  const claims = {
    specification: {
      mileage: { value: 0, state: 'recorded', source: null },
    },
    publication: {
      publication_status: { value: 'published', state: 'recorded', source: null },
    },
  };

  return {
    marketplace: {
      vin: 'VIN-1',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      color: 'White',
      mileage: 0,
      price: 24000,
      currency: 'USD',
      publication_status: 'published',
      listing_status: 'Available',
      claims: clone(claims),
      canonical_trust: clone(canonicalTrust),
      public_evidence: [{ id: 'ev-1' }],
    },
    passport: {
      vin: 'VIN-1',
      identity: {
        data: { make: 'Toyota', model: 'Hilux', year: 2022, color: 'White' },
      },
      listing: {
        data: {
          mileage: 0,
          price: 24000,
          currency: 'USD',
          publication_status: 'published',
          listing_status: 'Available',
          claims: clone(claims),
          transaction_actions: ['inquiry'],
        },
      },
      trust: { data: clone(canonicalTrust) },
      evidence: { data: { items: [{ evidence_id: 'ev-1' }] } },
    },
  };
}

test('V10: matching Marketplace and Passport projections pass', () => {
  assert.equal(assertMarketplacePassportParity(pair()).pass, true);
});

test('V10: genuine zero mileage stays equal to zero, not unknown', () => {
  const input = pair();
  assert.equal(marketplacePassportParity(input).pass, true);

  input.passport.listing.data.mileage = null;
  const result = marketplacePassportParity(input);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.path === 'listing.mileage'));
});

test('V10: Trust score equality is insufficient when version/state differ', () => {
  const input = pair();
  input.passport.trust.data.calculation_version = 'different-rules';
  const result = marketplacePassportParity(input);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.code === 'trust_mismatch'));
});

test('V10: seller/listing claim state mismatch fails even if rendered value is null', () => {
  const input = pair();
  input.passport.listing.data.claims.specification.mileage = {
    value: 0,
    state: 'not_recorded',
    source: null,
  };
  const result = marketplacePassportParity(input);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.path === 'claims.specification.mileage'));
});

test('V10: public evidence identity must converge exactly', () => {
  const input = pair();
  input.passport.evidence.data.items = [{ evidence_id: 'ev-2' }];
  const result = marketplacePassportParity(input);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.code === 'evidence_mismatch'));
});

test('V10: a Passport-only/unpublished vehicle cannot expose Marketplace transaction actions', () => {
  const input = pair();
  input.marketplace.publication_status = 'draft';
  input.marketplace.public_status = 'not_public';
  input.passport.listing.data.publication_status = 'draft';
  input.passport.listing.data.claims.publication.publication_status = {
    value: 'draft',
    state: 'recorded',
    source: null,
  };

  const result = marketplacePassportParity(input);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.code === 'passport_only_vehicle_has_marketplace_actions'));
});

test('V10 anti-fork: convergence module owns no projection, route or database authority', () => {
  const src = readFileSync('backend/services/passport/passportMarketplaceConvergence.js', 'utf8');
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /buildMarketplaceListingSummary|toPublicVehicle|toListingClaims/);
  assert.doesNotMatch(src, /calculateVehicleTrustScore|refreshCanonicalTrust/);
});
