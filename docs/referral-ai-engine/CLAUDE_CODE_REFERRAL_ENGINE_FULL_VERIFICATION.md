# Claude Code Prompt — CarUp Referral Engine Full Verification

## /goal

You are Claude Code acting as the senior verification engineer for the CarUp Referral Engine.

Your goal is to review, verify, test, harden, and prepare the full 7-phase CarUp Referral Engine implementation for safe merge readiness.

This is not a casual code review. Treat this as a production-grade backend verification sprint.

The Referral Engine is intended to become one of CarUp’s core growth, attribution, reward, AI, marketplace, import, and trust systems.

A successful implementation means CarUp can safely track referral traffic from social channels, external AI assistants, local marketplace listings, import campaigns, vehicle import workflows, parts import workflows, container-space workflows, AI-generated marketing links, coupons, wallets, disputes, and fraud/trust review without losing attribution, creating unsafe rewards, bypassing human review, or breaking the existing backend.

Do not merge anything unless explicitly instructed later.

Your current mission is to verify the implementation, discover regressions, run the full test stack, fix real failures, add missing tests, confirm merge readiness, and produce a clear engineering report.

---

## 1. Project context

This is the CarUp / Diaspora Trade OS project.

The Referral Engine fits into the broader CarUp system as a growth, attribution, reward, trust, and AI-assistance layer.

It should support:

- Zimbabwe/local marketplace referrals;
- buyer, seller, supplier, parts, and mechanic lead flows;
- vehicle import referrals;
- parts import referrals;
- container-space referrals;
- WhatsApp, Telegram, Facebook, Instagram, web chat, and mobile chat referral flows;
- AI assistant workflows through CarUp-owned gateway tools;
- AI marketing and SEO campaign generation;
- coupon attribution;
- wallet/reward maturity;
- human review and fraud controls;
- audit exports.

When complete, the backend should support UI surfaces such as:

- Referral campaign admin pages;
- code/coupon generation screens;
- QR/barcode/share asset panels;
- wallet benefit status views;
- local marketplace referral lead views;
- import route and capacity pages;
- container-space reservation/referral status pages;
- social/channel share-kit screens;
- AI marketing draft review queue;
- trust/fraud review queue;
- dispute center;
- audit export panel.

The current task is backend verification. Do not build UI unless required to prove route behavior. However, every API response should make future UI work possible.

---

## 2. Reference documents

Use the attached TRD/roadmap package or the repo docs folder.

The documents are expected under:

```text
docs/referral-ai-engine/
```

Important documents:

- `README.md`
- `00_MASTER_PLAN_AI_FIRST.md`
- `01_USER_ACCESS_AND_ROLES_TRD.md`
- `02_CODES_COUPONS_QR_BARCODE_ATTRIBUTION_TRD.md`
- `03_REWARDS_WALLET_SETTLEMENT_TRD.md`
- `04_LOCAL_MARKETPLACE_REFERRALS_TRD.md`
- `05_IMPORT_CARS_PARTS_CONTAINER_REFERRALS_TRD.md`
- `06_SOCIAL_CHANNELS_WHATSAPP_TELEGRAM_FACEBOOK_TRD.md`
- `07_AI_LAYER_TRD.md`
- `08_PUBLIC_AI_ASSISTANTS_CHATGPT_CLAUDE_GEMINI_TRD.md`
- `09_AI_MARKETING_SEO_AUTOMATION_TRD.md`
- `10_TRUST_FRAUD_COMPLIANCE_GUARDRAILS_TRD.md`
- `11_DATA_MODEL_APIS_EVENTS_TRD.md`
- `12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md`

If the filenames differ, map them by meaning.

You must compare the implementation against these documents.

---

## 3. Feature implementation summary

The feature was implemented as 7 stacked phases.

The PR stack is:

| Phase | PR | Branch | Base | Purpose |
|---|---:|---|---|---|
| Phase 1 | #62 | `feature/referral-engine-phase1` | `main` | campaigns, referral codes, coupons, QR/barcode/share assets, wallet transactions, event trail |
| Phase 2 | #63 | `feature/referral-engine-phase2-agent-gateway` | `feature/referral-engine-phase1` | AI Agent Gateway, permissioned tools, triage, validation, dry-run/persist controls, share-kit generation, wallet explanation, support handoff |
| Phase 3 | #64 | `feature/referral-engine-phase3-channels` | `feature/referral-engine-phase2-agent-gateway` | WhatsApp, Telegram, Facebook, Instagram, web chat, mobile chat parsing and channel gateway workflows |
| Phase 4 | #67 | `feature/referral-engine-phase4-local-marketplace` | `feature/referral-engine-phase3-channels` | local buyer/seller/supplier/mechanic referral workflows, local leads, local quote/service conversion, hardening |
| Phase 5 | #68 | `feature/referral-engine-phase5-imports` | `feature/referral-engine-phase4-local-marketplace` | vehicle import, parts import, container-space referrals, route pages, capacity, import leads, milestone qualification, wallet eligibility, hardening |
| Phase 6 | #69 | `feature/referral-engine-phase6-ai-marketing` | `feature/referral-engine-phase5-imports` | AI campaign kits, SEO pages, proof stories, FAQs, channel copy, UTM/canonical metadata, publishing review workflow, hardening |
| Phase 7 | #71 | `feature/referral-engine-phase7-trust-review` | `feature/referral-engine-phase6-ai-marketing` | risk checks, human review cases, wallet holds, benefit explanations, disputes, audit exports, fraud/trust/compliance hardening |

The correct merge order is:

```text
#62 -> #63 -> #64 -> #67 -> #68 -> #69 -> #71
```

Do not merge yet.

---

## 4. Initial repository checks

Run:

```bash
git status
git branch --show-current
git log --oneline --decorate -20
gh pr list --state open
```

Then verify PR metadata:

```bash
gh pr view 62 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 63 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 64 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 67 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 68 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 69 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
gh pr view 71 --json number,title,headRefName,baseRefName,mergeable,state,isDraft
```

Expected stack:

```text
PR #62 base: main
PR #63 base: feature/referral-engine-phase1
PR #64 base: feature/referral-engine-phase2-agent-gateway
PR #67 base: feature/referral-engine-phase3-channels
PR #68 base: feature/referral-engine-phase4-local-marketplace
PR #69 base: feature/referral-engine-phase5-imports
PR #71 base: feature/referral-engine-phase6-ai-marketing
```

Report any mismatch.

---

## 5. Checkout final stacked branch

Checkout the final branch because it contains all previous phases through the stack:

```bash
git fetch --all --prune
git checkout feature/referral-engine-phase7-trust-review
git pull --ff-only
```

Inspect the full feature diff:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Do not assume the feature is correct because files exist. Inspect the code carefully.

---

## 6. Expected implementation files by phase

Verify these files exist or identify their actual names.

### Phase 1 foundation

- `database/migrations/016_referral_engine_phase1.sql`
- `backend/constants/referral/referralConstants.js`
- `backend/services/referral/referralEngineRepository.js`
- `backend/services/referral/referralEngineService.js`
- `backend/routes/referralRoutes.js`
- `backend/routes/promotionsRoutes.js`
- `backend/tests/referral-engine-phase1.test.js`

### Phase 2 Agent Gateway

- `backend/services/referral/referralAgentGatewayServiceSafe.js`
- `backend/tests/referral-agent-gateway-phase2.test.js`

### Phase 3 channels

- `backend/services/referral/referralChannelGatewayService.js`
- `backend/services/referral/referralChannelPayloadParsers.js`
- `backend/tests/referral-channel-gateway-phase3.test.js`

### Phase 4 local marketplace

- `backend/services/referral/referralLocalMarketplaceService.js`
- `backend/services/referral/referralLocalMarketplaceHardenedService.js`
- `backend/tests/referral-local-marketplace-phase4.test.js`
- `backend/tests/referral-local-marketplace-phase4-hardening.test.js`

If filenames differ, locate equivalent files.

### Phase 5 imports

- `backend/services/referral/referralImportCampaignService.js`
- `backend/services/referral/referralImportCampaignHardenedService.js`
- `backend/services/referral/referralImportCampaignBenchmarkService.js`
- `backend/tests/referral-import-campaign-phase5.test.js`
- `backend/tests/referral-import-campaign-phase5-hardening.test.js`

### Phase 6 marketing/SEO

- `backend/services/referral/referralMarketingSeoService.js`
- `backend/services/referral/referralMarketingSeoBenchmarkService.js`
- `backend/tests/referral-marketing-seo-phase6.test.js`
- `backend/tests/referral-marketing-seo-phase6-hardening.test.js`

### Phase 7 trust/review

- `backend/services/referral/referralTrustReviewService.js`
- `backend/services/referral/referralTrustReviewBenchmarkService.js`
- `backend/tests/referral-trust-review-phase7.test.js`
- `backend/tests/referral-trust-review-phase7-hardening.test.js`

---

## 7. Documentation alignment review

Compare the implementation to the TRDs.

Confirm these concepts are present and tested.

### Phase 1

- campaigns;
- referral codes;
- coupons;
- QR/barcode/share assets;
- wallet transactions;
- referral events;
- database migration;
- RLS;
- signup-only cannot mature into payable reward.

### Phase 2

- tool catalog;
- triage;
- referral-code validation;
- campaign draft;
- share-kit generation;
- wallet explanation;
- support handoff;
- no direct wallet mutation tools;
- hidden context cannot bypass write permission.

### Phase 3

- WhatsApp parsing;
- Telegram parsing;
- Telegram secret-token validation;
- Facebook webhook payloads;
- Instagram webhook payloads;
- web chat;
- mobile chat;
- inbound attribution;
- share-kit generation;
- outbound payload generation.

### Phase 4

- local marketplace intent;
- local marketplace lead;
- buyer/seller/supplier/mechanic flows;
- referral bundle creation;
- lead qualification;
- duplicate reward blocking;
- self-referral blocking.

### Phase 5

- vehicle import referrals;
- parts import referrals;
- container-space referrals;
- route page creation;
- capacity status;
- overbooking prevention;
- waitlist behavior;
- import lead creation;
- import milestone qualification;
- pending wallet reward;
- duplicate reward prevention;
- self-referral blocking.

### Phase 6

- campaign kit generation;
- SEO pages;
- corridor/local/import pages;
- proof stories;
- FAQ drafts;
- WhatsApp/Telegram/Facebook/Instagram copy;
- UTM tracking;
- canonical URL;
- internal links;
- disclosure;
- stored draft before publication;
- approval/schedule/publish workflow;
- publisher role hardening;
- unsafe patch rejection.

### Phase 7

- risk checks;
- duplicate account signals;
- self-referral signals;
- code expiry and usage signals;
- minimum value signals;
- channel consent signals;
- public disclosure signals;
- AI trust recommendation stored as reviewable event;
- review queue;
- wallet holds;
- benefit explanations;
- disputes;
- dispute resolution;
- audit export;
- reason requirements;
- duplicate review-case blocking;
- audit/export limits.

If any concept is missing, implement it and add tests.

---

## 8. Static syntax checks

Run these first:

```bash
node --check backend/constants/referral/referralConstants.js
node --check backend/services/referral/referralEngineRepository.js
node --check backend/services/referral/referralEngineService.js
node --check backend/services/referral/referralAgentGatewayServiceSafe.js
node --check backend/services/referral/referralChannelGatewayService.js
node --check backend/services/referral/referralChannelPayloadParsers.js
node --check backend/services/referral/referralImportCampaignService.js
node --check backend/services/referral/referralImportCampaignHardenedService.js
node --check backend/services/referral/referralImportCampaignBenchmarkService.js
node --check backend/services/referral/referralMarketingSeoService.js
node --check backend/services/referral/referralMarketingSeoBenchmarkService.js
node --check backend/services/referral/referralTrustReviewService.js
node --check backend/services/referral/referralTrustReviewBenchmarkService.js
node --check backend/routes/referralRoutes.js
node --check backend/routes/promotionsRoutes.js
```

For local marketplace files, locate exact names and run `node --check` against them.

If any syntax check fails, fix it.

---

## 9. Run the phase test stack

Run in dependency order:

```bash
node --test backend/tests/referral-engine-phase1.test.js
node --test backend/tests/referral-agent-gateway-phase2.test.js
node --test backend/tests/referral-channel-gateway-phase3.test.js
node --test backend/tests/referral-local-marketplace-phase4.test.js
node --test backend/tests/referral-local-marketplace-phase4-hardening.test.js
node --test backend/tests/referral-import-campaign-phase5.test.js
node --test backend/tests/referral-import-campaign-phase5-hardening.test.js
node --test backend/tests/referral-marketing-seo-phase6.test.js
node --test backend/tests/referral-marketing-seo-phase6-hardening.test.js
node --test backend/tests/referral-trust-review-phase7.test.js
node --test backend/tests/referral-trust-review-phase7-hardening.test.js
```

Then run the full backend test suite:

```bash
npm run test --workspace=backend
```

If that command is wrong for this repo, inspect `package.json` and run the correct backend test command.

Do not hide failures. Capture exact failing output.

---

## 10. Route-level smoke verification

Inspect how routes are mounted:

```bash
grep -R "referral" -n backend/server.js backend/routes backend/services | head -100
```

Confirm `/api/referrals/*` is mounted correctly.

Smoke-test these route groups using the existing test harness, supertest, or local server.

### Foundation routes

- `POST /api/referrals/campaigns`
- `GET /api/referrals/campaigns`
- `POST /api/referrals/codes`
- `POST /api/referrals/validate`
- `GET /api/referrals/codes/:code`
- `POST /api/referrals/events`
- `POST /api/referrals/share-assets`
- `POST /api/referrals/coupons`
- `POST /api/referrals/coupons/apply`
- `POST /api/referrals/coupons/redeem`
- `GET /api/referrals/wallets/:userId`
- `POST /api/referrals/wallets/transactions`
- `PATCH /api/referrals/wallets/transactions/:id/status`
- `GET /api/referrals/admin/events`

### Agent routes

- `GET /api/referrals/agent/tools`
- `POST /api/referrals/agent/triage`
- `POST /api/referrals/agent/execute`

### Channel routes

- `POST /api/referrals/channels/:channel/inbound`
- `POST /api/referrals/channels/:channel/share-kit`
- `GET /api/referrals/channels/whatsapp/webhook`
- `GET /api/referrals/channels/facebook/webhook`
- `GET /api/referrals/channels/instagram/webhook`
- `POST /api/referrals/channels/whatsapp/webhook`
- `POST /api/referrals/channels/telegram/webhook`
- `POST /api/referrals/channels/facebook/webhook`
- `POST /api/referrals/channels/instagram/webhook`
- `POST /api/referrals/channels/web-chat/message`
- `POST /api/referrals/channels/mobile-chat/message`

### Local marketplace routes

- `GET /api/referrals/local-marketplace/rules`
- `POST /api/referrals/local-marketplace/intent`
- `POST /api/referrals/local-marketplace/leads`
- `POST /api/referrals/local-marketplace/referral-bundles`
- `POST /api/referrals/local-marketplace/leads/:leadEventId/qualify`
- `POST /api/referrals/local-marketplace/share-kit`

### Import campaign routes

- `GET /api/referrals/import-campaigns/rules`
- `POST /api/referrals/import-campaigns/routes`
- `GET /api/referrals/import-campaigns/routes/:routeKey/status`
- `POST /api/referrals/import-campaigns/routes/:routeKey/capacity`
- `POST /api/referrals/import-campaigns/referral-bundles`
- `POST /api/referrals/import-campaigns/leads`
- `POST /api/referrals/import-campaigns/leads/:leadEventId/qualify`
- `POST /api/referrals/import-campaigns/share-kit`

### Marketing routes

- `GET /api/referrals/marketing/rules`
- `POST /api/referrals/marketing/campaign-kits`
- `POST /api/referrals/marketing/seo-pages`
- `POST /api/referrals/marketing/channel-messages`
- `POST /api/referrals/marketing/proof-stories`
- `POST /api/referrals/marketing/faqs`
- `GET /api/referrals/marketing/assets`
- `PATCH /api/referrals/marketing/assets/:assetId/status`
- `POST /api/referrals/marketing/analytics/suggestions`

### Trust routes

- `GET /api/referrals/trust/rules`
- `POST /api/referrals/trust/risk-checks`
- `POST /api/referrals/trust/review-cases`
- `GET /api/referrals/trust/review-cases`
- `PATCH /api/referrals/trust/review-cases/:caseEventId/decision`
- `POST /api/referrals/trust/wallet-transactions/:transactionId/hold`
- `GET /api/referrals/trust/benefits/:transactionId/explain`
- `POST /api/referrals/trust/disputes`
- `PATCH /api/referrals/trust/disputes/:disputeEventId/resolve`
- `GET /api/referrals/trust/audit-export`

At minimum, prove each route mounts and returns expected auth behavior rather than crashing.

---

## 11. Build E2E stack tests

Create an E2E test file if it does not already exist:

```text
backend/tests/referral-engine-e2e-stack.test.js
```

It should simulate at least these flows.

### Flow A: Local marketplace referral

1. Create local campaign.
2. Create referral code.
3. Generate share assets.
4. Simulate WhatsApp or web-chat inbound with code.
5. Validate attribution.
6. Create local marketplace lead.
7. Qualify lead.
8. Confirm allowed wallet transaction behavior.
9. Confirm self-referral is blocked.
10. Confirm duplicate reward is blocked.
11. Confirm admin event trail contains the chain.

### Flow B: Import/container-space referral

1. Create import route page.
2. Set capacity.
3. Create container-space referral bundle.
4. Generate channel share kit.
5. Create lead with referral code and requested CBM.
6. Confirm over-capacity lead is rejected.
7. Qualify commercial milestone.
8. Confirm pending wallet benefit.
9. Run risk check.
10. Create review case.
11. Apply hold.
12. Explain benefit status to owner.
13. Open dispute.
14. Resolve dispute.
15. Export audit trail.

### Flow C: AI marketing/SEO

1. Create campaign kit from campaign/referral code.
2. Confirm generated page contains canonical URL, UTM, internal links, and disclosure.
3. Confirm WhatsApp, Telegram, Facebook, Instagram copy.
4. Approve/schedule/publish as marketing manager.
5. Confirm non-marketing actor cannot publish.
6. Confirm unsafe patch cannot remove disclosure or replace attribution.

### Flow D: Agent Gateway safety

1. Get tool catalog.
2. Run triage.
3. Validate code.
4. Generate share kit dry-run.
5. Attempt hidden persisted-write through context.
6. Confirm it is blocked.
7. Confirm wallet mutation tools are not exposed.

Run the E2E test:

```bash
node --test backend/tests/referral-engine-e2e-stack.test.js
```

---

## 12. Supabase migration and RLS checks

Inspect:

```text
database/migrations/016_referral_engine_phase1.sql
```

Confirm:

- all referral tables exist;
- RLS is enabled where expected;
- indexes exist for campaign/code/event/wallet lookup paths;
- unique constraints exist for referral codes and coupon redemptions where necessary;
- wallet status constraints match service constants;
- event table supports all phases;
- no service references missing columns.

If Supabase local/staging is available, run migrations and table checks.

If unavailable, report that clearly.

---

## 13. Security and role review

Review:

- `backend/routes/referralRoutes.js`
- `backend/middleware/authMiddleware.js`
- `backend/middleware/securityMiddleware.js`

Confirm:

- public code validation routes are intentionally public;
- wallet access is self/admin;
- coupon redemption cannot redeem for another user unless admin;
- marketing publishing requires marketing manager/admin;
- trust decisions require trust/compliance/admin role;
- webhook routes require valid channel secret or Telegram secret;
- local/test `x-user-id` fallback is limited to local/test environments;
- Agent Gateway secret cannot bypass forbidden write operations;
- browser-facing chat routes are not accidentally exempt from CSRF if CSRF exists.

Add regression tests for any gap.

---

## 14. Wallet and reward safety review

This is critical.

Confirm:

- signup alone cannot become payable;
- self-referral cannot create reward;
- duplicate reward for same lead/milestone is blocked;
- wallet maturity follows allowed transitions only;
- Agent Gateway cannot mutate wallet directly;
- trust hold can only happen through allowed trust/operator role;
- rejected trust review cannot produce payable reward;
- direct wallet transition route requires admin role.

Add tests if missing.

---

## 15. Channel robustness review

Test these payloads:

- Telegram `/start CODE`;
- Telegram callback query;
- WhatsApp text body;
- WhatsApp button payload;
- WhatsApp interactive reply;
- Facebook message;
- Facebook postback;
- Instagram message;
- web chat;
- mobile chat;
- unknown channel;
- invalid payload shape.

Expected:

- no crashes;
- known payloads normalize;
- unknown payloads safely return empty/no-op or validation error;
- attribution is preserved when code exists.

---

## 16. Marketing safety review

Confirm:

- generated drafts are stored before publication;
- disclosure cannot be removed;
- SEO attribution cannot be overwritten through patch;
- non-http base URLs are rejected;
- publishing requires tracked URL;
- non-marketing actor cannot approve/schedule/publish;
- channel names normalize safely;
- unsupported channels are rejected.

---

## 17. Trust and audit safety review

Confirm:

- duplicate review cases are blocked;
- hold actions require reasons;
- allow/approve/hold/reject decisions require reasons;
- benefit explanations use latest risk check deterministically;
- users cannot view another user’s benefit explanation;
- users cannot dispute another user’s benefit;
- disputes require reasons;
- disputes cannot be closed without resolved outcome;
- audit export has sane limits;
- audit exports include checksum and are themselves recorded.

---

## 18. Fixing rules

If a failure is found:

1. Identify root cause.
2. Patch the smallest safe surface.
3. Add or update tests.
4. Run the failed test again.
5. Run the full referral stack again.
6. Record exact before/after evidence.

Do not weaken tests to make them pass.

Do not delete meaningful tests unless the test is proven invalid; replace invalid tests with stronger stable coverage.

Do not merge PRs.

---

## 19. Required final report

Produce this final report:

```markdown
# CarUp Referral Engine Full Verification Report

## Executive Summary

- Overall status:
- Merge readiness:
- Blocking issues:
- Non-blocking issues:
- Tests executed:
- Tests passed:
- Tests failed:

## PR Stack Status

| PR | Branch | Base | Mergeable | Status | Notes |
|---|---|---|---|---|---|

## Documentation Alignment

| Phase | TRD Requirement | Implementation Status | Evidence |
|---|---|---|---|

## Test Evidence

Include command outputs or concise command evidence for:

- node --check commands;
- phase tests;
- hardening tests;
- backend test suite;
- E2E stack tests.

## Defects Found and Fixed

| Defect | Root Cause | Fix | Test Added | Commit |
|---|---|---|---|---|

## Remaining Risks

List only real remaining risks.

## UI Readiness

Explain what frontend/mobile can now build using the APIs.

## Merge Recommendation

State one of:

- Ready to merge sequentially;
- Not ready; blockers remain;
- Ready except for CI/staging verification.

## Exact Next Commands

List commands for final merge/staging validation.
```

---

## 20. Merge discipline

Do not merge until the report is reviewed.

When merge is approved later, merge only in this order:

```text
#62 -> #63 -> #64 -> #67 -> #68 -> #69 -> #71
```

After each merge, retarget or rebase the next PR if needed and rerun relevant tests.

---

## 21. Final reminder

Your job is not to praise the implementation.

Your job is to prove it.

Find what breaks. Fix it. Add tests. Keep the feature aligned with the TRDs. Make the backend ready for UI/staging validation.
