# PR #197 Audit and Merge Rehearsal

**#197 frozen hardened SHA:** `5683b74edaaa86a01c55005839b8f092aea8fccb`
(`feat/service-network-foundation-1-0`, Draft, base `main`).

**No rebase was performed. #197 was not modified.** Everything below is read-only analysis
plus throwaway `git merge-tree` rehearsal — no rehearsal branch was created or pushed.

---

## 1. What #197 is, measured

72 files: 17 `backend/services/serviceNetwork/*`, 6 routes, `backend/server.js`, 6 migrations
(`20260904120000`–`20260904170000`), 6 `database/test/*.mjs`, 21 backend tests, 14 docs
receipts, 8 web files.

**Shared files with #194: exactly TWO** — `backend/server.js` and `web/src/App.tsx`.

Both branches fork from the same merge-base with `main` (`ba208963`).

---

## 2. Does #197 create a second transaction/event mechanism? **No.**

This was the sharpest risk and it is cleanly answered:

- `serviceCaseService.js:2` imports `emitDomainEvent` from **#194's own**
  `../eventBus/eventBusService.js`, used at `:173` as `deps.emitDomainEvent || emitDomainEvent`.
- No `*_outbox` table, no second poller, no `registerServiceNetworkListeners`.
- It touches neither `backend/services/eventBus/*` nor `backend/services/blockchain/*`.
- `service_case_events` is a per-aggregate append-only history (the
  `vehicle_ownership_transfer_events` shape), not a transport.
- Zero `SECURITY DEFINER` in its six migrations.

#197 states the restraint in its own source at `serviceCaseService.js:404-406`: *"True
single-transaction emission needs the SECURITY DEFINER RPC pattern #194 finalises … a
competing event mechanism is deliberately not introduced."*

**What it adds instead** is a hand-rolled compensating saga (`serviceCaseService.js:407-428`)
standing in for #194's atomic RPC — and that saga carries a confirmed defect:

> **P1 — the compensating rollback discards its own error and reports success
> unconditionally** (`serviceCaseService.js:419`). Recorded as a #197-lane obligation; not
> fixed here, because #197 is frozen this cycle.

**No claim of full state + history + outbox atomicity is made** by #197 or by this audit.

---

## 3. The `[#194-sensitive]` obligations

The brief said twelve. The literal marker appears on **22 lines** (9 inline in S0, 1 in S6,
12 section headings across S1–S10), resolving to **20 distinct actionable obligations**.
Correcting the count matters: an obligation register that under-counts is how one gets missed.

**None of the twenty lands inside the Seller exclusion boundary.** #197 touches no
Seller-owned file. Every open item is resolvable independent of Seller.

### (c) Stale — no longer applicable, no action

| Obligation | Why stale |
|---|---|
| "unauthenticated `/api/organizations/:id/branches` and `/:id/users` — hardening arrives via rebase" | **#194 already did it.** `main:1876,1891` are bare; #194 `HEAD:1936,1952` have `authorizeRole()`. #197 carries main's form but does not touch those lines, so the merge takes #194's hardened version. |
| "`/api/garage/*` namespace shared with #194 Intelligence analytics" | Zero collision. #194's only `/api/garage` path is `/api/garage/analytics`; #197 claims `/profile`, `/branches`, `/queue`, `/customers`, `/service-cases`. |
| "`web/src/App.tsx` route registration collides with #194's public-route additions" | #197 adds 2 lines; `merge-tree` reports *changed in both* with **zero** conflict markers. |
| "`MainLayout.tsx`/`CompactBottomNav` and `PartsTracking.tsx` rewritten by #194" | #197 touches none of them. |

### (a) Resolvable independent of Seller — confirmed SAFE, no work needed

| Obligation | Evidence |
|---|---|
| "#194's transfer authority is the only ownership writer" | #197 only **reads** `vehicles.owner_id` (`serviceAuthority.js:84`, `ownerServiceHistoryService.js:75`). No ownership writer in any of the 72 files. |
| "Provenance is a strict superset of #194's frozen `SERVICE_AUTHORITIES`" | #194's set is `{professional_governed, owner_declared, partner_record, unknown}`; #197 never imports or redefines it. |
| "S4's additive columns must keep #194's three `mechanic_work_orders` consumers valid" | S4's migration is `ADD COLUMN IF NOT EXISTS` only — no rename, no CHECK mutation. |
| "`featureRegistry.ts` — garages taken over, not duplicated" | Neither branch touches it; `product.garages` / route `/garages` already exist on `main`. |

### (a) Open — real work, deferred by design

| # | Obligation | State |
|---|---|---|
| O1 | Extend `passportServicePartsProjection` + `passportLifecycleTimeline`; never fork a third timeline | #197 built only the **owner** projection and left the public/buyer surface untouched. No fork; extension unwritten. |
| O2 | Populate `target_provider_tenant_id` inside #194's `marketplaceInquiryService.createInquiry` | #197 correctly does **not** fork `createInquiry`. **Load-bearing and ordered**: re-pointing the intelligence read before populating the column would drive I9 service demand to zero. |
| O3 | Re-point I9 `seller_*` reads to `target_provider_tenant_id`; reconcile NOT_MEASURABLE | Blocked on O2. |
| O4 | Register `service.*` in `DETERMINISTIC_EVENT_IDENTITY_FIELDS` **and** the DB dedupe trigger in lockstep | **Verified harmless until done**: `communication_domain_event_dedupe_key()` branches on 3 literals, so `service.*` rows get `NULL` dedupe_key, and the index is PARTIAL over `NOT NULL` — no unique-violation hazard, just no idempotency. |
| O5 | Author §15.4 communication subscriptions post-rebase | **Verified benign**: #197 emits `service.case.*` but subscribes nothing; `eventWorker.js:189` gets an empty handler list and still marks the row processed at `:223-226`, so no outbox pile-up. |
| O6 | `PUBLIC_LOOKUP_KINDS` is deliberately a list of one; a public service-link lookup must be added openly | **Trigger condition already met, unaddressed.** #194 pins it at `backend/utils/passportLookupPolicy.js:42` and asserts `deepEqual([...PUBLIC_LOOKUP_KINDS], [VIN])`. |
| O7 | Owner service history should feed `canonicalVehicleLifecycleService`'s single story | #197 does not touch `vehiclesRoutes.js`. No conflict; convergence unwritten. |
| O8 | Extend `activityEventTypes.js` + `marketplace_activity_events` CHECK in lockstep | Not started. |
| O9 | Directory trust display must use the `canonicalTrustService` batch | Not yet applicable — #197 ships no trust display. |
| O10 | Evidence taxonomy additions must be module + seed migration in lockstep | Not yet applicable — #197 adds no taxonomy classes. |

---

## 4. Merge rehearsal (throwaway, evidence only)

Method: `git merge-tree` against the true merge-base. **No branch or worktree was created,
so none needed deleting.**

```sh
git merge-tree --write-tree --messages \
  origin/feat/service-network-foundation-1-0 hardening/non-seller-convergence
```

### Result: ONE conflicted file, two trivial hunks

| File | Outcome |
|---|---|
| `backend/server.js` | **CONFLICT** — 2 hunks, 4 marker lines |
| `web/src/App.tsx` | changed in both, **auto-merges clean (0 markers)** |
| `database/migrations/` | **no conflict, no collision** |
| `web/src/config/featureRegistry.ts` | neither branch touches it |

### Semantic resolution rule for `backend/server.js` — not "ours/theirs"

Both hunks are **pure additive adjacency**: each side appended to the same insertion point.

**Hunk (i)** — import block after `import partsentryReviewRouter`:
#197 adds 7 lines (`garageDirectoryRouter`, `serviceCaseRouter`, `serviceWorkOrderRouter`,
`serviceRecordRouter`, `serviceLinkRouter`, `garageQueueRouter`, `getOwnerServiceHistory`);
#194 adds 1 (`passportOwnershipTransferRouter`).

**Hunk (ii)** — mount block after `app.use(partsentryReviewRouter)`:
#197 adds 6 `app.use` lines; #194 adds `app.use(passportOwnershipTransferRouter)`.

> **Rule: union both sides, preserving each side's internal order. Never choose one side.**
> Choosing "ours" silently unmounts #194's ownership-transfer router; choosing "theirs"
> silently unmounts all six Service Network routers. Both are silent — the server still boots
> and the routes simply 404.

> **CAUTION.** The auto-merged hunks immediately surrounding the conflict carry #194's
> **Seller-owned** imports (`createAuthEmailService`, `normalizeRegistrationProfile`) and
> `normalizeVehicleTaxonomyInput` / `buildCanonicalVehicleLifecycle`. A hand-resolution that
> rewrites the import block rather than merging it **will drop them**.

### Verified absent collisions

- **Route paths:** 34 new #197 paths vs 574 existing #194 paths → **zero collisions**
  (mechanically compared).
- **Migrations:** #194 tops out at `20260830060000`; #197 starts at `20260901120000`.
  Disjoint filenames, correct lexicographic ordering, no prefix collision.
- **Services:** all 10 #197 services are namespaced under `services/serviceNetwork/` — no
  name collision with any existing service.
- **Duplicate event registrations:** none.

### Semantic collisions that git will merge SILENTLY

These are #194-side files #197 never edits, so there is no textual conflict to warn anyone —
the contracts simply stay unreconciled. **Re-verify each post-merge:**

`DETERMINISTIC_EVENT_IDENTITY_FIELDS` · `SERVICE_AUTHORITIES` · `NOT_MEASURABLE` ·
`COMMUNICATION_EVENT_TYPES` · `marketplaceInquiryService.createInquiry`

---

## 5. What was NOT done, deliberately

- **#197 was not rebased.** Its hardened authority stays at `5683b74e`.
- **No rehearsal branch was pushed.** The rehearsal used `merge-tree` only.
- **The #197-lane saga defect (§2) was not fixed** — #197 is frozen this cycle.
- **No second implementation of #194's transaction/event mechanism was created.** #197
  already consumes #194's, correctly.

**#197 FINAL REBASE NOT YET PERFORMED.**
