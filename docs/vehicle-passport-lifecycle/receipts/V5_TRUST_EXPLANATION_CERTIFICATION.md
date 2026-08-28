# V5 — Canonical Trust Explanation Foundation Certification

**Date:** 2026-08-28
**Phase:** V5 — Trust Explanation Layer
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Scope

V5 adds a Passport **Trust Lens** over the existing canonical public Trust contract.

It does not calculate, refresh, persist, score or re-band Trust.

## Files added

- `backend/services/passport/passportTrustLens.js`
- `backend/tests/passport-v5-trust-lens.test.js`

CI extended to run the V5 contract and the permanent Issue #164 canonical Trust public-read-path suite.

## Canonical dependency

V5 consumes:

`backend/services/trustDecision/canonicalTrustService.js`

including its frozen public fields and vocabularies for:

- evaluation state;
- Trust band;
- confidence;
- evidence basis;
- source;
- known limitations.

## Trust Lens rules

The Passport validates and relays canonical Trust.

It never:

- derives a band from score thresholds;
- substitutes a legacy score;
- turns not-evaluated into zero;
- turns low evidence into a flattering state;
- merges confidence into score;
- merges evidence completeness into Trust;
- queries a database;
- imports the deprecated Trust Graph engine.

## Presentation semantics

The Lens presents:

- canonical evaluation state;
- canonical score only when evaluated;
- canonical band;
- confidence as a separate axis;
- evidence basis;
- known limitations;
- calculation version/freshness fields;
- source.

Presentation labels are direct labels over canonical state, not new Trust categories.

Examples:

- evaluated + insufficient_evidence → “Insufficient evidence”;
- stale → “Trust needs refresh”;
- unavailable → “Trust unavailable”;
- not_evaluated → “Not evaluated”.

## Important invariant

A real evaluated zero remains `0`.

A not-evaluated vehicle remains `score: null`.

These are not equivalent.

## Tests

V5 proves:

1. evaluated Trust is relayed without score-based rebucketing;
2. genuine evaluated zero remains zero;
3. not-evaluated remains null;
4. stale/unavailable states cannot carry a publishable score;
5. confidence remains independent from score;
6. only canonical public Trust fields enter the Passport canonical sub-object;
7. malformed evidence basis fails closed;
8. Trust Lens contains no scoring engine, threshold logic, database ownership or legacy Trust cache use.

## Exact-head certification

Certified code head:

- exact code head: `dcfc39df981dac2e6281c1f174927b95cf46764f`
- Vehicle Passport Foundation CI — **PASS**
- full repository `backend-and-build` — **PASS**
- repository Playwright — **PASS**
- Communications unit/postgres/staging integration checks — **PASS**
- Referral CI — **PASS**
- canonical Trust public-read-path guard — **PASS**
- Passport V1–V5 cumulative contracts — **PASS**
- Seller PR #182 current head at reconciliation: `dd17593c603a53fe65d4719ec84c2518d50e2397`
- changed-file overlap with Seller PR #182 — **0 files**

## Phase decision

**V5 FOUNDATION PASS.**

The branch is clean enough to advance into V6 while preserving the Seller/shared-surface stop line.
