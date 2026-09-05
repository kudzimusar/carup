# ADR — Reusable Operations patterns after the first real Vehicle Operations slice

- **Status:** ACCEPTED (architecture decisions only — no product code changed)
- **Date:** 2026-09-03
- **Phase:** Operations Control Plane M8
- **Evidence SHA:** functional candidate `f25ea5c6`; documentation head at time of writing `0b64864e`
- **Supersedes:** the M8 review questions in the manual §24, which asked these questions hypothetically
- **Decision owner:** Product Owner (this ADR recommends; it does not authorise implementation)

---

## 1. Context

M0–M7 delivered the first real Vehicle Operations implementation and certified it against a real
vehicle (2016 Nissan Serena Highway Star, `GFC27-027051`). Before starting O2–O10, we must decide
what has been **proven** common enough to extract into shared Operations infrastructure, and what
must stay owned by its domain.

The manual's own decision gate (§24) is the test applied throughout:

> Create reusable infrastructure only when: at least two operating domains need the same concept;
> domain canonical records remain intact; migration cost is justified; security scope is defined.

The governing law is unchanged and is restated here because every decision below defers to it:

> **OPERATIONS ORCHESTRATES. DOMAIN SERVICES OWN TRUTH.**
> No generic Operations record may silently become the canonical business record.

The benchmark research adds law 11, which points the same way:

> The operating system should grow as specialist vertical slices rather than as one global Admin
> with unlimited authority.

---

## 2. What M0–M7 actually proved

1. **Canonical semantics must beat legacy labels.** Import documents were satisfying a Zimbabwe
   registration gate because a legacy `evidence_type` string said so. `evidence_class` /
   `evidence_subtype` became the authority; the legacy column stayed as compatibility metadata.
2. **A gate must consult every authority that answers its question.** `fraud_cases.blocks_publication`
   was read by the trust decision but never by the publish route — two answers to "may this publish?"
3. **A claim without provenance is not a claim.** A registration stage written without
   `registration_status_source` evaluated as `not_recorded` and silently blocked the seller's own
   truthful statement.
4. **A derived public position goes stale silently.** The Serena published "registration stage has
   not been established" beside a claim block reporting that stage as recorded, because the Trust
   stamp predated the fact and classified as fresh. Publication now re-materialises it.
5. **A default is not a control.** Evidence visibility defaulted to `restricted` for documents, but
   the request body won outright, so the uploader decided. A seller published his own source document.
6. **A capability nobody can reach is not a capability.** The classification-correction editor was
   gated on `verification_status === 'pending'`, and a mis-published document is discovered *after*
   review — so the control was dead by construction for exactly the rows that needed it.
7. **Operations can be useful while writing nothing.** The Vehicle Operations aggregate is a pure
   read model. Every mutation it offers is a call into the owning domain service.

Points 1–7 are the lens for the rest of this ADR: the failures were about **authority, provenance,
staleness and reachability** — not about missing queue machinery.

---

## 3. Systems inspected

Inspected at `f25ea5c6` by reading migrations (the strongest evidence: the DDL is what actually
exists), services and routes.

| System | State | Primary records |
|---|---|---|
| Vehicle Operations | IMPLEMENTED (this slice) | read model only; `vehicle_evidence`, `vehicle_seller_authority` |
| Communications Command Center | IMPLEMENTED, most mature | `message_threads`, `communication_escalations`, `communication_sla_policies`, `notification_queue` |
| Identity Verification | IMPLEMENTED | `verification_sessions`, `verification_decisions`, `verification_assessments`; `services/identity/caseWorkflow.js` |
| Trust Review | IMPLEMENTED | `trust_fact_requests`, `trust_audit_events` |
| Governance Review | IMPLEMENTED | `review_tasks`, `review_decisions` |
| Fraud Queue | IMPLEMENTED (thin) | `fraud_cases`, `fraud_case_events`, `fraud_case_resolutions` |
| Dealer Compliance | IMPLEMENTED (thin) | `dealer_compliance_requirements`, `dealer_compliance_documents`, `compliance_reports` |
| Marketplace Moderation | IMPLEMENTED | inquiries (`assigned_operator`), moderation endpoints |
| Feature Governance | IMPLEMENTED | feature registry + manifest drift gate |
| Service Network | **LARGELY ABSENT** | `workOrdersRoutes.js` (91 lines), `mechanic_work_orders`, `partnerAuthService.js`, `providerPlatform/` |
| Finance operations | PARTIAL | finance obligation records, lender routes |
| Insurance operations | PARTIAL | `insurance_claims`, insurer routes |
| PartSentry governance | IMPLEMENTED | `partsentry_review_requests` |
| SafePay / SafeTrade | PARTIAL | `disputes`, `dispute_events`, SafeTrade approvals (`expires_at`) |
| Diaspora compliance | IMPLEMENTED | `diaspora_compliance_reviews` |

---

## 4. M8.1 — Vehicle Operations compared with Communications

Communications is the strongest horizontal Operations workflow in CarUp. The comparison below is
deliberately unforgiving: equivalence is **not** forced.

| Dimension | Communications | Vehicle Operations | Verdict |
|---|---|---|---|
| Work-item identity | `message_threads.id` — a durable thread the work happens *on* | none; the work item **is the vehicle** (`vin`) plus its evidence rows | **Domain-specific.** Communications needs a thread because a conversation has no other identity. A vehicle already has one. |
| Subject | `subject_type` / subject on the thread | the VIN, always | Horizontal *concept*, different shape |
| Owner / assignee | `assigned_admin_id`, real `assignThread` action | **none** — deliberately | Not proven horizontal (see §5) |
| Team | `assigned_team`, routed by `thread_type` | none | **Communications-specific** — the only team model in CarUp |
| State / status | 9 states incl. `awaiting_ai` / `awaiting_human` / `awaiting_user` | requirement `status` + `who_must_act` | **Horizontal — see §4.1** |
| Priority | `priority` column, drives SLA policy | none | Not proven horizontal |
| SLA | full: targets, business hours, pause/resume, breach | none | **Communications-specific** (see §6) |
| Escalation | `communication_escalations` table (assignee, due, resolved) | none | State yes, record no |
| Internal notes | thread-level internal notes | `verification_notes`, correction `reason` | Horizontal, but as *decision reason*, not free chat |
| Public / customer comms | the entire point of the system | **none — and must stay none** | **Communications-specific.** Vehicle Operations must never message a seller directly; it emits domain events and Communications owns delivery. |
| Audit | `communicationAuditLog` | `trust_audit_events`, fail-closed before mutation | **Horizontal** |
| Resolution | `resolved` / `closed` | publication decision, authority decision | Horizontal concept, domain outcomes |
| Reopen | thread reopen | evidence re-correction, authority supersession, unpublish | Horizontal concept, domain mechanics |
| Dead-letter / recovery | `notification_queue.dead_letter`, `communicationRecovery.js` | **none needed** — no outbound delivery | **Communications-specific.** Dead-letter is a *delivery* concern. |
| Source domain | inbound channel (WhatsApp/email) | the vehicle lifecycle | Different |
| Canonical authority | Communications owns threads/messages **only** | Trust, Fraud, Marketplace, Evidence each own their own | **Horizontal law, already honoured by both** |
| Permissions | admin/reviewer roles | `operations.*` capabilities from `platformRole`/`baseRole` | **Horizontal — Vehicle Ops generalised it** |
| Private evidence | media attachments | restricted documents, withheld file URLs | Horizontal concern, domain rules |
| Decision outcomes | reply/assign/escalate/resolve | verify/reject/correct/confirm authority | Domain-specific verbs |

### 4.1 The finding that matters: "who must act next" was invented three times

Three teams independently built the same primitive under three different names, none aware of the
others:

| Concept | Communications (`message_threads.status`) | Identity Verification (`WORKFLOW_PHASE`) | Vehicle Operations (`who_must_act`) |
|---|---|---|---|
| the platform's machinery is working | `awaiting_ai` | `SYSTEM_PROCESSING` | — |
| a CarUp operator must act | `awaiting_human` | `REVIEWER_ACTION_REQUIRED` | `carup_review` |
| the customer/subject must act | `awaiting_user` | `APPLICANT_ACTION_REQUIRED` | `seller` |
| escalated to a specialist | `escalated` | `ESCALATED` | — |
| nothing is outstanding | `resolved` / `closed` | `RESOLVED_APPROVED` / `RESOLVED_REJECTED` | `none` |
| **an external authority must act** | — | — | **`external_authority`** |

Anchors: `database/migrations/20260623143000_omnichannel_communication_engine.sql`;
`backend/services/identity/caseWorkflow.js:78`; `backend/services/evidence/completenessEvaluator.js:120`.

Two consequences:

1. This clears the manual's bar decisively — **three** domains, not two, and by independent
   invention rather than by copying, which is the strongest possible evidence that the concept is
   real rather than imitated.
2. Only Vehicle Operations has `external_authority`, because it is the first slice that genuinely
   waits on ZIMRA/CVR. That state is the one every later slice will need — O6 (lenders), O7
   (insurers), O9 (government) are *defined* by waiting on someone CarUp does not control. It is
   also, as §6 shows, the state that determines whether an SLA clock may run at all.

### 4.2 The second finding: the governed decision record has already been copy-pasted

`trust_fact_requests` and `partsentry_review_requests` are **structurally identical** — same
columns in the same order, including `partsentry_log_ids`, which is meaningless in the trust table
and proves the direction of the copy.

The same shape, with local variation, appears in at least seven places:

| Record | status | reviewer identity + role | reason | evidence ids | policy version | supersession |
|---|---|---|---|---|---|---|
| `trust_fact_requests` | ✓ | ✓ | ✓ | ✓ | — | `revoked_at` |
| `partsentry_review_requests` | ✓ | ✓ | ✓ | ✓ | — | `revoked_at` |
| `vehicle_seller_authority` | ✓ | `decided_by` + role | ✓ | ✓ | **✓** | `revoked` status |
| `review_decisions` | ✓ | ✓ | ✓ | — | **✓** | supersede |
| `verification_decisions` | ✓ | ✓ | ✓ | — | — | resubmission |
| `diaspora_compliance_reviews` | ✓ | ✓ | notes | — | — | — |
| `vehicle_evidence` (verify columns) | ✓ | `verified_by` | notes | n/a | — | correction history |

`vehicle_seller_authority` — built in this slice — is the most evolved instance: it is the only one
carrying both `policy_version` and a first-class `basis` (why the decision was reachable).

**This, not a case table, is the thing that is actually being duplicated in CarUp today.**

---

## 5. M8.2 — Assignment · DECISION: **DEFER**

### Evidence

| Domain | Assignment | Reality |
|---|---|---|
| Communications | `assigned_admin_id` + `assigned_team` | **Real and mature** — `assignThread`, team routing by `thread_type`, inbox projection with assigned/unassigned facets |
| Marketplace inquiries | `assigned_operator` | **Real but trivial** — one PATCH endpoint, sets `status='assigned'` |
| `review_tasks` | `assigned_to` | **DEAD COLUMN.** `governanceService.js` never writes it — it only advances `status`/`decision_id` |
| Referral trust review | `assigned_to` | nullable pass-through, no assign action |
| Diaspora compliance | `assigned_to` | nullable pass-through, no assign action |
| Disputes | `assigned_reviewer` | column only |
| **Vehicle Operations** | none | deliberately — and the slice certified without ever wanting it |
| Fraud, Trust, Identity, Dealer Compliance, PartSentry, Finance, Insurance, SafePay | none | — |

### Reasoning

Only **one** domain has a working assignment model. The second (marketplace inquiries) is a single
column and a single endpoint. Everything else is either a dead column or a nullable field no code
path sets. Vehicle Operations — a full real-world slice worked end to end on a real vehicle by a
real reviewer — never needed assignment at all, because the queue was one vehicle deep.

Building a shared assignment model now would be building it from one example.

But something **is** proven, and it is worth acting on: **five different column names for one
concept** (`assigned_admin_id`, `assigned_team`, `assigned_operator`, `assigned_to`,
`assigned_reviewer`). That is vocabulary drift, and it is cheap to stop now and expensive to
reconcile after three more slices.

### Decision

**DEFER** the shared assignment model. **ADOPT NOW** a naming contract, so that any new Operations
surface that needs assignment uses these names and semantics:

```
assigned_team    TEXT         -- a queue/specialism, not a tenant
assigned_user_id TEXT         -- a CarUp operator; NEVER a customer or seller
assigned_at      TIMESTAMPTZ
assignment_reason TEXT        -- why THIS operator (routing rule, escalation, manual pick)
```

No table, no migration, no backfill. Existing columns are **not** renamed — renaming a live column
in Communications to satisfy a naming rule is exactly the kind of churn this ADR exists to prevent.

**Re-open trigger:** the first slice with a genuine multi-operator queue **and** a second domain
asking for the same routing behaviour. Expected at **O4 (Customer Operations)**.

---

## 6. M8.3 — SLA · DECISION: **REJECT a horizontal SLA framework** (extract the state machine only when a second consumer exists)

### Evidence

Exactly **one** domain in CarUp has an SLA: Communications. Verified by search — every other `sla`
match in `backend/services/` outside `communication/` is the substring inside the word *translate*.

What the others have instead:

- `review_tasks.due_at` — a bare timestamp; nothing computes state from it
- `disputes.response_deadline` — a bare timestamp
- SafeTrade approvals `expires_at` — an **expiry**, not a service commitment
- Vehicle Operations, Identity, Fraud, Trust, PartSentry, Dealer Compliance, Finance, Insurance — nothing

### Reasoning

An SLA is a **promise about CarUp's own responsiveness**. It is only meaningful while CarUp is the
party that must act. Most Operations work is not in that state:

| Workflow | Needs |
|---|---|
| Customer support conversations | **True SLA** — CarUp owes a response |
| Identity verification review | **True SLA** while `REVIEWER_ACTION_REQUIRED`; must pause on `APPLICANT_ACTION_REQUIRED` |
| Evidence review, Seller Authority | **Age + timestamps** are sufficient today; a promise to a seller is a product decision nobody has made |
| Fraud, disputes | **Age**, plus escalation on severity — not a clock |
| Registration progression, ZIMRA/CVR, lender, insurer, mechanic | **Never an SLA.** CarUp does not control the counterparty. A breach badge here would blame CarUp for a government backlog and would be a *false public-facing statement* — the exact class of defect M0–M7 was about. |

The critical structural point: Communications already has pause/resume
(`sla_paused_at`, `sla_paused_seconds`, `pauseSla`/`resumeSla`), but it is **manual** — an admin
toggles it. The correct rule, which the `who_must_act` finding makes available, is that **pause is
derived, not toggled**: the clock runs only while `who_must_act = carup_review`.

Also relevant: `computeSlaState()` in `backend/services/communication/communicationSla.js` is
**already a pure function with zero DB coupling**. There is no architectural work to do to make it
shareable — only a consumer to justify moving it. Moving it today would create a shared module with
one caller.

### Decision

1. **REJECT** a horizontal SLA framework or a global SLA table.
2. **ADOPT the derivation law now** (documentation-level, no code): an SLA clock may run only while
   the platform is the actor. `who_must_act ∈ {seller/applicant, external_authority}` ⇒ paused.
3. **ADOPT the default**: new Operations surfaces get **age + timestamps**, not an SLA.
4. **DEFER** extracting `computeSlaState` to a shared module until a second domain genuinely needs a
   clock — expected at O4, possibly O2 for identity review.
5. `communication_sla_policies` is keyed by `channel` and `priority` and is **not** reusable as-is.

---

## 7. M8.4 — `operations_cases` · DECISION: **REJECT** (stateful table) / **DEFER** (read-only index)

This was the most important decision to get right, so it is answered against the ten questions asked.

**1. How many current Operations domains would actually use the same concept?**
Fewer than it appears — and crucially, **the design space is already occupied**. `review_tasks`
already *is* a generic operations-case table:

```sql
review_tasks(
  id, task_type CHECK (9 cross-domain types), target_type, target_id, vin,
  status CHECK ('open','in_review','resolved','escalated'),
  assigned_to, priority, due_at, decision_id, metadata JSONB, created_at, updated_at)
```

That is nearly field-for-field the proposed `operations_cases` (`case_type`→`task_type`,
`subject_type/subject_id`→`target_type/target_id`, plus assignment, priority, due date and a
decision link). Creating `operations_cases` would mean **building a second generic case table beside
an existing generic case table.**

And `review_tasks` has **one writer** (`governanceService.js`) and two readers (governance, and the
Vehicle Operations read model). A generic shape that one domain writes after months of availability
is evidence *against* the abstraction, not for it.

**2. Would the case duplicate existing domain state?** Yes. `fraud_cases.status`,
`verification_sessions.status`, `vehicle_seller_authority.status`, `disputes.status`,
`message_threads.status` are each canonical. A case row would hold a second copy.

**3. Could it drift from canonical records?** Yes, and M0–M7 showed exactly how this fails: the Trust
stamp went stale against the vehicle's own facts and published a false sentence. That was a
*derived* value drifting from its source **inside one domain**. A generic case table would
institutionalise that failure mode across every domain at once.

**4. Would it help assignment/search/SLA/escalation?** Only if those existed. §5 and §6 show
assignment has one real implementation and SLA has one. The case table would arrive before its
justification.

**5. Does Communications already solve this differently?** Yes — thread-centric, and correctly so.
The thread exists because a conversation has no other identity. A vehicle, a verification session
and a fraud case each already have one. Generalising the thread model onto records that already
have identity would add a row whose only job is to point at the real row.

**6. Would a read-only Operations index be safer than a stateful case table?** Materially, yes —
it cannot become canonical because it cannot be written to.

**7. Could events/projections generate the index?** Yes. `eventBus` exists, Vehicle Operations
already emits `seller.authority.decided`, and Communications already ships an inbox **projection**
(`20260705150000_communication_inbox_projection.sql`) — the pattern is proven in-house.

**8. What happens when domain state changes outside Operations?** With a stateful case: it goes
stale, silently, exactly like the Trust stamp. With a projection: it is rebuilt. This question alone
decides the shape.

**9. What is the source of truth?** The domain record. Always. Non-negotiable.

**10. What is the migration strategy?** For the rejected table: none, because it is not built. For
the deferred index: additive, rebuildable, droppable without data loss — which is precisely what
makes it acceptable later.

### Decision

- **REJECT** a stateful generic `operations_cases` table. It duplicates `review_tasks`, duplicates
  domain state, and its central risk (drift from canonical records) is the failure mode M0–M7 spent
  a whole hardening pass eliminating.
- **DEFER** a **read-only Operations Work Index**: a projection keyed by
  `(domain, subject_type, subject_id)` carrying `who_must_act`, age, priority hint and
  `required_capability`, rebuilt from domain events, never written by an operator, safe to drop.
  **Trigger:** a real operator must work a queue spanning **two or more domains** in one surface.
  Not proven yet; expected around **O4**.
- **Before either**, prefer the cheaper option: `review_tasks` already exists. If a second domain
  needs a task queue, adopt `review_tasks` (extending its `task_type` CHECK) rather than inventing a
  new table — and if it turns out nobody adopts it after two more slices, that is itself the
  finding, and `review_tasks` should be narrowed to governance rather than generalised.

---

## 8. M8.5 — Persistent Operations memberships / capabilities · DECISION: **DEFER**

### What exists today

`backend/services/operations/operationsAuthorizationService.js` — four capabilities
(`operations.vehicle.read_private`, `operations.vehicle_evidence.review`,
`operations.vehicle_evidence.classify`, `operations.seller_authority.review`), derived from a static
map over `platformRole`/`baseRole` **only** (never `effectiveRole`, so a header-steered role can
never mint operations authority), and requiring a proven session.

The three-way separation is intact and must stay: **portal/stakeholder role ≠ platform authority ≠
Operations capability.**

Also present, and deliberately **not** to be conflated: `organization_roles` /
`organization_permissions` (`resource` + `action`, per organisation). That is **tenant-scoped RBAC**.
Tenant Admin is not CarUp Operations, and this table must never become the grant mechanism for
`operations.*`.

### Reasoning

The static mapping is sufficient **exactly while every operations capability is held by a
platform-level role**. Today all four are granted to `admin`/`platform_admin`/`super_admin`/
`government` as a block, and no CarUp workflow yet needs a person who holds *one* of them.

It becomes insufficient at the first specialist who must hold one capability without full admin — a
mechanic assessor, an insurance reviewer, a KYC specialist, a fraud analyst on a fixed rotation.
That is a real and foreseeable need, but it is **O5/O7/O2 work, not today's**.

Building it now would mean designing grant, revocation, expiry, delegation and emergency override
against zero real specialists, and every one of those would be guesswork.

### Decision

**DEFER.** The static server-side mapping remains sufficient for the next one to two slices.

**Design constraints recorded now, so the eventual implementation is not re-litigated:**

- **Storage:** `operations_capability_grants(user_id, capability, scope, granted_by, granted_by_role, reason, granted_at, expires_at, revoked_at, revoked_by, revoked_reason)`. Grants are **additive to** the static role map, never a replacement, so a bug in the grant table can only ever fail closed.
- **Grant authority:** platform-level only. A tenant admin may never grant an `operations.*` capability, and no public signup path may reach one.
- **Scope:** capability + optional domain scope. Never "all operations".
- **Expiry:** mandatory for delegated/temporary grants; a grant with no expiry must be an explicit, separately-audited decision.
- **Revocation:** immediate, audited, and effective on the next request — never cached past a session.
- **Audit:** every grant/revocation through the same fail-closed audit as governed mutations (audit **before** effect).
- **Tenant isolation:** operations capabilities are platform-scoped; they must not be inferred from `tenant_users.role`.
- **Emergency override:** break-glass must be a *grant with a short expiry and a mandatory reason*, not a bypass flag.
- **Frontend:** consumes server-derived `allowed_actions` only. The UI must continue to grant nothing — as in M5/M6.
- **Server enforcement:** capability check stays server-side, at the route, in addition to role checks.

**Do not implement on #206.**

---

## 9. M8.6 — Seller Authority after real use · DECISION: **KEEP DOMAIN-SPECIFIC**

Whether it should exist is settled. Assessment after real use:

| Question | Finding |
|---|---|
| Is the table/service sufficient? | **Yes** for what it does. It is the most evolved governed-decision record in the codebase — the only one with both `policy_version` and `basis`. |
| Is review history correctly represented? | **Partially.** The table holds the *current* decision; history lives in `trust_audit_events`. Adequate now, but a decision timeline is reconstructed rather than stored. Acceptable while there is one decision per seller/vehicle. |
| Is expiry required? | **No, not now.** Authority to sell does not decay on a clock. Revisit only if a registry integration supplies a validity window. |
| Is revocation sufficient? | **Yes** — `revoked` is a first-class status with attribution. |
| Are disputes linked correctly? | **Weakly.** `disputed` is a status, but there is no FK to `disputes`. Worth a link when O3/O4 land; not urgent. |
| Does dealer authority need different policy? | **Yes, and it already has one** — `dealer_tenant_inventory` basis and the `dealer` claim type. Correct as domain policy. |
| Vehicle-specific only? | **Yes, and it should stay that way.** `UNIQUE(vin, seller_user_id)` is the right grain. |
| Can authority transfer? | Not modelled. Ownership transfer exists separately (`passportOwnershipTransferRoutes.js`). **Keep separate** — conflating them would let a sale silently confer authority. |
| Should ownership lifecycle supersede it? | **Yes, and this is a real gap worth recording:** a completed ownership transfer should mark the previous seller's authority `revoked`. Not a defect in M0–M7 (no transfer has occurred for the Serena) but a genuine integration point for O2. |
| Should external registries raise authority level? | Yes eventually — a CVR confirmation is stronger than `existing_relationship`. The `basis` field already has room. No new structure needed. |
| Should it become a generic "entity authority"? | **NO.** One domain uses it. Generalising a single instance is exactly what this ADR rejects elsewhere; it would be inconsistent to allow it here. |

**Decision: keep Seller Authority domain-specific.** Propagate its *column contract* (§10), not its
table.

---

## 10. What M8 approves for extraction

Two things, both **contracts and pure modules — not tables and not services that own state**, so
neither can threaten domain truth ownership.

### 10.1 The `who_must_act` vocabulary (APPROVE — adopt as a documented contract now)

Proven by three independent inventions (§4.1). The canonical vocabulary, superset of all three:

```
none                 -- nothing outstanding
platform_processing  -- CarUp machinery is working (async job, AI, extraction)
carup_review         -- a CarUp operator must act        <- ONLY state where an SLA clock may run
subject_action       -- the seller/applicant/customer must act
external_authority   -- ZIMRA, CVR, a lender, an insurer, a mechanic must act
escalated            -- specialist/second-line
```

Adopted as a **naming and semantics contract** that new Operations surfaces conform to. Existing
domains are **not** migrated: Communications keeps `awaiting_*`, Identity keeps `WORKFLOW_PHASE`. A
shared pure mapping module is justified only when a surface must display two domains side by side —
i.e. together with the deferred Work Index.

### 10.2 The governed decision-record contract (APPROVE — adopt as a documented contract now)

Proven by seven instances and one literal copy-paste (§4.2). Any new governed decision record
carries:

```
status            -- domain vocabulary, but must include an explicit "not assessed" state
decided_by        -- actor id
decided_by_role   -- the role that made it (attribution survives role changes)
decided_at
reason            -- mandatory, human-written, never auto-filled
evidence_ids      -- what the decision was made on
policy_version    -- WHICH RULES produced it            <- from vehicle_seller_authority
basis             -- WHY the decision was reachable     <- from vehicle_seller_authority
supersession      -- revoked_at / superseded_by, never a silent overwrite
```

Plus the two behavioural rules M0–M7 proved:

- **Audit before effect, fail closed.** A decision that cannot be attributed does not happen.
- **The actor may not decide on their own submission** (the `CLASSIFICATION_CORRECTION_SELF` rule).

`vehicle_seller_authority` is the reference implementation.

### 10.3 Explicitly rejected as horizontal

Teams · SLA framework · dead-letter/recovery · public customer messaging · a generic case table ·
generic assignment · a generic "entity authority".

---

## 11. Standing laws confirmed

1. **Operations orchestrates; domain services own truth.** The Vehicle Operations aggregate is a
   read model; every mutation calls the owning service. This held through certification and is the
   reason M8 rejects a stateful case table.
2. **Audit is fail-closed and precedes effect.**
3. **Privacy:** private artifacts stay private; publishing a source document is a governed decision,
   never an uploader preference; reviewer identity and internal reasoning never reach a public
   payload.
4. **AI/governance:** AI output is advisory only. It may never become a governed fact without a
   human governed decision (`recordGovernedTrustChange` remains the only path).
5. **Capabilities are server-authoritative** and derive from `platformRole`/`baseRole` only.
6. **A derived public value must be re-materialised at the moment it becomes public.**

---

## 12. Migration implications

**None.** M8 creates no table, no column, no migration, and changes no product code. The two approved
items are contracts that constrain future work.

The deferred items, if later approved, are all additive and reversible: the Work Index is a
rebuildable projection; capability grants are additive to a static map that already fails closed.

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Vocabulary drift continues (a 6th name for "assigned") | Medium | §5 naming contract adopted now |
| A future slice builds `operations_cases` anyway, unaware | **High** | This ADR is the reference; the manual's Post-Serena section points here |
| `review_tasks` stays a half-generic table nobody adopts | Medium | Re-evaluate after two slices; narrow it to governance rather than generalise it |
| SLA applied to external-authority waits, publishing false blame | **High** | §6 derivation law: the clock runs only in `carup_review` |
| The static capability map is stretched to cover specialists by adding top-level roles | **High** | §8 constraints; specialists get grants, never new `UserRole`s |
| Ownership transfer does not revoke prior Seller Authority | Medium | Recorded in §9; integration point for O2 |
| Deferred decisions are read as "no" and quietly re-litigated | Medium | Each deferral above carries an explicit re-open trigger |

---

## 14. Deferred questions

1. Does `review_tasks` get adopted by a second writer, or narrowed to governance?
2. What is CarUp's actual response promise for evidence review? (A product commitment, not an
   engineering one — nobody has made it, so no SLA can encode it.)
3. Should a decision *timeline* be stored per governed record rather than reconstructed from audit?
4. When ownership transfers, what supersedes the prior Seller Authority, and who triggers it?
5. Do specialists need tenant-scoped operations capabilities, or platform-only?
6. Should `who_must_act` be persisted, or stay derived at read time? (Derived today; persisting it
   creates a staleness risk — the very failure mode of §2.4.)

---

## 15. Implementation sequencing

1. **Now (this ADR):** contracts recorded. No code.
2. **Next slice (O2):** conform new records to §10.2; use §10.1 vocabulary for any new
   waiting-state; link ownership transfer → Seller Authority supersession.
3. **On the second real multi-domain queue:** revisit the Work Index (§7) and assignment (§5).
4. **On the first single-capability specialist:** implement §8 grants.
5. **Never without a second consumer:** extract `computeSlaState`.

---

## 16. M8.9 — Revised O2–O10 sequence

The original order assumed each slice was equally ready. It is not: three are blocked on code or
partners that do not exist, and two would each supply a *second consumer* that unlocks a deferred
decision.

**Recommended sequence:**

| # | Slice | Why here | Shared infra needed | Blocked by |
|---|---|---|---|---|
| 1 | **O2 People & Compliance** | Identity already has `caseWorkflow`, `verification_decisions` and a real review surface — the most complete non-Communications Operations domain. Supplies the **second consumer of `who_must_act`**, which is what justifies extracting it. Also the natural home for ownership-transfer → authority supersession. | §10 contracts only | nothing |
| 2 | **O3 Marketplace Safety & Fraud** | `fraud_cases`, moderation and inquiry assignment exist; `fraud_cases` is thin (no notes, no reviewer attribution) and is the clearest beneficiary of the §10.2 decision contract. Publication-blocking is already wired from M3. | §10.2 | nothing |
| 3 | **O4 Customer Operations** | Only now do assignment and SLA have two or more real consumers, so the §5/§6/§7 deferrals can be **decided with evidence instead of guessed**. Communications is mature enough to be the donor. | Assignment decision; possibly Work Index | O2, O3 |
| 4 | **O10 Security & Platform Operations** | Access review is where persistent capabilities become real; needs O2's operator provisioning to review anything. Feature Governance and audit search already exist, so the slice is mostly consolidation. | §8 capability grants | O2 |
| 5 | **O6 Finance Operations** | Partial backend exists. Introduces the first true `external_authority` wait on a commercial counterparty. CarUp must not issue lender decisions. | §10 contracts; external-authority pause | partner contracts |
| 6 | **O7 Insurance Operations** | Same shape as O6, thinner backend. | as O6 | insurer integrations |
| 7 | **O8 Transaction / SafePay** | `disputes` exists but the manual requires live escrow authority first. | §10.2; dispute linkage | live SafePay/escrow authority |
| 8 | **O5 Service Network** | **Backend is largely absent** — `workOrdersRoutes.js` is 91 lines and `mechanic_work_orders` has no operations semantics. This is a *build*, not an *operations slice*. Ordering it 5th originally assumed a backend that does not exist. | domain build first | Service Network backend |
| 9 | **O9 Government / Provider Operations** | Highest external dependency: CVR, ZIMRA, CID/ZRP. External source is authoritative; nothing here can be certified without real integrations. | external-authority semantics | signed authority integrations |

**Dependency graph:**

```
                 O2 People/Identity ──────┬──────────────► O4 Customer Ops
                        │                 │                     │
                        │                 └───► O3 Safety/Fraud ┘
                        │
                        └───► O10 Security/Platform Ops

  O6 Finance ─┐
  O7 Insurance┼─► need §10 contracts + external-authority pause (independent of O4)
  O8 SafePay ─┘   O8 additionally needs live escrow authority

  O5 Service Network  ─► needs a domain BUILD first, not an operations slice
  O9 Government       ─► needs external integrations first
```

**Can proceed independently:** O2, O3 (and O6/O7 discovery work, once §10 contracts are adopted).
**Requires persistent capabilities:** O10, and O5/O7 when specialists appear.
**Requires the Work Index (if approved):** O4 only.
**Should remain domain-native:** fraud scoring, trust decisions, publication, payment state,
registration truth, insurance claims — in every slice.
**Requires external partners first:** O5 (build), O8 (escrow authority), O9 (government).

Each remains a bounded vertical slice with its own certification. None of them is a licence to build
shared infrastructure ahead of its second consumer.

---

## 17. Decision status

| Decision | Status |
|---|---|
| `who_must_act` vocabulary contract | **APPROVE** (documentation contract, no code) |
| Governed decision-record contract | **APPROVE** (documentation contract, no code) |
| Assignment naming contract | **APPROVE** (documentation contract, no code) |
| Shared assignment model | **DEFER** — trigger: O4, or a second real multi-operator queue |
| Horizontal SLA framework | **REJECT** |
| SLA pause-derivation law | **APPROVE** (documentation contract) |
| Extract `computeSlaState` to shared | **DEFER** — trigger: a second domain with a real clock |
| Stateful `operations_cases` | **REJECT** |
| Read-only Operations Work Index | **DEFER** — trigger: one operator, two domains, one surface |
| Persistent operations capabilities | **DEFER** — trigger: the first single-capability specialist |
| Seller Authority stays domain-specific | **APPROVE** |
| Generic "entity authority" | **REJECT** |

**M8 changed no product code. The M0–M7 certification at `f25ea5c6` is unaffected.**
