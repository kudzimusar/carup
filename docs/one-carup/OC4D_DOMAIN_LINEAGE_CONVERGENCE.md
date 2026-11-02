# OC-4D — Domain lineage convergence

**Branch:** `integration/oc4d-domain-lineage-convergence`. It is based on the OC-4C head `c60e4a49`, so the lineage stays linear: no merges, no rebases, 0 behind `main`.

**Status:** source only. Nothing is deployed, and no migration is applied anywhere.

**Method:** never merge an open PR wholesale. Each PR was reconciled against this lineage, and only its valid, unique remainder was implemented, in the programme's priority order: Identity / People / Compliance → Seller → Garage / Mechanic / Service Network → Marketplace reliability → Trade OS remainder → Scenario infrastructure.

## What landed

### Before the #208/#209 reconciliation

| Commit | Source | What |
|---|---|---|
| `b01ce7ef` | #218 (cherry-pick) | `git.deploymentEnabled: false` in the root, web and backend `vercel.json` |
| `25696e28` | test | Release-only deployment pin |
| `c7d08100` | #211 (net diff) | Scenario Lab: golden trade scenarios, dry-run only. Also fixes #211's own failing test: `scenarioRunId` was never read. |
| `02853cf6` | #213 slice C | Owner Communications test IDs |
| `33d7fe26` | #213 slice E | Landing page `fixture_scope` pass-through |
| `4cd8cecc` | #184 (docs) | Intelligence canonical plan; this lineage's receipts already linked to it |

### People & Compliance, from #208

**`8d6f497f` — P2.** One six-string "who must act next" vocabulary, plus four domain-owned projections:

- identity phase;
- seller authority status;
- dealer compliance;
- ownership-transfer state.

Each projection is total, fails by name when a state is unmapped, and stores nothing. P1 was already here (via #194).

**`5a6c24a9` — P3 to P6, plus fixes C2, C3 and C8.**

- **P6 (security, was live here):** a reviewer can no longer decide their own identity verification session.
- **P3 — read model:** `GET /api/admin/people/:userId/review` is a read-only, person-centred aggregate.
  - It has no combined "verified seller" field, no artefacts, no internal notes and no reviewer ids.
  - It requires a role gate with no x-user-id fallback, plus a proven session holding the new `person.read_private` capability.
- **C8:** every section fails closed with a 503 that names the section.
- **P4 — workspace:** acts only through the owning domain routes.
  - C2: sends the governed decision fields.
  - C3: has no `pass_review` verb.
- **P5:** `dealer.compliance.decided` has the privacy-corrected payload from O2-X6. The reviewer's free text stays in the ledger.
  - Communications subscribes to the event.
  - A governed template registration migration was added, because unregistered keys fail closed. It is source only.
- **Not ported:** #208's X6 identity-assurance block, and the C1 step-up runner. Both belong to slices this lineage does not have.

### Dealer authority, from #208 — `981ab07b` (security, was live here)

**The defect.** `authorizeRole` sets the tenant from `x-tenant-id` whenever any `tenant_users` row exists. Raw `vehicle.tenant_id === userContext.tenantId` therefore turned a membership — including a mechanic's — into selling authority. A member could:

- list as the organisation;
- publish, unpublish, reprice and mark vehicles Sold;
- link and read private evidence and documents;
- run OCR on private documents.

Separately, an admin's request body could name any owner or tenant as the seller.

**The fix.** One primitive, `services/dealer/dealerListingAuthority.js`. Authority is all of the following:

- effective role `dealer`;
- a membership that acts for the business (owner, admin or dealer);
- an active tenant of dealership type;
- no suspended dealer profile.

This check governs:

- creation and existing-Passport reuse;
- vehicle status, and publish / unpublish / price;
- seller-draft, completeness, and the seller-authority state read;
- evidence: upload scope, private read and link-event;
- the four media-router routes;
- the recognition primitive.

**The same defect in code #208 never saw**, now routed through the same primitive:

- `vehicleDocumentOcrService.requireVehicleScope` used platform role + raw equality.
- `listInquiriesForSeller` gave every member of a seller tenant that tenant's buyers' names, emails, phones and messages. The route admits any role.

**Deliberately kept outside**, as #208 classified them, and pinned:

- Service Network assignment;
- PartSentry service writes;
- lender/insurer object authority.

### Smaller ports

- `eca2787c` — #209's 19 GMO-1 tests, verbatim, now guarding C3's port of the garage application.
- `75a032de` — #208 U1: a signed-in caller is no longer looped back to login by an unregistered route.
- `abb5df44` — CI: this branch runs a dedicated `oc4d-domain-convergence` job.

## Recorded, not ported (the full table lands with Phase 7 in `docs/one-carup/ONE_CARUP_OPEN_PR_DISPOSITION.md`)

**#208**
- **Still required:** X2, X3, X5, X6, U2 and U3.
- **Blocked on owner decisions:**
  - X4 (biometric provider);
  - X5A (the idempotency migration, and whether a signed checksum stamp sits beside the provenance authority);
  - which step-up UI survives.
- **Reasons X3 waits:**
  - It is 26 files and about +2,200 lines.
  - It is entangled with X2.
  - It adds a `user_sessions` migration on the custom-auth hot path.
  - Three O2 modules still import the retired `askGemini`. They must be re-pointed to `domainAdvisoryAdapter` when ported.

**#209 / #197**
- **Still required:** Service Network, and GMO-3 to GMO-7.
  - GMO-3 and GMO-4 are blocked on #208 X3/X6.
  - GMO-6/7 need fix **F1** before they port: invitation and membership services must require `tenants.type = 'garage'`.
- **Two session-tenant rules must converge first:**
  - this lineage's sole-membership rule;
  - #197's oldest-membership rule.
- #197's `/api/service-history/me` reshape breaks the mobile garage screen.
- Four migration timestamps collide.
- **Role catalogue (`20260906220000`):** travels with the membership writers. No product path writes `tenant_users` today (only the migration-002 seed and a staging bootstrap script). Count the roles on staging and production before applying it.

**#213**
- A/B need an ops recompute plan.
- D needs owner sign-off; it changes the production inquiry path.
- F needs a sibling spec.
- Phase O needs an owner decision.
- As-is it is blocked: its stale whole-file copies regress OwnerDashboard and SellerIntelligence.

## Findings for the owner

1. **Governed template registry gap.** Once the registry exists, an unregistered template key fails closed. The following keys are registered by no migration, so their notifications would dead-letter wherever the registry is deployed:
   - `seller_authority_v1`
   - `verification_decision_v1`
   - `evidence_review_v1`
   - `listing_moderation_v1`
   - `vehicle_trust_update_v1`
   - `safetrade_transaction_v1`

   `dealer_compliance_decision_v1` is now registered (`20261004150000`).
2. **PartSentry partial write.** `addRepairLog` inserts the log and moves the canonical odometer before the ledger write. A refused ledger write (for example, custody rollout not FINALIZED) therefore answers 400 with the log and mileage already persisted, and the 5-minute idempotency block then rejects the retry. This predates OC-4; OC-4E's mechanic journey exposed it.
3. **PartSentry service writes.** For non-mechanic roles, these still accept raw tenant membership (kept as #208 classified it). Decide whether a dealership membership should log repairs.

## Proof

**Backend full suite at `abb5df44`:** 7,247 tests.

| Result | Count | Note |
|---|---|---|
| Pass | 7,223 | |
| Fail | 1 | Historical SAILING MATCH #1169, unchanged since OC-4A |
| Skipped | 23 | |

**Other suites:**

| Suite | Result |
|---|---|
| Web full | 192 files / 1,953 tests, all pass |
| Web `tsc` (`tsconfig.app.json`) | 0 errors |
| Mobile `tsc` | 0 errors |
| Mobile `test:native` set | Passes |

The mobile static guard (`tab-stability-guard`) has one failure: the escrow screen sends the ngrok header on 1 of 2 fetches. It is pre-existing — `escrow.tsx` is unchanged since `main` — and it is not in CI's native set.

**Mutation testing:** each mutant was killed by its intended test.

| Slice | Killed |
|---|---|
| People & Compliance, backend | 8/8 |
| People & Compliance, web | 3/3 |
| Dealer authority | 15/15, including a governed call whose result is discarded |

**CI:** run 37191229196 at `abb5df44` — 9 jobs passed, and the 2 deployed-only jobs were skipped by design.
