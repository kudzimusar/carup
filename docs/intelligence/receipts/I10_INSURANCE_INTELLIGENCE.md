# I10 — Insurance Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Status:** complete. The commercial and risk domains are separated, and the fabricated risk surface is neutralized.

---

## The boundary, enforced in both directions

| Domain | Where | What it may say |
|---|---|---|
| **Commercial / demand** | `GET /api/insurance/demand-intelligence` | product exposure, eligibility (quote-start) activity, conversion **where actually observed** |
| **Risk / underwriting / claims / fraud** | `/insurance-dash/risk`, `/claims`, `/fraud` | a separate governed domain — never merged into a demand figure |

The commercial projection carries a `domain_boundary` statement in its own payload, and a test asserts that **no field** in `live_demand`, `sandbox_activity` or `provider_state` is named for risk, premium, underwriting, claims, fraud or score — and that no risk block exists at all. The assertion is on the data rather than on prose, because the boundary note legitimately *names* the domains it excludes.

---

## What the live schema actually supports

Established before writing anything:

- `eligibility_requests` with `capability = 'insurance'`: **3 rows, every one `mode = 'sandbox'`** against provider `insurance_sandbox`, all `not_eligible`.
- `insurer_profiles`: **0** — no insurer onboarded.
- `insurance_provider_decisions`: **0** — no provider decision has ever been recorded.
- `insurance_consents`: **0**.

So the honest commercial picture is: CarUp has observed simulated eligibility activity and **no live market at all**.

### Sandbox is never demand

Live and sandbox activity are split and **never summed**. A simulated request is a genuine record of a simulation, not a genuine record of demand; adding them would describe an empty market as an active one. `provider_state` says so first — `live_market: false` with "No insurer is onboarded, so no request can reach a live provider and no policy can be bound through CarUp" — so a surface describes an empty market rather than rendering it as poor performance.

### Declared unmeasurable, with reasons

Product views, quote submissions, offers, policies bound, renewals, and source attribution. Each names why. **Policies bound** is the one worth stating: CarUp *holds* policy records, but holds no evidence of a policy being bound *through* CarUp, so counting them as conversions would be inference presented as observation.

---

## The risk surface, neutralized

`/insurance-dash/risk` was the most misleading surface in the I0 audit. Every element asserted something CarUp cannot support: a static category-risk chart; a hardcoded initial risk index, premium and three "Positive" mitigating factors (including specific claims about odometer validation and cleared import duty) shown before any calculation ran and left standing when one failed; a premium presented as underwritten with a fixed Trust-derived discount line; a table publishing the discount rules of a Trust pricing engine that does not exist; and a subtitle claiming the calculation drew on live ledger Trust positions.

**That last claim was the serious one.** The calculator called `runRiskScoring`, which sends a VIN, a mileage number and a price to a language model and returns whatever JSON it replies with — it reads no ledger, no claims history and no Trust position, and the VIN is passed as text and never looked up. Its output was displayed as underwriting, wrapped in Trust branding.

**The calculator is removed rather than relabelled.** An insurer-facing premium figure invites exactly the reliance it cannot bear, and CarUp has no underwriting model, no onboarded insurer and no provider decision to ground one. Relabelling would have left the same number on the same screen for the same audience.

**Trust is not an underwriting shortcut.** A Trust position states confidence in governed evidence about a vehicle; converting it into a discount percentage is a pricing judgement CarUp has neither the mandate nor the data to make. The page says that, rather than silently dropping the discount table.

---

## Evidence

- **21 insurance tests**: domain separation asserted on fields not prose; sandbox/live split; empty-market description; live-market figures; withheld rate on thin data; tenant scoping with refusal for a tenant-less insurer; platform-admin view; non-insurer refusal; unmeasurables declared; unavailable-not-zero on a failed read; plus source assertions that **each removed fabrication cannot return** — the static chart, the hardcoded score/premium/factors, the live-ledger and Trust-basis claims, the Trust discount table, and the LLM calculator.
- Backend **4,583 tests / 0 failures**; web **110 files / 1,196 tests / 0 failures**; typecheck clean; build succeeds.

## Carried forward

Insurance demand cannot be certified against controlled counts until a live insurer exists — the same class of limitation as I9's empty work-order table, and carried to I19 rather than closed with seeded data.

**I10 is complete. Next: I11 (Finance Intelligence).**
