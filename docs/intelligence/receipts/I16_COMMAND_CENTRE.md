# I16 — CarUp Automotive Intelligence Command Center

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I16
**Status:** implementation and tests complete

---

## 1. Two design decisions

A single admin surface is where a fabrication does the most damage, because it is
the one page read as *"the state of the platform"*. Two rules shape the whole
phase.

**It composes; it does not recompute.** Every vertical already has a governed
projection — dealer (I8), service (I9), insurance (I10), finance (I11), parts
(I12), trade (I13), referral (I14), institutional (I15). The command centre
**links** to each rather than restating its figures under new names, because two
surfaces quoting the same domain from different code is precisely how they start
disagreeing. A test asserts no vertical's own section appears in the centre.

**Every section declares its source, or declares that it has none.** Each
available section names the tables it was read from. Four things have no source at
all and say so rather than being quietly omitted — an omitted section reads as an
oversight, a declared one reads as a fact somebody may need to act on:

| Declared sourceless | Reason |
|---|---|
| Revenue | no completed payment exists anywhere: subscriptions empty, no disbursement, no confirmed trade milestone, every escrow sandbox |
| Customer health | CarUp holds no churn, retention or satisfaction model — and an invented health score on this page would drive real decisions about real accounts |
| Platform health | no uptime, latency or error-rate measurement is collected |
| Fraud interception rate | CarUp computes none |

**Trust is deliberately not aggregated.** Only the canonical trust authority may
state a Trust position, and a distribution assembled here from vehicle columns
would be a second, unversioned trust source (Issue #164). The centre reports how
much *evidence* has been reviewed and names the canonical service for the rest; a
test forbids any `trust_distribution`, `average_trust` or `trust_band` field.

**Three states stay distinct**, which the surface renders differently in each
case: a real figure, a section that could not be **read** (marked unreadable,
"figures are NOT zero", and the rest of the page still answers), and a section
with no **source**.

The activity ledger is a case in point. `marketplace_activity_events` holds **zero
rows** on staging — the ledger is instrumented but nothing has been recorded yet.
"Instrumented, nothing recorded" and "nobody is interested" are completely
different statements, so the behavioural count renders as a qualifier rather than
a zero, with the reason beside it.

---

## 2. Fabrications removed

### `backend/routes/adminRoutes.js` — at the source

The admin stats API itself returned two string literals:

```js
systemHealth: 'Optimal',
aiConfidence: '98.5%'
```

CarUp measures neither. The second was rendered to an administrator as **"Fraud
Intercept Rate 98.5%"** — a measured-looking rate for something no code computes.
Both are removed from the response.

### `web/src/pages/dashboard/admin/AdminDashboard.tsx`

An earlier pass had already removed the fabricated organization and fraud tables
(which listed real companies as Active CarUp partners with invented Trust Index
percentages, and fabricated VIN-cloning interceptions). What it left behind:

| Removed | Was |
|---|---|
| Seeded `stats` | 9,200 users / 5 vehicles / 1 escrow / "Optimal" / "98.5%" used as the fallback for **every** field via `data.x \|\| prev.x` — so a genuine **zero** from the server was replaced by the invented seed, and a failed fetch left the invented numbers on screen with no indication |
| SafePay Escrow Volume | rendered the literal `'$145,000'` whenever the real count was zero, and otherwise switched units to "N Locks" — never comparable with itself |
| Four period deltas | `'+18%'`, `'+20%'`, `'+32%'`, `'+0.4%'`, colour-coded green by whether the literal began with `+` |
| User growth chart | a fixed five-month array |
| "Active AI Copilots" | **"Simbisa Diagnostics AI"** and **"Old Mutual Underwriter Copilot"** shown as **Online**, asserting running integrations with two real named companies |

---

## 3. Files

**New:** `backend/services/intelligence/commandCentreService.js`,
`backend/tests/intelligence-command-centre.test.js`,
`web/src/components/intelligence/CommandCentre.tsx`,
`web/src/components/intelligence/CommandCentre.test.tsx`

**Modified:** `backend/routes/adminRoutes.js`,
`backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/admin/intelligence/command-centre`, `['admin']` — an institutional role
is not a platform administrator, which is the G5 boundary),
`web/src/hooks/useCarUpApi.ts`,
`web/src/pages/dashboard/admin/AdminDashboard.tsx`

**Migrations: none.**

---

## 4. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4706 tests, 0 fail**, 21 skipped |
| Web suite | **1269 tests, 118 files, 0 fail** |
| I16 backend tests | 15 pass |
| I16 web tests | 9 pass |
| Web typecheck / build | clean |

---

## 5. Coverage against the plan's section list

| Plan section | Disposition |
|---|---|
| Overview, Supply, Demand, Trust/Evidence, Communications, Transactions, Risk | served, each naming its source |
| Stakeholder verticals, Marketing | **linked** to their own governed projections (I8–I15), not restated |
| Quality | served through the evidence-review position; per-listing completeness remains I6's `completeness@LC1` |
| Revenue, Customer Health, Platform | **declared sourceless**, with the specific reason |

---

## 6. Carried to I19

The behavioural ledger holds no rows on staging, so the Demand section's
behavioural half cannot be certified against real counts. Joins I9, I10, I11, I12,
I13, I14 and I15.

**Production boundary respected:** source and staging only.

**Next:** I17 — Proactive Next-Best-Action.
