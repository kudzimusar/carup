function sameScalar(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  return String(left) === String(right);
}

function issue(path, marketplace, passport, code = 'mismatch') {
  return { path, code, marketplace: marketplace ?? null, passport: passport ?? null };
}

function compareScalar(issues, path, left, right) {
  if (!sameScalar(left, right)) issues.push(issue(path, left, right));
}

function comparableClaim(leaf) {
  if (!leaf || typeof leaf !== 'object') return { value: null, state: 'not_recorded', source: null };
  return {
    value: leaf.value ?? null,
    state: leaf.state ?? null,
    source: leaf.source ?? null,
  };
}

function flattenClaims(claims = {}) {
  const out = {};
  for (const [blockName, block] of Object.entries(claims || {})) {
    if (!block || typeof block !== 'object') continue;
    for (const [fieldName, leaf] of Object.entries(block)) {
      out[`${blockName}.${fieldName}`] = comparableClaim(leaf);
    }
  }
  return out;
}

function compareClaims(issues, marketplaceClaims, passportClaims) {
  const left = flattenClaims(marketplaceClaims);
  const right = flattenClaims(passportClaims);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = left[key] ?? comparableClaim(null);
    const b = right[key] ?? comparableClaim(null);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      issues.push(issue(`claims.${key}`, a, b, 'claim_mismatch'));
    }
  }
}

function trustComparable(trust) {
  if (!trust) return null;
  return {
    score: trust.score ?? null,
    band: trust.band ?? null,
    evaluation_state: trust.evaluation_state ?? null,
    confidence: trust.confidence ?? null,
    calculation_version: trust.calculation_version ?? null,
    evaluated_at: trust.evaluated_at ?? null,
  };
}

function evidenceIds(evidence) {
  const rows = evidence?.items ?? evidence ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => row?.evidence_id ?? row?.id ?? null)
    .filter(Boolean)
    .map(String)
    .sort();
}

/**
 * Compare the normalized public buying surface with the normalized public
 * Passport projection. This is a gate, not another projection authority.
 */
export function marketplacePassportParity({
  marketplace,
  passport,
} = {}) {
  if (!marketplace || !passport) throw new Error('Marketplace/Passport parity requires both projections');

  const issues = [];

  compareScalar(issues, 'vin', marketplace.vin, passport.vin);

  const passportIdentity = passport.identity?.data ?? passport.identity ?? {};
  for (const field of ['make', 'model', 'year', 'color']) {
    compareScalar(issues, `identity.${field}`, marketplace[field], passportIdentity[field]);
  }

  const passportListing = passport.listing?.data ?? passport.listing ?? {};
  compareScalar(issues, 'listing.mileage', marketplace.mileage, passportListing.mileage);
  compareScalar(issues, 'listing.price', marketplace.price, passportListing.price);
  compareScalar(issues, 'listing.currency', marketplace.currency, passportListing.currency);
  compareScalar(
    issues,
    'listing.publication_status',
    marketplace.publication_status,
    passportListing.publication_status,
  );
  compareScalar(
    issues,
    'listing.listing_status',
    marketplace.listing_status ?? marketplace.status,
    passportListing.listing_status,
  );

  compareClaims(issues, marketplace.claims, passportListing.claims);

  const marketTrust = trustComparable(
    marketplace.canonical_trust
      ?? marketplace.trust_summary?.canonical
      ?? marketplace.trust_summary?.trust
      ?? marketplace.trust,
  );
  const passportTrust = trustComparable(
    passport.trust?.data?.canonical
      ?? passport.trust?.data
      ?? passport.trust?.canonical
      ?? passport.trust,
  );
  if (JSON.stringify(marketTrust) !== JSON.stringify(passportTrust)) {
    issues.push(issue('trust', marketTrust, passportTrust, 'trust_mismatch'));
  }

  const marketEvidenceIds = evidenceIds(marketplace.public_evidence ?? marketplace.evidence);
  const passportEvidenceIds = evidenceIds(passport.evidence?.data ?? passport.evidence);
  if (JSON.stringify(marketEvidenceIds) !== JSON.stringify(passportEvidenceIds)) {
    issues.push(issue('public_evidence', marketEvidenceIds, passportEvidenceIds, 'evidence_mismatch'));
  }

  const marketplacePubliclyListed =
    marketplace.publication_status === 'published'
    || marketplace.public_status === 'public';

  const transactionActions = Array.isArray(passportListing.transaction_actions)
    ? passportListing.transaction_actions
    : [];

  if (!marketplacePubliclyListed && transactionActions.length > 0) {
    issues.push(issue(
      'listing.transaction_actions',
      [],
      transactionActions,
      'passport_only_vehicle_has_marketplace_actions',
    ));
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}

export function assertMarketplacePassportParity(input) {
  const result = marketplacePassportParity(input);
  if (!result.pass) {
    const paths = result.issues.map((item) => item.path).join(', ');
    throw new Error(`Marketplace/Passport convergence failed: ${paths}`);
  }
  return result;
}

export default {
  marketplacePassportParity,
  assertMarketplacePassportParity,
};
