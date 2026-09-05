# I11 — Finance Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I11
**Status:** implementation and tests complete; controlled-count certification carried to I19 (no lender is onboarded)

---

## 1. What the live data actually says

Every figure below was read from staging before any code was written, because
finance is the domain where an invented number reads as money.

| Source | Rows | What it means |
|---|---|---|
| `finance_applications` | 1 | status `Pending`; `decision_source` NULL; `decision_recorded_at` NULL |
| `lender_profiles` | 0 | **no lender is onboarded** |
| `finance_provider_decisions` | 0 | no lender decision has ever been recorded |
| `finance_consents` | 0 | — |
| `eligibility_requests` (`capability='finance'`) | 3 | **all `mode='sandbox'`** |
| `vehicle_telemetry` | 2 | the demo-seed VINs flagged in I0 gap G9 |

Two structural facts follow, and they decide the whole phase:

1. **There is no disbursement state anywhere in the schema.** No table records
   money lent, repaid, in arrears or in default.
2. **There is no finance ↔ collateral binding.** `vehicle_telemetry` carries only
   `id, vin, lat, lng, speed, status, timestamp`. Nothing ties a telemetry row to
   a loan, an application or a financed asset — and the two telemetry VINs have
   **zero** overlap with the finance-application VIN.

So approvals, offers, disbursements, portfolio value, APR, default risk and
collateral tracking are not "currently zero". They are **unobservable**, and the
phase declares them so rather than deriving them.

---

## 2. The fabrications removed

### `BankDashboard.tsx`

| Removed | Was |
|---|---|
| Active Financed Assets | `'$1,245,000'` string literal |
| Pending Applications | `'4'` string literal |
| Average APR (USD) | `'7.5%'` string literal |
| Collateral Default Risk | `'1.2%'` string literal |
| Disbursement chart | `loanTrend` — a static Jan–May array, identical for every viewer |
| "CBZ Bank Partner Portal" | an institutional partnership asserted with no provider evidence |
| AI Credit Scoring Copilot | claimed to be "scanning pre-approvals, comparing current market price dynamics in Harare, and checking the CarUp audit ledger's mileage history for odometer tampering", with `98.4% Passed` |
| Portfolio Risk Tier bars | 84/12/4% for a tiering CarUp does not compute |

**Also found and removed, not in the original brief:** the application queue itself
rendered the CarUp Trust score as a borrower credit verdict —
`app.trust_score > 90 ? 'Low Risk' : 'Medium Risk'`, labelled "Trust Index: N%".
This is the same forbidden conversion as `CreditRiskAnalysis`, one card lower on
the same page. The queue now shows only the application's own status.

**Failed vs empty:** a rejected fetch previously fell through to
"No lending applications pending". It now sets a distinct `loadFailed` state
(`bank-applications-failed`) separate from a genuinely empty queue
(`bank-applications-empty`). The real application queue is preserved.

### `CreditRiskAnalysis.tsx`

Converted Trust directly into credit grades — `A (Super Trust)`, `B (High Trust)`,
`C (Medium Trust)`, `D (Low Trust)` by score threshold. Removed outright: Trust
states confidence in **evidence about a vehicle**; it says nothing about a
**person's** ability to repay, and no model CarUp owns relates the two. A
thinly-documented vehicle would have read as a poor credit risk regardless of the
borrower.

Also removed: a hardcoded grade distribution and portfolio value shown as initial
state *before any fetch* and left standing when a fetch failed; "AI Credit Model
Factors" publishing 35/25/20/20% weights for a model that does not exist; a fixed
0.00% NPL with a "Healthy" badge; a permanently-full escrow coverage bar.

The portfolio value was computed by **summing `requested_amount`** — reporting what
borrowers *asked for* as money the lender *holds*.

### `CollateralMap.tsx`

Injected fabricated vehicles in the two situations a reader can least detect:
**three** invented vehicles with VINs and live-looking positions when telemetry
came back empty, and **two more** when the read *failed*. The
"N Financed Assets Connected" counter counted the fabrications, and "GPS Telemetry
Core Active" / "Ledger Sync: OK" / "No active geofence breaches detected" were
asserted unconditionally for systems that do not exist.

Replaced with a not-configured state naming the four missing prerequisites, because
the binding itself is absent (§1.2) — generic vehicle telemetry can never honestly
be labelled "bank-financed assets".

---

## 3. What was built

`backend/services/intelligence/financeIntelligenceService.js` — commercial demand
only, `finance_demand@1`.

**Measured:** applications received, decisions recorded, awaiting decision,
decision rate (min n=10), live prequalification requests / eligible / not-eligible,
and sandbox requests **in a separate block**.

**Declared not measurable, each with a reason:** approvals, offers, disbursements,
portfolio value, portfolio APR, default risk, collateral binding, source
attribution.

### Three guarantees the code enforces

**A recorded decision, not a status string.** `isAuthoritativelyDecided()` counts an
application as decided only on a `decision_recorded_at` stamp or a
`decision_source`. A bare status of `approved` or even `disbursed` is *not* a
lender outcome — nothing in CarUp sets those on a lender's behalf.

**A requested amount is never money lent.** No payload field carries or sums
`requested_amount`. A test walks the entire returned object and asserts neither
any individual requested amount nor their sum appears anywhere.

**Sandbox is never live demand.** `splitByMode()` treats anything not explicitly
`mode='live'` as sandbox, so an unknown mode can never inflate live demand.

---

## 4. Scope correction — the same class of bug as I6

The first implementation scoped a lender by `tenant_id`. Checking against the
authoritative surface caught this before it shipped:
`GET /api/finance/applications` narrows a bank actor by **`bank_id = req.userContext.id`**,
and on staging **every finance row has a NULL `tenant_id` with a populated `bank_id`**.

A tenant-keyed filter would have reported **"0 applications received"** directly
above a queue listing the lender's own real application. `resolveFinanceScope()`
now mirrors the authoritative key exactly, so the two surfaces cannot disagree.

Two further isolation fixes followed from the same review:

- **Lender roster no longer leaked.** `lender_profiles` was read unfiltered, so
  `active_lenders` would have told each lender how many lenders the platform has —
  competitor information. A lender now counts only its own registrations; platform
  roles count the roster.
- **Eligibility traffic scoped by provider.** Requests belong to the provider they
  were routed to, derived server-side from the lender's own `lender_profiles` rows.

Scope is derived from the verified session in every case. There is **no
caller-supplied scope input** on the route — only `window`, through the shared
resolver.

### The disclosure this forced

With `bank_id` scoping, an application attached to *no* lender is invisible in
every lender view — so a count of zero could mean "no demand" or "demand nobody
can see". Rather than leak it or hide it, an `attribution` block states the gap: a
platform reader gets the unattributed **count**; a lender is told only that the gap
**exists**, since its size is a platform figure. Both reach the UI.

---

## 5. Files

**New:** `backend/services/intelligence/financeIntelligenceService.js`,
`backend/tests/intelligence-finance.test.js`,
`web/src/components/intelligence/FinanceIntelligence.tsx`,
`web/src/components/intelligence/FinanceIntelligence.test.tsx`

**Modified:** `backend/routes/intelligenceProjectionRoutes.js` (route
`GET /api/finance/demand-intelligence`, `authorizeRole(['admin','finance','bank'])`),
`web/src/hooks/useCarUpApi.ts` (`fetchFinanceIntelligence`),
`web/src/lib/intelligenceDisplay.ts`, `web/src/pages/dashboard/bank/BankDashboard.tsx`,
`web/src/pages/dashboard/bank/CreditRiskAnalysis.tsx`,
`web/src/pages/dashboard/bank/CollateralMap.tsx`

`envelopeIsReadable()` gained an optional block name (default `metrics`), so the
single shared unwrapper also serves projections that keep their figures in named
blocks. No second unwrapper was introduced.

**Migrations: none.** I11 adds no schema. The absences it reports are the point.

---

## 6. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4606 tests, 0 fail**, 21 skipped |
| Web suite | **1208 tests, 111 files, 0 fail** |
| I11 backend tests | 23 pass |
| I11 web tests | 12 pass |
| Web typecheck | clean |
| Web build | clean |

Two test-authoring faults were found and fixed rather than worked around: an
over-crude source assertion flagged the word "VIN" inside the very sentence
explaining that telemetry carries no loan reference (narrowed to VIN-*shaped*
literals and coordinate pairs); and one prose explanation restated the `0.00%` it
was removing (reworded — a delinquency-shaped figure should not be printed on a
lender's screen even inside an explanation).

---

## 7. Carried to I19

- **No lender is onboarded** (`lender_profiles` = 0), so live-market behaviour —
  provider decisions, live eligibility routing — cannot be certified against real
  counts. Joins the I9 (0 work-order rows) and I10 (no live insurer) items.
- No demonstration lender, application or disbursement was seeded to close this.

**Production boundary respected:** source and staging only. No production
migration, promotion, integration or money-moving behaviour.

**Next:** I12.
