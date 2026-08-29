# CarUp Service Network Foundation 1.0 — Canonical Plan

**Status:** CANONICAL PLANNING SPECIFICATION — IMPLEMENTATION NOT YET AUTHORIZED  
**Programme:** CarUp Service Network  
**Target implementation lane:** one future feature branch, one PR, sequential phases  
**Planning branch:** `docs/service-network-foundation-1-0-plan`  
**Planning baseline:** `main@ba208963d863654157335189c60f587cbe330041`  
**Planning-time integrated candidate:** PR #194, observed at `ef13a1893935e320e91746275a0170566f025ab6` on 2026-08-29  
**Implementation base rule:** the implementation branch MUST be created from the exact canonical `main` commit produced after PR #194 (or its approved successor) is merged and reconciled. The planning-time PR head above is informative only and MUST NOT be treated as the implementation base.

---

# 0. Purpose of this document

This document is the canonical product, architecture, implementation, testing and operational reference for **CarUp Service Network Foundation 1.0**.

It exists to prevent the Service Network from becoming:

- a second vehicle-history system;
- a second messaging system;
- a second Trust engine;
- a second analytics ledger;
- a disconnected garage booking feature;
- a workshop ERP that overwhelms the current product;
- another parallel branch that later requires project reunification.

Every development agent working on Service Network Foundation 1.0 MUST read this document before changing source.

When implementation details are ambiguous, agents MUST resolve ambiguity in this order:

1. live canonical repository truth on the exact implementation base;
2. existing CarUp authority contracts referenced here;
3. this Service Network canonical plan;
4. the narrowest additive implementation that preserves those authorities;
5. explicit owner intervention only where the decision cannot be truthfully or safely inferred.

Agents MUST NOT silently redefine the product to make implementation easier.

---

# 1. Canonical product statement

**CarUp Service Network Foundation 1.0 connects a vehicle owner, a governed garage organization and the human mechanic(s) performing work through one canonical vehicle identity, one durable service case, one canonical conversation, governed service/parts/evidence records and the existing Vehicle Passport, Truth/Trust and Intelligence contracts.**

The product promise is:

> **Know the vehicle. Know the garage. Know the mechanic. Know what was recorded. Know what evidence exists. Keep that history with the vehicle without turning garage activity into invented Trust.**

The Foundation is not primarily a garage-booking product and not primarily workshop-management software.

Its purpose is to make the servicing lifecycle a trustworthy producer of vehicle history.

---

# 2. Long-term vision versus Foundation 1.0

## 2.1 Long-term Service Network vision

The long-term product may eventually include:

- garage discovery;
- garage publication and verification;
- service requests;
- appointments and availability;
- vehicle check-in/check-out;
- custody evidence;
- digital vehicle inspection;
- diagnosis;
- estimates;
- immutable approval/change-order history;
- task-level mechanic attribution;
- parts inventory and supplier integrations;
- PartSentry provenance;
- service evidence;
- completion and quality checks;
- warranty/comeback workflows;
- reviews;
- diaspora service sponsorship;
- scoped sharing;
- QR/NFC/deep-link physical-world workflows;
- offline workflows;
- service payments;
- OEM/service-data integrations;
- diagnostic-device integrations;
- predictive maintenance.

This is the **vision**, not the Foundation 1.0 scope.

## 2.2 Foundation 1.0 scope

Foundation 1.0 MUST close this exact lifecycle:

```text
Owner / requester
    ↓
canonical Vehicle / VIN
    ↓
governed Garage
    ↓
service request / Service Case
    ↓
canonical Communications thread
    ↓
garage acceptance / decline
    ↓
work order
    ↓
mechanic assignment
    ↓
mileage / work / PartSentry / evidence
    ↓
completion / cancellation
    ↓
Vehicle Passport service projection
    ↓
Owner Service History / My Garage
    ↓
governed Intelligence
```

Foundation 1.0 MUST also provide the minimal **Service Link** layer needed to connect people and resources quickly:

- Vehicle QR/deep link;
- Service Case QR/deep link;
- Mechanic/practitioner QR/deep link;
- authenticated actor/tenant resolution;
- safe action routing;
- source-channel attribution including QR.

## 2.3 Explicitly deferred from Foundation 1.0

Unless live reconciliation proves an item already exists and only needs trivial convergence, these are deferred to later Service Network releases:

- full appointment calendar and bay-capacity optimization;
- full digital vehicle inspection product;
- check-in/check-out custody workflow;
- estimate versioning and owner financial authorization;
- change orders;
- granular repair task timers;
- warranty/comeback workflow;
- transaction-backed public ratings/reviews;
- generic arbitrary data-sharing centre;
- diaspora sponsor spending approvals;
- NFC;
- offline-first workshop operation;
- service payments/escrow;
- supplier ERP;
- payroll/HR;
- garage accounting;
- full parts inventory ERP;
- telematics;
- diagnostic-device ingestion;
- OEM maintenance feeds;
- predictive maintenance.

Agents MUST NOT expand Foundation 1.0 into these areas merely because a schema seam makes them possible.

---

# 3. Current-state truth to preserve

The implementation begins from a mature CarUp foundation, not a blank slate.

At planning time the repository already contains:

- canonical VIN/vehicle identity;
- Vehicle Passport lifecycle contracts;
- Truth/Trust governance;
- evidence/provenance;
- work-order routes;
- mechanic role;
- garage tenant/organization semantics;
- owner My Garage;
- owner Service History;
- mechanic dashboard;
- Service Logs;
- PartSentry;
- garage/mechanic Intelligence;
- marketplace inquiry infrastructure;
- `garage_service_request` inquiry vocabulary;
- `qr` marketplace source channel;
- canonical Communications 2.0;
- internal/in-app messages;
- Email contracts;
- WhatsApp contracts;
- push channel contract;
- notification queue/fallback policy;
- event/outbox infrastructure.

Important current facts that MUST be reconciled rather than copied blindly:

1. `GarageDirectory.tsx` intentionally shows no garages because no governed garage publication authority currently backs it.
2. `mechanic_work_orders` currently has a primitive lifecycle and the API accepts only `In Progress`, `Completed`, `Cancelled`.
3. Current work-order creation stamps the current caller as `mechanic_id`; intake and execution are therefore conflated.
4. Service History currently contains truth debt including hard-coded “Next Service — 500 km”, generic “Garage”, and absent cost rendered as zero.
5. I9 Intelligence correctly separates mechanic-person from garage-tenant scope and refuses to invent unsupported metrics.
6. I9 planning text and current work-order cancellation capability must be reconciled because the older not-measurable description says cancellation is absent while the current work-order route supports `Cancelled`.
7. Passport V8 already projects work-order and PartSentry records and MUST remain the Passport service projection authority.
8. PartSentry currently records mechanic/tenant provenance and currently has a path that can update `vehicles.mileage`; S0 MUST determine whether that mutation remains correct under the canonical mileage fact contract.
9. Marketplace already recognizes `garage_service_request`, but current inquiry routing does not by itself prove a governed target-garage relationship. Do not overload seller semantics to fake one.
10. Communications already owns canonical conversation/channel delivery. No “service messages” silo may be created.

---

# 4. Permanent architecture invariants

These invariants apply to every phase.

## Invariant 1 — one physical vehicle, one canonical vehicle identity

Service Network MUST reference the existing canonical vehicle/VIN.

A garage MUST NOT create a second vehicle identity because it has its own customer record.

Unknown vehicles follow the existing governed vehicle/identity rules; they are not silently duplicated.

## Invariant 2 — Service Case orchestrates; it does not replace authorities

A Service Case connects the lifecycle.

It does NOT become:

- the vehicle record;
- the evidence ledger;
- the PartSentry ledger;
- the conversation ledger;
- the Trust decision;
- the Passport timeline table;
- the Intelligence ledger.

## Invariant 3 — garage and mechanic remain different principals

```text
mechanic = human practitioner
garage   = tenant / organization
```

Do not create a global `garage` user role.

Garage authority comes from verified tenant/organization membership. Mechanic authority remains person-scoped.

## Invariant 4 — Service activity is not Trust

```text
garage statement ≠ verified fact
mechanic activity ≠ Trust
service completed ≠ trusted vehicle
PartSentry record ≠ automatic Trust increase
```

Trust can change only through the canonical Trust authority and explicit governed Trust inputs.

## Invariant 5 — provenance before confidence

Every important service fact should be attributable where possible to:

- vehicle;
- source record;
- actor;
- tenant;
- branch when known;
- time;
- authority class;
- evidence IDs where applicable.

Missing provenance is represented as missing/unknown, never filled with convenient defaults.

## Invariant 6 — Communications remains canonical

Service Network may create conversations, participants and domain events, but MUST use the existing Communications authority for:

- messages;
- internal chat;
- Email;
- WhatsApp;
- push;
- SMS;
- channel preferences;
- fallback;
- delivery status;
- reply handling;
- attachments;
- participant authorization.

## Invariant 7 — Intelligence observes; it never becomes business truth

Intelligence may derive metrics only from authoritative service facts.

It MUST NOT write service status, ownership, garage verification, mechanic assignment, Passport facts or Trust.

## Invariant 8 — Marketplace owns acquisition/discovery intent

Marketplace/inquiry infrastructure owns service lead/source attribution where the journey began there.

Service Network owns the operational lifecycle after a service case exists.

## Invariant 9 — Passport projects history; source records remain authoritative

Service completion must converge into the existing Passport service/parts projection.

Do not create a new “service timeline” authority merely for UI convenience.

## Invariant 10 — unknown is not zero

Examples:

- no cost recorded → “Cost not recorded”, not $0;
- no garage identity → “Provider not recorded”, not “Garage”;
- no governed maintenance interval → “Next service not available”, not “500 km”;
- no service records → “No service records available to CarUp”, not “Never serviced”;
- failed notification read → unavailable, not zero notifications.

## Invariant 11 — QR is context, not authority

A scan may identify a resource and an intended action.

A scan alone MUST NOT authorize a protected write.

The authorization chain remains:

```text
Scan / link
   ↓
Resolve resource
   ↓
Authenticate user
   ↓
Resolve tenant/membership
   ↓
Check capability
   ↓
Perform action
   ↓
Record provenance
```

## Invariant 12 — no destructive historical editing

Important service facts that become historical evidence must not be silently rewritten.

Correction uses dispute/supersession/correction semantics or existing canonical audit mechanisms.

## Invariant 13 — production remains separately owner-gated

Implementation, migration files, staging certification and merge readiness do not imply permission to:

- apply protected production migrations;
- enable production providers;
- seed production;
- create fake public garages;
- activate payment flows;
- weaken RLS;
- bypass environment protection.

---

# 5. Authority ownership matrix

Agents MUST use this matrix before adding any field, API or event.

| Question | Canonical authority |
|---|---|
| What vehicle is this? | Core vehicle / canonical VIN |
| Who owns the vehicle? | Ownership authority |
| Who is current seller? | Seller/Marketplace authority |
| Where did the service lead originate? | Marketplace inquiry / source attribution |
| Which garage is targeted? | Service Case + governed garage organization |
| Which garage accepted the job? | Service Case |
| Which branch is involved? | Governed organization branch reference |
| Who may act for the garage? | Auth + tenant membership |
| Which mechanic performed/was assigned? | Work-order assignment authority |
| What work-order state exists? | Existing work-order domain, evolved additively |
| What was said between parties? | Communications |
| Was Email/WhatsApp/push sent? | Communications delivery authority |
| What evidence exists? | Evidence authority |
| What part was recorded/fitted? | PartSentry/service source record |
| What mileage was observed during service? | Service/PartSentry observation + canonical fact resolution policy |
| What appears in history? | Passport projection |
| Is a fact verified/trusted? | Canonical Truth/Trust authority |
| What can be measured? | Intelligence projection over authoritative facts |
| What did a QR identify? | Service Link resolution |
| What did the user have permission to do? | Auth/tenant/capability authority |
| Which device/session initiated a write? | Existing session/device context where governed; otherwise unknown |

If a proposed implementation gives two authorities the same responsibility, stop and reconcile before continuing.

---

# 6. Canonical domain model

The exact SQL is not frozen here; S0 must reconcile existing tables first. The contracts below are frozen.

## 6.1 Service Case

A Service Case is the durable orchestration record for one service engagement.

Minimum conceptual fields:

```text
id
vin
requester_user_id              nullable only where guest/unclaimed flow is genuinely supported
garage_tenant_id
branch_id                      nullable when branch is not known
source_inquiry_id              nullable
conversation_thread_id         nullable until conversation is successfully bound
status
service_category               structured, nullable if not captured
request_summary                private/controlled free text
requested_at
accepted_at                    nullable
declined_at                    nullable
started_at                     nullable
completed_at                   nullable
cancelled_at                   nullable
created_by_user_id
created_at
updated_at
```

The implementation MAY normalize names differently if existing schema conventions require it.

It MUST preserve the semantic fields above.

## 6.2 Service Case status

Foundation 1.0 should keep the case state compact.

Recommended states:

```text
requested
accepted
active
completed
declined
cancelled
```

Do not create a 20-state Service Case to model every workshop detail.

Work-order execution state belongs to work orders.

## 6.3 Existing mechanic work orders

Do not create a second work-order table.

The existing `mechanic_work_orders` authority should be evolved additively.

Foundation requirements include reconciliation for:

- `service_case_id`;
- `branch_id` where a governed branch exists;
- structured `service_category` if adopted;
- `completed_at`;
- `cancelled_at`;
- cancellation reason code/text policy;
- explicit work-order lifecycle needed for Foundation 1.0;
- compatibility with legacy rows;
- existing tenant scoping.

The exact state vocabulary must be frozen in S2/S3 after live schema reconciliation.

Foundation does NOT need the entire later appointment/DVI state machine.

## 6.4 Mechanic assignment

Current “creator equals mechanic” behavior must be removed as the final authority.

Use a durable assignment model capable of recording at minimum:

```text
work_order_id
mechanic_id
garage_tenant_id
assigned_by_user_id
assigned_at
unassigned_at / ended_at
assignment_role              optional
is_primary                   optional
```

A separate assignment table is preferred if existing schema cannot retain history safely.

The implementation may keep a compatibility `mechanic_id` projection on work orders if required, but assignment history must be authoritative and old rows must remain readable.

## 6.5 Garage identity and publication

Garage remains an organization/tenant.

Foundation 1.0 needs a governed public projection with, where supported:

- organization identity;
- public display name;
- publication state;
- verification/onboarding state;
- location;
- branch(es);
- contact policy;
- service categories/capabilities;
- public-safe media;
- public-safe verification dimensions;
- PartSentry participation where factual.

Do not publish:

- invented ratings;
- invented opening hours;
- fake phone numbers;
- fake “verified” status;
- internal tenant IDs;
- private staff information.

Prefer evolving existing organization/branch models over creating a duplicate `garages` universe.

## 6.6 Service provenance vocabulary

Foundation should reuse existing Passport authority vocabulary where possible and normalize service source strength.

At minimum distinguish:

- `owner_declared`;
- `garage_stated`;
- `mechanic_attributed`;
- `professional_governed`;
- `evidence_backed`;
- `partner_record`;
- `unknown`.

Do not introduce “verified repair” unless an explicit verification workflow establishes what was verified.

## 6.7 Actor Context

Service writes must be able to answer, where the existing platform can govern the value:

```text
actor_user_id
platform/base role
tenant_id
branch_id
membership/capability
session or governed device registration
source_channel
correlation/request id
server timestamp
```

Do not fingerprint users/devices covertly merely to populate this model.

If the platform has no governed device identity, record device context as unavailable/absent rather than fabricating one.

## 6.8 Service Link

Service Link is a resource-link protocol, not a QR-only subsystem.

Foundation resource types:

- vehicle;
- service case;
- mechanic/practitioner.

Supported transports initially:

- QR;
- normal deep link.

Future transports such as NFC reuse the same resolver.

Permanent resource links must not contain private payloads.

Temporary capability/share links, if required by the Foundation flow, must be:

- opaque;
- purpose-scoped;
- short-lived;
- revocable;
- server-validated;
- stored hashed where a bearer secret is involved;
- write-protected by authentication for sensitive actions;
- auditable.

Before creating a new token service, S0 MUST inspect and prefer the existing auth/action-token infrastructure when it can satisfy the contract safely.

---

# 7. Service lifecycle state machine

Foundation 1.0 must support the following Golden lifecycle.

## 7.1 Request

Source may be:

- Garage Directory;
- Vehicle Passport / My Garage;
- Marketplace service inquiry;
- QR;
- operator-assisted flow;
- mobile.

A request creates or bridges to one durable Service Case.

Do not create duplicate Service Cases through retry.

## 7.2 Acceptance / decline

A governed member of the target garage tenant may accept or decline according to authorization policy.

Acceptance records:

- accepting actor;
- garage tenant;
- branch if known;
- server timestamp.

Decline records reason using a safe structured reason where possible.

## 7.3 Work order

Acceptance or a deliberate garage intake action creates/links the existing work-order record.

The relation between Service Case and work order must be explicit and idempotent.

## 7.4 Assignment

A work order may begin unassigned.

A governed garage actor assigns the mechanic.

Assignment must be attributable and tenant-safe.

## 7.5 Work/service record

Foundation allows recording:

- issue/summary where appropriate;
- structured service category where supported;
- mileage observation;
- work performed;
- total cost/currency when actually recorded;
- PartSentry part records;
- evidence references;
- status.

Free-text private diagnosis/customer content must not leak into public Passport projections.

## 7.6 Completion

Completion must have an authoritative server timestamp.

A completed work order and Service Case must remain historical.

Completion triggers downstream consumers; it must not directly mutate Trust.

## 7.7 Cancellation

Cancellation is a real state, not deletion.

Record timestamp and reason where governed.

Cancelled cases/orders must remain available for authorized audit and truthful Intelligence.

---

# 8. Service Event Contract

Every important lifecycle transition must emit a durable domain event through the existing event/outbox architecture.

Events MUST be emitted only after/with authoritative state mutation, preferably transactionally.

Foundation event namespace:

```text
service.case.requested
service.case.accepted
service.case.declined
service.case.cancelled

service.work_order.created
service.mechanic.assigned
service.mechanic.unassigned

service.mileage.observed
service.part.recorded
service.evidence.attached

service.work.started
service.work.completed
service.work.cancelled

service.case.completed
```

Exact names may be adjusted to existing event naming conventions during S0, but there must be one canonical namespace and no duplicate synonyms.

Each event should carry only the minimum identifiers needed by consumers:

```text
event id
event type
service_case_id
vin
garage_tenant_id where appropriate
work_order_id where appropriate
actor_user_id where appropriate
occurred_at
safe reason/status metadata
```

Do NOT place:

- raw private documents;
- private customer free text;
- secret tokens;
- provider credentials;
- unnecessary PII

inside broadly consumed domain-event payloads.

Events are notification/observation triggers, not substitutes for business records.

---

# 9. Core/Auth/Tenant contract

## 9.1 No new garage login universe

Reuse current authentication.

Garage access comes from tenant/organization membership.

## 9.2 No global garage role

Preserve:

```text
mechanic = person
garage = organization/tenant
```

If later staff capability distinctions are needed, use organization membership/capability semantics rather than a new platform-wide principal unless canonical architecture explicitly changes.

## 9.3 Tenant isolation

Every garage read/write MUST resolve tenant scope from verified actor context.

Never trust:

- request-body tenant ID;
- query-string tenant ID;
- QR tenant ID

as authorization.

A cross-tenant resource should generally be indistinguishable from missing unless a public projection explicitly permits access.

## 9.4 Branch scope

Branch is a business attribution field, not an authorization bypass.

A user may act at a branch only when the organization/membership contract permits it.

---

# 10. Marketplace integration contract

Marketplace already recognizes `garage_service_request` and source channel `qr`.

Foundation MUST reuse those vocabularies where appropriate.

## 10.1 Ownership boundary

Marketplace/inquiry authority owns:

- acquisition source;
- inquiry ID;
- source channel;
- referral/campaign attribution.

Service Network owns:

- selected/target garage;
- accepted/declined state;
- work lifecycle.

## 10.2 Target-garage routing

Do not overload `current_seller_id` or seller ownership semantics to route service work.

S0 must inspect the inquiry schema and choose the smallest truthful additive bridge, for example a generic target/provider tenant reference if existing schema has no correct field.

The final schema must make this question unambiguous:

> Which garage tenant was this service request directed to?

## 10.3 Idempotent bridge

A marketplace inquiry must not create multiple Service Cases under retry.

Persist a durable linkage.

---

# 11. Vehicle Passport integration contract

Passport V8 remains the service/parts projection authority.

Foundation must extend source records so Passport can project richer truthful history without becoming a writer of service truth.

## 11.1 Public/buyer privacy

Continue whitelist-based projection.

Never expose through public/buyer Passport:

- customer name;
- customer ID;
- tenant-internal identifiers;
- private issue/diagnosis free text;
- private conversation;
- private cost;
- unpublished evidence;
- previous-owner PII.

## 11.2 Owner projection

Owner may see richer service context according to existing Passport audience policy.

## 11.3 Historical continuity

A legal ownership transfer must not delete service history.

Previous-owner personal data must remain protected.

## 11.4 Sparse data

Service coverage remains partial/unknown when incomplete.

No record must not become “never serviced.”

---

# 12. Evidence integration contract

Service Network attaches evidence by reference to the canonical evidence system.

It does not build a service-media evidence silo.

Potential evidence classes include, subject to existing taxonomy:

- odometer photograph;
- invoice/document;
- repair photograph;
- installed part photograph;
- inspection evidence;
- receipt;
- service provider document.

If the evidence taxonomy lacks a necessary class, extend it through the existing taxonomy governance rather than inventing untyped JSON labels.

Evidence verification status must retain its existing meaning.

A verified upload may prove what the artifact is; it does not automatically prove every claim contained in it.

---

# 13. PartSentry integration contract

PartSentry remains the parts/service provenance authority.

Foundation must connect:

```text
Service Case
   ↓
work order
   ↓
part record
   ↓
PartSentry
   ↓
Passport projection
```

Minimum linkage should permit attribution to:

- VIN;
- work order;
- Service Case where appropriate;
- mechanic;
- garage tenant;
- mileage observation;
- evidence.

## 13.1 Mileage authority review

S0 MUST inspect the current PartSentry behavior that can update `vehicles.mileage`.

The implementation must answer:

> Is a mechanic-entered service odometer a canonical mileage fact, a source observation that feeds the fact resolver, or both under an explicit rule?

Do not retain a direct vehicle mileage mutation merely because it already exists.

Do not remove it casually either; reconcile it against the canonical fact/provenance contract and tests.

---

# 14. Truth and Trust contract

Service Network is a new producer of claims, not a new Trust engine.

## 14.1 Claim states

Use existing canonical fact/provenance vocabulary.

Examples:

- garage stated;
- mechanic attributed;
- evidence backed;
- CarUp reviewed;
- source connected;
- unknown;
- unavailable;
- disputed;
- superseded.

## 14.2 Trust update rule

No Service Network route may directly set:

- Trust Score;
- Trust level;
- verified badges;
- canonical Trust cache

unless it invokes the existing canonical Trust workflow under an already-approved Trust input contract.

## 14.3 Public wording

Avoid:

- “Verified repair”;
- “Certified mechanic”;
- “Trusted garage”

unless the exact scope of verification is governed and shown.

Prefer dimensional wording:

- “Garage identity verified”;
- “Mechanic affiliation confirmed”;
- “Evidence attached”;
- “PartSentry record present”;
- “Garage-recorded service”.

---

# 15. Communications integration contract

Service Network MUST use canonical Communications.

## 15.1 Business workflow

Add/normalize a service workflow such as:

```text
business_workflow = service
```

using the existing thread model.

Do not add another messages table.

## 15.2 Participants

At minimum, the canonical service conversation should support explicit participants for:

- owner/requester;
- accepting/assigned garage user(s);
- mechanic(s) where permitted;
- admin/governance only where authorized.

Tenant membership alone must not silently expose every private conversation to every employee if existing Communications requires explicit participants.

## 15.3 Channels

Existing Communications remains authority for:

- in-app/internal messaging;
- Email;
- WhatsApp;
- push;
- SMS;
- fallback;
- consent/preferences;
- provider delivery;
- inbound replies.

Provider activation is not inferred from schema support.

## 15.4 Service notification events

Foundation should map appropriate canonical service events to transactional notifications, including:

- request received/accepted/declined;
- mechanic assigned where owner-facing value exists;
- work completed;
- Service Case completed/cancelled;
- important evidence/part update only where it is genuinely useful.

Avoid noisy notifications for every internal write.

## 15.5 Failure semantics

Communications failure MUST NOT erase or roll back an otherwise authoritative Service Case unless the specific user action contract says the journey is incomplete without a canonical conversation.

Where a conversation binding is required, return a recoverable error/receipt rather than pretending success.

Provider failure cannot erase canonical CarUp communication state.

---

# 16. Email contract

Email remains a Communications transport.

Service Network MUST reuse:

- canonical recipient resolution;
- Email classification;
- approved template/version system;
- canonical links;
- suppression rules;
- transactional/security distinctions;
- Reply-To/canonical conversation behavior.

Service emails MUST NOT become raw database-message dumps.

Any new service template must comply with the canonical Email Experience plan already in the repository.

---

# 17. WhatsApp contract

WhatsApp remains a Communications transport.

Service Network MUST reuse:

- channel identities/bindings;
- transactional consent;
- customer-service-window handling;
- approved provider templates when outside session window;
- canonical inbound conversation resolution.

Do not create “send WhatsApp directly from service route” shortcuts.

---

# 18. Push and in-app notifications

Service Network may emit canonical notification intents.

Do not claim production push success unless:

- recipient token/address exists through governed routing;
- provider/runtime is active;
- delivery evidence exists.

Owner Notification Bell semantics must preserve:

- unavailable ≠ zero;
- canonical thread link;
- dedupe.

---

# 19. Intelligence contract

Intelligence reads Service Network facts; it does not invent them.

Foundation should make new metrics measurable only when authoritative fields exist.

## 19.1 Potentially measurable after Foundation

Subject to minimum sample/privacy rules:

- service requests;
- accepted requests;
- declined requests;
- work orders;
- completed work orders;
- cancelled work orders;
- request-to-accept elapsed time;
- accept/start-to-completion elapsed time where timestamps are authoritative;
- repeat customers;
- service-category demand if structured category exists;
- demand by vehicle make/model through canonical VIN join;
- contributing mechanics;
- branch activity where branch attribution exists;
- response time from Communications authority;
- service records/PartSentry records logged.

## 19.2 Still not measurable unless later scope adds facts

- bay capacity/utilisation;
- appointment no-show rate;
- staffing utilization;
- task-level technician productivity;
- estimate approval rate;
- estimate-to-invoice variance;
- comeback/warranty rate;
- customer rating;
- first-time-fix rate.

Do not infer these.

## 19.3 I9 reconciliation

S0 must update the I9 “not measurable” registry to match the final Foundation schema.

A metric should move from “not measurable” to measurable only when its numerator, denominator, timestamp and scope have governed sources.

---

# 20. Service Link / QR contract

The interaction principle is:

> **Scan → Resolve → Authenticate → Authorize → Act → Record**

## 20.1 Vehicle QR

May open a role-safe Vehicle/Passport context and service actions.

Must not expose private owner data in the QR payload.

## 20.2 Service Case QR

May open the current Service Case for authorized participants.

Unauthenticated users receive only a safe authentication/claim path.

## 20.3 Mechanic QR

May expose a governed public practitioner projection and allow authorized workflow selection.

It must distinguish:

- identity;
- current garage affiliation;
- evidence/credential review state;
- activity facts.

Activity is not quality.

## 20.4 Source attribution

Where an action begins from QR, retain `source_channel = qr` through the appropriate inquiry/service event attribution.

## 20.5 Device/current-user context

The scanner device never becomes authority.

The write must bind to the authenticated current user and verified tenant membership.

Where a governed device/session identifier exists, retain it for audit. Otherwise record no device identity.

---

# 21. Minimal scoped sharing / capability rule

Foundation 1.0 does not require a generic sharing centre.

However, if an owner must temporarily grant a garage access to vehicle/service context, implement the narrowest case-scoped capability using existing token/capability infrastructure.

Required properties:

- explicit owner/resource authority;
- minimum data scope;
- purpose;
- expiry;
- revocation;
- recipient authentication for protected writes;
- audit;
- no ownership/seller mutation;
- no hidden access to insurance/finance/private documents.

A QR or WhatsApp link transports the invitation; it is not the authority itself.

---

# 22. UI/UX product map

Foundation should propagate the current CarUp/Marketplace visual language rather than invent a new workshop design system.

## 22.1 Public surfaces

### Garage Directory
Must show only governed published garages.

Minimum card/profile:

- real display name;
- location;
- governed service capability labels;
- verification dimensions;
- truthful availability of information;
- Service Request CTA when eligible.

No fake ratings/opening hours.

### Garage detail
Show:

- organization identity;
- branches where governed;
- services;
- verification basis;
- mechanic/practitioner information only where public-safe;
- Service Request action.

## 22.2 Owner surfaces

### My Garage
Add a truthful service entry point per vehicle.

### Service request
Vehicle is selected from canonical owned vehicles.

Target garage comes from governed directory/profile.

### Service Case detail
Show:

- vehicle;
- garage;
- status;
- assigned mechanic when known;
- service summary;
- PartSentry/evidence indicators;
- cost only when recorded;
- canonical conversation CTA;
- history/timestamps.

### Service History
Remove current truth debt.

Must support:

- real provider display name or “Provider not recorded”;
- cost-not-recorded state;
- no hard-coded next service;
- Passport-converged records;
- provenance labels;
- PartSentry links.

## 22.3 Garage/mechanic surfaces

### Garage queue
Tenant-scoped requests/cases.

### Work orders
Evolve current page rather than replace it.

### Assignment
Separate intake user from assigned mechanic.

### Service recording
Connect work, mileage, parts and evidence to the same case/order.

## 22.4 Mobile/responsive

Foundation flows must work on compact mobile because QR/service activity is likely phone-driven.

Minimum-width and touch-target/accessibility tests are required.

---

# 23. API/service architecture

Exact endpoints may follow repository conventions, but responsibilities should remain separated.

Recommended service boundaries:

```text
garageDirectoryService
serviceCaseService
serviceCaseAuthorization
serviceCaseEventProducer
workOrder/assignment service
serviceLinkResolver
servicePassportBridge/projection adapter
serviceIntelligence emitters
```

Do not create monolithic routes that:

- authorize;
- mutate five tables;
- send Email directly;
- compute Trust;
- update Passport copies;
- calculate analytics

inside one request handler.

Routes should validate and delegate.

---

# 24. Database/migration rules

## 24.1 Additive first

Prefer additive migrations that can coexist with legacy rows.

Do not rename/drop old service columns until compatibility has been proven and a separate migration rule justifies it.

## 24.2 Existing authority first

Before creating a table, S0 must search for an existing canonical authority.

Especially inspect:

- organizations/tenants;
- branches;
- mechanic work orders;
- mechanic parts;
- PartSentry;
- marketplace inquiries;
- message threads/participants;
- domain events;
- auth/action tokens;
- evidence;
- Passport projections.

## 24.3 Foreign keys

Foundation should enforce references where safe and compatible:

- Service Case → vehicle;
- Service Case → garage tenant;
- work order → Service Case;
- assignment → work order/mechanic;
- branch references;
- inquiry/conversation references where cross-domain FK policy permits it.

Do not create brittle cross-domain cascades that can delete history.

## 24.4 Money

Where cost/currency are touched:

- retain explicit currency;
- do not assume USD if the record does not say USD;
- prefer canonical money representation already used by CarUp;
- never render absent cost as zero.

## 24.5 Timestamps

Use server-generated timestamps for authoritative lifecycle events.

Do not derive completion time from `updated_at` once a dedicated `completed_at` exists.

## 24.6 RLS/grants

Every new table requires explicit RLS/grant review.

Test:

- owner;
- correct garage tenant;
- mechanic;
- other garage tenant;
- unauthenticated;
- admin/governance where applicable.

Default privilege regression must be considered.

---

# 25. Security and privacy threat model

At minimum test these threats.

## Cross-tenant access
A mechanic/garage user must not read or mutate another garage's private cases/orders.

## IDOR
Guessing a Service Case/work-order/QR identifier must not reveal protected data.

## QR replay
Temporary write-capability links need expiry/revocation/replay controls.

## Permanent QR leakage
Permanent QR must not carry private customer/vehicle data.

## Participant leakage
A garage employee who is not authorized for a private service conversation must not gain access merely from tenant membership unless the explicit product policy grants it.

## Previous-owner leakage
Service history surviving ownership transfer must not reveal previous-owner PII.

## Free-text leakage
Private diagnosis/customer descriptions must not enter public Passport/event payloads.

## Trust escalation
Garage/mechanic writes cannot directly increase Trust.

## Device spoofing
Device metadata is provenance only, never authentication authority.

## Provider spoofing
WhatsApp/Email delivery claims come from Communications/provider evidence, not service UI assumptions.

## Duplicate creation
Retries must not create duplicate inquiries, Service Cases, conversations, work orders or completion events.

---

# 26. Correction, dispute and supersession

Foundation must preserve history.

At minimum the architecture must support correction of:

- mileage observations;
- mechanic assignment;
- provider attribution;
- parts;
- service completion data.

If the existing canonical correction/dispute infrastructure can be reused, use it.

Otherwise add the minimum generic references needed so a row can be:

- active/current;
- disputed;
- superseded;
- corrected by another record.

Never silently rewrite a history-bearing record after it has been projected into Passport without an auditable trail.

---

# 27. One-PR implementation rule

The complete Foundation 1.0 implementation MUST happen in **one feature branch and one PR**.

Recommended branch after the implementation base is reconciled:

```text
feat/service-network-foundation-1-0
```

Target:

```text
main
```

No parallel feature branches for phases.

No “S1 PR”, “S2 PR”, etc.

No agent may cherry-pick competing implementations into the feature branch.

Agents may hand off the same branch sequentially, but they must read:

1. this plan;
2. all existing receipts on the branch;
3. current diff;
4. current failing/passing gates

before writing.

Read-only analysis agents may run in parallel only if they do not modify source and their findings are reconciled by the active writer.

---

# 28. Sequential implementation phases

All phases live in the same PR.

Each phase must end with tests + a receipt committed under:

```text
docs/service-network-foundation/receipts/
```

## S0 — Exact-base reconciliation and authority freeze

**No product expansion before S0 is complete.**

Tasks:

- confirm #194/successor merged;
- record exact `main` implementation SHA;
- enumerate open PRs touching affected domains;
- audit organizations/tenants/branches;
- audit auth/tenant membership;
- audit work orders and parts;
- audit PartSentry/mileage writes;
- audit Marketplace `garage_service_request` routing;
- audit Communications service workflow readiness;
- audit Passport V8 projection;
- audit I9 Intelligence;
- audit Evidence taxonomy;
- audit Service History/My Garage/Garage Directory truth debt;
- audit action-token/capability infrastructure;
- freeze exact authority matrix;
- freeze exact Foundation schema delta;
- freeze state/event vocabulary;
- identify all legacy compatibility obligations.

Deliverable:

`S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

Gate:

- no unresolved duplicate authority;
- no stale #194 assumption;
- no migration written against an unverified schema shape.

## S1 — Governed Garage Identity and Publication

Build/reconcile:

- garage organization public projection;
- publication state;
- verification/onboarding dimensions;
- branch/location;
- service capabilities;
- directory API;
- Garage Directory;
- Garage detail;
- truthful empty states.

Do not add ratings.

Receipt:

`S1_GARAGE_IDENTITY_PUBLICATION_CERTIFICATION.md`

## S2 — Canonical Service Case Foundation

Build:

- Service Case schema/service;
- tenant authorization;
- request creation;
- accept/decline/cancel;
- idempotency;
- timestamps;
- event emission;
- source attribution.

Receipt:

`S2_SERVICE_CASE_CERTIFICATION.md`

## S3 — Marketplace and Communications Convergence

Build:

- `garage_service_request` → Service Case bridge;
- governed target-garage reference;
- source-channel attribution;
- canonical service conversation;
- participants;
- service notification policies/templates required by Foundation;
- recovery semantics.

Certify internal message plus provider-independent routing behavior.

Do not require live production provider activation.

Receipt:

`S3_MARKETPLACE_COMMUNICATIONS_CERTIFICATION.md`

## S4 — Work Order and Mechanic Assignment Convergence

Build:

- Service Case → existing work order link;
- remove creator=mechanic as authoritative assumption;
- assignment history;
- tenant/branch scope;
- completion/cancellation timestamps;
- compatible status/state model;
- current Work Orders/Mechanic Dashboard convergence.

Receipt:

`S4_WORK_ORDER_ASSIGNMENT_CERTIFICATION.md`

## S5 — Service Record, Mileage, PartSentry and Evidence

Build:

- governed mileage observation;
- work-performed record;
- cost/currency truth semantics;
- PartSentry linkage;
- evidence references;
- PartSentry mileage-authority reconciliation;
- privacy-safe fields.

Receipt:

`S5_SERVICE_PARTS_EVIDENCE_CERTIFICATION.md`

## S6 — Vehicle Passport and Owner Surface Convergence

Build:

- Passport V8 source enrichment;
- no second ledger;
- Service History correction;
- My Garage service actions/status;
- provider/mechanic provenance;
- sparse/unknown states;
- ownership-transfer privacy continuity.

Receipt:

`S6_PASSPORT_OWNER_CONVERGENCE_CERTIFICATION.md`

## S7 — Intelligence Convergence

Build/update:

- service event/activity instrumentation;
- measurable metric catalogue;
- I9 not-measurable reconciliation;
- mechanic-person scope;
- garage-tenant scope;
- branch/service-category metrics only where authoritative;
- unavailable semantics.

Receipt:

`S7_SERVICE_INTELLIGENCE_CERTIFICATION.md`

## S8 — Service Link Foundation

Build:

- common resource-link resolver;
- Vehicle QR/deep link;
- Service Case QR/deep link;
- Mechanic QR/deep link;
- source-channel attribution;
- authenticated current-user/tenant authorization;
- safe actor/session provenance;
- minimal temporary capability only if required by approved Foundation flow;
- replay/IDOR tests.

Receipt:

`S8_SERVICE_LINK_CERTIFICATION.md`

## S9 — UX, accessibility and mobile convergence

Apply coherent CarUp design to:

- Garage Directory/detail;
- owner service request/case;
- Work Orders;
- Service History;
- mechanic attribution;
- QR entry states.

Test:

- desktop;
- tablet;
- compact mobile;
- keyboard;
- screen-reader labels;
- loading;
- empty;
- unavailable;
- error;
- long text;
- sparse history.

Receipt:

`S9_UX_ACCESSIBILITY_CERTIFICATION.md`

## S10 — Golden Journey and exact-head certification

Run exact head:

```text
owner
→ vehicle
→ garage
→ service request
→ canonical conversation
→ acceptance
→ work order
→ mechanic assignment
→ mileage/work/part/evidence
→ completion
→ Passport
→ Service History
→ Intelligence
```

Also certify QR path.

Receipt:

`S10_GOLDEN_SERVICE_NETWORK_CERTIFICATION.md`

---

# 29. Automatic-continuation rule

The implementation agent MUST proceed through S0 → S10 in one continuous execution lane whenever the next phase can be completed safely from repository truth.

The agent MUST NOT stop after each phase to ask:

- “Should I continue?”
- “Do you want me to proceed?”
- “Can I start the next phase?”

Phase receipts are checkpoints, not owner approval gates.

If a phase is green, commit the receipt and continue.

---

# 30. Legitimate manual-stop conditions

The agent may stop only when continuing would require a real external/manual decision or would violate a contract.

Examples:

1. PR #194/successor is not merged and there is no canonical implementation base.
2. A required owner identity/legal/product policy value cannot be inferred.
3. A destructive migration requires explicit owner approval.
4. Production secret/provider/environment activation is required.
5. Protected production migration/reviewer approval is required.
6. Owner physical UAT is required by the release gate.
7. A P0/P1 security, cross-tenant, truth or data-loss defect is found and no safe local remediation exists.
8. Two existing canonical authorities genuinely conflict and choosing one would redefine product semantics.
9. An external provider/API contract requires credentials or legal/business onboarding.

When stopping, return:

- exact blocker;
- exact phase;
- exact head SHA;
- what is already complete;
- the smallest manual action required;
- exact command/UI step if applicable;
- what the agent will resume with after the gate.

Do not stop merely because work is large.

---

# 31. Commit discipline

Use small, phase-readable commits on the one feature branch.

Example:

```text
service(s0): freeze live authority and schema contract
service(s1): add governed garage publication
service(s2): add canonical service cases
service(s3): converge marketplace and communications
service(s4): converge work-order mechanic assignment
service(s5): bind service parts evidence provenance
service(s6): converge passport and owner history
service(s7): add governed service intelligence
service(s8): add service link QR resolver
service(s9): converge service UX and accessibility
cert(service): exact-head Service Network Foundation 1.0
```

Do not mix unrelated cleanup into the PR.

---

# 32. Testing strategy

Each phase must add tests at the layer where the authority lives.

## Unit

- state transitions;
- projections;
- authorization helpers;
- event payloads;
- provenance;
- QR/link resolver;
- truth display helpers.

## Database/schema

- constraints;
- foreign keys;
- compatibility migration;
- RLS;
- indexes;
- idempotency;
- cross-tenant denial;
- historical retention.

## Backend integration

- Service Case lifecycle;
- Marketplace bridge;
- Communications event handling;
- work-order assignment;
- PartSentry/evidence linking;
- Passport projection;
- Intelligence.

## Web

- Garage Directory;
- service request;
- Service Case;
- Work Orders;
- Service History;
- QR entry;
- unknown/unavailable states.

## E2E

At minimum:

### Golden A — evidence-rich service
Full happy path with part/evidence and completed Passport history.

### Golden B — sparse service
Missing optional data must render truthfully.

### Golden C — cross-tenant attack
Garage B cannot access Garage A private case/order/conversation.

### Golden D — QR
Scan/deep link resolves correct resource, requires auth, preserves tenant authorization and source attribution.

### Golden E — Communications degraded
Service truth survives provider outage; canonical communication state reports unavailable/pending honestly.

### Golden F — ownership continuity
Service history survives ownership transfer without prior-owner PII.

### Golden G — duplicate/retry
Retry cannot duplicate case/work order/assignment/completion event.

### Golden H — adverse truth
Unknown provider, absent cost, missing maintenance interval, disputed/cancelled history render correctly.

---

# 33. CI and exact-head gates

Before PR readiness:

- TypeScript clean;
- lint regression clean;
- production web build;
- backend tests;
- Service Network dedicated tests;
- canonical Trust guards;
- Passport V1–V16/successor guards relevant to service;
- Communications tests;
- Intelligence tests;
- migration/schema tests;
- RLS/security tests;
- Playwright/E2E;
- accessibility;
- secret scan;
- dependency/security gates required by repository policy;
- exact-head staging deployment/certification where available.

A passing earlier SHA does not certify the final receipt-bearing SHA.

Final certification must rerun on the exact head that contains the S10 receipt.

---

# 34. Definition of Done

Foundation 1.0 is engineering-complete only when all are true.

## Identity/organization
- [ ] No new global garage user role.
- [ ] Garage publication is governed.
- [ ] No fabricated public garage data.
- [ ] Cross-tenant isolation passes.

## Service Case
- [ ] One durable case represents the engagement.
- [ ] Request/accept/decline/cancel are authoritative.
- [ ] Retry is idempotent.
- [ ] Domain events exist.

## Marketplace
- [ ] Existing service inquiry vocabulary is reused.
- [ ] Target garage is explicit.
- [ ] Acquisition/source attribution is retained.
- [ ] No seller semantics are falsified.

## Communications
- [ ] One canonical service conversation.
- [ ] Explicit participants.
- [ ] Internal messaging works.
- [ ] Email/WhatsApp/push remain transports, not separate truth.
- [ ] Provider failure does not fabricate delivery.
- [ ] No duplicate service messaging table.

## Work/mechanic
- [ ] Work order links to Service Case.
- [ ] Intake user is not automatically authoritative mechanic.
- [ ] Assignment history exists.
- [ ] Completion/cancellation timestamps exist.
- [ ] Mechanic and garage scope remain distinct.

## Service/parts/evidence
- [ ] Mileage observation has authority/provenance.
- [ ] PartSentry links to the job.
- [ ] Evidence uses canonical evidence authority.
- [ ] Missing cost/currency remain missing.
- [ ] PartSentry mileage mutation is reconciled.

## Passport
- [ ] No second service ledger.
- [ ] Completed service projects through V8/successor authority.
- [ ] Public privacy whitelist passes.
- [ ] Ownership transfer preserves history safely.
- [ ] Service cannot stamp Trust.

## Intelligence
- [ ] Metrics come from authoritative fields.
- [ ] I9 person/tenant distinction remains.
- [ ] Unsupported metrics remain not measurable.
- [ ] No fake zeros.

## Service Link
- [ ] Vehicle link works.
- [ ] Service Case link works.
- [ ] Mechanic link works.
- [ ] Scan does not bypass auth.
- [ ] QR carries no private payload.
- [ ] QR source attribution is retained.
- [ ] replay/IDOR tests pass.

## UX
- [ ] Service History hard-coded “500 km” removed.
- [ ] generic fake provider removed.
- [ ] absent cost not rendered as $0.
- [ ] mobile/accessibility pass.
- [ ] loading/empty/unavailable states are distinct.

## Certification
- [ ] S0–S10 receipts committed.
- [ ] exact final head green.
- [ ] no unresolved P0/P1.
- [ ] implementation PR contains the entire Foundation sequentially.
- [ ] production activation remains separately gated.

---

# 35. Production/activation boundary

A merge-ready Foundation PR does NOT automatically authorize:

- production schema application;
- external WhatsApp/push provider activation;
- production public garage publication;
- real garage onboarding;
- production QR sticker distribution;
- production service payments;
- destructive backfills.

Those follow normal protected environment/owner controls.

Staging must be truthful: use governed test fixtures or specifically identified test tenants, never invented public businesses presented as real.

---

# 36. Operational/manual use after launch

This document remains the troubleshooting reference after implementation.

When a live Service Network problem occurs, identify the authority first.

## Example: “Owner did not receive repair update”

Check in order:

1. service event exists;
2. canonical Communications event consumed;
3. conversation participant exists;
4. notification intent exists;
5. channel preference/binding exists;
6. provider attempt/delivery state exists.

Do not edit the Service Case to “fix Email.”

## Example: “Wrong mechanic shown”

Check:

1. assignment authority;
2. historical assignment rows;
3. Passport/service projection;
4. public/private projection.

Do not rewrite the mechanic profile to match the job.

## Example: “Service missing from Passport”

Check:

1. work order/source record;
2. completion state/timestamp;
3. Service Case link;
4. Passport V8/successor projection;
5. audience/privacy filter.

Do not insert a fake Passport timeline row.

## Example: “Garage says Trust should increase”

Check:

1. service/evidence source;
2. whether the fact is an explicit canonical Trust input;
3. canonical Trust workflow.

Do not modify Trust from Service Network.

## Example: “QR opens wrong tenant”

Treat as security-critical.

Check:

1. link resource;
2. current authenticated actor;
3. tenant membership;
4. resolver authorization;
5. source-channel/context audit.

Never trust tenant identity from the QR itself.

---

# 37. Agent handoff format

Every implementing agent handoff must include:

```text
SERVICE_NETWORK_PHASE=
EXACT_HEAD=
IMPLEMENTATION_BASE=
LAST_GREEN_GATES=
FILES_CHANGED=
MIGRATIONS=
AUTHORITY_DECISIONS=
TRUTH_TRUST_IMPACT=
PASSPORT_IMPACT=
COMMUNICATIONS_IMPACT=
INTELLIGENCE_IMPACT=
OPEN_P0_P1=
NEXT_PHASE=
MANUAL_GATE_REQUIRED=YES|NO
MANUAL_ACTION=
```

If `MANUAL_GATE_REQUIRED=NO`, the next agent should continue automatically.

---

# 38. Plan-change governance

After this plan is merged, it becomes the canonical Service Network Foundation 1.0 reference.

Material changes require:

- an explicit owner-approved amendment to this document; or
- a clearly linked superseding canonical plan.

Agents may refine implementation details during S0, but may not silently change:

- one PR;
- one canonical vehicle;
- garage=tenant/mechanic=person;
- Service Case as orchestration spine;
- Communications authority;
- Passport authority;
- Trust boundary;
- Intelligence boundary;
- QR authorization rule;
- production gate;
- Foundation 1.0 scope boundary.

---

# 39. Final implementation instruction

The implementation programme begins only after the post-#194 canonical `main` is known.

Then:

```text
exact main
   ↓
create feat/service-network-foundation-1-0
   ↓
S0 reconcile
   ↓
S1
   ↓
S2
   ↓
S3
   ↓
S4
   ↓
S5
   ↓
S6
   ↓
S7
   ↓
S8
   ↓
S9
   ↓
S10 exact-head certification
   ↓
ONE merge-ready PR
```

The agent should continue through the entire sequence without asking for permission between phases unless one of the explicit manual-stop conditions in §30 occurs.

The desired final state is not “a garage page.”

It is:

> **A real owner can connect the same canonical vehicle to a governed garage, create a durable service case, communicate through CarUp, have the actual mechanic attributed, record work/parts/evidence, complete the job, see the truthful result in the Vehicle Passport and Service History, and have Intelligence measure only what the lifecycle genuinely recorded — while Email, WhatsApp, push, Marketplace, Truth/Trust and Passport each remain their existing canonical authorities.**
