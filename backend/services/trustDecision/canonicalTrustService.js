/**
 * CANONICAL TRUST READ PATH — Issue #164 Phase 3 (ADR-001).
 *
 * The ONE place any surface asks "what is CarUp's trust position on this VIN?". Every public
 * surface — vehicle detail, marketplace list, share card, partner API — reads through here, so
 * one VIN yields one score and one calculation_version everywhere (INV-TRUST-1).
 *
 * ===========================================================================================
 * THE PUBLIC CONTRACT — `toPublicTrust()`. This shape is FINAL. It is the only shape a public
 * surface may render, and it carries EXACTLY these ten fields, always all ten, never more:
 *
 *   vin                 string
 *   score               number 0..100, or NULL when there is no canonical evaluation to publish
 *   band                TRUST_BANDS member, or NULL exactly when `score` is NULL
 *   evaluation_state    TRUST_EVALUATION_STATES member — the LIFECYCLE axis (see below)
 *   confidence          TRUST_CONFIDENCE member — the EVIDENCE-STRENGTH axis
 *   evidence_basis      {governed_facts_total, governed_facts_substantiated,
 *                        governed_facts_adverse, connected_sources, unbacked_legacy_claims},
 *                       each a number or NULL, or the whole object NULL when unresolved
 *   calculation_version the version of the RULES that produced what is reported, or NULL
 *   evaluated_at        ISO-8601 instant those rules were applied, or NULL
 *   known_limitations   string[] — always an array, never null
 *   source              TRUST_SOURCES member: where this projection came from
 *
 * THREE AXES, DELIBERATELY NOT COLLAPSED (Issue #164 §8). `score` is a number. `band` is that
 * number's bucket. Neither can distinguish "we evaluated this vehicle and it has nothing" from
 * "we have not evaluated it" or "we evaluated it under rules that no longer apply" — so
 * `evaluation_state` carries the lifecycle and `confidence`/`evidence_basis` carry how much is
 * actually behind the number. A shopper-facing surface that renders only `score` is misreading
 * this contract: an unevidenced vehicle and a genuinely-scored-low vehicle both show a small
 * number and are told apart ONLY by `confidence`, `evidence_basis` and `known_limitations`.
 *
 * SCORE IS NULL, NOT ZERO, WHEN THERE IS NOTHING CANONICAL TO PUBLISH. A zero is a real
 * evaluated score (a vehicle with no evidence genuinely scores 0 under trustDecisionService's
 * 0-baseline). "Not evaluated" is not a zero, and rendering it as one would be exactly the
 * absence-as-proof this programme exists to remove, in the negative direction.
 *
 * NO FLOOR, NO BASELINE, NO FALLBACK. Nothing here softens a low score, and nothing substitutes
 * a stored value for a missing one. ADR-001 records why: today's displayed 84/80 were unfounded.
 * ===========================================================================================
 *
 * ===========================================================================================
 * THE CACHE RULE. `vehicles.trust_score` is a MATERIALIZED CACHE of `decision.overall_trust.value`
 * (Principle 2 — a persisted score is a cache, never an authority). Three consequences, all
 * mechanical rather than advisory:
 *
 *   1. EXACTLY ONE WRITER (INV-TRUST-2). `refreshCanonicalTrust()` is it. It writes the score
 *      and its stamp — trust_calculation_version, trust_evaluated_at, trust_band,
 *      trust_confidence, trust_known_limitations, trust_evidence_basis — in ONE update, so a
 *      score can never be present without the rules that produced it.
 *   2. A VERSION MISMATCH IS NEVER PUBLISHED. A cached row whose trust_calculation_version is
 *      not the running CALCULATION_VERSION is STALE: its score is withheld (`score: null`),
 *      `evaluation_state` says `stale`, and `known_limitations` names both versions. The single
 *      read path recomputes; the batch path reports the state. A score computed by different
 *      rules is never served as if it were current.
 *   3. AN UNVERSIONED ROW IS NOT A CACHE AT ALL. Every trust_score that exists today predates
 *      this service and carries no version, so it classifies as `unversioned` -> `not_evaluated`
 *      and is not published. That is why the migration needs no backfill and no rewrite: the
 *      nullable version column demotes the entire legacy population on its own.
 *
 * READS NEVER WRITE. `getCanonicalTrust` and `getCanonicalTrustBatch` are pure reads; recomputing
 * is a read, persisting is not. Persisting is `refreshCanonicalTrust`, which a caller invokes on
 * purpose. A read path that silently rewrote the cache would be a second, invisible writer.
 * ===========================================================================================
 *
 * THE BATCH PATH IS CACHE-ONLY, ON PURPOSE. A 48-card marketplace list must not trigger 48 full
 * recomputes: each recompute is four+ round trips through completeness, coverage, fraud and
 * eligibility. `getCanonicalTrustBatch` therefore takes no `decide` and issues ONE `in('vin',…)`
 * per chunk. Vehicles with no fresh cache entry come back honestly as `not_evaluated`/`stale`
 * with a null score rather than as a recomputed number or a stale one — the list shows what the
 * cache actually holds, and the refresh job is what fills it.
 *
 * WHY THE FACT RESOLVER IS THE PROVENANCE INPUT AND NOT A SCORING INPUT. Phase 2's
 * vehicleFactResolver is wired in here as the provenance side of the canonical record: it
 * supplies `evidence_basis` and the fact-derived `known_limitations`, and it is what lets this
 * service state that a stored legacy boolean is an unbacked claim. It deliberately does NOT feed
 * `assembleDecision`. That function is pure and versioned, and INV-TRUST-4 (replay recorded
 * inputs, get the identical score) only holds while a given CALCULATION_VERSION means one fixed
 * function of one fixed input set. Changing what the score is computed from is a rules change and
 * must arrive with a version bump, in the phase that changes the rules — not smuggled in by the
 * phase that builds the read path. So the facts can add disclosure and withhold claims here; they
 * cannot move the number.
 *
 * A DECISION WITHOUT A TIMESTAMP IS NOT CANONICAL. `assembleDecision({...})` called without `now`
 * yields `last_updated: null`; that decision is reported `not_evaluated` and is never cached,
 * because an unstamped score cannot be shown to be current or stale. `getTrustDecision` always
 * stamps, so the real path is unaffected — this only bites a caller assembling by hand.
 *
 * INJECTION. Every I/O dependency is an option with a real default (`client`, `decide`, `read`),
 * so this module is exercised hermetically by the guard suite and runs against Supabase in
 * production without a branch. Failures degrade to `unavailable` — never to a fabricated score.
 *
 * THE OTHER WRITERS OF vehicles.trust_score, for the surfaces converging onto this contract.
 * They are NOT removed here (this phase adds the read path; it does not re-point the writers):
 *   trustGraphService.js:435            calculateVehicleTrustScore — the deprecated 70-baseline
 *                                       engine. No production caller remains (server.js does not
 *                                       import it and the evidence-review routes now call
 *                                       refreshCanonicalTrust); backend/tests/run-tests.js still
 *                                       invokes it, and it still writes an UNCLEARED stamp.
 *   documentIntelligenceService.js      writes a score off OCR approval
 *   trustEnforcementEngine.js           penalty writes over an assumed 80.0 baseline
 * Listing creation is NO LONGER one of them: server.js inserts an explicit `trust_score: null`,
 * because the column DEFAULTS TO 80.0 and omitting it would fabricate a score.
 *
 * WHY CLEARING THE STAMP IS THE FOREIGN WRITER'S JOB, NOT THIS SERVICE'S. A foreign write is
 * refused only when the row it leaves behind classifies as `unversioned`, and an `update({
 * trust_score })` that touches the score alone does NOT produce such a row: after a legitimate
 * refresh the stamp columns are already populated, so the foreign score inherits that
 * calculation_version and publishes as `evaluated`, described by a band, confidence and evidence
 * basis belonging to the score it replaced. The two writers above therefore null all six stamp
 * columns in the SAME update as the score, which is what puts the row back into `unversioned` and
 * makes the refusal real. A new writer of this column must do the same, or it is publishing under
 * refreshCanonicalTrust's authority. Retiring them is INV-TRUST-2's remaining work.
 */
async function getDefaultClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}
import {
  CALCULATION_VERSION,
  getTrustDecision,
} from './trustDecisionService.js';
import {
  FACT_STATUS,
  VEHICLE_FACT_KEYS,
  resolveVehicleFacts,
  unbackedLegacyClaims,
} from '../evidence/vehicleFactResolver.js';

export { CALCULATION_VERSION };

const VEHICLES_TABLE = 'vehicles';

/** Default chunk size for the batch read. A 48-card list is one query. */
export const BATCH_CHUNK_SIZE = 200;

/**
 * The lifecycle axis. Answers "does a canonical evaluation exist for this vehicle right now?",
 * which no score and no band can answer.
 */
export const TRUST_EVALUATION_STATES = Object.freeze({
  /** A decision under the running CALCULATION_VERSION, stamped. The only state that publishes a score. */
  EVALUATED: 'evaluated',
  /** A score exists but was produced by a different CALCULATION_VERSION. Withheld, not served. */
  STALE: 'stale',
  /** No canonical evaluation: no cache row, or one with no version (every legacy hand-set score). */
  NOT_EVALUATED: 'not_evaluated',
  /** The evaluation could not be performed or read. Distinct from "there is nothing" (principle 4). */
  UNAVAILABLE: 'unavailable',
});

export const TRUST_EVALUATION_STATE_VALUES = Object.freeze(Object.values(TRUST_EVALUATION_STATES));

/**
 * The band vocabulary. NOT a parallel vocabulary — these are exactly the values
 * trustDecisionService's private `scoreBand()` produces, including `insufficient_evidence`, and
 * every band this service emits is copied from `decision.overall_trust.status` rather than
 * recomputed. The guard suite exercises `assembleDecision` across the score range and asserts the
 * produced set equals this list, so a change to the bands upstream fails here rather than drifting.
 */
export const TRUST_BANDS = Object.freeze(['high', 'moderate', 'low', 'insufficient_evidence']);

/**
 * The evidence-strength axis, copied from the `evidence_confidence` dimension. `not_evaluated` is
 * first class: "we did not assess the evidence" is not "the evidence is weak".
 */
export const TRUST_CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'not_evaluated']);

/** Where a projection came from. `none` means nothing was computed and nothing was read. */
export const TRUST_SOURCES = Object.freeze(['computed', 'cache', 'none']);

/** How `getCanonicalTrust` may spend I/O. The batch path is fixed at `never` and takes no override. */
export const RECOMPUTE = Object.freeze({
  /** Serve a fresh cache entry; recompute when the cache is stale, unversioned, incomplete or absent. */
  IF_STALE: 'if_stale',
  /** Always recompute. Used by the refresh writer and by any caller that must bypass the cache. */
  ALWAYS: 'always',
  /** Never recompute — cache only. What the marketplace list uses. */
  NEVER: 'never',
});

/** How a cache row classifies. Only `fresh` may be published. */
export const TRUST_CACHE_STATUS = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  UNVERSIONED: 'unversioned',
  INCOMPLETE: 'incomplete',
  ABSENT: 'absent',
});

/** The exact key set of `toPublicTrust()`. A public surface may render these and nothing else. */
export const PUBLIC_TRUST_FIELDS = Object.freeze([
  'vin',
  'score',
  'band',
  'evaluation_state',
  'confidence',
  'evidence_basis',
  'calculation_version',
  'evaluated_at',
  'known_limitations',
  'source',
]);

/** The exact key set of `evidence_basis`. */
export const EVIDENCE_BASIS_FIELDS = Object.freeze([
  'governed_facts_total',
  'governed_facts_substantiated',
  'governed_facts_adverse',
  'connected_sources',
  'unbacked_legacy_claims',
]);

/**
 * The cache columns on `vehicles`, added by
 * database/migrations/20260817140000_issue164_trust_cache_provenance.sql. `trust_score` is the
 * pre-existing column this service demotes to a cache; the other six are its stamp.
 */
export const TRUST_CACHE_COLUMNS = Object.freeze([
  'vin',
  'trust_score',
  'trust_calculation_version',
  'trust_evaluated_at',
  'trust_band',
  'trust_confidence',
  'trust_known_limitations',
  'trust_evidence_basis',
]);

/**
 * Columns the fact resolver needs on the vehicle row: `import_source` decides whether import duty
 * can apply, and the six legacy booleans are annotated (never trusted) so an unbacked claim can be
 * reported. Fetched only on the single-VIN path — the list path needs no provenance detail.
 */
const FACT_CONTEXT_COLUMNS = Object.freeze([
  'import_source',
  'duty_paid',
  'police_verified',
  'zimra_verified',
  'passport_verified',
  'safe_pay_ready',
  'inspection_ready',
]);

const TRUST_CACHE_SELECT = TRUST_CACHE_COLUMNS.join(', ');
const VEHICLE_TRUST_ROW_SELECT = [...TRUST_CACHE_COLUMNS, ...FACT_CONTEXT_COLUMNS].join(', ');

const LIMITATION_NO_EVALUATION = 'No canonical trust evaluation exists for this vehicle.';
const LIMITATION_UNVERSIONED =
  'A trust score is stored for this vehicle but carries no calculation version — it predates the '
  + 'canonical trust authority and is not published.';
const LIMITATION_UNAVAILABLE =
  'The canonical trust evaluation could not be produced for this vehicle, so no score is reported.';
const LIMITATION_NO_PROVENANCE = 'Governed fact provenance was not resolved for this evaluation.';
const LIMITATION_NO_BACKED_FACT =
  'No governed vehicle fact is backed by an authoritative record.';
const LIMITATION_UNSTAMPED =
  'The trust decision carries no evaluation timestamp, so it cannot be shown to be current.';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalizeVin(vin) {
  if (vin === null || vin === undefined) return null;
  const trimmed = String(vin).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A number, or null. The explicit null/undefined/'' guard is load-bearing: `Number(null)` is 0
 * and `Number('')` is 0, so a NULL trust_score or an absent count would otherwise become a
 * published zero — an evaluated "nothing found" fabricated out of "nothing recorded".
 */
function finiteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** An instant, or null. Same normalization as `textOrNull`; named for what it carries. */
const timestamp = textOrNull;

const LIMITATION_MALFORMED_DECISION =
  'The trust decision did not produce a usable score and band, so none is published.';

function limitationList(...groups) {
  const seen = new Set();
  for (const group of groups) {
    for (const entry of group || []) {
      if (typeof entry === 'string' && entry.trim() !== '') seen.add(entry);
    }
  }
  return Object.freeze([...seen]);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Coerce a stored/derived evidence basis into the declared shape. A malformed value becomes
 * `null` rather than a partial object: a basis with invented zeros would read as "we counted and
 * found none", which is a claim.
 */
function normalizeEvidenceBasis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const field of EVIDENCE_BASIS_FIELDS) out[field] = finiteScore(raw[field]);
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Record construction — PURE. Every state assignment happens in exactly one place.
// ---------------------------------------------------------------------------

/**
 * Build a canonical record. Enforces the invariants no individual caller can be trusted to keep:
 * a score is present if and only if the state is `evaluated`; a band is present if and only if a
 * score is; `known_limitations` is always an array; the record is frozen.
 */
function buildRecord({
  vin,
  evaluationState,
  score = null,
  band = null,
  confidence = 'not_evaluated',
  evidenceBasis = null,
  calculationVersion = null,
  evaluatedAt = null,
  limitations = [],
  source,
  cache = null,
  decision = null,
  facts = null,
}) {
  const evaluated = evaluationState === TRUST_EVALUATION_STATES.EVALUATED;
  const finalScore = evaluated ? finiteScore(score) : null;
  const finalBand = finalScore === null ? null : (TRUST_BANDS.includes(band) ? band : null);
  // A score whose band is not in the vocabulary cannot be published either — the pair is
  // meaningless apart, and publishing half of it would invite a caller to bucket it itself.
  const publishable = finalScore !== null && finalBand !== null;
  // An `evaluated` state that could not produce a publishable pair is DEMOTED rather than
  // half-published, and says so — silently downgrading would leave a caller with an
  // unexplained empty score.
  const demoted = evaluated && !publishable;

  return Object.freeze({
    vin,
    score: publishable ? finalScore : null,
    band: publishable ? finalBand : null,
    evaluation_state: demoted ? TRUST_EVALUATION_STATES.NOT_EVALUATED : evaluationState,
    confidence: TRUST_CONFIDENCE.includes(confidence) ? confidence : 'not_evaluated',
    evidence_basis: normalizeEvidenceBasis(evidenceBasis),
    calculation_version: calculationVersion,
    evaluated_at: timestamp(evaluatedAt),
    known_limitations: limitationList(demoted ? [LIMITATION_MALFORMED_DECISION] : [], limitations),
    source: TRUST_SOURCES.includes(source) ? source : 'none',
    // Internal, never projected by toPublicTrust().
    cache,
    decision,
    facts,
  });
}

/**
 * Confidence — the EVIDENCE-STRENGTH axis, and therefore capped by evidence that actually exists.
 *
 * The upstream `evidence_confidence` dimension bands `completeness_percent`, which counts SELF-
 * DECLARED identity fields (VIN, chassis, engine, plate typed into the listing) as requirements
 * met. A vehicle with nothing but typed-in metadata therefore reached 80% and was published as
 * `confidence: 'high'` beside `governed_facts_substantiated: 0` and `connected_sources: 0`. A
 * claim is not evidence (Principle 3), so that is the 84 again, one axis over.
 *
 * The upstream band is kept as a CEILING — completeness can still lower confidence — but it is
 * now floored by what is substantiated. This lives here rather than in trustDecisionService so
 * assembleDecision stays pure and CALCULATION_VERSION keeps meaning one fixed scoring function;
 * confidence is a reporting axis of the public contract, not an input to the score.
 */
function confidenceOf(decision, basis) {
  const dimension = decision?.dimensions?.evidence_confidence;
  if (!dimension || dimension.status === 'not_evaluated') return 'not_evaluated';
  const declared = TRUST_CONFIDENCE.includes(dimension.value) ? dimension.value : 'not_evaluated';
  if (declared === 'not_evaluated') return declared;

  // Unresolved provenance (null counts) cannot raise confidence above the evidence floor either.
  const substantiated = Number(basis?.governed_facts_substantiated ?? 0) || 0;
  const connected = Number(basis?.connected_sources ?? 0) || 0;
  const support = substantiated + connected;

  const ceiling = support === 0 ? 'low' : support < 3 ? 'medium' : 'high';
  const order = ['low', 'medium', 'high'];
  return order[Math.min(order.indexOf(declared), order.indexOf(ceiling))] ?? 'low';
}

/**
 * The provenance summary. `governed_facts_substantiated` counts facts an authoritative record
 * actually decided (clear or adverse); `governed_facts_adverse` is the negative subset of those,
 * so a vehicle with a real adverse finding is not mistaken for one with nothing.
 *
 * Every fact count is NULL when the resolver was not run — not 0. Zero means "resolved, and
 * nothing is backed"; null means "not asked". Collapsing the two is principle 9 in miniature.
 */
function evidenceBasisFrom(decision, facts) {
  const connected = finiteScore(decision?.dimensions?.source_coverage?.connected);
  if (!facts || typeof facts !== 'object') {
    return {
      governed_facts_total: null,
      governed_facts_substantiated: null,
      governed_facts_adverse: null,
      connected_sources: connected,
      unbacked_legacy_claims: null,
    };
  }
  const results = Object.values(facts);
  return {
    governed_facts_total: VEHICLE_FACT_KEYS.length,
    governed_facts_substantiated: results.filter((fact) => fact?.publishable === true).length,
    governed_facts_adverse: results.filter((fact) => fact?.status === FACT_STATUS.VERIFIED_ADVERSE).length,
    connected_sources: connected,
    unbacked_legacy_claims: unbackedLegacyClaims(facts).length,
  };
}

/** Disclosure the facts require. Facts can only ADD limitations; they never add score. */
function factLimitations(facts) {
  if (!facts || typeof facts !== 'object') return [LIMITATION_NO_PROVENANCE];
  const out = [];
  if (!Object.values(facts).some((fact) => fact?.publishable === true)) out.push(LIMITATION_NO_BACKED_FACT);
  const columns = [...new Set(unbackedLegacyClaims(facts).map((claim) => claim.column))].sort();
  for (const column of columns) {
    out.push(
      `The stored '${column}' flag on this vehicle is not supported by any authoritative record `
      + 'and is not published.',
    );
  }
  return out;
}

/**
 * Project a trustDecisionService decision into a canonical record. PURE.
 *
 * A decision whose calculation_version is not the running one is reported `stale` even though it
 * was just computed: "produced by different rules" is the same fact whether it came from a cache
 * row or from a replay of an archived decision.
 */
export function canonicalFromDecision(decision, { facts = null, cache = null } = {}) {
  if (!decision || typeof decision !== 'object' || !decision.overall_trust) {
    return buildRecord({
      vin: normalizeVin(decision?.vin) ?? '',
      evaluationState: TRUST_EVALUATION_STATES.UNAVAILABLE,
      limitations: [LIMITATION_UNAVAILABLE],
      source: 'none',
      cache,
    });
  }

  const vin = normalizeVin(decision.vin) ?? '';
  const version = textOrNull(decision.calculation_version);
  const evaluatedAt = timestamp(decision.last_updated);
  const basis = evidenceBasisFrom(decision, facts);
  const limitations = [...(decision.known_limitations || []), ...factLimitations(facts)];

  if (version !== CALCULATION_VERSION) {
    return buildRecord({
      vin,
      evaluationState: TRUST_EVALUATION_STATES.STALE,
      calculationVersion: version,
      evaluatedAt,
      confidence: confidenceOf(decision, basis),
      evidenceBasis: basis,
      limitations: [staleLimitation(version), ...limitations],
      source: 'computed',
      cache,
      decision,
      facts,
    });
  }

  if (evaluatedAt === null) {
    return buildRecord({
      vin,
      evaluationState: TRUST_EVALUATION_STATES.NOT_EVALUATED,
      calculationVersion: version,
      confidence: confidenceOf(decision, basis),
      evidenceBasis: basis,
      limitations: [LIMITATION_UNSTAMPED, ...limitations],
      source: 'computed',
      cache,
      decision,
      facts,
    });
  }

  return buildRecord({
    vin,
    evaluationState: TRUST_EVALUATION_STATES.EVALUATED,
    score: decision.overall_trust.value,
    band: decision.overall_trust.status,
    confidence: confidenceOf(decision, basis),
    evidenceBasis: basis,
    calculationVersion: version,
    evaluatedAt,
    limitations,
    source: 'computed',
    cache,
    decision,
    facts,
  });
}

function staleLimitation(version) {
  return `The stored trust score was produced by calculation version ${version || 'unknown'}; the `
    + `current version is ${CALCULATION_VERSION}. It is not published as canonical.`;
}

/**
 * Classify a cache row. PURE. The order is deliberate: a missing version outranks everything,
 * because it is the state every pre-existing hand-set score is in and it must never be reachable
 * through the `fresh` branch by any combination of the other columns.
 */
export function classifyCache(row) {
  if (!row || typeof row !== 'object') return TRUST_CACHE_STATUS.ABSENT;
  const version = textOrNull(row.trust_calculation_version);
  if (version === null) return TRUST_CACHE_STATUS.UNVERSIONED;
  if (version !== CALCULATION_VERSION) return TRUST_CACHE_STATUS.STALE;
  if (finiteScore(row.trust_score) === null) return TRUST_CACHE_STATUS.INCOMPLETE;
  if (timestamp(row.trust_evaluated_at) === null) return TRUST_CACHE_STATUS.INCOMPLETE;
  if (!TRUST_BANDS.includes(row.trust_band)) return TRUST_CACHE_STATUS.INCOMPLETE;
  if (!TRUST_CONFIDENCE.includes(row.trust_confidence)) return TRUST_CACHE_STATUS.INCOMPLETE;
  return TRUST_CACHE_STATUS.FRESH;
}

function cacheDescriptor(row, status) {
  return Object.freeze({
    status,
    present: Boolean(row),
    score: finiteScore(row?.trust_score),
    calculation_version: textOrNull(row?.trust_calculation_version),
    evaluated_at: timestamp(row?.trust_evaluated_at),
  });
}

function storedLimitations(row) {
  const raw = row?.trust_known_limitations;
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Project a cache row into a canonical record. PURE.
 *
 * This is the whole staleness rule in one function: only `fresh` yields a score, and every other
 * classification yields a null score plus a limitation naming why.
 */
export function canonicalFromCache(vin, row) {
  const key = normalizeVin(vin) ?? '';
  const status = classifyCache(row);
  const cache = cacheDescriptor(row, status);

  if (status === TRUST_CACHE_STATUS.FRESH) {
    return buildRecord({
      vin: key,
      evaluationState: TRUST_EVALUATION_STATES.EVALUATED,
      score: row.trust_score,
      band: row.trust_band,
      confidence: row.trust_confidence,
      evidenceBasis: row.trust_evidence_basis,
      calculationVersion: textOrNull(row.trust_calculation_version),
      evaluatedAt: timestamp(row.trust_evaluated_at),
      limitations: storedLimitations(row),
      source: 'cache',
      cache,
    });
  }

  if (status === TRUST_CACHE_STATUS.STALE) {
    const version = textOrNull(row.trust_calculation_version);
    return buildRecord({
      vin: key,
      evaluationState: TRUST_EVALUATION_STATES.STALE,
      calculationVersion: version,
      evaluatedAt: timestamp(row.trust_evaluated_at),
      limitations: [staleLimitation(version), ...storedLimitations(row)],
      source: 'cache',
      cache,
    });
  }

  const limitation = status === TRUST_CACHE_STATUS.UNVERSIONED
    ? LIMITATION_UNVERSIONED
    : status === TRUST_CACHE_STATUS.INCOMPLETE
      ? 'The cached trust evaluation is incomplete and is not published as canonical.'
      : LIMITATION_NO_EVALUATION;

  return buildRecord({
    vin: key,
    evaluationState: TRUST_EVALUATION_STATES.NOT_EVALUATED,
    limitations: [limitation],
    source: 'cache',
    cache,
  });
}

function unavailableRecord(vin, reason, cache = null) {
  return buildRecord({
    vin: normalizeVin(vin) ?? '',
    evaluationState: TRUST_EVALUATION_STATES.UNAVAILABLE,
    limitations: [LIMITATION_UNAVAILABLE, `reason:${reason}`],
    source: 'none',
    cache,
  });
}

// ---------------------------------------------------------------------------
// The public projection
// ---------------------------------------------------------------------------

/**
 * The ONLY shape a public surface may render.
 *
 * Accepts a canonical record from this service or a raw `assembleDecision`/`getTrustDecision`
 * decision, so a caller that already holds a decision does not need a second code path — and,
 * more importantly, cannot invent one.
 *
 * @param {object} input canonical record or trust decision
 * @returns {object} frozen object whose keys are exactly PUBLIC_TRUST_FIELDS
 */
export function toPublicTrust(input) {
  const record = input && typeof input === 'object' && input.overall_trust
    ? canonicalFromDecision(input)
    : input;

  if (!record || typeof record !== 'object') {
    return toPublicTrust(unavailableRecord('', 'no_input'));
  }

  const out = {};
  for (const field of PUBLIC_TRUST_FIELDS) out[field] = record[field] ?? null;
  out.known_limitations = Object.freeze([...(record.known_limitations || [])]);
  out.evidence_basis = record.evidence_basis ?? null;
  out.vin = record.vin ?? '';
  out.evaluation_state = TRUST_EVALUATION_STATE_VALUES.includes(record.evaluation_state)
    ? record.evaluation_state
    : TRUST_EVALUATION_STATES.UNAVAILABLE;
  out.confidence = TRUST_CONFIDENCE.includes(record.confidence) ? record.confidence : 'not_evaluated';
  out.source = TRUST_SOURCES.includes(record.source) ? record.source : 'none';
  return Object.freeze(out);
}

/**
 * Contract violations in a public shape, as reason-style codes. Empty means the shape honours the
 * contract documented at the top of this file. Exported so the guard suite and any converging
 * surface check the SAME rules rather than two drifting copies.
 */
export function publicTrustViolations(shape) {
  const violations = [];
  if (!shape || typeof shape !== 'object') return ['missing_shape'];

  const keys = Object.keys(shape).sort();
  const expected = [...PUBLIC_TRUST_FIELDS].sort();
  for (const key of keys) if (!expected.includes(key)) violations.push(`unknown_field:${key}`);
  for (const key of expected) if (!keys.includes(key)) violations.push(`missing_field:${key}`);

  if (!TRUST_EVALUATION_STATE_VALUES.includes(shape.evaluation_state)) {
    violations.push('evaluation_state_outside_vocabulary');
  }
  if (!TRUST_CONFIDENCE.includes(shape.confidence)) violations.push('confidence_outside_vocabulary');
  if (!TRUST_SOURCES.includes(shape.source)) violations.push('source_outside_vocabulary');
  if (shape.band !== null && !TRUST_BANDS.includes(shape.band)) violations.push('band_outside_vocabulary');

  const evaluated = shape.evaluation_state === TRUST_EVALUATION_STATES.EVALUATED;
  if (shape.score !== null) {
    if (!Number.isFinite(shape.score)) violations.push('score_not_a_number');
    else if (shape.score < 0 || shape.score > 100) violations.push('score_out_of_range');
    if (!evaluated) violations.push('score_published_without_evaluation');
    if (shape.calculation_version !== CALCULATION_VERSION) violations.push('score_published_off_version');
    if (shape.evaluated_at === null) violations.push('score_published_without_timestamp');
    if (shape.band === null) violations.push('score_published_without_band');
  } else {
    if (evaluated) violations.push('evaluated_without_score');
    if (shape.band !== null) violations.push('band_without_score');
  }

  if (!Array.isArray(shape.known_limitations)) violations.push('known_limitations_not_an_array');
  else if (shape.known_limitations.some((entry) => typeof entry !== 'string')) {
    violations.push('known_limitations_not_strings');
  }

  if (shape.evidence_basis !== null) {
    if (typeof shape.evidence_basis !== 'object' || Array.isArray(shape.evidence_basis)) {
      violations.push('evidence_basis_not_an_object');
    } else {
      for (const key of Object.keys(shape.evidence_basis)) {
        if (!EVIDENCE_BASIS_FIELDS.includes(key)) violations.push(`evidence_basis_unknown_field:${key}`);
      }
      for (const field of EVIDENCE_BASIS_FIELDS) {
        if (!(field in shape.evidence_basis)) violations.push(`evidence_basis_missing_field:${field}`);
        else {
          const value = shape.evidence_basis[field];
          if (value !== null && !Number.isFinite(value)) violations.push(`evidence_basis_not_numeric:${field}`);
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * The default fact reader: VIN-scoped, one table at a time, through the service-role client.
 * `loadFactInputs` degrades a rejecting table to no rows (which resolves to unknown), so a
 * missing registry table cannot decide the other six facts.
 */
function factReader(client) {
  return async (table, vin) => {
    const { data, error } = await client.from(table).select('*').eq('vin', vin);
    if (error) throw new Error(error.message);
    return data || [];
  };
}

async function readVehicleTrustRow(client, vin) {
  const { data, error } = await client
    .from(VEHICLES_TABLE)
    .select(VEHICLE_TRUST_ROW_SELECT)
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function readVehicleTrustRows(client, vins) {
  const { data, error } = await client
    .from(VEHICLES_TABLE)
    .select(TRUST_CACHE_SELECT)
    .in('vin', vins);
  if (error) throw new Error(error.message);
  return data || [];
}

// ---------------------------------------------------------------------------
// The read path
// ---------------------------------------------------------------------------

async function computeCanonicalTrust(vin, { decide, read, vehicle, now, cache, client }) {
  let facts = null;
  if (typeof read === 'function') {
    // Provenance is best-effort DISCLOSURE, not a gate: losing it must not withhold a score the
    // decision engine produced, it must show up as `evidence_basis: null` plus the limitation
    // saying provenance was not resolved.
    try {
      facts = await resolveVehicleFacts(vin, { read, vehicle });
    } catch {
      facts = null;
    }
  }

  let decision;
  try {
    // The vehicle row read above carries the cache stamp and the fact context, NOT the identity
    // columns identityDimension scores. Passing it as `opts.vehicle` would make every vehicle look
    // like it was missing its chassis, engine and plate, so the decision fetches its own row.
    decision = await decide(vin, {
      ...(now ? { now } : {}),
      ...(client ? { client } : {}),
    });
  } catch {
    return unavailableRecord(vin, 'decision_unavailable', cache);
  }

  return canonicalFromDecision(decision, { facts, cache });
}

/**
 * The canonical trust position for one VIN.
 *
 * @param {string} vin
 * @param {{
 *   client?: object,
 *   decide?: (vin: string, opts: object) => Promise<object>,
 *   read?: ((table: string, vin: string) => Promise<Array<object>>)|null,
 *   recompute?: 'if_stale'|'always'|'never',
 *   vehicleRow?: object|null,
 *   now?: string|null,
 * }} [opts] `read` is the fact resolver's data access; pass `null` to skip provenance resolution
 *   (the record then reports `evidence_basis: null`, never a fabricated zero).
 * @returns {Promise<object>} frozen canonical record; project with `toPublicTrust` before rendering
 */
export async function getCanonicalTrust(vin, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  const {
    decide = getTrustDecision,
    read,
    recompute = RECOMPUTE.IF_STALE,
    vehicleRow,
    now = null,
  } = opts;

  const key = normalizeVin(vin);
  if (key === null) return unavailableRecord('', 'invalid_vin');

  const factRead = read === undefined ? factReader(client) : read;

  let row = null;
  let readFailed = false;
  if (vehicleRow !== undefined) {
    row = vehicleRow;
  } else {
    try {
      row = await readVehicleTrustRow(client, key);
    } catch {
      readFailed = true;
    }
  }

  if (recompute === RECOMPUTE.NEVER) {
    return readFailed ? unavailableRecord(key, 'cache_read_failed') : canonicalFromCache(key, row);
  }

  const cache = readFailed ? null : cacheDescriptor(row, classifyCache(row));
  if (recompute === RECOMPUTE.IF_STALE && !readFailed) {
    const cached = canonicalFromCache(key, row);
    if (cached.evaluation_state === TRUST_EVALUATION_STATES.EVALUATED) return cached;
  }

  return computeCanonicalTrust(key, { decide, read: factRead, vehicle: row, now, cache, client });
}

/**
 * The canonical trust position for many VINs, for a list surface.
 *
 * CACHE ONLY, BY CONSTRUCTION — it accepts no `decide`, so a 48-card marketplace page issues ONE
 * query and cannot be turned into 48 recomputes by a caller passing an option. A VIN with no fresh
 * cache entry comes back `not_evaluated`/`stale` with a null score; the refresh job, not the read,
 * is what makes a score appear.
 *
 * Every requested VIN gets an entry, so a caller cannot silently drop the ones with no evaluation
 * (and then be tempted to substitute `vehicle.trust_score` for them).
 *
 * @param {Array<string>} vins
 * @param {{client?: object, chunkSize?: number}} [opts]
 * @returns {Promise<Map<string, object>>} vin -> frozen canonical record
 */
export async function getCanonicalTrustBatch(vins, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  const { chunkSize = BATCH_CHUNK_SIZE } = opts;

  const unique = [];
  const seen = new Set();
  for (const raw of Array.isArray(vins) ? vins : []) {
    const key = normalizeVin(raw);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }

  const out = new Map();
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : BATCH_CHUNK_SIZE;

  for (const batch of chunk(unique, size)) {
    let rows;
    try {
      rows = await readVehicleTrustRows(client, batch);
    } catch {
      // A failed read is NOT "these vehicles have no evaluation" — that would assert something
      // this call did not learn. The whole chunk reports `unavailable`.
      for (const key of batch) out.set(key, unavailableRecord(key, 'cache_read_failed'));
      continue;
    }
    const byVin = new Map();
    for (const row of rows) {
      const key = normalizeVin(row?.vin);
      if (key !== null) byVin.set(key, row);
    }
    for (const key of batch) out.set(key, canonicalFromCache(key, byVin.get(key) || null));
  }

  return out;
}

// ---------------------------------------------------------------------------
// The single writer
// ---------------------------------------------------------------------------

/**
 * The cache write, as a patch. PURE, and it REFUSES rather than degrades: a record that is not a
 * stamped evaluation under the running version yields `null`, so there is no path by which a
 * stale, unversioned or unavailable state can be persisted as if it were canonical.
 *
 * All seven columns move together. A score without its version is the defect this whole phase
 * exists to remove, so the patch cannot express one.
 */
export function buildCachePatch(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.evaluation_state !== TRUST_EVALUATION_STATES.EVALUATED) return null;
  if (record.calculation_version !== CALCULATION_VERSION) return null;
  if (!Number.isFinite(record.score)) return null;
  if (!TRUST_BANDS.includes(record.band)) return null;
  if (record.evaluated_at === null) return null;

  return Object.freeze({
    trust_score: record.score,
    trust_calculation_version: record.calculation_version,
    trust_evaluated_at: record.evaluated_at,
    trust_band: record.band,
    trust_confidence: record.confidence,
    trust_known_limitations: [...record.known_limitations],
    trust_evidence_basis: record.evidence_basis,
  });
}

/**
 * Recompute the canonical decision for a VIN and materialize it into the cache.
 *
 * THE ONLY WRITER of `vehicles.trust_score` in the canonical model (INV-TRUST-2). Always
 * recomputes — a refresh that trusted the cache it is refreshing would never converge.
 *
 * @param {string} vin
 * @param {{client?: object, dryRun?: boolean} & Parameters<typeof getCanonicalTrust>[1]} [opts]
 *   `dryRun` returns the patch without writing, for shadow-compare runs (FACT_MODEL.md §5.2 M2).
 * @returns {Promise<{record: object, patch: object|null, written: boolean, reason: string|null}>}
 */
export async function refreshCanonicalTrust(vin, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  const { dryRun = false, ...rest } = opts;

  const record = await getCanonicalTrust(vin, { ...rest, client, recompute: RECOMPUTE.ALWAYS });
  const patch = buildCachePatch(record);
  if (patch === null) {
    return { record, patch: null, written: false, reason: `not_canonical:${record.evaluation_state}` };
  }
  if (dryRun) return { record, patch, written: false, reason: 'dry_run' };

  const { error } = await client.from(VEHICLES_TABLE).update(patch).eq('vin', record.vin);
  if (error) return { record, patch, written: false, reason: `write_failed:${error.message}` };
  return { record, patch, written: true, reason: null };
}

export default {
  CALCULATION_VERSION,
  PUBLIC_TRUST_FIELDS,
  EVIDENCE_BASIS_FIELDS,
  TRUST_CACHE_COLUMNS,
  TRUST_EVALUATION_STATES,
  TRUST_BANDS,
  TRUST_CONFIDENCE,
  TRUST_SOURCES,
  TRUST_CACHE_STATUS,
  RECOMPUTE,
  getCanonicalTrust,
  getCanonicalTrustBatch,
  toPublicTrust,
  refreshCanonicalTrust,
  canonicalFromDecision,
  canonicalFromCache,
  classifyCache,
  buildCachePatch,
  publicTrustViolations,
};
