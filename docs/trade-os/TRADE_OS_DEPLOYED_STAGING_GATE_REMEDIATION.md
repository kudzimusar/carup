# Diaspora Deployed Staging UAT — gate remediation record

**Not a master plan.** A record of one gate: what was wrong with it, what turning it on revealed, and
what remains.

**Status: the gate infrastructure is REPAIRED and PROVED. The gate itself is NOT yet green.**

---

## 1. What was wrong with the gate

It was pinned to `github.head_ref == 'claude/diaspora-phases-8-10-production-program'` with hardcoded
`STAGING_WEB_URL`/`STAGING_API_URL` belonging to a **different Vercel project**. That branch is long
dead, so the job's `if:` was false on every pull request and the workflow reported **`skipped`** — a
green tick, for months, for a gate that had certified nothing.

The pair now resolves from the governed manifests (`web/preview-frontend-pairing.json` +
`web/preview-backend-pairing.json`) through `scripts/ci/resolve-governed-preview-pair.mjs`, which
carries seven **named** refusals: ungoverned branch, production origin, the stable staging alias,
stale frontend, stale backend, unpaired frontend, and a frontend talking to another branch's backend
— plus the wrong staging project. **A branch with no governed pair FAILS; it does not skip.**

The logic lives in a script rather than in YAML because a refusal nobody can test is not a gate:
20 tests with positive controls on both sides, and **8 mutations of the refusals, all red**.

Proved end-to-end on the candidate head — the resolver step succeeded and pinned both deployments:

```
{"ok":true,
 "frontend":"https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app",
 "backend":"https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app",
 "sha":"4d880f59…","deployment_id":"dpl_B7RAkDft9CBrgxbhoRFbzJjeky3F"}
```

---

## 2. What turning it on revealed

Real Chromium ran against that pairing for the first time in months, and **it did not pass**. Roughly
197 of ~200 tests executed across three device projects before the 35-minute job ceiling, with
failures in the Parts, Security, Seller Golden, T5 container-demo and T2 RFQ2 specs.

**These are not dismissed as "pre-existing" because they sit outside T12.** They were current staging
failures until classified, and they are classified below.

The two cancelled CI runs failed at **different points**, so neither carried the full list. Diagnosis
was therefore done spec-by-spec against the same governed pairing, which is why the ledger is
complete rather than truncated at a timeout.

---

## 3. Failure ledger

| # | spec / test | surface | expected | actual | classification | fix |
|---|---|---|---|---|---|---|
| 1 | `45` T5 container demo — all | T5 | operator signs in | `TRADEOS_UAT_OPERATOR_PASSWORD is not exported` | **ENVIRONMENT_CONFIG** | provision the 4 `tradeos.*` identities in the gate |
| 2 | `46` T2 RFQ2 — all | T2 | buyer signs in | `TRADEOS_RFQ_BUYER_PASSWORD is not exported` | **ENVIRONMENT_CONFIG** | provision the 2 `tradeos.rfq-*` identities |
| 3 | `45:116` operator creates container | T5 | `diaspora-container-create-section` visible | element not found; operator landed on the **Provider requests** tab | **STALE_TEST_ASSUMPTION** (changed surface, same authority) | click `shipping-tab-containers`; `?view=containers` on every nav |
| 4 | `45:392` booking-close | T5 | 0 open cards for `2026-11-05` | **4** — three from previous runs | **FIXTURE_CONTAMINATION** | assert on the container this run closed, **by id** |
| 5 | `45:305`, `45:347` D7 outbox | T5 | outbox drained | `TRADEOS_WORKER_SECRET must be set` | **ENVIRONMENT_CONFIG — BLOCKED** | needs an owner-set repo secret (§5) |
| 6 | `33:126` parts RFQ chain | Parts | `diaspora-rfq-page` | `/diaspora/rfq` is a **retired redirect**; its testids exist nowhere | **STALE_TEST_ASSUMPTION** | assert the current truth; the chain is owned by spec `46` |
| 7 | `38:212` Seller Golden | Seller | journey completes | timeout at 480s inside `retireStaleAutomationVehicles` | **FIXTURE_CONTAMINATION → PERFORMANCE** | see §4 |
| 8 | `38:212` marketplace visibility | Seller | 1 published listing | `0 published listings` | **ENVIRONMENT_CONFIG** | `STAGING_RUN_ID` must satisfy the `fixture_scope` contract |
| 9 | `38:212` Seller Intelligence KPI | Seller | `seller-intelligence-kpi-inquiries` visible | page stuck on *"Reading Seller rollups…"* | **PRODUCT_DEFECT** | unbounded N+1 fan-out (§4) |
| 10 | `34` security — chromium | Security | — | **7/7 PASS** | **not a defect** | the CI failures were mobile-project/timeout artefacts of a cancelled run |

**Security is the headline non-finding.** Spec 34 — anonymous API denial, cross-tenant URL-id
substitution, buyer-cannot-review, outsider empty imports, flag-gated surfaces — **passes 7/7**
against the governed pairing. No authorization was weakened anywhere in this remediation, and no
`404` was accepted as authorization evidence.

---

## 4. The two findings worth reading

### The accumulation feedback loop

Spec 38's teardown ran **inside** the journey's own 480s timeout. The measured journey was **481.9s**
— it missed by two seconds, and those two seconds were spent in the `finally` that retires the run's
vehicle. So a slow-but-healthy run **orphaned its fixture**.

118 orphans accumulated. The stale sweep filtered on the description prefix but **not on whether a
vehicle was already retired**, so every run re-retired all of them — 121 already-`Sold` vehicles at
three serial API calls each, **363 no-op round-trips** inside a 480s budget. Slower runs orphaned
more, which made runs slower.

Closed on both sides: teardown moved to `afterEach` with its own budget, and the sweep now skips what
is already retired and runs bounded-concurrent. The 118 were retired **through the product's own
path**; nothing was deleted.

### An unbounded fan-out that hurts real dealers

`SellerIntelligence` fired **one `fetchListingIntelligence` per owned vehicle, all at once**, and
blocked the entire page render on all of them. With 157 owned vehicles the KPI band — which needs
only the pulse read, and that returns in **2.4s** — never appeared at all.

This is not a fixture artefact. Any dealer with a large inventory gets the same page. The page is now
ready when its four primary reads settle, and the per-listing detail fills in progressively under a
bounded concurrency.

---

## 5. Measured runtime — the budget is the second blocker

**Do not raise the 35-minute ceiling on this evidence alone; it is offered as the evidence, not as a
change.**

Per-spec, measured in isolation against the governed pairing, **chromium only**:

| spec | duration |
|---|---|
| `32` vehicle | 1.7m |
| `33` parts | 0.7m |
| `34` security | 0.9m |
| `35` recovery | 0.6m |
| `36` gtm | 1.3m |
| `37` gtm-safety | 0.7m |
| **`38` seller golden** | **8.4m** |
| `41` seller phase E | 1.1m |
| `42` seller media | 3.6m |
| `43` operations serena | 1.2m |
| **`45` T5 container demo** | **5.4m** |
| **`46` T2 RFQ2** | **3.6m** |
| `47` T3 | skips (unprovisioned, by its own contract) |
| **chromium subtotal** | **≈ 29.7m** |

The gate runs **three device projects at `workers: 1`**. Chromium alone is ~30 minutes, so the
tablet and mobile projects — even with the many `runs once on desktop` skips — cannot fit inside a
35-minute job.

There is a counter-intuitive consequence worth stating plainly: **fixing failures makes this suite
slower.** A failing test exits early; a passing one runs to the end. The run that *completed* with a
tally (146 passed / 18 failed / 65 skipped) did so partly because 18 tests failed fast. The next run,
with more of them fixed, reached the ceiling instead.

The waste has been removed — 363 no-op round-trips per run, an unbounded per-listing fan-out, and a
serial stale sweep. What remains is honest workload: 13 real deployed browser journeys across three
viewports, serialised because they mutate shared staging state.

**Owner decision required** on how to fit it: a larger job budget sized to the measurement above,
sharding the projects across parallel jobs, or splitting the matrix. Each changes what a single run
means, so none was chosen here.

---

## 6. The worker secret — CLOSED (owner authorized)

The audit found there was **no existing value to synchronize**. The `carup-backend-staging` project's
branch-scoped preview `COMMUNICATION_WORKER_SECRET` is an **empty quoted string**, so
`resolveWorkerSecret()` fell through to `CRON_SECRET` — which is not set for this branch either.
Both probes of `POST /api/internal/events/process` returned **401**: nothing could drain the outbox
on this preview at all.

So a **new cryptographically random, staging-only** secret was created and synchronized to:

1. the staging backend's worker-secret configuration (branch-scoped preview variable), and
2. GitHub Actions `TRADEOS_WORKER_SECRET`.

An audit of every consumer of that endpoint found exactly one other staging-only caller — spec 45 —
which reads the GitHub secret, so (2) covers it. **Production was never read and never written.** The
value never passed through a shell, an argv entry, a log line or stdout.

Proved against the redeployed backend:

| case | result |
|---|---|
| missing secret | **401** refused |
| wrong secret | **401** refused |
| correct secret, `Authorization: Bearer` | **200**, outbox drained |
| correct secret, `x-communication-worker-secret` | **200**, outbox drained |
| secret present in any response body or header | **no** |

The shard now **fails loudly** if `TRADEOS_WORKER_SECRET` is absent, because a run without it is not
a certification.

---

## 6b. Packaging — sharded by project, run serially

The 35-minute ceiling is **unchanged** and no spec is narrowed. The gate is three serial shards —
**Chromium → Tablet → Mobile** — behind one **Aggregate** job.

- each shard runs **one Playwright project** from the **same unchanged `testMatch`**;
- each shard **re-proves the governed pairing**, so a deployment that moves between shards fails
  rather than silently certifying two candidates;
- serial, not parallel, because the journeys mutate shared staging state;
- `workers: 1` retained.

**The aggregate is stricter than its shards.** Three green viewports are only a pass if they
certified the same candidate: each shard writes a pairing record and
`scripts/ci/assert-staging-shards-agree.mjs` compares branch, SHA, frontend, backend, staging project
and `unpaired` across all three. A missing shard fails.

### A failure the sharding itself caused, and its fix

The first sharded run failed in **all three** shards at the identity-rotation step:

```
ECHECKOUTTIMEOUT: unable to check out connection from the pool after 15000ms in Session mode
```

No test ran. Sharding tripled the number of rotations per gate run against a **shared** Supabase
pooler. The connection is now retried with bounded exponential backoff on transient pooler errors
only — the **connection**, never an assertion: the rotation stays all-or-nothing inside one
transaction, and a genuinely missing identity still fails on the first attempt.

---

## 7. Tripwire — the gate proves BOTH halves

An integration gate has to demonstrate two different things, and repairing the first does not give
the second:

| # | mutation | result |
|---|---|---|
| 1 | the pairing manifest is missing | RED |
| 2 | FE/BE SHA mismatch is tolerated | RED |
| 3 | a stale BACKEND is tolerated | RED |
| 4 | `unpaired:true` is tolerated | RED |
| 5 | a PRODUCTION origin is accepted | RED |
| 6 | the frontend may call ANY backend | RED |
| 7 | **a SECURITY assertion is weakened** (the no-payload check deleted, so a bare `404` would satisfy denial) | RED |
| 8 | **a T5 invariant is weakened** (capacity assertion negated) | RED |
| 9 | **a T2 authority assertion is weakened** (`201` relaxed to any 2xx) | RED |

**9 / 9 red.** `scripts/uat/gate-tripwire-matrix.sh`.

Mutations 7–9 are proved by `scripts/ci/assert-gate-assertions-intact.mjs`, which pins the
load-bearing security, T5 and T2 assertions and runs in seconds. Re-running the suite to prove them
is not available: it takes ~30 minutes on one viewport and cannot run concurrently with another run
without rotating its identities out from under it (§8). The pin is deliberately narrow — the handful
of assertions that carry the invariants, not whole files — so ordinary maintenance stays possible and
a silent weakening does not. It runs in ordinary CI **and** in the gate itself, before the gate
spends 35 minutes.

A related strengthening fell out of writing it: the spoofed-reviewer probe accepted `[401, 403, 404]`
and asserted only `not.toBe(200)`. It now also asserts the refusal carries no profile data — the same
contract the anonymous probe already held itself to, because **a 404 is never authorization evidence
on its own.**

---

## 8. What was NOT done, deliberately

Per the remediation constraints, none of the following was used:

- no timeout raised to hide a failure;
- no `testMatch` narrowed;
- no suite removed;
- no branch-specific skip added;
- no hardcoded preview URL restored;
- no failure converted to a warning;
- no retry-until-green, and no blanket flaky label;
- no assertion deleted;
- no security check weakened;
- no wrong-route `404` accepted as authorization proof.

Every change either **gave the gate what its own `testMatch` requires**, **pointed a stale test at
the current authority**, or **fixed a real defect**. Two of them increased coverage outright: spec 46
went from 2 attempted tests to 15, and spec 45 from 1 passing to 11.

---

## 9. The measurement hazard this remediation surfaced

**This gate cannot be measured while anything else is touching staging.**

It rotates five — now eleven — shared staging identities at the start of every run, and its journeys
mutate shared staging state. Two things follow, and both were observed:

1. **A local diagnostic run and a CI run cannot coexist.** While CI ran, it rotated the passwords out
   from under a local run, which failed with `HTTP 401` on login. Runs after that point in the same
   window are contaminated and must be discarded, not interpreted.
2. **Failure sets differ between overlapping runs.** The first two cancelled CI runs failed at
   different points, and a contaminated run showed failures in specs (`32:54`, `33:117`, `37:229`)
   that pass cleanly in isolation against the same pairing.

So a result is only evidence if it comes from a run that had staging to itself. Every classification
in §3 was taken from an isolated run for that reason.

The `concurrency:` group already serialises CI runs of this gate per pull request. What is *not*
guarded is a human or agent running the suite locally at the same time — recorded here because the
next person to diagnose this gate will otherwise read a contaminated result as a product defect.

---

## 10. A consequence of this remediation, caused and recorded

**`Marketplace Reference Regression` began failing on `429` rate limits**, and this remediation
caused it.

It passed on `4d880f59`, `177371c2` and `6a0c38d2`, and failed on `a167ee1e` — the first head where
the repaired gate actually runs its full workload. Provisioning the missing identities took specs 45
and 46 from 3 attempted tests to **28**, and fixing the fast-failing tests made the rest run to
completion. The gate therefore holds the shared staging backend for far longer and hits it far
harder, and the Marketplace regression — which runs concurrently against **the same preview
backend** — is rate-limited out.

The failure is `429` on the backend, not a product defect and not an assertion:

```
critical Marketplace API failures: + "429 https://carup-backend-staging-git-feat-trade-os-client-d…"
```

**Nothing was done about it here.** The staging workflows share one preview backend and have no
cross-workflow concurrency group; adding one changes scheduling semantics for the Seller, Operations
and Marketplace lanes as well, which is not this remediation's to decide. It belongs with the same
owner decision as the runtime budget in §5: **the gate's cost has outgrown what the shared staging
environment absorbs while other gates are running.**

Options, none chosen: a shared concurrency group across the staging-dependent workflows; a higher
rate limit for preview deployments; or scheduling the heavy gate off the pull-request path.

---

## 11. The shared preview lock — and its one sharp edge

Seven workflows that drive the same branch preview backend now share one concurrency group keyed on
the **preview identity** (the branch), with `cancel-in-progress: false`:

`diaspora-deployed-staging-uat` · `marketplace-reference-regression` · `seller-exact-head-staging-uat`
· `seller-phase-e-staging` · `seller-media-lifecycle-staging-uat` · `operations-serena-staging-uat` ·
`diaspora-canonical-staging-uat`

Ordinary unit/lint/build CI is deliberately **not** in the lock, and independent branches keep their
own previews and run in parallel.

**Observed working on the first run:** `Operations Serena Staging UAT` held the group and
`Diaspora Deployed Staging UAT` sat `pending` behind it instead of colliding — which is precisely the
overlap that produced the 429s.

**The sharp edge, recorded rather than discovered later.** GitHub keeps at most **one pending run per
concurrency group**: `cancel-in-progress: false` protects the run that is *executing*, but a newer
queued run **supersedes an older queued one**. On that same first run, `Marketplace Reference
Regression` was cancelled while queued.

So the lock delivers what it was for — no two staging gates hitting one preview backend at once — at
the cost of a superseded queue slot. The in-progress certification is never killed. A superseded run
must simply be re-dispatched, which is why §23's Marketplace verification is run explicitly rather
than assumed from the push.

Alternatives, none chosen here because each trades the property away: separate groups per workflow
(restores contention), or a queue-runner outside GitHub's concurrency model.

---

## 12. STOP — the staging environment is down, and this work caused it

**Certification cannot continue. The staging Postgres is saturated and is not recovering.**

Every backend deployment of `carup-backend-staging` — including the newest, which Vercel reports
`Ready` — times out on every endpoint. The frontend is healthy (200 in 0.6s), so this is not a
deployment failure: the backend hangs because it cannot reach the database. An independent path (the
Supabase MCP, not the CI pooler) times out identically, which rules out a CI-only pooler problem.

### The evidence, and the honest attribution

`postgres_logs`, bucketed by hour:

| hour (UTC) | cron startup timeouts | SSL rejects | statement timeouts |
|---|---|---|---|
| 2026-09-07 10:00 → 2026-09-08 05:00 | **0** (20 consecutive hours) | **0** | **0** |
| 2026-09-08 06:00 | 28 | 13 | 7 |
| 2026-09-08 07:00 | 108 | 57 | 102 |
| 2026-09-08 08:00 | 138 | 77 | 37 |
| 2026-09-08 09:00 | 96 | 43 | 22 |

Twenty clean hours, then onset at **06:00 UTC** — which is when the repaired gate first ran its
**full workload** (the 31.4m run that executed 148 passing tests instead of failing fast). Nothing
else changed.

**This remediation caused it.** Not by a defect in the changes, but by their effect: giving the gate
its missing identities and fixing the fast-failing tests multiplied the real database work per run,
and the shared staging project cannot absorb it. It is the same root cause as the Marketplace `429`s
in §10, one level deeper — that was the API rate limiter, this is the database itself.

### Why it is not self-healing

The symptoms are connection-slot exhaustion: `could not accept SSL connection: Connection reset by
peer`, `canceling statement due to statement timeout`, and pg_cron unable to start jobs at all
(`cron job 1/2/8 job startup timeout`, roughly two per minute, continuously).

It has stayed in that state for **30+ minutes with zero CI load and no local runs** — the shared
preview lock is holding, and nothing was queued. A plausible sustaining mechanism: the backend
functions hang waiting on the database, so every request that reaches them opens another connection
attempt against an already-full pool.

### What this blocks

- the D7 outbox retest (§10 of the directive) — the endpoint is unreachable;
- tablet and mobile isolation (§§11–12) — no shard can complete;
- the full aggregate run (§22) and the Marketplace verification (§23).

### What it needs — owner action

1. **Recover the staging Supabase project**: restart it, or terminate the stuck backends. Neither is
   possible from here — the database cannot be connected to in order to run
   `pg_terminate_backend`, and restarting the project is not an authorized action for this task.
2. **Then decide the capacity question**, because recovery alone will not stop it recurring: the gate
   now performs several times the database work it did while it was failing fast, on a project that
   also serves every other staging lane. Options are a larger staging instance, a dedicated
   certification database, or a smaller certification footprint.

**Nothing was worked around.** No timeout was raised, no test disabled, and no result reported as
green. The environment cannot certify, so it does not.

---

## 13. Also recorded

- `tests/agents/31` *"public route renders normally"* fails on Mobile Chrome. It fails **identically
  on the stashed baseline**, so it predates this work and is unrelated to it.
- The gate runs 13 specs × 3 device projects at `workers: 1`, because the journeys mutate shared
  staging state. That serialisation is the structural reason the suite approaches the 35-minute
  ceiling; it is a property of the suite's design, not waste, and it is recorded here rather than
  papered over with a larger budget.

---

## 14. Root cause found — the instance was CPU-quota throttled, and it looked healthy

The owner restarted the staging Supabase project. The database came back; **the gate still cannot
run**, and the reason turned out to be something no ordinary health measure reports.

### The symptom chain, measured rather than inferred

`/api/health` on the paired backend answered `200` with `supabase: {"status":"unhealthy"}`, and a
DB-backed product read returned:

```
GET /api/vehicles → 500 {"error":"Could not query the database for the schema cache. Retrying."}
```

That is **PostgREST**, not Postgres. `postgres_logs` attribute it exactly — `user_name=authenticator`,
`application_name=postgrest`, `sql_state_code=57014` (query_canceled) — and the cancelled statement is
verbatim PostgREST's schema-cache query, plus `SELECT name FROM pg_timezone_names`. It repeated every
60–90 seconds, continuously, for hours.

### Why it could never self-heal

`authenticator` carries `statement_timeout=8s`. PostgREST builds its schema cache at startup and
retries on failure. The restart wiped the warm cache it had been serving from, so it had to rebuild
over a schema that has grown to **302 relations / 5,931 columns / 100 functions**. Every attempt was
cancelled at 8s, so it retried forever — and every REST call failed for as long as that lasted.

### The measurement that named the cause

Everything ordinary said the database was fine:

| measure | value |
|---|---|
| sessions | 14 / 60 |
| idle in transaction | 0 |
| queries running > 5 min | 0 |
| waiting on a lock | 0 |
| buffer cache hit | 99.74% |
| `select 1` | instant |

So the cause is not connections, not stuck sessions, not the pooler, and not disk. A pure-CPU probe
that touches no table, index or disk found it:

| probe | rows | elapsed | per million |
|---|---|---|---|
| short | 1,000,000 | 379 ms | 379 ms |
| long | 3,000,000 | 9,837 ms | 3,279 ms |
| long (repeat) | 3,000,000 | 16,087 ms | 5,362 ms |

On an unthrottled instance the per-row cost is constant. Here the same work cost **8–14× more per
row** as the query ran longer. That is CPU **quota** throttling: short queries fit inside the burst
allowance and run at full speed; long ones are stalled repeatedly once the allowance is spent.

This is why the instance simultaneously passed every simple health check and could not serve
PostgREST's one long catalog query — and why 148 tests failed for a reason none of them named.

### What was deliberately NOT done

Raising `authenticator`'s `statement_timeout` would let the schema-cache query grind for longer. It
would not fix anything: the query is slow *because* CPU is scarce, and letting it run longer consumes
more of the exact resource that is scarce, while every other query waits. It would also convert a
loud failure into a slow one. **The timeout was left at 8s.**

No session was terminated either — there was nothing stuck to terminate (0 idle-in-transaction,
0 long-running). §7 of the directive is a no-op, on evidence, rather than an action taken for its
own sake.

### The guard that now exists

`scripts/ci/assert-staging-capacity.mjs` runs in the bootstrap job, **before anything writes to the
database**, and refuses the run when the instance cannot serve it:

- **`postgrest-cannot-start`** — `pg_timezone_names` does not complete inside PostgREST's own 8s
  budget. Not a proxy: this is literally one of the two queries that was failing.
- **`cpu-quota-throttled`** — per-row cost degrades by more than 3× between the short and long probe
  (measured 14.15× during the incident, ~1.0× healthy).
- **`below-postgrest-budget`** — a uniformly slow instance, where the ratio sees nothing wrong but
  3M rows of pure CPU still exceeds PostgREST's entire statement budget.

It compares the instance **against itself, moments apart**, rather than against an absolute
millisecond threshold that would need re-tuning per runner and would be loosened until meaningless.
It refuses; it does not retry, and it does not warn. `gate-tripwire-matrix.sh` mutations 20–24 prove
each of those properties fails when removed.

## 15. The load the gate no longer places

A structural cause sat underneath the capacity one. Every shard rotated all 11 synthetic identities
itself, so a database connection was a **precondition of every shard** — which is why all three died
with `ECHECKOUTTIMEOUT` without running a single test.

Measured with `scripts/ci/measure-bootstrap-cost.mjs 400e283c`:

| per aggregate run | before | after | change |
|---|---|---|---|
| pg connections | 3 | 1 | −67% |
| identities written | 33 | 11 | −67% |
| SQL statements | 39 | 13 | −67% |
| scrypt derivations | 3 | 1 | −67% |
| **shard database connections** | **3** | **0** | **eliminated** |

Separately, `SellerIntelligence` fanned out over **all** owned vehicles including 121 sold ones —
157 DB-backed requests per page load, the largest single per-run database cost in the suite. It now
compares live listings only.

## 16. What remains, and what it needs

The gate is now **correct and honest, and still cannot run**, because the environment cannot serve
it. That is a capacity decision, and it is the owner's:

1. **Wait for the CPU allowance to replenish.** Free, but PostgREST's retry loop keeps consuming what
   little there is, so recovery is slow and not guaranteed. Health is now provable rather than
   guessed: `assert-staging-capacity.mjs` returns the numbers.
2. **A larger staging instance.** Not authorized at this stage.
3. **A dedicated certification project.** Not authorized at this stage.

Option 1 alone will not prevent recurrence: the suite runs 13 specs × 3 viewports at `workers: 1`
against an instance that also serves every other staging lane. The gate's own footprint is now 67%
lighter and the shards' database dependency is gone, which buys margin — it does not create capacity
that was never there.

**Still nothing was worked around.** No timeout raised, no spec narrowed, no test disabled, no
failure downgraded, and no result reported as green.
