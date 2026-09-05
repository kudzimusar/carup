# I18 — Gutu AI Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I18
**Status:** implementation and tests complete

---

## 1. The finding: Gutu AI was not an AI

The Gutu surface matched keywords against a fixed lookup table and returned
prepared strings after a 1.2-second delay that simulated thinking. What those
strings asserted was not generic marketing copy — it was **specific facts about
the reader's own property**:

| Question | What it answered |
|---|---|
| "What is my vehicle worth?" | *"your Toyota Corolla Quest (2019) with 67,800km in Harare, the estimated market value is **$11,800**. This represents a **3.2% decrease** from last month… Similar vehicles are selling between $10,600 and $13,000."* |
| "When is my next service due?" | *"due for service in approximately **500km or 30 days**… Based on your last service (**April 2026 at 67,000km**)"* |
| "Check insurance expiry" | *"Your **NicozDiamond** comprehensive policy (**NDI-MOT-2026-45678**) expires on **December 31, 2026**… Your premium of **$680/year** is competitive."* |
| "Find mechanics near me" | three named garages with star ratings and distances — *"AutoTech Pro Garage (4.9★) - 2.3km away"* |
| anything about fraud | *"Current fraud detection rate: **98.7%**"* |

None of it came from anywhere. This is the most dangerous fabrication class the
programme has found: a conversational register invites exactly the trust it cannot
bear, and a reader had no way to distinguish an invented policy number from a real
one.

---

## 2. The rule, and why it is structural

The programme's constraint is: **Gutu AI may explain, but not invent numbers,
authority or access.**

That is a constraint on the **context**, not on the prompt. A model told to "only
use the provided data" will still fill a gap when the gap is exactly where an
answer should be. So the enforcement is structural:

**The context is a closed set of facts**, each carrying its value, availability and
source. Scope is the session — there is no subject parameter, so an assistant
cannot be pointed at another user's vehicles, leads or organization.

**An unmeasured fact is present in the context AS unmeasured**, with its reason.
This is the load-bearing design decision: an absent key invites invention, a key
that says "CarUp holds no policy record for you; a policy number, premium or expiry
date would be invented" does not. Every question the old surface answered falsely
is now an explicit unavailable fact.

**The answer is checked afterwards.** `validateAnswer()` rejects any currency
amount or percentage that does not appear in the facts the answer was given, and
rejects a value asserted against a fact the context declared unavailable.

---

## 3. The four tests the plan names

| Requirement | How it is enforced |
|---|---|
| **cannot invent** | closed fact set + post-hoc figure validation; every previously-fabricated answer is now a declared unavailable fact |
| **cannot cross tenant/user scope** | context built from the session only; an unauthenticated caller gets no context; a test proves another user's vehicles and enquiries are excluded |
| **cannot override Trust** | `validateTrustStatement()` rejects publishing a score for `not_evaluated`, `stale` or `unavailable`, and rejects softening those into "high trust", "no issues found" or "fully verified". `not_evaluated` can never become 0 or "failed" |
| **cannot promote unknown government state to verified** | `validateAuthorityStatement()` rejects "government verified", "registry confirmed", "officially verified", "ZIMRA verified" and similar while no registry has confirmed anything — which, per I15, is the current state. The same phrasing is permitted once a registry genuinely confirms |

A combined guard catches all three failure modes in one sentence, and a test proves
it on *"Your vehicle is worth $11,800, has a high trust rating, and is government
verified."*

---

## 4. The surface

Gutu now shows what CarUp actually holds about the reader — and, **as prominently**,
what it does not hold, with the reason for each. A question that cannot be answered
is visibly unanswerable rather than answered with an invention.

A failed read says the records could not be read and that this "is not a report
that you have none".

**No LLM was wired to this surface**, and none is simulated. The deliverable is the
governed context and its guardrails, which is what any assistant would have to be
given before it could safely answer at all.

---

## 5. Files

**New:** `backend/services/intelligence/aiIntelligenceContextService.js`,
`backend/tests/intelligence-ai-context.test.js`,
`web/src/pages/dashboard/owner/AIDashboard.test.tsx` (first coverage for that page)

**Modified:** `backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/intelligence/assistant-context` — no subject parameter),
`web/src/hooks/useCarUpApi.ts`,
`web/src/pages/dashboard/owner/AIDashboard.tsx`

**Migrations: none.**

---

## 6. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4746 tests, 0 fail**, 21 skipped |
| Web suite | **1285 tests, 120 files, 0 fail** |
| I18 backend tests | 19 pass |
| I18 web tests | 8 pass |
| Web typecheck / build | clean |

**One flake, recorded rather than hidden.** The first full web run showed
`VehicleSearch.test.tsx > renders a history-only card…` failing at 2596 ms. It
passes in isolation (11/11) and passes on a full re-run (1285/1285), and
`VehicleSearch.tsx` was last modified in an unrelated commit (`ba208963`) — nothing
in this phase touches it. It is a load-related timeout under concurrent test files,
not a regression, but it is a latent flake worth watching in CI.

---

## 7. Noted for later phases

The fabricated fraud-detection rate removed here (`98.7%`) is the same figure the
I13 sweep found on `About.tsx`, alongside a different fabricated value (`99.8%`) for
the same claimed metric on `TrustSafety.tsx`. Those marketing surfaces remain
outstanding, together with `TrustSafety`'s "regulated trust account" claim, which
contradicts the non-custodial notice the SafeTrade components carry.

**Production boundary respected:** source only. No migration, no promotion, no new
integration activated.

**Next:** I19 — Reports, certification and stakeholder manualization.
