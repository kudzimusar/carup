# V14 — External Source / Institutional Adapter Framework

**Date:** 2026-08-28
**Phase:** V14 — External Source / Institutional Adapter Framework
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Reused authority

V14 reuses the existing canonical source-verification architecture:

- `sourceVerification/verificationContract.js`;
- `sourceVerification/sourceVerificationService.js`;
- `sourceVerification/governmentActivation.js`;
- `providerPlatform/providerRegistry.js`.

Passport does not create a second provider registry or provider execution path.

## Files

- `backend/services/passport/passportExternalSourceAdapter.js`
- `backend/tests/passport-v14-external-adapter.test.js`

## Descriptor contract

An institutional source descriptor must define:

- provider/authority;
- capability;
- legal basis;
- request identity;
- response schema;
- source timestamp field;
- evidence retention;
- retry policy;
- credential reference;
- audit policy;
- privacy policy;
- user-visible wording;
- operating mode.

Credential references may name a secret location/key but may not contain a secret value.

## Operating-mode honesty

The Passport contract preserves the canonical source modes:

- live;
- partner_file;
- manual_verification;
- sandbox;
- unavailable.

A source may claim `live` only with concrete staging/production runtime proof containing:

- connected=true;
- environment;
- observed_at;
- request_id;
- provider_response_id.

## Result semantics

- `no_record` is not clearance;
- `unavailable` yields no conclusion;
- mismatch/adverse results remain visible as governed review states;
- non-live modes cannot imply official/live verification.

Public projections withhold provider source-record identifiers by default.

## Activation boundary

No external provider is activated by this phase.

The existing live government transport remains fail-closed when credentials/connectivity are unavailable.

## Exact-head certification

Certified head:

- exact head: `a553aa48e27c8e1ff20b34e0d1567a5845ee0a81`
- Vehicle Passport Foundation CI run: `33168123112` — **PASS**
- Passport V1–V14 cumulative contracts — PASS
- canonical source verification — PASS
- canonical Communications/Trust/governance/evidence/lookup/service/PartSentry guards — PASS
- syntax/diff hygiene — PASS

The preceding V14 run caught a false-positive wording guard: safe wording `not a clearance` was rejected merely because it contained the word `clearance`. The guard now detects affirmative reassurance (for example `cleared`, `verified by`, `clean record`, `no issues`) while allowing explicit cautionary negation. Positive-claim rejection tests were added.

## Phase decision

**V14 PASS. V15 AUTHORIZED.**
