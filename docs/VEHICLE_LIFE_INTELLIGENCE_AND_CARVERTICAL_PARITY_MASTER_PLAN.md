# CarUp Vehicle Life Intelligence & CarVertical-Parity Master Implementation Plan

**Program:** Vehicle Digital Passport, Evidence Timeline, Visual History Intelligence, Trust Governance, and Production Infrastructure  
**Repository:** `kudzimusar/carup`  
**Document role:** Master source of truth for completing Milestones 1–6  
**Execution mode:** Multi-agent, milestone-gated, one coordinated program  
**Merge authority:** The agents must not merge any implementation PR unless the user explicitly says `merge this PR now`.

---

## 0. Executive Mission

CarUp must become more than an online vehicle marketplace and more than a gallery of uploaded evidence. The target is a Zimbabwe-focused vehicle intelligence platform that can match the most useful capabilities associated with commercial vehicle-history products such as CarVertical, while going further in areas that matter locally:

- evidence-backed Vehicle Digital Passports;
- Zimbabwe plate, chassis, engine, and temporary-ID identity;
- privacy-safe ownership history;
- import, auction, accident, repair, inspection, transfer, dealer-listing, and current-condition evidence;
- source provenance and chain of custody;
- visual comparison across the life of a vehicle;
- AI-assisted detection of damage, repairs, replacements, image reuse, mileage conflicts, and disclosure conflicts;
- governed human review before consequential claims become public;
- shareable buyer-facing vehicle history reports;
- production-grade infrastructure, security, backups, recovery, monitoring, and controlled deployment.

The defining product outcome is not merely: “show uploaded photos.” It is:

> Reconstruct a defensible, chronological, evidence-linked account of a vehicle’s life, explain what changed, identify unresolved risks, and help a buyer understand what can and cannot be trusted.

Representative final findings include:

- “Front bumper appears to have been replaced between the 2021 auction record and the 2022 inspection.”
- “Rear-quarter damage is visible in the historical auction record but is not disclosed in the current seller description.”
- “The odometer shown in the current listing is lower than the reading recorded during an earlier inspection.”
- “These listing photos appear to have been reused from a different vehicle record.”

Every such finding must identify its supporting evidence, confidence, source, model/version where applicable, and human-review state.

---

## 1. Program Status at the Start of This Plan

Claude must verify all of the following against the current repository and GitHub state before implementation. Do not rely on this document as proof that a file or behavior is still present.

### 1.1 Completed foundations to preserve

The repository has previously implemented and merged substantial foundations, including:

- Vehicle Evidence Timeline and Evidence Vault foundation.
- Zimbabwe plate identity and owner privacy.
- Evidence upload, validation, visibility, review, approval, and rejection flows.
- Public suppression of pending, rejected, private, and restricted evidence.
- Premium public evidence gallery and lightbox.
- Navigation and route-discovery improvements.
- Typed Feature Registry foundation.
- An advisory AI-analysis framework with mock provider behavior, checksum duplicate checks, provider-failure handling, public sanitization, and no autonomous approval or trust-score mutation.
- Security headers, CORS controls, CSRF controls, upload validation, structured logs, telemetry, correlation IDs, and basic in-memory rate limiting.

### 1.2 Known incompleteness

The repository has not yet demonstrated completion of:

- a complete life-stage evidence taxonomy;
- source-specific metadata and provenance;
- external historical evidence ingestion;
- live production vision/OCR provider behavior;
- perceptual image similarity and same-vehicle matching;
- component-level temporal comparison;
- damage progression and replacement inference;
- seller-claim extraction and contradiction detection;
- a complete CarVertical-style vehicle history report;
- mature dispute and adjudication workflows;
- distributed rate limiting;
- complete CI/CD and environment promotion;
- durable worker queues and dead-letter handling;
- backup/restore drills and disaster recovery;
- WAF/DDoS operating controls;
- production AI evaluation, monitoring, and budget controls.

### 1.3 Navigation is a subordinate workstream

The mobile navigation plan at:

`docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md`

is a supporting sub-plan. It is not the master Vehicle Life Intelligence plan. Claude must avoid mistaking navigation completion for completion of this program.

---

## 2. Non-Negotiable Product and Governance Principles

### 2.1 Evidence first

Every public claim must be linked to one or more evidence records. The system must distinguish:

- raw source evidence;
- extracted observations;
- AI-generated inference;
- reviewer-confirmed finding;
- disputed finding;
- superseded or corrected finding.

### 2.2 AI is advisory

AI must never, by itself:

- approve or reject evidence;
- publish a high-risk accusation;
- alter ownership records;
- change registry facts;
- alter trust scores;
- create legal conclusions;
- declare fraud as fact;
- block a transaction without a governed rule and human review.

### 2.3 Explainability

Every finding must expose:

- finding type;
- affected component or attribute;
- evidence IDs;
- source dates;
- model/provider and version;
- confidence;
- severity;
- public-safe explanation;
- reviewer status;
- reviewer decision and notes where authorized.

### 2.4 Privacy and least disclosure

The system must enforce visibility levels and role-based access at query/service boundaries, not only in UI code. Raw AI logs, private ownership data, protected documents, and restricted evidence must never leak through public endpoints.

### 2.5 Provenance

Imported and uploaded evidence must carry enough provenance to answer:

- who supplied it;
- where it originated;
- when it was captured;
- when it was received;
- whether it was transformed;
- how its integrity is checked;
- whether the source is trusted, licensed, verified, disputed, or unknown.

### 2.6 No fabricated integrations

Where real auction, government, insurer, shipping, or inspection credentials are unavailable, agents must implement:

- provider interfaces;
- sandbox adapters;
- fixtures;
- contract tests;
- secure configuration points;
- explicit blocker documentation.

They must not claim a source is live when it is not.

### 2.7 One program, controlled milestones

“Do all remaining phases in one go” means Claude owns the full coordinated program and continues through all feasible milestones. It does not mean one enormous unreviewable commit. Use milestone branches/PRs, isolated worktrees, narrow commits, and explicit integration gates.

---

## 3. Required Initial Discovery and Gap Audit

Before implementation, the lead agent must create a code-derived audit covering:

1. Current database tables, views, functions, RLS policies, and migrations related to vehicles, evidence, timelines, audits, trust, storage, users, tenants, and reports.
2. Current backend routes and service boundaries.
3. Current evidence categories and validation rules.
4. Current storage bucket paths, signed URLs, public/private access rules, and file limits.
5. Current public vehicle-details and passport response shapes.
6. Current admin/government/dealer review screens.
7. Current AI-analysis schema and worker behavior.
8. Current testing conventions and fixture strategy.
9. Current deployment, CI, observability, and security configuration.
10. Current open PRs that overlap this program.

The audit must produce:

- a current-state architecture diagram;
- a database/entity map;
- an API inventory;
- an implemented/partial/missing matrix for every deliverable in this plan;
- a conflict and dependency register;
- a proposed milestone PR sequence.

Do not begin broad implementation until the audit confirms the repository’s actual state.

---

# MILESTONE 1 — COMPLETE THE VEHICLE EVIDENCE PRODUCT MODEL

Milestone 1 combines the missing Vehicle Life Evidence Taxonomy and Provenance/Chain-of-Custody phases.

## 4. Phase 3 — Vehicle Life Evidence Taxonomy

### 4.1 Goal

Make each evidence item meaningful in the context of the vehicle’s life rather than treating all files as generic uploads.

### 4.2 Required top-level evidence classes

Implement first-class support for at least:

1. `import`
2. `auction`
3. `accident`
4. `repair`
5. `inspection`
6. `ownership_transfer`
7. `dealer_listing`
8. `current_condition`

Retain backward compatibility for existing evidence records and categories.

### 4.3 Required subtype examples

#### Import

- export-yard photo;
- port photo;
- container loading/unloading;
- bill of lading;
- export certificate;
- customs entry;
- duty/clearance document;
- import inspection.

#### Auction

- auction image;
- auction sheet;
- damage diagram;
- auction grade;
- lot metadata;
- mileage reading;
- source listing snapshot.

#### Accident

- scene photo;
- police report;
- insurer assessment;
- tow record;
- damage map;
- severity assessment.

#### Repair

- before repair;
- during repair;
- after repair;
- repair invoice;
- parts list;
- replaced component;
- paint/body work;
- structural repair;
- mechanic certification.

#### Inspection

- pre-purchase inspection;
- roadworthiness;
- mechanical inspection;
- chassis inspection;
- emissions;
- brake/tyre/suspension assessment;
- odometer reading;
- inspector report.

#### Ownership transfer

- transfer record;
- sale agreement;
- condition-at-handover;
- mileage-at-transfer;
- privacy-safe ownership transition.

#### Dealer listing

- listing photographs;
- seller/dealer description snapshot;
- advertised mileage;
- advertised condition;
- price and price history;
- listing source and date;
- declared accident/repair status.

#### Current condition

- exterior viewpoints;
- interior;
- engine bay;
- underbody;
- tyres;
- dashboard;
- odometer;
- VIN/chassis/plate;
- current defects.

### 4.4 Data model requirements

Use normalized structures where appropriate. Avoid an unbounded metadata blob as the only model. The schema should support:

- stable evidence class and subtype enums/reference tables;
- event date and date precision;
- capture location and country;
- odometer value and unit;
- component/body-region tags;
- declared condition;
- seller/dealer claims;
- source organization;
- source record identifier;
- related timeline event;
- evidence set/batch identifier;
- before/during/after repair grouping;
- original and transformed asset references;
- visibility and review status;
- retention/legal basis fields where needed.

Use JSONB only for source-specific extensions with schema validation and typed service boundaries.

### 4.5 API and service requirements

Implement or update:

- taxonomy discovery endpoint for forms;
- upload/create validation by class/subtype;
- evidence metadata editing with audit history;
- evidence-set creation and grouping;
- chronological queries;
- filters by class, source, date, and review state;
- public-safe serialization;
- migration of legacy evidence categories.

### 4.6 UI requirements

Update upload and review experiences to support:

- life-stage category;
- source and capture date;
- mileage where relevant;
- component/body-region tags;
- listing claims or inspection findings;
- evidence-set grouping;
- clear privacy explanation;
- preview of how evidence will appear on the timeline.

The buyer-facing timeline must visibly distinguish all eight life stages and render dates, sources, verification, and evidence counts.

### 4.7 Acceptance tests

- All eight life-stage classes can be created and queried.
- Invalid class/subtype combinations fail safely.
- Legacy evidence remains readable.
- Public views receive only verified `public_safe` records.
- Restricted/private metadata is absent from public payloads.
- Timeline ordering handles partial/unknown dates deterministically.
- Evidence sets render together.
- Upload/review UI works on desktop and mobile.

---

## 5. Phase 4 — Provenance and Chain of Custody

### 5.1 Goal

Make evidence traceable, tamper-evident, and source-aware.

### 5.2 Source registry

Create a governed source registry supporting:

- source type;
- organization;
- country;
- verification status;
- trust tier;
- contact/credential references;
- data-sharing/legal basis;
- active/suspended status;
- permitted evidence classes;
- adapter/provider identifier.

### 5.3 Required provenance fields

Each evidence asset or evidence record must support:

- source type and source ID;
- source record ID;
- original source URL where lawful;
- captured-at and received-at timestamps;
- uploaded/imported by;
- organization/tenant;
- original filename and MIME type;
- byte size;
- cryptographic checksum;
- perceptual hash for images;
- transformation history;
- parent/original asset reference;
- ingestion job ID;
- chain-of-custody events;
- verification state;
- reviewer and reviewed-at;
- dispute state;
- visibility level;
- retention class and deletion constraints.

### 5.4 Integrity controls

Implement:

- SHA-256 or stronger checksum;
- perceptual hash abstraction;
- immutable provenance/audit events;
- duplicate and near-duplicate lookup hooks;
- signed or verifiable ingestion receipts where practical;
- protection against silent source metadata replacement;
- versioned corrections rather than destructive overwrite.

### 5.5 Chain-of-custody events

Track at minimum:

- created/uploaded/imported;
- malware/type validation;
- transformed/thumbnail generated;
- AI analysis requested/completed/failed;
- reviewer opened;
- approved/rejected/requested-more-information;
- published/unpublished;
- disputed/resolved;
- corrected/superseded;
- retention hold/deletion.

### 5.6 Acceptance tests

- Provenance is present for every new evidence item.
- Changes create audit records.
- Checksums remain stable for original assets.
- Transformed assets point to their original.
- Near-duplicate hooks can query existing perceptual hashes.
- Public payloads expose only safe provenance summaries.
- Restricted source credentials never appear in API responses.

### Milestone 1 exit gate

Milestone 1 is complete only when the product can accurately describe what an evidence item represents, when it belongs in the vehicle’s life, and where it came from.

---

# MILESTONE 2 — ACQUIRE HISTORICAL EVIDENCE

## 6. Phase 5 — External Source Ingestion Framework

### 6.1 Goal

Move beyond owner/dealer uploads and create a controlled path for historical data acquisition.

### 6.2 Provider architecture

Implement a provider interface supporting:

- authentication/configuration;
- polling and webhook ingestion;
- pagination/cursors;
- source record mapping;
- asset download or signed retrieval;
- idempotency;
- retries and backoff;
- rate-limit handling;
- quarantine;
- job state;
- dead-letter handling;
- reprocessing;
- source-specific validation;
- observability and cost metrics.

### 6.3 Initial adapters

Implement contract-complete adapters or sandbox adapters for:

1. Japanese auction/export data.
2. Importer/shipping/customs evidence.
3. Inspection-centre evidence.
4. Dealer/marketplace listing snapshots.
5. Insurer/repair/garage evidence.
6. Government/registry evidence where legally and technically possible.

When real APIs are unavailable, provide documented fixture-based sandbox providers and an onboarding guide for future partners.

### 6.4 Identity resolution

Ingestion must attempt vehicle matching using:

- VIN/chassis;
- normalized plate and plate history;
- engine number where lawful;
- source vehicle ID;
- auction lot;
- make/model/year;
- body shape and colour;
- confidence scoring.

Ambiguous matches must enter a human resolution queue. Never silently attach uncertain evidence to a vehicle.

### 6.5 Listing snapshots

Create immutable listing snapshots including:

- listing URL/source;
- seller/dealer identity reference;
- timestamp;
- title and description;
- price/currency;
- advertised mileage;
- claimed condition;
- claimed accident/repair status;
- image set;
- change history.

These snapshots are required for later disclosure-conflict analysis.

### 6.6 Legal and consent controls

Document and enforce:

- source terms/licensing;
- personal-data handling;
- retention;
- deletion/correction requests;
- jurisdiction;
- public-display rights;
- source attribution requirements.

### 6.7 Acceptance tests

- Repeated import is idempotent.
- Failed records quarantine without blocking the whole batch.
- Ambiguous vehicle matches require review.
- Source outages retry safely.
- Invalid assets are rejected/quarantined.
- Imported evidence has complete provenance.
- Listing snapshots are immutable and versioned.
- No real provider is marked live without credentials and successful contract verification.

### Milestone 2 exit gate

At least one end-to-end sandbox or authorized source flow must import a multi-event vehicle history into the taxonomy and provenance model. The framework must be ready for additional providers without schema redesign.

---

# MILESTONE 3 — BUILD REAL VISUAL AND DISCLOSURE INTELLIGENCE

## 7. Phase 6 — Live AI Vision, OCR, and Similarity Provider Layer

### 7.1 Goal

Replace mock-only behavior with a production-capable, provider-agnostic analysis layer while retaining safe fallbacks.

### 7.2 Provider requirements

Support one configured live provider and a test/mock provider behind the same contract. Provider configuration must include:

- model name/version;
- timeout;
- retry policy;
- maximum file size/resolution;
- supported MIME types;
- budget limits;
- confidence thresholds;
- region/data-processing policy;
- feature flags;
- fallback behavior.

### 7.3 Analysis capabilities

Implement separate typed tasks for:

- image quality and usability;
- viewpoint classification;
- vehicle identity cues;
- plate OCR;
- VIN/chassis OCR;
- odometer OCR;
- auction-sheet/document extraction;
- body component detection;
- visible damage detection;
- repair/paint inconsistency indicators;
- manipulation indicators;
- perceptual duplicate/near-duplicate detection;
- same-vehicle similarity.

Do not conflate all tasks into one opaque prompt/result.

### 7.4 Analysis lifecycle

Use a durable job model:

- queued;
- processing;
- succeeded;
- failed-retryable;
- failed-terminal;
- manual-review-required;
- superseded.

Store provider/model version, latency, token/cost estimates, confidence, structured output, validation errors, and safe summaries.

### 7.5 Security and privacy

- Never send private assets to an external provider without configured legal approval.
- Strip unnecessary metadata.
- Avoid sending owner identity where not needed.
- Use signed, short-lived asset access.
- Redact raw provider responses from public APIs.
- Make provider use configurable by evidence visibility and jurisdiction.

### 7.6 Evaluation suite

Build a consented or synthetic evaluation set covering:

- clear and blurry plates;
- valid and invalid VIN images;
- analogue/digital odometers;
- front/rear/side viewpoints;
- dents, scratches, broken lights, missing panels;
- repaired/repainted panels;
- duplicate and cropped images;
- unrelated vehicle images;
- auction sheet examples.

Measure precision, recall, false-positive rate, confidence calibration, latency, and cost. Define thresholds for auto-routing to human review—not auto-publication.

---

## 8. Phase 7 — Temporal Visual Comparison Engine

### 8.1 Goal

Compare evidence across dates and infer how a vehicle changed.

### 8.2 Evidence-set preparation

Group assets by:

- vehicle;
- event/evidence set;
- date/date range;
- viewpoint;
- component/body region;
- source;
- confidence that assets show the same vehicle.

### 8.3 Same-vehicle validation

Use VIN/plate/source metadata where available and visual similarity as supporting evidence. Produce a confidence score and route low-confidence comparisons to review.

### 8.4 Component model

Support at least:

- front/rear bumper;
- bonnet/hood;
- boot/tailgate;
- left/right doors;
- front/rear wings/fenders;
- quarter panels;
- roof;
- lights;
- mirrors;
- windscreen/windows;
- wheels/tyres;
- dashboard;
- airbags/interior safety areas;
- engine bay;
- underbody where visible.

### 8.5 Change types

Detect and structure:

- newly damaged;
- repaired;
- replaced;
- removed/missing;
- repainted/colour mismatch;
- worsened;
- improved;
- unchanged;
- unable to compare.

### 8.6 Finding schema

A temporal finding must include:

- vehicle ID;
- finding type;
- component;
- earlier and later evidence-set IDs;
- earlier/later dates;
- supporting asset IDs;
- bounding regions or annotations where possible;
- model/version;
- confidence;
- severity;
- reviewer state;
- public-safe summary;
- internal technical explanation.

### 8.7 Required example behavior

The system must be able to create a reviewable finding equivalent to:

> “Front bumper appears damaged in the 2021 auction evidence and visually different in the 2022 inspection evidence; replacement is likely.”

It must not state replacement as confirmed unless the evidence or reviewer supports that conclusion.

### 8.8 Comparison UI

Implement:

- before/after side-by-side view;
- synchronized zoom where feasible;
- slider comparison where appropriate;
- highlighted regions;
- date/source labels;
- confidence and review status;
- evidence links;
- “insufficient evidence” states.

### 8.9 Acceptance tests

- Same-vehicle mismatch prevents comparison publication.
- Viewpoint mismatches are handled safely.
- Temporal ordering is correct.
- Findings retain evidence links.
- Low confidence routes to review.
- Public output excludes raw/private analysis.
- Reviewer changes are audited.

---

## 9. Phase 8 — Seller Disclosure Conflict Engine

### 9.1 Goal

Compare current seller/dealer claims with historical evidence without making ungoverned accusations.

### 9.2 Claim extraction

Extract structured claims from listing snapshots, including:

- no accident history;
- original paint;
- no major repairs;
- genuine mileage;
- single owner;
- recently inspected;
- never imported/locally owned;
- component/features present;
- current defects disclosed.

Store the original text span and normalized claim.

### 9.3 Conflict rules

Compare claims against:

- accident evidence;
- repair evidence;
- temporal visual findings;
- mileage history;
- ownership history;
- import/auction history;
- inspection failures;
- missing or contradictory components.

Classify results as:

- supported;
- not verifiable;
- possible conflict;
- strong conflict;
- outdated claim;
- resolved/corrected.

### 9.4 Required behavior

Generate a reviewable result equivalent to:

> “Historical auction evidence shows rear-quarter damage. The current listing states ‘no accident damage.’ This may be a disclosure conflict and requires reviewer confirmation.”

Do not label the seller fraudulent automatically.

### 9.5 Seller response and correction

Provide:

- notification workflow;
- response/evidence submission;
- listing correction;
- reviewer reassessment;
- dispute state;
- correction history;
- public-safe resolved wording.

### 9.6 Acceptance tests

- Exact source text is retained internally.
- Public wording is neutral and evidence-based.
- Conflicts cannot publish without required review policy.
- Seller responses are audited.
- Corrected listings preserve historical snapshots.
- Mileage conflict calculations handle units and date ordering.

### Milestone 3 exit gate

A controlled demonstration vehicle must show multi-date evidence, at least one component comparison, and at least one claim/evidence comparison, all with evidence links and human-review states.

---

# MILESTONE 4 — BUILD THE BUYER-FACING VEHICLE HISTORY PRODUCT

## 10. Phase 9 — CarVertical-Class Vehicle History Report

### 10.1 Goal

Turn the underlying evidence and findings into a clear, trustworthy, useful buyer report.

### 10.2 Report sections

Implement at minimum:

1. Vehicle identity summary.
2. Report generation timestamp and data freshness.
3. Source and evidence completeness summary.
4. Key alerts and unresolved risks.
5. Vehicle Life Timeline.
6. Auction and import history.
7. Accident and repair history.
8. Inspection history.
9. Mileage history and anomalies.
10. Ownership-transfer history with privacy-safe display.
11. Listing history and price/description changes.
12. Visual before/after comparisons.
13. AI-assisted findings and reviewer state.
14. Current condition evidence.
15. Limitations and unavailable data.
16. Evidence/source index.

### 10.3 Risk presentation

Avoid a single unexplained score. Present:

- alert category;
- severity;
- confidence;
- evidence count;
- source trust;
- reviewed/unreviewed status;
- recommended buyer action.

A summary score may exist only if its calculation and limitations are documented.

### 10.4 Completeness model

Calculate transparent completeness indicators such as:

- identity coverage;
- timeline coverage;
- mileage coverage;
- source diversity;
- inspection recency;
- current-condition coverage;
- unresolved conflict count.

Do not represent missing data as a clean history.

### 10.5 Report access and sharing

Support policy-driven:

- free summary;
- authenticated detailed report;
- paid or entitled report if product strategy requires;
- expiring share link;
- PDF generation only if privacy-safe and traceable;
- report version and generated-at timestamp;
- revocation or correction notice.

### 10.6 Marketplace and SafePay integration

Integrate report indicators into listings and transaction decisions without allowing AI alone to block payment. Possible outputs:

- history report available;
- evidence completeness;
- unresolved high-severity issue;
- inspection recommended;
- seller response pending;
- SafePay/manual review recommendation.

### 10.7 Mobile and accessibility

The report must work on mobile, tablet, and desktop, with accessible timeline semantics, keyboard-operable galleries/comparisons, alt text, and non-colour-only status indicators.

### 10.8 Acceptance tests

- Public/private field boundaries are enforced.
- Report renders with partial data.
- Missing sources are explicitly shown.
- Timeline, mileage, findings, and visual comparisons are ordered correctly.
- Share links enforce expiry and authorization.
- Generated reports are versioned.
- Corrected findings update the current report while retaining audit history.

### Milestone 4 exit gate

A buyer can open a vehicle report, understand the vehicle’s known history, inspect supporting evidence, see uncertainties, and identify practical next actions.

---

# MILESTONE 5 — GOVERN, REVIEW, DISPUTE, AND CORRECT

## 11. Phase 10 — Evidence and Finding Adjudication

### 11.1 Goal

Create a defensible human-governance layer for evidence, AI findings, source conflicts, and seller disputes.

### 11.2 Roles and permissions

Define and enforce separate capabilities for:

- owner;
- dealer;
- mechanic/inspector;
- insurer;
- government reviewer;
- admin reviewer;
- bank/finance user;
- public buyer;
- source partner.

Do not rely on UI hiding alone.

### 11.3 Review queues

Provide queues for:

- evidence verification;
- vehicle identity ambiguity;
- AI analysis low confidence;
- temporal finding confirmation;
- disclosure conflict confirmation;
- source disagreement;
- seller dispute;
- correction request;
- privacy/removal request.

### 11.4 Decisions

Support:

- confirm;
- reject;
- amend;
- request more evidence;
- mark inconclusive;
- publish public-safe summary;
- unpublish;
- supersede;
- escalate.

### 11.5 Reviewer accountability

Store:

- reviewer identity and role;
- decision time;
- evidence viewed;
- notes;
- policy/rule version;
- before/after finding state;
- correlation ID;
- conflict of interest declaration where relevant.

### 11.6 Dispute and correction

Implement:

- dispute submission;
- supporting evidence upload;
- response deadline/status;
- independent reviewer assignment where required;
- corrected public report;
- notice of correction;
- immutable decision history;
- appeal/escalation path.

### 11.7 Trust-score separation

If findings influence trust, do so through explicit governed rules. Store the rule, evidence, approval, and resulting change. AI raw confidence must never directly become a trust score.

### 11.8 Acceptance tests

- Unauthorized roles cannot access queues or decisions.
- Every decision creates an audit event.
- A disputed finding is represented safely in public output.
- Superseded findings remain auditable.
- Reviewer notes follow privacy rules.
- Trust impacts require the governed workflow.

### Milestone 5 exit gate

No consequential vehicle-history claim can become or remain public without a traceable governance path appropriate to its severity and source.

---

# MILESTONE 6 — PRODUCTION INFRASTRUCTURE, VALIDATION, AND RELEASE READINESS

## 12. Phase 11 — Production Infrastructure Hardening

### 12.1 Goal

Make the system deployable, operable, recoverable, and protectable in production.

### 12.2 CI/CD

Implement or harden:

- pull-request validation;
- TypeScript/lint/build gates;
- backend unit/integration tests;
- migration validation;
- targeted and critical E2E tests;
- secret scanning;
- dependency/security scanning;
- artifact/version tracking;
- staging deployment;
- production approval gate;
- release tagging;
- rollback procedure;
- branch protection documentation.

No agent may enable automatic production merge/deploy without user approval.

### 12.3 Deployment architecture decision

Create an architecture decision record comparing and selecting the operating model for:

- frontend hosting;
- Express/API hosting;
- durable workers;
- queues;
- scheduled ingestion;
- AI jobs;
- storage delivery;
- Cloudflare proxy/WAF;
- DNS and TLS;
- regional needs;
- database connectivity.

Evaluate Fly.io, Cloudflare, Vercel, and other already-used services based on actual workload requirements. Do not select a platform solely because it is already configured.

### 12.4 Secrets management

- Rotate any previously exposed Supabase service-role key.
- Keep production secrets out of repository and logs.
- Separate dev/staging/production credentials.
- Apply least privilege.
- Define rotation schedules and owners.
- Audit access.
- Document emergency rotation.
- Ensure frontend bundles cannot receive service credentials.

### 12.5 Queue and worker durability

Use a production-capable queue/worker design for:

- evidence analysis;
- thumbnails/transforms;
- source ingestion;
- report generation;
- notifications;
- retries;
- dead-letter handling;
- idempotency;
- concurrency limits;
- job observability.

### 12.6 Distributed rate limiting and abuse protection

Replace or supplement in-memory limiting with a shared store suitable for multiple instances. Cover:

- global IP limits;
- authenticated user limits;
- organization/source limits;
- upload quotas;
- report-generation limits;
- AI-analysis budgets;
- auth abuse;
- webhook/provider abuse;
- expensive search endpoints.

### 12.7 WAF and DDoS controls

Define deployable Cloudflare or equivalent configuration for:

- managed WAF rules;
- bot and credential-stuffing controls;
- request body limits;
- suspicious upload patterns;
- country/anomaly policies where justified;
- API and admin route protection;
- rate-based rules;
- origin shielding;
- TLS settings;
- logging and review.

### 12.8 Backup and restoration

Document and implement:

- database backup frequency;
- point-in-time recovery capability;
- evidence storage backup/versioning strategy;
- configuration/IaC backup;
- encryption;
- retention;
- restore testing;
- independent copy where appropriate;
- evidence integrity verification after restore.

### 12.9 Disaster recovery

Define:

- RPO and RTO;
- incident severity levels;
- database restore runbook;
- storage restore runbook;
- region/provider outage response;
- compromised-key response;
- queue backlog recovery;
- AI provider outage behavior;
- communication responsibilities;
- recovery exercise schedule.

### 12.10 Observability

Instrument:

- API latency/error rate;
- evidence upload failures;
- ingestion lag;
- queue depth and age;
- AI success/failure/cost/latency;
- review queue age;
- report generation failures;
- source adapter health;
- rate-limit/WAF events;
- database/storage health;
- backup success;
- release health.

Define alerts and owner/runbook links.

---

## 13. Phase 12 — Production Validation and Controlled Launch

### 13.1 Test strategy

Build a layered test program:

- service/unit tests;
- database and RLS tests;
- provider contract tests;
- fixture-based ingestion tests;
- AI schema validation;
- temporal comparison tests;
- disclosure conflict tests;
- governance tests;
- public privacy tests;
- E2E buyer/admin/seller flows;
- load and abuse tests;
- backup restore test;
- disaster recovery tabletop/exercise.

### 13.2 Golden vehicle histories

Create consented or synthetic golden datasets representing:

1. Clean, well-documented vehicle.
2. Auction-damaged and repaired vehicle.
3. Mileage rollback conflict.
4. Reused listing images.
5. Ambiguous identity requiring review.
6. Private evidence that must not leak.
7. Seller dispute and correction.
8. Incomplete history with no false “clean” conclusion.

Expected findings must be versioned and reviewed.

### 13.3 AI quality gate

Document acceptable performance for each task. Do not use one overall accuracy number. At minimum report:

- OCR accuracy;
- duplicate/similarity precision and recall;
- component detection performance;
- damage detection false positives;
- temporal finding precision;
- disclosure conflict precision;
- confidence calibration;
- abstention/manual-review rate;
- latency and cost.

High-risk public findings require conservative thresholds and human confirmation.

### 13.4 Security validation

Complete:

- dependency and secret scan;
- auth/authorization review;
- RLS review;
- upload security review;
- signed URL review;
- public API privacy review;
- rate-limit test;
- WAF test;
- penetration-test plan or execution according to available resources;
- production-header and CORS verification.

### 13.5 Performance and resilience

Test:

- concurrent uploads;
- large evidence histories;
- gallery/report load time;
- queue backlog;
- provider timeout;
- source outage;
- storage failure;
- database transient errors;
- retry/idempotency behavior;
- graceful degraded report generation.

### 13.6 Staging pilot

Run a controlled staging pilot with a small set of consented/synthetic vehicles. Capture:

- data import;
- evidence review;
- AI analysis;
- temporal comparison;
- listing conflict;
- report generation;
- seller dispute;
- correction;
- buyer viewing;
- operational metrics.

### 13.7 Release gate

Production readiness requires a final report that includes:

- milestone-by-milestone completion;
- open risks;
- data-source status;
- test results;
- AI evaluation;
- security result;
- backup restore evidence;
- DR evidence;
- staging pilot evidence;
- deployment architecture;
- rollback plan;
- monitoring and ownership;
- explicit remaining external blockers.

Do not merge the final implementation PR or deploy production without explicit user authorization.

### Milestone 6 exit gate

The platform is considered ready for a controlled production launch only when it can be securely deployed, monitored, restored, and operated, and when the end-to-end vehicle-history product has passed the agreed quality, privacy, governance, and resilience gates.

---

## 14. Cross-Cutting Data Model

Claude must design the final schema based on the actual repository, but the domain must cover these concepts:

- `vehicles`
- `vehicle_identity_history`
- `vehicle_timeline_events`
- `vehicle_evidence`
- `evidence_assets`
- `evidence_sets`
- `evidence_sources`
- `evidence_provenance_events`
- `ingestion_jobs`
- `source_records`
- `listing_snapshots`
- `inspection_records`
- `mileage_observations`
- `ownership_transfer_records`
- `ai_analysis_jobs`
- `ai_observations`
- `temporal_findings`
- `disclosure_claims`
- `disclosure_conflicts`
- `review_tasks`
- `review_decisions`
- `disputes`
- `report_versions`
- `audit_events`

Avoid duplicating existing tables unnecessarily. Prefer migrations that extend or normalize the current architecture safely.

---

## 15. Cross-Cutting API Requirements

The final APIs must support, with strict authorization:

- taxonomy and source lookup;
- evidence upload/import;
- evidence-set management;
- provenance retrieval;
- timeline queries;
- review queues and decisions;
- ingestion job status;
- analysis job status;
- temporal findings;
- disclosure conflicts;
- disputes and corrections;
- report generation and access;
- public-safe vehicle history;
- admin/source operational health.

Requirements:

- typed request/response contracts;
- schema validation;
- pagination;
- deterministic ordering;
- correlation IDs;
- idempotency where needed;
- audit logging;
- public serialization allowlists;
- no raw provider output in public responses;
- stable error codes.

---

## 16. Cross-Cutting UX Requirements

### Buyer

- Understand known history quickly.
- See alerts without sensational language.
- Inspect supporting evidence.
- Understand missing data and uncertainty.
- Compare historical/current images.
- Know what next action to take.

### Seller/dealer

- Upload structured evidence.
- See analysis status.
- Correct listing claims.
- Respond to conflicts.
- Submit disputes/evidence.
- Understand public visibility.

### Reviewer

- See source/provenance.
- Compare evidence.
- Inspect AI reasoning and confidence.
- Confirm/amend/reject.
- Request more evidence.
- Maintain an audit trail.

### Source partner

- Monitor ingestion.
- Resolve failures.
- Review mapping/identity ambiguity.
- See source-specific metrics.

### Operations/admin

- Monitor queues, provider health, cost, backups, and incidents.

All critical flows must support mobile, tablet, desktop, keyboard navigation, and accessible status communication.

---

## 17. Multi-Agent Execution Model

Claude should create isolated worktrees and assign agents by bounded domain. Suggested teams:

1. **Architecture and audit agent** — current-state map, dependencies, migrations plan.
2. **Evidence domain agent** — taxonomy, metadata, timeline, UI.
3. **Provenance agent** — source registry, checksums, chain of custody.
4. **Ingestion agent** — provider framework, jobs, adapters, listing snapshots.
5. **AI provider agent** — OCR/vision/similarity contracts and evaluation.
6. **Temporal intelligence agent** — same-vehicle comparison and findings.
7. **Disclosure agent** — claim extraction/conflict workflow.
8. **Report UX agent** — buyer history report and visual comparisons.
9. **Governance agent** — review, dispute, correction, permissions.
10. **Infrastructure agent** — CI/CD, deployment ADR, queue, secrets, WAF, backups, DR.
11. **Test/security agent** — golden datasets, E2E, RLS/privacy, load, recovery.
12. **Integration lead** — sequencing, conflict resolution, PR evidence.

Each agent must declare:

- worktree/branch;
- milestone and task;
- expected files;
- dependencies;
- tests;
- stop conditions.

Agents must not edit the same files concurrently without explicit coordination.

---

## 18. Branch, Commit, and PR Strategy

Do not build all milestones in one branch. Recommended sequence:

1. Milestone 1 PR — taxonomy and provenance.
2. Milestone 2 PR — ingestion framework and sandbox adapter.
3. Milestone 3A PR — live AI provider/job/evaluation foundation.
4. Milestone 3B PR — temporal comparison.
5. Milestone 3C PR — disclosure conflict engine.
6. Milestone 4 PR — vehicle history report.
7. Milestone 5 PR — governance/dispute/correction.
8. Milestone 6A PR — infrastructure/IaC/CI/queue/security.
9. Milestone 6B PR — validation, pilot fixtures, release evidence.

Where dependencies require stacking, clearly identify base branches and rebase/retarget after predecessor merge. Every PR must include:

- exact scope;
- migrations;
- changed files;
- test results;
- screenshots/demo evidence;
- security/privacy impact;
- rollout/rollback notes;
- remaining blockers.

Stop before each merge unless the user explicitly authorizes it. Claude may continue preparing downstream branches/worktrees, but must not merge automatically.

---

## 19. Test and Verification Commands

Claude must discover the repository’s canonical commands and update this section in implementation PRs. At minimum, use the applicable equivalents of:

```bash
npx tsc --noEmit --project web/tsconfig.app.json
npm run build
node backend/tests/run-tests.js
git diff --check
```

Run targeted Playwright suites for:

- upload/review/public privacy;
- life-stage timeline;
- provenance;
- ingestion;
- temporal comparison;
- disclosure conflict;
- buyer report;
- dispute/correction;
- mobile/tablet/desktop navigation and accessibility.

Never run destructive tests against production Supabase. Use isolated test/staging data and credentials.

---

## 20. Documentation Deliverables

Keep the following repository documents current:

- architecture overview;
- evidence taxonomy;
- source/provider onboarding;
- AI model and evaluation card;
- temporal finding policy;
- disclosure conflict policy;
- reviewer handbook;
- privacy/data-retention policy mapping;
- deployment architecture decision record;
- secrets rotation runbook;
- backup and restore runbook;
- disaster recovery runbook;
- incident response guide;
- release checklist;
- API contracts;
- database migration notes.

Documentation must distinguish live, sandbox, planned, and externally blocked capabilities.

---

## 21. Definition of Done

The entire Milestone 1–6 program is complete only when all applicable items below are satisfied or explicitly recorded as external blockers that cannot be solved without credentials, legal agreements, or user authorization.

### Milestone 1

- [ ] Eight life-stage evidence classes implemented.
- [ ] Subtypes and validation implemented.
- [ ] Legacy evidence migrated/compatible.
- [ ] Evidence sets supported.
- [ ] Source registry implemented.
- [ ] Provenance fields implemented.
- [ ] Cryptographic checksum implemented.
- [ ] Perceptual hash abstraction implemented.
- [ ] Immutable chain-of-custody events implemented.
- [ ] Timeline UI shows stage, date, source, and verification.
- [ ] Public/private serialization tests pass.

### Milestone 2

- [ ] Provider interface implemented.
- [ ] Durable ingestion job states implemented.
- [ ] Idempotency/retry/quarantine implemented.
- [ ] Vehicle identity resolution workflow implemented.
- [ ] Listing snapshots implemented.
- [ ] At least one sandbox/authorized adapter works end to end.
- [ ] Imported evidence has full provenance.
- [ ] Partner onboarding documentation exists.

### Milestone 3

- [ ] Live-provider contract implemented.
- [ ] Mock/test provider retained.
- [ ] OCR tasks implemented and evaluated.
- [ ] Viewpoint/component/damage schemas implemented.
- [ ] Near-duplicate/similarity implemented.
- [ ] Durable analysis jobs implemented.
- [ ] Temporal evidence grouping implemented.
- [ ] Same-vehicle confidence implemented.
- [ ] Component change findings implemented.
- [ ] Before/after review UI implemented.
- [ ] Listing claim extraction implemented.
- [ ] Disclosure conflict workflow implemented.
- [ ] Seller response/correction implemented.
- [ ] Public findings remain governed and safe.

### Milestone 4

- [ ] Full buyer vehicle-history report implemented.
- [ ] Timeline, alerts, mileage, ownership, listing, comparison sections work.
- [ ] Completeness and limitations are explicit.
- [ ] Evidence/source index exists.
- [ ] Mobile/tablet/desktop report passes QA.
- [ ] Accessible interactions pass.
- [ ] Share/version/correction behavior implemented.

### Milestone 5

- [ ] Role permissions enforced server-side.
- [ ] Review queues implemented.
- [ ] Confirm/reject/amend/inconclusive/escalate supported.
- [ ] Dispute and correction flows implemented.
- [ ] Reviewer decisions audited.
- [ ] Trust changes require governed rules.
- [ ] Public disputed/superseded states are safe.

### Milestone 6

- [ ] CI/CD gates implemented.
- [ ] Deployment ADR completed.
- [ ] Durable queue/worker architecture implemented.
- [ ] Secrets rotated and managed.
- [ ] Distributed rate limiting implemented.
- [ ] WAF/DDoS configuration documented/deployable.
- [ ] Backups configured/documented.
- [ ] Restore test completed.
- [ ] DR plan and exercise completed.
- [ ] Observability and alerts implemented.
- [ ] Golden datasets pass.
- [ ] AI quality report completed.
- [ ] Security/privacy tests pass.
- [ ] Performance/resilience tests pass.
- [ ] Controlled staging pilot completed.
- [ ] Release/rollback report completed.
- [ ] Final production merge/deploy awaits explicit user authorization.

---

## 22. `/loop` Operating Contract

Claude must continue the program until the Definition of Done is met or the remaining work is blocked by a genuine external dependency.

For every failed requirement:

1. Identify the exact root cause.
2. Assign the narrowest suitable agent.
3. Implement the smallest correct change.
4. Run targeted tests.
5. Run affected regressions.
6. Update documentation and PR evidence.
7. Re-evaluate the milestone gate.

Claude must not stop merely because:

- a plan was written;
- a branch was created;
- a PR was opened;
- code compiled once;
- mock behavior worked;
- UI rendered with fixture data;
- an external integration was represented by an unverified claim.

Claude may stop only when:

- all feasible Milestone 1–6 work and evidence are complete and only merge/deployment authorization remains; or
- an external credential, legal agreement, infrastructure purchase, unavailable API, or explicit user decision genuinely prevents further progress.

For every blocker, provide:

- exact blocked requirement;
- work already completed;
- evidence;
- missing external input;
- secure next action;
- whether other milestones can continue independently.

---

## 23. Final Program Report Required from Claude

At the end of the loop, produce a repository- and code-derived report containing:

1. Executive outcome.
2. Current architecture.
3. Milestone 1–6 status.
4. PR and commit list.
5. Migration list.
6. Changed-system inventory.
7. Data-source status: live, sandbox, planned, blocked.
8. AI provider/model/evaluation results.
9. Privacy and governance results.
10. Test matrix and results.
11. Staging pilot evidence.
12. Infrastructure and deployment status.
13. Backup/restore and DR evidence.
14. Known risks and residual limitations.
15. External blockers.
16. Rollback plan.
17. Final recommendation.
18. Exact statement that no PR was merged and no production deployment occurred without explicit authorization.

The final recommendation must be one of:

- `READY FOR EXPLICIT MERGE AND CONTROLLED PRODUCTION PILOT`
- `READY FOR MERGE, NOT READY FOR PRODUCTION`
- `NOT READY — BLOCKERS REMAIN`

It must not overstate completion.
