# Non-Seller Convergence Hardening — Pre-Seller Checkpoint Receipt

**This is NOT final product certification.** It records what was hardened, what was proven,
and what remains open, at a checkpoint taken deliberately *before* the Seller join.

---

## 1. Authorities

Every SHA was re-fetched and independently verified at the start of the cycle. Three of them
moved *during* it, which is why re-verification is the first step of the join sequence too.

| Ref | Branch | SHA at cycle start | SHA at cycle end |
|---|---|---|---|
| `main` | `main` | `ba208963d863654157335189c60f587cbe330041` | unchanged |
| PR #194 | `integration/vehicle-passport-v16-cert` | `43204beeec40123b0cce0c457aded6d0f733c4bc` | unchanged |
| PR #196 | `docs/service-network-foundation-1-0-plan` | `30728299e9e60b1c1d51b3eff8363db080edf22f` | **`be8706db80e7c14f839d917b72384041141958dc`** (another session) |
| PR #197 | `feat/service-network-foundation-1-0` | `5683b74edaaa86a01c55005839b8f092aea8fccb` | unchanged (**frozen, not rebased**) |
| PR #200 (Seller, active) | `fix/seller-uat-convergence-final-194` | `fa2ce13528a5e7721f5fcf0e2cd77a2a77985999` | **`3778e5dfa4fdbf32233d8764a917cc8cea5ff5e3`** |
| Hardening lane | `hardening/non-seller-convergence` | branched from `43204bee` | see §2 |

**PR #198 is history, not the Seller product.** It merged into #194 at 2026-08-30T03:29:48Z.
The active Seller lane is **PR #200**, whose file list grew from 17 to 24 during this cycle.
`43204bee` is therefore *not* final Seller truth, and was never treated as such.

---

## 2. What this lane contains

The lane is a **strict superset of a second session's work on the same branch** (see §7).
That session's head `b440f37b` is a verified ancestor of this lane's HEAD, so a push is a
fast-forward and nothing of theirs is discarded.

### Issue #158 — terminal ledger write identity (both open #194 review threads closed)

`PRRT_kwDOSp7_h86dYQd3` — *"Require an idempotency key for terminal retries"*
`PRRT_kwDOSp7_h86dYQd5` — *"Canonicalize the payload as it is actually persisted"*

The shipped rule classified a terminal uniqueness conflict by **content** — signer, VIN,
event type, payload. Content describes *what* was written, never *which invocation* wrote it,
so two independent calls with the same subject data were indistinguishable from one call
retried after a lost response, and the loser of a race was told its write had persisted when
it had not.

The identity is now the caller's **durable operation id**, taken from state the caller has
already committed. It survives commit, a lost HTTP/RPC response, a caller crash and a process
restart; a fresh retry recomputes it and a genuinely new invocation cannot. `addEvent` never
mints one.

```
same operation id + same persisted content -> idempotent return of the existing row
same operation id + different content      -> explicit identity-reuse refusal
different operation id + identical content -> explicit refusal
no operation id at the terminal instant    -> refused before anything is written
```

Content equality is still checked — but only as a consistency guard against *misuse* of an
operation id, never as the identity.

**Every stakeholder ledger writer now supplies one**, which the base lane had not done (it
required an id at the terminal instant while no caller provided one, so at clock saturation
every real ledger write would have failed):

| Writer | Durable identity |
|---|---|
| PartSentry | `partsentry_log:<committed parts log id>` |
| Insurance | `insurance_policy:<committed policy id>` |
| Finance | `finance_application:<committed application id>` |
| Security (report) | `stolen_alert:<vin>:<police report number>` |
| Security (clear) | `stolen_clear:<vin>:<the alert's committed created_at>` |
| Event bus | `reservation_recorded:` / `escrow_initiated:` when the id exists |

PartSentry additionally **refuses to write at all** if its log row came back without an id,
rather than inventing an identity a retry could not reproduce.

**Payload normalization:** the attempted payload is serialized once and compared through that
exact string, so the comparison cannot drift from the write. `JSON.stringify` drops
`undefined` properties, projects `Date`s and `toJSON` objects, and nulls non-finite numbers;
the old structural comparison against the in-memory object rejected legitimate retries of
those shapes permanently. Object key order is irrelevant; **array order remains meaningful**.

**Migration `20260830060000_issue158_terminal_operation_identity`** — new forward-only
identity. Adds `blockchain_events.operation_id`, a validated terminal CHECK, and a
signer-scoped unique index. Pre-identity terminal rows are backfilled to a sentinel no caller
can reproduce, so a retry straddling the upgrade **fails closed** rather than being falsely
acknowledged. The protected finalizer now refuses `FINALIZED` until all three objects exist
and no terminal row lacks an identity.

**A defect in that migration was found and fixed by rehearsal**: it hard-failed with
`public.blockchain_events is absent`, breaking 13 tests. Its predecessor and the finalizer
both guard the same work with `IF to_regclass(...) IS NOT NULL`, so a custody-only database is
already inside the chain's contract — only the new migration refused one, which protects
nothing and blocks custody finalization. Now consistent.

**Deliberately NOT claimed:** `operation_id` is not in the hash pre-image and is not covered
by the signature — it cannot be, without invalidating every published event. It is an
idempotency identity, safe in that role because a matched row is never returned without also
proving signer, VIN, event type and persisted-payload equality.

### Authority gaps closed (each with a regression test)

| Severity | Gap | Fix |
|---|---|---|
| **P0** | `/api/verification` mounted **bare** — no auth on the mount, none on any of its five routes — a second, unauthenticated authority over vehicle trust, `cvr_ownership_records`, `zimra_declarations` and identity verification level. CSRF was no barrier: the token endpoint issues a guest-bound token to anyone. | Gated at the **mount** with `authorizeSessionRole(['admin','government'])`, so a future route is closed by default. `authorizeSessionRole` also disables the `x-user-id` fallback. **Zero product and zero test callers existed**, so the blast radius is nil. |
| **P0** | The OCR approval reviewer came from `req.body.actorId` and was written to `administrative_overrides` as the accountable reviewer. | Taken from the session. |
| **P0** | The diaspora handoff ledger writer signed with the **retired hardcoded system secret**, so every handoff event it wrote would fail `verifyChain` for that VIN **forever** — the verifier holds the configured secret, not the retired constant. | Uses canonical `signSystemLedgerHash`. The absence guard is now **repo-wide** instead of scoped to the two files it was written for — which is exactly why this copy escaped it. |
| **P1** | `isUserIdFallbackAllowed()` inferred permission from `NODE_ENV` alone. | **MITIGATED**, see §6. |
| **P1** | Every secret the #194 subsystems require was missing from both env templates. | All 16 documented in `backend/env.example`. |
| **P2** | Boot validated only two variables; a deployment missing `JWT_SECRET` or a ledger secret booted, served `status: 'UP'`, and failed at first use. | Production boot now refuses. Gated on `CARUP_ENV`/`VERCEL_ENV`, never `NODE_ENV`. |
| — | `masterSecret()`/`currentSystemSecret()` minted **ephemeral random** secrets under `NODE_ENV=test`; in a mis-set deployment the ledger keeps accepting writes while every signature becomes unverifiable across instances and restarts. | Same deployment-environment conjunction. (Fixed although the auditor's stated finding was refuted — the underlying hazard was real.) |

### Referral non-determinism — fixed at the source, not waited around

The intermittency was reproduced exactly: `PartsTracking.test.tsx > "a reorder level the
garage did set is honoured"`, expected `1`, received `No reorder level set`. Same SHA, passing
in runs `33290109540` / `33290109409` and failing in `33290394298`.

**Cause:** not ordering, shared state, or randomness — *assert-on-first-appearance*.
`parts-low-stock` existed in **both** the pre-read and post-read renders, so
`findByTestId` resolved against the pre-read paint and the content assertion raced the data.

**But the pre-read paint was itself a product defect.** Before the read settled the page
rendered `parts-total` = 0, `parts-value` = $0 and "No reorder level set" — unrecorded facts
presented as measured values, which is precisely what that page's own contract ("a failed read
is not an empty shelf", "unknown numbers are not zero") exists to prevent. The tiles are now
gated on the read having settled. That removes the false claim **and** removes the race
structurally: the testids no longer exist before the data arrives, so there is no earlier
paint to race. A new regression test drives an unresolved promise and asserts every tile is
absent.

No retry, no loosened assertion, no `waitFor` papering over a product bug.

---

## 3. Evidence

| Battery | Result |
|---|---|
| Backend full suite | **5542 tests, 5521 pass, 0 fail, 21 skipped** |
| Web full suite ×3 | see §3.1 |
| Issue #158 (all suites incl. PGlite/PostgreSQL) | **68/68 → 76/76** |
| Issue #158 terminal identity battery | **19/19**, incl. **3 mutation kills** |
| Non-Seller authority hardening | **8/8** |
| Migration integrity (parser + real 157-file corpus + provenance pins) | **24/24** |
| Web typecheck (`tsc --noEmit`) | **clean** |
| Lint regression gate vs `origin/main` | **NET_NEW_ERRORS=0, NET_NEW_WARNINGS=0** |
| CR-1 secret scan | **clean, 2439 tracked files** |
| Production build | see §3.1 |

**All 21 skips are live-environment probes with a documented reason in the skip string**
(`db-anon-grant-posture` ×9 needing `CARUP_ANON_PROBE_URL/KEY`, `diaspora-supabase-integration`
×3, `qa-backend-blockers` ×4, `user-sessions-auth-contract` ×1, plus inner cases). No test was
skipped to make this cycle pass. **This matters for §6: the nine anon probes are the
executable evidence for the anonymous-access posture, and they did not run.**

### Mutation results

Three load-bearing guards were each removed from the real source in turn, and the mutant
proven to misbehave:

1. terminal writes no longer require a durable identity → the fail-closed precondition is lost;
2. the content consistency guard → a different write is wrongly acknowledged as a retry;
3. the operation-identity match → **reproduces the reviewed defect exactly**: an independent
   operation with identical content is acknowledged as a retry of a write it never made.

A guard whose removal changes nothing is not protecting anything. All three changed behaviour.

### Migration rehearsal

**PASS.** Real PostgreSQL (PGlite), real migration files, four representative pre-migration
states: custody-only, legacy monolithic, PREPARED with a live legacy writer, and forward-skewed
pre-hardening history. It **found the migration defect described in §2**.

### Merge rehearsal

**PASS, evidence only** — `git merge-tree` against the true merge-base. No rehearsal branch was
created or pushed, so none needed deleting. Full analysis in
`PR197_AUDIT_AND_MERGE_REHEARSAL.md`. Result: **one conflicted file** (`backend/server.js`),
two trivial additive-adjacency hunks, with a stated semantic resolution rule (*union both
sides; never choose one*). `web/src/App.tsx` auto-merges clean. Migrations, routes (34 vs 574
paths) and services are collision-free.

---

## 4. Seller exclusion boundary

Full text in `SELLER_JOIN_BOUNDARY_AND_CONTRACT.md`.

- **HARD exclusion** (PR #200, actively edited): 24 files, re-derived live.
- **DOMAIN exclusion** (Seller behaviour, settled in #194 via #198).
- **Intersection with the active Seller lane: EMPTY**, verified mechanically.
- One file (`backend/server.js`) intersects the *domain* list only. It is not in PR #200, no
  agent is editing it, and all three changes to it are non-Seller. Reasoned in §2.3 of the
  boundary document rather than glossed.

## 5. Seller join obligations — exact finite list

**SJO-1** `web/src/App.tsx` · **SJO-2** `featureRegistry.ts` · **SJO-3** `DashboardLayout` /
`WorkspaceHeader` · **SJO-4** `listingSummaryService.js` · **SJO-5** owner dashboard surfaces
("unknown is not zero") · **SJO-6** `SellFlow.identification.test.tsx` real wall-clock timers ·
**SJO-7** `SellFlow*`/`Seller*` unaudited for the same truth rule.

Plus the **20 `[#194-sensitive]` obligations** in `PR197_AUDIT_AND_MERGE_REHEARSAL.md` — of
which 4 are stale, 4 confirmed safe, 10 genuinely open, and **none blocked on Seller**.

The brief said twelve #197 obligations; the marker appears on 22 lines resolving to 20
distinct items. An obligation register that under-counts is how one gets missed.

---

## 6. Known residual risks

1. **The `x-user-id` fix is a MITIGATION, not the maximal remedy.** The `NODE_ENV` inference
   is now ignored when `CARUP_ENV`/`VERCEL_ENV` is `production` — the condition that held
   during the recorded staging incident, so that incident is closed. The maximal fix
   (explicit flag only) was not applied: **52 backend test files** depend on `NODE_ENV=test`
   enabling the header. That migration is an open obligation.
2. **23 of 30 confirmed audit findings remain open**, precisely located in
   `AUTHORITY_AUDIT_REGISTER.md`. They are overwhelmingly pre-existing `main` defects, and
   several are architectural decisions needing an owner rather than a patch.
3. **Anonymous access is not proven closed by executable evidence.** The nine `LIVE:` anon
   probes are skipped without credentials. No anon residual is claimed closed.
4. **Two objects are created by no executable migration** — `vehicle_ownership_history` and
   `blockchain_events` exist only in the non-executable schema snapshot.
5. **Error telemetry is a stub.** `sentry.js` has no SDK dependency.
6. **Cron scheduling is unrepresented in the repo.** No `crons` key in any `vercel.json`.
7. **`20260826120000` has no Down marker and no in-file rollback note.**
8. **PR #197 carries a P1 in its own saga** — the compensating rollback discards its error and
   reports success unconditionally (`serviceCaseService.js:419`). Not fixed; #197 is frozen.
9. **No claim of full state + history + outbox atomicity.** #197 does not claim it and neither
   does this receipt. **No claim of general non-terminal same-VIN append serialization** — the
   uniqueness and idempotency guarantees are scoped as the migration states.

---

## 7. Concurrency event — recorded because it changed the work

A second Claude session ran this same mission simultaneously:

- it pushed five commits to `hardening/non-seller-convergence` implementing the same Issue
  #158 contract and the same PartsTracking fix;
- it pushed `be8706db` to PR #196, fixing the same review thread this session had fixed locally.

**Nothing was clobbered.** Every push was checked for fast-forward first; the local #196 commit
was discarded rather than forced, and #196 was left to its owner. On the user's instruction the
lanes were **reconciled onto the other session's lane as the base**: its migration, runtime
classification and finalizer hardening were kept, **this lane's duplicate migration was
deleted**, and this lane's caller threading, adversarial battery, mutation tests and
PartsTracking product fix were re-applied on top.

Had both migrations landed, `blockchain_events` would have carried two equivalent CHECK
constraints and two overlapping unique indexes — a duplicate authority for one invariant,
arrived at by process failure rather than design failure.

---

## 8. Status — explicit

- **NON-SELLER HARDENING: PASS**
- **FINAL SELLER INTEGRATION NOT YET CERTIFIED.**
- **FINAL #194 RECEIPT NOT YET AUTHORIZED.**
- **#197 FINAL REBASE NOT YET PERFORMED.** #197 frozen at `5683b74e`.
- **PRODUCTION NOT ACTIVATED.** No production write, migration, secret change or deployment
  was performed.
- **#194 was not merged. #196 was not merged. `main` was not changed.**

**Next trigger: FINAL SELLER CANDIDATE READY.**
