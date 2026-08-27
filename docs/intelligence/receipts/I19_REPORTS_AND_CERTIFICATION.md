> Certification evidence in §3.1–3.5 was captured against staging at parent head
> `35752b16`. CI evidence in §3.6 is from lane head `dabbd8f6`, which carries the
> I19 source plus the lint-gate fix.

# I19 — Reports, Certification and Stakeholder Manualization

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I19 (final)

---

## 1. Delivered

**KPI explanations** — `kpiCatalogue.js`, one entry per published KPI. Each answers
four questions in the order a reader asks them: what it means, how it is counted,
what it excludes, and **what it is not**.

That fourth field is the one that earns its place. Nearly every fabrication this
programme removed was a figure standing in for a neighbour it resembled — a
requested loan amount read as money lent, a sandbox settlement read as a
settlement, a scheduled milestone read as money received, an accrued referral
benefit read as a payout, CarUp's own document review read as a government
verification. Fixing the code stops the surface asserting it; naming the near-miss
is what stops the reader assuming it.

**Periodic summaries and export** — weekly and monthly seller reports, with a CSV
export produced **by the server**, so the exported bytes are the API's own rather
than a second client-side rendering free to drift.

Three guarantees travel *inside* the file, because a report outlives the page that
explained it:

- an unmeasured figure exports as the literal words `NOT MEASURED`, never as a
  blank cell — a blank becomes a zero the moment somebody sums the column;
- every row carries its calculation version and the window it covers;
- every row carries its "what it is not" line, because a CSV has no tooltip.

**Stakeholder manuals** — `docs/intelligence/manuals/`, one per stakeholder
(seller, dealer, lender, insurer, institutional), each structured as: what you can
see · what you cannot see and why · what you are most likely to misread.

---

## 2. A defect found and fixed during this phase

While building the KPI catalogue, a repo-wide `grep` for calculation versions
skipped `financeIntelligenceService.js`, reporting it as *binary*. It contained a
**literal NUL byte**, written during I11 where a sentinel string was intended:

```js
query.eq('tenant_id', tenantId ?? '\x00')   // intended: a sentinel
```

It had passed every gate. The syntax was valid, the unit tests passed because the
test double compares JavaScript values, and the typechecker never sees backend
JavaScript. What it broke was invisible until something looked:

- **`grep` treats a file containing a NUL as binary and silently skips it**, so the
  file had quietly dropped out of every source-wide search — including the ones
  other tests use to assert that a fabrication is gone;
- at runtime the value would have reached PostgREST as a parameter Postgres
  rejects, turning "a lender with no tenant" into a read error rather than an empty
  result.

Fixed to a readable `'__no_tenant__'` sentinel — and the first correction dropped
the `tenantId ??` lookup entirely, which would have broken the legitimate case; the
I11 test suite caught that immediately and it was corrected before commit.

A new `source-hygiene.test.js` now fails on any control character in the source
this programme owns.

---

## 3. Certification

### 3.1 Controlled staging events — exact count reconciliation ✅

A marked set of 13 events was written to the staging ledger against a real
published VIN, reconciled, and removed. Every expected value matched exactly:

| Check | Expected | Observed |
|---|---|---|
| Events accepted | 13 | **13** |
| Replay of an existing idempotency key accepted | 0 | **0** |
| Raw listing opens | 11 | **11** |
| Seller-facing views (exclusions applied) | 8 | **8** |
| Seller-facing unique sessions | 4 | **4** |
| Excluded as self-traffic | 2 | **2** |
| Excluded as internal | 1 | **1** |
| Engagements | 2 | **2** |

**Event loss: zero** — 13 written, 13 present. **Idempotency: proven** — a
deliberate replay was rejected by the unique index. **Exclusion flags: proven** —
self-traffic and internal traffic are stored and are excluded from the
seller-facing count, which was the specific defect the I6 review found (the flags
had previously never been set, making `self_traffic_views` permanently 0).

**Schema enforcement, observed incidentally:** the first insert attempt was
rejected by the ledger's own `mae_surface_valid` CHECK for an out-of-allow-list
`source_surface`. The database enforces the event contract, not only the service.

### 3.2 Privacy — erasure ✅

`intelligence_erase_actor()` run against the controlled set:

| Check | Result |
|---|---|
| Rows still carrying the erased identity | **0** |
| Events still present | **13** — history is not rewritten |
| Rows stamped `identity_erased_at` | **3** |
| Distinct session keys retained for counting | **6** |

Erasure removes the identity while preserving the countable event and its session
key — the I6 fix, confirmed live.

### 3.3 Privacy — RLS on every Intelligence table ✅

| Table | RLS | Forced | Policies | anon SELECT | authenticated SELECT | service_role |
|---|---|---|---|---|---|---|
| `marketplace_activity_events` | ✓ | ✓ | 0 | false | false | true |
| `listing_daily_metrics` | ✓ | ✓ | 0 | false | false | true |
| `seller_daily_metrics` | ✓ | ✓ | 0 | false | false | true |
| `tenant_daily_metrics` | ✓ | ✓ | 0 | false | false | true |
| `platform_daily_metrics` | ✓ | ✓ | 0 | false | false | true |
| `intelligence_rollup_runs` | ✓ | ✓ | 0 | false | false | true |
| `intelligence_ingestion_stats` | ✓ | ✓ | 0 | false | false | true |
| `intelligence_recommendation_state` | ✓ | ✓ | 0 | false | false | true |

Eight of eight, the established idiom throughout: enabled **and** forced, zero
policies, anon and authenticated revoked, service_role granted. The API layer is
the boundary.

### 3.4 Staging restored ✅

The controlled set was removed in full. `marketplace_activity_events` = **0**,
certification residue = **0**, and the other Intelligence tables remain at 0. No
demonstration business data was seeded at any point.

### 3.5 Suite and build gates ✅

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4763 tests, 0 fail**, 21 skipped |
| Web suite | **1294 tests, 121 files, 0 fail** |
| Migration up / down / re-up (isolated Postgres) | **PASS** |
| Web typecheck | clean |
| Web build | clean |

### 3.6 CI on the lane head

GitHub reports **5 successful workflow runs and 1 skipped by trigger** — not six
successful runs. Stated precisely:

| Workflow | Conclusion |
|---|---|
| CI | success |
| Referral Engine CI | success |
| Navigation Intelligence CI | success |
| Communication Command Center CI | success |
| Diaspora Phases 3-7 Validation | success |
| Diaspora Deployed Staging UAT | **skipped** (its own trigger conditions were not met) |

A skipped run asserts nothing. It is not a pass, and this receipt no longer counts
it as one.

Two things had to be fixed or understood to get there, both recorded rather than
quietly re-run:

**The blocking lint-regression gate failed** on the I19 head with 29 net-new
findings — 13 `react-hooks/set-state-in-effect` (the synchronous loading reset in
each fetch effect) and 16 `@typescript-eslint/no-explicit-any` (my fetchers typed
`Promise<any>`). Both were genuinely mine and both are fixed: the reset now carries
the repo's established disable with a justification (it clears a stale payload so
a viewer never sees the previous period's figures under this period's label), and
the fetchers return `Promise<unknown>` with each component asserting its own
envelope at the boundary. The gate now reports `NET_NEW_ERRORS=0`.

**Two flakes were observed, neither a regression:**

- `intelligence-listing-completeness.test.js` failed once in CI with
  `failureType: uncaughtException`, `error: 'Unable to deserialize cloned data due
  to invalid or unsupported version.'` — a Node test-runner IPC deserialization
  fault at the file level, not an assertion. It passed on re-run and has never
  reproduced locally across many full-suite runs.
- `VehicleSearch.test.tsx` failed once locally at 2596 ms under concurrent test
  files, then passed in isolation and on a full re-run (recorded in the I18
  receipt).

Both are worth watching; neither indicates a defect in this lane.

### 3.7 Auth and scope

Enforced and tested at every projection: no route accepts a caller-supplied
seller, tenant, organization, bank or subject parameter; scope is resolved from the
verified session in every case. Institutional roles receive no commercial
behaviour, and `government` is admitted to no commercial projection (gap G5).

---

## 4. Certification NOT achieved, and why

Stated plainly rather than omitted.

| Item | Status | Reason |
|---|---|---|
| **Live ingest path** | not certified | Certification wrote to the ledger directly, which exercises the storage contract but not the HTTP ingest route. A live ingest run needs a provisioned staging session, and the staging DB credential on file is stale. |
| **Rollup lag** | not certified | The rollup is exercised by unit tests but was not run against staging, for the same credential reason. |
| **Web/mobile instrumentation parity** | not certified | Mobile instrumentation (I3c) remains sequenced behind PR #182's mobile Marketplace contract. |
| **Performance and soak** | not run | Requires sustained live traffic that staging does not have. |
| **Visual/responsive UAT** | not run | Requires a browser UAT pass against a paired preview. |
| **Business-count certification** for I9–I16 | blocked | 0 work orders, no live insurer, no lender onboarded, 2 provenance rows, no live escrow, an empty trade shipment set. **No demonstration data was seeded to close any of these** — that was an explicit instruction and it was followed. |

---

## 5. Files

**New:** `backend/services/intelligence/kpiCatalogue.js`,
`backend/services/intelligence/reportService.js`,
`backend/tests/intelligence-reports.test.js`,
`backend/tests/source-hygiene.test.js`,
`web/src/components/intelligence/PeriodicReport.tsx` + test,
`docs/intelligence/manuals/` (README + 5 manuals)

**Modified:** `backend/services/intelligence/financeIntelligenceService.js` (NUL fix),
`backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/intelligence/kpi-catalogue`, `GET /api/marketplace/my-report` with
`?format=csv`), `web/src/hooks/useCarUpApi.ts`,
`web/src/pages/dashboard/owner/OwnerDashboard.tsx`

**Migrations: none in I19.**

---

## 6. Programme position

I0–I19 are implemented. Across the programme the pattern held: read the live schema
first, build only what is measurable, and declare the rest as not-measurable **with
its reason** rather than estimating it or omitting it.

Two security findings were closed in-lane along the way — G1–G3 (moderator-gated)
and **G4**, a live attribution-forgery channel on four ungated referral routes
found while implementing I14's own fraud-safe-attribution requirement.

**Outstanding, for disposition:**

- **Issue #158 — `[P0][security] Remove plaintext private-key persistence from
  `public_keys`** is OPEN and is a **P0**, not a P2. Earlier receipts in this lane
  called it P2; that was my error and is corrected here and in each of them. It
  stays a **separate protected security remediation and a production-release
  gate**, and the key-custody redesign is deliberately NOT folded into this PR:
  the signing ledger holds 23 rows on staging and **716 in production**, so it
  carries its own blast radius and warrants its own reviewed change;
- the marketing surfaces (`TrustSafety.tsx`, `About.tsx`) still carry a "regulated
  trust account" claim that contradicts the non-custodial notice the SafeTrade
  components display, and two different fabricated fraud-detection rates;
- `PartSentry.tsx` writes `'Service performed'` for a missing description on
  submission;
- `VehicleSearch.test.tsx` showed one load-related flake under concurrent test
  files (recorded in the I18 receipt), worth watching in CI.

**Production boundary respected throughout:** source plus governed **staging**
migrations only. No production migration, promotion, integration activation, or
money-moving behaviour was enabled at any point in I0–I19.
