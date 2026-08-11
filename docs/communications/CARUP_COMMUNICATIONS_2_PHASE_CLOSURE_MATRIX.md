# CarUp Communications 2.0 — Phase Closure Matrix

**Canonical contract:** `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`  
**Implementation lane:** PR #148 / `feat/communications-2-0-implementation`  
**Canonical staging Supabase:** `eoyenigwevnxwwhyhaer`

This matrix separates **product/source completion** from **staging/provider/physical certification**. A phase is not represented as physically accepted when only mocks, disposable PostgreSQL, queue acceptance or source tests exist.

| Phase | Canonical plan outcome | Source / DB implementation | Staging / physical acceptance |
|---|---|---|---|
| **0 — Reconcile source** | Preserve proven transports; remove duplication; choose canonical implementation line | **Implemented.** Existing provider adapters, queue/worker/webhooks and transport evidence remain inside one canonical Communications factory. | Revalidate provider secrets/runtime health on the exact deployed staging head. |
| **1 — Canonical conversation core** | Multi-party participants, auth, identities, bindings, exact content, preferences, audit/reliability | **Implemented.** Explicit participants; participant RLS; internal-note privacy; identities/bindings; consent separation; quiet hours; one-primary routing; fallback; receipts; retry/dead-letter; exact original content. | Apply/verify migrations 315–323 on CarUp staging. |
| **2 — Marketplace reference flow** | Buyer inquiry → seller CarUp → WhatsApp → same conversation return | **Implemented in source/DB.** Marketplace inquiry + communication event are atomic/exactly-once; provider reply context resolves exact canonical conversation. | **Physical Marketplace↔WhatsApp UAT required.** HTTP/provider acceptance alone is not PASS. |
| **3 — Template + brand system** | Governed templates, versions, approvals, branding, provider mapping | **Implemented in CarUp governance.** DB registry is runtime-authoritative and fail-closed. Business-initiated WhatsApp requires provider-approved reference outside service window. | Real Meta-approved template reference and official brand assets remain external configuration/authorization. |
| **4 — Analytics + conversion intelligence** | Funnel, attribution, delivery, response time and conversion metrics | **Implemented.** Workflow/funnel, Marketplace inquiry→next-step, first-response average/median/P95, delivery outcomes, acquisition/referral/campaign attribution, AI assists and campaign conversion evidence. | Validate populated metrics on migrated staging data. |
| **5 — AI + multimodal** | Summaries/translations/drafts plus voice/image/document/video/location and safe AI interpretation | **Implemented in candidate source.** Private signed Supabase artifacts; canonical `message_parts`; image/audio/video/document/location rendering; browser voice recording; Gemini multimodal interpretation; intent/entities/next action as derived artifacts only; no AI send/execute primitive. | Staging private bucket + Gemini credential/health + real media/voice/location UAT required. |
| **6 — Stakeholder workflows** | Reuse same conversation contract for broader CarUp domains | **Implemented in candidate source.** Enforced contracts for Marketplace, dealer, garage, parts, insurance, finance, diaspora import, container logistics, referral, government/public service, trust/safety and support. Regulated/official paths force draft/human AI posture. | Run domain-specific staging reference UAT, minimum dealer, garage, insurance, finance and diaspora/logistics. |
| **7 — Growth / campaign orchestration** | Consented segments, attribution, governed campaigns, frequency controls, experiments, re-engagement and ROI | **Implemented in candidate source/DB.** Campaign ledger + recipient evidence; marketing-template-only enforcement; explicit segments; marketing/channel consent; frequency cap; deterministic A/B; idempotent execution; canonical notifications/events; conversion and ROI reporting; delivery status sync from canonical queue. | Apply migration 323 and execute a safe consented staging campaign with test users before any production enablement. |

## Database chain

1. `20260811131500_communications_2_conversation_core.sql`
2. `20260811131600_communications_2_delivery_monotonicity.sql`
3. `20260811131700_communications_2_workflow_template_foundations.sql`
4. `20260811131800_communications_2_participant_auth_hardening.sql`
5. `20260811131900_communications_2_privacy_binding_hardening.sql`
6. `20260811132000_communications_2_template_runtime_registry.sql`
7. `20260811132100_communications_2_reliability_closure.sql`
8. `20260811132200_communications_2_product_capabilities.sql`
9. `20260811132300_communications_2_completion.sql`

The staging runner freezes exact Git-blob bytes for all nine migrations and refuses database URLs that do not positively contain `eoyenigwevnxwwhyhaer`.

## Final Definition-of-Done gates

Source implementation is **not** the same as full Communications 2.0 acceptance. Full program closure requires:

1. Exact reviewed PR head: Communications unit + real PostgreSQL + Referral + Diaspora/Playwright regression PASS.
2. Migrations **315–323** applied and verified on canonical CarUp staging `eoyenigwevnxwwhyhaer`.
3. Communications staging health uses real reviewed worker/provider configuration rather than fake external adapters.
4. Real Meta provider template reference configured for business-initiated WhatsApp.
5. Gemini staging health real/available for AI acceptance.
6. Marketplace physical reference chain passes on a real buyer WhatsApp device and returns to the **same** CarUp conversation.
7. Phase 5 real media/voice/location staging UAT passes.
8. Required Phase 6 stakeholder reference flows pass staging UAT.
9. A consented Phase 7 staging campaign proves suppression/frequency/attribution/conversion evidence without production writes.

Production application remains a separate owner-authorized release decision.
