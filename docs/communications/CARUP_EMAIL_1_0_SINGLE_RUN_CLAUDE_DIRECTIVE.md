# CARUP EMAIL 1.0 — SINGLE-RUN EXECUTION DIRECTIVE FOR CLAUDE CODE

**Programme:** CarUp Kimi — Post-Reunification Functional Gap Closure  
**Workstream:** Communications Transport Expansion  
**Owned transport:** **EMAIL ONLY**  
**Repository:** `kudzimusar/carup`  
**Canonical local repo:** `/Users/shadreckmusarurwa/Project AI/carup-kimi`

## 0. Governing instruction

Take ownership of **CarUp Email 1.0** and execute it as **one coherent development and certification programme**.

Do not restart CarUp from first principles. Do not reopen Project Reunification. Do not reopen WhatsApp certification. Do not begin Telegram. Do not create a parallel Email chat product. Do not create multiple Email feature branches or multiple Email implementation PRs.

Architectural invariant:

> **CarUp owns the conversation. Email providers are transports.**

Run continuously through E0–E10, plus **CF1** (see §0A.5), which must complete before E7 physical certification. Do not stop after ordinary phase completions to ask whether to continue. Stop only at the hard owner/manual gates defined below.

## 0A. AMENDMENT 1 — Free-tier provider allocation (governing, owner-frozen 2026-08-17)

This amendment is **governing** and takes precedence over any conflicting statement elsewhere in this directive. Providers are assigned narrowly to what their **free tiers** do well. CarUp remains the canonical Communications system; providers are transports.

### 0A.1 Cloudflare — DNS and human aliases only

Role: eventual authoritative DNS for `carup.dev`, DNS/security infrastructure, and root-domain **human** Email Routing for:

```text
support@carup.dev   security@carup.dev   privacy@carup.dev   legal@carup.dev
dpo@carup.dev       info@carup.dev       press@carup.dev
```

routed to verified human destination inboxes, or Workers where appropriate.

> **Cloudflare MUST NOT become canonical automated customer outbound Email on the Free plan.** Arbitrary-customer outbound through Cloudflare requires paid sending functionality — do not design it.

Vercel remains the application hosting provider. When Cloudflare becomes authoritative DNS, the four canonical product hostnames stay **DNS-only** (grey cloud):

```text
carup.dev   api.carup.dev   staging.carup.dev   api-staging.carup.dev
```

Do **not** automatically place Cloudflare reverse proxy/WAF in front of the Vercel application. Any future proxy activation is a separately proven decision.

### 0A.2 Resend — canonical transactional and conversational (`mail.carup.dev`)

Covers account/security Email, transactional notifications, canonical conversation Email, inbound user replies, lifecycle events, bounce/failure handling, and same-thread/same-participant reply routing.

Free-tier governance: provider daily limit currently **100**. CarUp must have configurable warning/critical quota thresholds. No automatic paid upgrade. No hidden billable fallback. Security and conversational Email take priority over lower-priority notifications.

### 0A.3 Brevo — marketing only (`marketing.carup.dev`)

Newsletters, re-engagement, marketing campaigns, optional recommendations, governed promotions.

> Even though Brevo technically supports transactional Email, it **must not** become a competing normal transactional provider in Email 1.0.

CarUp remains authoritative for consent, withdrawal, campaign eligibility, recipient selection, frequency, suppression, and audit history. Brevo is provider projection only.

Free-tier governance: current free allocation approximately **300 sends/day**. Configurable warning/critical thresholds. Never automatically upgrade or buy credits. **Marketing pauses first** if free quota becomes constrained.

### 0A.4 Cost governance

Required invariant:

```text
NO provider may silently move CarUp from free usage into paid usage.
```

Configurable thresholds (sensible defaults below provider ceilings):

```text
RESEND_DAILY_SOFT_LIMIT     RESEND_DAILY_CRITICAL_LIMIT
BREVO_DAILY_SOFT_LIMIT      BREVO_DAILY_CRITICAL_LIMIT
```

- **Soft threshold** → warn and audit.
- **Critical threshold** → preserve critical transactional/conversational capacity, defer lower-priority Email, suppress/defer marketing, and **never auto-purchase capacity**.

Do not hardcode today's provider pricing as permanent business logic. Current limits are **operational configuration**, not eternal architecture.

### 0A.5 CF1 — Cloudflare Free infrastructure migration (bounded phase)

Must occur **before** final E7 physical certification. **Do not change nameservers yet.**

1. Inventory every current Vercel DNS record.
2. Create/reconcile the `carup.dev` Cloudflare Free zone.
3. Clone all required DNS records.
4. Preserve the four canonical Vercel-hosted product domains.
5. Preserve Resend `mail.carup.dev` records exactly.
6. Preserve Brevo `marketing.carup.dev` records exactly.
7. Reconcile CAA / SPF / DKIM / DMARC / MX.
8. Handle DNSSEC safely.
9. **Stop at OWNER approval immediately before nameserver cutover.**
10. Change authoritative nameservers only after explicit owner approval.
11. Verify all web/API/staging/email surfaces after cutover.
12. Keep Vercel-hosted app records DNS-only.
13. Enable Cloudflare Email Routing.
14. Create and physically prove the human aliases.
15. Only **after** aliases physically work, migrate the `@carup.co.zw` legal/contact copy to `@carup.dev`.

> Do not remove working `@carup.co.zw` contact addresses before the replacement aliases physically deliver. See `docs/CARUP_DOMAIN_CANONICALIZATION_RECEIPT.md` for the exact alias list required.

## 0B. SA1 — Supabase Auth Email branding + Resend delivery (bounded prerequisite)

Governing architecture as specified by the owner:

```text
SUPABASE AUTH            authentication authority and token lifecycle
SUPABASE AUTH TEMPLATES  authentication/security email semantics and branding
RESEND                   SMTP delivery for Supabase Auth + canonical CarUp transactional
CARUP                    public branded URL/UX and application security policy
BREVO                    marketing only
```

Supabase must **not** become a fourth outbound provider.

Delivery architecture for SA1 is the simplest production-capable one:

```text
Supabase Auth → Supabase branded Auth template → Resend custom SMTP → recipient
```

The **Supabase Send Email Hook** (`Supabase Send Email Hook → CarUp Communications → Resend`) is
recorded as a **future Phase-2 option** for when every Auth Email must enter CarUp's queue, quota
and audit governance before provider send. It is not part of SA1 unless live evidence proves custom
SMTP cannot satisfy a required acceptance criterion.

Sender: `CarUp Security <auth@mail.carup.dev>` on the already-verified `mail.carup.dev`. Do not
create another sending domain.

Auth links must use Supabase **TokenHash** routing to a CarUp-owned canonical origin, never
`{{ .ConfirmationURL }}` where that would expose the raw `project-ref.supabase.co` host as the
durable user-facing link. `redirect_to`/`next` must be validated against the canonical CarUp
allowlist; never permit an open redirect.

Auth/security Email is **P0** in the send-priority ladder (§0A.4 as extended):

```text
P0 Supabase Auth / account security   P1 conversational   P2 transactional
P3 service                            P4 marketing (Brevo only)
```

> **SA1.0 reconciliation outcome (2026-08-17): the premise above does not currently hold.**
> CarUp does not use Supabase Auth — `auth.users` is empty, there are zero `supabase.auth.*` call
> sites, and authentication runs on a custom backend (`public.users.password_hash` →
> `public.user_sessions`, 864 sessions / 75 users). CarUp also has **no password reset or email
> confirmation flow on any layer**, and no `/auth/*` routes. SA1 is therefore **blocked on an
> owner decision** between building auth Email on the existing custom auth (Path A) or migrating
> authentication to Supabase Auth (Path B). Full evidence, the fork-independent work already
> delivered, and the recommendation are in
> `docs/communications/EMAIL_1_0_SA1_AUTH_EMAIL_RECEIPT.md`.

## 1. Baseline and live-truth rule

Last verified baseline before this directive was created:

```text
CURRENT_MAIN=f9c6f80d10a80c21e8e01abb7f26a483caa29e88
COMMUNICATIONS_2_0_PR=148
COMMUNICATIONS_2_0_CERTIFIED_HEAD=99c5cae2f07c37a833e19b3429f1bc932a663bb4
COMMUNICATIONS_2_0_MERGE_SHA=f9c6f80d10a80c21e8e01abb7f26a483caa29e88
CANONICAL_STAGING_FRONTEND=carup-staging
CANONICAL_STAGING_BACKEND=carup-backend-staging
PRODUCTION_COMMUNICATIONS=INACTIVE
EMAIL_BRANCH=feat/communications-email-transport
```

At directive creation time PR #161, Owner Experience, was still an open draft lane. **Live evidence overrides this document.**

First perform fresh read-only reconciliation of: current `main`; all open PRs/active write lanes; canonical Vercel staging aliases and exact SHAs; CarUp staging Supabase identity; current Communications schema/migrations; Email identities/bindings/preferences/templates/campaigns/worker/webhooks; actual staging Email provider configuration; DNS for `carup.dev`; Resend state; Brevo state.

Do not branch from PR #161 or any feature preview. This Email branch was created from the verified Communications 2.0 `main` baseline. Reconcile it with live `main` before source implementation if `main` has moved.

If the programme-wide single-writable-lane rule still blocks Email source changes because another active lane remains open, complete all safe/read-only E0 work and then report an owner gate before source mutation. Never silently violate the lane rule.

## 2. Canonical architecture

CarUp is authoritative for:

- conversation/thread;
- participants and stakeholder roles;
- tenant ownership;
- channel identities;
- conversation-channel bindings;
- canonical messages;
- notification queue;
- preferences and consent;
- governed templates;
- campaigns and campaign deliveries;
- provider delivery attempts;
- webhook audit/replay protection;
- retry/fallback;
- suppression/compliance state;
- audit/event history.

Providers are transports:

```text
Transactional / conversational Email -> Resend
Marketing Email                       -> Brevo
Root human aliases / DNS              -> Cloudflare where appropriate
```

Do not create `email_threads`, `email_conversations`, `email_participants`, `email_messages`, `email_users`, or a provider-owned consent source of truth. Do not mutate a tenant to make Email routing fit. Do not duplicate canonical participants because a provider sends an inbound message.

## 3. Target domain/provider topology

> Governed by **§0A Amendment 1** (free-tier allocation). Cloudflare is DNS + human aliases only and must never become canonical automated customer outbound on the Free plan.

Root: `carup.dev`.

Intended topology:

```text
carup.dev
├── support@carup.dev
├── security@carup.dev
├── privacy@carup.dev
└── hello@carup.dev
        └── Cloudflare Email Routing where appropriate

mail.carup.dev
        └── Resend
            ├── transactional outbound
            ├── conversational outbound
            ├── inbound replies
            └── lifecycle webhooks

marketing.carup.dev
        └── Brevo
            ├── campaigns
            ├── newsletters
            └── re-engagement
```

Proposed transactional sender: `CarUp <notifications@mail.carup.dev>`.

Reply-To model: `conversation+<opaque-authenticated-route-token>@mail.carup.dev`.

Never trust a raw thread ID as a routing credential.

## 4. Single-run and hard-owner-gate rules

Continue automatically through E0–E10. Routine engineering decisions do not require owner approval if they stay inside this contract.

Stop only for:

1. **Active programme write-lane conflict** before Email source mutation.
2. **Credential/login/2FA** that only the owner can provide.
3. **Nameserver cutover** — never change authoritative nameservers without explicit owner approval.
4. **Paid-provider/cost authorization** for a new paid plan, dedicated IP, material paid quota, etc.
5. **Destructive/broad data mutation** such as truncate, broad delete, irreversible identity merge, production rewrite.
6. **Production activation** of Communications/scheduler/queues/Email/broad marketing.
7. **Final merge** of the Email PR.

At a hard gate print exactly this structure:

```text
OWNER_ACTION_REQUIRED

PHASE=
GATE=
WHY_BLOCKED=
EXACT_ACTION_FOR_OWNER=
WHERE_TO_DO_IT=
VALUES_OR_FIELDS_REQUIRED=
SECURITY_NOTE=
WHAT_I_WILL_VERIFY_AFTERWARD=
NEXT_AUTOMATIC_STEP=
```

Ask only for what is actually missing. Never ask for information already recoverable from repo/provider/runtime evidence. Never commit secrets. Prefer secret stores/environment variables; redact credentials from logs and receipts.

## 5. One branch / one PR

Use only:

```text
feat/communications-email-transport
```

Use the same branch for design receipts, migration(s), Resend adapter/router, lifecycle webhook, inbound reply routing, Brevo marketing, tests, staging defects, certification fixes, cleanup receipts and final documentation.

Create **one long-lived draft PR** to `main` once the source-write gate is clear. Do not create separate E2/E3/E4/E5 PRs. Physical-certification defects stay in the same PR, produce a new candidate SHA, and re-earn the affected evidence plus required regression chain.

## 6. E0 — Live reconciliation and design freeze

No source mutation until the current lane state is reconciled.

Record:

```text
EMAIL_E0_BASELINE
MAIN_SHA=
OPEN_RELEVANT_PRS=
ACTIVE_WRITE_LANE=
STAGING_FRONTEND_DEPLOYMENT=
STAGING_FRONTEND_SHA=
STAGING_BACKEND_DEPLOYMENT=
STAGING_BACKEND_SHA=
CARUP_STAGING_DB_IDENTITY=
```

Read-only staging DB inventory must include Email rows/topology in `channel_identities`, `conversation_channel_bindings`, `notification_queue`, `message_delivery_attempts`, `webhook_logs`, `communication_preferences`, templates/template versions, campaigns/campaign deliveries and suppression state.

For Email identities determine: tenant/user/provider/external_id/normalized_address/verified/consent; duplicate normalized addresses; same address represented by several providers; same address across tenants; orphan/null-user identities; identities without canonical participant/binding.

For Email bindings inspect thread, participant, identity, channel, provider, external conversation context, routing purpose, can_send, can_receive, transactional/marketing consent, primary state and metadata.

Inspect actual current source paths: SendGrid adapter, Cloudflare Email adapter, adapter registry, worker, environment variables, Cloudflare inbound Email path, inbound resolver, governed notification/template routing, campaign service and fallback policy.

Identity design rule unless live evidence requires a safer compatible variant:

> **Email address is a CarUp channel identity; Resend/Brevo are transport providers.**

Avoid duplicate identities simply because transport changes. Provider/binding/message/delivery records may carry Resend/Brevo transport context. Do not merge/rewrite existing identities until staging topology is physically inventoried.

E0 output:

```text
EMAIL_E0_BASELINE
CURRENT_MAIN=
STAGING_SHA=
EMAIL_IDENTITIES=
EMAIL_BINDINGS=
EMAIL_DUPLICATE_RISKS=
CURRENT_EMAIL_PROVIDER=
CURRENT_INBOUND_SUPPORT=
CURRENT_TEMPLATE_STATE=
CURRENT_CAMPAIGN_STATE=
SOURCE_WRITE_LANE_CLEAR=YES/NO
MIGRATION_PLAN=
SOURCE_PLAN=
EXTERNAL_SETUP_PLAN=
E0_RESULT=PASS/BLOCKED
```

If clear, continue automatically.

## 7. E1 — DNS and provider identity

Inspect authoritative live registrar, nameservers, DNS provider, A/AAAA/CNAME, MX, SPF, DKIM, DMARC and verification TXT/CNAME before changing anything. Never guess DNS. Never create duplicate SPF or DMARC records on a hostname.

Cloudflare intended role: authoritative DNS if already authoritative or owner-approved; root human aliases via Email Routing where appropriate. Cloudflare is not canonical application outbound Email transport. If nameserver cutover is required, stop at owner gate first.

Configure/verify `mail.carup.dev` for Resend outbound, inbound receiving, signed webhooks, domain authentication, and staging secret configuration.

Configure/verify `marketing.carup.dev` for Brevo API access, sender/domain authentication, authenticated webhooks and marketing lifecycle events.

Use conservative DMARC monitoring initially (for example `p=none`) unless existing proven policy is stricter. Do not weaken a proven stricter policy without evidence.

Output:

```text
DOMAIN_READY=
RESEND_DOMAIN_READY=
RESEND_RECEIVING_READY=
BREVO_DOMAIN_READY=
SPF=
DKIM=
DMARC=
E1_RESULT=
```

Continue automatically.

## 8. E2 — Resend outbound transactional/conversational Email

Build a single Email transport router. Provider choice must derive from governed CarUp classification, not arbitrary caller choice:

```text
security/service/transactional/conversational -> Resend
marketing                                    -> Brevo
```

Implement Resend through the canonical adapter architecture. Persist durable provider identifiers: Resend API email ID as provider request identifier, RFC Message-ID as provider message identifier. Reuse `message_delivery_attempts` where possible; add only additive schema/index support required for durable provider/RFC lookup.

Map canonical CarUp dedupe identity to Resend idempotency so one canonical send intent causes at most one provider send. Prove worker replay, network ambiguity/retry and provider replay behavior.

For reply-capable email generate the opaque authenticated, versioned, rotatable Reply-To token. Raw IDs alone are never trusted; live DB invariants must be revalidated during resolution.

Tests: success, missing config, provider 4xx/5xx, network failure, retry, duplicate worker invocation, canonical persistence, provider-ID persistence, Reply-To token generation/verification, tampered/expired/unsupported token rejection.

Continue automatically.

## 9. E3 — Resend lifecycle webhooks

Implement canonical Resend Email webhook endpoint (conceptually `/api/communications/webhooks/resend/email`) using raw-body cryptographic signature verification before any business mutation. Use canonical `webhook_logs` for audit/dedupe.

Support at minimum: sent, delivered, delayed, bounced, complained, failed, suppressed. Map into canonical CarUp delivery state and existing retry/fallback governance; do not invent a shadow Resend retry engine.

Prove:

```text
valid signature   -> exactly one canonical state transition
invalid signature -> rejected; zero business-domain mutation
same event twice  -> first processed; second inert/deduped
```

Continue automatically.

## 10. E4 — Resend inbound replies into the SAME conversation

Release-critical behavior:

```text
CarUp thread
-> canonical outbound Email
-> real controlled inbox
-> recipient Reply
-> Resend inbound
-> authenticated CarUp webhook
-> exact existing conversation
-> exact existing participant
-> exactly one new canonical inbound message
```

If inbound webhook provides metadata only, fetch the full received email through Resend API before parsing From, To, Message-ID, In-Reply-To, References, subject, body and required attachment metadata.

Strong routing signals:

A. validated opaque CarUp reply token; and/or  
B. RFC In-Reply-To/References mapped through outbound provider/RFC Message-ID.

When both exist, resolve independently and require agreement.

Fail closed for invalid/expired token, unknown/ambiguous RFC context, token/RFC mismatch, inactive participant/binding, `can_receive=false`, tenant invariant failure, unprovable sender, or no exact reply evidence. Never use `sender -> most recent conversation`.

Preserve the Communications 2.0 WhatsApp Gate-E topology invariant: when exact conversation and authoritative bound participant exist, reuse that participant. Do not call a generic path that can shadow-create one.

Required delta for one physical inbound reply:

```text
threads       +0
participants  +0
messages      +1
tenant changes 0
```

Provider replay must create no second message.

Continue automatically.

## 11. E5 — Brevo marketing transport

Brevo is a transport projection of an already-authorized CarUp campaign.

Authority order:

```text
CarUp preference/consent
-> CarUp campaign
-> CarUp recipient eligibility/frequency/suppression
-> Brevo projection/send
```

Create/update only minimum provider-side state required for authorized delivery. Provider objects must be traceable to canonical campaign/campaign-delivery/user/dedupe IDs. Never manually force a recipient into Brevo to manufacture a PASS.

Authenticate Brevo webhooks with the strongest account-supported controls. Map delivered, hard/soft bounce/delay, complaint/spam, unsubscribe/suppression and failure into canonical audit/delivery/preference/suppression state. Provider unsubscribe must reconcile into CarUp, not bypass it.

Continue automatically.

## 12. E6 — Stakeholder regression

Derive actual stakeholder contracts from live code/schema. Current known roles to reconcile:

```text
marketplace:               buyer, seller
dealer:                    buyer, dealer
garage:                    vehicle_owner, garage
parts:                     buyer, parts_seller
insurance:                 vehicle_owner, insurer
finance:                   applicant, lender
diaspora_import:           customer, import_coordinator
container_logistics:       customer, logistics_provider
referral:                  referrer, referred_user
government_public_service: customer, government_officer
trust_safety:              customer, trust_reviewer
support:                   customer, support_agent
```

Produce `EMAIL_STAKEHOLDER_COVERAGE_MATRIX` covering transactional Email, conversational reply, marketing eligibility, identity source, consent, tenant rule, regulated constraints, fallback and required proof. Apply stricter handling to regulated flows where source contract requires it.

Run full Communications regression. Do **not** send new physical WhatsApp confidence tests.

Continue automatically.

## 13. E7 — Exact-head physical staging certification

Freeze one exact Email PR SHA and deploy that exact candidate to staging. Record immutable deployment IDs and source SHA. Physical proof must use controlled accounts/inboxes only.

### Gate A — Real Resend outbound

Prove one canonical intent -> one Resend send -> one provider request ID -> one RFC Message-ID -> one real controlled inbox delivery -> one canonical delivery attempt -> delivered webhook persisted -> canonical delivered state.

### Gate B — Real inbox reply

From the real inbox, press Reply. Prove same thread, same participant, `threads delta=0`, `participants delta=0`, `messages delta=+1`, no shadow thread, no shadow participant, no tenant mutation.

### Gate C — Inbound replay

Replay same inbound event. Expected all canonical business deltas zero.

### Gate D — Invalid signature

Send/replay a syntactically valid event with invalid provider signature. Expected authentication rejection and zero business-domain side effects, proven by bounded before/after queries.

### Gate E — Controlled bounce/failure

Use provider-supported safe testing or controlled invalid recipient. Prove provider failure -> canonical failure -> governed retry/fallback. No hidden provider retry architecture.

### Gate F — Real Brevo marketing consent/withdrawal

Use one controlled recipient.

F1: through CarUp real preference path switch marketing OFF -> ON, create fresh governed campaign, prove eligible recipient=1, Brevo send=1, real inbox marketing delivery=1.

F2: rerun same campaign/send path, prove additional provider sends=0.

F3: through CarUp switch marketing ON -> OFF, create a fresh campaign, prove suppression occurs before provider call, Brevo sends=0 and second marketing inbox delivery=0.

No manual provider-list manipulation to fake consent proof.

## 14. E8 — Bounded cleanup and final review

Clean only synthetic/controlled evidence created by this Email programme where appropriate. Never broad-truncate Communications tables. Record exact cleanup IDs and bounded before/after counts for threads, participants, messages, notifications, delivery attempts, webhook logs, campaigns, campaign deliveries and any test identities/bindings.

Preserve documented audit evidence.

Run full relevant backend tests, web tests if touched, typecheck/build, lint, migration verification, Communications suites, security/replay tests, stakeholder regression and canonical staging smoke. Freeze final candidate SHA.

Produce:

```text
EMAIL_1_0_CERTIFICATION_MATRIX
SOURCE=
DATABASE=
IDENTITY_INVARIANTS=
RESEND_OUTBOUND=
RESEND_LIFECYCLE=
RESEND_INBOUND_REPLY=
SAME_THREAD=
SAME_PARTICIPANT=
NO_SHADOW_IDENTITY=
REPLAY=
INVALID_SIGNATURE=
BOUNCE_FAILURE=
BREVO_MARKETING=
CONSENT_WITHDRAWAL=
STAKEHOLDERS=
REGRESSION=
STAGING=
PRODUCTION_ACTIVATION=OFF
OPEN_P0=
OPEN_P1=
CERTIFIED_SHA=
```

All required gates must pass before merge recommendation.

## 15. E9 — Owner merge decision

Do **not** merge automatically. Stop and print:

```text
OWNER_ACTION_REQUIRED

PHASE=E9
GATE=FINAL EMAIL 1.0 MERGE
CERTIFIED_SHA=
PR=
PHYSICAL_CERTIFICATION=
REGRESSION=
OPEN_P0=
OPEN_P1=
PRODUCTION_COMMUNICATIONS=INACTIVE
RECOMMENDATION=READY FOR OWNER MERGE / NOT READY
EXACT_ACTION_FOR_OWNER=
```

Wait for explicit owner authorization.

## 16. E10 — Merged-main staging verification

After owner-authorized merge only: record merged `main`; prove merged tree contains certified candidate; verify main-driven canonical frontend/backend staging aliases resolve to merged `main`; run non-destructive health/smoke; verify staging Email configuration ready; verify production Communications remains inactive and no production scheduler/queue/marketing activation occurred.

Then print:

```text
EMAIL_1_0_CLOSURE
MERGED_MAIN_SHA=
CERTIFIED_SOURCE_SHA=
CANONICAL_STAGING_FRONTEND_SHA=
CANONICAL_STAGING_BACKEND_SHA=
RESEND_STAGING=READY
BREVO_STAGING=READY
PRODUCTION_COMMUNICATIONS=INACTIVE
OPEN_P0=0
OPEN_P1=0
EMAIL_1_0=CLOSED
NEXT_TRANSPORT_ELIGIBLE=TELEGRAM
```

Do not start Telegram in this run.

## 17. Migration guidance

Prefer one additive Email migration if live reconciliation confirms it is sufficient. No new Email-owned conversation tables.

Expected needs may include explicit governed Email template versions/metadata; provider-neutral indexes for durable provider-request and RFC Message-ID lookup; idempotent inbound lookup constraints/indexes. No tenant reassignment. No identity merge/backfill before exact live topology inventory.

Reuse canonical primitives such as `channel_identities`, `message_participants`, `messages`, `conversation_channel_bindings`, `notification_queue`, `message_delivery_attempts`, `webhook_logs`, `communication_preferences`, `communication_templates`, `communication_template_versions`, `communication_campaigns`, `communication_campaign_deliveries`. Adapt minimally if live schema differs.

## 18. Legacy Email disposition

Existing source is expected to contain SendGrid and Cloudflare Email application paths. End state must not leave ambiguous canonical outbound providers active.

Resend becomes canonical transactional/conversational Email provider. Brevo becomes canonical marketing provider. Legacy SendGrid/Cloudflare application-send paths should be safely removed, deprecated or quarantined from canonical routing. Cloudflare may remain for DNS/root human aliases/inbound routing where intentionally required. Do not break unrelated Cloudflare infrastructure.

Document final disposition.

## 19. Security invariants

Always preserve:

```text
one provider inbound email -> at most one canonical CarUp message
one canonical send intent  -> at most one provider send
invalid webhook signature  -> zero business-domain mutation
ambiguous reply context     -> zero guessed routing
tenant identity             -> never reassigned as a routing shortcut
existing participant        -> reused, never shadow-created
CarUp consent               -> authoritative over provider list state
production Communications   -> remains inactive
```

Never commit API keys or print full secrets. Rotate anything accidentally exposed.

## 20. Progress reporting

At meaningful phase transitions report compactly:

```text
EMAIL_PROGRESS
PHASE=
STATUS=
EXACT_SHA=
WHAT_PASSED=
WHAT_CHANGED=
NEXT=
OWNER_ACTION_REQUIRED=NONE/<gate>
```

Do not claim physical PASS without real provider/runtime evidence. Do not claim deployment/source equivalence without exact SHA proof. Do not substitute an expected skipped CI job for a required physical gate.

## 21. One-run resume rule

When the owner supplies a credential, completes a provider/browser action, approves a nameserver change, or resolves another manual gate: verify it live; do not restart from first principles; resume the exact blocked step; preserve the same Email branch/PR; continue automatically until the next genuine hard gate. Do not make the owner repeatedly say “continue”.

## 22. Definition of done

Email 1.0 closes only when all are true:

```text
[ ] live main reconciled
[ ] single Email branch/PR used
[ ] canonical Email identity semantics preserved
[ ] carup.dev DNS/authentication proven
[ ] Resend domain proven
[ ] real transactional outbound proven
[ ] lifecycle webhook persistence proven
[ ] real inbox reply returns to same CarUp thread
[ ] same canonical participant reused
[ ] inbound replay idempotent
[ ] invalid signatures fail closed
[ ] bounce/failure governance proven
[ ] Brevo marketing implemented
[ ] real opt-in marketing delivery proven
[ ] campaign replay causes zero duplicate send
[ ] real opt-out suppresses before Brevo
[ ] stakeholder matrix proven
[ ] exact-head regression green
[ ] bounded cleanup recorded
[ ] owner explicitly authorized merge
[ ] merged-main canonical staging verified
[ ] production Communications remains inactive
[ ] Email 1.0 formally CLOSED
```

Only then is Telegram eligible.

## 23. Start instruction

Start with **E0 live reconciliation** against GitHub, Vercel, CarUp staging Supabase, DNS, Resend and Brevo. Live evidence overrides this directive if anything changed.

Do not modify source until the active-write-lane state is reconciled. Continue automatically once clear. Stop only at the hard owner gates above.

Begin with:

```text
EMAIL_E0_LIVE_RECONCILIATION_STARTED
```
