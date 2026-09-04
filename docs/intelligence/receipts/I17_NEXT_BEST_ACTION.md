# I17 — Proactive Next-Best-Action

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I17
**Status:** implementation and tests complete; staging migration applied

---

## 1. The rule that matters most is the one about not firing

Deterministic rules only — no model, no learned weights, no ranking heuristic.
Given the same inputs every rule returns the same output, which is the plan's
requirement and also what makes a recommendation defensible: a seller who asks
"why am I being told this?" gets the rule, the threshold it crossed, and the
evidence that crossed it.

But the property this phase actually turns on is the **refusal to fire**.

Every metric in this programme carries an availability envelope, and a rule that
read `insufficient_data` as a number would be the worst possible consumer of it.
*"Your listing has had no views — improve your photos"* is a damaging thing to tell
somebody when the truth is that views were never recorded. And this is live, not
hypothetical: `marketplace_activity_events` holds **zero rows** on staging, so the
view-based rule has no input at all.

So `isUsable()` is checked before any threshold comparison. A rule whose inputs
are not all present **abstains and reports why**, and the abstention is part of the
output rather than an absence from it. A test drives the exact live case: the empty
ledger cannot produce a "no interest" recommendation.

A recorded **zero** is still a measurement and is still usable. Only
`insufficient_data`, `unavailable` and a null value cause abstention.

---

## 2. The rules

Each declares its inputs, threshold, explanation, action and cooldown — the plan's
full contract, asserted for every rule in the registry by a test.

| Rule | Subject | Fires when | Cooldown |
|---|---|---|---|
| `listing_incomplete_blocks_discovery` | listing | completeness below 60% | 14 days |
| `unanswered_leads` | seller | ≥1 lead unanswered, oldest ≥3 days | 3 days |
| `traffic_without_conversion` | listing | ≥50 views and no enquiry | 14 days |
| `demand_exceeds_supply` | tenant | ≥5 enquiries per published listing | 7 days |
| `campaign_without_uptake` | platform | ≥5 active codes, none used | 14 days |

**A lead counts as unanswered only while it is still in its arrival state.**
Anything an operator has already touched is not waiting on the seller, and nagging
about it would train them to ignore the advice entirely.

**The campaign rule speaks about uptake, never return.** I14 established that CarUp
records no campaign cost, so "underperforming" here can only mean *unused*, never
*unprofitable*. A test forbids the words roi, return, cost, spend, profit or wasted
appearing in that rule's label, explanation or action.

---

## 3. Suppression is a mechanism, not a claim

Migration `20260828120000_intelligence_recommendations.sql` adds
`intelligence_recommendation_state`, applied to **staging only**.

**It stores the interaction, never the advice.** The recommendations themselves are
pure functions of authoritative data and are recomputed every time; storing the
rendered text would create a second, staler copy of a number whose authority lives
elsewhere — the mistake `vehicle_listing_summaries` was dropped for. A test asserts
no column holds an explanation, message, body or payload.

**The evidence fingerprint makes suppression fair in both directions.** A hash of
(rule, subject, triggering evidence) means unchanged evidence stays suppressed —
but a listing that gets *worse* can speak again rather than staying silent because
a milder version of the same advice was dismissed once.

Four suppression states are honoured: cooldown window, viewer dismissal, viewer
snooze (until it expires), and below-threshold.

**RLS**, verified live on staging: enabled ✓, forced ✓, **zero policies**,
anon `SELECT` false, authenticated `SELECT` false, service_role `SELECT` true —
the same idiom as every other Intelligence table.

---

## 4. The surface keeps three outcomes distinct

Collapsing them is how advice loses its credibility:

- **nothing needs doing** — "Nothing needs your attention right now."
- **a rule is deliberately quiet** — recently shown, dismissed or below threshold;
  not surfaced as a problem.
- **a rule could not run** — the clean message is qualified to "*from the checks
  that could run*", and a separate block names each check and what it was missing.

That third case is the difference between *"your listing is doing fine"* and
*"CarUp does not know how your listing is doing"*. A failed read likewise says it
is "not a finding that there is nothing to do".

---

## 5. Files

**New:** `database/migrations/20260828120000_intelligence_recommendations.sql`,
`backend/services/intelligence/recommendationService.js`,
`backend/tests/intelligence-recommendations.test.js`,
`web/src/components/intelligence/NextBestActions.tsx`,
`web/src/components/intelligence/NextBestActions.test.tsx`

**Modified:** `backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/marketplace/my-recommendations` — the subject **is** the session, so a
seller cannot request advice about somebody else's listings; and
`GET /api/admin/intelligence/recommendations`, admin-only),
`web/src/hooks/useCarUpApi.ts`, `web/src/pages/dashboard/owner/OwnerDashboard.tsx`

`NextBestActions` is **mounted** on the owner dashboard, whose existing 92 tests
remain green.

---

## 6. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4727 tests, 0 fail**, 21 skipped |
| Web suite | **1277 tests, 119 files, 0 fail** |
| I17 backend tests | 21 pass |
| I17 web tests | 8 pass |
| Migration up/down/re-up (isolated Postgres) | **PASS** |
| Staging RLS verification | enabled, forced, 0 policies, anon/authenticated revoked |
| Web typecheck / build | clean |

---

## 7. Carried to I19

The two ledger-dependent rules (`traffic_without_conversion`,
`listing_incomplete_blocks_discovery`'s view context) cannot be exercised against
real counts while the activity ledger is empty. They are proven to **abstain**
correctly, which is the safe behaviour, but a positive firing path awaits recorded
events. Joins the carried items from I9–I16.

**Production boundary respected:** the migration was applied to **staging only**.
No production migration, promotion or activation.

**Next:** I18 — Gutu AI Intelligence.
