# Claude Code Start Prompt — CarUp Operations Control Plane / Serena Vehicle Operations

**Purpose:** Hand this file to Claude Code as the execution instruction for the first CarUp Operations Control Plane slice.  
**Canonical plan:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md  
**Execution tracker:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_PROGRESS.md  
**Benchmark research:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md  
**Seed branch:** feat/operations-control-plane-serena-slice  
**Seed base:** 569e4f14c3fa022d942a41a57751fa3834def756  
**Primary real UAT vehicle:** 2016 Nissan Serena Highway Star — GFC27-027051

---

# Instruction to Claude Code

You are implementing the **first governed CarUp Operations Control Plane slice**, not building a generic new Admin from scratch.

Your immediate objective is:

> Make the Serena a truthful, governed, publishable CarUp listing by creating the minimum Vehicle Operations capability that reconciles canonical evidence classification, Seller authority, Zimbabwe registration readiness, Trust/governance/risk and Marketplace publication — while preserving every existing source record, privacy contract and Seller lifecycle.

Do not shorten or reinterpret the canonical plan from memory.

Read it completely.

Do not assume that the seed SHA is still the current implementation HEAD.

The repository must be inspected first.

---

# 1. Before you change any code

Read, in this order:

1. docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md
2. docs/features/CARUP_OPERATIONS_CONTROL_PLANE_PROGRESS.md
3. docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md
4. docs/project-governance/MILESTONE_EXECUTION_PROTOCOL.md
5. docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md
6. docs/seller/ZIMBABWE_SELLER_REALITY_COMMUNICATIONS_HARDENING_PLAN.md
7. docs/seller/SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md
8. DESIGN.md
9. docs/CARUP_VERIFICATION_GOVERNANCE_AUDIT.md
10. docs/hardening/AUTHORITY_AUDIT_REGISTER.md
11. docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md
12. current Vehicle Passport lifecycle documentation
13. current Marketplace implementation/Trust documentation
14. current Communications canonical plan if Communications code is touched.

Then inspect:

- git status;
- current branch;
- current HEAD;
- merge-base;
- open PRs;
- branch/worktree overlap;
- current staging provenance if available.

Record the results in the progress tracker before changing product behavior.

If the active Seller/Passport integration branch has moved beyond the seed base, reconcile current code first. Do not overwrite newer correct work merely to match this prompt.

---

# 2. Understand what you are building

CarUp already has a substantial collection of privileged verticals.

You must treat these as existing domain authorities:

- Identity Verification;
- Vehicle Evidence Review;
- Trust Fact Review;
- Governance Review;
- Fraud Queue;
- Dealer Compliance;
- Marketplace Moderation;
- Communications Command Center;
- Feature Governance;
- Government portal;
- Bank/Finance portal;
- Insurance portal;
- Dealer portal;
- Mechanic/PartSentry foundations.

The new Vehicle Operations page is a **composed reviewer workspace** over these authorities.

It is not permission to create parallel truth.

Do not build duplicate services just because a combined UI needs their data.

---

# 3. Product laws you must preserve

These are mandatory:

1. Seller statement is not external verification.
2. CarUp review is not CVR/ZIMRA/bank/insurer authority.
3. Unknown is not clear.
4. Pending Zimbabwe registration is a lifecycle state, not automatically a Trust defect.
5. A legitimate permanent import can be listable before local registration is complete.
6. TIP is a separate temporary-foreign-vehicle state.
7. Tanzania T1 is transit evidence, never a Zimbabwe TIP.
8. Japanese chassis/frame identifiers must not be forced into a fake 17-character VIN.
9. One vehicle has one canonical Passport.
10. Commercial listing media is separate from Vehicle Life evidence.
11. Private identity/payment documents stay private.
12. AI may advise; governed decisions create state.
13. No self-certification.
14. Seller retains the final Publish action.
15. Platform Admin does not become government/lender/insurer authority.
16. Every consequential reviewer decision is attributable and audited.
17. Domain services remain canonical writers.
18. No fabricated dashboard metrics.

---

# 4. Serena source truth

Do not delete or re-upload Serena evidence simply to satisfy current gates.

Expected source pack:

- Kingstone identity/passport;
- BE FORWARD commercial invoice;
- PayPal purchase/payment receipt;
- House Bill of Lading;
- Japanese Export Certificate;
- Tanzania T1 through-transit declaration;
- Zimbabwe CBCA/Cotecna roadworthiness/inspection certificate.

Canonical intent:

~~~text
BE FORWARD invoice
→ import / commercial_invoice

PayPal receipt
→ import / payment_receipt

House Bill of Lading
→ import / bill_of_lading

Japanese Export Certificate
→ import / export_certificate

Tanzania T1
→ import / transit_declaration

CBCA/Cotecna
→ inspection / roadworthiness

Kingstone identity
→ Seller/account identity authority, restricted/private
~~~

The supplied pack does NOT by itself contain:

- Zimbabwe CVR registration book;
- Zimbabwe local plate record;
- Zimbabwe TIP.

Do not create or infer them.

---

# 5. Critical current-code issues to inspect first

The seed code showed the following.

You must verify whether each remains true.

## A. Dual evidence semantics

EvidenceUploadModal still requires legacy evidence_type even though the canonical Vehicle Life taxonomy has evidence_class + evidence_subtype.

This can produce records where:

~~~text
legacy type = registration_document
canonical class = import
canonical subtype = commercial_invoice
~~~

That contradiction must not drive public truth.

## B. Publication completeness still reads legacy types

The seed completeness evaluator can treat verified legacy registration_document / ownership_transfer_document as satisfying Ownership / Registration Document.

A Serena import invoice must never pass registration merely because a compatibility field says registration_document.

## C. Seller authority already exists partially

vehiclesRoutes already has seller-claim logic and SELLER_AUTHORITY_CLAIM_REQUESTED.

Do not start a second Seller-authority system until you have read this flow completely.

The current implementation may need extraction/hardening rather than replacement.

## D. Evidence review authority mismatch

The read queue can include dealer/mechanic in tenant scope, while verify/reject is admin/government.

The UI must not expose actions the backend refuses.

## E. Governance reviewer mismatch

Governance code recognizes reviewer, but shared UserRole may not.

This is a sign that operational capability is a separate dimension from stakeholder role.

## F. Platform authority mismatch

Backend understands admin/platform_admin/super_admin while frontend role model is narrower.

Handle deliberately.

## G. Government governance route mismatch

Registry and App route ownership may disagree.

## H. Service Network

At the seed SHA, the richer serviceNetwork backend did not exist on this branch.

Do not assume a concurrent Service Network PR has merged. Check current HEAD.

---

# 6. Execution mode

Use the canonical manual's M0–M7 sequence.

Do not skip directly to UI.

Use the progress tracker continuously.

When a task is genuinely proven, change it to [x] and add evidence.

When a task is active, use [~].

When a genuine external/security blocker exists, use [!] and record it in the blocker register.

Do not leave tasks as [ ] after you have implicitly changed them.

---

# 7. Recommended /goal

Use the equivalent of:

> Implement the CarUp Operations Control Plane Serena Vehicle Operations slice from the canonical manual. Revalidate current HEAD first. Preserve the current Seller/Passport/Marketplace/Communications contracts. Make canonical evidence class/subtype authoritative over legacy compatibility semantics, establish a governed Seller Authority decision separate from Zimbabwe registration, reconcile publication completeness, build a VIN-centered Vehicle Operations reviewer workspace, introduce bounded server-side Operations capability authorization for the new paths, run all affected regression/staging gates, and finish only when the existing Serena can be reviewed and truthfully published by Kingstone without fake CVR, plate, TIP, ZIMRA or private-document exposure. Update docs/features/CARUP_OPERATIONS_CONTROL_PLANE_PROGRESS.md after every cleared task. Do not merge.

---

# 8. Recommended /loop behavior

Loop through:

~~~text
M0 discovery
→ M1 canonical evidence
→ M2 Seller Authority
→ M3 publication completeness
→ M4 Vehicle Operations
→ M5 bounded capability layer
→ M6 Operations navigation
→ M7 Serena staging UAT
~~~

At the end of each milestone:

1. run milestone-specific tests;
2. update the progress tracker;
3. commit coherent work;
4. inspect diff for accidental scope expansion;
5. proceed immediately to the next independent milestone.

Do not stop merely to give a progress update.

Stop only for a mandatory stop condition.

If one non-global item is blocked, continue independent tasks and record the blocker.

---

# 9. Implementation boundaries

## You MAY

- refactor existing Seller-authority logic into a canonical service;
- add an additive schema if current structures cannot safely model the required state;
- add a governed evidence-classification correction;
- change evidence upload/review UX to use canonical class/subtype;
- change completeness requirements to use semantically correct predicates;
- add a Vehicle Operations read model and page;
- add centralized Operations capability policy for new/modified routes;
- fix role/navigation mismatches that directly affect this slice;
- add tests, migrations, docs and staging UAT fixtures necessary for the slice.

## You MUST NOT

- invent Serena facts;
- delete Serena's source evidence;
- create a second Serena;
- relabel T1 as TIP;
- relabel Japanese Export Certificate as Zimbabwe registration;
- use a fake plate;
- claim ZIMRA/CVR confirmation without an authoritative source;
- expose passport/payment source files publicly;
- allow Seller self-approval;
- allow tenant role escalation into global Operations;
- add arbitrary Trust score editing;
- make Admin auto-publish as the normal flow;
- treat active finance as automatic Trust failure;
- fabricate insurance/bank/government operations data;
- complete unrelated Service Network/Insurance/SafePay programmes;
- merge the PR.

---

# 10. Schema decision rule

Prefer existing structures.

Before adding a Seller Authority table, prove why the current seller-claim + audit/governance structures cannot satisfy:

- current state;
- supersession;
- evidence basis;
- reviewer attribution;
- dispute/revocation;
- idempotency/concurrency.

Before adding operations_cases, STOP.

operations_cases is intentionally deferred until M8 after Serena proves the workflow.

A generic workflow engine is not part of this first slice.

---

# 11. Authorization design rule

Do not add more raw role checks everywhere.

Create or reuse one Operations authorization policy layer for new/modified paths.

It should evaluate:

- proven session;
- base platform authority;
- operating capability;
- tenant/resource scope;
- emergency platform override.

During migration, existing admin/government roles may map to capabilities for compatibility, but the new code must speak in capability terms.

Do not use the public registration UI to create a privileged operator.

For staging, use only an approved safe operator-provisioning method and document it.

---

# 12. Vehicle Operations UI contract

The Vehicle Operations page should answer:

- What vehicle is this?
- Who is selling it?
- What is the Seller Authority state?
- What Zimbabwe registration stage is recorded?
- What is the provenance of that stage?
- What evidence exists?
- What does each evidence item actually represent?
- What document conflicts remain?
- What Trust/governance findings exist?
- What fraud/risk findings exist?
- What publication requirements are missing/pending/cleared?
- Who must act next?
- What can this operator do?
- What will a buyer see?

Do not make the page a dashboard of decorative statistics.

---

# 13. Required tests

At minimum:

## Evidence semantics

- canonical import/commercial_invoice cannot satisfy registration;
- transit_declaration cannot be TIP;
- export_certificate cannot be local registration;
- legacy-only historical row fallback works;
- private evidence does not leak.

## Seller Authority

- recognized existing relationship;
- import evidence-set review;
- no self-approval;
- conflict blocks;
- cross-user/tenant denial;
- revoke/dispute behavior;
- one Passport.

## Publication

- permanent import pending + Seller Authority confirmed can publish when all other blockers clear;
- unknown registration stage blocks correctly;
- locally_registered enforces local requirements;
- fraud block respected;
- extraction conflict respected;
- finance disclosure is not automatic publication block.

## Operations auth

- wrong role denied;
- tenant role cannot escalate;
- x-user-id fallback cannot access private reviewer capability;
- platform compatibility tested.

## Public privacy

- raw restricted document URL not returned to buyer;
- no verification/security token leak;
- public copy provenance correct.

## Browser UAT

- desktop;
- tablet;
- mobile Chromium;
- operator review;
- Kingstone publish;
- Marketplace;
- Vehicle Detail/Passport;
- inquiry;
- unpublish;
- republish.

Run all existing affected Seller, Passport, Marketplace, Communications and navigation gates.

Do not omit the long Golden Seller lifecycle.

---

# 14. Staging discipline

Before any real Serena staging mutation:

- prove the environment is staging;
- prove frontend and backend belong to the same candidate;
- record SHA pairing;
- ensure no production URL/database is targeted;
- preserve current Serena source rows.

After every reviewer decision, verify the canonical state that changed and the public state that did not leak.

---

# 15. Mandatory stop conditions

Stop and report if:

- production write is required;
- destructive migration is required;
- private evidence exposure is possible;
- current HEAD has a conflicting canonical implementation and safe reconciliation is unclear;
- a security-boundary role decision is ambiguous;
- live external provider credentials/authority are required;
- Serena staging records materially contradict the known source pack and the discrepancy cannot be resolved from current evidence;
- a required gate remains failing after in-scope repair;
- progress would require inventing a fact.

A blocker report must include exact evidence and safe options.

---

# 16. Completion standard

Do not call the slice done because the new page renders.

It is done only when:

- evidence semantics are correct;
- Seller Authority is governed separately;
- completeness is truthful;
- Vehicle Operations works;
- bounded authorization is real;
- privacy is proven;
- Serena is legitimately publishable;
- Kingstone performs the final Publish;
- Marketplace/Passport are truthful;
- buyer cannot access restricted raw docs;
- regressions are green;
- exact deployed SHA pairing is proven;
- progress tracker is complete;
- final implementation report follows the 53-point format in the canonical manual;
- PR remains unmerged for owner approval.

---

# 17. Final reminder

The goal is not:

> Make the Serena pass the current gate.

The goal is:

> Make the gate represent the real rule, make the review represent the real authority, and then let the Serena pass only because the real facts satisfy that rule.

That is the first CarUp Operations Control Plane proof.