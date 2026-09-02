# CarUp Operations Control Plane — Implementation Progress & Roll-Call

**Status:** NOT STARTED — this tracker must be updated during execution  
**Canonical manual:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md  
**Benchmark appendix:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md  
**Claude start prompt:** docs/agent-prompts/CARUP_OPERATIONS_CONTROL_PLANE_SERENA_CLAUDE_START_PROMPT.md  
**Seed branch:** feat/operations-control-plane-serena-slice  
**Seed base:** 569e4f14c3fa022d942a41a57751fa3834def756  
**Primary UAT vehicle:** GFC27-027051

---

## Tracker law

This file is the execution roll-call.

Claude Code and any later implementation agent must update it **in the same work session** whenever a task changes state.

State markers:

- [ ] not started / not proven
- [~] in progress
- [x] cleared with evidence
- [!] blocked by a genuine external or mandatory stop condition

A task is not cleared because code exists.

For every [x], add evidence in the Evidence Register at the bottom:

- commit/SHA;
- test name/run;
- route/API;
- migration if any;
- screenshot/UAT receipt when applicable.

Do not skip a task silently. If a task becomes unnecessary because current code already solved it, mark [x] and cite the current implementation/test proving it.

Do not call the Serena slice certified until every M0–M7 mandatory item is [x] or an explicitly approved [!] exception.

---

# M0 — Revalidate exact implementation state

- [ ] M0.1 Record current branch.
- [ ] M0.2 Record current HEAD SHA.
- [ ] M0.3 Record merge base.
- [ ] M0.4 Confirm working tree clean or account for all changes.
- [ ] M0.5 Inspect open PRs touching Seller/Passport/Governance/Marketplace/Communications/Service Network.
- [ ] M0.6 Compare current HEAD with seed base 569e4f14.
- [ ] M0.7 Confirm active implementation target/merge lane.
- [ ] M0.8 Confirm current staging frontend/backend provenance before any staging mutation.
- [ ] M0.9 Inspect current seller-claim flow end to end.
- [ ] M0.10 Inspect completeness evaluator.
- [ ] M0.11 Inspect evidence taxonomy + upload contract.
- [ ] M0.12 Inspect Evidence Review authorization.
- [ ] M0.13 Inspect Trust Review/Governance Review.
- [ ] M0.14 Inspect Fraud/Marketplace moderation.
- [ ] M0.15 Inspect public evidence projection.
- [ ] M0.16 Inspect relevant migrations and staging apply state.
- [ ] M0.17 Read Serena vehicle row without mutation.
- [ ] M0.18 Read all Serena evidence rows without mutation.
- [ ] M0.19 Record legacy evidence_type + canonical class/subtype per Serena item.
- [ ] M0.20 Record Serena evidence visibility + verification state.
- [ ] M0.21 Record Serena extractions/conflicts.
- [ ] M0.22 Record Serena Seller authority claim/current relationship.
- [ ] M0.23 Record Serena registration status + provenance.
- [ ] M0.24 Record Serena fraud/governance/trust state.
- [ ] M0.25 Record current completeness result.
- [ ] M0.26 Add current-state delta notes below.
- [ ] M0.27 Confirm no Serena write occurred during M0.

### M0 current-state delta

| Manual assumption | Current code/state | Same / changed | Required response |
|---|---|---|---|
| | | | |

---

# M1 — Canonical evidence semantics

- [ ] M1.1 Define one canonical semantic classification helper/policy.
- [ ] M1.2 Canonical class/subtype wins when present.
- [ ] M1.3 Legacy evidence_type remains compatibility metadata only.
- [ ] M1.4 Legacy-only historical rows remain readable.
- [ ] M1.5 Import/commercial_invoice cannot count as registration.
- [ ] M1.6 Import/transit_declaration cannot become TIP.
- [ ] M1.7 Import/export_certificate cannot become Zimbabwe registration.
- [ ] M1.8 Registration/registration_book is recognized correctly.
- [ ] M1.9 Evidence upload UX no longer forces semantically wrong legacy category for a PDF.
- [ ] M1.10 Evidence review displays canonical class/subtype.
- [ ] M1.11 Passport/timeline displays canonical class/subtype.
- [ ] M1.12 Private/restricted visibility preserved.
- [ ] M1.13 Classification correction is governed/audited if required.
- [ ] M1.14 Historical ambiguous records are not blindly rewritten.
- [ ] M1.15 Serena BE FORWARD invoice correctly classified.
- [ ] M1.16 Serena payment receipt correctly classified.
- [ ] M1.17 Serena Bill of Lading correctly classified.
- [ ] M1.18 Serena Japanese Export Certificate correctly classified.
- [ ] M1.19 Serena Tanzania T1 correctly classified.
- [ ] M1.20 Serena CBCA/Cotecna correctly classified.
- [ ] M1.21 Kingstone identity remains in identity/restricted authority context, not buyer-public Vehicle Life evidence.
- [ ] M1.22 Backend canonicalization tests green.
- [ ] M1.23 Public privacy projection tests green.

---

# M2 — Seller Authority governance

- [ ] M2.1 Reuse/harden existing seller-claim contract rather than duplicate it.
- [ ] M2.2 Separate Seller authority from Zimbabwe registration.
- [ ] M2.3 Document chosen Seller authority state model.
- [ ] M2.4 Existing owner/current-seller/tenant recognition preserved.
- [ ] M2.5 Permanent-import evidence-set policy implemented.
- [ ] M2.6 Locally registered evidence-set policy preserved.
- [ ] M2.7 Dealer/tenant authority remains scoped.
- [ ] M2.8 No self-approval.
- [ ] M2.9 Conflict with another seller/owner fails closed.
- [ ] M2.10 Disputed/revoked authority handled.
- [ ] M2.11 Evidence basis stored/audited.
- [ ] M2.12 Decision reason required where policy requires it.
- [ ] M2.13 Idempotency/concurrency safe.
- [ ] M2.14 Seller notification path safe.
- [ ] M2.15 Public wording does not claim legal title/CVR verification.
- [ ] M2.16 Serena Seller authority can be reviewed without fake CVR/TIP.
- [ ] M2.17 Seller authority backend tests green.
- [ ] M2.18 Cross-user/cross-tenant negative tests green.

---

# M3 — Publication completeness reconciliation

- [ ] M3.1 Legacy registration_document alone no longer drives ownership/registration gate.
- [ ] M3.2 Seller authority is a distinct publication requirement.
- [ ] M3.3 Zimbabwe registration readiness remains distinct.
- [ ] M3.4 Permanent-import pending stages can be non-blocking when policy allows.
- [ ] M3.5 locally_registered enforces local registration requirements.
- [ ] M3.6 TIP remains separate special state.
- [ ] M3.7 unknown stage fails closed as designed.
- [ ] M3.8 unresolved material extraction conflict blocks.
- [ ] M3.9 blocking fraud/governance state blocks.
- [ ] M3.10 finance disclosure remains non-blocking unless a separate transaction rule says otherwise.
- [ ] M3.11 insurance state does not fabricate Trust/public clearance.
- [ ] M3.12 refusal response distinguishes missing vs pending vs external vs conflict.
- [ ] M3.13 Serena-like publication matrix unit tests green.
- [ ] M3.14 Existing Seller lifecycle regression tests green.

---

# M4 — Vehicle Operations Review workspace

- [ ] M4.1 Register governed Vehicle Operations route.
- [ ] M4.2 Add reviewer read model/aggregator without new canonical truth.
- [ ] M4.3 Vehicle identity section.
- [ ] M4.4 Seller/account section.
- [ ] M4.5 Zimbabwe registration section with provenance.
- [ ] M4.6 Evidence grouping by canonical class.
- [ ] M4.7 Extraction/reconciliation section reuses canonical service.
- [ ] M4.8 Seller Authority section reuses canonical service.
- [ ] M4.9 Trust/Governance section reuses canonical services.
- [ ] M4.10 Fraud/Risk section reuses canonical services.
- [ ] M4.11 Publication readiness requirement matrix.
- [ ] M4.12 Audit section.
- [ ] M4.13 Communications links/context safe.
- [ ] M4.14 Server-derived allowed_actions.
- [ ] M4.15 No direct arbitrary Trust mutation.
- [ ] M4.16 No fake ZIMRA/CVR action.
- [ ] M4.17 No routine Admin auto-publish action.
- [ ] M4.18 Restricted artifact paths/URLs cannot leak.
- [ ] M4.19 Proven-session requirement enforced.
- [ ] M4.20 Wrong-role access denied.
- [ ] M4.21 Component/web tests green.
- [ ] M4.22 Desktop responsive test green.
- [ ] M4.23 Tablet responsive test green.
- [ ] M4.24 Mobile responsive test green.

---

# M5 — First bounded Operations capability layer

- [ ] M5.1 Central Operations authorization policy/service created or current equivalent proven.
- [ ] M5.2 Vehicle evidence review capability defined.
- [ ] M5.3 Seller authority review capability defined.
- [ ] M5.4 Vehicle private-read capability defined.
- [ ] M5.5 Platform Admin compatibility defined.
- [ ] M5.6 Super Admin compatibility defined.
- [ ] M5.7 Government capability scope defined.
- [ ] M5.8 Tenant role cannot escalate to platform operator.
- [ ] M5.9 New routes use capability policy.
- [ ] M5.10 Public registration cannot mint privileged operator.
- [ ] M5.11 Safe staging operator provisioning documented.
- [ ] M5.12 Authz adversarial tests green.

---

# M6 — Operations navigation / information architecture

- [ ] M6.1 Operations groups defined in navigation.
- [ ] M6.2 People group.
- [ ] M6.3 Vehicles & Trust group.
- [ ] M6.4 Marketplace group.
- [ ] M6.5 Communications group.
- [ ] M6.6 Growth/Diaspora group.
- [ ] M6.7 Platform group.
- [ ] M6.8 Fraud Queue discoverability corrected where appropriate.
- [ ] M6.9 Dealer Compliance discoverability corrected where appropriate.
- [ ] M6.10 Governance Review discoverability corrected where appropriate.
- [ ] M6.11 government governance route/layout mismatch resolved or explicitly deferred.
- [ ] M6.12 reviewer/UserRole mismatch resolved or explicitly bounded.
- [ ] M6.13 platform_admin/super_admin frontend route compatibility resolved.
- [ ] M6.14 No fabricated Operations metrics introduced.
- [ ] M6.15 Navigation tests green.
- [ ] M6.16 Mobile navigation tests green.

---

# M7 — Serena real staging review → Seller publish

- [ ] M7.1 Exact staging frontend SHA recorded.
- [ ] M7.2 Exact staging backend SHA recorded.
- [ ] M7.3 unpaired=false proven.
- [ ] M7.4 Authorized Operations test account session proven.
- [ ] M7.5 Serena Vehicle Operations page loads.
- [ ] M7.6 Serena canonical evidence grouping correct.
- [ ] M7.7 Serena private identity/payment docs remain restricted.
- [ ] M7.8 Serena evidence decisions completed as appropriate.
- [ ] M7.9 Serena extraction conflicts resolved or proven absent.
- [ ] M7.10 Serena Seller authority reviewed.
- [ ] M7.11 Serena actual registration stage/provenance confirmed.
- [ ] M7.12 No fake local plate.
- [ ] M7.13 No fake TIP.
- [ ] M7.14 No unsupported CVR claim.
- [ ] M7.15 No unsupported ZIMRA/customs claim.
- [ ] M7.16 No blocking fraud/governance case.
- [ ] M7.17 Completeness recalculated.
- [ ] M7.18 Serena becomes publishable legitimately.
- [ ] M7.19 Canonical Trust state recorded.
- [ ] M7.20 Sign in as existing Kingstone account.
- [ ] M7.21 Existing Serena draft loads — no duplicate Serena.
- [ ] M7.22 Seller sees truthful pending-registration state.
- [ ] M7.23 Kingstone clicks Publish.
- [ ] M7.24 Marketplace card visible.
- [ ] M7.25 Marketplace Vehicle Detail visible.
- [ ] M7.26 Passport public projection truthful.
- [ ] M7.27 Raw restricted source files inaccessible to buyer.
- [ ] M7.28 Buyer inquiry functional.
- [ ] M7.29 Seller receives/manages inquiry.
- [ ] M7.30 Unpublish works.
- [ ] M7.31 Republish works.
- [ ] M7.32 Desktop UAT PASS.
- [ ] M7.33 Tablet UAT PASS.
- [ ] M7.34 Mobile UAT PASS.
- [ ] M7.35 Accessibility PASS.
- [ ] M7.36 Affected backend gates green.
- [ ] M7.37 Affected web gates green.
- [ ] M7.38 Vehicle Passport gates green.
- [ ] M7.39 Marketplace gates green.
- [ ] M7.40 Communications gates green.
- [ ] M7.41 Seller Golden lifecycle green.
- [ ] M7.42 CI matrix green.
- [ ] M7.43 Final candidate SHA frozen.
- [ ] M7.44 Final report written.
- [ ] M7.45 Owner UAT instructions written.
- [ ] M7.46 PR remains unmerged pending owner approval.

---

# M8 — Extract proven reusable Operations patterns

Do not execute M8 as a reason to delay Serena owner UAT. M8 can begin after the M7 candidate is frozen.

- [ ] M8.1 Compare Vehicle Operations workflow with Communications workflow.
- [ ] M8.2 Decide whether assignment is common enough to extract.
- [ ] M8.3 Decide whether SLA is common enough to extract.
- [ ] M8.4 Decide whether generic operations_cases is justified.
- [ ] M8.5 Decide whether persistent operations memberships/capabilities are justified.
- [ ] M8.6 Decide whether Seller Authority needs dedicated table/service beyond current implementation.
- [ ] M8.7 Record reusable pattern ADR/decision.
- [ ] M8.8 Update canonical manual current-state section.
- [ ] M8.9 Update future O2–O10 sequencing.

---

# Future Operations adoption matrix

| Domain | Current state at execution | Target slice | Status | Notes |
|---|---|---|---|---|
| Vehicle Operations | | Serena M0–M7 | [ ] | |
| People / Customer Ops | | O2 | [ ] | |
| Identity | | O2 | [ ] | |
| Seller Compliance | | O2 | [ ] | |
| Dealer Compliance | | O2 | [ ] | |
| Marketplace Safety | | O3 | [ ] | |
| Risk/Fraud | | O3 | [ ] | |
| Customer Communications | | O4 | [ ] | |
| Disputes/Resolution | | O4 | [ ] | |
| Service Network | | O5 | [ ] | |
| PartSentry Governance | | O5 | [ ] | |
| Finance | | O6 | [ ] | |
| Insurance | | O7 | [ ] | |
| Transaction / SafePay | | O8 | [ ] | |
| Government/provider operations | | O9 | [ ] | |
| Security/Audit | | O10 | [ ] | |
| Platform/Feature Governance | | O10 | [ ] | |

---

# Evidence Register

Append one row for every cleared item or logically grouped set of items.

| Task(s) | SHA / file / migration | Test or UAT evidence | Result | Notes |
|---|---|---|---|---|
| | | | | |

---

# Mandatory blocker register

| Task | Blocker | Evidence | Safe options | Owner decision needed? |
|---|---|---|---|---|
| | | | | |

---

# Final candidate record

**Branch:**  
**HEAD:**  
**PR:**  
**Staging URL:**  
**Frontend SHA:**  
**Backend SHA:**  
**Unpaired:**  
**Serena publishable:**  
**Serena published:**  
**Owner UAT ready:**  
**Merge ready:**  
**Production touched:** NO unless explicitly authorized and recorded otherwise.