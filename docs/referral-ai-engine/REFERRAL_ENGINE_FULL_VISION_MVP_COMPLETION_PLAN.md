# CarUp Referral & Ambassador Engine — Full-Vision MVP Completion Plan

**Status:** Authoritative continuation plan  
**Created:** 2026-06-25  
**Baseline:** `main` at `6f1bc8551f328179ef7610fbdfe09e1740304b84`  
**Foundation release:** PR #88 merged as `37cc485c94e85d793c5887c391e155a96a9264fc`

## 1. Decision

The Referral Engine foundation and launch-critical reward loop are implemented, tested and merged. The original TRD vision is broader than that release. From this point, no capability named in the original Referral & Ambassador TRDs may disappear through an informal “future roadmap” classification.

Every named capability must receive either:

1. a usable MVP implementation; or
2. a separately approved external-dependency issue with owner, acceptance criteria and target phase.

This plan supersedes the **deferral decision** in `REFERRAL_ENGINE_LAUNCH_SCOPE_CLASSIFICATION.md` for future implementation planning. That document remains valid historical evidence for PR #88.

## 2. Current baseline

Implemented and proven on staging:

- campaigns, codes, coupons, share assets and events;
- correct-owner attribution and duplicate-reward prevention;
- local leads and bundles;
- vehicle, parts and container-space leads/capacity/waitlist;
- WhatsApp/Telegram inbound attribution;
- AI triage and marketing assets;
- risk checks, review cases, wallet holds, disputes and audit export;
- owner web/mobile Refer & Earn;
- admin campaign, code, local lead, import, marketing and trust consoles;
- 67/67 staging UAT;
- 4/4 browser UAT;
- 157/157 backend tests and 139/139 web tests at the release baseline.

The current website exposes about **35 real interactive referral actions** across:

- `/dashboard/referrals`
- `/admin/referrals`
- `/admin/referrals/codes`
- `/admin/referrals/local-leads`
- `/admin/referrals/import-routes`
- `/admin/referrals/marketing`
- `/admin/referrals/trust`

The production branch contains the code, but the production database did not contain the nine `public.referral_*` tables at the last verified inventory. Full production activation must wait for schema parity and this MVP-completion programme unless the owner approves a narrower beta.

## 3. Original-plan gaps that require MVP closure

| Capability | Current state | MVP required |
|---|---|---|
| Permanent code for every user | **IMPLEMENTED (Wave A)** | Idempotently issue one permanent member code after registration or first authenticated bootstrap |
| Universal referral widget | **IMPLEMENTED (Wave A)** | My code, direct channel shares, downloadable QR, referred-user/conversion summary, active campaigns and rewards |
| Visual QR | **IMPLEMENTED (Wave A)** | Scannable QR, download/print and tracked redirect event |
| Barcode validation context | **IMPLEMENTED (Wave A)** | Agent/depot/invoice/booking scan form that logs context without approving reward |
| First/last/assisted attribution | **IMPLEMENTED (Wave A)** | Persist and display first, last and assisted touches while keeping deterministic reward ownership |
| Cross-surface continuation | **IMPLEMENTED (Wave A)** | Preserve attribution through anonymous visit, signup, login, inquiry/quote, WhatsApp, mobile and agent handoff |
| Zimbabwe receiver | Metadata only | Payer–receiver relationship, invitation/acceptance and receiver tracking/referral journey |
| Ambassador | Can own codes/bundles | Ambassador profile, grouped campaigns, share kit, conversions, rewards, tiers and own-only dashboard |
| Mechanic/parts supplier | Participant types exist | Dedicated parts referral/request journey, milestone, own referrals and rewards |
| Agent/depot | Operator APIs exist | Assisted registration, QR/barcode scan, own-lead queue and no self-approval |
| Local buyer integration | Admin lead form exists | Referral field in real registration/inquiry/checkout paths and discount eligibility |
| Local seller integration | Seller participant exists | Listing-specific link/QR, verified listing/first-sale milestones, listing boost or fee refund |
| Import payer/receiver relation | Generic import lead exists | Separate linked payer and receiver identities on one trade path |
| Vehicle import milestones | Generic qualification exists | Quote, deposit, inspection, purchase, shipment, documents, customs/handover and delivery hooks |
| Parts intake | Generic lead exists | Part number, vehicle details and photo/document upload linked to quote, payment, dispatch and delivery |
| Container public booking | Admin capacity flow exists | Public campaign page, close date, rules, pricing, countdown, capacity meter, booking and confirmation-share loop |
| Reward settlement operations | Ledger/statuses exist | Admin reward ledger, approve/hold/block/reverse/payable/paid actions, refund reversal and payout batch/export |
| Ambassador tiers | Not surfaced | Tier thresholds, progress, monthly review and tier bonus entries |
| WhatsApp consent/intake | Webhook/share links exist | Stored opt-in/opt-out and guided car/parts/container/sell/refer/track intake before handoff |
| Telegram/community | Deep links exist | Route alerts, group codes, group-admin ownership and bot campaign links |
| Facebook/Instagram workflow | UTM and draft copy exist | Editable variants, disclosure enforcement and review/schedule/publish handoff |
| AI multilingual content | Drafts exist | Reviewed English, Shona and Ndebele variants |
| AI operational tools | Safe triage exists | Safe create-lead, request-quote, reserve-interest, listing-draft and structured-parts tools; no financial authority |
| AI follow-up | Analytics suggestion exists | Status-aware follow-up drafts, inactive-ambassador and campaign recommendations |
| Real fraud signals | Risk metrics can be supplied | Normalize available identity/payment/receiver/device/IP/velocity/refund/agent signals and explain scores |
| Consent/KYC/KYB hooks | Auth and audit exist | Link eligibility to verification status and enforce disclosure/import claim review |
| Reporting | Lists exist | Funnel, reward cost, local-vs-import ROI, fraud/dispute by channel/referrer and CSV export |
| Delivery proof loop | Proof-story draft exists | Consent, edit/approve, protected data and campaign/referral link after delivery |
| Mobile completion | Owner screen exists | Device UAT plus receiver tracking and ambassador summary/share MVP |

## 4. Delivery waves

### Wave A — Identity, attribution and universal sharing

Build permanent code issuance, universal widget, rendered QR, contextual barcode scan, first/last/assisted attribution and cross-surface persistence.

**Exit:** one code per user; no duplicates; tracked scans; visible attribution path; deterministic reward owner; desktop/tablet/mobile widget tests.

### Wave B — Roles and specialist journeys

Build receiver, ambassador, mechanic/supplier, agent/depot and seller MVP surfaces with strict own-data boundaries.

**Exit:** payer and receiver linked; ambassador own dashboard; mechanic parts journey; agent own leads/no self-approval; seller listing link/QR.

### Wave C — Real marketplace, import and container integration

Attach referrals to real registration, inquiries, listings, orders, Diaspora imports, inspections, documents, delivery and container bookings.

**Exit:** attribution survives into real trade records; quote alone never rewards; configured milestone matures; refunds reverse; capacity cannot overbook.

### Wave D — Rewards, channels and AI operations

Build reward operations/payout batches, consent, guided channel intake, community codes, multilingual content and safe operational AI tools.

**Exit:** every status change audited; consent respected; disclosure present; AI cannot approve rewards or sensitive publishing.

### Wave E — Trust signals, reporting and proof loop

Build normalized fraud signals, compliance hooks, campaign/ambassador reporting, ROI exports and delivery proof-story approval.

**Exit:** explainable review decisions; own-only ambassador analytics; local/import ROI comparison; consented proof stories.

### Wave F — Mobile proof and unified production promotion

Complete device UAT, mobile receiver/ambassador MVP, exact schema parity, production migrations, backend/web promotion and unified smoke tests.

**Exit:** every original module has a usable form/channel flow and end-to-end evidence; production auth, marketplace, imports, wallet, trust and audit operate together.

## 5. Required visible surfaces still to add

1. Universal Referral Widget
2. Receiver invitation/tracking page
3. Ambassador dashboard
4. Mechanic/parts-supplier referral page
5. Agent/depot assisted-leads page
6. Seller listing-share/rewards panel
7. Buyer referral/discount field in real transaction paths
8. Parts request with photo and vehicle details
9. Public import/container campaign and booking page
10. Admin rewards/payout operations page
11. Consent/channel preferences
12. Campaign analytics and ROI dashboard
13. Mobile receiver tracking
14. Mobile ambassador summary/share

## 6. Engineering rules

For each wave:

1. audit current code before implementation;
2. create a focused branch and PR;
3. implement data, backend, UI and tests together;
4. use additive, idempotent migrations;
5. run type, unit, integration, browser/mobile and live staging tests relevant to the wave;
6. update this plan and the requirements matrix;
7. stop before merge unless the owner approves.

An original TRD item is not complete because an API placeholder exists. Completion requires a stored contract, authorization/ownership enforcement, usable surface or channel flow, audit event, automated tests and live staging evidence.

## 7. Full-vision MVP definition of done

Completion requires:

- all named roles have usable MVP journeys;
- permanent user identity and multi-touch attribution work;
- local, vehicle, parts and container referrals attach to real CarUp records;
- QR, barcode, web, mobile and social channels preserve attribution;
- consent is stored and respected;
- rewards mature, reverse and settle through an auditable ledger;
- ambassador tiers/grouped campaigns work;
- real fraud signals feed human review;
- AI creates reviewed multilingual assets without financial authority;
- funnel, reward cost, ROI and fraud/dispute reporting exist;
- delivery proof can create a consented proof story;
- web/mobile form-level UAT passes;
- staging and production schema are in parity;
- unified production smoke passes with no critical/high defect.

## 8. Immediate next action

Start **Wave A** from current `main` in a new implementation branch. The first PR must deliver:

- permanent code issuance;
- universal referral widget;
- rendered/downloadable QR;
- tracked QR/barcode flows;
- first/last/assisted attribution persistence;
- cross-surface continuation tests;
- updated coverage matrix.

Do not publicly activate the production Referral Engine until the full-vision MVP programme is complete or the owner explicitly approves a narrower controlled beta.