const CANONICAL_FIELDS = Object.freeze([
  'vin',
  'make',
  'model',
  'year',
  'color',
  'mileage',
  'fuel_type',
  'transmission',
  'drivetrain',
  'publication_status',
  'listing_status',
]);

const TRUST_FIELDS = Object.freeze([
  'score',
  'band',
  'evaluation_state',
  'confidence',
  'calculation_version',
  'evaluated_at',
]);

function scalar(value) {
  return value === undefined ? null : value;
}

function compareValue(issues, surface, field, expected, actual, code = 'canonical_mismatch') {
  const a = scalar(expected);
  const b = scalar(actual);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    issues.push({
      surface,
      field,
      code,
      expected: a,
      actual: b,
    });
  }
}

function normalizeCanonical(snapshot = {}) {
  const source = snapshot.canonical ?? snapshot;
  return Object.fromEntries(
    CANONICAL_FIELDS.map((field) => [field, scalar(source?.[field])]),
  );
}

function normalizeTrust(snapshot = {}) {
  const source = snapshot.trust?.canonical ?? snapshot.trust ?? null;
  if (!source) return null;
  return Object.fromEntries(
    TRUST_FIELDS.map((field) => [field, scalar(source?.[field])]),
  );
}

function validateSellerStatements(snapshot = {}, surface) {
  const statements = snapshot.seller_statements ?? null;
  if (!statements) return [];
  if (typeof statements !== 'object' || Array.isArray(statements)) {
    throw new Error(`${surface} seller_statements must be an object`);
  }

  const issues = [];
  for (const [field, statement] of Object.entries(statements)) {
    if (!statement || typeof statement !== 'object') {
      issues.push({
        surface,
        field: `seller_statements.${field}`,
        code: 'untyped_seller_statement',
      });
      continue;
    }
    if (statement.authority !== 'seller_statement') {
      issues.push({
        surface,
        field: `seller_statements.${field}.authority`,
        code: 'seller_statement_missing_authority',
        expected: 'seller_statement',
        actual: statement.authority ?? null,
      });
    }
  }
  return issues;
}

export function crossSurfacePassportConvergence({
  passport,
  seller = null,
  verify = null,
  marketplace = null,
  home = null,
} = {}) {
  if (!passport) throw new Error('V11 convergence requires Passport anchor');

  const anchorCanonical = normalizeCanonical(passport);
  const anchorTrust = normalizeTrust(passport);
  const issues = [];

  const surfaces = { seller, verify, marketplace, home };
  for (const [name, snapshot] of Object.entries(surfaces)) {
    if (!snapshot) continue;

    const canonical = normalizeCanonical(snapshot);
    for (const field of CANONICAL_FIELDS) {
      // A surface can omit a field it does not render; it may not state a
      // different canonical value. Explicit null is still a statement.
      const rawSource = snapshot.canonical ?? snapshot;
      if (!(field in (rawSource || {}))) continue;
      compareValue(issues, name, field, anchorCanonical[field], canonical[field]);
    }

    const trust = normalizeTrust(snapshot);
    if (trust) {
      if (!anchorTrust) {
        issues.push({
          surface: name,
          field: 'trust',
          code: 'surface_has_trust_without_passport_anchor',
        });
      } else {
        for (const field of TRUST_FIELDS) {
          compareValue(
            issues,
            name,
            `trust.${field}`,
            anchorTrust[field],
            trust[field],
            'trust_mismatch',
          );
        }
      }
    }

    issues.push(...validateSellerStatements(snapshot, name));
  }

  return {
    pass: issues.length === 0,
    anchor: {
      canonical: anchorCanonical,
      trust: anchorTrust,
    },
    issues,
  };
}

export function assertCrossSurfacePassportConvergence(input) {
  const result = crossSurfacePassportConvergence(input);
  if (!result.pass) {
    throw new Error(
      `Seller/Passport/Verify/Marketplace/Home convergence failed: ${result.issues
        .map((item) => `${item.surface}:${item.field}`)
        .join(', ')}`,
    );
  }
  return result;
}

export default {
  crossSurfacePassportConvergence,
  assertCrossSurfacePassportConvergence,
};
