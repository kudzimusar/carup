# 11-11 TECH — CarUp Programme Moderator Continuation / Authority Transfer

## CARUP-MOD-HANDOFF-2026-11-13-UX-REBUILD-03 — Official Option 5, S1-2 merge gate, S1-3 certification, S1-4A prototype

**Issued:** 2026-11-13, Asia/Tokyo; last live GitHub source/CI inspection during this handoff preparation.  
**Programme:** `CARUP-UX-REBUILD-01` — **ONE CARUP** unified experience.  
**Owner:** CarUp Product Owner. **Outgoing:** ChatGPT CarUp Programme Moderator / Programme Controller. **Incoming:** successor CarUp Programme Moderator (**person/agent not assigned until takeover**).  
**Repository:** https://github.com/kudzimusar/carup  
**Controlling issue:** https://github.com/kudzimusar/carup/issues/261  
**Storage:** Documentation-only handoff on an **UNMERGED Draft PR**; its branch commit, not `main`, is the durable checkpoint. Existing main/production unchanged.  
**Security:** Project-operational/public-safe. No secrets, protected user records, private Drive file IDs, direct credential strings or sensitive security remediation details.  
**Governance:** Owner-requested `11-11-GM-GC-001` v1.0.0 procedures; central [`kudzimusar/11-11-tech` PR #16](https://github.com/kudzimusar/11-11-tech/pull/16) at `3225760aa91a238cda9be52af8cadd205db0da8c` remains **DRAFT/OPEN/UNMERGED**. **NOT** globally or CarUp-project adopted as a binding merged change. Stronger CarUp and Owner rules remain in force.

> **TAKEOVER ORDER:** Read this handoff and relevant source links, perform a narrow **live source reconciliation** (not research rediscovery), state accepted `main`, all four active PR heads, assignments, blockers and the one first executable task. Accept neither changes nor authorizations from stale SHAs. The successor MUST maintain continuity records and create the next preventive moderator handoff before the next context limit.

---

## 0. One-minute executive handoff and exact next action

**Ultimate Owner goal:** deliver a professional, compact, media-led and globally competitive **single CarUp identity and working experience** across Marketplace, Vehicle Detail/Trust, My CarUp/Seller, dealer claim-first operations, Garage/Mechanics, Trade/import/CAP/logistics, service providers, communications, institutions and independent review; web/PWA and genuinely supported native mobile. Current symptom: multiple incompatible headers/footers/shells, local car-glyph placeholders, generic KPI card grids and inconsistent styling. **Rebuild presentation, not existing working backend/services, security authority, transaction truth or business-data contracts.**

**First priority — DO NOW:** a **repository-settings-capable GitHub administrator** must apply the already Owner-authorized update to active `main` ruleset `Protect main` ID `20850554`, require three additional passing S1-2 CI jobs while preserving the existing two, verify a **five-context settings readback**, then perform the separately Owner-authorized **guarded merge-commit merge of PR #263 ONLY** if exact head/base/review/checks still match. The prior connected GitHub tool **cannot write ruleset settings**; [authenticated operator return #6825423882](https://github.com/kudzimusar/carup/issues/261#issuecomment-6825423882) documents the genuine tool-capability blocker. **No settings update or merge had occurred on this handoff's live recheck.** The Owner already granted that limited authority; do not ask them to approve #263 again unless scope/candidate changes.

**Other parallel lanes:** S1-3 [#264](https://github.com/kudzimusar/carup/pull/264) has independent exact-head APPROVE **and NOW full final GitHub CI**; coordinate its later source reconciliation/Truth and Privacy authorities but **no #264 merge authority**. Kimi has submitted S1-4A [Draft PR #266](https://github.com/kudzimusar/carup/pull/266) — **new in this handoff, no formal review, CI still partly running**. Assign exact-head independent prototype/visual review, no rewrite or S1-4B activation. Brand specialist has Owner **Option 5 — Sleek & Premium** visual-direction decision; production source and vector exports still require file-level verification and visual/rights approval.

**Strategic acceptance denominator:** `NOT_BASELINED` (no separately verified Owner-frozen total for RX-00–RX-09); **no programme percent invented**. Bounded status: S1-1 merged, S1-2 and S1-3 each independently approved but unmerged, S1-4A candidate submitted without independent approval. These are **not equivalent** to completed product redesign, route migration or release.

---

## 1. Live exact-SHA source custody — this snapshot supersedes older handoffs

| Item | Exact source SHA or ref | Live status/evidence | Next control |
|---|---|---|---|
| **Accepted `main`** | `8bc00bd75f5285997065872514d10db8fbecd24f` | Current default branch at handoff recheck; S1-1 merge commit | Must re-fetch before any merge or integration |
| Dealership 1.0 | PR [#258](https://github.com/kudzimusar/carup/pull/258), merged source at `9f2bebfe66a19e4d90c44085a3166562d2176626` | Accepted claim-first features on main; protected functionality | Do not reimplement or weaken legal/reviewer media gates |
| MP01 v0.9.2 | PR [#259](https://github.com/kudzimusar/carup/pull/259) merged, historic merge `ad968beed3e4d795af00aa38bfb445e671ba4adb` | 1,979-line master plan on main; individual Owner decisions not auto-approved | [Master plan](../CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md) |
| RX-01B/S0 design custody | PR [#260](https://github.com/kudzimusar/carup/pull/260) merged at `0cfa3b652f1a2beb1396caecdb8d166501dfa53f`; reviewed head `b1709ef22addb5063004b8de832a19bc9907af89` | Source documents and 139-route authority register certified/merged | Do not redo IR01/RX-01B |
| RX-02A S1-1 foundation | PR [#262](https://github.com/kudzimusar/carup/pull/262), reviewed head `e266fa83a07cfb5d5dbc98e4ea8917efb519ab8b` | Independently accepted and Owner-authorized merge commit `8bc00bd...`; historical lockfile/workflow blockers resolved | Preserve tokens, strict clean install and repaired App.tsx |
| RX-02A S1-2 | Draft [PR #263](https://github.com/kudzimusar/carup/pull/263); HEAD `4122a8f6d391c3e1912191fc45620d3cf232f2f4`; base accepted main | Formal exact-head S1-2 reviewer [#5872308245](https://github.com/kudzimusar/carup/pull/263#pullrequestreview-5872308245); **15 SUCCESS, 3 expected SKIP, 0 FAIL**; still **DRAFT/UNMERGED** | **BLOCKED RULESET ADMIN**, then authorized controlled merge |
| RX-02A S1-3 | Draft [PR #264](https://github.com/kudzimusar/carup/pull/264); HEAD `9bcff2f2a76511f238c27a63b4c4e167571e274f`; base accepted main | Exact-head [independent APPROVE #5875242059](https://github.com/kudzimusar/carup/pull/264#pullrequestreview-5875242059); **14 SUCCESS, 3 expected SKIP, 0 FAIL (17 total)** — PG17 browser run finished successful | **ENGINEERING ACCEPTED, UNMERGED**; Trust/Privacy contract and eventual integration gates |
| Brand/media MP01 v0.9.3 draft | Draft [PR #265](https://github.com/kudzimusar/carup/pull/265); HEAD `f33252654aeb92a91fb6a78416a979b9b0904b5e` | 2 documentation files, independent review requested but **0 reviews** at snapshot; OD-18 text not yet updated with Option 5 selection | Separate docs/Owner gate; no artwork code |
| **RX-02 S1-4A NEW** | Draft [PR #266](https://github.com/kudzimusar/carup/pull/266); HEAD `17c682116893620e97ab3428e488acb493104e24`; base `8bc00bd...` | 15 changed files; **12 SUCCESS / 3 SKIP / 2 IN PROGRESS**, 0 failure as last polled; no formal independent review | **Next independent technical/visual review candidate**; not merged/cut over |
| Central global governance | [`kudzimusar/11-11-tech` #16](https://github.com/kudzimusar/11-11-tech/pull/16); HEAD `3225760aa91a238cda9be52af8cadd205db0da8c` | Open Draft / unmerged, 13 governance files | Owner-requested procedure only until separate central and project adoption |

**Important CI correction from previous messages:** [PR #264 PG17 browser run 43221116192](https://github.com/kudzimusar/carup/actions/runs/43221116192) is **COMPLETED SUCCESS at 2026-11-12T13:42:01Z**; do not repeat the obsolete "still running" blocker. [S1-2 exact-head CI 43192144902](https://github.com/kudzimusar/carup/actions/runs/43192144902) passed. [PR #266 check-run summary](https://github.com/kudzimusar/carup/pull/266/checks) requires a fresh poll before review.

**Read original PR-body SHAs cautiously:** #263/#264 descriptions contain historical old heads from their initial drafts; GitHub **live HEAD is authoritative**.

---

## 2. Owner authorizations — exactly what has and has not been approved

**Express Owner authorization, 2026-11-12:** "Authorized. As the moderator, task all responsible agents to do their jobs" in response to a precise request to (a) add the S1-2 three required checks to main protection and (b) perform a controlled **merge-commit** of **PR #263 only**, conditional on verified protections/review/exact checks. This authority stands but has NOT been executed. Do not infer #264/#265/#266 merge authority.

**Owner identity decision:** **Option 5 — Sleek & Premium** selected as canonical CarUp logo **direction**, faithfully preserving the **distinctive orange vehicle silhouette and CarUp wordmark**. No redesign or competing concepts. This is NOT certification of any recreated/derived production SVG, artwork rights, source bytes, dark/light variants or permission to upload approved files.

**S1-4A authorization:** Kimi expressly directed to create an **isolated DEV-only** PublicShell/WorkspaceShell/FocusedShell prototype and tests; **only existing runtime file allowed to change was `web/src/App.tsx`, with minimal DEV-only route/import**. Other proposed runtime files/route/auth/nav migration forbidden. S1-4A source arrived in #266; a submitted draft **does not mean Owner visual PASS or independent ACCEPT**.

**Still reserved to Owner:** PR #264/#265/#266 merges, S1-4B real app-shell route migration, RX-03 pilot activation/staging deployments, Production, money/payment/provider operations, shared DB/schema, live dealer publication, broad security/reviewer changes, native/email/marketing activation, unresolved MP01 visual/ADR/OD decisions. No proposal or review is implicit merge authority.

---

## 3. Global governance, project architecture and accepted research

**Central candidate, not adopted:** [11-11 Tech Global Moderator Governance & Continuity Standard 1.0](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/governance/global-moderator/STANDARD-v1.0.md), [reusable skill](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/skills/11-11-global-moderator/SKILL.md), [handoff template](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/governance/global-moderator/templates/moderator-handoff.template.md), [dispatch template](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/governance/global-moderator/templates/agent-dispatch.template.md), [adoption protocol](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/governance/global-moderator/ADOPTION.md). If central #16 is later merged, a **separate bounded CarUp project-adoption PR** is needed; do not rewrite CarUp architecture or mix this into product work.

**Binding CarUp source map (all on accepted `main` unless identified draft):**

| File / section | Verified source / meaning |
|---|---|
| `DESIGN.md` — 669 lines; especially §5 media, §6 navigation, §11 media persistence, §13 shared primitives | One vehicle identity, coherent journeys, true states, automotive imagery not invented, reduced-glass aesthetic, practical usability |
| `docs/marketplace/MARKETPLACE_VISUAL_DNA.md` — 151 lines | Photo-led, not decorative-card-led Marketplace identity |
| `docs/product-experience/CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md` — **v0.9.2**, 1,979 lines | §§0 decisions, 3 shell/product grammar, 5 token/style intent, 6 TI controls, 7–9 functional/custody, **10 RX-00→09 plan + 10.1 dependencies/10.2 pilot/10.3 rollback**, §§11–12 gates, Appendices with inventories and evidence |
| `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` — v1.1 ~199 lines | §6 shared Truth components; §10.3 component catalogue. Base Ink Precision palette: action `#C2410C`, hover `#9A3412`; `#F97316` signal/non-text only; surface-2 `#E9E9E4` |
| `docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` | Header + **139 route records R001–R139**, eight reviewer-isolated routes; do not author a second conflicting route registry |
| Draft #265 `docs/product-experience/CARUP_BRAND_MEDIA_ASSET_REGISTER.md` | BA-01–BA-12 placement and BA-G0–G4 source/acceptance gates |
| Draft #265 MP01 addendum | Draft **§10.4**, Owner decision **OD-18**, first-wave corporate media custody and no fake listing/dealer/trust images |
| Draft #266 `docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md` | **282 lines**, §1 purpose and isolation, §2 files, §3 three shells, §4 route matrix, §5 brand slots, §6 fixture adapters, §7 security model, §8 visual evidence, §9 tests, §10 proposed **UNAUTHORIZED S1-4B**, §11 Owner PASS/FIX/HOLD packet |

**Prior UX archaeology:** IR01 GLM/Opus investigations, RX-00 route/component archaeology, RX-01B high-fidelity/tokens and references already completed substantially. Programme baseline references: **139 routes**, **289 component dispositions**, **10 UX-REF journeys**, **FP-01–12** preservation journeys, **TI-01–TI-27** integrity register, **37 metric** scorecard. Do **not** repeat full UI analysis, rebuild accepted components, regenerate routes or revive historical unmerged alternative PR #181 as governing code. MP01 decisions OD-01–OD-17 need individual Owner decisions at their applicable gates; adding OD-18 for brand does not auto-approve all.

**Legacy/accessibility debt:** S1-2 contrast ratchet ran **15/15 route×width scans, no NEW contrast debt**, with **249 historical contrast nodes** carried as baseline, NOT fixed WCAG AA. No claim complete accessibility/production certification.

---

## 4. PR #263 — precise authorized administrative/merge work order (P0)

**Source:** `main@8bc00bd75f5285997065872514d10db8fbecd24f`; Draft #263 HEAD `4122a8f6d391c3e1912191fc45620d3cf232f2f4`; formal [S1-2 independent APPROVE #5872308245](https://github.com/kudzimusar/carup/pull/263#pullrequestreview-5872308245), 15 success / 3 expected skips. This branch contains 12 files (see file map below).

**Live ruleset read:** `Protect main` ID `20850554`; active, scope `~DEFAULT_BRANCH`, protections `deletion`, `non_fast_forward` and 1-approval PR requirement. Required contexts currently ONLY:

1. `Lint · Types · Build · Tests` — GitHub Actions `integration_id=15368`
2. `Secret scan` — `integration_id=15368`

**Add these EXACT three already-successful GitHub Actions contexts (also integration_id 15368):**
3. `Web Vitest · JUnit`
4. `CI-04 gate regression tests`
5. `CI-04 contrast ratchet (Playwright + axe)`

**Admin sequence:** privileged operator uses GitHub repository settings / accepted REST write to change ONLY existing ruleset ID 20850554, retaining ALL prior parameters, enforcement and permissions; perform GET **post-write** and independently check exactly five required status checks. Do not create renames, weaken protections, set bypass or silently merge on two checks. Reverify unchanged base and head, matching review and fresh required check status, check unresolved security/review issues, move #263 Draft→Ready only when all controls pass, merge by **merge commit**, with **expected-head SHA guard `4122a8f6d391c3e1912191fc45620d3cf232f2f4`**. Stop on changed source/CI/permission. Record merge commit + new main SHA and post-merge CI, issue and PR comment. Do not touch #264/#265/#266.

**Authoritative dispatch/evidence:** [PR #263 owner-authorized P0 order #6825114421](https://github.com/kudzimusar/carup/pull/263#issuecomment-6825114421); [Issue #261 admin execution BLOCKED #6825423882](https://github.com/kudzimusar/carup/issues/261#issuecomment-6825423882). The latter **explicitly distinguishes unavailable ruleset mutation tool from a GitHub API 403**; do not repeat an unsupported write method as though it succeeded. Authenticated agent must use settings-capable tooling. Prior moderator's limited connector **did NOT execute** update or merge.

**S1-2 technical evidence:** `scripts/tests/ci04-gate.test.mjs` 20/20; `Web Vitest·JUnit` 1,605; ratchet 15 viewport combos/249 existing violations/0 increase; strict `npm ci`, token+style checks. Green engineering does not override protection rule.

---

## 5. PR #264 — accepted S1-3 components and future integration gates

**Exact candidate:** `9bcff2f2a76511f238c27a63b4c4e167571e274f` Draft/open/unmerged, base old main. Formal [@11-eleven-skm APPROVE review #5875242059](https://github.com/kudzimusar/carup/pull/264#pullrequestreview-5875242059) applies to exact head. Full GitHub CI now 14 successful / three expected skipped / zero fail, including [real PG17 fictional-dealer browser run 43221116192](https://github.com/kudzimusar/carup/actions/runs/43221116192) **SUCCESS**. Kimi's local exact-branch report: **73/73 truth battery, 1,678/1,678 web tests, TS/lint/build PASS**; independently audited final R2 source corrections.

**Delivered components:**
- `MoneyDisplay` / `money.ts`: explicit USD vs ZiG/ZAR/BWP, missing amount, known-but-unsupported EUR/JPY displays amount+recorded code, missing currency not confused, no FX or fake money.
- `VehicleIdentity`: card/row/header, default **PUBLIC-safe** display withheld full VIN as `Restricted`; explicit `exposure="workspace"` for governed internal display; **server API/public payload, never the React prop, is authorization authority**.
- `DataState`: loading, empty, error, forbidden, not-measured, unavailable without false "nothing changed" or fake zeros.
- `TrustLens`: evaluated/partial/stale/not-evaluated/insufficient-data/unavailable; no fabricated verification score or success-green evaluation without authority.
- `EvidenceLine`: actor/source/time provenance.
- Root `CODEOWNERS` and DEV-only `/dev/component-catalogue`; precise tests and contract docs.

**R2 exact diff** was a one-commit eight-file correction from `7de41cd2e4664cb7deadb4bccc20a0d25f57f52b`; repaired `App.tsx` untouched by R2. **No third corrective request** absent independently demonstrated new defect. Prior comments [R1 #6821811008](https://github.com/kudzimusar/carup/pull/264#issuecomment-6821811008), [R2 #6823518644](https://github.com/kudzimusar/carup/pull/264#issuecomment-6823518644), [Moderator R2 acceptance #6824466622](https://github.com/kudzimusar/carup/pull/264#issuecomment-6824466622).

**Remaining gates:** independently record backend Truth owner mapping/provenance/freshness and Privacy authority regarding **public API withholding**; these were reserved by the reviewer for production-facing consumers. After #263 approved and merged, Kimi/integration owner reconciles #264 onto exact new main; confirm all five required S1-2 jobs on resulting candidate and request **fresh independent review if HEAD changes**. Only then ask for separate Owner #264 merge authority. No rollout to live pages before this.

---

## 6. NEW PR #266 — S1-4A isolated shell prototype, review it rather than redispatching

**Discovered during successor handoff audit:** [Draft PR #266](https://github.com/kudzimusar/carup/pull/266), exact HEAD `17c682116893620e97ab3428e488acb493104e24`, base `8bc00bd75f5285997065872514d10db8fbecd24f`, **15 changed files, 8 commits**, **no formal independent review**, still Draft/open/unmerged. Source under `web/src/components/ux-prototype/rx02-s1-4a/`, DEV page, one design doc; only existing runtime file `web/src/App.tsx` touched with **two additive hunks** (static import of DEV-only page, `import.meta.env.DEV` route before catchall). No claimed live route migration.

**Reported by Kimi, not independently certified:** 25/25 prototype tests, full web 1,630/1,630 across 171 files, TS/lint/build pass, 44 screenshots at **360/390/768/1280/1920**, no horizontal overflow, axe 0 for isolated renders, deliberate fictional fixtures. `web/src/components/ux-prototype/rx02-s1-4a/fixtureDisplay.tsx` is a **temporary fixture-only adapter**, not a replacement for unmerged S1-3 source or real verified vehicle data. Reviewer must not equate these demo metrics to authenticated integration UAT.

**Latest live GitHub check run counts at inspection:** **12 success, 3 expected skipped, 2 in progress**: `Lint · Types · Build · Tests` and `Genuine CarUp browser · PostgreSQL 17 · fictional dealership only`. Recheck final status before claiming PASS. Review request not yet evidenced; appoint @11-eleven-skm unless conflict of authorship.

**Independent reviewer worklist:**
1. Validate exact 15-file scope and `App.tsx` only two additive hunks. Inspect production build **for actual absence of prototype code/chunk**, not only absence of its route; static import appears in source and bundler tree-shaking needs verification.
2. Inspect real content of `routeShellMap.ts` (139 entries), `navProjection.ts` use of current manifests, and fixtures: no permission grants, real data or fake Trust/finance statements.
3. Verify PublicShell mobile footer/drawer/bottom bar, WorkspaceShell role/tenant/step-up boundaries, FocusedShell form/focus/exit at five widths, reduced motion/contrast, interactions and no regressions.
4. Review §5 BrandMark text fallback without a fake "official" logo; Option 5 selected but real assets are **not integrated**.
5. Cross-check screenshot artifacts (existence/hash/source), CI at the final exact head, app build, and Owner PASS/FIX/HOLD visual packet.
6. Decide **ACCEPT / REMEDIATE / BLOCK**; if accepted, freeze prototype for Owner visual selection; **do not** merge, activate S1-4B or infer RX-03 completion.

**Spec and file map:** `docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md` at this head 282 lines: §1 (9–46), §2 file inventory (47–66), §3 shells (67–120), §4 route ownership (121–152), §5 brand slots (153–163), §6 fixture adapters (164–183), §7 security (184–200), §8 44 visual captures (201–220), §9 tests (221–234), §10 proposed S1-4B (235–263), §11 Owner visual gate (264 onward). Do NOT begin §10 implementation merely because the document proposes it.

---

## 7. Brand/media — the LAST work conversation topic and exact accepted interface

**Brand specialist report:** Owner selected **Option 5 — Sleek & Premium**. Preserve the **original orange vehicle silhouette** and **CarUp wordmark** exactly; no new logo, generic Lucide substitute, novel letterform or unapproved colour scheme. Specialist claims recovered boards: `CarUp Logo Options Brand Board.png`, `CarUp Sleek Premium Branding Board.png`, `CarUp Sleek Premium Social Media Kit.png`, `CarUp Logo Concepts Grid.png`. **Moderator independently searched connected Drive for those exact names without a match and observed empty Approved Master Logos/Logo Variations/Header/Footer folders**; do not assert files absent everywhere or source recovered bytes verified. Specialist must provide actual authenticated file references, hashes, dimensions and safe artwork proofs. No private Drive links in public issue/docs.

**Source library:** private connected `CarUp Media Files` Drive hierarchy: `00 Brand Identity & Master Assets`, `01 Native Apps & Product`, `02 Website & Web`, `03 Social Media`, `04 YouTube & Video`, `05 TV & Broadcast`, `06 Print & Corporate Stationery`, `07 Catalogues & Sales Collateral`, `08 Advertising & Campaigns`, `09 Press Partnerships & Sponsorship`, `10 Photography & Media Library`, `11 Templates & Working Files`, `12 Approved Exports & Delivery`, `99 Archive & Superseded`. Working/draft files stay in working folders until Owner file-level visual acceptance. Do not overwrite old originals or promote an unverified generated asset as official.

**First-wave authoritative contract:** [PR #265 Moderator BA-WEB-01 comment #6825600450](https://github.com/kudzimusar/carup/pull/265#issuecomment-6825600450); [Issue #261 convergence comment #6825611441](https://github.com/kudzimusar/carup/issues/261#issuecomment-6825611441); [complete initial specialist brief #6824192936](https://github.com/kudzimusar/carup/issues/261#issuecomment-6824192936). The Owner-edited copy-ready specialist instruction titled **"BA-WEB-01 APPROVED FOR ASSET PREPARATION"** is consistent and must be preserved.

| BA / priority | Exact intended use | CSS bounding box or export (maintain source proportions) | Wave |
|---|---|---|---|
| **BA-01 P0** | Canonical horizontal primary/on-dark/mono SVG; compact mark-primary/on-dark; editable vector master | Source SVG genuine vector, viewBox, light/dark/mono; 2× PNG only where needed | Source NOW; required before official substitution |
| **BA-02 P0** | Public desktop/tablet/mobile masthead and drawer | desktop ≤176×40; tablet ≤152×36; mobile ≤132×32; compact ≤32×32 CSS px | S1-4B then RX-03 |
| **BA-03 P0** | Dark public footer | ≤180×44 CSS px | S1-4B then RX-03 |
| **BA-04 P0** | Workspace header/rail expanded/collapsed, Owner/Dealer/Trade/reviewer shared identity | horizontal ≤144×36, mark ≤32×32 CSS px | S1-4B |
| **BA-05 P0** | FocusedShell/auth/service flow | horizontal ≤160×40 or mark 40×40 CSS px | S1-4B |
| **BA-06a P1** | Browser icon and Apple touch icon preparation | true SVG favicon; 16,32,48 PNG, valid multires ICO; Apple 180×180 | prepare in parallel, activation separate |
| **BA-06b P2** | PWA platform assets | 192/512 square + maskable 512 with safe-zone proof | RX-07 deferred |
| **BA-08 P2** | OG/social previews | 1200×630 and platform-safe crops | RX-03/07 marketing deferred |
| **BA-09 P2** | durable emailed identity | transparent sRGB PNG at 2×, approx 180–200×40 CSS display box preserving ratio | Communications lane deferred |

**Both asset files and typed manifest are required.** Brand specialist owns source/vector derivatives and Drive upload/readback, inventory with SHA-256/MIME/dimensions/rights/Owner approval version, contact sheet against white/navy/neutral/brand-orange and 16/24/32px clarity. Kimi owns app integration **only after separately authorized S1-4B**, at proposed `web/public/brand/option5/v1/`, `web/src/config/brandAssets.ts` and `web/src/components/brand/BrandIdentity.tsx`. These are *proposed* paths, NOT confirmed existing files. No runtime Drive hotlinks; sanitized SVG, no scripts/external embeds/tracking, no fake vector-by-embedded bitmap. PNG optional fallback, WebP not a mandatory duplicate of vector marks.

**Critical path:** missing finalized logo is **not** a blocker for isolated S1-4A (#266 uses transparent reserved slots and honest text fallback). It **IS** a blocker for final branded S1-4B/RX-03 visual PASS. CarUp corporate identity ≠ dealership/OEM logo ≠ genuine seller listing images ≠ documentary evidence. No fabrication or implied third-party partnership.

**Next brand authority action:** ask same specialist for real board file IDs/bytes/checksums + Owner-facing Option 5 exact-source vs derivative proof and file-level PASS/FIX/HOLD; update draft OD-18's decision status in a controlled docs change after verified accepted artwork. Do not merge #265 based on candidate graphics alone.

---

## 8. Agent register — custody, actual status and independent authority

| Agent / task | Status and branch | Independent role | Next deliverable / stop |
|---|---|---|---|
| **Owner** | Explicit authority for #263 ruleset+controlled merge and Option 5 identity direction | Final approval authority | No approval for #264/#265/#266 or any deployment implied |
| **Outgoing Moderator** | Verified issue/PR/CI/Drive and authored this preventive successor handoff; not a background agent | Successor takes custody | Maintain this handoff as current pointer; no autonomous monitoring |
| **Authorized repo-settings administrator / merge engineer** | **TASK DISPATCHED / BLOCKED BY TOOL CAPABILITY**, see #263 comment #6825114421 and #261 #6825423882 | @11-eleven-skm independently verifies result if not writer | Five required check contexts verified and guarded #263 merge; no alternate scope |
| **Kimi, lead presentation implementer** | S1-3 delivered/approved on #264; **S1-4A candidate now submitted #266 at 17c68211...** | @11-eleven-skm separate review | **Freeze #266**, source/CI review and Owner visual gate; no unrestricted S1-4B |
| **@11-eleven-skm reviewer** | Formal exact-head APPROVE on #263 and #264; **no review yet on #266/#265** | Must not certify own changes | Review #266 and draft #265; on new reconciled #264 SHA review again |
| **Truth/Trust authority (specific human not confirmed)** | PENDING authority acknowledgment on backend TrustLens mapping | Independent data/Truth review | Authoritative actual source/coverage/freshness mapping or precise blocker |
| **Privacy/Auth authority (specific human not confirmed)** | PENDING on server-side public VIN payload and shell context | Independent security reviewer | Public projection/server auth negative evidence, step-up isolation and context security |
| **Brand/media specialist, SAME existing specialist** | Owner Option 5 reported; first-wave production contract dispatched, **verified final file upload not yet evidenced** | Owner visual + independent file/security QA | Validated masters/variants/manifest/Drive readback; no competing redesign |
| **Owner browser/device UAT** | NOT ACTIVE for real connected RX-03 | Owner + QA | Future real identities, 5-width browser/device, auth/tenant/reviewer, staging only if authorized |

**Operational honesty:** GitHub comments and copy-ready prompts are durable **dispatch instructions**, not proof they launch a separate Claude/Kimi/media agent session. If the operator has not run the task, mark `DISPATCHED, EXECUTION_UNCONFIRMED`. A submitted PR or self-report is not independent acceptance. Avoid simultaneous source writers in shared file areas.

**Assignment records:** [Issue #261 four-lane dispatch #6825146409](https://github.com/kudzimusar/carup/issues/261#issuecomment-6825146409), [PR #263 admin work order #6825114421](https://github.com/kudzimusar/carup/pull/263#issuecomment-6825114421), [PR #264 QA/Truth/Privacy #6825166203](https://github.com/kudzimusar/carup/pull/264#issuecomment-6825166203), [PR #265 brand work #6825168055](https://github.com/kudzimusar/carup/pull/265#issuecomment-6825168055), [PR #265 precise intake #6825600450](https://github.com/kudzimusar/carup/pull/265#issuecomment-6825600450).

---

## 9. Quantitative progress, gates and known blockers (do not guess %)

**Formal programme-wide acceptance:** `NOT_BASELINED`; no frozen Owner-approved package denominator and evidence threshold for all RX-00–RX-09. **Never report 40%, 60%, 3/4 as total CarUp completion.** Scoped status (NOT programme weighted): S1-1 **merged**, S1-2 and S1-3 **formally independently approved unmerged**, S1-4A **draft submitted awaiting review**. Candidate readiness is NOT deployed progress. Counts of agent roles depend on actual verified assignment rather than purported background activity.

| Gate | Status | Evidence or missing condition |
|---|---|---|
| RX-00/IR01 archaeology, MP01 v0.9.2, RX-01B S0 | **DOCUMENTATION ACCEPTED/MERGED** | #259/#260; unresolved individual Owner visual/ADR decisions remain |
| RX-02A S1-1 | **CERTIFIED + MERGED** | #262 merged main 8bc00bd; post-merge checks passed in prior custody |
| RX-02A S1-2 CI-04 | **TECHNICALLY APPROVED / MERGE BLOCKED** | #263 approval/15 success; missing 3 ruleset REQUIRED contexts |
| RX-02A S1-3 truth components | **TECHNICALLY APPROVED / INTEGRATION HOLD** | #264 approval/14 success incl PG17; no #264 merge authority; Truth/Privacy consumption gate |
| RX-02 S1-4A shell prototype | **CANDIDATE / INDEPENDENT REVIEW HOLD** | #266 unreviewed, 2 checks still running at last poll; Owner visual PASS/FIX/HOLD missing |
| BA-01–05 Option 5 brand library | **DIRECTION APPROVED / PRODUCTION ASSETS HOLD** | Original file bytes/rights/variants, file-level Owner PASS and integration source not verified |
| S1-4B real shared-shell migration | **NOT STARTED / NOT AUTHORIZED** | S1-4A Owner PASS, S1-3 integrated, architecture/context security, brand assets for final visual pass |
| RX-03 first visibly connected cross-domain pilot | **NOT STARTED / BLOCKED BY FOUNDATIONS** | actual API roles/tenant reviewer negative UAT, legitimate auth, no false Trade, visuals, brand |
| RX-04–09 / native full parity / production | **NOT CERTIFIED/NOT AUTHORIZED** | future separate gates |

**Blockers (taxonomy / resolver):**
- `ENVIRONMENT / RELEASE_GATE P0`: GitHub connected moderator agent has no ruleset PUT/PATCH; required-five check readback missing; **settings-capable admin** is resolver. Do NOT attempt to merge #263 on only two required contexts.
- `RELEASE_GATE P1`: #266 two CI jobs running and no independent review; **QA @11-eleven-skm** verifies full gate and visual/source.
- `OWNER_POLICY`: #264/#265/#266 merge, S1-4B and RX-03 not authorized; **Owner** grants individually after evidence.
- `SECURITY / TRUTH`: source semantics and public server VIN projection (S1-3 consumer adoption), protected role/tenant/reviewer context (S1-4B); actual **domain authorities TBD**, must identify before live migration.
- `LEGAL/LICENCE / CUSTODY`: production-quality Option 5 vector master source/rights/visible approval missing independent file evidence; **brand specialist + Owner**.
- `PRODUCT / ACCESSIBILITY`: 249 historical contrast nodes are ratchet debt, not fixed defects; **route migration owner + QA** tracks against baseline.
- `PHYSICAL_UAT`: no connected live-role RX-03 journey or native device product acceptance; **QA/Owner** at later authorized stage.

---

## 10. Exact files most relevant to this handoff (do not search from scratch)

**#263 12 changed paths:** `.github/workflows/ci.yml`; `docs/RX02A_S1_2_SURFACE_2_RECONCILIATION.md`; `package.json`; `scripts/ci04-contrast-baseline.json`; `scripts/ci04-contrast-scan.mjs`; `scripts/contrast-ratchet-gate.mjs`; `scripts/no-new-glass-gate.mjs`; `scripts/rx01b-reference-matrix.json`; `scripts/rx02a-style-baseline.json`; `scripts/tests/ci04-gate.test.mjs`; `web/package.json`; `web/src/components/home/JourneyMediaStory.tsx`. Source authority: #263 HEAD and GitHub actual patch, NOT historical PR description.

**#264 19 changed paths:** `CODEOWNERS`; `docs/product-experience/rx02a-s1-3-component-catalogue.md`; `web/src/App.tsx`; `web/src/components/truth/DataState.test.tsx`, `DataState.tsx`, `EvidenceLine.test.tsx`, `EvidenceLine.tsx`, `MoneyDisplay.test.tsx`, `MoneyDisplay.tsx`, `TrustLens.test.tsx`, `TrustLens.tsx`, `VehicleIdentity.test.tsx`, `VehicleIdentity.tsx`, `dataStates.ts`, `index.ts`, `money.test.ts`, `money.ts`, `trustLensStates.ts`; `web/src/pages/dev/ComponentCatalogue.tsx`.

**#265 two docs-only paths:** `docs/product-experience/CARUP_BRAND_MEDIA_ASSET_REGISTER.md`; `docs/product-experience/CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md` (draft v0.9.3 §10.4).

**#266 15 changed paths:** `docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md`; `web/src/App.tsx`; `web/src/components/ux-prototype/rx02-s1-4a/BrandMark.tsx`, `FocusedShell.tsx`, `PublicShell.tsx`, `WorkspaceShell.tsx`, `contracts.ts`, `fixtureDisplay.tsx`, `fixtures.ts`, `index.ts`, `navProjection.ts`, `pathUtils.ts`, `routeShellMap.ts`, `shellPrototype.test.tsx`; `web/src/pages/dev/Rx02S14ShellPrototype.tsx`.

**Application source hotspots preserved for later S1-4B ONLY:** `web/src/App.tsx`; `web/src/components/layout/MainLayout.tsx`; `Navbar.tsx` (legacy logo near ~201–210); `Footer.tsx` (~68–80); `DashboardLayout.tsx` (~120–130); `MobileNavDrawer.tsx`; `CompactBottomNav.tsx`; `web/src/config/navigationManifest.ts`; `web/src/config/featureRegistry.ts`; `web/src/context/AuthContext.tsx`; backend canonical Trust/marketplace listing public projection and dealer rights gates. These must not be edited under S1-4A authority. In the existing app, car-glyph+orange gradient+text are temporary brand substitutes, not official CarUp logo. `web/public/email-assets/manifest.json` still records `logo_artwork:null` and text fallback; do not copy favicon into email logo.

**Design source line map:** `DESIGN.md` §5 (media), §6 (nav), §11.4 (media persistence), §13 (shared); MP01 §0 Owner decisions, §3 product grammar, §5 visual tokens, §6 TI register, §9 source/merge custody, §10 phase plan, §10.3 rollback, draft §10.4 brand, §11/12 UAT, Appendices A–H; `UI_DESIGN_REFERENCE_AND_TOKENS.md` §6 Truth components and §10.3 catalogue; `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` R001–R139; #266 prototype doc specific line ranges in §6 above.

**Historical superseded items:** prior handoff `CARUP-MOD-HANDOFF-2026-11-12-UX-REBUILD-02` and 11-Nov predecessor were valid at their time but reflected old #262/#263 blockers. Do not re-open lockfile/font-base64 or pre-R2 money/VIN corrections. Prior project results remain evidence. Only a genuinely new issue supported by source justifies reopening an accepted unit.

---

## 11. Moderator responsibilities and EXACT specialist prompt discipline

**Moderator role:** an active programme **controller**, not an informal report collector or the same engineer who certifies their own changes. Responsibilities:
1. Translate Owner goal to stable phases, scoped work packages, named agent roster, dependency plan and actual acceptance.
2. Before dispatch, inspect **live** repo status, branch ownership, existing tasks and Owner authorization. One writer per shared branch/migration.
3. Issue bounded instructions with **full SHA**, exact permitted files, immutable source, test matrix, no-go conditions and deliverable/review contract. Never prompt "make the app modern", "finish everything" or autonomous production.
4. At EVERY specialist return independently check PR source/diff/CI/visual/negative tests, classify product vs harness vs environment vs policy, issue **one formal ACCEPT / REMEDIATE / BLOCK**; specialist self-claims do not certify.
5. Get a **separate independent reviewer**, then the **Owner's explicit permission** to merge protected source or deploy. Formal GitHub **Approve** review is not a general merge authority.
6. Keep **N/M = NOT_BASELINED** until Owner freezes a denominator; no fictional percentages. At every pulse show source SHA, accepted milestone counts, agent status, gate, blockers and next task.
7. Enforce privacy/rights, truthful vehicle/currency/Trust, real media, role/tenant/reviewer isolation, free-first cost and no unauthorized provider/Production action.
8. After any material return, assignment, SHA/authority change, update issue, records, and **the current continuity handoff**. Proactively create successor before context risk.
9. Recognize tools and agency truthfully: Github comments do not awaken idle Kimi sessions; no promise of automatic background work without configured automation.
10. Preserve separate governance project adoption and project architecture.

**Every IMPLEMENTATION dispatch must follow** [central dispatch template](https://github.com/kudzimusar/11-11-tech/blob/3225760aa91a238cda9be52af8cadd205db0da8c/governance/global-moderator/templates/agent-dispatch.template.md):
- Header `11-11 TECH — CARUP MODERATOR → [named role]`, stable task ID/priority, `AUTHORIZE/RESUME/REMEDIATE` scope.
- Exact repo, current base SHA, target branch and existing PR, source/Owner approval, design/functional/Truth contracts.
- One business outcome, precise allowed new/changed files **and prohibited paths**, tested role/tenant/financial/UX invariants, no redundant research.
- Dependency-safe single-writer instructions, tests at 360/390/768/1280/1920 when visual, browser/API/CI and negative auth/Truth evidence, acceptance criteria, rollback.
- Concrete STOP: changed SHA, missing permission, competing writer, unexpected live route, PROD, paid provider, DB, protected secrets, unresolved design/security decision.
- Return: exact HEAD/base, changed paths, commit/CI/artifact URLs, test counts, Owner visual packet, independent reviewer identity, blockers, next small package. No predetermined APPROVE.

**REVIEW dispatch is distinct**: reviewer chooses APPROVE or REQUEST_CHANGES based on exact SHA and actual evidence. **BRAND dispatch distinct**: source-original preservation, derivative export quality, rights/Owner file-level approval and verified Drive readback; no app changes. **ADMIN dispatch distinct**: settings readback, no bypass, exact SHA merge guard, audit trail. A handoff itself grants zero new authority.

---

## 12. Successor's first twelve actions — resume, do not rediscover

1. Read this exact handoff, the linked central proposed standard/skill, MP01 and current PR commentary. Note previous handoff is historical.
2. Fetch latest `main`, PRs **#263/#264/#265/#266** heads/bases/draft/merge, central #16 and newest Issue #261 assignments. Mark unexpected changes `CUSTODY_DRIFT`.
3. Read current active ruleset #20850554; if still two required checks, **activate settings-capable Admin** using the already Owner-authorized precise PR #263 order (no repeat request/redo CI).
4. Independently verify five contexts after write, unchanged #263 exact SHA, formal review and checks; only then permit the executor to convert to ready and guarded merge-commit. Stop if any protection mismatches.
5. Verify merge commit and new `main` with post-merge CI; record the new accepted baseline in the controlling issue and continuity.
6. Reconcile #264 against new main with sole authorized writer, run new CI-04 checks and request fresh independent review if SHA changes; require separate Owner authorization for #264 merge. Confirm Trust and Privacy authorities before public/production-facing adoption.
7. Poll #266 final CI, review the **existing** 15-file DEV-only prototype (including whether static import survives production bundle). Request independent review and Owner visual PASS/FIX/HOLD; **do not create a second S1-4A PR**.
8. Keep Kimi's current #266 candidate frozen during review; if exact specific defect exists, issue one bounded remediation on same PR. No S1-4B or RX-03 without new Owner decision.
9. Coordinate the SAME brand specialist's Option 5 production vector and asset manifest, validate actual source board and file-level rights/quality; do not invent a new logo.
10. Review docs-only #265 with independent reviewer; reconcile OD-18 owner choice accurately, **without treating a source selection as full export approval**. No automatic merge.
11. Update task/agent ledger, acceptance denominator, gate/risk table, issue #261 and this handoff on every event; provide a concise Owner-facing progress pulse with actual next responsibility.
12. **Create the next preventive handoff BEFORE the new session becomes unreliable**. The receiving moderator inherits this automatically, even if Owner does not repeat it.

**Mandatory takeover acknowledgment draft:**

> I take custody as the incoming CarUp Programme Moderator under `CARUP-MOD-HANDOFF-2026-11-13-UX-REBUILD-03`. Last verified accepted main is `8bc00bd75f5285997065872514d10db8fbecd24f`. S1-2 #263 at `4122a8f6...` has independent approval and 15 passed checks but still needs the five-context active ruleset readback and Owner-authorized guarded merge. S1-3 #264 at `9bcff2f2...` is independently approved with 14 successful/3 expected skipped CI; its merge and production-facing Truth/Privacy gates remain separate. Kimi submitted S1-4A #266 at `17c68211...`, Draft/unreviewed with partial CI; I will review, not restart it. Brand MP01 draft #265 at `f332526...` awaits review and Option 5 actual-source/production asset acceptance. Official whole-programme completion is NOT_BASELINED. First task: assign a settings-capable GitHub administrator to close #263's exact required-check gate. No merge/deploy/DB/payment is presumed except the limited Owner-authorized #263 merge if verified. I inherit continuous custody, progress reporting and my own next handoff.

---

## 13. Evidence, storage and limitations

**Directly verified in this handoff:** latest main; ruleset 20850554 contents; PR #263/#264/#265/#266 head/base/draft/merge status; #263 independent approval and 15/3 exact checks; #264 independent approval and 14/3 including completed PG17; #265 no formal review; #266 15 files/no review/12 success 3 skip 2 running; exact PR #266 app patch 2 hunks; project central PR #16 still Draft at exact candidate; governing plan and route register; Issue #261 administrator blocker comment. No ruleset settings mutation, merge, deployment or branch rewrite performed as part of this handoff.

**Source-derived but NOT independently performed/verified:** Kimi's isolated #266 local full suite and 44 screenshots/visual claims; brand specialist's claimed recovery of the four board files and original binary quality/rights; actual named Truth/Privacy authority signoffs; complete connected browser authenticated RX-03 journeys; current PWA/native/production deployment snapshots. Do not turn these into confirmed certification.

**Confidentiality:** use access-controlled Drive to inspect original logo reference boards, licensing, staff/user records; omit private links and any security disclosure payloads from public repository documents. A user-uploaded prior handoff archive may contain historical run data; keep as local/successor attachment unless project access policy allows otherwise.

**Prior handoff lineage:** `CARUP-MOD-HANDOFF-2026-11-11-UX-REBUILD-01` → `CARUP-MOD-HANDOFF-2026-11-12-UX-REBUILD-02` (historical chat/local) → **THIS** `CARUP-MOD-HANDOFF-2026-11-13-UX-REBUILD-03`. This current snapshot supersedes only time-sensitive PR/CI/agent status, never historical accepted decisions.

**No implied adoption or permission:** this document is a governance/continuity artifact. A Draft PR is **PR_PENDING**, not accepted main. It authorizes no PR #264/#265/#266 merge, staging/Production, payment transaction, database/tenant or provider changes. The global standard remains proposed until central approval and project adoption.

**Mandatory future rule:** *The receiving moderator must follow Global Moderator Governance & Continuity Standard 1.0 as Owner-requested process guidance, generate the next successor handoff and verify live sources. Formal project adoption remains subject to accepted PR/Owner process.*
