/**
 * Issue #164 Phase 5 — `media_id` IS AN ANSWER, NEVER A QUESTION.
 *
 * WHY THIS FILE EXISTS. Phase 5 gave every published listing photograph a stable opaque identity
 * (Rule 6b) so that continuity across list / detail / passport could be proven on the PHOTOGRAPH
 * rather than on a URL string two surfaces happen to spell the same way. That identity is
 * `listing_images.id`, and it is published to anonymous callers on the public passport.
 *
 * Phase 1 had just spent its budget CLOSING an enumeration oracle. `passportLookupPolicy.js`
 * narrowed anonymous passport lookup to EXACT VIN ONLY: a plate, a temporary identifier or a
 * chassis number now requires authentication and returns one identical non-enumerable 401, so that
 * an anonymous caller cannot use the lookup route to discover WHETHER a vehicle exists. The reason
 * exact-VIN stays open is stated there and is the governing idea of this file too: a VIN lookup
 * "can only confirm the identifier the caller already holds, and cannot be used to discover a plate
 * or chassis by supplying one".
 *
 * A NEW PUBLIC IDENTIFIER IS EXACTLY HOW THAT GETS REOPENED FROM THE OTHER DIRECTION. Nothing about
 * `media_id` is dangerous while it only ever travels OUTWARD. It becomes an oracle the moment any
 * route, handler or service accepts one INBOUND and resolves it — because a `uuid` is guessable in
 * bulk in a way a VIN is not, and `listing_images` is FK'd to `vehicles(vin)`, so a single
 * `.eq('id', req.params.media_id)` turns "here is a photo you were shown" into "tell me which
 * vehicle any photo belongs to". That is the Phase 1 oracle rebuilt with a different key.
 *
 * ── THE STANDARD THIS FILE APPLIES ────────────────────────────────────────────────────────────
 * Measured at this SHA, `media_id` IS outbound-only: three `listing_images` queries exist in the
 * shipped backend (`server.js` passport read, `server.js` listing insert, `listingSummaryService`
 * summary read) and every one of them is keyed by `vin`; no route declares a media-identity
 * parameter and no handler reads one off a request.
 *
 * THAT IS TRUE, NOT ENFORCED, and "true at this SHA" is precisely the standard this programme
 * exists to reject — it is the same standard that let a marketplace card and a Vehicle Detail page
 * disagree about the same VIN for as long as nobody looked. A property nothing checks is a property
 * that survives until the first person who does not know about it. So the containment is asserted
 * here, three ways that fail independently:
 *
 *   SUITE 1  NO ROUTE, HANDLER OR SERVICE ACCEPTS A MEDIA IDENTITY INBOUND — over the shipped
 *            source of `server.js`, every file in `routes/`, `services/` and `utils/`. Route path
 *            parameters, member access on `req.params`/`req.query`/`req.body`, and destructuring
 *            out of the same three, because those are the four doors a request value comes through.
 *   SUITE 2  NO QUERY ADDRESSES A ROW BY ONE. Every `listing_images` chain in the shipped code is
 *            required to filter by `vin` and forbidden from filtering by `id`; `vehicles` is
 *            forbidden from being filtered by a media identity at all (it HAS no such column —
 *            measured: `vehicles` has no `id`, `media_id`, `image_id` or `image_url` column — so
 *            such a filter could only ever be somebody wiring the oracle by hand).
 *   SUITE 3  AND IF ONE EVER WERE WIRED IN, THE PHASE 1 DECISION ALREADY GOVERNS IT. Expressed in
 *            this programme's existing vocabulary rather than a parallel one: a `media_id` fed to
 *            `classifyLookupIdentifier` is RESTRICTED, never `VIN`, so `resolveLookupAccess`
 *            returns REQUIRE_AUTHENTICATION for an anonymous caller and the route answers with the
 *            single non-enumerable body — WITHOUT QUERYING. This is defence in depth, not the
 *            primary guarantee, and it is asserted because it is the behaviour a future author
 *            would be relying on without knowing it.
 *   SUITE 4  THE SAME THING OVER REAL HTTP. The shipped lookup route is driven with a REAL staging
 *            `media_id` and with a fabricated one; both must produce byte-identical 401s, so the
 *            response cannot be used to tell a photograph that exists from one that does not.
 *
 * ── AND THE POSITIVE DIRECTION, WHICH IS THE POINT OF HAVING AN IDENTITY AT ALL ───────────────
 * SUITE 5 proves `media_id` still does its job: it addresses exactly one photograph WITHIN a block
 * the caller is already holding, it is stable across independent projections of the same row, and
 * it is distinct between rows. A containment guard that passed because the identity had been
 * removed would be worthless, so the capability is asserted alongside the containment.
 *
 * ── ANTI-VACUITY ──────────────────────────────────────────────────────────────────────────────
 * A static scan that scans nothing passes every assertion in Suites 1 and 2. SUITE 6 therefore
 * asserts the scan set is real (file count, and that `server.js` is genuinely in it with its known
 * `listing_images` reads present), and then runs BOTH scanners against PLANTED violating sources
 * held in memory, requiring each to flag exactly the planted line. Separately, and recorded here
 * because it is not reproducible from the committed tree: a temporary route
 *
 *     app.get('/api/media/:media_id/vehicle', async (req, res) => {
 *       const { data } = await supabase.from('listing_images')
 *         .select('vin').eq('id', req.params.media_id).maybeSingle();
 *       res.json({ vin: data?.vin ?? null });
 *     });
 *
 * was added to the real `backend/server.js`, and the two named tests
 * "no route declares a media identity as an inbound parameter" and
 * "every listing_images query is keyed by vin, never by the row's own id" were observed FAILING
 * against it; the route was then deleted and `git diff` confirmed byte-identical restoration.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LOOKUP_KINDS,
  LOOKUP_DECISIONS,
  PUBLIC_LOOKUP_KINDS,
  NON_ENUMERABLE_LOOKUP_RESPONSE,
  classifyLookupIdentifier,
  resolveLookupAccess,
  lookupColumnsForKind,
} from '../utils/passportLookupPolicy.js';

import {
  LISTING_MEDIA_ITEM_FIELDS,
  toMediaIdentity,
  toListingMediaBlock,
} from '../utils/vehicleMediaProjection.js';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The three `listing_images` rows staging actually holds. Their `id`s are REAL published
 * identities, which is what makes the enumeration tests below about this system rather than about
 * an invented uuid.
 */
const STAGING_MEDIA_IDS = Object.freeze([
  '5596b493-f21a-40eb-aba5-947b26e76cd5', // JTNBU4EE0J9UAT101 /uat/owner/toyota-corolla.svg
  '6a4b5b86-fbf2-448e-856e-9fa14299c2d7', // JF1GPAL60J9UAT303 /uat/owner/subaru-impreza.svg
  'fb7b28c2-c6d5-443e-9758-0b7a790be6f2', // WBA8E9C50JNUAT202 /uat/owner/bmw-320i.svg
]);

/** A well-formed uuid that names no row anywhere. The control for every enumeration assertion. */
const FABRICATED_MEDIA_ID = '00000000-1111-4222-8333-444444444444';

/**
 * Every spelling a media identity plausibly arrives under. Deliberately WIDER than the one key the
 * contract publishes: the defect being prevented is somebody accepting `listing_images.id` inbound,
 * and they will not necessarily call it `media_id` when they do.
 */
const MEDIA_IDENTITY_NAMES = Object.freeze([
  'media_id', 'mediaId', 'image_id', 'imageId',
  'listing_image_id', 'listingImageId', 'photo_id', 'photoId',
]);

// ===========================================================================================
// THE SCANNER
// ===========================================================================================

/**
 * Strip comments so the scans measure CODE and not prose. This matters more than it sounds:
 * `vehicleMediaProjection.js` and `server.js` discuss `media_id` at length in exactly the terms
 * these scanners look for, and a guard that cannot tell a comment from a statement would force the
 * documentation explaining the rule to be deleted in order to satisfy the rule.
 *
 * A character walker rather than a regex, because the naive `//.*$` deletes the rest of any line
 * containing `https://…` — of which this codebase has many, several of them media URLs.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { out += source[i] + (source[i + 1] ?? ''); i += 2; continue; }
        out += source[i];
        if (source[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Every shipped backend `.js` file a request can reach. Tests and vendored code excluded. */
function collectSourceFiles() {
  const files = [join(BACKEND, 'server.js')];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) files.push(full);
    }
  };
  for (const sub of ['routes', 'services', 'utils', 'middleware']) walk(join(BACKEND, sub));
  return files;
}

const SOURCE_FILES = collectSourceFiles();
const SOURCES = SOURCE_FILES.map((path) => ({
  path: path.slice(BACKEND.length + 1),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/**
 * `readListingImagesCompat` applies the vin scope through a HELPER rather than inline:
 *
 *   const applyScope = (query) => vin ? query.eq('vin', vin) : query.in('vin', [...vins]);
 *   const wide = await applyScope(supabase.from('listing_images').select(...)).order(...);
 *
 * The scope is real, but it is not lexically inside the chain, so the chain scanner below cannot
 * see it. That is an aperture in the SCANNER, never in the contract — so the exemption is granted
 * only while the helper is PROVEN to key on vin, and evaporates the moment it stops.
 */
const SCOPE_HELPER_IS_VIN_KEYED = SOURCES.some(({ code }) => (
  /const applyScope = \(query\) =>[\s\S]{0,200}?query\.eq\('vin'[\s\S]{0,200}?query\.in\('vin'/.test(code)
));

/**
 * Find every place `code` accepts one of `names` as an INBOUND request value.
 *
 * Four doors, because those are the four a value comes through:
 *   1. a route path parameter          `app.get('/api/media/:media_id/…')`
 *   2. member access                   `req.params.media_id`, `req.query.imageId`
 *   3. destructuring                   `const { media_id } = req.body`
 *   4. bracket access                  `req.params['media_id']`
 */
function findInboundMediaIdentities(code, names = MEDIA_IDENTITY_NAMES) {
  const hits = [];
  const alternation = names.join('|');

  const routeParam = new RegExp(`['"\`][^'"\`]*:(${alternation})\\b`, 'g');
  const memberAccess = new RegExp(`\\breq\\s*\\.\\s*(?:params|query|body)\\s*\\.\\s*(${alternation})\\b`, 'g');
  const bracketAccess = new RegExp(`\\breq\\s*\\.\\s*(?:params|query|body)\\s*\\[\\s*['"\`](${alternation})['"\`]`, 'g');
  for (const pattern of [routeParam, memberAccess, bracketAccess]) {
    for (const match of code.matchAll(pattern)) hits.push(match[0].trim());
  }

  const destructure = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\s*\.\s*(?:params|query|body)\b/g;
  for (const match of code.matchAll(destructure)) {
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`).test(match[1])) hits.push(`{ …${name}… } = req.<request>`);
    }
  }
  return hits;
}

/**
 * Extract each `.from('<table>')` query chain as flat text, up to the statement terminator. Used to
 * ask what a query is KEYED BY, which is the question that separates "reads a vehicle's photos"
 * from "resolves a photo to a vehicle".
 */
function extractQueryChains(code, table) {
  const chains = [];
  const opener = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g');
  for (const match of code.matchAll(opener)) {
    const start = match.index;
    let end = start;
    let depth = 0;
    while (end < code.length) {
      const ch = code[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        // A method chain ends where the chaining stops, NOT at the next semicolon. Terminating on
        // `;` assumes semicolons exist: backend/server.js is written without them, so a chain ran
        // on for ~185 lines and swallowed a `.eq('id', req.params.id)` belonging to an unrelated
        // notification_queue handler. The scanner then reported the vehicles query as keyed by a
        // row identity and this guard failed on a query that does not exist. Look past whitespace
        // (and line comments, which may sit between chained calls) for the next `.`; anything else
        // means the chain is over.
        if (depth <= 0) {
          let peek = end + 1;
          for (;;) {
            while (peek < code.length && /\s/.test(code[peek])) peek += 1;
            if (code.startsWith('//', peek)) {
              const lineEnd = code.indexOf('\n', peek);
              if (lineEnd === -1) { peek = code.length; break; }
              peek = lineEnd + 1;
              continue;
            }
            break;
          }
          if (code[peek] !== '.') { end += 1; break; }
        }
      } else if (ch === ';' && depth <= 0) break;
      end += 1;
    }
    chains.push(code.slice(start, end).replace(/\s+/g, ' ').trim());
  }
  return chains;
}

/** Column names a chain filters on, via the PostgREST predicates that take a column first. */
function filterColumnsOf(chain) {
  const columns = [];
  for (const match of chain.matchAll(/\.(?:eq|neq|in|is|like|ilike|gt|gte|lt|lte|filter|match)\(\s*['"`]([^'"`]+)['"`]/g)) {
    columns.push(match[1]);
  }
  return columns;
}

// ===========================================================================================
// SUITE 0 — THE SCANNER ITSELF
// ===========================================================================================
// A static guard is only as good as its parser. This suite exists because the chain extractor was
// silently wrong: it terminated on `;`, and in semicolon-free source a chain absorbed unrelated
// statements, so the guard reported a filter that no vehicles query performed. Correcting a false
// positive is worthless if it introduces a false negative, so both directions are pinned here.
describe('Phase 5 containment — the chain scanner reports what the code actually does', () => {

  it('a chain ends where the chaining ends, in semicolon-free source', () => {
    // Verbatim shape of the /api/vehicles/owned handler: no semicolons, and a later unrelated
    // handler that filters a DIFFERENT table by row id.
    const code = [
      "const { data, error } = await supabase",
      "  .from('vehicles')",
      "  .select('*')",
      "  .or(`owner_id.eq.${req.userContext.id}`)",
      "if (error) throw error",
      "await supabase",
      "  .from('notification_queue')",
      "  .update({ read: true })",
      "  .eq('id', req.params.id);",
    ].join('\n');

    const chains = extractQueryChains(code, 'vehicles');
    assert.equal(chains.length, 1);
    assert.ok(!chains[0].includes('notification_queue'),
      'the vehicles chain must not absorb a following statement on another table');
    assert.deepEqual(filterColumnsOf(chains[0]), [],
      'the vehicles query filters on nothing; reporting `id` here is the false positive');
  });

  it('it still sees a real filter — on both semicolon styles', () => {
    for (const terminator of [';', '']) {
      const code = `const x = await supabase.from('vehicles').select('*').eq('primary_image_id', req.params.imageId)${terminator}\nreturn x`;
      const [chain] = extractQueryChains(code, 'vehicles');
      assert.deepEqual(filterColumnsOf(chain), ['primary_image_id'],
        `a genuine media-identity filter must still be detected (terminator: ${JSON.stringify(terminator)})`);
    }
  });

  it('it keeps a multi-predicate chain whole across line comments', () => {
    const code = [
      "await supabase",
      "  .from('vehicles')",
      "  // scoped to the caller",
      "  .eq('owner_id', id)",
      "  .eq('vin', vin)",
      "return done",
    ].join('\n');
    const [chain] = extractQueryChains(code, 'vehicles');
    assert.deepEqual(filterColumnsOf(chain), ['owner_id', 'vin']);
  });
});

// ===========================================================================================
// SUITE 1 — NOTHING ACCEPTS A MEDIA IDENTITY INBOUND
// ===========================================================================================
describe('Phase 5 containment — no server surface accepts a media identity as a lookup key', () => {

  it('no route declares a media identity as an inbound parameter', () => {
    const offenders = [];
    for (const { path, code } of SOURCES) {
      const alternation = MEDIA_IDENTITY_NAMES.join('|');
      for (const match of code.matchAll(new RegExp(`['"\`][^'"\`]*:(${alternation})\\b[^'"\`]*['"\`]`, 'g'))) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a route parameter named for a listing-image identity is the enumeration oracle Phase 1 closed, '
      + 'rebuilt with a different key: `listing_images` is FK\'d to `vehicles(vin)`, so resolving one '
      + 'answers "which vehicle does any photograph belong to" for a caller who was never granted it.');
  });

  it('no handler reads a media identity off req.params, req.query or req.body', () => {
    const offenders = [];
    for (const { path, code } of SOURCES) {
      for (const hit of findInboundMediaIdentities(code)) offenders.push(`${path}: ${hit}`);
    }
    assert.deepEqual(offenders, [],
      'media_id is published OUTBOUND on the passport so a consumer can tell two photographs apart. '
      + 'Reading one back INBOUND is what converts an answer into a question.');
  });
});

// ===========================================================================================
// SUITE 2 — NO QUERY ADDRESSES A ROW BY A MEDIA IDENTITY
// ===========================================================================================
describe('Phase 5 containment — no query resolves a row BY a listing-image identity', () => {

  it('every listing_images query is keyed by vin, never by the row`s own id', () => {
    const offenders = [];
    let chainCount = 0;
    for (const { path, code } of SOURCES) {
      // `extractQueryChains` collapses whitespace, so a chain string cannot be located in the raw
      // source. Search the same normalised space the chain came from.
      const flat = code.replace(/\s+/g, ' ');
      for (const chain of extractQueryChains(code, 'listing_images')) {
        chainCount += 1;
        const columns = filterColumnsOf(chain);
        // A chain handed straight to the vin-keyed scope helper is scoped even though the scanner
        // cannot read the filter out of the chain text itself.
        const chainAt = flat.indexOf(chain);
        const scopedByVinHelper = SCOPE_HELPER_IS_VIN_KEYED
          && chainAt > 0
          && /applyScope\(\s*supabase\s*$/.test(flat.slice(Math.max(0, chainAt - 48), chainAt));
        // An INSERT legitimately filters on nothing at all; a READ must be keyed by the FK.
        const isWrite = /\.(?:insert|upsert|update|delete)\s*\(/.test(chain);
        if (columns.includes('id')) {
          offenders.push(`${path}: filters listing_images by id -> ${chain.slice(0, 140)}`);
        }
        if (!isWrite && !columns.includes('vin') && !scopedByVinHelper) {
          offenders.push(`${path}: reads listing_images unkeyed by vin -> ${chain.slice(0, 140)}`);
        }
      }
    }
    assert.ok(chainCount >= 3,
      `anti-vacuity: expected the three shipped listing_images chains, scanned ${chainCount}`);
    assert.deepEqual(offenders, [],
      'a listing_images read keyed by `id` can be handed an identity the caller did not obtain from '
      + 'a passport they were entitled to. Keyed by `vin`, the query can only ever return photographs '
      + 'of a vehicle the caller had already named.');
  });

  it('ANTI-VACUITY: the scope-helper exemption is earned, not assumed', () => {
    // The exemption above is the only way a listing_images read may lack an inline vin filter. If
    // `applyScope` ever stops keying on vin, this fails FIRST and loudly, rather than the exemption
    // silently widening into a hole in the containment contract.
    assert.equal(SCOPE_HELPER_IS_VIN_KEYED, true,
      'readListingImagesCompat must scope every listing_images read by vin — .eq(vin) or .in(vin)');
  });

  it('no vehicles query is filtered by a media identity', () => {
    // `vehicles` has NO `id`, `media_id`, `image_id` or `image_url` column (measured on staging), so
    // such a filter cannot be an ordinary read that happens to look alarming — it could only be
    // somebody joining media identity to vehicle identity by hand.
    const offenders = [];
    for (const { path, code } of SOURCES) {
      for (const chain of extractQueryChains(code, 'vehicles')) {
        for (const column of filterColumnsOf(chain)) {
          if (MEDIA_IDENTITY_NAMES.includes(column) || column === 'id') {
            offenders.push(`${path}: vehicles filtered by ${column} -> ${chain.slice(0, 140)}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'resolving a vehicle from a media identity is the oracle itself');
  });

  it('the published item shape carries the identity and no locator that could be resolved', () => {
    // Rule 6b's mechanical half, restated as a containment property: the only thing travelling out
    // beside the identity is a URL the caller can already see. There is no bucket, path or key that
    // a recipient could turn back into a query.
    // `photo_label` (the seller's own label for the shot) and `seller_order` (the seller's chosen
    // ordering) joined the shape with the Seller media work. Both are DESCRIPTIONS of a photograph
    // the caller is already looking at — neither is a locator, and neither can be turned back into
    // a query for a row the caller was not entitled to. The forbidden-locator assertion below is
    // what actually holds the line, and it is unchanged.
    assert.deepEqual([...LISTING_MEDIA_ITEM_FIELDS].sort(),
      ['is_primary', 'media_id', 'photo_label', 'position', 'seller_order', 'synthetic_demo', 'url', 'url_form']);
    for (const forbidden of ['file_path', 'storage_bucket', 'object_key', 'uploaded_by', 'tenant_id', 'vin']) {
      assert.equal(LISTING_MEDIA_ITEM_FIELDS.includes(forbidden), false,
        `${forbidden} on a listing item would let a holder address something other than this photo`);
    }
  });
});

// ===========================================================================================
// SUITE 3 — THE PHASE 1 DECISION ALREADY GOVERNS A MEDIA IDENTITY
// ===========================================================================================
describe('Phase 5 containment — a media identity is a RESTRICTED identifier in Phase 1`s vocabulary', () => {

  it('a media_id classifies as RESTRICTED, never as a publicly resolvable kind', () => {
    for (const mediaId of [...STAGING_MEDIA_IDS, FABRICATED_MEDIA_ID]) {
      const classified = classifyLookupIdentifier(mediaId);
      assert.ok(classified, 'a uuid is a well-formed identifier string — it is not rejected as malformed');
      assert.equal(classified.kind, LOOKUP_KINDS.RESTRICTED,
        'a 36-character uuid is not 17 characters, so it can never satisfy VIN_PATTERN — the one '
        + 'kind PUBLIC_LOOKUP_KINDS admits');
      assert.equal(PUBLIC_LOOKUP_KINDS.includes(classified.kind), false);
    }
  });

  it('an anonymous caller supplying a media_id is refused BEFORE any query runs', () => {
    for (const mediaId of [...STAGING_MEDIA_IDS, FABRICATED_MEDIA_ID]) {
      const { kind } = classifyLookupIdentifier(mediaId);
      const access = resolveLookupAccess({ kind, actor: null });
      assert.equal(access.decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);
      assert.equal(access.reason, 'restricted_kind');
    }
    assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.status, 401);
    assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.body.code, 'LOOKUP_REQUIRES_AUTHENTICATION');
  });

  it('not even an AUTHENTICATED lookup may search a media identity — no column names one', () => {
    // The gate above decides whether a lookup RESOLVES. This is the second half: even once it
    // resolves, the searchable columns are a closed list, and no member of it holds a media id.
    for (const kind of [LOOKUP_KINDS.VIN, LOOKUP_KINDS.RESTRICTED]) {
      const columns = lookupColumnsForKind(kind);
      for (const column of [...columns.vehicles, ...columns.plateHistory]) {
        assert.equal(MEDIA_IDENTITY_NAMES.includes(column), false,
          `lookupColumnsForKind(${kind}) names ${column}, which would make a media identity searchable`);
        assert.equal(column === 'id', false);
      }
    }
    assert.deepEqual(lookupColumnsForKind(LOOKUP_KINDS.VIN).vehicles, ['vin'],
      'the public kind searches ONE column, which is what makes it safe to leave anonymous');
  });
});

// ===========================================================================================
// SUITE 4 — THE SAME PROPERTY OVER REAL HTTP
// ===========================================================================================
describe('Phase 5 containment — the shipped lookup route cannot be enumerated with a media identity', () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';
    const { app } = await import('../server.js');
    const { supabase } = await import('../db/supabase.js');
    // A database that would ANSWER, so that a 401 proves the policy refused rather than that the
    // query found nothing. Every read resolves to a populated row; if the route ever reached the
    // database with a media identity, it would get a vehicle back and this suite would catch it.
    supabase.from = () => {
      const proxy = new Proxy({
        then(onFulfilled, onRejected) {
          return Promise.resolve({
            data: [{ vin: 'JTNBU4EE0J9UAT101', id: STAGING_MEDIA_IDS[0] }],
            error: null,
            count: 1,
          }).then(onFulfilled, onRejected);
        },
      }, {
        get(target, property) {
          if (property in target) return target[property];
          if (typeof property === 'symbol') return undefined;
          return () => proxy;
        },
      });
      return proxy;
    };
    await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

  async function lookup(identifier) {
    const response = await fetch(`${baseUrl}/api/vehicles/passport/lookup/${identifier}`, {
      headers: { 'x-bypass-rate-limit': 'true' },
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  it('a REAL published media_id resolves no vehicle for an anonymous caller', async () => {
    const { status, body } = await lookup(STAGING_MEDIA_IDS[0]);
    assert.equal(status, 401, JSON.stringify(body));
    assert.deepEqual(body, NON_ENUMERABLE_LOOKUP_RESPONSE.body);
    assert.equal('vehicle' in body, false, 'no vehicle may be resolved from a photograph identity');
    assert.equal(JSON.stringify(body).includes('JTNBU4EE0J9UAT101'), false,
      'the database was primed to answer with a VIN — the policy must have refused before querying');
  });

  it('a real media_id and a fabricated one are INDISTINGUISHABLE in the response', async () => {
    // This is the enumeration property itself. If the two differed by status, by body or by shape,
    // an anonymous caller could sweep the uuid space to discover which photographs exist.
    const real = await lookup(STAGING_MEDIA_IDS[1]);
    const fake = await lookup(FABRICATED_MEDIA_ID);
    assert.equal(real.status, fake.status);
    assert.deepEqual(real.body, fake.body);
    assert.equal(JSON.stringify(real.body), JSON.stringify(fake.body));
  });

  it('all three published identities answer identically — the set cannot be mapped', async () => {
    const responses = await Promise.all(STAGING_MEDIA_IDS.map(lookup));
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, NON_ENUMERABLE_LOOKUP_RESPONSE.body);
    }
  });

  it('POSITIVE CONTROL: the route is alive and DOES admit the one public kind', async () => {
    // Without this, every assertion above would also pass against a route that 401s unconditionally,
    // or against a typo in the path that 404s everything.
    const { status } = await lookup('JTNBU4EE0J9UAT101');
    assert.notEqual(status, 401,
      'exact-VIN lookup is deliberately public (passportLookupPolicy: PUBLIC_LOOKUP_KINDS) — if this '
      + 'is 401 the suite is measuring a broken route rather than a working policy');
  });
});

// ===========================================================================================
// SUITE 5 — AND THE IDENTITY STILL DOES ITS JOB
// ===========================================================================================
describe('Phase 5 containment — media_id identifies a photograph the caller ALREADY holds', () => {
  const rows = [
    { id: STAGING_MEDIA_IDS[0], vin: 'JTNBU4EE0J9UAT101', image_url: '/uat/owner/toyota-corolla.svg', is_primary: true, display_order: 0 },
    { id: STAGING_MEDIA_IDS[1], vin: 'JTNBU4EE0J9UAT101', image_url: '/uat/owner/subaru-impreza.svg', is_primary: false, display_order: 1 },
  ];

  it('addresses exactly one item inside a block the caller was given', () => {
    const block = toListingMediaBlock(rows);
    assert.equal(block.items.length, 2, 'anti-vacuity: the block must actually hold items');
    for (const row of rows) {
      const matched = block.items.filter((item) => item.media_id === toMediaIdentity(row.id));
      assert.equal(matched.length, 1, `${row.id} must address exactly one photograph in this block`);
    }
  });

  it('is stable across independent projections and distinct between rows', () => {
    const first = toListingMediaBlock(rows);
    // Same rows, reversed — the identity must not depend on arrival order, unlike `position`.
    const second = toListingMediaBlock([...rows].reverse());
    const idsOf = (block) => block.items.map((item) => item.media_id).sort();
    assert.deepEqual(idsOf(first), idsOf(second), 'identity is STORED and read back, never derived');
    assert.equal(new Set(idsOf(first)).size, 2, 'two photographs must not collide on one identity');

    // The contrast that gives the previous assertion its meaning: `position` is NOT stable the way
    // the identity is. The primary-claiming row sorts first in both readings, so the SAME photograph
    // keeps position 0 here — but position is an ordinal over whatever siblings happened to arrive,
    // while media_id is the row's own stored key. Prove the difference directly: drop a sibling and
    // the surviving photograph's position can move while its identity cannot.
    const soloBlock = toListingMediaBlock([rows[1]]);
    const soloItem = soloBlock.items[0];
    const pairedItem = first.items.find((item) => item.media_id === toMediaIdentity(rows[1].id));
    assert.equal(soloItem.media_id, pairedItem.media_id, 'the identity survives losing a sibling');
    assert.notEqual(soloItem.position, pairedItem.position,
      'position moved when a sibling was removed — which is exactly why it cannot be an identity');
  });

  it('holding an identity grants nothing beyond the block it came in', () => {
    // The identity is opaque: it carries no vin, no path, no bucket. A recipient who has one and
    // nothing else cannot construct a query from it — there is no query that accepts it (Suites 1-2)
    // and nothing inside it to derive a locator from.
    const block = toListingMediaBlock(rows);
    for (const item of block.items) {
      assert.match(item.media_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.equal(item.media_id.includes('JTNBU4EE0J9UAT101'), false);
      assert.equal(item.media_id.includes('/'), false, 'a path can never satisfy the identity grammar');
      assert.equal(item.media_id.includes('.'), false);
    }
  });
});

// ===========================================================================================
// SUITE 6 — THE SCANNERS ARE NOT MEASURING NOTHING
// ===========================================================================================
describe('Phase 5 containment — anti-vacuity of the containment scans', () => {

  it('the scan set is real and includes the file that publishes the identity', () => {
    assert.ok(SOURCE_FILES.length > 50, `expected the shipped backend, scanned ${SOURCE_FILES.length} files`);
    const paths = SOURCES.map((entry) => entry.path);
    assert.ok(paths.includes('server.js'));
    assert.ok(paths.some((p) => p.endsWith('listingSummaryService.js')));
    const server = SOURCES.find((entry) => entry.path === 'server.js');
    assert.ok(server.code.includes("from('listing_images')"),
      'server.js must still contain the listing_images read — if this fails the scan has been retargeted away from the subject');
  });

  it('the comment stripper removes prose without destroying https:// strings', () => {
    const stripped = stripComments("const u = 'https://cdn/a.jpg'; // req.params.media_id\n const v = 1;");
    assert.ok(stripped.includes("'https://cdn/a.jpg'"), 'a URL literal must survive comment stripping');
    assert.equal(stripped.includes('req.params.media_id'), false, 'the comment must be gone');
    assert.ok(stripped.includes('const v = 1;'));
    // And the reverse: documentation ABOUT the rule must not trip the rule.
    assert.deepEqual(findInboundMediaIdentities(stripComments('/* we never read req.params.media_id */')), []);
  });

  it('PLANTED VIOLATION: the inbound scanner flags every one of the four doors', () => {
    const planted = [
      "app.get('/api/media/:media_id/vehicle', h);",
      'const v = req.params.mediaId;',
      "const w = req.query['image_id'];",
      'const { listing_image_id } = req.body;',
    ];
    for (const line of planted) {
      const hits = findInboundMediaIdentities(stripComments(line));
      assert.ok(hits.length > 0, `the inbound scanner did not flag: ${line}`);
    }
    // And it stays quiet on the shapes that are NOT a media identity arriving inbound.
    for (const innocent of ['const x = item.media_id;', "res.json({ media_id: row.id });", 'const y = req.params.vin;']) {
      assert.deepEqual(findInboundMediaIdentities(stripComments(innocent)), [],
        `the inbound scanner false-positived on: ${innocent}`);
    }
  });

  it('PLANTED VIOLATION: the query scanner flags a listing_images read keyed by id', () => {
    const planted = "const { data } = await supabase.from('listing_images').select('vin').eq('id', req.params.media_id).maybeSingle();";
    const chains = extractQueryChains(stripComments(planted), 'listing_images');
    assert.equal(chains.length, 1, 'the chain extractor must find the planted query');
    assert.ok(filterColumnsOf(chains[0]).includes('id'), 'the planted query is keyed by id and must be seen as such');
    assert.equal(filterColumnsOf(chains[0]).includes('vin'), false);

    // The shipped shape, by contrast, is keyed by vin and must NOT be flagged.
    const shipped = "const { data } = await supabase.from('listing_images').select('id, image_url').eq('vin', vin).order('display_order');";
    const shippedChain = extractQueryChains(stripComments(shipped), 'listing_images')[0];
    assert.ok(filterColumnsOf(shippedChain).includes('vin'));
    assert.equal(filterColumnsOf(shippedChain).includes('id'), false,
      'selecting `id` is not filtering by it — the scanner must tell a projection from a lookup');
  });
});
