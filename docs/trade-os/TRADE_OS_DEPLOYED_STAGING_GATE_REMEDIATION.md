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

## 6. Open — needs an owner action

**`TRADEOS_WORKER_SECRET` is not configured as a repository secret**, and no workflow sets it. Two
tests in spec 45 (D7, the organiser-directed booking notification) assert its presence, so they
cannot pass in any CI run.

The backend accepts either `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET` on
`POST /api/internal/events/process` (`backend/routes/communicationRoutes.js:26`). The repo secret must
therefore be set to the **staging backend's** value of one of those.

It has deliberately **not** been worked around. Fabricating a value, weakening the assertion to a
skip, or deleting the tests would each remove certification this gate is supposed to provide.

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

## 11. Also recorded

- `tests/agents/31` *"public route renders normally"* fails on Mobile Chrome. It fails **identically
  on the stashed baseline**, so it predates this work and is unrelated to it.
- The gate runs 13 specs × 3 device projects at `workers: 1`, because the journeys mutate shared
  staging state. That serialisation is the structural reason the suite approaches the 35-minute
  ceiling; it is a property of the suite's design, not waste, and it is recorded here rather than
  papered over with a larger budget.
