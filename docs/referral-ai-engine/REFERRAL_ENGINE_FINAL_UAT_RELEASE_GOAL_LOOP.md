# CarUp Referral Engine — Final UAT and Release Goal Loop

## Status and purpose

This document governs all remaining work after Referral Engine backend phases 1–7 and UI/mobile phases A–E. The implementation exists; the remaining work is staging readiness, end-to-end UAT, defect remediation, mobile validation, regression, release evidence, and controlled production promotion.

The loop must not declare success merely because compilation or unit tests pass. It must prove the referral business journey end to end.

## Final goal

The feature is ready for production only when all of the following are proven:

1. Separate staging admin and owner accounts log in through the real authentication flow.
2. Owner-to-admin escalation remains blocked.
3. Admin workflows pass with real staging records.
4. An owner-owned referral code is used by a real lead.
5. A rewardable milestone creates a wallet transaction for the correct owner.
6. The owner sees the benefit, receives an explanation, shares the code, and files a dispute.
7. Admin resolves the dispute and exports an audit trail with checksum evidence.
8. Local marketplace, vehicle import, parts import, and container-space flows pass.
9. Marketing assets obey the review/approval/schedule/publish state machine.
10. Mobile owner flows pass on a supported runtime.
11. All critical and high defects are fixed and retested.
12. Automated regression is green.
13. Final UAT, production-readiness, and rollback evidence is committed.
14. A release PR is ready for owner approval.

Production must not be deployed, migrations must not be applied to production, and the release PR must not be merged without explicit owner approval.

## Source-of-truth documents

Read these first:

- `docs/referral-ai-engine/00_MASTER_PLAN_AI_FIRST.md`
- `docs/referral-ai-engine/01_USER_ACCESS_AND_ROLES_TRD.md`
- `docs/referral-ai-engine/02_CODES_COUPONS_QR_BARCODE_ATTRIBUTION_TRD.md`
- `docs/referral-ai-engine/03_REWARDS_WALLET_SETTLEMENT_TRD.md`
- `docs/referral-ai-engine/04_LOCAL_MARKETPLACE_REFERRALS_TRD.md`
- `docs/referral-ai-engine/05_IMPORT_CARS_PARTS_CONTAINER_REFERRALS_TRD.md`
- `docs/referral-ai-engine/06_SOCIAL_CHANNELS_WHATSAPP_TELEGRAM_FACEBOOK_TRD.md`
- `docs/referral-ai-engine/07_AI_LAYER_TRD.md`
- `docs/referral-ai-engine/08_PUBLIC_AI_ASSISTANTS_TRD.md`
- `docs/referral-ai-engine/09_AI_MARKETING_SEO_AUTOMATION_TRD.md`
- `docs/referral-ai-engine/10_TRUST_FRAUD_COMPLIANCE_GUARDRAILS_TRD.md`
- `docs/referral-ai-engine/11_DATA_MODEL_APIS_EVENTS_TRD.md`
- `docs/referral-ai-engine/12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_VERIFICATION_REPORT.md`
- `docs/referral-ai-engine/SUPABASE_STAGING_VERIFICATION_20260613.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_UI_MOBILE_INTEGRATION_PLAN.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_UI_MOBILE_PHASES_B_TO_E_EXECUTION.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_MANUAL_TEST_DATA.md`

Original acceptance principle: the system is ready only when a referred user can enter from a social channel, create a verified lead or transaction path, retain attribution, produce a reviewable benefit record, and leave a complete event trail.

## Confirmed baseline that must be preserved

### Backend phases 1–7

1. Foundation: campaigns, codes, coupons, attribution, wallet, events, share assets.
2. Agent Gateway: tool catalogue and safe execution.
3. Social channels: share kits and inbound processing.
4. Local marketplace: intent, leads, bundles, qualification, rewards.
5. Imports: vehicle, parts, container routes, capacity, waitlist, qualification.
6. AI marketing and SEO: kits, pages, messages, stories, FAQs, workflow.
7. Trust: risk, cases, holds, disputes, resolution, audit.

### UI/mobile phases A–E

- A: typed web/mobile API clients.
- B: owner Refer & Earn web page and mobile tab.
- C: admin campaigns, codes, coupons, local leads, import routes.
- D: marketing, trust, disputes, audit.
- E: real list endpoints for codes, coupons, leads, routes, disputes.

Existing routes:

- Owner: `/dashboard/referrals`
- Admin: `/admin/referrals`
- Admin: `/admin/referrals/codes`
- Admin: `/admin/referrals/local-leads`
- Admin: `/admin/referrals/import-routes`
- Admin: `/admin/referrals/marketing`
- Admin: `/admin/referrals/trust`

Do not create a second referral, wallet, coupon, campaign, marketing, trust, or audit system.

## Loop execution contract

- Use multiple agents where work is independent.
- Work phase by phase and continue automatically after each phase gate passes.
- Reconcile all agent findings before committing.
- Commit by phase or coherent defect batch.
- Run a focused test after each fix, then the related full suite.
- Never fabricate a pass.
- Preserve unrelated stashes and branches.
- Open a release-candidate PR and stop before merge unless explicit approval is present.

Valid early-stop conditions only:

- staging secret unavailable locally;
- physical-device-only test cannot run;
- destructive action is required;
- critical security issue needs owner decision;
- production approval is required.

Complete all other independent work before reporting a blocker.

## Recommended agent allocation

- Environment/Auth agent: staging isolation, accounts, login, authorization.
- Admin UAT agent: campaign, codes, coupons, leads, imports, marketing, trust.
- Owner UAT agent: wallet, attribution, sharing, explanation, dispute.
- Mobile UAT agent: Expo/device flow.
- Test agent: API, Playwright, regression coverage.
- Release/Security agent: secrets, RLS/advisors, migration parity, rollback.

No two agents may edit the same file concurrently without coordination.

## Git discipline

Start from current `main`, inspect status and preserve all unrelated stashes. Create:

`feat/referral-final-uat-release`

Suggested commits:

- `fix(auth): complete referral staging UAT readiness`
- `test(referrals): automate admin and owner UAT journeys`
- `test(referrals): validate mobile referral journey`
- `fix(referrals): remediate UAT defects`
- `test(referrals): complete release-candidate regression`
- `docs(referrals): add production readiness evidence`

Do not commit environment files, keys, passwords, hashes, or session tokens.

# Phase F1 — Staging readiness

## Environment

UAT must target staging ref `eoyenigwevnxwwhyhaer`, never the main/production-looking ref `vhmnajoeicasaigiophh`.

Do not overwrite `backend/.env`. Use ignored local file `backend/.env.uat.local`, restrict file permissions, and load it only in the UAT shell.

It must locally define development mode, the staging URL, staging service-role credentials, explicit UAT confirmation, and two different strong passwords. None may be committed or printed.

Use only `backend/scripts/seed-uat-referral-users.mjs` to rotate/provision:

- `uat-admin@carup.local`
- `uat-owner@carup.local`

Do not reuse exposed historical passwords. Do not seed with ad-hoc SQL. Report only email, role, created/updated state, and owner ID.

## Authentication gates

Prove through API and browser:

- admin login succeeds;
- owner login succeeds;
- `/api/auth/me` succeeds for both;
- admin can access referral admin APIs;
- owner can access only owner referral APIs;
- owner cannot access admin referral APIs;
- owner-to-admin switch returns 403;
- invalid credentials return 401.

Fix `web/src/pages/auth/Login.tsx` if login errors remain unreadable. Provide a visible inline alert with strong contrast, icon, `role="alert"`, assertive live region, cleared state on retry, and distinct safe messages for invalid credentials, backend unavailable, and server/session failure. Add focused tests.

### F1 exit

Both accounts log in, staging target is proven, auth boundaries pass, login failures are readable, and no secret is committed.

# Phase F2 — Admin web UAT

Use real staging data only.

## Campaign

At `/admin/referrals`, create `CarUp Referral Test — Local`, type `LOCAL_MARKETPLACE`, scope `LOCAL`; activate it; refresh and verify persistence; test blank-name failure. Capture campaign ID.

## Codes, coupons, share assets

At `/admin/referrals/codes`:

- create campaign code `TESTLOCAL2026`;
- validate it;
- prove `NONEXISTENT` fails;
- create coupon `WELCOME10`, 10 percent;
- apply it to amount 100 and verify discount 10;
- redeem once and verify duplicate/invalid handling;
- generate share assets;
- verify attribution-preserving short/social links, QR payload, barcode, poster, and safe rendering.

## Owner-owned bundle and local lead

At `/admin/referrals/local-leads` create a referral bundle owned by the staging owner ID. Capture bundle code. Blank owner ID must fail.

Create a Toyota Aqua lead using the bundle code. Capture lead event ID. Qualify with milestone `order_paid` and reward amount `5`.

Prove:

- reward was created;
- wallet transaction belongs to the code owner;
- non-rewardable milestone creates no reward;
- duplicate qualification does not create an unintended duplicate reward.

## Import and container routes

At `/admin/referrals/import-routes`:

- create Japan→Zimbabwe vehicle route, capacity 8 vehicles;
- verify open 0/8;
- update to full 8/8 and verify persistence;
- create Japan→Zimbabwe container route, capacity 30 CBM;
- create 5 CBM lead;
- prove over-capacity without waitlist fails;
- prove over-capacity with waitlist becomes waitlisted;
- qualify import lead with `deposit_paid` and reward amount `10`;
- prove reward attribution.

## Marketing

At `/admin/referrals/marketing`, create campaign kit, SEO page, channel message, proof story, FAQ, and analytics suggestion. Prove:

- `draft → review → approved → scheduled → published` works;
- illegal jump fails;
- scheduling requires time;
- rejection requires reason;
- disclosure, canonical URL, UTM, and internal links remain intact;
- publish only occurs through the backend workflow.

## Trust and audit

At `/admin/referrals/trust`, prove:

- risk check and score;
- review case list;
- decision requires reason;
- wallet hold requires reason;
- benefit explanation;
- audit export event count and checksum;
- referral trust remains separate from vehicle trust review.

### F2 exit

All admin flows pass with real staging records and captured evidence.

# Phase F3 — Owner reward loop

Login as the dedicated owner and open `/dashboard/referrals`.

Prove:

- pending balance includes the local reward;
- optional import reward is present if created;
- pending, approved, and settled remain separate;
- owner sees only their wallet;
- `Why?` gives a clear explanation;
- bundle code validates;
- share kit preserves attribution;
- available channel links work;
- copy/share feedback is visible.

File a dispute on the local reward with reason `Benefit not received yet`.

Then admin must:

- see the real dispute;
- resolve using an allowed outcome and required reason;
- verify final status;
- verify audit create/resolve events.

### F3 critical exit

The wallet transaction belongs to the owner who owned the bundle code. Any mismatch is a critical defect.

# Phase F4 — Mobile UAT

Use a supported Expo development build, emulator, or physical device. Record the path used.

Prove:

- owner login persists;
- Referrals tab is visible;
- wallet and transactions load;
- balances are distinct;
- code validates;
- native share sheet opens with referral link;
- explanation loads;
- dispute submits;
- loading, empty, offline, and error states are readable;
- small-screen layout does not clip controls;
- tab/back navigation is stable;
- staging API is used, not production.

Do not add a QR library unless the backend lacks a usable payload and the requirement cannot otherwise be met. Document any dependency decision.

### F4 exit

Mobile owner flow passes, or the sole residual item is explicitly documented as device-only manual confirmation.

# Phase F5 — Defect remediation loop

Severity:

- Critical: wrong wallet owner, privilege escalation, cross-tenant exposure, duplicate rewards, production used for UAT, lost attribution, corruption.
- High: core journey blocked, dispute unresolved, capacity bypass, marketing workflow bypass, invalid audit, unusable mobile flow.
- Medium: stale lists, weak errors, refresh/accessibility/responsive problems.
- Low: cosmetic or wording defects.

For every defect: record reproduction, add regression coverage, fix the smallest responsible layer, rerun focused and related suites, and retest the journey.

Continue until zero critical and zero high defects remain.

# Phase F6 — Release-candidate regression

Run at minimum:

```bash
tsc -p web/tsconfig.app.json --noEmit
npm run test:unit --workspace=web
npm run ts:check --workspace=mobile
node --test backend/tests/auth-login.test.js
node --test backend/tests/referral-*.test.js
node --test backend/tests/referral-engine-route-smoke.test.js
node --test backend/tests/referral-engine-e2e-stack.test.js
npm run test --workspace=backend
npm run build --workspace=web
```

Add automated API/Playwright journeys for:

- campaign → code → coupon → share assets;
- owner bundle → lead → `order_paid` → owner wallet;
- import/container → capacity/waitlist → `deposit_paid`;
- marketing state machine and illegal transition;
- risk → case → decision → dispute → resolve → audit checksum;
- admin/owner authorization boundaries.

Security checks:

- no service-role key in browser/mobile bundles;
- no UAT password/hash/token committed or logged;
- tenant filters and pagination limits remain enforced;
- no RLS/advisor regression;
- audit events exist;
- production was not mutated by UAT.

Accessibility/performance checks:

- no repeated request loops;
- lists remain usable with pagination;
- forms have labels and visible errors;
- keyboard access works for critical paths;
- loading/empty states are readable;
- no major console errors;
- production build succeeds.

### F6 exit

All required suites pass and no critical/high defect remains.

# Phase F7 — Release evidence

Create and commit:

- `docs/referral-ai-engine/REFERRAL_ENGINE_FINAL_UAT_REPORT.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_PRODUCTION_READINESS.md`
- `docs/referral-ai-engine/REFERRAL_ENGINE_ROLLBACK_RUNBOOK.md`

Final UAT report must include environment, tested commit, accounts by email/role without passwords, owner ID, created test IDs, PASS/FAIL per journey, artifact references, test totals, defects and fixes, residual risks, mobile runtime, and acceptance statement.

Production-readiness document must include migration parity, required environment variables without values, secret ownership, deployment targets, routes, monitoring, data cleanup, smoke checklist, and go/no-go criteria.

Rollback runbook must include web/backend rollback, migration forward-fix or rollback approach, referral navigation disablement, safe reward pause strategy, preservation of wallet/dispute/audit data, post-rollback validation, and approver.

Open one release-candidate PR to `main` with all fixes, tests, evidence, staging preview links, and exact test results. Do not merge.

### F7 exit

Release PR is green, reviewable, and ready for explicit owner approval.

# Phase G — Controlled production promotion

Without explicit approval, stop at the release PR.

With explicit approval:

1. Confirm approved head SHA has not moved.
2. Merge using approved repository method.
3. Apply reviewed production migrations in order.
4. Deploy backend and web.
5. Release mobile separately if in launch scope.
6. Run non-destructive production smoke tests.
7. Verify logs, audit, monitoring, and rollback readiness.
8. Record release outcome.

Production smoke tests must cover health, public code validation, owner wallet read, admin list reads, marketing/trust rules reads, route rendering, and absence of staging identifiers or secrets. Do not create production rewards merely for smoke testing without a controlled test tenant and explicit approval.

## Final definition of done

Done means staging admin UAT, owner reward-loop UAT, mobile UAT, correct wallet attribution, local/import/container attribution, dispute/audit, marketing workflow, authorization/tenant boundaries, zero critical/high defects, green regression, committed release evidence, approved production promotion, and successful post-deploy smoke tests.

## Required final report

Return one consolidated report containing:

- branch, commits, and release PR;
- PASS/FAIL for F1–F7;
- production promotion state;
- staging target verification;
- admin and owner login results;
- owner ID;
- wallet attribution result;
- dispute lifecycle;
- audit checksum;
- container capacity/waitlist;
- marketing workflow;
- exact automated test totals;
- defects found/fixed;
- residual risks and hard blockers;
- files and evidence documents;
- rollback document;
- owner action required.

Do not omit failed checks and do not claim production completion unless explicitly approved and smoke-tested.