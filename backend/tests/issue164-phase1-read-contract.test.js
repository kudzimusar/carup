/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 1 permanent guard.
 *
 * Phase 0 built the canonical projection. Phase 1 converges the public reads onto
 * it and makes "unknown" a value the contract can express. This suite holds both.
 *
 * The guarantees, and the regression each test is watching for:
 *
 *   1. ONE list. The audit found three vehicle allow-lists. PUBLIC_VEHICLE_COLUMNS
 *      is now an alias of the canonical select rather than a second hand-kept
 *      list, so the classic failure — someone adds a column to one list and not
 *      the other, and two endpoints disagree about what is public — is no longer
 *      expressible. LISTING_SELECT_COLUMNS survives into Phase 2 and is held to
 *      the weaker but checkable rule that it cannot publish a field the canonical
 *      contract does not name.
 *   2. No fourth list. A new exported vehicle column list anywhere under
 *      backend/services or backend/utils is a fork of the contract.
 *   3. Anonymous route reads select through the canonical list. A `select('*')`
 *      on an anonymous surface is only tolerated where the response is projected
 *      at the boundary, and each such site is registered here by name.
 *   4. Unknown is representable and never fabricated. The primitive must not turn
 *      a missing value into a plausible one, must not turn a real `0`/`false`
 *      into a missing one, and must not let "withheld" collapse into
 *      "not recorded" (that is absence-as-proof, principle 9).
 *
 * TESTING APPROACH — the source scan. backend/db/supabase.js throws at import
 * time without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, so route and service
 * modules cannot be imported in a hermetic run. The scan therefore reads source
 * text, as backend/tests/db-compat-legacy-scopes.test.js and the Phase 0 suite
 * do. It is deliberately formatting-insensitive: selects are extracted with a
 * quote-aware paren walker rather than a line regex, and column lists are
 * compared as token SETS, so reordering, re-indenting or wrapping a select
 * cannot break it and cannot hide a change either.
 *
 * REACHABILITY HEURISTIC, stated plainly because it is the scan's one soft edge:
 * a vehicle read is treated as anonymously reachable when it sits inside the
 * span of a route registration that carries no auth middleware. Helper functions
 * declared between two route registrations inherit the earlier route's verdict.
 * That over-includes (a helper in anonymous territory called only from an
 * authenticated route is still checked) more readily than it under-includes, and
 * the classifier is proved against a synthetic fixture below so a silently
 * vacuous scan fails rather than passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_VEHICLE_FIELDS,
  PRIVATE_VEHICLE_FIELDS,
  OWNER_ADDITIONAL_VEHICLE_FIELDS,
  PUBLIC_VEHICLE_SELECT,
  toPublicVehicle,
  FIELD_STATES,
  FIELD_STATE_VALUES,
  isFieldState,
  isRecordedValue,
  fieldState,
  statedValue,
} from '../utils/publicVehicleProjection.js';

import { PUBLIC_VEHICLE_COLUMNS } from '../utils/vehicleStatus.js';
import { LISTING_SELECT_COLUMNS } from '../services/marketplace/listingSummaryService.js';

const BACKEND = fileURLToPath(new URL('..', import.meta.url));

const SERVER_JS = path.join(BACKEND, 'server.js');
const ROUTES_DIR = path.join(BACKEND, 'routes');
const SERVICES_DIR = path.join(BACKEND, 'services');
const UTILS_DIR = path.join(BACKEND, 'utils');

/**
 * The 24 columns PUBLIC_VEHICLE_COLUMNS named before Phase 1 aliased it. Restated
 * here so the convergence is provably a WIDENING within the already-public set:
 * if a future edit to the canonical list drops one of these, /api/vehicles/saved
 * silently stops returning it and this test says which one.
 */
const LEGACY_PUBLIC_VEHICLE_COLUMNS = [
  'vin', 'make', 'model', 'generation', 'trim', 'year', 'color', 'mileage',
  'fuel_type', 'drivetrain', 'transmission', 'import_source', 'duty_paid',
  'police_verified', 'status', 'trust_score', 'price', 'currency', 'created_at',
  'registration_country', 'current_seller_type', 'passport_verified',
  'vehicle_condition_category', 'publication_status',
];

/**
 * Columns whose presence in a select means the read is building something for a
 * shopper to look at. Three or more of them is the signature of a hand-rolled
 * public projection; one or two is a scope check or a single-fact lookup
 * (`select('vin')`, `select('mileage')`, `select('vin, make, price')`).
 */
const PRESENTATION_COLUMNS = [
  'make', 'model', 'year', 'trim', 'generation', 'color', 'mileage',
  'fuel_type', 'drivetrain', 'transmission', 'price', 'currency',
];
const HAND_ROLLED_THRESHOLD = 3;

/** Identifiers that ARE the contract. A select naming one of these is converged. */
const CANONICAL_SELECT_IDENTIFIERS = [
  'PUBLIC_VEHICLE_SELECT',
  'OWNER_VEHICLE_SELECT',
  'PUBLIC_VEHICLE_COLUMNS',
  'LISTING_SELECT_COLUMNS',
];

/**
 * Anonymous `select('*')` reads that are allowed because the row never leaves the
 * function unprojected. Registering a site is a deliberate act: a new anonymous
 * star select fails the scan until someone adds it here with a reason.
 *
 * Phase 2 converts these selects themselves — projecting at the boundary keeps
 * the response clean but still pulls engine/chassis/plate into process memory.
 */
const BOUNDARY_PROJECTED_STAR_READS = [
  {
    file: 'server.js',
    fn: 'buildVehiclePassport',
    projector: 'projectVehicle',
    why: 'passport composes over the raw row (trust, chain, timeline) and projects at the response boundary',
  },
];

/** Directories whose vehicle reads exist to serve the public marketplace surface. */
const PUBLIC_PROJECTION_SERVICE_DIRS = [
  path.join(SERVICES_DIR, 'marketplace'),
  path.join(SERVICES_DIR, 'recommendation'),
];

const AUTH_MIDDLEWARE = /authorizeRole|requirePartnerScope|requireAuth|authenticate\b|requireRole|verifyToken|requireAdmin|adminOnly/;

const ROUTE_REGISTRATION =
  /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]*)\2\s*,([\s\S]{0,240}?)(?:async\s*)?\(\s*(?:req|_req)\s*[,)]/g;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function jsFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Quote-aware balanced-paren reader: returns the argument text of a call. */
function callArguments(src, openParenIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  return null;
}

/** Column tokens of a literal select, embeds (`tenant:tenants(...)`) removed. */
function selectColumnTokens(selectArgs) {
  const literal = /^\s*(['"`])([\s\S]*?)\1/.exec(selectArgs);
  if (!literal) return null;
  return literal[2]
    .replace(/[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*\([^)]*\)/g, '')
    .replace(/[A-Za-z_$][\w$]*\s*\([^)]*\)/g, '')
    .replace(/\$\{[^}]*\}/g, '')
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);
}

function presentationColumnCount(tokens) {
  return PRESENTATION_COLUMNS.filter(column => tokens.includes(column)).length;
}

/**
 * Every `.from('vehicles')` read in `src`, with its select text, the enclosing
 * route (nearest preceding registration) and whether that route is anonymous.
 * Sites with no select — writes — are skipped.
 */
function scanVehicleReads(src, label) {
  const routes = [];
  ROUTE_REGISTRATION.lastIndex = 0;
  let match;
  while ((match = ROUTE_REGISTRATION.exec(src))) {
    routes.push({ idx: match.index, method: match[1], route: match[3], middleware: match[4] });
  }
  routes.forEach((route, i) => {
    route.end = i + 1 < routes.length ? routes[i + 1].idx : src.length;
    route.anonymous = !AUTH_MIDDLEWARE.test(route.middleware);
  });

  const reads = [];
  const fromRe = /\.from\(\s*(['"`])vehicles\1\s*\)/g;
  while ((match = fromRe.exec(src))) {
    const after = match.index + match[0].length;
    const selectIdx = src.indexOf('.select(', after);
    const nextFromIdx = src.indexOf('.from(', after);
    if (selectIdx === -1) continue;
    if (nextFromIdx !== -1 && nextFromIdx < selectIdx) continue; // a write, not a read

    const args = callArguments(src, selectIdx + '.select'.length) ?? '';
    if (/head\s*:\s*true/.test(args)) continue; // count-only: returns no rows

    const enclosing = routes.find(route => match.index >= route.idx && match.index < route.end) || null;
    reads.push({
      label,
      line: src.slice(0, match.index).split('\n').length,
      args: args.replace(/\s+/g, ' ').trim(),
      tokens: selectColumnTokens(args),
      canonical: CANONICAL_SELECT_IDENTIFIERS.some(id => new RegExp(`\\b${id}\\b`).test(args)),
      star: /^\s*(['"`])\s*\*\s*\1/.test(args),
      anonymous: Boolean(enclosing?.anonymous),
      route: enclosing ? `${enclosing.method.toUpperCase()} ${enclosing.route}` : '(module scope)',
    });
  }
  return reads;
}

function scanFiles(files) {
  return files.flatMap(file => scanVehicleReads(readFileSync(file, 'utf8'), path.relative(BACKEND, file)));
}

const ROUTE_LAYER_FILES = [SERVER_JS, ...jsFilesUnder(ROUTES_DIR)];
const routeLayerReads = scanFiles(ROUTE_LAYER_FILES);
const publicServiceReads = scanFiles(PUBLIC_PROJECTION_SERVICE_DIRS.flatMap(jsFilesUnder));

const describeSite = site =>
  `${site.label}:${site.line} (${site.route}) select(${site.args.slice(0, 120)})`;

// ---------------------------------------------------------------------------
// 1. The scanner is not vacuous
// ---------------------------------------------------------------------------

test('the scan reaches the real route and service layers', () => {
  assert.ok(ROUTE_LAYER_FILES.length > 1, 'expected server.js plus backend/routes/*.js');
  assert.ok(
    routeLayerReads.length >= 20,
    `expected the route layer to contain many vehicle reads, found ${routeLayerReads.length}`,
  );
  assert.ok(
    routeLayerReads.some(site => site.anonymous && site.canonical),
    'expected at least one anonymous route already reading through the canonical select',
  );
  assert.ok(
    publicServiceReads.length >= 5,
    `expected marketplace/recommendation vehicle reads, found ${publicServiceReads.length}`,
  );
});

test('the scan classifier detects a leaky anonymous read when one exists', () => {
  // If this fixture ever passes the classifier, every scan below is meaningless.
  const fixture = `
    app.get('/api/public/leak', async (req, res) => {
      const { data } = await supabase.from('vehicles').select('*').eq('vin', req.params.vin);
      res.json(data);
    });
    app.get('/api/public/handrolled', async (req, res) => {
      const { data } = await supabase
        .from('vehicles')
        .select('vin, make, model, year, plate_number, engine_number')
        .eq('vin', req.params.vin);
      res.json(data);
    });
    app.get('/api/private/ok', authorizeRole(['admin']), async (req, res) => {
      const { data } = await supabase.from('vehicles').select('*');
      res.json(data);
    });
  `;
  const found = scanVehicleReads(fixture, 'fixture');
  assert.equal(found.length, 3, 'the scanner must see all three reads');

  const [leak, handRolled, guarded] = found;
  assert.ok(leak.anonymous && leak.star, 'anonymous select(*) must be flagged');
  assert.ok(
    handRolled.anonymous && presentationColumnCount(handRolled.tokens) >= HAND_ROLLED_THRESHOLD,
    'an anonymous hand-rolled public column list must be flagged',
  );
  assert.equal(guarded.anonymous, false, 'an authorizeRole()-guarded read must not be flagged anonymous');
});

// ---------------------------------------------------------------------------
// 2. One list — PUBLIC_VEHICLE_COLUMNS cannot drift from the canonical select
// ---------------------------------------------------------------------------

test('PUBLIC_VEHICLE_COLUMNS is the canonical select, not a second list', () => {
  assert.equal(
    PUBLIC_VEHICLE_COLUMNS,
    PUBLIC_VEHICLE_SELECT,
    'PUBLIC_VEHICLE_COLUMNS must be an alias of PUBLIC_VEHICLE_SELECT so the two cannot disagree',
  );
});

test('vehicleStatus.js declares no vehicle column list of its own', () => {
  const src = readFileSync(path.join(UTILS_DIR, 'vehicleStatus.js'), 'utf8');
  assert.match(
    src,
    /import\s*\{[^}]*PUBLIC_VEHICLE_SELECT[^}]*\}\s*from\s*'\.\/publicVehicleProjection\.js'/,
    'the legacy alias must be derived from the canonical module',
  );
  const declaration = /export\s+const\s+PUBLIC_VEHICLE_COLUMNS\s*=\s*([\s\S]*?);/.exec(src);
  assert.ok(declaration, 'PUBLIC_VEHICLE_COLUMNS must still be exported — server.js and its pin depend on it');
  assert.ok(
    !declaration[1].includes('['),
    `PUBLIC_VEHICLE_COLUMNS must not restate a column array: ${declaration[1].slice(0, 80)}`,
  );
  assert.match(
    src,
    /@deprecated/,
    'the legacy alias must be marked deprecated in favour of PUBLIC_VEHICLE_SELECT',
  );
});

test('aliasing PUBLIC_VEHICLE_COLUMNS widened the legacy list and dropped nothing', () => {
  const aliased = PUBLIC_VEHICLE_COLUMNS.split(',').map(token => token.trim()).filter(Boolean);
  const dropped = LEGACY_PUBLIC_VEHICLE_COLUMNS.filter(column => !aliased.includes(column));
  assert.deepEqual(
    dropped,
    [],
    `the canonical list must still name every historically public column: missing ${dropped.join(', ')}`,
  );
  const leaked = aliased.filter(column => PRIVATE_VEHICLE_FIELDS.includes(column));
  assert.deepEqual(leaked, [], `PUBLIC_VEHICLE_COLUMNS must fetch no private column: ${leaked.join(', ')}`);
});

test('no fourth vehicle allow-list exists under backend/utils or backend/services', () => {
  const declared = [];
  const exportedList =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?(\[[\s\S]*?\]|`[\s\S]*?`)/g;
  for (const file of [...jsFilesUnder(UTILS_DIR), ...jsFilesUnder(SERVICES_DIR)]) {
    const src = readFileSync(file, 'utf8');
    exportedList.lastIndex = 0;
    let match;
    while ((match = exportedList.exec(src))) {
      const tokens = match[2].match(/[a-z_][a-z0-9_]*/gi) || [];
      if (presentationColumnCount(tokens) >= HAND_ROLLED_THRESHOLD) {
        declared.push(`${match[1]} (${path.relative(BACKEND, file)})`);
      }
    }
  }
  assert.deepEqual(
    declared.sort(),
    [
      'LISTING_SELECT_COLUMNS (services/marketplace/listingSummaryService.js)',
      'PUBLIC_VEHICLE_FIELDS (utils/publicVehicleProjection.js)',
    ],
    'the canonical list and the (Phase 2) marketplace list are the only vehicle allow-lists allowed to exist',
  );
});

test('LISTING_SELECT_COLUMNS cannot publish a field the canonical contract does not name', () => {
  // owner_id/tenant_id are fetched for fixture filtering and seller derivation and are
  // documented as never echoed; every other column must be one the contract already names.
  const DERIVATION_ONLY = ['owner_id', 'tenant_id'];
  const permitted = new Set([
    ...PUBLIC_VEHICLE_FIELDS,
    ...OWNER_ADDITIONAL_VEHICLE_FIELDS,
    ...DERIVATION_ONLY,
  ]);
  const tokens = selectColumnTokens(`'${LISTING_SELECT_COLUMNS}'`);
  const unknown = tokens.filter(token => !permitted.has(token));
  assert.deepEqual(
    unknown,
    [],
    `LISTING_SELECT_COLUMNS names columns outside the canonical contract: ${unknown.join(', ')}`,
  );

  const registryIdentifiers = PRIVATE_VEHICLE_FIELDS.filter(field => !DERIVATION_ONLY.includes(field));
  const leaked = tokens.filter(token => registryIdentifiers.includes(token));
  assert.deepEqual(leaked, [], `LISTING_SELECT_COLUMNS must fetch no registry identifier: ${leaked.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. Public reads select through the canonical list
// ---------------------------------------------------------------------------

test('the recommendation service selects candidates through the canonical projection', () => {
  const src = readFileSync(
    path.join(SERVICES_DIR, 'recommendation', 'recommendationService.js'),
    'utf8',
  );
  assert.match(
    src,
    /import\s*\{[^}]*PUBLIC_VEHICLE_SELECT[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/publicVehicleProjection\.js'/,
    'recommendations must consume the canonical contract directly, not the legacy alias',
  );
  assert.ok(
    !/\bPUBLIC_VEHICLE_COLUMNS\b/.test(src),
    'the deprecated alias must no longer appear in the recommendation service',
  );
  assert.match(src, /\.select\(PUBLIC_VEHICLE_SELECT\)/, 'candidate rows must be selected through the canonical list');
});

test('every anonymously reachable vehicle read selects through the canonical list', () => {
  const offenders = routeLayerReads
    .filter(site => site.anonymous && !site.canonical && !site.star)
    .filter(site => site.tokens === null || presentationColumnCount(site.tokens) >= HAND_ROLLED_THRESHOLD);

  assert.deepEqual(
    offenders.map(describeSite),
    [],
    'an anonymous route hand-rolls its own vehicle column list instead of using PUBLIC_VEHICLE_SELECT — '
    + `fix by importing it from backend/utils/publicVehicleProjection.js: ${offenders.map(describeSite).join(' | ')}`,
  );
});

test('anonymous select(*) vehicle reads are exactly the registered boundary-projected ones', () => {
  const stars = routeLayerReads.filter(site => site.anonymous && site.star);
  assert.equal(
    stars.length,
    BOUNDARY_PROJECTED_STAR_READS.length,
    'an anonymous route reads select(*) on vehicles without being registered as boundary-projected — '
    + `register it with a reason or narrow the select: ${stars.map(describeSite).join(' | ')}`,
  );

  for (const entry of BOUNDARY_PROJECTED_STAR_READS) {
    const src = readFileSync(path.join(BACKEND, entry.file), 'utf8');
    assert.ok(
      new RegExp(`function\\s+${entry.fn}\\s*\\(`).test(src),
      `${entry.file} must still declare ${entry.fn}; the star-select register is stale`,
    );
    assert.ok(
      new RegExp(`\\b${entry.projector}\\s*\\(`).test(src),
      `${entry.file} must project the raw row through ${entry.projector}() before responding`,
    );
    assert.ok(
      stars.some(site => site.label === entry.file),
      `${entry.file} no longer has the registered anonymous select(*); remove the stale register entry`,
    );
  }
});

test('marketplace and recommendation vehicle reads never select(*) and never hand-roll a public list', () => {
  const stars = publicServiceReads.filter(site => site.star);
  assert.deepEqual(
    stars.map(describeSite),
    [],
    `a public projection service reads select(*) on vehicles: ${stars.map(describeSite).join(' | ')}`,
  );

  const handRolled = publicServiceReads
    .filter(site => !site.canonical)
    .filter(site => site.tokens === null || presentationColumnCount(site.tokens) >= HAND_ROLLED_THRESHOLD);
  assert.deepEqual(
    handRolled.map(describeSite),
    [],
    'a public projection service hand-rolls a vehicle column list instead of using the canonical select: '
    + handRolled.map(describeSite).join(' | '),
  );
});

// ---------------------------------------------------------------------------
// 4. Unknown stays unknown
// ---------------------------------------------------------------------------

test('the field-state vocabulary is closed', () => {
  assert.deepEqual(
    [...FIELD_STATE_VALUES].sort(),
    ['not_applicable', 'not_recorded', 'recorded', 'withheld'],
  );
  assert.ok(Object.isFrozen(FIELD_STATES) && Object.isFrozen(FIELD_STATE_VALUES));
  for (const state of FIELD_STATE_VALUES) assert.ok(isFieldState(state));
  for (const notAState of ['unknown', 'null', 'RECORDED', '', null, undefined, 0]) {
    assert.equal(isFieldState(notAState), false, `${String(notAState)} must not pass as a field state`);
  }
});

test('a missing value is not_recorded, and carries no substitute value', () => {
  for (const missing of [null, undefined, '', '   ', Number.NaN]) {
    assert.equal(isRecordedValue(missing), false, `${String(missing)} must not count as recorded`);
    assert.equal(fieldState(missing), FIELD_STATES.NOT_RECORDED);
    assert.deepEqual(statedValue(missing), { value: null, state: FIELD_STATES.NOT_RECORDED });
  }
});

test('a real zero or false is a recorded fact, not a missing value', () => {
  // The inverse fabrication: reporting a genuine 0 km or duty_paid=false as unknown.
  for (const recorded of [0, false, -0, 'Petrol', { id: 1 }, []]) {
    assert.equal(isRecordedValue(recorded), true, `${String(recorded)} must count as recorded`);
    assert.equal(fieldState(recorded), FIELD_STATES.RECORDED);
    assert.deepEqual(statedValue(recorded), { value: recorded, state: FIELD_STATES.RECORDED });
  }
});

test('withheld does not collapse into not_recorded, present or absent', () => {
  // Principle 9: an audience that may not see a field must not learn from the
  // response whether the field is populated.
  assert.equal(fieldState('AEZ1234', { withheld: true }), FIELD_STATES.WITHHELD);
  assert.equal(fieldState(null, { withheld: true }), FIELD_STATES.WITHHELD);
  assert.deepEqual(
    statedValue('AEZ1234', { withheld: true }),
    { value: null, state: FIELD_STATES.WITHHELD },
    'a withheld field must never carry its value',
  );
  assert.deepEqual(
    statedValue('AEZ1234', { withheld: true }),
    statedValue(null, { withheld: true }),
    'a withheld field must look identical whether or not a value exists',
  );
});

test('not_applicable outranks withheld and both outrank the value', () => {
  assert.equal(fieldState('x', { notApplicable: true }), FIELD_STATES.NOT_APPLICABLE);
  assert.equal(
    fieldState('x', { withheld: true, notApplicable: true }),
    FIELD_STATES.NOT_APPLICABLE,
    'there is nothing to withhold about a field that cannot apply',
  );
  assert.deepEqual(statedValue('x', { notApplicable: true }), { value: null, state: FIELD_STATES.NOT_APPLICABLE });
});

test('statedValue never yields a plausible default for a non-recorded field', () => {
  const plausibleDefaults = ['White', 'Petrol', 'RWD', 'Automatic', 0, 50, 80, false, 'Zimbabwe', 'ZW'];
  for (const state of FIELD_STATE_VALUES.filter(s => s !== FIELD_STATES.RECORDED)) {
    const options = state === FIELD_STATES.WITHHELD
      ? { withheld: true }
      : state === FIELD_STATES.NOT_APPLICABLE
        ? { notApplicable: true }
        : {};
    for (const candidate of plausibleDefaults) {
      const result = statedValue(state === FIELD_STATES.NOT_RECORDED ? null : candidate, options);
      assert.equal(result.state, state);
      assert.equal(
        result.value,
        null,
        `state ${state} must carry a null value, never ${JSON.stringify(candidate)}`,
      );
    }
  }
});

test('the unknown primitive did not change the existing projection', () => {
  const projected = toPublicVehicle({ vin: '1HGCM82633A004352', make: 'Toyota' });
  assert.deepEqual(
    Object.keys(projected).sort(),
    [...PUBLIC_VEHICLE_FIELDS].sort(),
    'toPublicVehicle must still emit exactly the allow-list — no state keys, no extra keys',
  );
  assert.equal(projected.color, null, 'an absent field must still project as a bare null');
  assert.equal(projected.mileage, null);
  const statePairs = Object.entries(projected)
    .filter(([, value]) => value && typeof value === 'object' && 'state' in value)
    .map(([key]) => key);
  assert.deepEqual(
    statePairs,
    [],
    `toPublicVehicle must keep returning bare values: ${statePairs.join(', ')} became state pairs. `
    + 'statedValue() is opt-in for read paths, not a change to the projection.',
  );
});
