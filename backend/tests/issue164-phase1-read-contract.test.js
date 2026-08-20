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
 *      backend/services or backend/utils is a fork of the contract — in ANY of
 *      the four shapes a column list can take (array, template, plain string, or
 *      a private array joined into an exported string).
 *   3. Anonymous route reads select through the canonical list. A `select('*')`
 *      on an anonymous surface is only tolerated where the response is projected
 *      at the boundary, and each such site is registered here by name.
 *   4. A vehicle reached through an EMBED is held to the same rule as a vehicle
 *      reached through `.from('vehicles')`. PostgREST publishes an embedded row
 *      with the same authority as a top-level one, so the leak surface is the
 *      union of both and the guard must be too. One declared exemption exists —
 *      the raw `trust_score` cache on two authenticated operator queues — and it
 *      is declared per registered embed, for that one column, never as a rule.
 *   5. No anonymous read touches a PRIVATE_VEHICLE_FIELDS column unless it is
 *      registered as an authorization check — a read whose private column is
 *      compared and then dropped, never echoed.
 *   6. Unknown is representable and never fabricated. The primitive must not turn
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
 * SCAN FIGURES at the commit that added the embed pass, so a silent collapse of
 * the corpus is visible as a number rather than as a green run:
 *   route layer (server.js + backend/routes) — 27 `.from('vehicles')` reads, 5
 *   `vehicles(...)` embeds (safepay list, saved vehicles, compliance registry,
 *   finance applications, evidence review) = 32 sites;
 *   public projection services (marketplace, recommendation) — 11 reads, 0 embeds.
 * Two embeds are invisible to a `.select(` scan alone: the safepay one is hoisted
 * into an `escrowSelect` const and the saved-vehicles one interpolates the
 * canonical list, which is why embeds are read out of string LITERALS rather than
 * out of select call arguments.
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
 *
 * `trust_score` is the one deliberate exception, removed by Phase 3 — see the
 * dropped-list test below for why it may go and why nothing else may follow it.
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

/**
 * Every `vehicles(...)` EMBED in the route layer, keyed by the exact text the scan
 * reads back. An embed publishes vehicle columns through another table's select, so
 * `.from('transactions').select('*, vehicles(*)')` on an anonymous route would leak
 * owner_id/engine_number/chassis_number/plate_number without any `.from('vehicles')`
 * appearing anywhere. Registering the set makes a NEW embed a failing test.
 *
 * `table` is the parent table the embed hangs off; it is documentation, checked only
 * for staleness (the name must still appear in the file). The load-bearing assertions
 * are on the embed itself: auth-guarded, never `*`, and inside PUBLIC_VEHICLE_FIELDS.
 *
 * `readsRawTrustCache` is the ONE declared exemption from that last rule, and it buys
 * exactly one column: `trust_score`, which Phase 3 removed from the public contract
 * because it is a materialized cache published only through canonicalTrustService's
 * versioned projection. Two authenticated OPERATOR surfaces still read the column off
 * the row; both are marked below, and the marking is what makes them visible rather
 * than absorbed. It is not a waiver: an exempt embed must still be auth-guarded, must
 * still name no private column, and may still name no OTHER out-of-contract column.
 */
const EMBEDDED_VEHICLE_READS = [
  {
    key: "server.js (GET /api/safepay/list) vehicles(make, model, year, price, currency)",
    table: 'safepay_escrows',
    why: 'escrow parties need to name the car under escrow; five presentation columns, no identifiers',
  },
  {
    key: 'server.js (GET /api/vehicles/saved) vehicles(${PUBLIC_VEHICLE_COLUMNS})',
    table: 'saved_vehicles',
    why: 'the Phase 1 convergence — saved cars belong to OTHER sellers, so the embed is the canonical list',
  },
  {
    key: 'routes/complianceRoutes.js (GET /api/compliance/registry) vehicles(make, model)',
    table: 'registry_verifications',
    why: 'government/admin registry queue needs a human label for the row under review',
  },
  {
    key: 'routes/financeRoutes.js (GET /api/finance/applications) vehicles(vin, make, model, year, price)',
    table: 'finance_applications',
    why: 'lender pipeline needs the collateral summary; authorizeRole([admin, finance, bank]). vin is '
      + 'the canonical vehicle identity the application is secured against, so the lender queue names '
      + 'the car by its one true key rather than by a make/model string match. The INV-TRUST-2 '
      + 'follow-up this entry used to carry is DONE: commit 340c5be7 (govern lender decisions and '
      + 'canonical trust reads) dropped trust_score from this embed, so the queue no longer publishes '
      + 'the raw, calculation-version-unattributed trust cache. No readsRawTrustCache flag remains — '
      + 'the test above correctly treats such a flag on an embed that does not name trust_score as a '
      + 'stale blanket waiver.',
  },
  {
    key: 'routes/vehiclesRoutes.js (GET /api/evidence/review) vehicles(make, model, year, trust_score)',
    table: 'vehicle_evidence',
    why: 'reviewer queue needs to identify the car an evidence item belongs to; authorizeRole(reviewRoles)',
    readsRawTrustCache: true,
    trustCacheWhy: 'a moderator queue behind authorizeRole(reviewRoles) and tenant scoping. The '
      + 'reviewer is looking at the cache to decide whether to refresh it, which is the one audience '
      + 'for whom the raw column is the subject rather than a claim. Same follow-up work.',
  },
];

/**
 * Anonymous (or public-surface) vehicle reads that legitimately SELECT a column from
 * PRIVATE_VEHICLE_FIELDS. Same register discipline as BOUNDARY_PROJECTED_STAR_READS:
 * every one of these fetches the private column to COMPARE it and then drops it, and
 * that claim is written down here so the next reader does not have to re-derive it.
 *
 * Why a register is needed at all: the hand-rolled-list test filters candidates by
 * presentation-column count, so `select('vin, owner_id, plate_number, engine_number')`
 * — zero presentation columns, four identifiers — scores 0 and sails through. The
 * intersection test below has no such blind spot, which is exactly why it needs an
 * explicit carve-out for the reads that are supposed to touch these columns.
 */
const AUTHORIZATION_CHECK_VEHICLE_READS = [
  {
    key: 'server.js (GET /api/partsentry/:vin) owner_id',
    why: 'optionalAuth(); owner_id is compared to req.userContext.id to decide publicOnly for '
      + 'getRepairHistory(). The response is repair history, never the vehicle row.',
  },
  {
    key: 'routes/vehiclesRoutes.js (GET /api/vehicles/:vin/evidence) owner_id, tenant_id',
    why: 'compared to the active identity to choose the vehicle_evidence visibility filter; the '
      + 'response is evidence rows only. That this endpoint derives that identity from UNVERIFIED '
      + 'x-user-id/x-tenant-id headers is a separate, tracked defect (PUBLIC_API_INVENTORY §C) — '
      + 'this register certifies non-echo, not the strength of the check.',
  },
  {
    key: 'services/marketplace/marketplaceAnalyticsService.js ((module scope)) owner_id, tenant_id',
    why: 'assertModerator()-gated; both columns feed getFixtureExclusion() so seed rows are dropped '
      + 'from the counts. The response is aggregate tallies.',
  },
  {
    key: 'services/marketplace/marketplaceInquiryService.js ((module scope)) current_seller_id, tenant_id',
    why: 'resolveListingSeller(): they become the inquiry row\'s seller_id/seller_tenant_id routing '
      + 'keys. toSellerInquiry() omits them; only toAdminInquiry(), behind assertReviewer(), echoes '
      + 'seller_id. Phase 6 moved this read from owner_id to current_seller_id deliberately: selling '
      + 'authority is server-governed and is NOT legal title, so an inquiry must route to whoever the '
      + 'server currently recognises as the seller. A listing with no governed current seller fails '
      + 'closed rather than falling back to the owner.',
  },
  {
    key: 'services/marketplace/marketplaceModerationService.js ((module scope)) owner_id, tenant_id',
    why: 'assertModerator()-gated; they address the owner notification emitted after the decision. '
      + 'The moderation response stays sanitized.',
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

/**
 * Every string literal in `src`, with its offset. Comments and regex literals are
 * skipped so `// no raw vehicles(*)` in a doc block is not mistaken for an embed.
 *
 * Embeds are read out of literals rather than out of `.select(` arguments because two
 * of the five real embeds are not lexically inside a select call: one is hoisted into
 * a `const escrowSelect = '...'` and reused by three queries, the other interpolates
 * the canonical list into a template. A `.select(`-anchored scan sees neither.
 */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '/') {
      // Division or regex? A regex may only start where a value may start.
      const before = src.slice(0, i).replace(/\s+$/, '');
      if (before === '' || /[([{,;:=!&|?+\-*%~^<>]$/.test(before) || /\b(?:return|typeof|case|in|of|do|else)$/.test(before)) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length) {
          const c = src[j];
          if (c === '\\') { j += 2; continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '\n') break;
          else if (c === '/' && !inClass) break;
          j += 1;
        }
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === ch) break;
        if (ch !== '`' && c === '\n') break;
        j += 1;
      }
      out.push({ start: i, body: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
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

function privateFieldsIn(tokens) {
  return (tokens || []).filter(token => PRIVATE_VEHICLE_FIELDS.includes(token));
}

/** Column tokens of an embed body, normalized the same way a select literal is. */
function embedColumnTokens(body) {
  return body
    .replace(/[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*\([^)]*\)/g, '')
    .replace(/[A-Za-z_$][\w$]*\s*\([^)]*\)/g, '')
    .replace(/\$\{[^}]*\}/g, '')
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);
}

/** `vehicles(`, optionally aliased (`car:vehicles(`) or hinted (`vehicles!inner(`). */
const EMBEDDED_VEHICLES =
  /(?:^|[\s,{(])(?:[A-Za-z_$][\w$]*\s*:\s*)?vehicles\s*(?:!\s*[A-Za-z_$][\w$]*\s*)?\(/g;

function balancedParens(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Every vehicle read in `src` — both `.from('vehicles')` reads and `vehicles(...)`
 * embeds — with its select text, the enclosing route (nearest preceding
 * registration) and whether that route is anonymous. Sites with no select — writes —
 * are skipped. Ordered by source position so a caller may index into the result.
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
  const enclosingOf = (idx) => routes.find(route => idx >= route.idx && idx < route.end) || null;
  const siteAt = (idx, enclosing) => ({
    label,
    index: idx,
    line: src.slice(0, idx).split('\n').length,
    anonymous: Boolean(enclosing?.anonymous),
    route: enclosing ? `${enclosing.method.toUpperCase()} ${enclosing.route}` : '(module scope)',
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

    reads.push({
      ...siteAt(match.index, enclosingOf(match.index)),
      kind: 'table',
      args: args.replace(/\s+/g, ' ').trim(),
      tokens: selectColumnTokens(args),
      canonical: CANONICAL_SELECT_IDENTIFIERS.some(id => new RegExp(`\\b${id}\\b`).test(args)),
      star: /^\s*(['"`])\s*\*\s*\1/.test(args),
    });
  }

  for (const literal of stringLiterals(src)) {
    EMBEDDED_VEHICLES.lastIndex = 0;
    let embed;
    while ((embed = EMBEDDED_VEHICLES.exec(literal.body))) {
      const openIdx = literal.body.indexOf('(', embed.index + embed[0].length - 1);
      const body = balancedParens(literal.body, openIdx);
      EMBEDDED_VEHICLES.lastIndex = openIdx + 1;
      reads.push({
        ...siteAt(literal.start, enclosingOf(literal.start)),
        kind: 'embed',
        // An unbalanced embed cannot be read, so it is reported as unknown rather than
        // as empty — an unparsed select must fail the guards, not slip past them.
        args: body === null ? '<unparsed>' : body.replace(/\s+/g, ' ').trim(),
        tokens: body === null ? null : embedColumnTokens(body),
        canonical: body !== null && CANONICAL_SELECT_IDENTIFIERS.some(id => new RegExp(`\\b${id}\\b`).test(body)),
        star: body !== null && /^\s*\*\s*$/.test(body),
      });
    }
  }

  return reads.sort((a, b) => a.index - b.index);
}

function scanFiles(files) {
  return files.flatMap(file => scanVehicleReads(readFileSync(file, 'utf8'), path.relative(BACKEND, file)));
}

const ROUTE_LAYER_FILES = [SERVER_JS, ...jsFilesUnder(ROUTES_DIR)];
const routeLayerReads = scanFiles(ROUTE_LAYER_FILES);
const publicServiceReads = scanFiles(PUBLIC_PROJECTION_SERVICE_DIRS.flatMap(jsFilesUnder));

const describeSite = site =>
  `${site.label}:${site.line} (${site.route}) `
  + `${site.kind === 'embed' ? 'vehicles' : 'select'}(${site.args.slice(0, 120)})`;

/** Register key for an embed: file, route and exact embed body, no line number. */
const embedKey = site => `${site.label} (${site.route}) vehicles(${site.args})`;

/** Register key for a private-column read: file, route and the private columns it selects. */
const privateReadKey = site => `${site.label} (${site.route}) ${privateFieldsIn(site.tokens).join(', ')}`;

/**
 * Exported vehicle column lists declared in `src`, in every shape a column list can
 * take. The original scan matched arrays and templates only, which left two escapes
 * open: a plain string literal (`export const X = 'vin, make, model, year'`) and a
 * NON-exported array joined into an exported string — the exact shape
 * PUBLIC_VEHICLE_SELECT itself has, so the guard could not see the thing it guards.
 *
 * Returns `NAME` for a directly-declared list and `NAME ← SOURCE` for a joined one,
 * so the register records not just that a list exists but what it derives from: an
 * edit turning `PUBLIC_VEHICLE_FIELDS.join()` into an inline array changes the string
 * and fails, which is the fork this test is here to catch.
 */
function exportedVehicleColumnLists(src) {
  const found = new Map();

  const literalList =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?(\[[\s\S]*?\]|`[\s\S]*?`|'[^'\n]*'|"[^"\n]*")/g;
  let match;
  while ((match = literalList.exec(src))) {
    const tokens = match[2].match(/[a-z_][a-z0-9_]*/gi) || [];
    if (presentationColumnCount(tokens) >= HAND_ROLLED_THRESHOLD) found.set(match[1], match[1]);
  }

  // `[^\]]*` rather than a lazy `[\s\S]*?`: the trailing `.join(` anchor would otherwise
  // let the bracket span every array between here and the next joined export, so one
  // declaration would swallow its siblings' columns and report under the wrong name.
  const joinedList =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?(\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*\.join\s*\(/g;
  while ((match = joinedList.exec(src))) {
    const [name, expression] = [match[1], match[2]];
    const sources = [];
    const tokens = [];
    for (const identifier of expression.match(/[A-Za-z_$][\w$]*/g) || []) {
      const local = new RegExp(
        `\\b(?:const|let|var)\\s+${identifier}\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\[([^\\]]*)\\]`,
      ).exec(src);
      if (!local) continue;
      sources.push(identifier);
      tokens.push(...(local[1].match(/[a-z_][a-z0-9_]*/gi) || []));
    }
    if (!sources.length) tokens.push(...(expression.match(/[a-z_][a-z0-9_]*/gi) || []));
    if (presentationColumnCount(tokens) >= HAND_ROLLED_THRESHOLD) {
      found.set(name, sources.length ? `${name} ← ${sources.join(' + ')}` : `${name} ← (inline)`);
    }
  }

  return [...found.values()];
}

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
  const embeds = routeLayerReads.filter(site => site.kind === 'embed');
  assert.ok(
    embeds.length >= EMBEDDED_VEHICLE_READS.length,
    `expected the route layer to contain the ${EMBEDDED_VEHICLE_READS.length} known vehicles(...) embeds, `
    + `found ${embeds.length} — the literal scan has stopped seeing them`,
  );
  assert.ok(
    embeds.some(site => site.label === 'server.js' && /escrow|safepay/i.test(site.route)),
    'the safepay embed lives in a hoisted select const; losing it means the scan is back to reading .select() arguments only',
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

test('the scan classifier detects a leaky vehicles(...) embed when one exists', () => {
  // None of these reads touch .from('vehicles'), so the pre-embed scan saw nothing here.
  const fixture = `
    app.get('/api/public/embed-star', async (req, res) => {
      const { data } = await supabase.from('transactions').select('*, vehicles(*)');
      res.json(data);
    });
    app.get('/api/public/embed-identifiers', async (req, res) => {
      const { data } = await supabase
        .from('transactions')
        .select('id, vehicles(vin, owner_id, plate_number, engine_number)');
      res.json(data);
    });
    app.get('/api/admin/embed-narrow', authorizeRole(['admin']), async (req, res) => {
      const embedSelect = 'id, car:vehicles!inner(make, model)';
      const { data } = await supabase.from('transactions').select(embedSelect);
      res.json(data);
    });
  `;
  const found = scanVehicleReads(fixture, 'fixture');
  assert.equal(
    found.filter(site => site.kind === 'table').length,
    0,
    'the fixture deliberately contains no .from(vehicles) read — the table pass must not be what catches these',
  );

  const embeds = found.filter(site => site.kind === 'embed');
  assert.equal(embeds.length, 3, 'the scanner must see all three embeds, aliased and fk-hinted ones included');
  const [star, identifiers, narrow] = embeds;
  assert.ok(star.anonymous && star.star, 'an anonymous vehicles(*) embed must be flagged');
  assert.deepEqual(
    privateFieldsIn(identifiers.tokens).sort(),
    ['engine_number', 'owner_id', 'plate_number'],
    'an anonymous embed selecting registry identifiers must be flagged',
  );
  assert.equal(
    presentationColumnCount(identifiers.tokens),
    0,
    'and it must score zero presentation columns — proof the hand-rolled-list filter cannot be what catches it',
  );
  assert.equal(narrow.anonymous, false, 'an authorizeRole()-guarded embed must not be flagged anonymous');
  assert.deepEqual(narrow.tokens, ['make', 'model'], 'an aliased fk-hinted embed body must still parse to its columns');
});

test('the scan flags an anonymous identifier-only read that scores no presentation columns', () => {
  // The shape the presentation-count filter is blind to by construction: four columns,
  // three of them private, zero of them anything a shopper looks at.
  const fixture = `
    app.get('/api/public/identifiers', async (req, res) => {
      const { data } = await supabase
        .from('vehicles')
        .select('vin, owner_id, plate_number, engine_number')
        .eq('vin', req.params.vin);
      res.json(data);
    });
  `;
  const [site] = scanVehicleReads(fixture, 'fixture');
  assert.ok(site.anonymous && !site.star && !site.canonical);
  assert.equal(
    presentationColumnCount(site.tokens),
    0,
    'if this ever scores >= HAND_ROLLED_THRESHOLD the fixture no longer proves the blind spot exists',
  );
  assert.deepEqual(
    privateFieldsIn(site.tokens).sort(),
    ['engine_number', 'owner_id', 'plate_number'],
    'the private-field intersection must flag it where the presentation-count filter cannot',
  );
  assert.equal(
    AUTHORIZATION_CHECK_VEHICLE_READS.some(entry => entry.key === privateReadKey(site)),
    false,
    'and it must not be silently absorbed by the authorization-check register',
  );
});

test('the string-literal reader ignores embeds written in comments', () => {
  // Several marketplace services document their contract with the words "no raw
  // vehicles(*)". A raw-text embed scan would read those as five extra leaks.
  const fixture = `
    // Every listing read goes through the sanitized pipeline: no raw vehicles(*).
    /* Historical note: this used to select('*, vehicles(owner_id, plate_number)'). */
    const pattern = /vehicles\\(.*\\)/;
    app.get('/api/public/clean', async (req, res) => {
      const { data } = await supabase.from('transactions').select('id, amount');
      res.json(data);
    });
  `;
  assert.deepEqual(
    scanVehicleReads(fixture, 'fixture').map(describeSite),
    [],
    'comment prose and regex literals are not vehicle reads',
  );
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

test('aliasing PUBLIC_VEHICLE_COLUMNS dropped exactly the trust_score cache and nothing else', () => {
  const aliased = PUBLIC_VEHICLE_COLUMNS.split(',').map(token => token.trim()).filter(Boolean);
  const dropped = LEGACY_PUBLIC_VEHICLE_COLUMNS.filter(column => !aliased.includes(column));
  // EXACTLY ONE historically-public column may be missing, and it is named here rather than
  // tolerated as a hole: `trust_score`. It is exempt because it is not a vehicle fact at all — it
  // is a materialized CACHE of a trust decision, published only through canonicalTrustService's
  // projection, which carries the calculation_version that makes the number attributable. Projecting
  // it off the row republished an unversioned legacy score as a public fact (`vehicle.trust_score:
  // 84` beside a `trustReport` that said `not_evaluated`). Any OTHER column disappearing from the
  // canonical list is still a silent narrowing of a live public response, and still fails here.
  assert.deepEqual(
    dropped,
    ['trust_score'],
    'the canonical list must still name every historically public column except the deliberately '
    + `demoted trust_score cache: ${dropped.join(', ')}`,
  );
  const leaked = aliased.filter(column => PRIVATE_VEHICLE_FIELDS.includes(column));
  assert.deepEqual(leaked, [], `PUBLIC_VEHICLE_COLUMNS must fetch no private column: ${leaked.join(', ')}`);
});

test('no fourth vehicle allow-list exists under backend/utils or backend/services', () => {
  const declared = [];
  for (const file of [...jsFilesUnder(UTILS_DIR), ...jsFilesUnder(SERVICES_DIR)]) {
    const relative = path.relative(BACKEND, file);
    for (const name of exportedVehicleColumnLists(readFileSync(file, 'utf8'))) {
      declared.push(`${name} (${relative})`);
    }
  }
  assert.deepEqual(
    declared.sort(),
    [
      'LISTING_SELECT_COLUMNS (services/marketplace/listingSummaryService.js)',
      'OWNER_VEHICLE_SELECT ← PUBLIC_VEHICLE_FIELDS + OWNER_ADDITIONAL_VEHICLE_FIELDS (utils/publicVehicleProjection.js)',
      'PUBLIC_VEHICLE_FIELDS (utils/publicVehicleProjection.js)',
      'PUBLIC_VEHICLE_SELECT ← PUBLIC_VEHICLE_FIELDS (utils/publicVehicleProjection.js)',
      // The two `←` entries are the canonical array joined into a select string, not
      // separate lists; the arrow is the proof of that and must stay in the name.
    ],
    'the canonical list and the (Phase 2) marketplace list are the only vehicle allow-lists allowed to exist',
  );
});

test('the fourth-list scan sees a plain-string list and an array joined into an export', () => {
  // Both shapes below pass the array/template regex the scan used before, so if this
  // fixture ever comes back empty the widening has been undone.
  const fixture = `
    export const SNEAKY_STRING_LIST = 'vin, make, model, year, price, currency';
    const HIDDEN_COLUMNS = ['vin', 'make', 'model', 'year', 'price'];
    export const HIDDEN_SELECT = HIDDEN_COLUMNS.join(', ');
    export const NOT_A_LIST = 'a plain sentence about nothing';
    export const ALSO_NOT_A_LIST = ['pending', 'approved', 'rejected'];
  `;
  assert.deepEqual(
    exportedVehicleColumnLists(fixture).sort(),
    ['HIDDEN_SELECT ← HIDDEN_COLUMNS', 'SNEAKY_STRING_LIST'],
    'the widened scan must catch both escapes and must not flag non-column exports',
  );

  const arrayOrTemplateOnly =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?(\[[\s\S]*?\]|`[\s\S]*?`)/g;
  const missedByOldScan = [];
  let match;
  while ((match = arrayOrTemplateOnly.exec(fixture))) {
    const tokens = match[2].match(/[a-z_][a-z0-9_]*/gi) || [];
    if (presentationColumnCount(tokens) >= HAND_ROLLED_THRESHOLD) missedByOldScan.push(match[1]);
  }
  assert.deepEqual(
    missedByOldScan,
    [],
    'the pre-widening regex is supposed to miss both shapes — if it now sees them, this fixture no longer proves anything',
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

test('every vehicles(...) embed is registered, auth-guarded and inside the public contract', () => {
  const embeds = [...routeLayerReads, ...publicServiceReads].filter(site => site.kind === 'embed');

  // The only column an embed may name that the public contract does not, and only where the
  // register declares it (see EMBEDDED_VEHICLE_READS.readsRawTrustCache).
  const RAW_TRUST_CACHE_COLUMN = 'trust_score';
  const staleExemptions = EMBEDDED_VEHICLE_READS
    .filter(entry => entry.readsRawTrustCache)
    .filter(entry => !entry.key.includes(RAW_TRUST_CACHE_COLUMN))
    .map(entry => entry.key);
  assert.deepEqual(
    staleExemptions,
    [],
    'a readsRawTrustCache exemption on an embed that does not name trust_score is a blanket waiver '
    + `on an out-of-contract column; drop the flag: ${staleExemptions.join(' | ')}`,
  );

  assert.deepEqual(
    embeds.map(embedKey).sort(),
    EMBEDDED_VEHICLE_READS.map(entry => entry.key).sort(),
    'a vehicles(...) embed appeared, moved or changed columns without being registered — an embed publishes '
    + 'vehicle columns with the same authority as a top-level read, so register it here with a reason: '
    + embeds.map(describeSite).join(' | '),
  );

  const anonymous = embeds.filter(site => site.anonymous);
  assert.deepEqual(
    anonymous.map(describeSite),
    [],
    `an anonymous route embeds vehicles(...): ${anonymous.map(describeSite).join(' | ')}`,
  );

  const stars = embeds.filter(site => site.star);
  assert.deepEqual(
    stars.map(describeSite),
    [],
    `a vehicles(*) embed publishes the whole row through another table: ${stars.map(describeSite).join(' | ')}`,
  );

  for (const site of embeds) {
    assert.notEqual(site.args, '<unparsed>', `unreadable embed at ${describeSite(site)}`);
    if (site.canonical) continue;
    assert.deepEqual(
      privateFieldsIn(site.tokens),
      [],
      `embed at ${describeSite(site)} selects a private column`,
    );
    const entry = EMBEDDED_VEHICLE_READS.find(candidate => candidate.key === embedKey(site));
    const exempt = Boolean(entry?.readsRawTrustCache);
    const outside = site.tokens.filter(token => !PUBLIC_VEHICLE_FIELDS.includes(token));
    // An exempt embed must name trust_score AND NOTHING ELSE outside the contract: the expectation
    // is the exact column list, not a filtered-down one, so the exemption cannot be used to smuggle
    // a second column through, and cannot go stale if the embed stops reading the cache.
    assert.deepEqual(
      outside,
      exempt ? [RAW_TRUST_CACHE_COLUMN] : [],
      `embed at ${describeSite(site)} names a column the public contract does not: ${outside.join(', ')}`
      + (exempt
        ? ' — the readsRawTrustCache exemption covers trust_score alone'
        : '. If it is the raw trust cache on an authenticated operator surface, register it with '
          + 'readsRawTrustCache and a reason; on any public surface, publish canonical trust instead'),
    );
    if (exempt) {
      // Restated per site rather than left to the blanket anonymity assertion above, because THIS
      // is the column whose whole defect was reaching an anonymous reader unattributed.
      assert.equal(
        site.anonymous,
        false,
        `the raw trust cache is readable only behind auth: ${describeSite(site)}`,
      );
    }
  }

  for (const entry of EMBEDDED_VEHICLE_READS) {
    const site = embeds.find(candidate => embedKey(candidate) === entry.key);
    const src = readFileSync(path.join(BACKEND, site.label), 'utf8');
    assert.ok(
      new RegExp(`(['"\`])${entry.table}\\1`).test(src),
      `${site.label} no longer names ${entry.table}; the embed register is stale`,
    );
  }
});

test('no anonymous vehicle read selects a private field outside the authorization-check register', () => {
  // Deliberately NOT filtered by presentation-column count: `select('vin, owner_id,
  // plate_number, engine_number')` scores zero there and would otherwise pass clean.
  const withPrivate = [...routeLayerReads.filter(site => site.anonymous), ...publicServiceReads]
    .filter(site => Array.isArray(site.tokens) && privateFieldsIn(site.tokens).length > 0);

  assert.deepEqual(
    withPrivate.map(privateReadKey).sort(),
    AUTHORIZATION_CHECK_VEHICLE_READS.map(entry => entry.key).sort(),
    'an anonymous or public-surface vehicle read selects a PRIVATE_VEHICLE_FIELDS column. Drop the column, or — '
    + 'if it is fetched only to be compared and never echoed — register it in AUTHORIZATION_CHECK_VEHICLE_READS '
    + `with that reason: ${withPrivate.map(describeSite).join(' | ')}`,
  );

  for (const entry of AUTHORIZATION_CHECK_VEHICLE_READS) {
    assert.ok(entry.why && entry.why.length > 40, `${entry.key} must state why the private column is read`);
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
