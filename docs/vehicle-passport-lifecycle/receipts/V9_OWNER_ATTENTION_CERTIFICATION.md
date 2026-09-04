# V9 — Owner Cockpit and Next Actions Foundation Certification

**Date:** 2026-08-28
**Phase:** V9 — Owner Cockpit and Next Actions
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Scope

V9 establishes the Passport Attention Rail contract.

It derives actions only from supplied canonical state or consumes already-governed Intelligence recommendations. It does not reproduce Intelligence rules.

## Files added

- `backend/services/passport/passportAttentionRail.js`
- `backend/tests/passport-v9-attention-rail.test.js`

## Priority vocabulary

Actions are explicitly:

- required;
- recommended;
- informational.

## Governed basis

Every action requires a basis with:

- origin;
- source type;
- source reference where available;
- source state;
- measurement time where applicable.

Origins are limited to:

- canonical state;
- governed Intelligence;
- explicit estimate.

## Supported deterministic actions

The foundation can surface, when backed by supplied state:

- verify ownership;
- resolve ownership claim;
- resolve discrepancy;
- add actionable missing evidence;
- ownership-transfer action;
- authoritative/explicitly-estimated due item;
- PartSentry issue.

## Due-date honesty

A due date cannot be shown without `due_basis`.

An estimated date must be:

- explicitly marked estimated;
- advisory;
- sourced as an explicit estimate.

Passport does not calculate due dates from the current clock.

## Intelligence boundary

PR #185 currently owns the governed next-best-action engine.

Passport V9 does not import or reproduce its rules.

It accepts only recommendation outputs where:

- Intelligence availability is `value`;
- the recommendation explicitly fired;
- rule/action/provenance are supplied.

When Intelligence is unavailable, Passport records abstention and generates no advice from that absence.

## Tests

V9 proves:

1. ownership verification action is required and sourced;
2. unresolved discrepancy carries governed provenance;
3. unsupported due dates are rejected;
4. estimates are visibly estimates/advisory;
5. unavailable Intelligence produces abstention, not advice;
6. governed Intelligence recommendation remains advisory and traceable;
7. unknown evidence produces advice only when explicitly actionable;
8. priority ordering;
9. no Intelligence-rule duplication/database ownership/date fabrication.

## Exact-head certification

Certified code head:

- exact code head: `8ec576d439f8f32364448f211c2065e5deb6aa8c`
- Vehicle Passport Foundation CI run: `33164934145` — **PASS**
- Passport V1–V9 cumulative contracts — PASS
- canonical service/PartSentry/Trust/source/governance/evidence/lookup guards — PASS
- syntax/diff hygiene — PASS

## Phase decision

**V9 FOUNDATION PASS.**

V10 begins cross-surface convergence. Runtime modifications to Seller/Marketplace-owned files remain blocked while PR #182 owns those files, but executable parity contracts may proceed in Passport-owned files.
