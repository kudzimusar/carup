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

## Physical certification — 2026-08-12 (deployment `dpl_2ZdX7cwdKrfGeJFbJpoL4fRzQDeN`)

| Capability | Source | DB | Staging config/runtime | Physical |
|---|---|---|---|---|
| **D1 event fabric** | **PASS** | **PASS** | **PASS** | **PASS** |
| **Phase 2 — Marketplace ↔ WhatsApp** | **PASS** | **PASS** | **PASS** | **PASS** |
| Phase 5 — media (image/document/audio/video/voice/location) | **PASS** | **PASS** | **PASS** | **PASS** |
| Phase 5 — Gemini AI derivations | PASS | PASS | — | **EXTERNALLY BLOCKED** |
| Out-of-window business-initiated WhatsApp | PASS | PASS | — | **EXTERNALLY BLOCKED** |

### Phase 2 — physical round trip, one canonical conversation

```
buyer   u_168d4b79bb8b44fd          seller  u_4c4f7223253d4667
listing JTMHV05J704518362           inquiry 23de8a4b-7f4f-4f16-8619-f04c057ece06
domain event  2132e636-2d28-4edb-931a-86cab055458f   processed, attempts 1
conversation  61acc236-aaab-4d27-815c-9062f9c99f05   (exactly one, for this inquiry)
outbound msg  a862737c-0691-41bd-8535-8a6e0a77e327
  notification 277 · delivery attempt 62f69ae1… · attempt_number 1
  wamid.HBgMODE4MDgxMjAxMzU2FQIAERgSRDMyMzQ0NTQ4RDkyQUQ2NzIyAA==
  Meta status webhooks (signature-valid): sent 07:39:08 → delivered 07:39:08 → read 07:40:50
inbound msg   4fa5006b-2026-4adc-b5ed-445a11218ac8
  wamid.HBgMODE4MDgxMjAxMzU2FQIAEhgUMkE3QTI0MkZDMEFGOUE0RkQwQUUA
  content_text "CARUP-UAT-148-MARKETPLACE" · original_authoritative true · ai_derived false
  conversation_resolution = active_channel_binding
```

**Hard acceptance:** inbound resolved conversation **==** outbound Marketplace conversation **==**
`61acc236-aaab-4d27-815c-9062f9c99f05`. Exactly one canonical thread, one domain event, one
outbound provider send (one distinct wamid), one WhatsApp notification, no fallback duplicate, no
replay duplicate. The outbound text stored and sent was verified byte-exact by hex decode —
`"CarUp Marketplace UAT — please reply CARUP-UAT-148-MARKETPLACE"`, 62 chars, "Marketplace"
correctly spelled; a "Makretplace" spelling appeared only in a verbal report, never in the system.

The session was legitimate, not forced: the buyer's real inbound set `last_inbound_message_id` on
the conversation's own binding, so policy resolved `whatsapp_delivery_mode = session` with
`whatsapp_policy_reason = customer_service_window_open` (expiry 2026-08-13T07:27:46Z). The earlier
attempt on the same conversation was correctly **suppressed** (`template` mode, no approved
provider template) and was left terminal — it was never mutated to force delivery.

### Out-of-window business-initiated WhatsApp — EXTERNALLY BLOCKED

`conversation_reply_whatsapp_v1` is CarUp-approved but its `provider_template_reference` is NULL,
so business-initiated sends fail closed with `whatsapp_template_not_configured` **before Meta is
contacted** (`provider_http_status` null; there is no Meta rejection to quote). Governance held: no
downgrade to free-form, no channel fallback, zero provider attempts. This is a missing external
Meta template approval and is **not** a Phase 2 failure.

### Phase 5 — media, all six part types physically certified

Real artifacts through `media/prepare → signed PUT → media/commit`, uploaded by a participant:

| Part | MIME | Bytes | part_type | Participant signed fetch | Non-participant |
|---|---|---|---|---|---|
| image | image/png | 10362 | image | 200, byte-exact | **404** |
| document | application/pdf | 612 | document | 200, byte-exact | **404** |
| audio | audio/wav | 292388 | audio | 200, byte-exact | **404** |
| video | video/mp4 | 668 | video | 200, byte-exact | **404** |
| voice note | audio/wav (`capture=voice_note`) | 292388 | audio | 200, byte-exact | **404** |
| location | — | — | location | n/a | n/a |

Every part carries `original = true`, `metadata.private = true`, a `sha256` matching the local
digest, and a `thread/participant/artifact` scoped `storage_key`. `carup-communication-media`
remains **`public = false`**, and an anonymous public-object URL for every stored key returns
**400** — no public leakage. The image, PDF and WAV are genuinely decodable artifacts (the WAV is
real 16-bit 48kHz PCM); the MP4 is a structurally valid ISO-BMFF container built on the test host,
which has no encoder — noted rather than overstated.

### Gemini — EXTERNALLY BLOCKED

`/api/communications/ai/health` → 503, `{provider: google, model: gemini-2.5-flash, available:
false, mode: real}`. `GEMINI_API_KEY` is absent from the staging scope. No AI acceptance is
claimed and no key was added.

### Operational note — unauthorized worker caller (open)

`/api/internal/communications/process` receives **three** calls per minute: events→200,
communications→200, and a third communications→**401** roughly 5 ms earlier. Ruled out with
evidence as the source: this database's pg_cron (only jobs 1 and 2 exist, 66792/4412 runs, both
returning 200), its pg_net responses (exactly two per minute, both 200), Vercel project crons
(`definitions: []`), and this repository's workflows (none reference the endpoint). The caller is
therefore **external to canonical staging Supabase and to this repo** — most consistent with a
legacy `communication_supabase_cron` style scheduler elsewhere holding a stale worker secret.
Impact: it is rejected by `requireWorkerSecret` in ~1 ms before any work, so it cannot drain,
duplicate or read anything; the cost is ~1440 wasted invocations/day and auth-failure log noise
that could mask a real intrusion signal. Not remediated here because the source could not be
identified from available evidence, and removing the wrong scheduler would break the working one.

## Phase 6 — stakeholder workflows, staging runtime certification (2026-08-12)

All twelve contracts are live and enumerable from the running deployment via
`/api/communications/capabilities`, every one reporting `canonical_conversation: true`.
Eleven non-Marketplace domains were opened and exercised on stable staging through the
worker-secret `/api/internal/communications/workflows/:workflow/ensure` route and the
ordinary participant product API. Marketplace was already certified physically in Phase 2.

| Domain | Required roles | Regulated | `ai_mode` | Conversation | Both participants read | Non-participant | Reply | Analytics |
|---|---|---|---|---|---|---|---|---|
| dealer | buyer + dealer | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| garage | vehicle_owner + garage | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| parts | buyer + parts_seller | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| **insurance** | vehicle_owner + insurer | **yes** | **draft_only** | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| **finance** | applicant + lender | **yes** | **draft_only** | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| diaspora_import | customer + import_coordinator | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| container_logistics | customer + logistics_provider | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| referral | referrer + referred_user | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| **government_public_service** | customer + government_officer | **yes** | **draft_only** | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| **trust_safety** | customer + trust_reviewer | **yes** | **draft_only** | 1 | 200 / 200 | 404 | 201 / 201 | attributed |
| support | customer + support_agent | no | enabled | 1 | 200 / 200 | 404 | 201 / 201 | attributed |

**Domain/workflow identity.** Every thread carries the correct `business_workflow` and
`conversation_type`, `metadata.communications_2_stakeholder_contract = true`, the contract's
`required_roles`, and `regulated_workflow`. Participant `stakeholder_role` values match the
contract exactly, two participants per conversation.

**Regulated flows stay human-governed.** `ai_mode = draft_only` on precisely insurance,
finance, government_public_service and trust_safety; `enabled` on the seven non-regulated
domains. Nothing can auto-send or auto-decide on a regulated thread. finance and trust_safety
additionally route to their own `assigned_team`.

**Exactly one canonical conversation.** The deterministic key
`communications-2:<workflow>:<tenant>:<subject_type>:<subject_id>` makes `ensure` idempotent:
replaying all eleven calls left **11 threads, not 22**.

**Contract enforcement (negative proofs).** A missing contract role is rejected 400
`communication_stakeholder_roles_missing` ("insurance communication requires participant
role(s): insurer"); an unknown domain is rejected 400
`communication_stakeholder_workflow_unsupported`; an unauthenticated call is rejected 401
`Unauthorized communication worker request.` None of the three created a thread.

**No duplicate chat stack.** All eleven domains live in the same `message_threads` /
`message_participants` / `messages` / `conversation_events` tables as Marketplace, reached
through the same participant API and the same authorization path. No domain-specific
messaging tables or endpoints exist.

**Analytics attribution.** `conversation_events` records `message_received` and
`stakeholder_first_response` per thread, attributed to each `business_workflow`.

**Message persistence.** Every reply persisted with `original_authoritative = true`. Direction
is derived from the contract role (buyer/requester/customer inbound, provider-side outbound).

**Internal-note privacy.** There is no participant path that can author an internal note —
`sendParticipantMessage` only ever emits `inbound`/`outbound`, so `direction = 'internal'` is
reachable only through an admin surface. That boundary is proven against real PostgreSQL by
`backend/tests/integration/communications-2-privacy-postgres.integration.test.js`, which
inserts an internal note and asserts an authenticated participant's read returns only the
visible message with no `internal` row — with table SELECT deliberately granted so the RLS
policy itself is what is under test. It runs in the green `communication-postgres` CI job.
Recorded as proven by real-Postgres RLS rather than by a staging demonstration, because
staging holds zero internal-direction messages.

**Provider routing.** Canonical provider routing is shared with Phase 2 and was physically
certified there; these domains bind the same way when a participant has a channel identity.

## Phase 7 — governed campaigns, staging runtime certification (2026-08-12)

Channel `in_app` (implemented, no external provider) with the governed marketing template
`carup_reengagement_v1`. One controlled campaign plus a warm-up and an ROI campaign, all
through the ordinary admin product API and the canonical notification path.

| Capability | Source | DB | Staging runtime | Physical/external |
|---|---|---|---|---|
| Governed marketing template | PASS | PASS | **PASS** | n/a |
| Campaign approval | PASS | PASS | **PASS** | n/a |
| Explicit segmentation | PASS | PASS | **PASS** | n/a |
| Marketing opt-out | PASS | PASS | **PASS** | n/a |
| Frequency cap | PASS | PASS | **PASS** | n/a |
| A/B allocation | PASS | PASS | **PASS** | n/a |
| Recipient idempotency | PASS | PASS | **PASS** | n/a |
| Replay protection | PASS | PASS | **PASS** | n/a |
| Canonical delivery | PASS | PASS | **PASS** | in_app (no provider) |
| Attribution | PASS | PASS | **PASS** | n/a |
| Conversion | PASS | PASS | **PASS** | n/a |
| Value / cost / ROI | PASS | PASS | **PASS** | n/a |
| Analytics | PASS | PASS | **PASS** | n/a |
| Tenant isolation | PASS | PASS | **PASS** | n/a |
| WhatsApp marketing | PASS (fail-closed) | PASS | **PASS (refuses)** | **EXTERNALLY BLOCKED** |

### Evidence

**Template.** `carup_reengagement_v1` — `classification=marketing`, `status=active`, version 1,
approved `2026-08-11 12:38:57`, channels `in_app` and `email` (language `en`), required
variables `[]`, optional `first_name/campaign_name/campaign_code`,
`provider_template_reference` NULL. No WhatsApp marketing template exists in the registry.

**Campaign** `bb99ef70-3374-499c-990f-5ae847c76a1b` (`p7-main-d485ea`): classification
`marketing`, `created_by` and `approved_by` both `u_33c846ab45a84a40`, `approved_at` recorded,
bounded `segment_definition.user_ids` of exactly three users, `frequency_cap_count=1` over
168 h, variants `A/B` at 50/50, attribution `last_touch` / 168 h.

**Approval gate.** Executing before approval → **409 `communication_campaign_not_approved`**.
There is no raw-message path: `template_key` is required and must resolve to an active
marketing template.

**Consent, cap and delivery** — one execution, three recipients, three delivery rows:

| Recipient | Result | Reason | Notification |
|---|---|---|---|
| `u_b6ac85546c4a473c` | delivered → converted | — | 307 |
| `u_b9d07f3de3824034` | **suppressed** | `marketing_or_channel_consent_disabled` | none |
| `u_241f106e764a4f03` | **suppressed** | `frequency_cap` | none |

**Consent separation is proven, not assumed:** the suppressed recipient had
`transactional_enabled = true` and `in_app_enabled = true` with only `marketing_enabled =
false`, and was still suppressed with no notification row. Transactional consent does not
override marketing consent.

**The frequency cap was earned, not staged:** the capped recipient's prior touch came from a
real executed warm-up campaign (`p7-warm-d485ea`, queued 1), so the cap of 1 over 168 h was
exceeded by genuine campaign history. No recipient was hand-marked suppressed.

**Idempotency / replay.** Keys are `campaign:<campaign_id>:<user_id>:<variant>`. Execution #1:
`targeted 3, queued 1, suppressed 2, existing 0`. Replay of the same execution: `queued 0,
suppressed 0, existing 3` — deliveries before replay **1**, after replay **1**. No duplicate
recipient row, notification, delivery attempt or send. Nothing was deleted to achieve this.

**Deterministic A/B.** All three stored assignments were recomputed independently from
`sha256(campaign_id:user_id)` over the weight-expanded variant list and matched exactly; 1000
recomputations of one recipient produced a single result; 200 probe ids under the same
campaign split `A:103 / B:97`, so both variants are reachable and the weighting is honoured.
Replay reassigned nobody.

**Canonical delivery.** Notification `307` sits in the ordinary `notification_queue` with
`notification_type=campaign_message`, `template_key=carup_reengagement_v1`,
`transactional=false`, `dedupe_key=campaign:…:B:in_app`, `attempt_count 1`, status
`delivered`, carrying `campaign_id` and `variant` in its payload. No campaign-specific sender
exists — the same worker and tables as every other Communications message.

**Attribution, conversion, ROI.** `conversation_events` records `campaign_queued` and
`campaign_conversion` with attribution `{model: last_touch, window_hours: 168, campaign_code}`.
Main campaign report: `total 3, suppressed 2, delivered 1, read 1, converted 1,
conversion_rate_pct 100, conversion_value 250`, `by_variant {B:3}`, `by_suppression_reason
{frequency_cap:1, marketing_or_channel_consent_disabled:1}` — reconciled exactly against the
raw delivery rows. Cost is carried per experiment variant at execution time, so the main
campaign (no variant cost) correctly reports `cost 0` / `roi_pct null` rather than a fabricated
figure. A dedicated ROI campaign `b9980bed-3013-4fc2-965d-eeb8f5a2d5ce` with
`cost_amount 2.5` and a conversion of `100` reported `conversion_value 100, cost 2.5,
roi_pct 3900`, which matches an independent computation of (100 − 2.5) / 2.5 × 100.

**Tenant isolation / authorization.** A non-admin participant is refused campaign list, create
and report with **403** on each. The admin campaign list returned only the caller's tenant
scope, and a report request asserting a different `x-tenant-id` was refused **403**.

### WhatsApp marketing — EXTERNALLY BLOCKED

No approved Meta marketing template exists, and `conversation_reply_whatsapp_v1` is the
service/conversation-reply template — deliberately **not** bound or reused as a marketing
template. A WhatsApp marketing campaign is refused at creation because the governed marketing
template has no approved `whatsapp` version; approval independently refuses with
`communication_campaign_provider_template_not_configured` when a provider reference is absent.
**Meta was never contacted** and no campaign row was written. This is a missing external Meta
marketing-template approval, not a Phase 7 implementation failure.

### Defect found and fixed during Phase 7

**D4 — a governed-template refusal answered 500. Fixed in `a09af29`.** Creating a campaign on
a channel the governed template has no approved version for returned HTTP 500
`INTERNAL_SERVER_ERROR` with the real reason buried in `details`. The refusal was correct and
fail-closed, but governance was indistinguishable from an outage and polluted 5xx alerting.
`governanceError()` carried `code` and `details` but no `statusCode`; `template_not_active` and
`template_not_approved` now answer **409**. Four regression tests added; suite 2816 → 2820,
0 fail, skipped unchanged at 12. The fix is CI-green but **not yet deployed to staging** —
Vercel's team-wide daily deployment quota is exhausted — so the live probe above still shows
the pre-fix 500. Behaviour (fail closed, no provider contact) is identical in both builds.
