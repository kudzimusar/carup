# Trade OS T12 — Customs & Zimbabwe destination operations · Implementation plan

**Status: T12.0 audit COMPLETE. T12.1 (remove the fabricated customs values) COMPLETE.
T12.2 onward NOT STARTED — and one part of it is BLOCKED on an owner decision.**

Predecessor: `docs/trade-os/receipts/T11_SHIPMENT_TRACKING.md` — **`T11-USABLE`, OWNER ACCEPTED / FROZEN at `9ce19115`.**

---

## 0. The one sentence this phase exists to protect

> **CarUp may coordinate customs. CarUp is not ZIMRA.**

Every design decision below follows from it. The provider may record what it did, what it was told,
what a document appeared to say, and who said it. It may never state, on its own authority, what the
Zimbabwe Revenue Authority assessed, decided, or was paid.

---

## 1. T12.0 — the audit

### What already exists

| # | where | what it is | who owns it |
|---|---|---|---|
| 1 | `zimra_declarations` | a table modelling **a ZIMRA declaration** — customs ref, duty calculated, duty paid, exchange rate, stamp date, officer signature hash | ZIMRA (in reality). CarUp merely stored it. |
| 2 | `cvr_ownership_records` | a table modelling **a CVR registration record** | the Central Vehicle Registry |
| 3 | `cid_clearance_records`, `vid_inspections`, `zinara_licensing_records` | the same shape for three more authorities | those authorities |
| 4 | `ocr_documents`, `ocr_customs_declarations`, `ocr_registration_books` | **what CarUp actually observed** — a document, and what OCR read off it, with a confidence | **CarUp** |
| 5 | `vehicleFactResolver` | already refuses `CUS_`/`REG_`/`LB_` rows via `NON_SUBSTANTIATING_MODES` | CarUp |
| 6 | `trustGraphService` | scored the same tables — **and did not apply that test** (closed in T12.1) | CarUp |
| 7 | `diaspora_import_orders.status` ladder | `ARRIVED_AT_BORDER → CUSTOMS_IN_PROGRESS → DUTY_PENDING → DUTY_PAID → RELEASED` | T12 |
| 8 | `SHIPMENT_TO_IMPORT_STATUS` | wrote three of those from a **movement** action — closed in T11 | T11 → T12 |
| 9 | `ZIMRA_ADAPTER`, `ZIMRA_API_KEY` | adapter scaffolding | unproven; see §4 |

### The finding

**The audit's first result is not a gap. It is a forgery** — documented in full in the T11 receipt §8
and closed in T12.1. In summary: approving an OCR document minted a ZIMRA declaration with a random
reference, a defaulted duty of 50 000, a hardcoded exchange rate of 13.5, today's date as the customs
stamp date, and an "officer signature" that was a SHA-256 of CarUp's own document id.

### The shape of the problem, stated once

> **A document is not a declaration. A declaration is not an assessment. An assessment is not a
> payment. A payment is not a release. And a hold is not a decision.**

Five distinct facts that the codebase collapsed into one row.

---

## 2. T12.1 — remove the fabricated values · **DONE**

- The registry write is **removed** from `documentIntelligenceService`, not disabled.
- `trustGraphService` now asks the same question `vehicleFactResolver` asks, through one exported
  `isGenuineRegistryRecord`.
- `backend/tests/trade-os-t12-registry-authority.test.js` — 8 tests, with positive controls proving a
  *real* registry row still substantiates, and that what CarUp genuinely observed is still recorded.
- Staging blast radius: **0 rows**. Production: **UNMEASURED, out of scope, owner decision pending.**

---

## 3. T12.2 onward — the truth model to be built

Nothing below is implemented. This is the design the phase should be built to.

### The facts, kept separate

| fact | what establishes it | who may assert it |
|---|---|---|
| a document exists and says X | an upload + OCR + a reader | **CarUp** — already built (T8, OCR) |
| a declaration was **lodged** | a clearing agent or ZIMRA acknowledgement | the agent; CarUp records who told it |
| an assessment was **issued** | ZIMRA | ZIMRA only |
| duty was **paid** | a payment against that assessment | the payer's bank / ZIMRA receipt |
| goods were **released** | ZIMRA | ZIMRA only |
| goods are **held** | an observation of where they are | **CarUp** — already T11's `CUSTOMS_HOLD` |
| goods were **delivered** in Zimbabwe | a receipt signed by the receiver | **CarUp** |

The last two are the only ones CarUp may originate. Everything in between is **attributed**: CarUp
records *who* asserted it, *when*, *on the strength of what evidence*, and *with what confidence* —
never the bare fact.

### The firewalls

1. **No CarUp code path writes a government registry table.** Enforced by test (T12.1) and to be
   extended to any new code.
2. **An attributed claim can never be presented as an authority's act.** A projection carrying
   "the agent says duty was paid" must not render as "duty paid".
3. **Unknown is never zero.** An unassessed duty is *unassessed*, never `0`.
4. **A hold is not a decision.** Already held by T11 and asserted at 7 viewport widths.
5. **Self-clearing is impossible.** The customer cannot move their own goods to cleared; the provider
   cannot mint ZIMRA authority. Server-derived authority only, with positive controls in the matrix.

---

## 4. BLOCKED — owner decision required

The directive is explicit: *do not hardcode duty percentages, VAT percentages, surtax, age rules,
exchange rates, valuation formulae, vehicle import bans, rebates, broker fees or port charges* unless
an authoritative source establishes jurisdiction, effective date, applicability and provenance.

**No such source exists in this repository.** The only numbers that were ever present were the
fabricated `13.5` and `50000` removed in T12.1.

Therefore **the entire duty-and-tax calculation boundary is `BLOCKED`**, and is deliberately left
unwritten rather than approximated. Specifically unresolved:

| # | question | why it cannot be answered here |
|---|---|---|
| 1 | the applicable duty rate(s) by vehicle class and age | a legal instrument with an effective date; none is in the repo |
| 2 | VAT and surtax treatment | same |
| 3 | the valuation basis (invoice, VDP, or other) | a ZIMRA methodology, not a modelling choice |
| 4 | the exchange rate **source** and the date it is fixed at | a rate with no source and no date is a fabrication; `13.5` was exactly that |
| 5 | age-based import restrictions or bans | policy, with an effective date |
| 6 | rebate and exemption eligibility | policy |
| 7 | broker fees and port charges | commercial, and per-provider — arguably T6, not T12 |
| 8 | whether CarUp lodges declarations itself or only coordinates a licensed clearing agent | **an operating-model and licensing question, not a code question** |
| 9 | whether the `ZIMRA_ADAPTER` scaffolding points at a real ZIMRA interface, a sandbox, or nothing | unproven; must be established before any integration is claimed |

**Recommendation, not a decision:** build T12 as an **attributed-evidence and coordination** phase —
lodgement tracking, agent attribution, document binding, hold and release *observation*, and Zimbabwe
delivery confirmation — and leave assessment and calculation entirely to the authority, integrating
only once #8 and #9 are answered by the owner. That produces a genuinely useful product with no
invented law in it.

---

## 5. Also open

- **Production blast radius of the registry forgery — UNMEASURED.** Owner decision on a read-only
  count (T11 receipt §10).
- `zinara_licensing_records`, `cid_clearance_records` and `vid_inspections` were audited but not
  touched. They carry the same shape and should be reviewed for the same class of write before any
  T12 surface reads them.
- **T13 NOT started**, per directive.
