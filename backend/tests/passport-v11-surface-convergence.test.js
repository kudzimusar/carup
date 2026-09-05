import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertCrossSurfacePassportConvergence,
  crossSurfacePassportConvergence,
} from '../services/passport/passportSurfaceConvergence.js';

function anchor() {
  return {
    canonical: {
      vin: 'VIN-1',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      color: 'White',
      mileage: 0,
      publication_status: 'published',
      listing_status: 'Available',
    },
    trust: {
      canonical: {
        score: 52,
        band: 'moderate',
        evaluation_state: 'evaluated',
        confidence: 'medium',
        calculation_version: 'trust-v1',
        evaluated_at: '2026-08-28T10:00:00Z',
      },
    },
  };
}

test('V11: canonical blocks agree across Seller, Verify, Marketplace and Home', () => {
  const passport = anchor();
  const result = assertCrossSurfacePassportConvergence({
    passport,
    seller: {
      canonical: { vin: 'VIN-1', make: 'Toyota', mileage: 0 },
      trust: passport.trust,
    },
    verify: {
      canonical: { vin: 'VIN-1', year: 2022 },
      trust: passport.trust,
    },
    marketplace: {
      canonical: { vin: 'VIN-1', publication_status: 'published' },
      trust: passport.trust,
    },
    home: {
      canonical: { vin: 'VIN-1', make: 'Toyota', model: 'Hilux' },
    },
  });

  assert.equal(result.pass, true);
});

test('V11: genuine zero mileage cannot become null on a sibling surface', () => {
  const result = crossSurfacePassportConvergence({
    passport: anchor(),
    marketplace: {
      canonical: { vin: 'VIN-1', mileage: null },
    },
  });

  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.field === 'mileage'));
});

test('V11: same Trust score with a different evaluation state fails', () => {
  const passport = anchor();
  const verify = structuredClone(passport);
  verify.trust.canonical.evaluation_state = 'stale';

  const result = crossSurfacePassportConvergence({ passport, verify });
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.field === 'trust.evaluation_state'));
});

test('V11: seller statement may differ from canonical truth only when explicitly typed as statement', () => {
  const passport = anchor();
  const seller = {
    canonical: { vin: 'VIN-1', year: 2022 },
    seller_statements: {
      year: {
        value: 2020,
        authority: 'seller_statement',
        state: 'recorded',
      },
    },
  };

  assert.equal(crossSurfacePassportConvergence({ passport, seller }).pass, true);

  seller.seller_statements.year.authority = 'canonical';
  const bad = crossSurfacePassportConvergence({ passport, seller });
  assert.equal(bad.pass, false);
  assert.ok(bad.issues.some((item) => item.code === 'seller_statement_missing_authority'));
});

test('V11: seller-stated value cannot be placed in the canonical block to hide a discrepancy', () => {
  const result = crossSurfacePassportConvergence({
    passport: anchor(),
    seller: {
      canonical: { vin: 'VIN-1', year: 2020 },
      seller_statements: {
        year: { value: 2020, authority: 'seller_statement' },
      },
    },
  });

  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.field === 'year'));
});

test('V11: surfaces may omit canonical fields they do not render', () => {
  const result = crossSurfacePassportConvergence({
    passport: anchor(),
    home: { canonical: { vin: 'VIN-1' } },
  });
  assert.equal(result.pass, true);
});

test('V11 anti-fork: validator owns no surface projection or database path', () => {
  const src = readFileSync('backend/services/passport/passportSurfaceConvergence.js', 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*(?:Landing|VehicleSearch|VehicleDetail|Seller|marketplaceListingDetailService|listingSummaryService)[^'"]*['"]/i);
  assert.doesNotMatch(src, /toPublicVehicle\s*\(|toListingClaims\s*\(|buildMarketplaceListingSummary\s*\(/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /calculateVehicleTrustScore|refreshCanonicalTrust/);
});
