# PR #207 description — archived record (as of 2026-09-13)

**Archived 2026-09-26.** This is the pull request description of #207 exactly as it stood before it
was replaced by a concise status page. It is copied verbatim, not retyped: nothing below has been
edited. It had reached GitHub's 65,536-character description limit, and several statements in it had
been overtaken by later events. The live description carries the current status and lists the
superseded statements; the per-phase receipts in this directory remain the authoritative record.

Statements below that are **superseded** (see the live #207 description for the current state):

- the status table's T11 row ("`T11-PARTIAL` — owner acceptance remains") and the heading
  "`T11-USABLE`, conditional freeze" — T11 is OWNER ACCEPTED / FROZEN at `9ce19115`;
- the missing T12 row — T12 is OWNER ACCEPTED / FROZEN, runtime `4d880f59`;
- "T13 NOT started and NOT authorized" / "T13 remains blocked" — T13 started on 2026-09-13 and is `T13-PARTIAL`;
- "Deployed-staging integration gate … BLOCKED on the environment" — the database was CPU-quota
  throttled (`../TRADE_OS_DEPLOYED_STAGING_GATE_REMEDIATION.md` §14–19) and has since recovered;
- the T6 section's closing "**Status: `T6-PARTIAL`**" — T6 is OWNER ACCEPTED, frozen at `2d0a0bc0`;
- the T11 section's "Recorded, not fixed: the `Diaspora Deployed Staging UAT` workflow is hard-pinned…" —
  fixed in `a362f1a`.

---

# Trade OS — cross-border sourcing, logistics, passport, intake and container marketplace

**Programme status — T6 `2d0a0bc0` · T7 `3f062fc0` · T8 `00f164e4` · T9 `ee747940` · T10 `d6918041` · **T11 OWNER ACCEPTED / FROZEN `9ce19115`** · **T12 OWNER ACCEPTED / FROZEN, runtime `4d880f59`**. Draft. `main` unmodified. **No production writes.** T13 NOT started and NOT authorized.**

| Phase | State |
|---|---|
| **T2** Sourcing RFQ | delivered (evidence below) |
| **T3** Logistics RFQ | **T3-USABLE**, frozen `b446d8ea` |
| **T4** Order & Booking Passport | **T4-USABLE**, frozen `736f06c5` |
| **Intake 2.0** | `INTAKE-2.0-PARTIAL` — owner UAT outstanding (candidate `c84ac9b5`, findings closed `3c382bae`) |
| **T5** Container Marketplace & Multi-Corridor | **`T5-USABLE` — OWNER ACCEPTED, FROZEN at `5079b0b3`** |
| **T6** Rates, FX, Landed Cost & Corridor Economics | **`T6-USABLE` — OWNER ACCEPTED, FROZEN at `2d0a0bc0`** |
| **T7** Communications lifecycle | **`T7-USABLE` — OWNER ACCEPTED, FROZEN at `3f062fc0`** |
| **T8** Documents & Evidence workspace | **`T8-USABLE` — OWNER ACCEPTED, FROZEN at `00f164e4`** |
| **T9** Warehouse intake & measurement | **`T9-USABLE` — OWNER ACCEPTED, FROZEN at `ee747940`** |
| **T10** Consolidation & loading | **`T10-USABLE` — OWNER ACCEPTED, FROZEN at `d6918041`** |
| **T11** Shipment & tracking | **`T11-PARTIAL` — owner acceptance remains** (candidate `bf52a6d9`) |

> **T5 IS ACCEPTED.** Owner verdict `T5-USABLE`, frozen runtime `5079b0b3`, certification/docs
> descendant `4f7529eb` (docs-only: the two differ by three documentation files, no runtime code).
> FE and BE both paired on `5079b0b3`. **T5 is NOT production-ready merely because it is
> `T5-USABLE`** — production readiness remains a separate, explicitly-authorized gate (T18), and
> production remains NOT AUTHORIZED. T6 may now be planned under its own phase contract.

## T6 — Rates, commercial transparency, FX and landed cost

**The objective:** make avoidable trade cost visible and competitively removable — without
manufacturing certainty.

The audit found there was almost nothing to build on: no FX authority anywhere in the repository,
no charge components, no rates, no landed cost, no allocation. Logistics offers carried five FIXED
numeric columns (a sixth charge was unexpressible, and none carried its own currency or provenance)
and procurement offers carried none at all.

**FX.** The ECB euro reference rates, behind an `FxRateProvider` abstraction — chosen because it is
a central bank publishing its own figures and because the ECB itself states these are reference
rates *not intended for transaction purposes*, which is exactly this layer's contract. The
limitation is stated rather than hidden: **ZWG, ZWL, MZN and TZS are not published** — the
destination market and both gateway markets — so those conversions are UNAVAILABLE, never
approximated. JPY→USD is triangulated through EUR and **the legs are stored**. Snapshots are
immutable at the database level, so a conversion a customer already saw stays reproducible.

**What the screen may and may not say.** Source money is always shown; USD sits beneath it as a
labelled reference carrying the rate, its source and its own date. No rate means no number —
"USD comparison unavailable", never 0 and never 1:1. An unpriced amount says so; an exclusion is a
cost the customer will still meet, never a `$0` line. Currencies are grouped, never summed. The
words "estimated landed cost" appear only when everything material is answered. A cheaper headline
across a *different* scope is never called cheaper, and no corridor is BEST, CHEAPEST or PREFERRED.
CarUp computes no duty or tax — that is T12's engine.

**Eleven defects were found by exercising the system, six of them invisible from the source.**
The largest was not a bug in a function — it was that the commercial layer reached no screen at
all. `QuoteBreakdown`, `LandedEstimatePanel`, `ComparisonVerdict` and the advisor each had passing
unit tests and **no importer anywhere in the product**: a provider could record a complete
breakdown and their customer would still see only the five legacy columns. `allocateSharedCharge`
was the same story from the operator's side — written, tested and routed, reachable only by a
caller who already knew a charge-component id. **A module being correct is not the same as a module
being wired**, and the only test that knows the difference is one that mounts the real screen.

The rest, in the order they were found by walking the product:

- a JPY 2,400,000 supplier offer silently became USD 2,400,000 (the two quote domains read
  different currency field names and both defaulted to USD);
- "not applicable" counted as a missing stage, punishing a provider for answering honestly;
- the coverage rule existed three times and drifted the moment one copy was corrected, so one
  journey read complete on one screen and incomplete on another;
- an estimate with nothing priced returned **USD 0.00** — caught by mutation testing before it
  shipped, the exact unknown-becomes-zero failure this phase exists to prevent;
- an EXCLUDED customs line and a NOT_APPLICABLE inspection line both read "Not priced yet", the
  words used for a charge whose price is still owed;
- the comparison was requested even for a single offer — a 400 on every single-offer detail;
- material coverage was one global list, so a freight offer pricing the whole ocean leg was
  reported as still missing "The goods themselves";
- **the truth broke the layout** — at 393px the buyer's breakdown scrolled to 765px, because the
  sentence this phase exists to protect ("USD comparison unavailable — ZWG/USD is not published by
  ECB") sat in a column that could not wrap. The fuller the truth, the more broken the page;
- an unrecognised API payload crashed the operator screen with a TypeError, reddening four
  unrelated Phase 6 tests that named nothing about this feature. Every T6 panel now treats a shape
  it does not recognise as **unreadable**, never as empty.

**What closure added.** The provider's structured commercial entry on both domains; the customer's
breakdown, landed estimate, comparability verdict and advisor on both customer surfaces; the
governed rate-research workspace (platform authority only, registered so the `isPublicRoute`
fallback can never expose it, with every row led by its classification, source and synthetic flag);
corridor coverage for operations; and the operator's shared-charge allocation panel — which offers
**no default basis**, because a control that defaults to CBM makes the operator's decision for them
and then looks like their decision.

**Evidence at the freeze candidate `2d0a0bc0`:** PGlite gate 28/28 · T6 backend 75/75 · full backend regression
**6006 passed / 0 failed** (21 skipped) · web diaspora **190/190** · lint regression gate
NET_NEW_ERRORS=0 · FX states 12/12 (JPY/EUR AVAILABLE with rate, date and source; ZWG/MZN
UNAVAILABLE with a reason, never 1:1 and never 0) · seven-width geometry (393 · 820 · 1024 · 1280 ·
1366 · 1440 · 1536) across eight surfaces with **no horizontal overflow**.

**Owner-UAT proxy walked in the deployed product**, FE and BE paired on the same commit and every
`/api/` request verified to reach only the branch backend:

1. procurement — buyer publishes, supplier prices **JPY 2,400,000** with structured components
   (one INCLUDED, one EXCLUDED, one NOT_APPLICABLE), buyer reads the breakdown back; JPY survives
   review → persist → refresh → relogin;
2. logistics — provider prices in JPY with an excluded customs line; requester reads the same
   breakdown, the same landed-cost wording and the same reconciliation note;
3. research — an authorized operator records an observation and it is badged SYNTHETIC everywhere;
   a trader typing the URL is **redirected by the route boundary** and the workspace never mounts,
   and the API refuses the read, the benchmark and the write with `INSUFFICIENT_PERMISSIONS`
   (measured with a real CSRF token, so the refusal observed is the authority one and not the
   transport one). An earlier walk recorded "shown an honest refusal" on a loose regex match
   against the dashboard; the record is corrected rather than left standing;
4. allocation — sailing created → bookings opened → offer attached carrying a **USD 900** terminal
   charge → space requested → booking approved → charge divided on a stated CBM basis, and the
   split reads back as `RES-5648C1C0 — USD 900` with a zero rounding remainder.

## Deployed-staging integration gate — repaired, sharded, locked · BLOCKED on the environment

Full record: `docs/trade-os/TRADE_OS_DEPLOYED_STAGING_GATE_REMEDIATION.md`.

### Chronology, kept intact

dead `skipped` gate → pairing repair → hidden backlog → fixture/product remediation → **31.4m red run
(148 passed / 16 failed)** → owner rulings → sharded + serialized certification → **staging database
saturated, certification stopped.**

### Closed this round

**The worker secret.** The audit found nothing to synchronize: the staging backend's branch-scoped
`COMMUNICATION_WORKER_SECRET` was an **empty string**, so `resolveWorkerSecret()` fell through to
`CRON_SECRET`, which is unset for this branch — both probes returned `401` and **nothing could drain
the outbox at all.** A new cryptographically random **staging-only** secret was created and
synchronized to the staging backend and to GitHub Actions. Production was never read or written; the
value never passed through a shell, argv, log or stdout. Proved: missing → `401`, wrong → `401`,
correct → `200` on **both** accepted headers, and no leak into any body or header.

**Packaging, not coverage.** The 35-minute ceiling is unchanged and no spec is narrowed. Three serial
shards — **Chromium → Tablet → Mobile** — behind one **Aggregate**. Each shard re-proves the governed
pairing, so a deployment that moves between shards fails. **The aggregate is stricter than its
shards**: each writes a pairing record and they must agree on branch, SHA, frontend, backend, staging
project and `unpaired`; a missing shard fails.

**The shared preview lock.** Seven preview-backend consumers now share one concurrency group keyed on
the branch, `cancel-in-progress: false`. Observed working: Operations Serena held the group and the
staging gate queued behind it. Recorded sharp edge — GitHub keeps only **one pending run per group**,
so a newer queued run supersedes an older queued one.

**Tripwires: 21.** The original 9, plus 6 aggregate (missing shard, SHA/backend disagreement,
unpaired, wrong staging project) and 5 scheduling, and 1 shard-shape. Two of my own assertions were
wrong first — one tripped on `testMatch` in a comment, one on a shell `grep`.

### Why it stopped

**The staging Postgres is saturated and not recovering.** Every backend deployment times out on every
endpoint while the frontend is healthy, and an independent path (the Supabase MCP, not the CI pooler)
times out identically.

`postgres_logs` are unambiguous — **zero** cron-startup timeouts, SSL rejects and statement timeouts
for the 20 hours to 05:00 UTC, then onset at **06:00**, which is when the repaired gate first ran its
**full workload**:

| hour (UTC) | cron startup timeouts | SSL rejects | statement timeouts |
|---|---|---|---|
| 09-07 10:00 → 09-08 05:00 | **0** | **0** | **0** |
| 09-08 06:00 | 28 | 13 | 7 |
| 09-08 07:00 | 108 | 57 | 102 |
| 09-08 08:00 | 138 | 77 | 37 |

**This remediation caused it** — not through a defect, but through its effect: provisioning the
missing identities and fixing the fast-failing tests multiplied the real database work per run, and
the shared staging project cannot absorb it. Same root cause as the Marketplace `429`s, one level
deeper: that was the API rate limiter, this is the database.

It has not recovered in 30+ minutes with **zero** CI load and no local runs.

### Needs the owner

1. **Recover the staging Supabase project** — restart it or terminate the stuck backends. Neither is
   possible here: the database cannot be connected to in order to run `pg_terminate_backend`, and
   restarting the project is not authorized for this task.
2. **Then the capacity question**, because recovery alone will not stop recurrence — a larger staging
   instance, a dedicated certification database, or a smaller certification footprint.

Nothing was worked around. No timeout raised, no test disabled, no result reported as green.
**T13 remains blocked.**

## T12 — Attributed customs & Zimbabwe destination · `T12-USABLE`

> **CarUp coordinates customs. CarUp is not ZIMRA, and CarUp is not a licensed clearing agent.**

**There is NO CarUp duty or tax calculator.** Not disabled, not behind a flag — it does not exist.
That is an explicit MVP scope decision by the owner, not a gap. Amounts are transcribed from
evidence; unknown stays unknown; and customs FX is external-source only.

### The audit's first result was a forgery, not a gap

Approving an OCR document INSERTed a row into `zimra_declarations` — a table modelling an act by the
Zimbabwe Revenue Authority — in which almost every field was manufactured: a random `CUS_` reference,
`'Beitbridge'` defaulted as the port, `50000` defaulted as duty **calculated *and* paid**, a hardcoded
exchange rate of `13.5`, today as the customs stamp date, and an **officer signature hash that was a
SHA-256 of CarUp's own document id.** `cvr_ownership_records` the same, down to one real-looking
national ID defaulted onto every registration book.

`vehicleFactResolver` already refused those rows — **but it was not the only reader.**
`trustGraphService` scored the mere EXISTENCE of a row, so a declaration this codebase synthesised
itself was worth **+10 trust** there while being refused there. Both now ask one question.

### Production blast radius — read-only, aggregates only, and NIL

The owner authorized one bounded investigation. Environment identity was captured and proved by
contrast with staging (different host, different user, 223 vs 328 tables, 29 vs 229 users), and the
production connection is a **structurally read-only role** — mutation is impossible at the credential
level, not merely avoided.

Every synthetic predicate was derived verbatim from the removed writer at `df627937^`. **Both tables
are entirely EMPTY in production**: the denominator is zero, not just the numerator, so there is no
interpretation to argue about. `cid_clearance_records` / `vid_inspections` / `zinara_licensing_records`
were **code-audited only** — no writer exists anywhere in git history, so the conditional
authorization to count them was not exercised.

**Writes: none. Row data read: none.** → **NO MEASURED PRODUCTION BLAST RADIUS.**

### The certification gate that had been dead for months

`Diaspora Deployed Staging UAT` was pinned to `head_ref == 'claude/diaspora-phases-8-10-production-program'`
with hardcoded URLs from a **different Vercel project**. That branch is long dead, so the job's `if:`
was false on every PR and the workflow reported `skipped` — **a green tick, for months, for a gate
that had certified nothing.**

Replacing one hardcoded branch with another would reproduce the defect on a slower clock, so the pair
now resolves from the governed manifests, and **a branch with no governed pair FAILS; it does not
skip.** The logic lives in a script rather than YAML, **because a refusal nobody can test is not a
gate**: seven named refusals, 20 tests with positive controls, and **8 mutations of the refusals, all
red**.

### The truth model

`assertion_class` is the whole phase, with exactly two values — `CARUP_OBSERVED` for a physical fact
an authorized person saw, and `ATTRIBUTED` for everything an authority did, carrying who said it,
their relationship, when, and on what evidence. There is no third class, and **none that means
"true"**.

The same **USD 1,420.50** produces two different sentences:

| source | headline |
|---|---|
| an authority document, attached | **Assessment amount** — "CarUp did not calculate it." |
| an agent typing it | **Agent-reported amount** — "…their figure, not the authority's." |

Two headings, not one heading with two badges. **A reader skimming for a number will not read a
badge.** The phrase "duty paid" appears nowhere, and a test asserts it.

`VEHICLE_REGISTRATION` is deliberately absent from the vocabulary — registration is the CVR's act.
General cargo completes the entire phase without touching a single vehicle authority.

### What the DATABASE enforces

A rate with no source or no effective date is refused by a CHECK constraint — **that is the removed
`13.5`**. So is an authority claim with no document, an amount where an amount cannot mean anything,
and a CarUp observation borrowing an authority's name. The event stream is append-only structurally,
with the correction path (supersede and attribute) proved to still work.

### Certification

| gate | result |
|---|---|
| staging journeys A–I | **36 / 36** |
| responsive, 7 widths × 2 surfaces | **14 / 14**, and the gate was proved to FAIL on a case that does not exist |
| mutation matrix | **30 named, 30 red** |
| PGlite schema gate | 34 / 34 |
| security matrix | positive controls on **both** sides — the operator, the appointed agent and each participant can read; the importer CAN supply their own receipt; everyone else is refused |
| backend · gates · `tsc -b` · lint | 6390 · 0 fail · 8/8 · clean · NET_NEW=0 |

### What each kind of looking found

- **The mutation matrix found one that SURVIVED** — adding `DOCUMENT_PROVIDED` to the RELEASE step's
  satisfying list broke nothing, so §I's own rule (*uploading "release.pdf" does not release goods*)
  was unguarded. Fixing it exposed a second: the checklist decided EVIDENCED from the SOURCE, so the
  documents step read "Reported, no document" for a document that had been attached.
- **Looking at the deployed page at 393px** found the third — the participant saw a customs rate with
  no source and no period while the operator saw both. A rate without its provenance is what this
  phase removed.
- **A governed staging fixture found the fourth** — `users.id` is TEXT here, and `agent_user_id` was
  declared `uuid`, making the appointment path unusable against real identities. The in-memory client
  has no column types, so `'user-agent'` inserted happily into a column Postgres would reject.

### Still out of scope, by ruling — and nothing invented against it

No duty rate, VAT rate, surtax, age rule, exchange-rate source, valuation formula, import ban, rebate,
broker fee or port charge has been introduced anywhere. The **source register** is provenance, not
law, and carries no rate to invent from. The vehicle age restriction is `NEEDS_LEGAL_CONFIRMATION`
and deliberately **not** an automatic rejection engine: the instrument has visibly moved, so a policy
check is not a customs decision and **CarUp declares no vehicle un-importable.**

## T11 — Shipment & tracking · `T11-USABLE`, conditional freeze

**The audit found the opposite of the last two phases.** T9 had nothing; T10 had the word and not the
fact. T11 had a substantial, largely sound authority already. **So T11 creates no second shipment
table** — its job was closing the ways it could assert things nobody observed, then building the two
screens through which anybody could see any of it.

### The four defects the DEPLOYED product showed that no unit test could

**1 · The operator who loaded the container could not ship it.** The *first act* of the T11 journey
was a `403` for the person the phase is for. Shipment authority was read off the affected record's
tenant — and **a diaspora buyer's import order has no tenant**, it is a consumer purchase. So on every
co-loaded sailing the check fell through to platform admins only, and the container's own operator,
who had just planned the load, loaded it and sealed it under T10 — and who could *read* the T11
shipment view of that same container — could not create or move its shipment. **The read surface knew
who ran the sailing; the write surface did not.** Authority is now read off the CONTAINER, through a
canonical `isSailingOperator` that T5, T7, T8, T10 and T11's read surface had each grown a private
copy of. Invisible to the unit suite because **every fixture gave its order a tenant.**

**2 · A shipment could disagree with its own history about when it sailed.** The observed time had
two unrelated readers — the column took `payload.event_time`, the timeline took
`payload.metadata.event_time` — so a stated departure moved one and left the other stamped `now`. And
every stage that writes no column (a customs hold, an exception) reached the timeline through the
second path, **where nothing validated it**, so a movement could still be dated into the future.

**3 · A ship could arrive before it left.** The stage rule stopped `ARRIVED → IN_TRANSIT`. Nothing
stopped `IN_TRANSIT` at 18:24 followed by `ARRIVED` stated at 15:24 — and because the timeline is
ordered by when things happened, the customer's journey showed the arrival first. The creation record
is excluded from the new rule deliberately: a shipment is often written up after it sailed, so the
*first* movement may still be back-dated.

**4 · A timeline read back as an object.** A fake returned a bare row where Postgres returns a list.
Fixed on both sides — and the reader normalises rather than assuming, because quietly reading an
unexpected shape as "no previous movement" would leave the rule silently unenforced.

### The timeline is now append-only *structurally*

`BEFORE UPDATE` and `BEFORE DELETE` guards, FORCE RLS, a REVOKE. Only `deleted_at`/`updated_by`/
`updated_at` stay mutable. Exercised against the **live staging database** as the most privileged
direct caller: rewriting `stage`, `event_time`, `created_by` and `location` all REFUSED, hard DELETE
REFUSED — and the **positive control**, the soft-delete that is meant to work, ACCEPTED. The probe
rolled itself back.

### The T11/T12 coupling — closed, and worse than the audit recorded

`SHIPMENT_TO_IMPORT_STATUS` mapped `RELEASED → RELEASED`. The purchase ladder is
`ARRIVED_AT_BORDER → CUSTOMS_IN_PROGRESS → DUTY_PENDING → DUTY_PAID → RELEASED` — so because
**`RELEASED` sits after `DUTY_PAID`**, a movement action was asserting that duty had been paid. The
map is reduced to movement facts only; the three removed stages are named with their reason in
`STAGES_HANDED_TO_T12`.

### Certification, against a proven FE/BE pairing

| gate | result |
|---|---|
| staging journeys A–G | **33 / 33** |
| responsive, 7 widths × 2 surfaces | **14 / 14** |
| mutation matrix | **19 named mutations, 19 red** |
| append-only, direct DB writes on live staging | 5 refused + positive control accepted |
| security matrix | 12 rows, **positive controls on both sides** |
| backend / web / gates / `tsc -b` / lint | 6324·0 · 1837·0 · 7/7 · clean · NET_NEW=0 |

**Positive controls throughout**, because a matrix that only shows refusals passes just as happily
when the endpoint is broken for everybody: the operator *can* read, each participant *can* read their
own, a customs hold *can* be lifted, and the container that *was* loaded *did* get a shipment.

**The mutation matrix found two defects in itself.** It passed `--reporter=basic`, which this vitest
does not have — it died loading the reporter, ran **zero tests, and exited 0**, so both web mutations
"survived" while never being tested at all. A third silently matched nothing and was reported
`SKIPPED` rather than passing, which is how it was caught. The matrix exists to find checks that
cannot see what they claim; it found two in itself.

**Recorded, not fixed:** the `Diaspora Deployed Staging UAT` workflow is hard-pinned to
`github.head_ref == 'claude/diaspora-phases-8-10-production-program'` with hardcoded URLs for a
different Vercel project. It cannot run on any current branch, and has not for a long time. Out of
scope here; flagged rather than silently repointed.

## T10 — Consolidation & loading · `T10-USABLE`, frozen at `d6918041`

**The audit found the mirror image of T9's problem: the word "loaded" already exists in FIVE places
and the fact exists in none.** Import-order status, container status, shipment status, an
intelligence heuristic, and a passport slot already labelled `owner: 'T10'`. None records what was
loaded, who confirmed it, or when.

Recorded rather than quietly patched: **`POST /containers/:id/mark-loading` already works** with no
manifest, no check that anything was received and no seal — and `mark-shipped` sits immediately
after it, so the same unmanifested path reaches a T11 fact.

So T10.1 adds no sixth spelling of the word. Five tables add what is underneath: **a plan and a
loaded fact, deliberately separate.** A plan is provisional; a loaded fact is an attributed act.
Planning cargo in creates no manifest line, and the customer's own view still says loading has not
started. Left-behind cargo **stays on the manifest** with a bounded reason and no volume. Container
and seal identifiers — which existed nowhere in the schema — are append-only, so a replaced seal
leaves the previous one readable.

**Three measurements now coexist:** booked 3.0 (T5) · warehouse 3.8 (T9) · loaded 3.6 (T10), proven
by a join across all three authorities.

T10.2's readiness is **derived, never stored**, and always names its blocker — a stored `is_ready`
keeps asserting a fact about the past, and a magic boolean gives an operator nothing to act on. It
counts documents and never interprets them: `documents_present: 3` is true, "customs ready" is T12's
and is not said.

**T11 firewall:** the load vocabulary stops at `COMPLETED`; no column NAME could hold a later phase's
fact; the migration never references the shipment authority. Adding `DEPARTED` or a `departed_at`
turns the gate red.

PGlite **34/34** as its own CI step · **14 mutations red** · service suite **39/39** · a trap client
proving no T10 call writes T5, T9 or the estimate. Staging only.

**The services ARE wired**, proven on the deployed backend as four signed-in people —
`t10-loading-smoke.mjs`, **19/19**. Planning is not loading (the customer still reads *"Loading this
container has not started"*), the loader is the authenticated actor, all three measurements come back
distinct (booked 3 · warehouse 4 · loaded 3.6), T5's ledger still sums the estimates, and the
firewall holds in the data. Privacy with positive controls: operator 200, customer 403×4, co-loader
403, foreign operator 403, anonymous 401/403.

That harness first asserted a magic 3.8 CBM and failed on the data being *correct* — the T9 journeys
legitimately leave a later correction as the current measurement. It now asserts the **invariant**
(three distinct values, none overwriting another), which is what the phase actually guarantees.

**Convergence done, following T9's pattern rather than inventing one.** Evidence rides T8 on one
added subject value (`container_load`) — a loading photo is `PRESENT`, never `VERIFIED`, and a
container with forty photos and no attributed manifest line has not been loaded. Notices ride T7,
registered in both halves with literal event types.

The event that matters is the second one. **`cargo_left_behind` is HIGH priority** and carries the
bounded reason in plain words, because the person at the other end is waiting for goods that are not
coming. An unrecognised code yields *no* sentence rather than a guess at one, and the notice promises
nothing about what happens next — no refund, no re-booking — because none of that is T10's to
promise.

**Closure.** `353fc38f` was services with no screen — the exact gap that kept T9 from acceptance at
its first candidate. Four things closed it.

**The legacy bypass is CLOSED.** `mark-loading` now requires a live T10 load and `mark-shipped` a
COMPLETED one; the sailing's status **reflects** the canonical loading authority rather than competing
with it. 12 regression tests, 7 mutations red, both positive controls present. The positive control
also caught `transitionContainer` writing the row, sealing the audit, and *then* throwing if the
outbox was unreachable — reporting failure for work that had already committed.

**§7 capacity pressure, with the asymmetry that is the point:** a PLAN is a claim about the future
and an impossible one is refused, naming the overage and the governed way out. An ACTUAL LOAD is an
observation of the past and is never refused — a system that declined to record what somebody watched
happen would be choosing its model over reality, and the operator would write the truth down
somewhere it cannot see.

**Two surfaces.** The operator's shows readiness reasons *and whose they are*, keeps the plan and the
manifest as separate panels, and shows capacity pressure while planning rather than springing it at
confirmation. The participant's protects one distinction above all: **nothing recorded yet ≠ left
behind** — silence versus a decision somebody made about your goods.

**The defect the deployed product found, again:** at 393px five candidates rendered `RES-99994444`,
and in the *"what actually went in"* dropdown those would be five identical options an operator picks
from. T9 hit the same shape. Second time, and both times every unit test passed against fixtures
whose ids happened to differ.

**Certified:** journeys A–F **33/33** · privacy with positive controls · responsive **14/14** ·
PGlite **42/42** · **15 mutations red** · Journey F on the database: a container was loaded and
**0 shipments, 0 stage events** came into existence.

Three checks that could not see what they claimed are recorded in the receipt, including a
`mockSupabase` that accepted `.delete()` and silently ignored it — making every "this never deletes
X" test unfalsifiable until now.

## T9 — Warehouse intake & measurement · `T9-USABLE`, frozen at `ee747940`

**No warehouse authority existed anywhere** — branches are party locations, `vid_inspections` is
roadworthiness, workbook receipts are spreadsheets. T9 creates it, as T5 did for corridors.

The boundary the schema exists to hold is **ESTIMATED ≠ ACTUAL**. The estimate is not touched — not
one column of it. The gate proves the customer's **3.0 CBM survives a 3.8 CBM measurement** and that
the **+0.8 difference is derivable from both**. A receipt is an **attributed act**: `RECEIVED`
without a receiver and a time is refused by the database. A refusal must say why. Storage location
stays unknown until assigned. Condition is the receiver's own observation from a bounded vocabulary,
never inferred from an image.

The schema **cannot express** `LOADED`, `SHIPPED`, `DEPARTED` or `CUSTOMS_CLEARED` — there is no
column to smuggle a later phase's fact into, and the gate proves `status='LOADED'` is refused.
**T5's capacity ledger is untouched**: T9 records a discrepancy, it does not rewrite the ledger.

All three tables `ENABLE`+`FORCE` RLS with `anon`/`authenticated` revoked. PGlite gate **20/20** as
its own CI step, mutation-proven twice. Backend **6091/0** (21 skipped). Staging only.

**Closure (2026-09-07).** `27a2a558` was authority only — the central act of the phase could be
performed with a SQL statement and nothing else, which is not a phase that has been built.

Three refusals now carry it, each mutation-proven: **a customer cannot mark their own cargo
received** (authority comes from the WAREHOUSE, and the cargo's owner is refused outright — a
platform admin included, because seniority is not the question); **`received_by` is the authenticated
actor**, so a forged one has nowhere to land; and **nothing writes T5's ledger or the estimate**,
proven by a trap client that fails if a foreign table is written at all.

The case that needed real thought was the **incomplete** estimate. Summing a column containing NULLs
and calling it the estimate is the unknown-becomes-zero collapse, and every later discrepancy would
be a lie — so the screen says *"At least 3.000 CBM — 1 of 2 cargo items had no stated volume"* and
the discrepancy reports `NOT_COMPARABLE` rather than inventing one.

**Certification at a proven pairing:** staging journeys **34/34** as four real signed-in people,
privacy **with positive controls**, responsive **14/14** across seven widths and two surfaces, PGlite
**29/29**, **14 mutations**. Evidence rides T8 through one added subject value — no second store, and
`presence is not verification` inherited whole.

**The defect the deployed product found:** at 393px, four consignments all read `WHIN-99994444`. The
reference was the subject id's first eight hex characters, and the receive confirmation asked the
operator to type exactly that string — so the one check between a mis-tap and receiving the wrong
participant's cargo could not tell two consignments apart. Every unit test had passed against a
fixture whose ids happened to differ.

**Stated, not hidden:** the outbox drain was not exercised (secret-guarded on staging, 142 events
unprocessed across ALL types — an environment fact affecting every phase); T9's producer half is
proven 18/18 addressable on the deployed system. A volume with no dimensions behind it is refused
rather than stored as a claim.

## T8 — Documents & Evidence workspace · `T8-USABLE`, frozen at `00f164e4`

**T8.0 found T8 is not greenfield.** Record, storage, extraction, verification, the type/rule
vocabulary and readiness all already had owners. No competing document authority was created, and
Google Drive stays a storage provider rather than the business record.

**The defect this phase exists to prevent was real.** `createTradeDocument` read
`verification_status: payload.verification_status || UPLOADED`, so a client could post
`verification_status: 'VERIFIED'` at upload time. The verify/reject routes are properly
reviewer-guarded — this path simply never went through them, so the guard was real and irrelevant at
once. An uploaded document is now **UPLOADED, always**.

**The record was the only layer that never generalised.** Drive files and readiness already carried
a generic subject binding *for the same domain*, while the document bound to `import_order_id` alone
— so a logistics request, a container sailing or a Trade Order could not own a document at all.
Migration `20260909090000` is additive and reversible, with three database CHECKs: a subject is a
pair or nothing, exactly one owner, and a bounded vocabulary (free text is how a shadow entity gets
invented later without anybody deciding to).

**Gates at `e4283fe1`:** backend **6070/0** (21 skipped) · T8 suite 9/9 · **T8 PGlite gate 12/12 as
its own CI step, confirmed executed** · lint 0 · **CI 7/7 green**. Six mutations proven, including
the presence→verified collapse and the database CHECK itself. Migration applied to **staging only**.

**Closure (2026-09-07).** `e4283fe1` was superseded because the two things the PARTIAL receipt named
were real product gaps: there was **no workspace at all** (a logistics request or sailing could own a
document no screen could show) and **no versioning at all** — a corrected document could only be
added unrelated or overwrite the original, and the second destroys evidence.

**Versioning:** a replacement is a new row; the predecessor keeps its verdict, reviewer, timestamps
and attribution. **V2 starts UPLOADED even when V1 was VERIFIED** — inheriting a verdict on a file
nobody has looked at is the presence→verified collapse wearing a different hat. The owner is
inherited so a replacement cannot smuggle evidence between transactions, and the database refuses a
concurrent second replacement.

**Workspace:** one surface for all four governed subjects, driven by the governed type vocabulary
rather than a second checklist in React. A supplied document reads *"Supplied — awaiting review"*
until somebody has looked; extraction is reported as provenance, never as a status; nothing is called
legally required.

**Certification: 0 findings** at a paired head — privacy with **positive controls**, the phase
firewall re-proved in the deployed payload, and seven widths clean. Backend **6091/0** · two PGlite
gates **12/12** and **11/11** as their own CI steps · **ten mutations proven**.

**Still open, and stated:** upload byte-path failure/recovery is not certified against a real storage
failure, and live OCR is unavailable on staging so the extraction boundary is certified by contract.
**T12-BLOCKER carried forward unchanged.**

## T7 — Communications lifecycle · `T7-USABLE`, frozen at `3f062fc0`

**T7.0 found there was nothing to build from scratch.** CarUp already has a complete Communications
authority, Trade OS already produces into it, and there is **no duplicate message or notification
store anywhere**. `message_threads.subject_type` + `subject_id` is exactly the transaction binding
needed, so **no new table was created** — no `trade_messages`, no second inbox.

The work was convergence, and five defects surfaced by using the product:

1. **The procurement buyer could not start a conversation at all** — only the supplier could, while
   logistics let both sides talk. Every offer card now offers *"Ask this supplier"*, and says
   plainly that asking is not accepting.
2. **A buyer could seat a stranger as "seller."** `sellerId` arrives in the request body and nothing
   verified the named person had any relationship to the order. A supplier now earns that place by
   having made an offer; a hostile *seller* was already safe, since the server uses the caller's id.
3. **Container booking talked at people and gave them nobody to answer** — notifications only. Now a
   real participant ↔ organiser conversation, one thread per (sailing, participant), because
   co-loaders share a box, not a group. Asking *before* approval is allowed; that is the point.
4. **A sailing's own coordinator was refused on their own sailing** — the operator check needed
   platform or tenant-admin authority, and a provider-created sailing can have a null `tenant_id`.
   The unit fixture had quietly given that coordinator platform authority, which hid it.
5. **Every trade thread was called "Marketplace conversation"**, so three trades in flight looked
   identical in the inbox. They are now named — *Sourcing request RFQ-87B14D63*, *Shipping request
   SHIP-F2505399*, *Container sailing SAIL-561ADEDF*.

**T7.5** takes the `quote_withdrawn` decision T3 deferred rather than deferring it again: the
requester is told when a SUBMITTED offer is withdrawn, a DRAFT withdrawal emits nothing, and the
withdrawing provider is not notified. The event is registered end to end — listener *and* policy —
with a test for both, because an emitted event with neither reaches no human while looking done.

**A conversation is never authority.** Nothing here awards a quote, approves capacity or creates a
warehouse fact.

**Gates at `5ccac408`:** backend **6025/0** (21 skipped) · Communications + Trade OS phases 588/588 ·
new T7 authority suite 16/16 · web **1667/1667** · `tsc -b` · build · lint NET_NEW_ERRORS=0 ·
**CI 7/7 green** · seven widths clean · staging anti-bypass matrix green at a paired head, including
a control proving the guard is not blanket-deny.

**Closure (2026-09-07).** Everything the PARTIAL receipt named is now closed: logistics
conversations certified against the ACTUAL policy (two of my first tests asserted refusals that do
not happen — while a request is open any eligible provider may ask before quoting, and the product
was right); read/unread certified with 13 tests and the query shape pinned at 4 round trips for 26
threads; **the shipment-exception producer already existed and nobody was listening**, so T7 added
the consumer only, with T11 recorded as the authoritative producer; channel routing certified as
in-app-only by governed policy with the canonical record provably preceding any send; and the
warehouse boundary asserted — **no Trade OS communication module writes to any table at all**.

**Thirteen mutations proven.** One initially SURVIVED: a DRAFT-silence test asserting a null return,
which is also null when the outbox is merely unavailable, so it stayed green after the guard was
deleted. The emitter is now injectable and the test observes that nothing was *sent*.

## T6 owner acceptance — 2026-09-07 · `T6-USABLE`, frozen at `2d0a0bc0`

The acceptance walk was not a formality. It found a **twelfth defect, and a blocking one**, which is
why the freeze SHA is `2d0a0bc0` and not `209e491b`.

Two real suppliers were put on one requirement. Supplier A disclosed three things — the goods
(priced), Zimbabwe duty (EXCLUDED), inspection (NOT_APPLICABLE). Supplier B disclosed one, and said
nothing about customs. The buyer's screen said *"These offers cover the same scope, so the totals
compare directly. Lowest recorded total: Sakura Motors Export"* — naming the supplier who had
disclosed **less**. `assessComparability` scored scope on INCLUDED stages alone, so silence and a
disclosed exclusion were identical, which inverts the module's own rule that *uncertainty is
penalised, never rewarded*. Alongside it, the server's `covers_full_journey` flag — sent with a
comment telling the caller to surface it — reached no screen.

Both fixed and mutation-proven, with the honest ocean-leg case preserved by its own test. Now:

> CarUp is not calling one of these cheaper. These offers do not describe the same purchase…
> SYNTHETIC Trade OS Supplier uat says where it stands on Import duty and taxes;
> SYNTHETIC Sakura Motors Export does not mention it.

**Chronology is preserved, not tidied:** `T6-PARTIAL` implementation (`b6ba1ccd`) → `T6-PARTIAL`
product closure (`209e491b`) → acceptance-cycle correction → freeze (`2d0a0bc0`). T6 was never green
from the start.

**Four journeys walked in the browser at a paired head.** Procurement 27/28 — JPY 2,400,000 survived
compose, review, persistence, refresh and relogin, was never redenominated, and after the award the
compliance record carries `JPY 2,400,000 Accepted` and `USD 14,500 Rejected` forward without
re-entry. Logistics — excluded customs never `$0`, unknown stays unknown, and "Still unpriced" lists
customs and inland but **not** "The goods themselves". Research — synthetic rows badged, no
preferred corridor, and a trader is redirected before the workspace mounts while the API refuses
403 `INSUFFICIENT_PERMISSIONS` on read, benchmark and write (measured with a real CSRF token, so the
refusal observed is the authorization one). Allocation — APPROVED-only, exact reconciliation, and
**replay offers no second division**.

**Gates:** backend **6009/0** (21 skipped) · phase suites 264/264 · T6 78/78 · web **1660/1660** ·
three PGlite gates · `tsc -b` · build · lint NET_NEW_ERRORS=0 · **CI 7/7 green with every step
confirmed executed** · FX: ZWG/MZN/TZS `UNAVAILABLE` with a reason, never 0 or 1:1 · **seven widths ×
seven surfaces, no overflow**, including the 393px ZWG regression re-guarded with the offending
sentence on screen.

**`T6-USABLE` is not production-ready.** T18 still owns production readiness; production remains
NOT AUTHORIZED and untouched — it serves `78303ed6`, which contains no T6 file.

**Recorded, not fixed — T12-BLOCKER.** `documentIntelligenceService.js:375` writes a
`zimra_declarations` row with an invented exchange rate (13.5) and duty (50000). Customs valuation
is T12's engine; fixing it here would be this phase manufacturing a legal assessment. Verified: no
T6 service or route reads it.

**Status: `T6-PARTIAL`. Owner acceptance is outstanding and is the owner's to give — this agent
does not mark `T6-USABLE`.**

Docs: master plan §44 (contract) · §45 (execution); plan
`docs/trade-os/T6_RATES_PRICING_LANDED_COST_IMPLEMENTATION_PLAN.md`; receipt
`docs/trade-os/receipts/T6_RATES_PRICING_LANDED_COST.md`.

---

## T5 — Container Marketplace & Multi-Corridor Compatibility

**The correction T5 exists for:** a customer's final destination is not the destination of the
sailing they book. Country-equality on both endpoints meant a real `Yokohama → Beira` sailing could
never serve a Harare customer without lying about one side of the route. It now can, and the screen
says so in the customer's own terms:

```
Your destination: Harare, Zimbabwe
This sailing covers: Port of Yokohama → Port of Beira — Japan → Beira → Zimbabwe corridor
Then still required: Forbes/Machipanda → Harare — not part of this sailing, not yet arranged.
```

**Built:** a corridor authority created from scratch (none existed anywhere in the repo) —
`diaspora_trade_corridors` + `diaspora_trade_corridor_legs`, route composition only, never rates,
customs, shipment state or preference. A deliberate sailing lifecycle
(`DRAFT → BOOKING_OPEN → BOOKING_CLOSED | CANCELLED`) where creating is not publishing. Corridor-aware
discovery replacing final-destination equality at both matching sites. Mode reconciliation so an
offer can say `roro` — while a roro offer still cannot attach a shared-container sailing, because
the container does not carry it. And **the standing §36.10 lifecycle gap is closed**: a requester can
cancel or close their own request, which frees the T4 one-live-continuation slot.

**F1–F5 disposition at freeze** (master plan §42, accepted at §43):

- **F1** — publish no longer blocks on discovery: **13–14 s frozen wizard → 6.1 s to a usable page**,
  with discovery filling in +3.0 s later. A pending read is its own state, never "none found"; a
  failed one stays UNREADABLE with **Try again**.
- **F2** — discovery is no longer N+1: **7 queries at 1, 10 and 50 sailings** (asserted, not timed).
  Staging warm median **2344 ms** against a **1380 ms** plain-read floor, down from ~5600 ms. The
  capacity kernel and its atomic approval RPC are untouched.
- **F3** — the multi-corridor option is no longer buried: two named categories, each ordered by
  departure date, under *"CarUp does not rank them — the choice is yours."* No ranking was added;
  economics remain T6's.
- **F4** — certification data repaired; no product logic changed to prettify fixtures.
- **F5** — the gateway card still names the sailing's own ports; still mutation-guarded.

**Evidence:** PGlite migration gate 15/15 · backend 1553/0 · web diaspora 151/151 · owner-UAT proxy
13/13 + 27/27 + 7/7 · adversarial 37/37 · seven-width geometry 14/14 (requester **and** operator) ·
0 console errors on settled pages · 0 5xx · `tsc -b` clean · CI green.

**Provenance:** FE **and** BE both deploy from `5079b0b3` — FE `dpl_BpSJA8HXAYLfQiMUhVrs9QUaeunr`
(bundle `index-BrN5lNNZ.js`), BE `dpl_BTcyPeiQjWzcvSajx49AQ444fAFn`, `/api/health` reporting the same
SHA, with the FE→BE pairing read out of the served bundle rather than inferred. Supabase **staging**
only; migration `20260907090000` applied to staging only.

**Accepted residual:** the remaining ~6.1 s staging publish→detail transition is accepted as
non-blocking platform/performance debt — discovery no longer blocks the detail page, matching is
asynchronous, the N+1 was removed, query count is bounded, and no T5 invariant depends on the
latency.

Docs: master plan §40 (contract) · §41 (implementation + first certification) · §42 (final closure)
· **§43 (owner acceptance / freeze)**;
plan `docs/trade-os/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR_IMPLEMENTATION_PLAN.md`;
receipt `docs/trade-os/receipts/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR.md`.

---

*The T2/T3/T4 evidence below is preserved as the historical record of those phases.*

## Owner UAT

**Round 1** produced eight findings, all corrected. **Round 2: PASS**, performed against runtime
candidate `5958e436` served as `index-DbaX20hJ.js`.

The head certified here differs from the build the owner inspected by exactly four things:

1. staging certification fixture isolation (`tests/agents/47-trade-os-t3-staging.spec.ts`);
2. the CI drift guard (`backend/tests/trade-os-t3-certification-isolation.test.js`);
3. two inert DOM identifiers — `data-container-id`, `data-reservation-id`;
4. documentation.

**No visual, product or runtime behaviour changed after owner approval**, which is why the owner was
not asked to repeat the full transaction walkthrough.

## What T3 is

T2 is procurement — *"I need to buy something."* T3 is logistics — *"I already own it, move it."*
The boundaries that must never collapse: a quote is not a booking, an accepted quote is not approved
capacity, a space request is not an approval, and **only APPROVED reservations consume capacity**.

## Certification fixture isolation (this cycle)

Spec 47 used to fill one long-lived shared staging sailing. Every certification approved ~3 CBM into
it and never returned the capacity, so it ratcheted upward — 9.000/47 after three runs, 45.296/47
after ~24, at which point a perfectly healthy run failed because the container product **correctly
refused to overfill**. The product was right every time; the certification was depending on capacity
earlier runs had consumed and on a human resetting a shared row by hand.

Each run now creates its own sailing — per run **and** per viewport project — through the governed
operator API `POST /container-marketplace/containers`. `createContainer` makes the creator the
`coordinator_id` and `assertProviderMayOfferContainer` admits the coordinator, so the provider
attaches its own sailing through the same authority check a real operator passes. Nothing is
bypassed: `apiAs` sends `x-tenant-id` from the stored user's `active_tenant_id` exactly as the app
does, because `authorizeRole` only consults `tenant_users` when that header is present.

A side effect worth stating: the foreign-attach refusal is now a **stronger** proof — it is refused
for a caller who *is* a tenant admin of another tenant, not merely one holding no tenant role.

Assertions were strengthened, not relaxed. Because the ledger starts empty, capacity checks are
absolute (`0 → 3`) instead of relative; the manifest is asserted to hold exactly one reservation
before and after replay; re-approval is asserted not to consume twice; and the operator card is
checked against the capacity ledger.

## Evidence at `b446d8ea`

**Deployment** — FE `index-C8Mq-5Lh.js` (both DOM identifiers verified in the served asset); BE
`/api/health → commit_sha b446d8ea`; pairing confirmed by the single backend origin baked into the
served bundle.

**Spec 47 — 6/6**, `mode=acceptance`, run `t3iso-1788615917`, desktop/tablet/mobile. Verified from
the database ledger, not only from assertions — all three run-scoped sailings identical:

| | total | used | available | reservations | APPROVED | status |
|---|---|---|---|---|---|---|
| `…t3iso-1788615917.{chromium,tablet,mobile}` | 24.000 | 3.000 | 21.000 | 1 | 1 (3.000 CBM) | BOOKING_CLOSED |

`available = total − sum(APPROVED)`. One reservation each proves replay added no second row; one
APPROVED each proves re-approval did not consume twice; BOOKING_CLOSED proves cleanup touched only
run-owned resources.

**Accumulation proven eliminated:** the old shared sailing still reads **9.000/47, `updated_at`
11:51:31Z** — before this run began. The previous model would have left it at 18.000/47. A full
certification now consumes **zero** shared capacity.

**CI 7/7** at the exact head. The drift guard was verified to *execute* (subtests 5342–5349, all
`ok`), not merely to exist.

## Provenance caveat

Bundle hashes in this pipeline are **not reproducible for identical source**: `5958e436` →
`355887dc` is docs-only, zero bundle inputs, yet the two builds produced `index-DbaX20hJ.js` and
`index-BaUwx5WP.js`. `STAGING_EXPECTED_BUNDLE` therefore pins *"the build I measured is still the
one being served"*, not *"the served code equals commit X"*. Read the served hash off the live
deployment; never predict it.

## The principle this closes on

**Each certification project owns the capacity state it measures.** No shared sailing, no periodic
manual reset, no indefinitely growing capacity, no `.first()` resource selection, and no relative
capacity assertions against unknown inherited state. Enforced in ordinary CI by
`backend/tests/trade-os-t3-certification-isolation.test.js`.

---

**T4 NOT STARTED — requires separate owner authorization. Production untouched. This PR stays Draft.**



---

# T4 — Order & Booking Passport convergence (`8fc31aaa`) — **T4-PARTIAL**

T2 and T3 solved the decision layer. After a supplier or provider was chosen the user fell into
disconnected surfaces. T4 gives both origins one operating transaction view — **without building a
second copy of anything**.

## Authority decision: one column, no new table

The audit ran before any code. Existing authorities already own procurement, logistics, capacity,
documents, Communications and audit, and Communications was *already* converged (T2 and T3 both call
the same canonical `ensureReferenceFlow` on workflow `marketplace`). Exactly one fact had no home:
*"this shipping request is moving the goods from that purchase."*

That is an edge, not an entity — so T4 adds **one nullable FK**
(`diaspora_logistics_requests.import_order_id`) and no table. A `trade_transactions` table was
considered and rejected: it would duplicate an identity the two anchors already provide, and every
column it held would be a second copy of a canonical row. NULL is the normal case, which is exactly
what stops a procurement order being manufactured for cargo the user already owns.

## Truth rules carried forward

- **Furthest proven stage.** An awarded request with an APPROVED reservation reads *"Container space
  approved"*, not *"Provider selected"*. The projection is a pure function **on the server** —
  T3's equivalent lives in a React component where it cannot be tested alone or shared.
- **Never beyond evidence.** Warehouse intake, loading, shipment, customs and handoff report
  `NOT_STARTED` / `NOT_CONNECTED` / `NOT_RECORDED`. Unknown is not zero.
- **Privacy not relaxed for aggregation.** The awarded provider sees the transaction but never the
  requester's identity or a cargo VIN. T3's DRAFT-offer allow-list lives in its *route*, so a
  service caller would read past it — it is duplicated deliberately, with a test pinning the copies
  equal.
- **Idempotency in the database.** A partial unique index permits one live continuation per order;
  the race loser gets 23505 and is handed the winner. Partial so a cancelled request frees the slot.

## Evidence

Service tests **25/25** · real-Postgres constraint gate **11/11** (new CI step, confirmed
executing — this migration is past `NEW_MIGRATIONS`'s cutoff and would otherwise be executed by no
gate) · T3 **12/12** unchanged · web unit **1572/1572** · tsc clean · lint NET_NEW 0/0 · build ✓ ·
**CI 7/7**.

Deployed staging (FE `index-CrOj-Kvb.js` / BE `8fc31aaa`, paired): logistics-origin passport reads
`SPACE_APPROVED` on `SHIP-54829F7F`, sailing 24/3/21, `consumes_capacity=true`; the awarded provider
sees it with the requester **withheld** and neither VIN nor requester id present anywhere in the
payload; seven-width geometry clean, 0 console errors, 0 5xx.

## Final technical certification (`3a3d729e`)

**Staging schema applied under authorization**, staging only, ledger `20260905151925`, then verified
independently: nullable `import_order_id`, FK with `ON DELETE SET NULL`, the partial lookup index,
and the live-continuation unique index carrying exactly
`deleted_at IS NULL AND import_order_id IS NOT NULL AND status <> ALL (ARRAY['CANCELLED','CLOSED'])`.
**Production checked — the column does not exist there.**

### The defect only the deployed journey could find

The first procurement run returned **201 with zero cargo lines**: the API looked healthy while T4's
core "no re-entry" guarantee was silently broken. `cargo_category` is a lowercase vocabulary and
`'VEHICLE'` violated the CHECK — and **the insert's error was never inspected**, which is the half
that mattered. Fixed, along with a latent hazard on the same line: `linked_vehicle_vin` is a FK to
`vehicles`, so an unverified VIN would break the insert *and* assert an unauthorised vehicle link.
It is now carried only when the vehicle exists **and belongs to the buyer**, and a replay repairs a
missing cargo line. No mock could have caught this — mocks have no CHECK constraints.

### Both origins, same deployed candidate

**Procurement** `ORD-C1F0F150 → SHIP-18F70CAB`: correctly refused before acceptance; then 201 with
the order linked, route inherited, cargo "Toyota Aqua" at `measurement_basis UNKNOWN` with **null**
volume and weight; replay idempotent; **four concurrent activations → one id, no raw 23505**.

**Logistics** `SHIP-54829F7F`: `SPACE_APPROVED`, sailing 24/3/21, `consumes_capacity=true`,
`continued_from_order = null` — no procurement order manufactured.

### Security on deployed staging

Unrelated user **403** on both passports and on continue-to-logistics · anonymous **401** on both ·
non-awarded provider **403** · awarded provider 200 with requester **withheld** and no VIN field ·
payload scans clean of requester id, references, `storage_path`, `document_url`, `service_role`,
`tenant_users`, `deleted_at`, `created_by`.

### Gates

Backend **87/87** · real-Postgres **11/11** · web unit **1572/1572** · tsc clean · lint 0/0 ·
build ✓ · **CI 7/7**, with **both T4 gates confirmed executing** in the log. Responsive: both
passports, seven widths, no overflow, 0 console errors, 0 5xx. FE `index-DNz56QRa.js` / BE
`3a3d729e`, paired.

### One named gap

**Nothing in the codebase writes `CANCELLED` or `CLOSED` to a logistics request** — T3 shipped no
cancel capability. The slot-release predicate is correct and proven on real Postgres but unreachable
through the product, so a buyer who starts shipping for an order cannot currently start a different
one for it. The index is built for the capability that should exist; the capability is a T-phase gap,
not a T4 defect.

Twelve local `verification-*` failures are pre-existing — stashing every T4 change reproduced the
identical 25 markers at `04558148`. They pass in CI.

**T4-PARTIAL, remaining for exactly one reason: OWNER VISUAL / PRODUCT UAT.**
T3 frozen at `b446d8ea`. Production untouched. T5 not started. This PR stays Draft.



---

# T4 owner UAT → UX closure → **T4-USABLE**, frozen at `736f06c5`

**Owner verdict: PASS WITH FINDINGS.** The convergence architecture was accepted; three HIGH
findings blocked the freeze — all about the passport being hard to *understand*, none about it being
untrue. They stay in the record rather than being rewritten away.

| # | Finding | Closure |
|---|---|---|
| **F1** | "Who is involved" printed internal ids (`u_75baf4fa3c9a4f29`) | Business/trading name → person's name → **role**. No id fallback exists *by construction*; a test pins that no raw id reaches `participants` for any viewer. Withheld parties render by role and say so — T3's contract untouched. |
| **F2** | Passport never said what to do next | Server-derived `next_step` from the same facts as the stage. Links to the canonical workspace, names what is missing when blocked, shows WAITING instead of a duplicate CTA, and offers **nothing** once space is approved because the later stages have no authority. |
| **F3** | "Arrange shipping" ended in a soft dead-end | **"Continue shipping request"** goes straight to the linked draft. It still begins as DRAFT deliberately — an award is not a published RFQ, and nothing publishes on the customer's behalf. |
| **F4** | Messages had no way in | **"Open conversation"** into canonical Communications. No second inbox. |
| **F5** | Procurement showed "Japan → Zimbabwe" while the order recorded Yokohama/Harare | Recorded city no longer discarded. |
| **F6** | Supplier UI not walkable | **No product change** — it needs governed `dealer` authority and public registration correctly refuses it. Recorded as a fixture improvement. |
| **F7** | Mobile nav read as chopped | Trailing fade on an already-scrollable nav. Nothing hidden, no text shrunk. |

**Verified on the deployed candidate** (FE `index-Bks3yTmb.js` / BE `736f06c5`, paired) across four
passport states: no raw id anywhere including the provider view · conversation link on all four ·
"Japan → Harare, Zimbabwe" · mobile 393px clean · "Continue shipping request" lands on the draft
with its inherited cargo intact · each next step correct, including the two that correctly offer
none. Backend **90/90** · real-Postgres **11/11** · web **1572/1572** · **CI 7/7** with all three new
guards confirmed executing · 0 5xx.

> The UAT harness logged up to 24 `Failed to fetch` console errors. Idling without navigating
> produces **zero** — they were the harness aborting its own requests. Recorded because it was
> nearly reported as a defect.

**Recorded non-blocking gap:** a procurement-linked live logistics request cannot be cancelled or
closed through the product — nothing in the codebase writes `CANCELLED`/`CLOSED` — so the
one-live-continuation slot cannot be intentionally released. The index is correct; the missing piece
is a product action. **Required before production readiness**, home to be placed with logistics
request-lifecycle ownership.

**T4-USABLE. T4 FROZEN at `736f06c5`. T5 not started. Production untouched. This PR stays Draft.**
