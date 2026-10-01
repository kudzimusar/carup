# CarUp OCR 1.0 — Global Document Intelligence Programme Canonical Subplan

**Repository:** `kudzimusar/carup`  
**Programme:** OCR 1.0 — CarUp Global Document Intelligence Programme  
**Status:** CANONICAL SUBPLAN FOR BUNDLING INTO THE CARUP SYSTEM CANONICAL PLAN  
**Document path:** `docs/ocr/CARUP_OCR_1_0_GLOBAL_DOCUMENT_INTELLIGENCE_CANONICAL_PLAN.md`  
**Created:** 2026-10-01  
**Planning branch:** `docs/ocr-1-0-global-document-intelligence-plan`  
**Runtime mutation authority:** NONE from this document alone  
**Primary governing law:** **DOCUMENT INTELLIGENCE OBSERVES. DOMAIN AUTHORITIES DECIDE.**

---

## 0. Why this document exists

CarUp OCR has outgrown the meaning of a narrow OCR feature.

The repository now contains a hardened shared Document Intelligence architecture plus multiple domain consumers distributed across active branches. The correct next step is not to create a parallel “DI-01…DI-05” programme. Instead, the existing **OCR 1.0 programme is expanded into the CarUp Global Document Intelligence Programme**, preserving one continuity of authority, history, testing, receipts and implementation.

This document is the execution blueprint for that expansion.

It is intended to be **bundled into the wider CarUp canonical system plan** as the subordinate authority for document capture, classification, OCR/vision extraction, schema interpretation, candidate evidence, provenance, confirmation/review handoff and domain integration.

It must not become a competing system-wide master plan.

---

# 1. Programme identity

## 1.1 Canonical name

**OCR 1.0 — CarUp Global Document Intelligence Programme**

## 1.2 Capability name

Within the product architecture, the platform capability should be described as:

**Document Intelligence & Evidence Processing**

OCR/vision extraction is one technology inside that capability.

## 1.3 Frozen architectural law

> **DOCUMENT INTELLIGENCE OBSERVES. DOMAIN AUTHORITIES DECIDE.**

Document Intelligence may read, classify, normalize and structure documentary observations.

It does not itself grant identity, compliance, ownership, registration, Seller Authority, Trust, publication authority, finance approval, insurance approval, customs clearance or government truth.

---

# 2. Planning-time repository anchors

These are **planning anchors only**. They are not permanent implementation bases.

Every execution agent must re-verify live branch/PR state before mutation.

| Surface | Planning-time state |
|---|---|
| Canonical `main` | `bb9d9900c700873ca57df0ac18a1a5c01f77711a` |
| PR #214 | OPEN, head `fix/o2-ocr-trade-os-convergence@4ec68f7e2655575a433172951898f1dd744ad0e3` |
| PR #208 | OPEN / Draft, head `feat/operations-o2-people-compliance@e65c0bb835c65abce43ea1a0407406e4bf6456bb` |
| PR #209 | OPEN / Draft, head `feat/garage-mechanic-onboarding-1-0@ce45e16f1b52b4eb59cb49e5955cc4830db0cf97` |
| Existing OCR hardening lane | `fix/o2-live-ocr-operationalization` remains a historical/current OCR authority lane whose exact live tip must be re-read before use |
| Production | Must remain untouched unless separately authorized |
| Biometrics | Separate capability; not silently activated by OCR work |

The OCR agent must not assume these heads are unchanged when execution begins.

---

# 3. What is already established

The programme begins from substantial completed work, not from a blank slate.

The current body of OCR 1.0 work has already established or demonstrated:

- real vision-capable document extraction rather than truncated-base64 pseudo-OCR;
- a provider boundary around Document Intelligence;
- Cloudflare Workers AI / Qwen as the selected OCR candidate in the hardened lane;
- anti-fabrication tests and non-document abstention;
- fail-closed handling for provider failure;
- preservation of missing/unknown values instead of manufactured defaults;
- machine/provider provenance;
- manual review separation;
- identity OCR integration;
- Dealer onboarding OCR integration on PR #208;
- Garage onboarding OCR integration on PR #209;
- vehicle Registration Book / Customs evidence integration on PR #214;
- Diaspora / Trade OCR integration;
- cost/spend protections around live-provider execution;
- a clear architectural separation between OCR evidence and domain truth.

These accomplishments must be preserved during convergence.

---

# 4. Non-negotiable platform laws

The following rules are frozen across OCR 1.0-A through OCR 1.0-G.

## 4.1 One OCR architecture

There must be one governed Document Intelligence extraction architecture.

No new feature may introduce a second provider prompt path, ad-hoc OCR helper, parallel base64 parser or domain-specific AI OCR engine.

## 4.2 Candidate evidence only

Every machine extraction is an observation/candidate.

OCR output may never directly assert:

- identity verified;
- Dealer compliant or activated;
- Garage approved or activated;
- Seller Authority granted;
- legal ownership established;
- vehicle registered;
- customs/duty cleared;
- ZIMRA/CVR/government truth established;
- Canonical Trust awarded;
- marketplace publication approved;
- finance approved;
- insurance approved;
- SafeTrade/payment release approved.

## 4.3 Missing stays missing

No fabricated fallback values.

Do not replace missing values with `Unknown`, `N/A`, guessed dates, guessed sex, guessed year, synthetic confidence or other invented values.

## 4.4 Machine provenance must be server-observed

A client may not forge:

- provider name;
- model name;
- provider confidence;
- provider raw response;
- execution success;
- OCR status;
- machine-generated evidence.

Manual/user-entered information must be explicitly labelled as user/manual assertion.

## 4.5 No silent provider fallback

Changing OCR provider/model changes system semantics.

Fallback may occur only when explicitly designed, observable, policy-approved and separately certified.

## 4.6 Private documentary evidence stays private

Document capture/storage must retain authenticated scope, role/tenant/vehicle ownership controls and private storage semantics.

## 4.7 OCR is not biometrics

Reading a document is separate from proving that a person/selfie matches the identity document.

## 4.8 OCR is not Government truth

A Registration Book, customs declaration, duty receipt or licence may contain observations about an authority.

The document is not equivalent to an authoritative CVR, ZIMRA, ZINARA, VID, CID or other government system response.

---

# 5. Target platform architecture

```text
Any CarUp workflow
      │
      ▼
Document Capture
      │
      ▼
Document Classification
      │
      ▼
Document Intelligence Service
      │
      ├─ provider boundary
      ├─ schema resolution
      ├─ normalization
      ├─ missing/unreadable states
      └─ machine provenance
      │
      ▼
Universal Candidate Evidence Envelope
      │
      ▼
Domain Adapter
      │
      ├─ Identity
      ├─ Registration
      ├─ Dealer KYB
      ├─ Garage KYB
      ├─ Vehicle Evidence
      ├─ Seller
      ├─ Diaspora / Trade
      ├─ Finance
      ├─ Insurance
      ├─ Service / Mechanic
      └─ future domains
      │
      ▼
Domain Review / Decision Authority
      │
      ▼
Canonical Truth / Canonical Trust where appropriate
```

The platform is global because the infrastructure is shared.

The business meaning remains local to the consuming domain.

---

# 6. Programme phase map

| Phase | Name | Primary objective |
|---|---|---|
| OCR 1.0-A | Core OCR Hardening | Provider, accuracy, anti-fabrication, fail-closed behavior |
| OCR 1.0-B | Path Convergence | Eliminate parallel/unsafe OCR paths and complete governed vehicle/Diaspora convergence |
| OCR 1.0-C | Canonical Platform Convergence | Reconcile #214 + #208 + #209 into one authoritative implementation |
| OCR 1.0-D | Document Schema Registry Expansion | Add semantically correct schemas for CarUp's real documentary universe |
| OCR 1.0-E | Universal Evidence & Provenance Contract | Standardize cross-domain extraction traceability |
| OCR 1.0-F | Global Capture & Confirmation UX | Common web/native capture, confirmation, correction and review states |
| OCR 1.0-G | Cross-Domain Live Certification | Certify the same exact runtime across core stakeholder journeys |

Phases are progressive. A later phase may inspect ahead but must not claim closure while an earlier gate is open.

---

# 7. OCR 1.0-A — Core OCR Hardening

## Objective

Preserve and certify the hardened extraction engine.

## Required outcomes

- genuine media bytes reach a vision-capable provider;
- provider/model execution is positively proven;
- non-document input cannot fabricate identity or documentary facts;
- provider failure is distinct from genuine abstention;
- missing values remain missing;
- no fake confidence fallback;
- provider/model provenance is recorded;
- corpus fixtures and expected values remain unchanged;
- live-provider workflows cannot incur spend automatically without explicit policy.

## Exit gate

A is closed only when the hardened core remains reproducibly green and no regression reintroduces the historical pseudo-OCR behavior.

Historical receipts remain historical; do not rewrite them.

---

# 8. OCR 1.0-B — Path Convergence

## Objective

Ensure the hardened core is the only OCR architecture.

## Required work

### B1. Legacy generic OCR

Audit every reference to:

- `/api/ai/ocr`;
- `runOcrParsing`;
- legacy Gemini/text-style OCR helpers;
- truncated base64 payload handling.

Preferred result: retire unused legacy paths.

If a legitimate caller remains, make it a thin adapter to the canonical Document Intelligence service.

### B2. Diaspora provenance

Machine/provider extraction must originate only from server-side provider execution.

Manual/user-entered extraction must be structurally distinct.

A client cannot claim Qwen/Gemini/provider confidence/raw response without a real provider run.

### B3. Vehicle evidence

Registration Book, Customs and supported vehicle documents must integrate through existing governed evidence architecture.

OCR observations may compare against canonical vehicle facts but may not overwrite those facts.

### B4. Authority preservation

OCR cannot grant:

- Seller Authority;
- evidence verification;
- Vehicle Trust;
- registration status;
- government truth.

## Exit gate

Repository-wide search proves no independent legacy extraction engine remains and all supported OCR domain paths converge on the canonical boundary.

---

# 9. OCR 1.0-C — Canonical Platform Convergence

## Objective

Create one unified implementation from currently fragmented stakeholder lanes.

## Primary reconciliation inputs

### PR #214
Candidate source for:

- hardened Document Intelligence core;
- Trade/Diaspora OCR;
- vehicle document OCR;
- provider architecture;
- current OCR convergence behavior.

### PR #208
Candidate source for:

- registration onboarding OCR assistance;
- Person Identity consumption;
- Dealer KYB/document OCR;
- user confirmation/correction states.

### PR #209
Candidate source for:

- Garage onboarding OCR;
- Garage document evidence flow;
- OCR availability/fallback UX patterns.

## Mandatory reconciliation method

Do not blindly merge three branches.

The convergence agent must:

1. re-read exact PR heads;
2. inventory overlapping files, migrations, routes, schemas, tests and provider configuration;
3. classify each delta as:
   - preserve;
   - superseded;
   - conflict;
   - additive;
   - historical only;
4. identify the canonical version of every shared OCR file;
5. resolve migration lineage before database writes;
6. retain stronger security/governance behavior when implementations differ;
7. preserve current non-OCR domain authorities;
8. certify the unified tree at one exact SHA.

## Forbidden

- resurrecting the old generic OCR implementation for compatibility;
- selecting one PR wholesale without reconciling overlapping changes;
- creating a second Document Intelligence service;
- rewriting unrelated domain architecture;
- merging directly to protected production/main without programme authorization.

## Exit gate

One exact candidate contains:

- one core Document Intelligence implementation;
- identity/registration consumer;
- Dealer consumer;
- Garage consumer;
- Vehicle consumer;
- Trade/Diaspora consumer;
- one provider configuration contract;
- one schema registry contract;
- one provenance contract direction;
- all bounded tests green.

---

# 10. OCR 1.0-D — Document Schema Registry Expansion

## Objective

Make Document Intelligence semantically understand CarUp's documentary universe instead of forcing unrelated documents into generic schemas.

## Canonical schema states

Every submitted document must resolve to one of:

1. **known_supported** — dedicated schema exists;
2. **known_generic_observation** — classification known but only generic fields are intentionally extracted;
3. **unclassified** — classification uncertain; extraction is limited and review required;
4. **unsupported** — no AI extraction attempted; manual workflow continues.

Unknown documents must not silently become `business_document`.

## Initial schema families

### Person / Identity
- Zimbabwe National ID;
- passport;
- driver's licence;
- residence permit/card;
- proof of address where relevant.

### Business / KYB
- company registration certificate;
- tax certificate/tax clearance;
- municipal/trade licence;
- utility bill;
- business proof of address;
- bank statement;
- business licence;
- other governed business evidence.

### Vehicle
- Registration Book;
- ownership-transfer paperwork;
- inspection certificate;
- mechanical report;
- service invoice;
- parts invoice;
- roadworthiness evidence where documentary.

### Trade / Diaspora
- auction sheet;
- export certificate;
- commercial invoice;
- Bill of Lading;
- packing list;
- customs declaration;
- inspection certificate;
- insurance certificate;
- duty receipt;
- port release;
- police clearance;
- shipping/release documents.

### Finance / Insurance
- lender agreement;
- settlement statement;
- finance application evidence;
- insurance policy/certificate;
- claim-support documents.

## Each schema must declare

- schema key;
- version;
- semantic document class;
- stakeholder/domain consumers;
- classification signals;
- extractable fields;
- normalization rules;
- required/optional fields;
- sensitive fields;
- unsupported assertions;
- review triggers;
- authority prohibitions;
- test fixtures.

## Exit gate

No production-supported CarUp document is knowingly routed through a semantically false schema.

---

# 11. OCR 1.0-E — Universal Evidence & Provenance Contract

## Objective

Give every domain the same answer to:

- what document was supplied?
- who supplied it?
- for what subject/workflow?
- which provider/model read it?
- when did execution occur?
- what fields were observed?
- what was missing/unreadable?
- what confidence was genuinely reported?
- what schema version interpreted it?
- which domain consumed it?
- who later made the decision?

## Canonical logical envelope

```text
DocumentIntelligenceObservation
  observation_id
  document_id
  document_class
  schema_version

  supplied_by
  subject_type
  subject_id
  source_workflow

  provider
  model
  execution_id
  execution_status
  executed_at

  media_hash
  mime_type
  media_size
  capture_source

  observed_fields[]
    field
    raw_value
    normalized_value
    confidence_if_provider_reported
    state

  missing_fields[]
  unreadable_fields[]
  anomalies[]

  review_status
  consumed_by[]
  decision_references[]

  authority_effects = NONE
```

This does not require every domain to share one business table.

Domain-owned state may remain domain-owned.

The requirement is a common provenance contract and traceable linkage.

## Exit gate

A reviewer can trace a domain decision back to the exact document observation and provider execution without guessing across unrelated tables.

---

# 12. OCR 1.0-F — Global Capture & Confirmation UX

## Objective

Make Document Intelligence reusable and predictable across Web/PWA and native mobile.

## Shared capture capabilities

Where supported, provide consistent building blocks for:

- camera capture;
- gallery/file selection;
- PDF/image handling;
- front/back document capture;
- rotation/cropping;
- basic quality guidance;
- upload progress;
- retry;
- secure storage;
- classification;
- extraction status;
- confirmation/correction;
- manual fallback;
- review status.

## Canonical value states

Reuse a common concept such as:

- `machine_candidate`;
- `user_confirmed`;
- `user_corrected`;
- `user_provided`;
- `missing`.

A machine candidate is never silently promoted to user-confirmed truth.

## Availability policy

Every workflow must explicitly declare one mode:

- automatic;
- optional;
- background;
- reviewer-triggered;
- disabled.

Provider credentials alone must not accidentally enable spend or workflow behavior.

## Resilience

Basic account creation must not become globally dependent on OCR availability.

Progressive Trust remains preferred:

basic account → stronger evidence required before sensitive capability.

Manual fallback must exist where domain policy permits.

## Exit gate

A stakeholder sees consistent capture/extraction/confirmation semantics regardless of which CarUp domain initiated the document flow.

---

# 13. OCR 1.0-G — Cross-Domain Live Certification

## Objective

Prove that Global Document Intelligence works as one platform at one exact deployed runtime.

## Certification layers

### G0 — Static/repository convergence
- no legacy OCR implementation;
- one provider boundary;
- one schema registry;
- one provenance contract;
- no client-forgeable machine provenance.

### G1 — Offline deterministic regression
- identity;
- registration onboarding;
- Dealer;
- Garage;
- Vehicle;
- Trade/Diaspora;
- schema tests;
- provenance tests;
- authorization tests;
- no authority mutation from extraction.

### G2 — Real provider corpus
Use unchanged certified fixtures.

Required result for the core gate:

- 11/11;
- 0 incorrect;
- 0 fabricated;
- 0 inconclusive.

### G3 — Exact-head deployed readiness
Prove frontend/backend provenance and provider readiness on the same candidate SHA.

### G4 — Cross-domain live journeys
At minimum certify:

1. Person Identity;
2. Registration assisted entry;
3. Dealer KYB document;
4. Garage business document;
5. Vehicle Registration Book;
6. Customs/Trade document;
7. Diaspora document workflow.

### G5 — Negative authority tests
Prove OCR cannot directly:

- verify identity;
- activate Dealer/Garage;
- grant Seller Authority;
- overwrite canonical VIN/chassis/engine;
- mark customs duty paid;
- fabricate government records;
- mutate Canonical Trust;
- publish a listing;
- approve finance/insurance/payment.

## Final acceptance statement

Only after all gates pass may the programme state:

> **OCR 1.0 GLOBAL DOCUMENT INTELLIGENCE OPERATIONAL — ONE GOVERNED DOCUMENT PLATFORM AVAILABLE ACROSS CARUP**

---

# 14. Stakeholder consumption matrix

| Stakeholder/domain | Document Intelligence role | Decision authority |
|---|---|---|
| Basic account | Optional assistance, not mandatory global account gate | Auth/account system |
| Person / Owner / Seller | ID/passport/licence observations | Identity review authority |
| Registration profile | Autofill proposals | User confirmation + registration domain |
| Dealer | KYB/business candidates | Dealer Compliance |
| Garage | Business/address candidates | Garage onboarding/review authority |
| Mechanic | Shared Person Identity documents | Identity + Service Network membership |
| Vehicle | Registration/inspection/evidence observations | Vehicle/evidence authority |
| Seller | Supporting person/vehicle evidence | Seller Authority |
| Diaspora / Trade | Trade document extraction | Trade reviewer/domain authority |
| Government workflows | Documentary evidence only unless authoritative API responds | Government/source reconciliation |
| Finance | Application/evidence assistance | Lender/provider authority |
| Insurance | Policy/claim evidence assistance | Insurer/provider authority |
| Marketplace | May consume approved facts | Publication/listing authority |
| SafeTrade/payment | Documentary context only | Transaction/payment authority |
| Referral | No direct OCR authority | Referral engine |
| Communications | Communicates states/outcomes | Owning domain |

---

# 15. Agent operating method

Every OCR 1.0 implementation agent must follow this loop:

1. read this plan;
2. read the latest moderator/continuation handoff;
3. verify current `main`, target branch, PR heads and tree cleanliness;
4. inspect actual code before assuming a historical defect still exists;
5. classify current phase and exact bounded objective;
6. preserve closed earlier phases;
7. make the smallest coherent implementation;
8. run affected tests first;
9. run bounded regression;
10. produce exact-head evidence;
11. update programme receipts/documentation without rewriting history;
12. return control to the moderator/owner for acceptance.

Agents must not rediscover the whole programme every time.

---

# 16. Required receipt format

Every phase completion report must include:

## Identity
- programme phase;
- branch;
- PR;
- starting SHA;
- resulting candidate SHA.

## Mutation
- files changed;
- migrations changed/added;
- routes changed;
- schemas changed;
- tests changed.

## Proof
- exact test commands;
- pass/fail counts;
- runtime/deployment SHA if applicable;
- provider/model actually used for live tests;
- authorization/negative proofs;
- no-authority-effect proofs.

## Disposition
One of:

- `COMPLETE — READY FOR MODERATOR ACCEPTANCE`
- `PARTIAL — REMAINING BOUNDED ITEMS LISTED`
- `BLOCKED — EXTERNAL/MANUAL AUTHORITY REQUIRED`

An implementation agent never self-declares programme acceptance.

---

# 17. Stop conditions

Stop mutation and report when any of the following is discovered:

- branch/head differs from the instructed authority and changes are not understood;
- migration lineage conflicts;
- another active programme owns the same shared surface;
- resolving a conflict would weaken a frozen domain authority;
- production credentials or production data would be required without authorization;
- a provider key would need to move into frontend/client code;
- a live-provider test would incur spend outside approved certification;
- the only way forward appears to require fabricated fixtures/metrics/authority;
- a domain requires an authoritative external source that does not yet exist;
- merge/rebase would rewrite accepted historical evidence.

---

# 18. Relationship to other CarUp authorities

This plan governs **Document Intelligence & Evidence Processing**.

It does not replace:

- Identity authority;
- Dealer Compliance;
- Garage onboarding authority;
- Seller Authority;
- Vehicle Passport / Canonical Vehicle Truth;
- Canonical Trust;
- Trade OS;
- Service Network;
- Marketplace publication;
- Finance;
- Insurance;
- SafeTrade/payment;
- Government integration authority;
- biometrics.

When a conflict exists, the Document Intelligence layer yields on the **meaning/decision** of evidence to the owning domain while retaining ownership of extraction/provenance mechanics.

---

# 19. Canonical-plan bundling instruction

When the broader CarUp canonical system plan is compiled or refreshed, it should register this programme as:

## Foundational cross-cutting platform capability

**OCR 1.0 — Document Intelligence & Evidence Processing**

**Purpose:** Shared secure document capture, classification, OCR/vision extraction, schema interpretation, normalization, candidate evidence, provenance and review handoff for every CarUp domain that legitimately consumes documentary evidence.

**Governing law:** **Document Intelligence observes. Domain authorities decide.**

**Canonical subordinate plan:**  
`docs/ocr/CARUP_OCR_1_0_GLOBAL_DOCUMENT_INTELLIGENCE_CANONICAL_PLAN.md`

No separate DI-01…DI-05 programme should be created.

Future Document Intelligence work must extend OCR 1.0 through the A→G phase model or a later explicitly versioned successor.

---

# 20. Programme roll-call

| Phase | Initial classification at plan creation |
|---|---|
| OCR 1.0-A — Core OCR Hardening | Substantially implemented; preserve and re-certify |
| OCR 1.0-B — Path Convergence | Substantially implemented in convergence work; verify exact live closure before advancing |
| OCR 1.0-C — Canonical Platform Convergence | NOT CLOSED — primary next programme-level convergence phase |
| OCR 1.0-D — Document Schema Registry Expansion | PLANNED |
| OCR 1.0-E — Universal Evidence & Provenance Contract | PLANNED |
| OCR 1.0-F — Global Capture & Confirmation UX | PLANNED |
| OCR 1.0-G — Cross-Domain Live Certification | PLANNED |

The next agent must not blindly start C until it proves A/B closure at the current exact heads.

---

# 21. Definition of done

OCR 1.0 is globally complete only when:

- one governed OCR/Document Intelligence architecture exists;
- no legacy independent OCR path remains;
- all machine provenance is trustworthy;
- major stakeholder consumers are unified into the canonical tree;
- document taxonomy is semantically correct enough for supported production workflows;
- provenance is traceable cross-domain;
- capture/confirmation behavior is coherent across supported clients;
- real-provider certification passes;
- cross-domain exact-head live journeys pass;
- extraction cannot manufacture domain authority;
- the wider CarUp canonical system plan references this document as its subordinate Document Intelligence authority.

Until then, use phase-specific status rather than claiming “OCR is globally complete.”
