
# CarUp Operations Control Plane — Benchmark Research & Transferable Patterns

**Status:** RESEARCH APPENDIX — source-backed, non-authoritative for CarUp policy
**Repository:** kudzimusar/carup
**Programme:** CarUp Operations Control Plane
**First implementation slice:** Serena Vehicle Operations / VIN GFC27-027051
**Research date:** 2026-09-02
**Base candidate used for code comparison:** 569e4f14c3fa022d942a41a57751fa3834def756
**Companion implementation manual:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md

---

## 1. Purpose and research boundary

This appendix records public, observable product and workflow patterns from automotive marketplaces, vehicle-history providers, private-sale transaction platforms, and vehicle exporters that are relevant to CarUp's Operations Control Plane.

It is deliberately not a claim about the private internal architecture of any benchmark company. Public websites reveal user-facing workflows, public policies, report semantics, seller obligations, transaction steps and visible moderation practices. They do not reveal the full internal role model, staff tooling, database schema or queue implementation.

The implementation agent must therefore use these benchmarks for product principles and workflow comparison, not copy invisible systems or infer private RBAC structures.

CarUp remains governed by its own Truth & Trust contract, Zimbabwe market requirements, canonical Vehicle Passport, evidence provenance, privacy rules and repository code.

---

## 2. Benchmark questions

The research focuses on the following questions:

1. How do mature automotive systems separate seller-provided claims from externally sourced vehicle facts?
2. How do they communicate incomplete history without turning missing data into a positive claim?
3. How do private-sale platforms verify seller identity, title/registration authority and transaction readiness?
4. How do marketplaces reserve the right to moderate, reject, suppress or investigate listings?
5. How do exporters distinguish shipping, purchase, inspection and registration/customs documents by lifecycle stage?
6. Which responsibilities remain with external authorities or partners rather than being impersonated by the platform?
7. Which patterns are useful for CarUp's incremental specialist-operator model?

---

## 3. carVertical — source provenance, report aggregation and incomplete-data honesty

### Publicly observable pattern

carVertical describes its history report as an aggregation of records from third-party sources rather than data created by carVertical itself. Its current public materials describe sources including state registries, damage providers, repair shops, law-enforcement databases and connected fleets. It presents history categories including damage, mileage, title/legal status, theft, ownership changes, photos and timeline events.

Crucially, carVertical also states that not every accident or event will necessarily appear because inclusion depends on what exists in partner databases. A no-findings report means no historical data was found in the relevant categories; it does not logically prove that the vehicle has never had an accident or event.

### Transferable CarUp principle

CarUp should explicitly preserve five distinct concepts:

~~~text
source record
    ↓
CarUp evidence/provenance record
    ↓
reviewed or governed interpretation
    ↓
canonical Trust/Passport projection
    ↓
public buyer-safe statement
~~~

A CarUp reviewer must not rewrite an external source into a stronger fact than the source supports.

Missing external data must remain:

- not recorded;
- not evaluated;
- unavailable;
- pending;

depending on the exact state.

It must never silently become:

- clear;
- no accident;
- no finance;
- registered;
- verified;
- safe.

### CarUp application

This benchmark strongly supports the existing CarUp separation between:

- raw vehicle evidence;
- provenance;
- reviewer decisions;
- canonical Trust;
- public-safe projections.

It also supports the Serena rule that the Tanzania T1 transit declaration cannot become a Zimbabwe Temporary Import Permit merely because both relate to cross-border movement.

### Official sources

- https://www.carvertical.com/features
- https://www.carvertical.com/en/help/about-the-service/do-you-own-or-create-the-data-in-carvertical-reports
- https://www.carvertical.com/help/about-the-service/are-carvertical-reports-created-by-your-employees
- https://www.carvertical.com/help/about-the-service/where-does-the-data-come-from
- https://www.carvertical.com/gb/help/about-the-service/information-about-all-road-accidents
- https://www.carvertical.com/help/pricing/what-information-may-appear-in-the-carvertical-report

---

## 4. CARFAX — seller statement versus sourced history

### Publicly observable pattern

CARFAX explicitly explains that dealer-listing details can differ from a CARFAX Vehicle History Report because listing information is entered by the seller while the history report contains information supplied by CARFAX data sources.

CARFAX also states that its history products are based only on information supplied to it and that it does not have the complete history of every vehicle. It encourages buyers to use the report together with inspection and test drive.

### Transferable CarUp principle

CarUp should preserve an explicit provenance label for every important buyer-facing statement:

~~~text
Seller stated
CarUp observed
CarUp reviewed
External source reported
Authoritative source confirmed
Derived by canonical CarUp rules
Not established
~~~

The Seller must be allowed to make truthful declarations. Those declarations must not be silently relabeled as authoritative verification.

A buyer should be able to understand why two statements differ without CarUp deleting either historical source.

### CarUp application

For Serena:

- Kingstone may state the current Zimbabwe registration stage if he knows a later event that is not in the uploaded pack.
- The document pack itself may support export, transit, purchase and inspection history.
- The pack does not itself establish a Zimbabwe CVR registration.
- A later authoritative CVR source could establish registration independently.

The UI should be able to show those facts side-by-side without collapsing them.

### Official sources

- https://support.carfax.com/article/dealer-listing-details-differ-from-the-carfax-report/
- https://support.carfax.com/article/what-s-on-a-carfax-report-and-how-can-it-help-me/
- https://www.carfax.com/company/about
- https://support.carfax.com/contact-us/datarequest/true/

---

## 5. Autotrader Private Seller Exchange — layered identity, title, fraud, communications and transaction operations

### Publicly observable pattern

Autotrader Private Seller Exchange publicly describes a layered private-sale model. The platform describes identity checks for buyers and sellers, vehicle registration/title checks, vehicle-history reports, secure on-platform communications, secure payments, transaction support, financing options and registration/title paperwork. Its fraud material also distinguishes ordinary Autotrader classified listings from the more governed PSX transaction workflow.

Autotrader's buyer guide says PSX verifies vehicle registration and seller identity, confirms title status, handles payment and can handle or facilitate titling/registration. The seller guide describes separate handling for active loans or selected leases, including lienholder payoff information.

### Transferable CarUp principle

Do not create one binary VERIFIED flag.

The operating model should separate:

~~~text
Account identity
Seller authority
Vehicle identity
Vehicle registration/title state
Vehicle history/evidence state
Listing moderation state
Fraud/risk state
Finance/encumbrance state
Transaction/payment state
Handover/ownership-transfer state
~~~

Each state has a different authority and a different reviewer.

### CarUp application

This directly supports the proposed CarUp specialist operating model:

- Identity Operations handles who the person is.
- Vehicle Operations handles evidence and seller authority.
- Marketplace Operations handles public-listing suitability.
- Risk Operations handles fraud.
- Finance/Transaction Operations handle loan, lien or payment workflows.
- External government/registry sources remain the authority for government facts.

The seller should not lose the ability to list merely because the vehicle has an active finance obligation or a registration process in progress; those may instead be separately governed, disclosed and transaction-gated.

### Official sources

- https://www.autotrader.com/marketplace
- https://www.autotrader.com/marketplace/buyer-guide
- https://www.autotrader.com/marketplace/seller-guide
- https://www.autotrader.com/legal/fraud-awareness
- https://www.autotrader.com/car-shopping/private-seller-exchange-quick-facts-buyers

---

## 6. Cars.com — seller responsibility, platform moderation and modular partner operations

### Publicly observable pattern

Cars.com's current seller terms require sellers to have the vehicle in their possession, have the right to transfer the advertised title, identify themselves appropriately, provide truthful and complete information, and use one listing for one unique vehicle.

The current terms also state that Cars.com may review listings before or after posting, investigate complaints and suspicious activity, and reject or remove listings when it determines that deceptive, misleading or fraudulent practices are involved.

Cars.com's current selling product also demonstrates modular transaction specialization: a seller may simply publish a listing, while a separate transaction partner experience can handle verified buyers, financing, paperwork, DMV-related work and payment. Cars.com also distinguishes seller self-reported vehicle condition from dealership verification in its instant-offer workflow.

### Transferable CarUp principle

Three layers should stay separate:

~~~text
Seller attestation
Platform moderation
Specialist/partner transaction authority
~~~

Moderation does not automatically convert the seller's statement into an independently verified government fact.

A platform can coordinate a transaction without claiming to be the DMV, insurer, lender or government registry.

### CarUp application

This supports:

- a seller-authority attestation during Sell;
- a governed CarUp seller-authority review;
- a distinct Marketplace moderation decision;
- external provider/partner authority for registry, insurance, finance or settlement;
- one Passport per vehicle and one active commercial listing relationship at a time.

It also supports the idea that CarUp may later integrate outside providers without giving those providers unrestricted platform-admin access.

### Official sources

- https://www.cars.com/about/sell-terms/
- https://www.cars.com/sell/
- https://www.cars.com/sell/how-to/
- https://www.cars.com/fraud-awareness/

---

## 7. BE FORWARD — lifecycle document taxonomy and import-stage operations

### Publicly observable pattern

BE FORWARD's support material distinguishes documents by their role in the purchase/export/import journey. It describes a normal shipment-document package including:

- Bill of Lading;
- insurance document when applicable;
- Export Certificate / deregistration or cancellation-of-registration document;
- Commercial Invoice;
- Inspection Certificate where required;
- Export Permit / Bill of Entry where required.

Its support pages separately describe consignee information, shipment tracking, payment proof upload and document availability. BE FORWARD's My Account flow lets buyers upload proof of payment and treats approval of that proof as a distinct step. Shipment documents may be viewed separately in its tracking/account environment.

This is a useful comparison because BE FORWARD's lifecycle does not treat every document touching the vehicle as a local registration document.

### Transferable CarUp principle

Evidence classification must model the event represented by the artifact, not merely the file format or a broad legacy category.

For example:

~~~text
Bill of Lading
→ Import / Bill of lading

Japanese Export Certificate
→ Import / Export certificate

Commercial Invoice
→ Import / Commercial invoice

Payment Receipt
→ Import / Purchase-payment receipt

Transit declaration
→ Import / Transit declaration

Roadworthiness certificate
→ Inspection / Roadworthiness

Zimbabwe CVR registration book
→ Registration / Registration book
~~~

Those classes must remain distinct even if every artifact is a PDF.

### CarUp application

This is directly relevant to the Serena document pack. It confirms the importance of keeping the current CarUp life-stage taxonomy as semantic authority rather than allowing a legacy evidence_type such as registration_document to dominate the interpretation.

The Serena Tanzania T1 is transit evidence. It is not a Zimbabwe Temporary Import Permit.

The Japanese Export Certificate belongs to the export/import journey. It is not proof that Zimbabwe local registration has been completed.

### Official sources

- https://www.beforward.jp/support/faq/faq-doc
- https://www.beforward.jp/support/mypage
- https://www.beforward.jp/support/how-to-buy
- https://www.beforward.jp/support/faq/faq-bs
- https://www.beforward.jp/support/faq/faq-vi

---

## 8. Cross-benchmark pattern matrix

| Pattern | carVertical | CARFAX | Autotrader PSX | Cars.com | BE FORWARD | CarUp implication |
|---|---|---|---|---|---|---|
| Seller statement separate from sourced fact | Indirect | Strong | Strong | Strong | Moderate | Preserve source/provenance labels |
| Missing data not proof of clean history | Strong | Strong | History report caveats | Moderate | N/A | Unknown must stay unknown |
| Human/platform moderation | Limited public visibility | Data correction/support | Strong | Strong | Payment/document approval | Specialist review queues |
| Identity verification | Not core | Not core | Strong | Partner/transaction layer | Consignee identity fields | Separate account/seller identity |
| Vehicle authority/title | History source | History source | Strong transaction gate | Seller attestation + partner | Shipping/import docs | Separate seller authority from registration |
| Secure communications | Not core | Support | Strong | Buyer contact workflows | Account/contact support | Reuse CarUp Communications Command Center |
| Finance/lien handling | Financial/legal history | History | Explicit | Partner layer | Payment stage | Separate finance obligation from Trust |
| Stage-specific document taxonomy | History categories | History categories | Transaction docs | Selling docs | Very strong | Canonical evidence class/subtype |
| External authority boundary | Strong | Strong | DMV/title partners | Partner/DMV | Destination authorities | Do not let CarUp Admin impersonate authority |
| Platform removal/suppression | N/A | Data correction | Fraud controls | Explicit | Reservation/payment controls | Marketplace + Risk Ops |

---

## 9. What CarUp should deliberately not copy

CarUp should not copy benchmark vocabulary blindly.

### Do not import US title logic as Zimbabwe registration law

Autotrader and Cars.com operate in legal regimes with state title and DMV processes. Zimbabwe's CVR, customs, import, police, roadworthiness and temporary-import realities require their own governed model.

### Do not copy carVertical's report-only product boundary

CarUp is not only a history-report provider. It must connect Sell, Passport, evidence, Marketplace, Communications, Service, Finance, Insurance and ownership lifecycle.

### Do not let human review overwrite source facts

Even when an operator can correct a CarUp classification or resolve a conflict, source artifacts and provenance must remain immutable and attributable.

### Do not make every workflow an Admin workflow

Mature systems visibly separate seller action, transaction specialists, external authorities, dealers, support and platform policy. CarUp should do the same.

### Do not equate “reviewed” with “government verified”

CarUp may review a document's relevance, legibility and association with a vehicle. That is not the same as a direct authoritative response from CVR, ZIMRA, an insurer or a lender.

---

## 10. Benchmark-derived design laws adopted for the implementation plan

The Operations Control Plane implementation manual adopts these benchmark-derived principles:

1. Preserve seller statements and sourced facts as separate records.
2. A source-aware status must be stronger than a generic green badge.
3. Unknown and unavailable states are first-class states.
4. Evidence classification follows the vehicle lifecycle represented by the artifact.
5. Seller identity, seller authority, vehicle registration, evidence review, listing moderation and transaction readiness are separate decisions.
6. Marketplace moderation may control public visibility without claiming government authority.
7. External partner systems remain the authority for the facts they own.
8. Human review must be attributable, auditable and reversible/supersedable where policy allows.
9. Private transaction and identity evidence remains private even when its existence supports a public trust statement.
10. A platform can coordinate a transaction while delegating specialized authority to partners.
11. The operating system should grow as specialist vertical slices rather than as one global Admin with unlimited authority.
12. Public claims should be projections of canonical governed state, never calculations improvised in the UI.

---

## 11. Revalidation rule

Benchmark products evolve. Before a future CarUp iteration relies materially on a benchmark policy or workflow:

1. open the official source again;
2. confirm the page is current;
3. record the retrieval date;
4. distinguish product observation from CarUp policy;
5. never treat a benchmark's rule as Zimbabwe law;
6. update this appendix if the benchmark materially changed.

This appendix informs CarUp design. The CarUp repository, approved product policy and authoritative Zimbabwe requirements determine implementation.
