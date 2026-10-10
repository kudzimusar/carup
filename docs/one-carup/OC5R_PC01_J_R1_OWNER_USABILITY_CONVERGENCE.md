# OC-5R-PC01-J-R1 — Owner Usability Convergence

**Disposition received:** OWNER USABILITY CHECKPOINT 1 — REMEDIATE (moderator brief, 2026-10-10).
**Branch / PR:** `fix/oc5r-real-runtime-source-closure` · #222 (Draft, open, unmerged).
**Start:** PR head `d13c2e78` (deploy commit of the Checkpoint 1 pair, frozen reviewed candidate) + local
docs commit `b0e094d1`. **Code head:** `896ee73f`. Production was not touched; no customer channel was
invoked; no fixture was created, deleted or reset.

This document records the remediation. The deploy commit `40621751` carries sections A–H as certified. Deployment
ids, the runtime proof of the new pair, the live traversals and native runtime evidence (§§G–J, marked *recorded
after deployment*) are added by the next docs commit, because a deploy commit cannot contain its own deployment.

---

## A. Custody

| | |
|---|---|
| start (PR head) | `d13c2e7821551e8d3adfee2930a6f312f8f9ed4b` |
| start (local, unpushed docs) | `b0e094d16119f9f1b719966bca3791327588a4b6` |
| code head | `896ee73f753bb73ca232da04904cdd8272fbeeb1` (7 commits below) |
| changed | 81 files (14 added, 67 modified, 0 deleted; +2,613 / −1,671 lines): web 54, mobile 18, backend 7, shared 2. No migration, workflow or package file |
| deploy commit | the commit that adds this document: the code head plus documentation and evidence only (`verify-deployment-candidate`: pairing `absent`, both pairing records unchanged) |

| commit | scope |
|---|---|
| `4e396f11` | backend — owner publication history, passport key policy on every route, legal-page identity |
| `2eed5387` | seller — the account listing opens from `?vin=`; "publishable" explained |
| `02d77a37` | access — one guest-access policy held to the router; session-only panels gated |
| `edd6b745` | identity — one frozen public identity; truthful Contact, Help, Careers, Press Kit |
| `0cfdfcdc` | navigation — certified matrix; no public link into a private workspace |
| `6bd73c93` | responsive — 0 overflow, 44 px targets at 320–430 px; desktop unchanged |
| `896ee73f` | native — guests browse, accounts can be created, garage actions reach the server |

Erratum: commit `6bd73c93` says "112 sub-44 px controls per width" before the fix. 112 was the count
after the shared-primitive floor; the original was **219 per width** (1,095 across the five widths).
The overflow figures in that message are correct.

**Exact-head certification of `896ee73f`** (clean detached worktree, 2026-10-10T19:00:41–19:06:22Z;
`evidence/OC5R_PC01_J_R1_CERTIFICATION.json`):

| check | result |
|---|---|
| backend full suite | 8,441 tests: 8,417 pass, 23 skipped, **1 fail**. That failure is environmental: the 130-request rate-limit test (`navigation-analytics.test.js:417`) died with `fetch failed` while swap stood at 13.6 of 14.3 GB. J-R1 does not touch it; it passed in the earlier full run and passes 4 of 4 in isolation (25 of 25 in the file) |
| web | vitest 246 files / 2,311 tests pass; `tsc` (app) and `tsc -b` clean; build clean; production bundle carries no demo identity |
| mobile | vitest 6 / 66; 18 of 18 standalone scripts; `tsc --noEmit` clean |
| database / guards | migration integrity; PGlite 30 of 30; gate-assertion, shard-tripwire, DB-connection, CR-1 and evidence-certification guards; `git diff --check` clean |
| lint | the 53 web files J-R1 adds or changes: 0 new messages (13 errors and 1 warning, all pre-existing, identical per file and rule) |

A concurrent agent (ChatGPT Codex) had been given this same brief and created a detached worktree at
`d13c2e78`. The Product Owner assigned J-R1 to this lane; that worktree was left untouched and the
remote branch was confirmed unchanged before every push.

---

## B. Kingston and the Serena (GFC27-027051)

Staging reads were read-only (`supabase-carup-staging`, `default_transaction_read_only = on`). No
credential, hash, token, IP address or user agent was read. Receipt:
`evidence/OC5R_PC01_J_R1_KINGSTON_CONTINUITY.json` (2026-10-10T19:09:16Z).

**Authentication — proven, read-only.** The account the brief names is `u_66cace85fad949e4`, platform
role `owner`. `login_attempts`: password sign-ins succeeded at 2026-10-10T15:43:46Z (after one failed
attempt at 15:43:36Z) and 17:07:35Z. Both `user_sessions` are valid until 2026-10-11. The Checkpoint 1
backend's runtime logs attribute that session's requests to `u_66cace85fad949e4`.

**Private visibility — the data path serves it; the Sell workspace hid it (defect, fixed).**
- The Serena exists exactly once (`vehicles`: 1 row for the identifier). Its `owner_id` and
  `current_seller_id` are both this account, and it is the account's only vehicle. `GET /api/vehicles/me`
  returned 200 to this session every time (1.8–4.1 s; Checkpoint 1 backend logs, 15:43–17:11Z).
- **Defect:** `/dashboard/sell-vehicle?vin=GFC27-027051` — the owner's own link — let a browser draft
  win over the account. The first visit copied the listing into the guest draft, so every later visit
  or reload reopened it as "Your guest preview has been restored", without the account listing, its
  canonical identity lock or publication readiness. The same copy kept engine, chassis and plate
  numbers in unscoped browser storage after sign-out. Fixed in `2eed5387` (an explicit `?vin=` is
  authoritative; account listings are never copied into guest storage); 4 tests fail on the previous
  code; each guard mutation-checked.

**Why `publishable` is not public — proven from the audit trail.**
- The Marketplace read path shows `published` and nothing else (`utils/vehicleStatus.js`);
  `publishable` means "ready, not live".
- `trust_audit_events` for GFC27-027051 holds 27 publishes and 26 unpublishes by this account
  (2026-09-02 → 09-26). They come as unpublish → publish cycles about 10 s apart, the pattern of the
  governed Serena staging UAT (spec 43 signs in as this account and runs unpublish → republish; 66 of
  its runs fall in that window, 30 of them successful).
  The account's last action **published** the listing (2026-09-26T20:08:27Z).
- On **2026-10-06T23:32:43Z** the moderator-authorised staging reconciliation **OC-5R-DB2B-1** took
  all 88 published vehicles off the Marketplace in one transaction. It moved this listing
  `published → publishable` as a system actor, with the recorded reason "Not a seller action. No row
  deleted." The rollback is `DB2B_ROLLBACK_01_quarantine`. In that phase's classification this lane
  placed the Serena in the "owner-review" class, with UATP6TXN20260820A: neither seed, synthetic nor
  a test fixture. Nothing has republished it since.

**Understandable in the UI.** The badge reads "Ready to publish — not on the public Marketplace yet".
My Listings now explains, from the audit trail via `publication_last_change` on `/api/vehicles/me`:
"CarUp took this listing off the public Marketplace on 6 October 2026. This was not your action.
Buyers cannot see this listing — it is not on the public Marketplace. Choose “Publish to Marketplace”
when you are ready: CarUp re-checks its publication requirements first and names anything still
missing." Only direction, time and who-in-owner-terms leave the server.

**Public Vehicle Passport — a guest exposure found and closed.** Anonymous, 2026-10-10:
`passport/lookup/GFC27-027051` → 401 (policy), but `/api/vehicles/GFC27-027051/passport` → **200** with
the unpublished vehicle's full passport (claims, evidence timeline, ownership summary, finance block);
details and listing → 404. The per-key route now answers the 2026-08-17 lookup policy first: a frame-
or chassis-shaped key resolves anonymously only while the vehicle is publicly listed. An ISO VIN still
resolves for anyone, and a signed-in caller still reaches every record (R27: durable history survives
withdrawal — reconciled in test R27-C2).

**No fabrication.** No second Serena, no duplicate ownership, no authority granted, no fixture reset.
The publication transition, Marketplace appearance, public Passport and inquiry are the owner's
actions at Checkpoint 2 (§J): they need Kingston's own session, and publishing re-runs CarUp's gate.

---

## C. Public identity — every stale value and its disposition

Authority: `CARUP_PUBLIC_IDENTITY_SAFE_REMEDIATION_PACKET.md` (frozen owner dispositions),
`EMAIL_EXPERIENCE_1_0_CONTACT_IDENTITY_MAPPING.md` (`MIGRATE_SHIPPED_CARUP_CO_ZW_CONTACTS = YES`;
seven certified functional aliases plus inbound-certified `questions@`), `emailBrandIdentity.js`.
The web now reads one module, `web/src/config/publicIdentity.ts`, held equal to Email's by test.

| stale value (where) | disposition |
|---|---|
| `info@carup.co.zw` (Footer, Contact) | → `info@carup.dev` |
| `support@carup.co.zw` (Contact, Help ×1, Trust & Safety ×6) | → `support@carup.dev` |
| `press@carup.co.zw` (Press Kit ×5) | → `press@carup.dev` |
| `legal@` / `privacy@` / `support@carup.co.zw` (backend `/privacy-policy`, `/terms`, `/data-deletion`, footer) | → `@carup.dev` per the approved mapping; legal text otherwise byte-identical |
| `tendai@carup.co.zw` placeholder (Careers) | page replaced (see Careers) |
| `+263 242 700 000` (Footer) | removed — no number is approved |
| `+263 242 755 889`, `+263 772 400 121` (Press Kit copy-contact) | removed |
| `+263 773 345 678` demo-seed placeholder (Trust & Safety, native Register) | → "Your mobile number" |
| `+263 772 123 456`, `+263 773 123 456` placeholders (Press Kit form, Careers form) | forms removed |
| `Office 402, Batanai Gardens, Jason Moyo Ave` (Press Kit ×2), "Samora Machel Avenue" HQ claim (Press Kit) | removed → "HQ: Tokyo, Japan · Regional office: Harare, Zimbabwe" |
| `123 Samora Machel Ave, Harare` pre-filled on `/kyc` | cleared (retire/redirect `/kyc` stays an owner decision) |
| "Harare (Avondale) and Bulawayo hubs", "solar-backed innovation campus" (Careers ×3) | removed with the fabricated Careers content |
| "CarUp Zimbabwe" (Footer copyright, Help HQ card, Careers ×2) | → "CarUp Technologies" / removed |
| "CarUp (Pvt) Ltd" + patents claim (Press Kit) | → "CarUp Technologies"; patent claim removed (UNVERIFIED_DO_NOT_PUBLISH) |
| "CarUp Automotive Intelligence Private Limited" (backend legal footer) | → "CarUp Technologies" |
| "One vehicle. One truth. One public contract." labelled Tagline (Press Kit) | → "Know the car. Trust the journey." |
| `<title>` "Zimbabwe's Automotive Intelligence Platform" | → "CarUp — Automotive Intelligence & Trust Network" + description |
| Footer descriptor "Zimbabwe's verified automotive marketplace…" | → approved descriptor + tagline |
| "Business Hours" (Contact, Help, Press Kit) | removed — none are kept |
| "Founded 2024 / Launched in Harare" (Press Kit), "2024 Founded" (About) | removed — unverified |
| "AI-generated trust score" (About) | → "a versioned Trust position derived from the evidence CarUp holds" |
| "Published by CarUp Public Relations Department, Harare Office." | → "Published by CarUp Technologies." |
| "Tendai Moyo" placeholders (Press Kit, Careers, Trust & Safety); `/kyc` pre-filled person | removed / → "Your name" |
| "Gutu AI Support Assistant — Online", "support ticket", "Harare support squad" (Help) | simulator removed; its accurate answers kept as fixed "Straight answers" |
| "CBZ SafePay Escrow", "CBZ pre-approval loans" (native verification intro) | removed — no bank integration exists |
| "CarUp Kimi" (native lock screen, biometric prompts) | → "CarUp" |
| **Retained, with reason** | |
| "CarUp Automotive Intelligence" in the auth email footer (`authEmailTemplates.js:101`) | superseded under Email X2's own golden-fixture migration; no email is sent while the kill switch is active |
| `questions@carup.dev` (Support) | inbound routing certified 2026-08-18 — publishable |
| "Harare, Zimbabwe" as regional office | the approved location |
| product-form placeholders `tendai@example.com`, "Example Motors (Pvt) Ltd" (Register), "e.g. Tendai Moyo" (mechanic dashboard) | product fixtures by the packet's scope boundary (§0.1), not identity claims |
| API Docs sample payload | page is planned (§D) and does not render |

Shipped lines per category, `d13c2e78` → `896ee73f`. Test files and comment lines are excluded.
Evidence: `evidence/OC5R_PC01_J_R1_IDENTITY_SWEEP.json`.

| category | before | after |
|---|---:|---:|
| `@carup.co.zw` addresses | 23 | 1 |
| +263 phone numbers | 7 | 1 |
| street addresses | 8 | 0 |
| demo people | 7 | 3 |
| entity-name variants | 10 | 4 |
| unverified claims | 1 | 0 |

Each of the 27 remaining shipped hits was then read in source and classified:

| class | count |
|---|---:|
| approved values (location, tagline, `questions@`, identity modules) | 9 |
| comment continuation lines | 3 |
| statements that none are published | 3 |
| planned page (does not render) | 3 |
| never rendered (staging constants, a guard) | 3 |
| product-form placeholders (§0.1) | 3 |
| false positives (link expiry, SLA code) | 2 |
| deferred (the auth email footer) | 1 |

Regression: `publicIdentity.test.ts` scans web, native and the backend legal pages (comments stripped)
— 14 assertions; restoring the previous footer fails three of them.

---

## D. Navigation — certified matrix

`navigationCertification.test.ts` builds the matrix from the selectors the components render (set
`NAV_MATRIX_OUT` to write it; `evidence/OC5R_PC01_J_R1_NAV_MATRIX.json`).

| viewer | items | PUBLIC_ACTIVE | AUTH_ACTION | AUTH_WORKSPACE | PLANNED_DISABLED | BROKEN |
|---|---:|---:|---:|---:|---:|---:|
| guest | 119 | 72 | 4 | **0** | 43 | **0** |
| owner (signed in) | 137 | 65 | 0 | 29 | 43 | **0** |

Before (deployed `d13c2e78`, anonymous browser traversal at 1440 and 393 px;
`evidence/OC5R_PC01_J_R1_NAV_BEFORE.json`): 131 rendered items, of which 21 were disabled, reaching
35 destinations. 6 footer links sent a guest to Sign In (`/dashboard`, `/dealer`, `/mechanic`,
`/insurance-dash`, `/government`, `/bank`).

After (*recorded after deployment*; the new pair, the same traversal;
`evidence/OC5R_PC01_J_R1_NAV_AFTER.json`):
- 129 rendered items, 43 of them planned-disabled, reaching 31 destinations;
- every destination returns 200, with 0 API 401s, 0 5xx and 0 console errors;
- the only destination that is Sign In is the Sign In link.

The browser count (both viewports, as rendered) and the matrix count (per viewer, from the selectors) differ by
construction.

**Remediated:**
- 6 stakeholder role-dashboard links removed; the column now holds 4 public entry points (`/sell`,
  `/dealers`, `/garages`, `/diaspora`).
- 15 items whose destination did not deliver the label are planned (ZIMRA/CID/odometer "signals",
  part-level checks, "Report Stolen Part", "Link Part to Passport", non-existent guides).
- 7 coverage-gated Buy items show "None yet" rather than linking to the unfiltered Marketplace.
- Guest Sell (header CTA, Sell menu, drawer, bottom bar) all enter `/sell`.
- 4 guest workspace CTAs keep their destination through `/register?returnTo=`.
- "Dealer Listing" and "Mechanic Work Orders" show guests the public directory.
- API Documentation is planned: it documented endpoints that do not exist.
- Press Kit "Developer Portal" link removed; Marketplace "Finance" → "Pricing"; Contact's
  `/dashboard/ai` link removed.
- Social: 4, planned, disabled, no URL (unchanged — correct).

**Totals:** broken 0; stale removed 8; mislabelled or misdirected corrected 30; planned-disabled 43.

---

## E. Guest-access matrix

The authoritative policy is `web/src/config/publicAccessPolicy.ts`; `publicAccessPolicy.test.ts` holds
the router to it.

| surface | class | guest can | account asked at |
|---|---|---|---|
| Home | PUBLIC | everything | — |
| Marketplace | PUBLIC_READ+AUTH_ACTION | browse, filter, compare, favourites in browser | saving to an account |
| Vehicle details | PUBLIC_READ+AUTH_ACTION | read a published listing + public Passport | saving; Trust reasons/source coverage; reports |
| Vehicle Passport | PUBLIC_READ+AUTH_ACTION | exact VIN; publicly listed vehicles | plate/chassis/frame/temp-ID; unlisted vehicles |
| Verify | PUBLIC_READ+AUTH_ACTION | search; exact VIN | restricted identifiers (now says so) |
| Dealers | PUBLIC_READ+AUTH_ACTION | directory + how to join | applying |
| Garages / Services | PUBLIC_READ+AUTH_ACTION | published garages | requesting service; registering a garage |
| Parts | PUBLIC_READ+AUTH_ACTION | parts surface | (guest quote request — see deviation) |
| Trust & Safety, Help, Contact, Pricing | PUBLIC | everything | messaging a seller (Contact) |
| Diaspora info | PUBLIC_READ+AUTH_ACTION | how importing works | starting/viewing an import order |
| Sell entry | PUBLIC_READ+AUTH_ACTION | draft in the browser | saving the draft; publishing |
| Seller workspace | AUTH_REQUIRED | — | Sign In with returnTo |
| Import orders (Trade OS) | ROLE_REQUIRED | — | Sign In with returnTo |
| API documentation | PLANNED | — | — |

**Defects found and fixed:**
- D1 — the passport route served restricted keys anonymously (§B).
- D2 — session-only Trust panels fired 401s for guests and published "Not yet checked".
- D3 — `/search` swallowed the restricted-lookup refusal.
- D4 — the vehicle sign-in panel was mislabelled and dropped `returnTo`.
- D5 — stakeholder links pointed at dashboards (§D).
- D6 — Contact linked an owner-only dashboard.
- D7 — Trade OS and diaspora sign-ins lost the destination.
- D8 — guest Sell lost its intent.
- D9 — empty directories had fake search boxes and no way in.
- D11 — Help promised a ticket.

**Recorded, not changed (owner decisions):**
- Guest marketplace inquiries and parts quotes. A guest who leaves an email or phone number can send
  them, by product design. The J-R1 rule asks for an account at messaging. Changing that alters
  product semantics and certified staging gates.
- D10. A guest can ask CarUp to find a garage from `/marketplace/services`. Requesting service from a
  specific garage requires sign-in. The difference follows from the same inquiry design.

---

## F. Contact / Communications

| channel | state (Communications health, PC01 backend) | advertised |
|---|---|---|
| Email **to** CarUp | 7 functional aliases certified (E7 real send); `questions@` inbound-certified | yes — one address per purpose |
| In-product messaging with a seller | internal channels enabled | yes — sign-in at the first message |
| Outbound email / push / WhatsApp / SMS / Telegram / Facebook / Instagram | all BLOCKED (credentials or webhook URL absent); external kill switch active | no |
| Telephone, live chat, contact form, opening hours, response times | do not exist | stated as not offered |

Public identities: CarUp Technologies · Automotive Intelligence & Trust Network · "Know the car. Trust
the journey." · HQ: Tokyo, Japan · Regional office: Harare, Zimbabwe · support@ security@ privacy@
dpo@ legal@ press@ info@ questions@ carup.dev.

---

## G. Responsive web

The audit ran on 25 public pages at 320, 360, 375, 390 and 430 px, plus 1440 px for desktop, using
Chromium phone emulation (touch, 2×). Overflow is measured against the device width. Mobile emulation
widens `innerWidth` to fit an over-wide page, so a check against `innerWidth` alone hides the defect.

| | horizontal overflow (page×width rows) | sub-44 px controls (phone widths) | largest phone heading |
|---|---:|---:|---:|
| before | 11 (/trust +260 px, /blog +144 px, /press +13 px) | 1,095 (219 per width) | 48 px |
| after — code head `896ee73f` | **0** | **0** | 36 px |

- "Before" is this lane's working tree just before the responsive pass. The access, identity and
  navigation changes were already applied, so it is not exactly `d13c2e78`.
- Both rows use a local build with the API stubbed. They measure layout, not deployed behaviour.
  Evidence: `evidence/OC5R_PC01_J_R1_RESPONSIVE_LOCAL.json`.
- Every heading sits inside the first viewport.
- The sizing changes apply below `sm` (640 px) only. Desktop layout is unchanged; desktop content does
  change with §C–§E, the removed "Remember me" control (it was bound to nothing) and the "Pricing"
  label.
- **Deployed** (*recorded after deployment*; the new pair, real network, read-only):
  - 150 page×width rows, all 200;
  - **0** phone overflow and **0** sub-44 px controls;
  - phone headings ≤ 36 px, desktop 0 overflow.
  - Evidence: `evidence/OC5R_PC01_J_R1_RESPONSIVE_DEPLOYED.json`. Screenshots: `evidence/pc01-j-r1-screens/` —
    Home, Marketplace, Trust & Safety and Contact at 320/360/375/390/430, plus Home at 1440.
  - This is browser emulation of phone widths: responsive-web evidence, not native evidence (see §H).

---

## H. Native (`mobile/`, Expo SDK 54 / React Native 0.81) — certified separately

**BLOCKER_FOR_NATIVE_UAT — fixed (`896ee73f`):**
- **N1** guests could not browse: every launch went to Login. Guests now land on the public
  Marketplace tab.
- **N2** no account could be created: Register was unlinked, sent no CSRF token (403) and allowed
  passwords below the server's minimum of 8.
- **N3** Garage actions dead-ended:
  - uploader, odometer OCR and SafePay sent no CSRF token, and the uploader hid its 403 as
    "offline";
  - "Trust Passport" on an unlisted vehicle hit the public listing route (404); it now shows the
    owner's own Passport.
- **Lock trap:** a device with no enrolled biometrics could not unlock. The app now locks only when
  biometrics can unlock it, and the lock screen offers Sign out.

**BLOCKER_FOR_NATIVE_UAT on an iPhone — recorded; it needs an owner decision.**
- `app.json` sets `newArchEnabled:false`, but Reanimated 4 and FlashList 2 require the New Architecture.
  Development-client, EAS and release builds therefore abort.
- Expo Go 54 is unaffected, because its runtime always uses the New Architecture. Metro states exactly this.
- The App Store's Expo Go runs one SDK at a time. Expo publishes SDKs 55–58 after this app's SDK 54, so a
  physical iPhone cannot open the app.
- Where native UAT works today:
  - Android, with the Expo Go 54.0.8 APK (Expo's published SDK 54 client);
  - a Mac's iOS Simulator, with Expo Go 54.0.7.
- Making iPhones work needs one of:
  - an SDK upgrade;
  - a New-Architecture development build, which uses the owner's Expo and Apple accounts.
- Either is a release-engineering choice for the next native phase, outside this bounded remediation.

**Native runtime evidence** (`evidence/OC5R_PC01_J_R1_NATIVE_SIMULATOR.json`):
- **Setup.** A dedicated iOS 27 iPhone 17 simulator ran Expo Go 54.0.7. Metro ran from the deploy commit with
  `EXPO_PUBLIC_API_URL` set to the PC01 backend alias.
- **What it shows.**
  - A guest's first launch opens the public Marketplace, with Marketplace and Sign in tabs. Before J-R1 it opened
    Login (N1). Screenshot: `pc01-j-r1-screens/native_ios_expo-go_guest_launch.jpg`.
  - The new backend deployment logged the app's calls. They clustered at launch, and there is no request loop.
- **Not captured.** Sign in, Register, Garage and the lock screen. This machine has no Simulator GUI and no
  UI-automation tool, so nothing could be tapped. These screens are test-certified, and the owner checks them
  at Checkpoint 2.
- **Copy, added to the next phase.** The empty Marketplace says "Try another make or broaden your search" even
  with All makes selected.

**NEXT_NATIVE_PRODUCT_PHASE:**
- N4: the dashboard-first landing.
- N5: the role switcher, which mostly fails without a tenant and is split across screens.
- N6: web, back-office and internal wording; status codes shown to users.
- N7: Messages as four stacked cards with no conversation view.
- N8: repeated destinations; a bare "%" when trust is null; a hard-coded "Active" badge.
- N9: SafePay actions with no confirmation; mislabelled back and "Enter Marketplace" links.
- N10: no haptics; partial safe-area and keyboard handling; a pull-to-refresh spinner that never
  shows; no filter sheet or share; scheme-only deep links.

**ACCEPTABLE_CURRENT:**
- N11: navigation density (5-tab cap, drawer de-duplication).
- N12: Marketplace and vehicle detail hierarchy and states; sign-in at Garage, Messages, Referrals,
  SafePay and verification.

**Certification (code head; not browser evidence):**
- `tsc --noEmit` clean.
- vitest: 6 files / 66 tests pass.
- 17 standalone test scripts plus the verification-flow smoke: 18 of 18 pass. All 23 test files run,
  a superset of `test:native` and `test:static`.
- New assertions cover the session-bound CSRF token on every mutating call and the one-retry rule.
- Device and simulator evidence for the new pair is recorded after deployment, separately from §G.
  Browser phone screenshots are not native evidence.

---

## I. New staging pair

*Recorded after deployment.*

| | |
|---|---|
| **Common SHA** | **`40621751d4b74c59324fe6601aa5ddbdc7769b08`**, the deploy commit: code `896ee73f` plus docs and evidence only. `verify-deployment-candidate`: `ok`, no refusals, pairing `absent`; a negative control is refused |
| **Frontend** | `dpl_GrfRSYSiEaSeAmStjpRVTCbteiZn`; immutable `https://carup-staging-p40vcj7rq-11-11.vercel.app`; alias **`https://carup-staging-oc5r-pc01-11-11.vercel.app`** |
| **Backend** | `dpl_Cx9js7Ntwwcy9azQHUTVpywNHibU`; immutable `https://carup-backend-staging-klbmb7c7j-11-11.vercel.app`; alias **`https://carup-backend-staging-oc5r-pc01-11-11.vercel.app`** |
| Deployment | CLI uploads of a clean detached worktree at the deploy commit to the **Preview** target: backend 19:25:48Z, frontend 19:26:23Z, both READY. Backend runtime env: `CARUP_BUILD_SHA`, `CARUP_BUILD_REF`, `COMMUNICATION_OUTBOUND_DISABLED=true`. Aliases moved 19:27:40Z (backend) and 19:27:55Z (frontend), then read back. The code was pushed only afterwards, at 19:28:34Z, so the gates found the pair already serving it |
| Runtime identity | **28 / 28**, from what the deployments serve (`evidence/OC5R_PC01_J_R1_RUNTIME_IDENTITY.json`). Frontend and backend both serve the deploy commit, and the frontend is paired to the PC01 backend alias. Database: `eoyenigwevnxwwhyhaer` only, consistent. OCR is Qwen and AI is Gemma, both on Cloudflare with canonical custody. Kill switch active. No production ref in the health body or any served chunk. Live J-R1 checks: the Serena's anonymous frame-number passport is **401**; an ISO-VIN passport is 200; the legal page shows `@carup.dev` and CarUp Technologies; the bundle carries no `carup.co.zw` and does carry the tagline |
| Same staging DB | `eoyenigwevnxwwhyhaer`; no migration and no database write by this phase |
| Not moved | REL-01 and REL-02 aliases (their frozen builds) and the stable aliases (`bb9d9900`). No production command was issued |
| Gates on `40621751` | **Seller Home & Lifecycle 38079945232 PASS**: pair proven at `40621751`; desktop, tablet and mobile Chromium each 1 passed and 1 skipped by design; 19:29:15–19:36:18Z. **Diaspora Deployed Staging UAT 38079945430: waiting for owner approval** of the protected `staging` environment. The other eight runs on the commit (seven workflows, REL-03A Source Certification on both push and pull request) are green |
| Superseded | The Checkpoint 1 pair (`d13c2e78`: `dpl_6xx8XLib6uEyUQL8jq2vNfys1RQH` / `dpl_BRaaDMFZVr7wSKj6V8peiMpT8613`) as the candidate. Its evidence stands and its immutable URLs remain. Its gate runs 38056687030 and 38056686796 were cancelled at 19:25Z before any journey ran; neither had owner approval |

Live evidence on the pair, recorded after deployment:
- **Navigation:** `evidence/OC5R_PC01_J_R1_NAV_AFTER.json`. 129 rendered items, 43 planned-disabled, 31 destinations. Every destination returns 200, with 0 API 401s, 0 5xx, 0 console errors and no not-found page. The only destination that is Sign In is the Sign In link.
- **Responsive (deployed):** `evidence/OC5R_PC01_J_R1_RESPONSIVE_DEPLOYED.json`. 150 page×width rows, all 200; 0 phone overflow; 0 sub-44 px controls; phone headings ≤ 36 px. Screenshots are in `evidence/pc01-j-r1-screens/`.
- **Native (iOS Simulator, Expo Go 54):** `evidence/OC5R_PC01_J_R1_NATIVE_SIMULATOR.json` (§H).

## J. Checkpoint 2 itinerary

About 20 minutes. Use `https://carup-staging-oc5r-pc01-11-11.vercel.app`; the backend is paired automatically. Outbound
messages are held by the kill switch, so nothing reaches a real inbox or phone.

**Guest** (signed out; try a phone or a narrow window too)
1. **Home.** The footer reads CarUp Technologies · "Know the car. Trust the journey." · info@carup.dev · HQ Tokyo,
   regional office Harare. It shows no phone number and no `carup.co.zw`.
2. **Marketplace.** 0 listings is the truth: staging has no public listing.
3. **Contact.** One email address per purpose and a "Not offered yet" list. No form, no hours, no Gutu.
4. **Verify** (`/search`). Enter `GFC27-027051`. The page asks you to sign in for a chassis or frame number; Sign in
   brings you back to `/search`.
5. **Footer → Stakeholders.** It lists Sell, Dealers, Garages and Diaspora. None of them leads to a dashboard
   sign-in. Dealers and Garages each say how to join.
6. **Trust & Safety, Help, Press.** On a phone, nothing scrolls sideways and every control is thumb-sized.

**Kingston** (sign in with the account the brief names)

7. **My Listings.** The Serena shows "Ready to publish — not on the public Marketplace yet" and the sentence "CarUp
   took this listing off the public Marketplace on 6 October 2026. This was not your action. …"
8. **`/dashboard/sell-vehicle?vin=GFC27-027051`** opens the account listing. It no longer opens "Your guest
   preview has been restored".
9. **Your decision.** "Publish to Marketplace" re-runs CarUp's publication gate and names anything missing. The
   DB2B-1 quarantine classed this listing owner-review, so publishing it is your call.
10. **If published:** sign out. The Serena appears on the Marketplace, and its public Vehicle Passport opens.
11. **Inquiry.** From a second account of your own, ask about the Serena. As Kingston, see the conversation.
    Product design still lets a guest leaving an email or phone number ask too (§E, recorded deviation).
12. **Optional.** "Unpublish" returns the listing to "Ready to publish".

**Native** (separately, optional; see §H). Use Android with Expo Go 54 (APK), or a Mac's iOS Simulator with
Expo Go 54.0.7. From a checkout, run
`cd mobile && EXPO_PUBLIC_API_URL=https://carup-backend-staging-oc5r-pc01-11-11.vercel.app npx expo start`.
A guest lands on the Marketplace, and the Sign in tab offers Create account and Browse as guest. The App Store Expo Go
cannot open this SDK 54 app on an iPhone.
