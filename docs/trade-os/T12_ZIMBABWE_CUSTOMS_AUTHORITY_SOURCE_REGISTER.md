# Trade OS T12 — Zimbabwe customs authority · Source register

**This document is NOT executable law, and it is NOT a tax calculator.**

It records *where authority lives* so that any figure CarUp ever displays can name its source. Nothing
in here is wired into runtime. No rate, threshold, formula or restriction from this register has been
converted into code, and **a worked example published for explanatory purposes must never become a
runtime rate** — that is precisely how the fabricated `13.5` and `50000` got into the product in the
first place.

Seeded 2026-09-08. Retrieved dates are when the reference was last checked from this repository;
they are **not** confirmation that the instrument is still in force.

---

## How to read the `status` column

| status | meaning |
|---|---|
| `CURRENT_CONFIRMED` | the authority publishes this as its standing position, and it was seen at the retrieved date |
| `SUPERSEDED` | replaced by a later instrument, kept because older records were made under it |
| `HISTORICAL` | context only |
| `NEEDS_LEGAL_CONFIRMATION` | **the substance is real but the current instrument, effective date, or exceptions were not established from a primary source.** Nothing under this status may drive a product decision. |

> **No entry in this register is `CURRENT_CONFIRMED` for a *rate*.** Confirming that a specific
> percentage is in force on a specific date is a legal determination, not a retrieval, and CarUp has
> not made it.

---

## 1. Primary legislation

| field | value |
|---|---|
| authority | Zimbabwe Revenue Authority / Government of Zimbabwe |
| title | **Customs and Excise Act [Chapter 23:02]** |
| reference | https://www.zimra.co.zw/downloads/category/17-acts |
| jurisdiction | Zimbabwe |
| publication / effective | consolidated Act, amended by successive statutory instruments |
| retrieved | 2026-09-08 |
| subject | customs duty, excise duty, valuation, clearing agents, entry and clearance |
| status | `CURRENT_CONFIRMED` (as the governing Act) |
| **CarUp may derive** | that customs duty on imports is levied under this Act; that **valuation is governed by Part X**; that a licensed clearing agent is a defined role under it |
| **CarUp must NOT derive** | any rate, any liability, any assessment, any exemption, or that a particular consignment is or is not dutiable |

## 2. Tariff

| field | value |
|---|---|
| authority | ZIMRA |
| title | **Tariff Handbook** — issued as *Statutory Instrument 203 of 2022, Customs and Excise (Tariff) Notice, 2022* |
| reference | https://www.zimra.co.zw/customs/classification-of-goods/tariff-handbook · SI text mirrored at https://www.veritaszim.net/node/6029 |
| jurisdiction | Zimbabwe |
| publication | 2022; replaced the 2017 handbook |
| retrieved | 2026-09-08 |
| subject | tariff classification and the duty applicable to each heading |
| status | `NEEDS_LEGAL_CONFIRMATION` — SI 203/2022 is the handbook, but it is **amended by later tariff notices** (e.g. SI 121 of 2022, SI 139 of 2024 were both seen in the ZIMRA index). Which amendments are in force today has not been established here. |
| **CarUp may derive** | that classification determines the applicable duty; that classification is a **declared and assessed** matter, not a computed one |
| **CarUp must NOT derive** | a duty percentage for any commodity code, in any product surface, ever |

## 3. Customs valuation

| field | value |
|---|---|
| authority | ZIMRA |
| title | Valuation of imported goods · **Part X, Customs and Excise Act**; ZIMRA guidance on private motor-vehicle importation |
| reference | https://www.zimra.co.zw/customs/importation-of-motor-vehicles-by-private-individuals |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | Value for Duty Purposes (**VDP**) |
| status | `CURRENT_CONFIRMED` (as the stated methodology) |
| **CarUp may derive** | that the basis is **CIF plus other incidental charges**, called VDP; and — importantly — that **ZIMRA reserves the right to reject a declared value** that does not reflect bona-fide open market value |
| **CarUp must NOT derive** | a VDP for any consignment. CarUp computing a VDP would be CarUp performing the valuation, and the authority explicitly reserves the right to reject the declarant's own figure |

## 4. Customs exchange rate

| field | value |
|---|---|
| authority | ZIMRA |
| title | **Rates of exchange for customs purposes** — published weekly, for a stated period |
| reference | https://www.zimra.co.zw/downloads/category/10-exchange-rates |
| jurisdiction | Zimbabwe |
| publication | weekly, each with its own effective period |
| retrieved | 2026-09-08 |
| subject | the FX rate applied in customs valuation |
| status | `CURRENT_CONFIRMED` (that such a rate exists, is published by ZIMRA, and is **period-scoped**) |
| **CarUp may derive** | that a customs exchange rate is **an act of the authority with an effective period**, and that it must therefore be recorded with its source and that period |
| **CarUp must NOT derive** | the rate itself, and must **never** substitute a market or reference rate for it |

> **This is the single most important entry in the register.** The customs rate is a *weekly published
> instrument with an effective period*. The removed forgery hardcoded `13.5` with no date and no
> source. T6's ECB reference FX is a different thing for a different purpose and **must never be
> substituted into customs valuation** — see the T12 plan §H.

## 5. Clearance procedure and the declaration

| field | value |
|---|---|
| authority | ZIMRA |
| title | Customs Clearance Procedures · Bill of Entry (**Form 21**) · Customs Declaration (**Form 47**, private importations) |
| reference | https://www.zimra.co.zw/customs/customs-clearance-procedures · https://www.zimra.co.zw/customs/forms |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | how goods are entered and cleared |
| status | `CURRENT_CONFIRMED` |
| **CarUp may derive** | the *names and existence* of the artefacts a clearing agent produces, so evidence can be labelled accurately |
| **CarUp must NOT derive** | that a declaration has been lodged, accepted or cleared. **Holding a document called "Form 21" is not a lodgement.** |

## 6. ASYCUDA World

| field | value |
|---|---|
| authority | ZIMRA (UNCTAD system) |
| title | **ASYCUDA World** — the electronic system through which entries are lodged |
| reference | https://www.zimra.co.zw/customs/customs-clearance-procedures |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | electronic lodgement of the Bill of Entry with scanned attachments |
| status | `CURRENT_CONFIRMED` (as the lodgement channel) |
| **CarUp may derive** | that lodgement happens in ASYCUDA, **by a licensed agent or registered company** — therefore not by CarUp |
| **CarUp must NOT derive** | any ASYCUDA state, reference or acknowledgement. **CarUp has no ASYCUDA connection.** `ZIMRA_ADAPTER` / `ZIMRA_API_KEY` are unverified scaffolding and are not enabled |

## 7. Clearing-agent licensing

| field | value |
|---|---|
| authority | ZIMRA |
| title | Licensing of a Clearing Agent · **Form 64**, application to be licensed |
| reference | https://www.zimra.co.zw/news/2226:licencing-of-a-clearing-agent · https://www.zimra.co.zw/customs/forms |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | who may act for an importer in customs matters |
| status | `CURRENT_CONFIRMED` |
| **CarUp may derive** | that a clearing agent is **a company or partnership licensed by ZIMRA**; that the licence **expires on 31 December of the year of issue**; and that lodging employees require formal training and experience. This is why T12 models an *appointment of* an agent rather than CarUp acting as one. |
| **CarUp must NOT derive** | that any particular organisation holds a current licence. **CarUp cannot verify a licence.** An appointment records who the participant says they appointed, not that the appointee is licensed |

## 8. Vehicle import age restriction

| field | value |
|---|---|
| authority | ZIMRA; Control of Goods (Import and Export) (Commerce) Regulations [CAP. 14:05] |
| title | Importation of motor vehicles aged 10 years and above from date of manufacture |
| reference | https://www.zimra.co.zw/customs/importation-of-motor-vehicles-by-private-individuals · Public Notice 84 of 2024 · SI 2021-089 · **SI 59 of 2026** (Control of Goods (Import and Export) (Commerce) (Amendment) Regulations, 2026) |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | age-based restriction on importing second-hand vehicles |
| status | **`NEEDS_LEGAL_CONFIRMATION`** |
| **CarUp may derive** | that an age-based restriction **exists** and is a real consideration a buyer must be told to check |
| **CarUp must NOT derive** | that any specific vehicle may or may not be imported |

> **Why this is not `CURRENT_CONFIRMED`, and why §N forbids an automatic rejection engine.** The
> substance is real — ZIMRA's own page states vehicles ten years and older from date of manufacture
> shall not be imported. But the history visible from the primary index is a *moving* one:
> transitional arrangements were extended (to 30 June 2021), a further public notice issued in 2024,
> and the Control of Goods regulations were amended again by SI 59 of 2026. Which instrument governs
> today, what the exceptions are (immigrant's rebate, returning resident, physically handicapped
> persons' suspension, commercial vs private), and how "date of manufacture" is evidenced, were **not
> established from a primary source here.**
>
> **A policy check is not a customs decision.** CarUp must not declare a vehicle un-importable.

## 9. Rebates, suspensions and exemptions

| field | value |
|---|---|
| authority | ZIMRA |
| title | Suspension of duty on motor-vehicle imports by physically handicapped persons; rebates generally |
| reference | https://www.zimra.co.zw/customs/calculation-of-duty-on-importation-of-private-motor-vehicles-and-suspension-of-duty-on-motor-vehicle-imports-by-the-physically-handicapped-persons |
| jurisdiction | Zimbabwe |
| retrieved | 2026-09-08 |
| subject | reduced or suspended duty in defined circumstances |
| status | `NEEDS_LEGAL_CONFIRMATION` |
| **CarUp may derive** | that rebates and suspensions exist and are **applied for and granted**, not computed |
| **CarUp must NOT derive** | eligibility for anyone |

## 10. Explanatory worked examples

| field | value |
|---|---|
| authority | ZIMRA |
| title | *Calculation of duty on importation of private motor vehicles* |
| reference | https://www.zimra.co.zw/13-tax/customs/287-calculation-of-duty-on-importation-of-private-motor-vehicles |
| status | **`NEEDS_LEGAL_CONFIRMATION` — and deliberately NOT transcribed here** |
| **CarUp may derive** | that ZIMRA publishes explanatory material, which a coordinator may link a customer to |
| **CarUp must NOT derive** | **anything at all that reaches runtime.** A published worked example illustrates a method on chosen inputs at a moment in time. Copying its figures into code produces exactly the class of defect T12.1 removed: a number in the product that looks authoritative and is answerable to nobody |

---

## What this register does NOT contain, on purpose

- No duty percentage.
- No VAT or surtax rate.
- No exchange rate.
- No valuation formula.
- No age threshold expressed as a comparable value.
- No rebate amount, broker fee or port charge.

Every one of those is either a legal determination or a commercial fact belonging to another
authority (broker fees and port charges remain **T6** commercial-charge authority; T12 may reference
their evidence and does not price them).

## Maintenance

An entry is only as good as its retrieved date. Before any figure sourced from this register is ever
shown to a person, the entry must be re-verified against the primary source and its status
re-recorded. A `NEEDS_LEGAL_CONFIRMATION` entry that has not been confirmed is not a fallback — it is
a **stop**.
