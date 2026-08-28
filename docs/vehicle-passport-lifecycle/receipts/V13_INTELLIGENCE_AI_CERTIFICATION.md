# V13 — Passport Intelligence and Gutu AI

**Date:** 2026-08-28
**Phase:** V13 — Passport Intelligence and Gutu AI
**Status:** IMPLEMENTED / EXACT-HEAD CI PENDING

## Scope

V13 defines the Passport-side advisory envelope for governed Intelligence and Gutu AI.

It does not create a second Intelligence engine and does not invoke a model.

## Files

- `backend/services/passport/passportAiAdvisory.js`
- `backend/tests/passport-v13-ai-advisory.test.js`

## Governed context

Every fact must carry:

- key;
- source;
- value when available;
- explicit availability;
- explicit reason when unavailable.

Unavailable facts remain present as unavailable rather than disappearing from context.

## Advisory capabilities

Passport AI may:

- explain;
- summarize;
- guide;
- recommend.

A factual claim must cite available governed facts.

An unavailability statement must cite facts explicitly marked unavailable.

Recommendations must be supplied as governed recommendations; Passport AI may not invent its own business-rule authority.

## Hard authority boundary

Passport AI cannot:

- set or refresh Trust;
- verify ownership;
- complete ownership transfer;
- certify evidence;
- approve discrepancies;
- rewrite history;
- publish a listing;
- reserve a vehicle;
- send a notification.

Explicit Trust, ownership or evidence-certification overrides fail closed.

## Abstention

If the governed Intelligence context is unavailable, the only valid outcome is abstention.

No absence is converted into advice, reassurance, score, estimate or authority.

## Intelligence reconciliation

PR #185 already owns the governed Intelligence/Gutu context and post-answer guardrails.

V13 consumes that architecture conceptually and does not import or reproduce its recommendation rules.

## Phase decision

**V13 IMPLEMENTED. EXACT-HEAD CI REQUIRED BEFORE V14.**
