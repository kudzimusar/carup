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

## Staging certification run — PR head `cf33837` (2026-08-12)

Exact-head deployment to the dedicated staging projects, then live certification against
canonical staging `eoyenigwevnxwwhyhaer`. Nothing below is asserted from mocks, source
tests or HTTP acceptance alone; each row states the evidence that produced it.

| Gate | Status | Evidence |
|---|---|---|
| Source CI on exact head | **SOURCE PASS** | CI / Communications / Diaspora / Referral / Navigation all green; `node --test backend/tests/*.test.js` = 2771 tests, 2759 pass, 0 fail, 12 skipped |
| Migrations 315–323 | **DB PASS** | all nine versions recorded in `supabase_migrations.schema_migrations`; no migration edited by this run |
| Exact-SHA stable staging | **STAGING CONFIG PASS** | backend `dpl_8RxtuHEVXnLc2jraSXEjnWb3xRSN`, frontend `dpl_qMZ27AHptt8rSN1VxtN7xgYUB1fH`, both `target=production` with `meta.carupSourceSha` = the PR head |
| Frontend → staging backend (never production) | **STAGING CONFIG PASS** | live browser run: every API call resolved to `carup-backend-staging.vercel.app/api`; zero production-backend requests; bundle carries 8 staging refs and no production host |
| Engine runtime | **STAGING CONFIG PASS** | scheduler READY, `fakeAdapters.enabled=false`, WhatsApp + Telegram real adapters READY with correct webhook URLs |
| Canonical conversation core | **STAGING PASS** | conversation created, message accepted, participant read OK, non-participant denied read **and** send (404, no leak), no cross-tenant list leakage — 7/7 live |
| Exact original content | **STAGING PASS** | stored `content_text` byte-identical including Unicode; `original_authoritative=true`, `ai_derived=false`; classification stored separately as derived metadata |
| Governed template runtime | **STAGING PASS** | outbound reply carried `governed_template=true`, `template_key=message_acknowledgement_v1`, version + `template_version_id`, one primary channel with an explicit fallback list |
| Private media bucket | **STAGING CONFIG PASS** | `carup-communication-media` is `public=false`, 100 MB limit, image/audio/video/document MIME allow-list |
| Phase 7 governance schema | **DB PASS** | transactional and marketing consent separate, per-channel toggles, quiet hours, frequency cap, deterministic A/B variants, `idempotency_key`, `suppression_reason`, cost/conversion columns |
| Marketplace inquiry → outbox | **STAGING PASS** | real inquiry through the public product API returned 201 and wrote exactly one `marketplace.inquiry.created` row with a `dedupe_key`; the fail-closed write proved itself against real Supabase |
| Marketplace inquiry → canonical conversation | **BLOCKED — see D1** | the outbox row stays `pending`, `attempts=0`, never locked |
| Phase 2 physical WhatsApp round trip | **NOT CERTIFIED** | gated by D1 and by a physical recipient device |
| Meta provider template | **EXTERNALLY BLOCKED** | `conversation_reply_whatsapp_v1` is CarUp-approved but `provider_template_reference` is NULL, and no WhatsApp *marketing* template exists at all |
| Gemini / Phase 5 AI derivations | **EXTERNALLY BLOCKED** | `GEMINI_API_KEY` is absent from the `carup-backend-staging` production scope (absent, not merely sensitive) |
| Facebook, Instagram, Email, SMS, Push | **EXTERNALLY BLOCKED** | `CARUP_META_PAGE_ID`; `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`; `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_MESSAGING_SERVICE_SID`-or-`TWILIO_FROM_NUMBER` / `TWILIO_STATUS_CALLBACK_URL`; `EXPO_ACCESS_TOKEN` |

Aggregate `/api/communications/health` remains HTTP 503 **only** because those optional
providers are unconfigured. Core engine readiness and per-channel readiness are separate
facts: a 503 aggregate does not retract the WhatsApp/Telegram READY rows above, and those
rows do not amount to omnichannel certification.

### Defects found by this certification run

* **D1 — no `domain_events` drain in this branch (open, blocking Phase 2).**
  `eventWorker.start()` deliberately skips interval polling on Vercel and directs operators
  to a scheduled endpoint. That endpoint, `/api/internal/events/process`, does not exist in
  this branch: `/api/internal/communications/process` drains `notification_queue` only, and
  no database trigger materialises conversations. Canonical staging's pg_cron calls the
  events path every minute and receives HTTP 404. Probing the same path on the previously
  deployed runtime returns 401 (present, worker-secret guarded) against 404 here. The route,
  its pg_cron migration and its coverage tests are owned end-to-end by PR #139, which is
  open and diverged from `main` (ahead 58 / behind 35). `main` carries neither. Resolution is
  a merge-order decision, not a code change to duplicate here.
* **D2 — deliberate client statuses answered 500. Fixed in `b59f722`.** A participant who is
  not on a conversation received HTTP 500; the refusal was correct and fail-closed but was
  indistinguishable from an outage. `errorHandler` resolved a status only for `CarUpError`
  subclasses, discarding the numeric `statusCode` used by 13 files / 60 call sites. Verified
  live: that call now answers 404.
* **D3 — inbound referral attribution had no client. Fixed in `cf33837`.** Every inbound
  message stored `referral: { success: false, error: 'Referral repository requires a
  Supabase-compatible client.' }`. The gateway was built with `new ReferralEngineService()`
  and no client, and best-effort handling swallowed the throw. Verified live: the stored
  result is now a legitimate domain answer for the channel rather than a wiring failure.

## Post-#139 integration — PR head `7afec27` (2026-08-12)

PR #139 was merged by the owner (`main` @ `36c7df24`), so this branch absorbed the
event-fabric drain it had been blocked on and **D1 is now closed with physical staging
evidence**.

| Gate | Status | Evidence |
|---|---|---|
| Current-main integration | **SOURCE PASS** | merge of `f1724f1` + `36c7df24`; 2 conflicts, both resolved by union/semantics; 73 files, +4920 −19 |
| Source CI on exact head | **SOURCE PASS** | CI · Communications · Diaspora · Referral · Navigation all SUCCESS; backend 2816 tests / 2804 pass / **0 fail** / 12 skipped (baseline unchanged) |
| Repository gates | **SOURCE PASS** | PGlite migration verification exit 0; 11/11 diaspora ledger harnesses; web typecheck clean; web unit 799/799; web build OK |
| D1 route on stable staging | **STAGING CONFIG PASS** | `/api/internal/events/process` answers **401 (guarded)** where it answered 404 before |
| **D1 event fabric** | **PHYSICAL PASS** | see chain below |
| Backend stable staging | **STAGING CONFIG PASS** | `dpl_2ZdX7cwdKrfGeJFbJpoL4fRzQDeN`, `target=production`, alias `carup-backend-staging.vercel.app` |
| Frontend stable staging | **EXTERNALLY BLOCKED** | Vercel daily quota (`api-deployments-free-per-day`, >100/day, team-wide); still serving `cf33837`, which already targets the staging backend |
| Marketplace ↔ physical WhatsApp | **NOT CERTIFIED** | needs a real recipient device + a human confirm-and-reply |
| Meta provider template | **EXTERNALLY BLOCKED** | `provider_template_reference` still NULL; no WhatsApp *marketing* template exists |
| Gemini / Phase 5 AI | **EXTERNALLY BLOCKED** | `GEMINI_API_KEY` absent from the staging scope |
| Facebook · Instagram · Email · SMS · Push | **EXTERNALLY BLOCKED** | `CARUP_META_PAGE_ID`; SendGrid trio; Twilio quartet; `EXPO_ACCESS_TOKEN` |

### D1 physical chain — proven end to end

The Marketplace inquiry created during the previous certification run had been stuck
`pending / attempts=0` for eleven hours because no drain existed. Minutes after this
candidate reached stable staging, the live chain consumed it:

```
marketplace_inquiries 04aaf906-4565-43c7-b031-29ce4cd020ad   (2026-08-11 18:29 UTC)
  → domain_events 18cdddc6-cd3c-4e51-b0ec-0ded7c0b7fc9        pending → processed, attempts 1
  → Supabase pg_cron carup-events-outbox-every-minute → pg_net
  → https://carup-backend-staging.vercel.app/api/internal/events/process (worker-secret)
  → eventWorker.pollEvents() → communication listeners
  → message_threads f597615f-4c2f-478a-846a-cb018fe7ab4c      (2026-08-12 05:11:05 UTC)
      thread_key communications-2:marketplace_inquiry:04aaf906…
      primary_user_id = the listing's seller, business_workflow = marketplace
  → message_participants: exactly two, seller + buyer, each read+send
  → messages 42e26bde-692e-4fac-81a6-b13d6154b274             (2026-08-12 05:11:11 UTC)
      the buyer's exact original inquiry text, preserved verbatim
```

No duplicate thread and no second outbox row were produced — the `dedupe_key` held.

**Note on notifications.** No `notification_queue` rows accompany this event, and that is
deliberate rather than a regression: `communicationOrchestratorService` routes
`marketplace.inquiry.created` to `canonicalizeMarketplaceInquiry` and returns, replacing the
legacy notification fan-out with the canonical conversation — "provider transports remain
downstream of that conversation." The older queue rows on this seller date from the
pre-Communications-2.0 runtime.
