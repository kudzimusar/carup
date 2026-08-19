# Phase 6 transaction-authority delta — first takeover slice

Status: **ACTIVE / NOT CERTIFIED**

Parent certified Phase 5 SHA: `119aaa9bfcbb38942e5fc9acdc9bbda09a443ce3`.

This slice closes only the first authority bypasses. It does **not** claim Phase 6 complete.

Measured defects at the Phase 5 head:

- the generic escrow route accepted buyer/seller and eligibility booleans from the request body;
- an authenticated participant could request provider-confirmed money states through the general transition route;
- transaction reads were role-gated at the HTTP layer but not participant-scoped by session identity;
- Marketplace transaction economics were not snapshotted on the canonical `escrow_trust_sessions` session;
- the canonical route had no server-only resolver tying authenticated buyer, listing seller, price/currency provenance and Trust dimensions together.

This slice:

- derives buyer from authenticated `userContext` only;
- derives seller from the listing relationship only;
- derives amount/currency from the listing and requires `currency_source` provenance;
- derives escrow eligibility from the canonical Trust decision, not request booleans;
- snapshots transaction terms on the existing escrow-trust session model;
- makes missing eligibility evidence fail closed;
- keeps provider-confirmed `funded_sandbox`, `released_sandbox`, and `refunded_sandbox` states system/provider-only, including against privileged human roles;
- scopes session reads to the buyer/seller or privileged reviewer/admin;
- removes client `gate_context` from the transition path;
- keeps provider webhooks limited to provider-state reconciliation, not CarUp eligibility assertions.

Migration `20260819100000_issue164_phase6_transaction_terms.sql` is **authored only and remains unapplied** until the single guarded staging cutover after Phase 6.

Still open in Phase 6A after this slice:

1. make vehicle reservation buyer-bound, atomic, idempotent and race/re-extension safe on PostgreSQL;
2. migrate the live Vehicle Detail hook away from legacy `/api/safepay/*` browser payloads;
3. retire or strictly contain the legacy SafePay direct-create/direct-status routes;
4. derive finance applicant and requested economics entirely server-side where appropriate;
5. publish a public-safe transaction/reservation summary so React never guesses a server-known state;
6. add real-PostgreSQL proof and mutation certification for the completed Phase 6 contract.

No staging or production write is authorized by this document.
