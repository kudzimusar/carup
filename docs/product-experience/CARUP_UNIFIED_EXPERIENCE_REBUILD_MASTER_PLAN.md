# CARUP — Unified Experience Rebuild Master Plan

**Programme:** `CARUP-UX-REBUILD-01`  
**Document ID:** `CARUP-UX-REBUILD-01-MP01`  
**Version:** `0.9.1 — OWNER APPROVAL CANDIDATE (incorporates the Opus IR01 research addendum: Part II, Appendices E–H)`  
**Issued:** 2026-11-10 (Asia/Tokyo)  
**Repository:** [`kudzimusar/carup`](https://github.com/kudzimusar/carup)  
**Repository target:** `docs/product-experience/CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md`  
**Source-of-truth snapshot:** `main` @ `9f2bebfe66a19e4d90c44085a3166562d2176626` (PR [#258](https://github.com/kudzimusar/carup/pull/258) merged 2026-11-08)  
**Owner:** CarUp Product Owner  
**Programme control:** 11-11 TECH / CarUp Programme Moderator  
**Document state:** **PROPOSED — not approved; no implementation, merge, deployment, schema migration or commercial activation is authorized by this document.**

> **Product mandate:** Build **ONE CARUP EXPERIENCE**: compact, composed, responsive, visually distinctive and globally competitive automotive commerce and operations across web/PWA and native mobile. Replace the fragmented presentation architecture, **not** the proven application services, security or data authorities. The finished product must make it impossible to mistake a Marketplace, Dealer, Garage, Trade, Owner or Review journey for an unrelated app.

> **Revision 0.9.1 (2026-11-10).** This version keeps the Moderator-authored v0.9.0 text of §§0–15 and Appendices A–D unchanged, apart from these additions:
> - this note and the version line;
> - additional Owner decisions **OD-11–OD-17** (§0);
> - additional containment items **TI-15–TI-27**, and a table of existing off-`main` remediation candidates (§6.1–§6.2);
> - **Part II (§§16–29)**;
> - **Appendices E–H**.
>
> Part II was contributed by the Opus IR01 research coordinator at the Owner's request. It draws on the independent IR01 evidence, re-checked against `main` @ `9f2bebfe`. Where a Part II erratum (§17) corrects a Part I statement, the erratum controls for planning. **Nothing in this revision authorizes implementation, merge, deployment, schema migration or commercial activation.**

| Version | Date | Author / custody | Change |
|---|---|---|---|
| 0.9.0 | 2026-11-10 | CarUp Programme Moderator (11-11 TECH) | Owner approval candidate reconciling GLM IR01-R2 and Opus IR01 research |
| 0.9.1 | 2026-11-10 | Opus IR01 research coordinator, at the Owner's request | Research addendum, committed to the repository as the programme trail and reference. Covers errata; re-verified facts; unification scorecard; context requirements; shell-migration hazards; added containment items; off-`main` remediation candidates; domain specifics; test and CI specifics; performance and accessibility baselines; custody detail; added Owner decisions; market constraints; open-verification register; agent brief contract; evidence index |

---

## 0. Decisions requested from the Owner

**Approval of this document** would authorize this as the *planning authority* and permit specialists to prepare separately scoped implementation PR proposals. It would **not** independently authorize code changes, merges, production/staging deployment, shared database migrations, real-dealer publication, payments or security-policy relaxation. The Owner should review the following proposals before implementation:

| ID | Proposed decision | Default presented for approval | Explicit reservation |
|---|---|---|---|
| OD-01 | Architecture strategy | **Option B:** reconstruct shared shells/components with **selective complete presentation replacement** of irredeemable screens; do not rewrite backend | Prototype and UAT still required |
| OD-02 | Brand authority | `DESIGN.md` + Marketplace Visual DNA: **Precision Automotive Commerce + Evidence-Led Trust Intelligence**; remove glass as default and generic stat-card fleets | Keep honest safety/status semantics |
| OD-03 | Shell taxonomy | **Three presentation families**—Public, Workspace, Focused—with isolated Review policy/variant under Workspace | Reviewer authority must remain independent |
| OD-04 | Visual composition | **Showroom Calm** (public/personal discovery), **Exchange/Operations Workbench** (dealer, garage, trade, institutional), **Focused Service Flow** (forms/transactions) | Require side-by-side high-fidelity samples |
| OD-05 | Context switching | Server-derived active memberships/capabilities; keep existing URLs first, propose URL-addressable org routes only after parity | Manifest is navigation data, never an authorization grant |
| OD-06 | Mobile/footer policy | Public footer retained on mobile as a compact accessible accordion; mobile bottom navigation is manifest-derived, task-aware and safe-area aware | Prove no collision between drawer/bar/footer |
| OD-07 | Visual tokens | Inter initially (self-hosted, reduced weights), sharp editorial surfaces, restrained 4–6px workspace controls, accessible orange action variants, neutral panels | Final token swatches/typography require Owner visual approval |
| OD-08 | Branch custody | `main` stays the base; extract useful unmerged work only by evidence/acceptance, no wholesale stack merge | Existing programmes retain independent gates |
| OD-09 | Legacy cutover | Route-family feature flags; retain safe redirects/gates until parity and user migration are established | Never remove auth or tenant boundaries |
| OD-10 | Product scope | Web/PWA for full operations; native for genuinely supported device-first features, not pretend parity | Native feature map to be certified |
| OD-11 *(v0.9.1)* | Trade OS lineage to extract from | **#207 → #243 → #244** as the review candidate. It holds CAP Journey & Arrival and the workspace layer. #214 and #215 are treated as superseded alternates unless the Trade lead shows unique accepted content | No branch merge; extraction unit by unit under the §9 custody procedure; see §25 |
| OD-12 *(v0.9.1)* | Garage operating system and tenant model | Extract services from #239–#242 after domain acceptance, then rebuild the screens on WorkspaceShell(garage). Adopt the Garage 1.0 model (`activeTenant` plus tenant types and roles). Do not adopt #197's model, where a tenant role satisfies a platform role | Business and schema acceptance is separate. Staging currently serves this lineage (`8353dbdd`) |
| OD-13 *(v0.9.1)* | PR-less custody | Open Draft PRs, with no merge, for `fix/carup-mvp-stab-01-client-readiness` @`a42d3c8a` and `feat/ca-owner-02-management-convergence` @`2b6a1099` before extracting anything from them | Check the workflow triggers before opening any PR (§23.5) |
| OD-14 *(v0.9.1)* | Seed-only institutional screens | Hide (feature-gate) Claims, FraudAlerts, RegistryVerification, AIMonitoring and the insurer dashboard until a governed data source exists, with an honest "not available" state. Correct Bank LendingQueue rather than hiding it | Owner may choose "coming soon" copy instead of hiding |
| OD-15 *(v0.9.1)* | Market price context | Plan, for RX-04, a price-context label whose method is published and which has an explicit "no rating" state (§27) | Needs a data authority and a published method; no label without data |
| OD-16 *(v0.9.1)* | Review-independence coverage | Extend server-enforced independence and step-up beyond the dealer programme to the other review and decision types before any UI implies independent review (TI-22) | Security and Trust owners set the scope. The inventory is held in private evidence |
| OD-17 *(v0.9.1)* | Production containment for TI-01 | Production reports `78303ed6` and its bundle still renders demo access. After the read-only ops check (OV-01), consider a separately authorized containment change, for example the reviewed `8949d570` or an equivalent, ahead of RX-09 | Any deployment remains a separate Owner decision; this plan authorizes none |

**Recommended Owner action:** approve the *strategy and research reconciliation* now; reserve **final UI direction and any implementation authority** for the connected reference designs and associated programme gates (§§5, 10–12).

---

## 1. Scope, authority and evidence hierarchy

### 1.1 Governing repository documents

1. [`DESIGN.md`](../../DESIGN.md) — **global visual/product-design authority** across web/mobile, roles and domains. Its restrictions on glass, card-led dashboards, arbitrary local identity and untruthful states are binding design objectives.
2. [`docs/marketplace/MARKETPLACE_VISUAL_DNA.md`](../marketplace/MARKETPLACE_VISUAL_DNA.md) — automotive editorial reference for public discovery, vehicle imagery and commerce.
3. Navigation/feature contracts currently implemented in `web/src/config/featureRegistry.ts`, `web/src/config/navigationManifest.ts`, route guards, native manifest and domain entitlement services — **behavioral authority**, not permission to invent UI styles.
4. Authoritative domain services, database constraints, canonical Vehicle Truth/Trust, evidence provenance, tenant membership, review independence and payment controls — **must continue to be server-enforced regardless of UI design**.

`DESIGN.md` was committed on 2026-08-30 (`70f42ae6`) and reached `main` through PR #194. Historical design-planning PR [#181](https://github.com/kudzimusar/carup/pull/181) is open and unmerged; it remains a reference, not an override of the merged design authority.

### 1.2 Independent research reconciled

| Evidence set | What it contributes | Limits / treatment |
|---|---|---|
| **GLM IR01-R2 Research Report** (`CarUp-IR01-R2-Research-Report.docx`/PDF) | Corrected web route census, source history, UI/style and functional-truth audit | Several report/workbook counting and SHA-label issues are corrected in §2; not release certification |
| **GLM IR01-R2 Registers** (`CarUp-IR01-R2-Registers.xlsx`) | 13 sheets; **289 file-level dispositions**; **12 functional-preservation journeys**; issues, PR provenance, 24 authenticated UAT checks | Spreadsheet primary dispositions are *research recommendations*, not authorization to delete files; §8 overrides high-risk conflicts |
| **GLM Critical-Issue Memorandum** | D1–D3 and F-series containment candidates | Vulnerability impacts distinguish proven source facts from untested production configuration |
| **GLM Architecture Decision Dossier** | Workspace chrome family, modes, six written references | Some shell-placement and URL assumptions require correction (§§3–4) |
| **GLM visual ZIP** (`carup-ir01-r2-visual.zip`) | 116 public/auth screenshots, 29 routes × four viewports; manifest | Unauthenticated local Vite without backend; **not** authenticated end-to-end UAT |
| **Opus 5.5 full IR01 report** (`CarUp UI rebuild architecture research.md`, Deliverables 1–14; Appendices A–K) | May–Nov history, 150 route elements, styling inventory, navigation, domain/disposition, 53-open-PR provenance, local-mock browser/axe/performance | Screens behind login used **synthetic sessions/stub API**; native not run; deployed provenance independently recheck before acting |
| **Current GitHub metadata/source** | Independent branch/PR status, source files, SHA and route-structure validation | Verify anew at each PR's exact head; historical snapshot is not self-updating |

**Evidence labels used below:** **S** source-verified at recorded SHA; **G** Git/PR history; **R-L** locally rendered with synthetic/stub data; **R-U** unauthenticated browser screenshot; **D** research-document assertion; **J** proposed design/engineering judgment; **OPEN** needs runtime/Owner/authority verification. Any production finding from external static metadata is **reported**, not independently certified in this plan.

**Research handling:** Original GLM/Opus files were supplied as conversation attachments, **not automatically part of the public repository**. Their local-user-machine directories are not dependencies of this plan. Do not commit private screenshots, credentials or local evidence stores. Evidence approved for source control should be explicitly sanitized, checked for third-party rights and added in a later governed documentation PR.

### 1.3 Non-negotiable boundaries

- **Keep:** backend services; existing accepted domain behaviors; actual data; source-coverage uncertainty; canonical vehicle identity; tenancy, reviewer independence and server authorization; live-finance prohibitions; idempotency; legal disclosures; journal/audit semantics.
- **Replace:** incoherent presentation shells, old page composition, duplicate navigation maps, inactive/misleading UI, unapproved glass/gradient/card idioms, fragmented mobile experiences and duplicated status/Trust representations.
- **Never infer from a UI merge:** public release, production deployment, shared database migration, dealer publication, payment readiness or verified Trust/finance/insurance facts.
- **Do not build “global quality” on synthetic screenshots.** Real authenticated, populated-data UAT and actual deployment provenance remain mandatory.

---

## 2. Reconciled baseline: where CarUp actually stands

### 2.1 Route and component arithmetic

| Measure | Audited conclusion | Reason counts differ |
|---|---|---|
| Web route elements | **150** = **139 path-bearing** + **11 pathless layout wrappers** | Redirect and 404 are already included among the 139 paths; never count redirect again |
| Distinct presentation shells | Opus: **7 effective variants**; GLM: **11 wrapper occurrences/effective placements** | Wrapper *occurrence*, render *variant* and independently authored *component* are different units |
| Business workflows in marketing shell | Opus: **32 of 59** within the relevant `MainLayout` route group | Count by actual route nesting and operator task, not pathname prefix alone; reproducible route register is required |
| GLM component/file disposition records | **289** = KEEP **118** + REBUILD **147** + CORRECT **9** + RETIRE **7** + EXTRACT **4** + HOLD **4** | One *GLM primary classification* per file; not the same grain as Opus's route-level decisions |
| Opus route-level recommendations | **139** = KEEP **68** + EXTRACT **25** + HOLD **23** + RETIRE **10** + CORRECT **9** + REBUILD **4** | A route may be KEEP while the **screen presentation and shell** are rebuilt; no contradiction with 147 GLM component REBUILDs |
| GLM preservation register | **12 journeys** | Each demands component→hook→API→service→authority→test chain (§7) |
| GLM authenticated UAT | **24 OPEN** = 6 journeys × 4 widths | No real staging session/data used; these are planned checks, not passed checks |
| GLM R2 “692 rows” | **Not a validated uniform data-row total** | Earlier reconciliation found 672 substantive populated records excluding some index/header/summary rows. This master plan uses **per-sheet typed counts**, not an ambiguous workbook grand total |
| Opus repository PR census | **53 open PRs** at 2026-11-10 audit; additional unmerged remote branches | GLM's PR worksheet is a **selected set**, not a competing claim about total open PR count |

**Main baseline:** `9f2bebfe66a19e4d90c44085a3166562d2176626` is the merged PR #258 source. The dealer functionality is in main; code merge ≠ UI convergence ≠ release. Current PR metadata must be refreshed immediately before any integration.

### 2.2 Verified historical explanation, not folklore

| Generation | Date and evidence | UI additions; residual issue |
|---|---|---|
| **G0** — initial scaffold | 2026-05-31, commit `771a3ca3` [G] | Public `MainLayout`, `DashboardLayout` for role portals, 53 shadcn primitives, navbar/footer, `card-shadow`, `.glass-card`, `.glass-dark` pattern family, cards and static demo data. Opus reports 125/127 original runtime files still present; **presence ≠ each file remains a valid UX**. |
| **G1** — Navigation Intelligence | June 3–24, PRs #4, #16, #18, #56, #57, #94 [G] | URL-aware discovery, feature registry, manifest, public drawer/footer and route gating. It improved nav *data*, not a universal final shell. |
| **G2** — Truth/Trust | July–Aug, notably PR #165 [G] | Canonical Truth remediated false claims while leaving many original page layouts in place. |
| **G3** — editorial Marketplace/Seller | Aug 26–Sept 4, through PR #194 [G] | Image-led Marketplace, editorial Seller/My Garage, compact mobile bottom bar; global `DESIGN.md`; changes were not propagated to all owner/operational pages. |
| **G4** — unmerged business shells | Sept–Oct, #197, #207, #220–244 [G] | TradeOSWorkspaceLayout, Garage operating screens, CorporateLayout, WorkspaceChrome, native UI: competing candidates, **not on main**. |
| **G5** — Dealership 1.0 | Nov 3–8, PR #258 [G/S] | Real claim-first product integration, but new dealer/reviewer shells and restored legacy dealer page visual language. |

A **65-day gap between the 2026-09-04 and 2026-11-08 main merges** contributed to divergence. Do not infer the motive for each legacy retention without commit, PR or source-comment evidence. Opus also documents a historical Git-history rewrite; historical PR attribution should be based on first-parent and merged-PR evidence, not SHA ancestry alone before that rewrite.

### 2.3 Styling audit: same diagnosis, different scanner scopes

| Class | GLM IR01-R2 | Opus IR01 | Reconciled use |
|---|---:|---:|---|
| Raw Tailwind palette occurrences | **8,550** in 365 non-test TS/TSX files | **8,555** in 366 runtime files incl. CSS/JS | Both support large token bypass; **do not report one as an error without scope normalization** |
| Semantic-token occurrences | **432** | **496 total**, only **51 in application code** outside default UI primitives | Compare like-for-like app code, not primitives; no meaningful standardized product-token layer yet |
| `card-shadow` occurrences | **211** | Source scans show persistent use, including Vehicle Detail/role portals | Deprecated as default by `DESIGN.md` §20; replace by hierarchy not merely class deletion |
| Glass utility usage | `.glass-card`/`.glass-dark` **0 references** in scanned runtime | Their CSS definitions are dead but **28 backdrop-blur** occurrences recreate the visual effect | Remove obsolete CSS and inappropriate blurs/alpha surfaces, preserve legitimate overlays if justified |
| Gradients | ~106 utilities | 107 `bg-gradient-to-*` in 34 runtime files | Audit their actual purpose; photographic scrims/functional elevation are distinct from ambient glow |
| Geometry | 51 distinct `max-w` variants reported | 12 major outer widths, 28 heading recipes | Choose canonical width/density scales; avoid one fixed width for every task |
| Component styling compatibility | Not resolved by GLM | Tailwind **3.4.19** vs some generated Tailwind-4-style utilities; missing compiled CSS and low-contrast neutral hover | **Technical fix required**, with compiled-style assertions before broad design token migration |

Unstyled/unused definitions must not be mistaken for all visible defects. The real failure is **competing UI decisions made locally without enforceable tokens, variants, or shell ownership**.

### 2.4 Runtime and build provenance: two problems, not one

**Reported by Opus using static deployment artifacts at its investigation time** (not retested against deployed runtime here): `carup.dev` production advertises `78303ed6` (2026-08-26); staging advertises `8353dbdd` from an unmerged Garage branch. The production SHA is **1,431 commits behind** the audited main; GitHub ancestry for this relation was independently confirmed in the Moderator review. **Do not redeploy** based on the report: independently inspect immutable deployment metadata, Vercel aliases and exact frontend/backend build identifiers first.

**Reported local bundle measurement:** approximately 3.116 MB uncompressed/790.6 KB gzip initial JS for GLM's local build; Opus's separately instrumented build is ~787 KB gzip. Opus's lazy-import experiment reached ~179 KB gzip. These builds used differing harnesses/configurations and are not live Core Web Vitals. The direction to **route-level code-split** is validated as worthwhile; the experiment is **not a merged fix**.

**Independent UAT versions to record:** environment, URL, web SHA, backend SHA, build/deployment ID, feature-flag snapshot, account/tenant and database provenance, viewport/browser, test data/consent. If those are absent, visual test results are provisional.

### 2.5 Immediate known problem classes

- **Architecture:** public shell envelops Trade OS and dealer operations; distinct canonical dealer/reviewer and role layouts; `MainLayout` and `DashboardLayout` are behavior-bearing, not disposable divs.
- **Context:** global `user.role` cannot express verified dealer/garage memberships or reviewer object authority; “Switch Portal Role” is functionally misleading.
- **Navigation:** 20-ish independently maintained maps; `CompactBottomNav` has its own `ROLE_HOME`; settings 404 and multiple active sidebar items.
- **Truth:** unsupported metrics, placebo operations, evidence/Trust projection confusion, false empty/success/error states; §6.
- **Performance/a11y:** source-evidenced eager imports, local-mock request storm on `/diaspora/containers`, off-canvas focusability, inadequate interactive targets/contrast. Opus's reported **101/128** axe local-mock captures with findings is a research baseline, **not production a11y certification**.
- **Custody:** at least 53 open PRs, many stacked; advanced Trade, Garage, Corporate, Native and shared chrome changes remain unmerged and not interchangeable with accepted main.

---

## 3. Target product: ONE CARUP, not four rebranded portals

### 3.1 Design principles (normative target)

1. **Automotive-led:** a vehicle is recognizable across discovery, purchase, ownership, sales, service and imports; authentic imagery when available, explicit no-image states otherwise.
2. **Compact but legible:** more usable information per viewport, fewer ornamental panels, not smaller inaccessible text. Prioritize next action, object identity, exceptions, evidence and concise metadata.
3. **Precision:** stable alignment grid, disciplined hierarchy, meaningful whitespace, calm surfaces, structured tables/lists/timelines and predictable interaction patterns.
4. **Truth and provenance:** declared ≠ evaluated ≠ verified ≠ not checked ≠ unavailable ≠ failed; zero ≠ unmeasured; reviewer assertions are traceable to evidence.
5. **One navigation authority:** visible destinations derive from feature lifecycle + current verified membership + object context. UI navigation is **not** a permission grant.
6. **Continuity:** never lose vehicle, VIN, listing, case, order, quote, job, branch or draft context across a shell transition, auth return or mobile breakpoint.
7. **Restraint:** no glassmorphism, gradient glow, arbitrary rainbow role branding, excessive shadow or fleets of pill/stat cards as default product identity.
8. **Native appropriateness:** same brand tokens, state vocabulary and core identity semantics, but distinct Expo-native navigation/controls and honest feature coverage.
9. **Data/performance accessibility:** semantically meaningful headings, all controls keyboard/assistive-technology operable, WCAG 2.2 AA target, on low-powered/mobile networks.
10. **Future-proofing:** new domain features consume the shared experience system; they are not licensed to invent another shell, footer or status kit.

### 3.2 One design system, three experience grammars

| Grammar | Where | Information architecture and aesthetics | No-go |
|---|---|---|---|
| **Showroom** | Homepage, Marketplace, search, vehicle detail, public dealer/garage directories | Media-first editorial hierarchy, single buyer decision, prominent evidence/pricing context, precision layout | Marketing chrome inside an operating console; 8 competing CTAs |
| **Workbench** | Personal My CarUp, Dealer, Garage/Mechanic, Trade, Finance/Insurance/Gov, Admin and review | Context/organization masthead, task queue, clean toolbars, strong vehicle/order/case header, dense lists/tables on desktop, mobile list-detail | Generic equal-stat-card grid, rainbow role colors, tenant ambiguity |
| **Focused Service** | Login, registration, account recovery, claims, verification/KYC, listing creation, checkout, document-review decisions | One goal per view, progress/recovery, clear primary action, save-and-exit when real | Public bottom bar over sensitive forms, decorative cross-selling, fake completion |

These are not separate brands. Every grammar uses **the same** typography, spacing family, brand/semantic palette, controls, document/evidence primitives, money formatter, Trust vocabulary and account context rules.

### 3.3 Shell architecture — binding proposed design, subject to Owner gate

| Top-level family | Variants / security | Header and nav | Footer / mobile behavior | Intended routes |
|---|---|---|---|---|
| `PublicShell` | Public, signed-in browsing | CarUp logo, intelligent mega-menu, search, account and context entry; governed drawer | Public footer **at all widths** (accessible accordion on small devices); bottom 5 nav items if applicable; safe-area and no overlap | Home, Marketplace, Vehicle Detail public mode, Verify, directories, corporate/legal |
| `WorkspaceShell` | `personal`, `dealer`, `garage`, `trade`, `institutional`, `admin` **composition variants on shared `ChromeContract`** | Same logo/account geometry; verified active org, optional branch, contextual object/task, role-authorized module rail | Compact **utility footer/status/version**, never marketing links as main operating chrome; task-aware bottom nav derived from manifest | My CarUp, Dealer stock/staff/branches/enquiries, Mechanic/Garage, Trade, Finance/Insurance, Government, Admin |
| `FocusedShell` | `auth`, `flow`, `review-decision` as **presentation modes** | Reduced navigation; clear title, step/progress, save-and-exit if persistence exists; Help | No standard bottom bar/footer during critical task; sticky primary action with keyboard/safe-area protection | Auth, KYC, onboarding, Seller flow, claims, checkout, independent decision forms |
| **Protected review policy** | *NOT a fourth competing brand* | Review workbench may visually use Workspace/Focused primitives but preserves **dedicated reviewer route/auth boundary, independence checks, step-up and PII controls** | Visible evidence/audit; no public-marketing chrome | Dealer review benches, identity, trust, governance and regulated reviews |

**Implementation note:** GLM described `PublicShell`, `AuthShell`, `WorkspaceShell` and `ReviewShell`; Opus described Public/Workspace/Focused. This document **reconciles them by separating visual families from security isolation**. Auth and Review are *modes and protected compositions* with their own authority policies, not permission to invent new independent tokens/navigation libraries. The existing `DealerReviewerLayout`/`LegacyDealerRouteGate` authority semantics must survive until formally replaced and verified. **No private business route should remain visually nested inside a public marketing shell**. GLM's M2 phrase proposing dealer operations “inside public chrome” is **rejected**.

### 3.4 Navigation and membership/context model

**Existing contracts to retain:** feature catalogue/visibility, Navigation Manifest nodes, route access/feature-state gating, native feature-governance semantics, domain server authorization. **Existing behavior to correct:** `ROLE_HOME`, local reviewer/dealer nav lists, role-only switcher, direct “Settings” 404, double-active paths, confusing Sell destinations, ungoverned admin menus.

**Proposed server-side `SessionWorkspaceManifest` (a new design requiring explicit API/security review):**

```ts
// PROPOSAL ONLY: response is display/navigation metadata, never a grant.
type WorkspaceContext = {
  id: string;                     // stable context ID, not raw guessed tenant authority
  kind: 'personal'|'dealer'|'garage'|'trade'|'institutional'|'admin';
  displayName: string;
  organizationId?: string;        // only server-authorized memberships
  branchId?: string;              // validated against membership/branch scope
  sections: Array<{ key: string; title: string; href: string; enabled: boolean }>;
  capabilities: string[];         // hints for UI, never authorization inputs
};
type SessionWorkspaceManifest = {
  generatedAt: string;
  activeContextId: string;
  contexts: WorkspaceContext[];
};
```

- Build contexts only from **server-verified organizational memberships and role grants**; never infer organizational access from global `user.role` or from a URL slug.
- Feature Registry remains the source of product lifecycle facts; Navigation Manifest remains the source of navigation hierarchy. Both feed the server-authorized context projection. Distinguish navigation eligibility from object authorization.
- Switching context must include the selected authorized context/tenant and return a server-approved selection; invalidate/reload relevant workspace data and verify access. **No silent global role mutation**.
- Deep links must remain safe: keep existing paths as compatibility aliases until URL and object-context migration is accepted. Proposed `/org/:orgId/*` canonical routes are **future decisions**, not a unilateral requirement for the first migration.
- Preserve meaningful URL state (`?vin`, filters, `returnTo`, current order/case), query strings and browser history. Do not store secrets or reviewer step-up tokens in URLs.
- A missing/expired context shows a permission/status page, **not** stale data from the last business. Multiple tenants and browser tabs must be tested explicitly.
- Mobile public five-slot proposal: **Home · Buy · Verify · Sell · My CarUp**; mobile workspace items resolved from authorized context with appropriate fewer primary tasks. A fixed tab bar must neither obscure content nor persist under focused auth or payment steps.

### 3.5 Product chrome design specification (Owner review defaults)

| Property | Proposed default | Verification |
|---|---|---|
| Logo/identity | One CarUp lock-up and semantic brand variants | Across all shell modes, web/native |
| Typography | Inter self-hosted (proposed three weights), hierarchy based on 16px accessible body; editorial headings; avoid 8–10px operational labels | Typographic proof at 390/768/1280/1920; reading zoom |
| Colors | Navy/graphite for type/context; orange as **action accent**; warm-white/cool-neutral surfaces; semantic state tones for truth | WCAG contrast check in **actual rendered combinations** |
| Orange accessibility | For normal text/light background use approved deeper orange, e.g. orange-700 candidate; bright orange only for appropriate non-text emphasis | Normal text ≥4.5:1; large text/non-text threshold as applicable; never rely on color only |
| Radius/elevation | Sharp public hero/commercial bands; small 4–6px workbench controls; borders/hairlines, little elevation; no default 24px SaaS cards | Screenshot-comparison and style-token gate |
| Content width | Public main maximum around 1440px; operational tables can use controlled wider/full available width; no 51 ad hoc max-width variants | Responsive wrap, no unintended overflow |
| Desktop workbench | Context rail at ≥1024px; 40px **dense table rows as a design candidate**, accessible keyboard targets; object-details split view where useful | Owner dense-data visual UAT |
| Mobile workbench | Meaningful list/detail instead of desktop-only horizontally scrolling tables; 44px-equivalent touch targets where practicable | 360/390 touch and focus UAT |
| Public footer | Full information hierarchy available on mobile via accordion; not arbitrarily replaced with a bottom bar | Footer/bottom bar contrast, legal/info links, focus |
| Utility/status footer | Help/legal/system availability/version within private shell; factual build ID when permitted | No marketing footer around operational work |
| Media | Honest crop/aspect ratio, `srcset`, correct alt, empty/silhouette fallback, provenance where required | Low bandwidth and unavailable-image states |
| Motion | Reduced-motion support; no autoplay/ambient glows as default; preserve meaningful interaction feedback | `prefers-reduced-motion` tests |

**Status/Trust kit:** one registry for `neutral/info/progress/success/warning/danger` plus domain state definitions; reusable `TrustLens` (evaluated, stale, not evaluated, insufficient data, unavailable), `EvidenceLine` (issuer/source/timestamp), `MoneyDisplay` (currency mandatory), `DataState` (loading/empty/error/forbidden/not measured), `VehicleIdentity`, `ObjectHeader`, `LifecycleRail`, `ContextToolbar`, `ActionRegion`, `Timeline`, `DecisionPanel`, `TableWorkbench`, `MessageContext`, `DocumentViewer`. **Never invent positive verification, currency, price, delivery, live payment, shipment or insurance status.**

---

## 4. Architecture decision: why this and not a patch programme

| Option | Benefits | Failure mode | Decision |
|---|---|---|---|
| **A. Gradual page restyle on current shells** | Lowest isolated edit risk | Reinforces old shell ownership, role-blind navigation and inconsistent footer; historical attempts failed to propagate | **REJECT** as overall strategy |
| **B. New shared presentation layer + domain-by-domain migration** | Removes root causes, preserves authoritative domain behavior, allows side-by-side cutover and branch coexistence | Requires serious foundation ownership, real-prototype proof and integration discipline | **SELECT** pending Owner sign-off |
| **C. Big-bang frontend replacement** | Freedom to recompose everything | High risk to Seller drafts, dealer tenancy, canonical Truth, reviewer permissions, SafeTrade and complex branch integrations | **REJECT** as global approach; use selective full-page rebuild inside B |

The goal is a **full product-experience reconstruction** without a reckless business-logic rewrite. A route classified KEEP may still move to a new shell, and a file classified REBUILD may contain server-client logic that must first be extracted unchanged. Each decision is **source- and functionality-specific**, not a blanket instruction to erase code.

---

## 5. Connected reference designs — what must be approved before rollout

**Required Owner deliverable:** an integrated reference set, not disconnected attractive mockups. Prototype/implement against the **same canonical tokens, shared chrome, and safe real or explicitly labeled isolated fixtures**. Every screen must show light-state, error/empty and appropriate compact/mobile variant. First prove one connected Public→Personal→Dealer/Trade/Review navigation contract.

| Ref | Screen/journey | Required composition | Must demonstrate |
|---|---|---|---|
| UX-REF-01 | Home → Marketplace → search → Vehicle Detail | Search-first automotive showcase, image-led vehicle story, next action, evidence/price hierarchy, public chrome | Buyer understands vehicle, seller, location, evidence and currency quickly |
| UX-REF-02 | Vehicle Detail → Passport/Trust → saved/inquiry | One shared `VehicleIdentity` + `TrustLens`; distinct evidence provenance; actionable inquiry | No invented Trust score/verdict, saved state survives refresh |
| UX-REF-03 | Login/auth return → My CarUp → My Garage | Focused login, profile/context identity, personal vehicle rail, next actions | No bottom bar on auth, correct returnTo, vehicle context retained |
| UX-REF-04 | Guest Sell → account → Seller Studio → draft/resume | Focused multi-stage forms, one CTA/step, media preview, save receipt and status | No guest media/draft loss, idempotency/authority errors remain meaningful |
| UX-REF-05 | Dealer public profile → claim → Dealer Today → stock → inquiries | Public→Focused→Workspace; verified business/branch context; dense inventory list | Dealer claim/staff/stock permissions and reviewer independence intact |
| UX-REF-06 | Garage service request → workshop queue → work order → schedule | Vehicle/job identity, queue, capacity, next action, service record | Main vs unmerged functionality clearly labeled; no fabricated customers |
| UX-REF-07 | Trade request → RFQ → import order → documents → shipment/CAP | Transaction rail, source/actor/timestamps, freight/cost qualification, evidence checklist | Core Trade functions work without merging unaccepted branches; missing rates not fabricated |
| UX-REF-08 | Reviewer queue → evidence → approve/reject/revoke → audit | Independent access/step-up, split-view evidence, basis/reason, timeline | No self-review, access disclosure or false verification |
| UX-REF-09 | Communications across vehicle/job/order | Conversation carries object context, delivery states and actionable thread | Message failure not silently “No conversations yet”; permissions intact |
| UX-REF-10 | Native mobile owner/vehicle task | Native navigation, status and typography parity, lightweight imagery | Actual supported native tasks only, device/back/gesture tested |

**Visual sign-off gate:** Owner reviews at **360×800, 390×844, 768×1024, 1280×800, 1920×1080**, dark/low-light only if explicitly supported, empty/populated and authenticated contexts. Compare a before/after **cross-route journey**, not just one “hero” screenshot. Record PASS/FIX/HOLD and Owner decision for every reference. No accepted high-fidelity reference → no wide component rollout.

**Global competitiveness acceptance:** benchmark decision speed, hierarchy, responsive usability, evidence clarity and density against observed comparable flows (BE FORWARD import/landed-cost is genuinely observed in GLM; other external benchmark sites can be blocked). Never use competitor screenshots, unmeasured ranking or copyrighted imagery as CarUp product assets. Any landed-cost calculator needs authoritative data, currency/freight basis and limitations before being presented as an actual quote.

---
## 6. Product-integrity containment: independent mandatory corrective lane

**P0 = prioritization for investigation/containment, not a declaration of production compromise.** These findings are not merely UX debt. Owners of security, Trust, finance and domain services must certify actual impacts and safe patches; the UI programme must not silently repair backend policies as a side effect. Work is a **separate governed security/product-integrity PR sequence**.

| ID | Actual source/behavior (baseline) | Priority | Containment / permanent treatment | Gate / evidence |
|---|---|---|---|---|
| TI-01 | `web/src/pages/auth/Login.tsx`: **Quick Demo Access** and fixed seeded password are present in client source; production bundle inclusion **reported** by Opus. Valid credential in production **not tested** | **P0 investigate now** | Remove demo controls and literal from public build; verify deployed auth configuration/seeded accounts through authorized ops; rotate/remove demo credentials where present | Bundle scan; authorized server config review; no unauthorized account login |
| TI-02 | `DiasporaTrade.tsx` submits reviewer-supplied `verification_status: 'VERIFIED'`; `backend/services/diaspora/diasporaImportOrderService.js` persists it without demonstrated evidence gate | **P0 authority design** | Suspend unsupported positive-claim action or gate behind approved evidence requirement; server validates evidence/actor and duplicate VIN links; audit, independence and workflow tests | Evidence, identity, replays, reviewer authorization and conflict tests; Owner/Trust policy sign-off |
| TI-03 | `diasporaTradeProfileService.js` can default/rachet `trust_score` to ≥80 on verify; supplier score vocabulary risks confusion with vehicle Trust | **P1 truth semantics** | Withhold unsupported public score, propose explicit profile-reputation metric/method; do **not** conflate with canonical vehicle Trust; schema change separate gate | Methodology, data provenance and contract decision; no invented score |
| TI-04 | `web/src/pages/dashboard/mechanic/CustomerRecords.tsx`: hard-coded customers/spending, inert Add Customer | **P1** | Hide fake CRM or show truthful unavailable state; later wire real tenant-scoped CRM, if independently accepted | No fake identities or fabricated spend in production UI |
| TI-05 | `LegacyDealerDashboard.tsx`: permission switches mutate local state and claim success without persistence | **P1** | Remove/disable matrix and route users to canonical Dealer Staff; retain safe redirect/legacy gate until access parity | Reload, revoked-grant and 403 server tests |
| TI-06 | `AIMonitoring.tsx`, Owner Service History, literal sidebar counts: fixed operational numbers and “Next Service 500 km” | **P1** | Replace with real source and coverage or “not measured”; do not silently convert to zero | Runtime with no data and service failures |
| TI-07 | Legacy Vehicle Detail verification, PartSentry empty-ledger “Verified”, KYC selfie completion, governmental/financial endorsement wording | **P1** | Stop unsupported authority claims; use canonical evidence/ledger/identity status, or gate unavailable functionality | Negative-case, stale/unverified/conflict, actor and evidence tests |
| TI-08 | Trade OS “Mark Zimbabwe Ready” reportedly sends mismatched payload causing HTTP 400 (Opus source/local-mock) | **P1** | Correct client/server contract; respect actual ZIMBABWE_READY required-document gates | Positive/negative transition tests with real isolated API |
| TI-09 | `/diaspora/containers` source effect depends on API object/callback, local mock recorded 300–480 GET/s | **P1** | Reproduce in isolated real client/runtime; stabilize callback dependencies, cancellation, retry and request-rate backstop | Request-count and render-loop tests, no 5xx denial-of-service |
| TI-10 | `AuthContext` logout clears client session; server token revocation behavior not proven by UI sign-out | **P1 security review** | Implement audited token/session invalidation if required by deployed auth architecture; preserve guest draft; verify replay 401 | Authorized token-replay test in isolated runtime, session policy approval |
| TI-11 | Forgot/reset password CSRF/header mismatch; “sent” regardless of actual request; inert Remember Me | **P1/P2** | Independently verify endpoint CSRF policy, fix failed/neutral result and meaningful session preference; no enumeration | End-to-end recovery negative paths and security tests |
| TI-12 | Public pricing/trial copy claims commercial capability not actually live on `main`; unmerged payment PRs separate | **P1 commercial truth** | Hold CTA, explicitly label planned/test features until real commerce/product/entitlement authority certified | No fake subscription or live-money implication |
| TI-13 | Dealer leads, communications and SourceCoverage errors sometimes rendered as successful empty or “not yet checked” | **P1/P2** | Distinct loading/empty/error/not measured/not reviewed/forbidden states; correct read failure behavior | Rejection/timeout tests, assistive announcements |
| TI-14 | `/settings` destinations lead to chromeless 404; role switch advertises unavailable global role switching | **P1 navigation truth** | Provide real profile/organization management or honest boundary; switch verified contexts rather than global role | Real multi-membership testing; no dead destinations |

**Priority semantics:** D1 is a **public credential-exposure concern**, not proof of account compromise. D2 is a **persisted authority/evidence defect**, not “only a frontend badge.” D3 concerns a **trade-profile metric**, not the authoritative vehicle Trust score. Opus source findings about backend environments require ops inspection to determine live exposure. These distinctions are binding.

**Containment gate:** no launch-facing environment may knowingly expose ungoverned verification, fabricated material business metrics or success claims. Phase TI can run in parallel with research/design but must maintain independent PR, security and Owner authorization. A merged UI shell is not evidence these issues are solved.

### 6.1 Additional containment items (v0.9.1, from Opus IR01 evidence)

These are in the same format as §6. Evidence is source-level at `9f2bebfe` unless marked. Security-relevant items are stated at class level in this public document; file-level detail is held in the private IR01 evidence (Appendix H).

| ID | Actual source/behavior (baseline) | Priority | Containment / permanent treatment | Gate / evidence |
|---|---|---|---|---|
| TI-15 | **Native app entry and truth.** Guests are sent to `/login` on cold start, and Register and Biometric have no inbound navigation. `mobile/app/(auth)/login.tsx:160` renders the debug copy "VISIBLE LOGIN BUTTON BELOW", and a test requires it. The lock screen shows the internal codename (`mobile/providers/SecureSessionProvider.tsx:105`). The Garage tab reads a non-existent `cost` column, so service logs should throw. It shows "Ecosystem Trust" with no evaluation state (it can render "null%") and defaults logs to "Verified". Capture-quality badges and processing progress are fabricated. The intro claims CBZ escrow, loans and local encryption that no code implements | **P1** | Extract the reviewed `896ee73f` (§6.2). Remove the fabricated states and correct the copy. Change the test that requires debug copy | Device or simulator UAT; native tests in required CI |
| TI-16 | **Mutating requests without the CSRF header.** Native register, odometer OCR, escrow cancel/dispute and the offline evidence drain omit it, as does web password recovery (TI-11). Outside test environments these requests are refused, while the UI reports success ("saved for manual review") | **P2** (breakage; static finding) | Route every mutation through the CSRF-aware client and surface failures | Isolated runtime test |
| TI-17 | **PWA.** A service worker is registered (`web/src/main.tsx:23`, `web/public/sw.js`) but there is no web manifest, icons or `theme-color`, so the app is not installable. The offline banner promises "offline local sync mode", while the service worker returns 503 for API calls | **P3** | Add a manifest (the reviewed `607c52c7` holds one); make the offline copy honest | Installability check; offline test |
| TI-18 | **Trade OS continuity and truth.** The required-documents checklist can never show "Uploaded" (label mismatch). Merge `48db0dfe` silently dropped the I13 fixes that stopped failures showing as empty (shipment page, compliance queue), and the I13 receipt still claims them. The order page and shipment page draw contradictory progress for the same order. There are 4 local status arrays against 23 backend statuses, and 13 local role sets. RFQ orders are not linked to the import pages. Container reservations are created without `import_order_id`. Both passports are orphaned, with no inbound link. No UI creates the required government documents or advances the DUTY, REGISTRATION or INSURANCE stages | **P1/P2** | One backend lifecycle projection and the registry status vocabulary; restore the I13 behaviour; link the journey end to end; correct the receipt | Positive and negative transition tests; checklist tests; a journey that reaches ZIMBABWE_READY in an isolated environment |
| TI-19 | **Legacy portals without a tenant.** The web client sends `x-tenant-id` only from `user.active_tenant_id`, which only the inert role switcher sets. Legacy mechanic work orders and parts, and legacy dealer inventory, therefore always fail, and KPI tiles fall back to 0/$0. One legacy dealer path does not isolate tenant-less dealers, and reports mock success when its table is missing (class-level; details in private evidence) | **P1** (data isolation on a legacy path) | Retire the legacy paths behind redirects; the server rejects tenant-less writes; the context manifest supplies a verified tenant | Negative cross-tenant tests |
| TI-20 | **Role vocabulary and context dead ends.** `member` (the default platform role, kept by many canonical dealer owners) and `reviewer` are absent from the frontend `UserRole`, so `/dashboard` redirects to itself for them. The frontend maps `platform_admin`/`super_admin` to `admin` but governance does not, so admin pages may resolve to "disabled" after hydration (OPEN, OV-04). `409 MULTIPLE_DEALERS_REQUIRE_EXPLICIT_TENANT_SELECTION` has no client handler. A login bounce keeps only the pathname, losing the query | **P1** (navigation truth) | Fold into SessionWorkspaceManifest (§20); normalize role aliases in client and server; a context picker for the 409 | Real multi-membership UAT |
| TI-21 | **Institutional contradictions.** The bank page states that Trust is not a credit verdict, while LendingQueue shows a "Risk & Trust Index", offers states the backend rejects, and dereferences a `monthly_payment` that is null on new applications (suspected crash). The government approve action writes "Updated by ZIMRA OS" on a page that says "Not a national registry". Insurance shows "No claims recorded yet" beside seeded Claims rows and a literal "12" badge | **P1** | Correct the wording; hide seed-only views (OD-14); source allowed states from the server | Negative tests; Owner policy |
| TI-22 | **Review-independence coverage.** Independence and step-up are enforced server-side for the dealer programme and for trust-fact self-review. Several other review and decision types have no independence check (class-level; inventory in private evidence) | **P1** (governance) | Policy decision OD-16, then server enforcement before any UI claims independence | Security review |
| TI-23 | **Communications truth.** Analytics return 0 for unmeasured response time and conversion. The in-app delivery adapter always reports `delivered`. Channel toggles offer WhatsApp, SMS and Push whatever the runtime can deliver (DESIGN.md §16). Guests are offered WhatsApp and e-mail replies while production Communications is documented as inactive. Only owners and admins have inboxes. `createCommunicationThread` has no UI caller, yet "support chat" is promised | **P2** | Show channels by capability; use "not measured" states; give every workspace an inbox | Provider-state tests |
| TI-24 | **Dashboard "Sign Out" runs `localStorage.clear()`**, wiping favourites and the guest Sell draft | **P2** | Clear only session state | Draft-survival test |
| TI-25 | **Parts truth.** The consumer `/marketplace/parts` and `/marketplace/services` backends return empty arrays by design, so the card grid can never render. The PartSentry review API has no web caller. The owner page markets "Theft Tracking", which no feature supports. Seven PartSentry vocabularies are in use | **P2** | Present as an RFQ; one provenance-chip contract; remove unsupported marketing | Content tests |
| TI-26 | **Public content truth.** `/careers` lists salaried openings. `/api-docs` documents an API host and endpoints that do not exist as described. PressKit renders a second footer naming a different legal entity. A "104 private dealership research candidates" figure is fixed text | **P2/P3** | Content review; hide or correct | Content tests |
| TI-27 | **Failure presentation** (R-L). Vehicle Detail says a vehicle "doesn't exist or has been removed" when the server fails. The canonical dealer workspace says "operating access unavailable" during outages. Dashboards show zeros or "no wallet" while still loading. A reviewer who types `/admin` gets a blank page | **P2** | `DataState` kit (§3.5); route-level error boundaries | Forced 5xx, 403 and slow-response tests |

### 6.2 Existing off-`main` remediation candidates (v0.9.1)

Method: a pickaxe and ancestry search across every remote ref on 2026-11-10 (`git log --all -S…`, `git merge-base --is-ancestor`). A candidate is **not** an accepted fix. Every reuse follows the §9 custody procedure and receives an independent review.

| TI | Candidate | Commit subject (what it does) | Where it exists | Not present on | Treatment |
|---|---|---|---|---|---|
| TI-01 | `8949d570` (2026-10-06) | "fix(oc5r): remove runtime demo login identities and password" | #222, #235, #242, #254, the PR-less MVP-STAB branch, staging build `8353dbdd` | `main`, #244, production `78303ed6` | Reviewed cherry-pick in the TI lane. Confirm every client-side demo identity is gone; ops confirms server-side seeded accounts separately (OV-01, OD-17) |
| TI-10 | PR #226 (`5b603d45`, Draft) | "fix(auth): revoke current session on logout" (backend route + test) | Open PR | `main` | Security review; pair with a client sign-out that preserves drafts (TI-24) |
| TI-10 (native) | PR #227 (`1dd189b9`, Draft) | "fix(native auth): terminate session and isolate query cache" | Open PR (native stack) | `main` | Review with RX-07 |
| TI-04 | `cdc81ae8` (2026-10-05) | "feat(oc5d): P7 — the web Service Network surfaces, on the verified active garage" (data-backed customer surfaces) | Same lineage as TI-01 | `main` | HOLD per OD-12. Do not ship the static file in the meantime |
| TI-15 | `896ee73f` (2026-10-11) | "fix(native): PC01-J-R1 — the native app is UAT-able: guests browse, accounts can be created, garage actions reach the server" | Same lineage | `main` | Extract in RX-07 after review; re-check the truth items it does not cover |
| TI-17 | `607c52c7` (2026-10-11) | "feat(launch): lead Home with marketplace search and readable mobile discovery" (adds a web manifest) | Same lineage | `main` | Extract only the manifest part, after review |
| RX-07 | `6f054f7c` (2026-10-11) | "perf(web): separate public launch bundle and canonical document metadata" (route-level `lazy()`) | Same lineage; the staging build has 151 `lazy()` routes | `main` | Seed for the CI-08 bundle work |
| TI-09 | PR #130 (merged 2026-07-27) | Fixed the trade-profile request loop only | `main` | — | The `useCarUpApi()` aggregate is still unmemoized at `9f2bebfe`, and no branch fixes it, so a new fix is needed |
| TI-02, TI-06 ("500 km"), TI-08, TI-11, TI-14 | — | **No remediation exists on any remote branch** | — | — | New work in the TI lane |

"Same lineage" means:
- the OC-5R → Corporate → Garage 1.0 → payments chain: #222 → #229 → #231 → #235 → #238–#242 → #253 → #254;
- the PR-less MVP-STAB branch;
- the deployed staging build.

**Consequence: the staging environment is not `main`, and production is neither.** Staging already carries several of these fixes; production (`78303ed6`) carries none of them.

---

## 7. Functional preservation matrix: twelve business journeys

The **GLM 12-journey register is the baseline**, sharpened by Opus's route/component and runtime findings. For each migration the engineering PR must attach the concrete live endpoint list, authorization tests, before/after screenshots, persistence checks and exact-head CI. The examples below identify existing contracts, not necessarily complete service inventories.

| ID | Journey and protected business contract | Authority/data and tests to preserve | Safe cutover and stop condition |
|---|---|---|---|
| **FP-01** | Marketplace → filters/URL → listing → save/unsave → compare | `marketplaceParams` URL contract, listings/saved APIs, `saved_vehicles`, buyer separation, price+currency, image truth, max-compare | Swap card/shell presentation only. STOP if save, refetch, comparison, search-query or real availability changes |
| **FP-02** | Vehicle Detail → Passport, Trust, source coverage and evidence | Canonical Trust projection, freshness/version, immutable historical facts; plate/chassis privacy; `VehicleDetail` Trust and parity tests | Replace lower card-led layout in components; do not read cache columns as verified Trust or invent “CID passed”; STOP on provenance drift |
| **FP-03** | Guest Sell → auth → Seller draft/resume → authority claim → media → publish | `guestSellDraft`, IndexedDB/local drafts, `/vehicles/add`, `/seller-draft`, media scan, seller authority 409s, idempotency; SellFlow/SellerResume tests | Extract behavior unchanged before redesign. Keep draft/receipt continuity across login/refresh and failure; STOP on lost media/overwrite/false publication |
| **FP-04** | Personal My Garage → service history/vehicle context | `/vehicles/me`, service-history and PartsEntry/PartSentry, real current VIN and owner relationship; genuine intervals only | Replace cards/summary; retain vehicle context; STOP if static service predictions or cross-owner records appear |
| **FP-05** | Dealer research profile → claim → independent review → activation → owner workspace → stock/staff/branches/inquiries | Dealer authority service derives tenant; reviewer step-up and independence; approved image publication; staff/branch scope; Dealer #258 backend/browser tests | Recompose shell, **not grant logic**; keep legacy redirects until legitimate identities have parity; STOP on cross-tenant visibility or self-approval |
| **FP-06** | Mechanic work order → status → service/parts record | `/mechanic/work-orders`, parts and signed repair history, tenant restrictions, work-order state checks; existing mechanic suites | Only real workflow data. CustomerRecords mock quarantined. STOP on lost work-order transition or invented CRM |
| **FP-07** | Garage business operations: customer, workshop schedule/capacity | Current `main` functions separate from **unmerged #197/#239–241** Garage features, tenant membership, scheduling/capacity | HOLD unmerged operations until source-custody and independent domain acceptance; prototype shell with explicitly isolated fixtures; do not auto-merge Garage stack |
| **FP-08** | Trade RFQ → import order → quote → docs → customs/clearing → CAP/arrival | `diasporaImportOrderService`, import status transitions, source docs, stage events, event actor/voyage, privacy; 71 diaspora suites | Retain UUIDs/status semantics; do **not** accept client VERIFIED without evidence; do not assert live clearing/fees until authoritative |
| **FP-09** | SafeTrade and shipment: decisions, delivery, disputes, outbox | SafeTrade state machine, second-human review, self-approval refusal, non-custodial notices, disabled real-money paths | Keep sandbox/test mode and verbatim legally asserted notices; UI flip only; STOP if real payments become reachable |
| **FP-10** | Communications/notifications linked to vehicle, listing, order, job or review | Canonical thread/actor/transport/audit, queued→sent→delivered/failed; email/SMS/provider adapter boundaries | One conversation kit; failure ≠ empty, delivery receipt ≠ sent intent; don't activate unaccepted providers |
| **FP-11** | Institutional decisions: reviewer, bank, insurer, government, platform admin | Server evidence/auth/step-up, bank scopes, fraud/claims, approvals, audit, explicit sandbox/unavailable states | Shared visual frame only; restricted reviewer access remains independent; STOP on inaccurate approvals, fictitious insurance or consent leakage |
| **FP-12** | Native owner/buyer/verification navigation and PWA continuity | Expo manifest, feature governance, server auth, route boundary, back/gesture, actual native capabilities | Shared tokens/status semantics; retain NativeFeatureBoundary “not available on mobile” for unsupported workspaces; no parity claims without device UAT |

**Migration contract template (mandatory per route-family PR):**

```
Route(s) / role(s) / context(s):
Before SHA and after exact SHA:
Old route + shell + status (SOURCE / LIVE / UNMERGED):
New shell + page components:
Existing hooks / API endpoints / server authority / data records:
Known persistent state, errors, idempotency, transaction states:
Source tests + required new tests (real API, auth, negative, persistence):
Before-and-after screenshot IDs at 360, 390, 768, 1280, 1920:
Keyboard, reader, focus, touch and no-overflow evidence:
Unimplemented functionality kept HONEST / gated:
Rollback (route-family presentation only, no data rollback):
Owner UAT result PASS/FIX/HOLD:
Independent reviewer + CI run + approved exact SHA:
```

**No migration PASS without functioning workflow preservation.** Mocked API unit tests alone do not prove real auth, persistence or tenant separation. Server-side rules must never be ported into a `canView` React check and deleted from the backend.

---

## 8. Exact-source touchpoint decisions (priority migration register)

The following table is the **Moderator-controlled override and priority register**. The complete **289-entry GLM file-level baseline** is embedded in Appendix A for traceability. Where GLM and Opus disagree, the decision below prevails **for planning**, subject to code review at the execution SHA. The classification always distinguishes **business behavior to preserve** from **presentation to replace**.

### 8.1 Core shell, navigation and styling sources

| Source | Planning disposition | Preserve | Rebuild / correct | Wave |
|---|---|---|---|---|
| `web/src/App.tsx` | **CORRECT / RECOMPOSE** | Paths, redirects, feature boundaries, lazy review route, access constraints | Explicit route→shell registry; reparent operator routes; introduce lazy route families | RX-02 / RX-07 |
| `web/src/components/layout/MainLayout.tsx` | **REBUILD SHELL** | Registry boundary, outlet, public session behavior | New PublicShell; remove private operating pages and wrong footer/bottom tab behavior | RX-02 |
| `web/src/components/layout/Navbar.tsx` | **REBUILD PRESENTATION** | Manifest and real search/role account actions | Common masthead, one logo, context switch, accessible menus | RX-02 |
| `web/src/components/layout/Footer.tsx` | **EXTRACT / REBUILD** | Governed footer links and legal destinations | Public-only responsive accordion/compact editorial footer | RX-02 |
| `web/src/components/layout/CompactBottomNav.tsx` | **CORRECT / REBUILD** | Touch-safe mobile navigation intent | Retire hard-coded `ROLE_HOME`, manifest-derived contextual tabs, safe area | RX-02 |
| `web/src/components/layout/MobileNavDrawer.tsx` | **EXTRACT / REBUILD** | Feature-backed groupings, keyboard access | Context-aware drawer, `inert` when closed, proper focus restoration | RX-02 |
| `web/src/components/layout/DashboardLayout.tsx` | **REPLACE PRESENTATION, PRESERVE GUARDS** | Role/route boundary and authentication behavior | Workspace family; remove generic 256px sidebar/stat identity and fake count badges | RX-02→06 |
| `web/src/config/featureRegistry.ts` | **KEEP / EXTEND** | Real lifecycle, guard selectors, product catalogue | Add membership/context resolution, retire duplicate UI destination logic; do not corrupt role gates | RX-02 |
| `web/src/config/navigationManifest.ts` | **KEEP / EXTEND** | Navigation tree and source truth | Single destination renderer for navbar/footer/drawer/bottom/workspaces | RX-02 |
| `web/src/index.css` | **REPLACE TOKEN LAYER** | Brand identity semantics and reduced-motion requirements | Remove unused `.glass-card`/`.glass-dark`; distinct neutral hover vs action accents; shared CSS vars | RX-02 |
| `web/tailwind.config.js`, `web/components.json` | **CORRECT FOUNDATIONS** | Tailwind and Radix compatibility | Resolve syntax-version mismatch, semantic variants and derived theme | RX-02 |
| `web/src/components/ui/button.tsx`, `card.tsx` | **RETHEME / EXTRACT** | Accessible Radix/shadcn control behavior | CarUp button/field/panel variants; no default `card-shadow`/universal rounded panel | RX-02 |
| `web/src/components/seller/SellerWorkspaceHeader.tsx` | **EXTRACT** | Working Seller context and existing back link | Generalize breadcrumb/object/status/primary action into shared header | RX-02→04 |
| `web/src/components/dealer/DealerCanonicalWorkspaceLayout.tsx` | **PRESERVE AUTHORITY / REPLACE CHROME** | Real tenant/approved-owner context and error gating | Remove blue underline navigation and isolated header; use WorkspaceShell(dealer) | RX-03→05 |
| `web/src/components/dealer/DealerReviewerLayout.tsx` | **PRESERVE AUTHORITY / REPLACE CHROME** | Independent reviewer, password step-up and privacy | Review workbench on shared chrome, retaining separate boundary | RX-03→06 |
| `web/src/components/dealer/LegacyDealerRouteGate.tsx` | **TEMPORARY KEEP; CONDITIONAL RETIRE** | Compatibility, redirects and role/tenant checks | Retire only after all eligible and ineligible legacy users have a safe path | RX-08 |

**High-risk correction to GLM classification:** A primary **KEEP** classification for either Dealer layout means **keep its authorization behavior**, not keep its blue/gray styling. A primary **RETIRE** classification for `LegacyDealerRouteGate` is a **future gate**, not authorization to delete it now. Any PR that removes behavior-bearing shell checks fails.

### 8.2 Buyer, Owner, Seller and Trust

| Exact source | Decision | Functional preservation and design requirement | Wave |
|---|---|---|---|
| `web/src/pages/Landing.tsx`, `Marketplace.tsx`, `VehicleSearch.tsx` | **KEEP reference / REFINE** | Media and search URL state, truthful list, vehicle context, compact mobile first fold | RX-03→04 |
| `web/src/components/marketplace/MarketplaceListingCard.tsx` | **EXTRACT reference** | One vehicle-card visual/data contract across discovery, saved, Seller preview; currency and source semantics | RX-02→04 |
| `web/src/pages/VehicleDetail.tsx` | **KEEP upper showroom / REBUILD lower** | Single identity, canonical Trust, report/evidence provenance, no legacy “Verified” shortcuts or repeated CTAs; compositional replacement | RX-04 |
| `web/src/pages/MarketplaceCompare.tsx`, `MarketplaceCategoryPage.tsx` | **CORRECT / REFINE** | Honest errors/empty; persisted compare and real price/currency; parts/services bridge | RX-04 |
| `web/src/pages/GuestSell.tsx`, `web/src/pages/dashboard/owner/SellVehicle.tsx` | **REBUILD PRESENTATION, PRESERVE LOGIC** | One responsive Focused Sell experience, same draft, media, claims and resume; test 409/duplicate flows | RX-04 |
| `web/src/pages/dashboard/owner/OwnerDashboard.tsx` | **REBUILD** | Vehicle/action-first personal Today; remove generic stats, fake measurements | RX-04 |
| `web/src/pages/dashboard/owner/MyGarage.tsx` | **KEEP / EXTRACT** | Image-led editorial personal vehicle story; fix currency, deep links and context | RX-04 |
| `web/src/pages/dashboard/owner/MyListings.tsx`, `SavedCars.tsx`, `SellerIntelligence.tsx` | **ADAPT** | Action priority, genuine metrics, conversation linking, saved/compare; responsive compactness | RX-04 |
| `web/src/pages/dashboard/owner/VehicleProfile.tsx`, `ServiceHistory.tsx` | **REBUILD / CORRECT** | One Passport lens, no “500 km”/invented currency, source-backed service detail | RX-04 |
| `web/src/pages/dashboard/owner/InsuranceRecords.tsx` | **HOLD / HONEST BOUNDARY** | Cannot claim policy data/renewal until API/authority exists | RX-06 |
| `web/src/pages/dashboard/owner/PartSentry.tsx`, `AIDashboard.tsx` | **CORRECT / REBUILD** | Evidence ledger semantics and usable AI context, no empty “Ledger Verified” | RX-04 |
| `web/src/pages/Pricing.tsx` | **HOLD COMMERCIAL CLAIMS** | Actual finance/payment entitlement gates; only truthful planned/sandbox notice | TI / RX-04 |

### 8.3 Dealership, Service Network, Garage and Mechanics

| Exact source | Decision | Functional preservation and design requirement | Wave |
|---|---|---|---|
| `web/src/pages/DealerDirectory.tsx`, `DealerResearchProfile.tsx` | **KEEP data / REBUILD presentation** | Public discovery and media, claimed vs verified branch details, real no-rating state | RX-05 |
| `web/src/pages/dashboard/dealer/DealerDashboard.tsx` | **REBUILD COMPOSITION** | Dealer Today queue, branch/workspace identity, real counts only, link to canonical stock/actions | RX-05 |
| `web/src/pages/DealerOperatingDetails.tsx` and dealer staff/stock/inquiry pages | **RE-PARENT / REBUILD** | Full Dealer workflow must stay in authenticated Workspace, not public footer | RX-05 |
| `web/src/pages/dashboard/dealer/LegacyDealerDashboard.tsx` | **RESTRICT / RETIRE** | No fake permission persistence or fixed branch switch; preserve safe access until cutover | TI / RX-08 |
| `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx`, `WorkOrders.tsx` | **REBUILD WORKBENCH** | Real jobs, status transitions, queue, vehicle identity; no colored-stat-card focus | RX-06 |
| `web/src/pages/dashboard/mechanic/ServiceLogs.tsx`, `PartsTracking.tsx` | **REBUILD** | Real service and parts record, source/evidence, useful mobile list/detail | RX-06 |
| `web/src/pages/dashboard/mechanic/CustomerRecords.tsx` | **HOLD / CORRECT NOW** | Static fabricated CRM cannot ship as real | TI / RX-06 |
| `web/src/pages/GarageDirectory.tsx` | **ADAPT** | Public directory with honest empty/verification states | RX-06 |
| `web/src/pages/dashboard/owner/MyGarage.tsx` | **KEEP DISTINCT** | Personal My Garage is **not** the commercial Garage OS | RX-04 |
| Garage/Service UI in open PRs #197, #239–241 | **HOLD / EXTRACT ON ACCEPTANCE** | Real tenant, scheduling, capacity, staff and customer operations; no accidental branch merge | Custody / RX-06 |

### 8.4 Diaspora, Trade, Logistics, Communications and Institutions

| Exact source | Decision | Functional preservation and design requirement | Wave |
|---|---|---|---|
| `web/src/pages/diaspora/DiasporaTrade.tsx` | **EXTRACT / RECOMPOSE** | ~1,689-line multi-route functional module; use behavior-preserving moves before lazy split | RX-06 |
| `DiasporaStockManager.tsx`, `DiasporaReverseRfq.tsx`, `DiasporaContainerMarketplace.tsx` under `web/src/pages/diaspora/` | **REBUILD PRESENTATION** | Real stock/RFQ/container operations; no request storms or fake quotes | RX-06 |
| `DiasporaWorkbookDryRun.tsx`, `DiasporaWorkbookOperatorConsole.tsx` | **REBUILD WORKBENCH** | Explicit validations, import previews, errors and audit statuses | RX-06 |
| `DiasporaSafeTrade.tsx`, `DiasporaSafeTradeDetail.tsx`, `DiasporaOrderPassport.tsx` | **KEEP STATE / EXTRACT VISUAL PRIMITIVES** | State machines, non-custodial notices, timeline/events and approval authority | RX-06 |
| TradeOSWorkspaceLayout from open PR #207 and WorkspaceChrome from #244 | **CANDIDATE EXTRACT ONLY** | Respect latest `main` routes and grants; no dark local design-system fork | RX-02 / RX-06 |
| `web/src/pages/dashboard/owner/Communications.tsx`, `web/src/pages/dashboard/admin/Communications.tsx` | **REBUILD CHROME / EXTRACT CONVERSATION KIT** | Messages, provider delivery state, actor/object links, admin audit | RX-06 |
| `web/src/pages/dashboard/bank/*`, `.../insurance/*`, `.../government/*`, `.../admin/*` | **REBUILD INSTITUTIONAL WORKBENCH** | Real queues and clear sandbox/unavailable states; no role rainbow palette or seed metrics | RX-06 |
| Dealer reviewer benches and `IdentityVerificationCaseManagement` | **PRESERVE REVIEW AUTHORITY / REBUILD UI** | Independent split evidence/decision/audit; required reason/step-up; no public chrome | RX-05→06 |
| `web/src/pages/auth/Login.tsx`, `Register.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `KYCVerification.tsx` | **REBUILD FOCUSED / CORRECT SECURITY** | CSRF, no credentials in public bundle, real login/recovery, truthful KYC, safe drafts | TI / RX-04 |
| Expo `mobile/app/**`, `mobile/navigation/**`, native theme | **RETOKEN / REBUILD SUPPORTED SCREENS** | Keep native gates and actual capability coverage; do not copy React web layout or invent native Trade/Dealer | RX-07 |

**All scope dispositions are *planning intentions*.** No compiler/source deletion, redirect or CI waiver is allowed solely because a file appears in this table. See Appendix A for the 289 exact GLM baseline paths and Appendix B for operational verification at cutover.

---
## 9. PR/source custody and integration rules

**At audit:** `main` source = `9f2bebfe`; 53 open PRs were independently counted in GitHub search at the research date. Do not confuse older GLM-selected PR tips/base SHAs with live GitHub PR heads. **Exact tip and merge-base must be fetched again immediately before any extraction.** No source line from an open branch is automatically accepted product functionality.

| Source / branch lineage | Research significance | Custody treatment | Integration prohibition |
|---|---|---|---|
| [#181](https://github.com/kudzimusar/carup/pull/181) — design plan | Historical Precision Automotive Commerce identity | Read/ratify useful policy text; `DESIGN.md` on main remains governing | Do not replace the current master plan with old rollout sequencing |
| [#197](https://github.com/kudzimusar/carup/pull/197) — Service Network | New garage/service routes and layout work | Compare with #221+ port and Garage OPS; extract accepted components/services selectively | No complete branch merge to obtain UI |
| [#207](https://github.com/kudzimusar/carup/pull/207) → [#243](https://github.com/kudzimusar/carup/pull/243) → [#244](https://github.com/kudzimusar/carup/pull/244) | Trade OS, CAP Journey, cross-workspace bars and UI primitives | Preferred **candidate lineage for review**, not accepted custody automatically; preserve CAP events/documents | Do not transplant its `App.tsx`/role checks over merged Dealer 1.0 |
| [#208](https://github.com/kudzimusar/carup/pull/208), #214/#215 | O2 onboarding, stale Trade alternates | Compare accepted contracts and authorizations; classify superseded/unique | No parallel Trade navigation kit |
| [#220](https://github.com/kudzimusar/carup/pull/220) / #221–#222 | Historical One CarUp/Corporate integration candidates | Extract reviewed ideas, truth-state language and org switcher; rebuild on latest main | No wholesale One CarUp merge; old branches lack recent Dealer URLs |
| [#239](https://github.com/kudzimusar/carup/pull/239) → [#240](https://github.com/kudzimusar/carup/pull/240) → [#241](https://github.com/kudzimusar/carup/pull/241) and OPS04 | Garage operations, customers, scheduling/capacity | Owner/domain specialist must certify source head and business/schema dependencies separately; then present new UI on canonical Workspace | Never activate Garage branches through a styling PR |
| [#258](https://github.com/kudzimusar/carup/pull/258) | **Merged** dealership authority and functionality | Freeze as behavioral regression baseline, not design reference for every layout | Do not reverse merge or weaken approved claim/review controls |
| Stripe/Paynow and other payment PRs | Possible UI in separate commercial stacks | Keep flags, entitlements, provider test/prod isolation; coordinate future product displays | **No live money, commercial activation or billing claim** by UI merge |
| Corporate/Native PR-less candidate branches (Opus Appendix J) | Unmerged visual/navigation enhancements | Require an authorized, reviewable PR and exact provenance if used | No copying from unmanaged user-machine branches |

**Custody procedure for every reused candidate:** (1) record exact head, branch base and ancestry; (2) state whether accepted tests exist; (3) identify unique, duplicated and main-conflicting files; (4) extract **small, identifiable** functional or visual units into a fresh branch cut from *current* main; (5) show a per-file change list and negative tests; (6) independent PR review; (7) verify final `main` after merge. Never conflate extraction of UI with acceptance of unmerged backend/DDL.

### 9.1 Programme branch policy

- New work branches start from verified latest main. **No stacked unbounded chains**, hidden local worktrees or unexplained re-authoring of history.
- Shared files (`App.tsx`, global CSS, theme/Tailwind config, `components/ui`, shell components, navigation manifest/registry, workspace context, status/Trust kits) have **one presentation-lane owner**; use CODEOWNERS and required review.
- Service/domain teams can continue data/API engineering under separate custody; they must consume published shell and token contracts, never make their own primary app header/footer/sidebar.
- Accept **only** the scope of a PR; CI approval for a feature does not certify the full platform, third-party integrations or an environment's deployment.
- Any local `carup_branches/` untracked directory noted by Opus must be inventoried for credentials and **excluded from Git**; no blanket `git add .` while its safety is unconfirmed. Do not delete an Owner directory without permission.

---

## 10. Proposed phased execution and PR plan

This plan is **entry/exit gated**, not an unconditional sequence of changes. IDs are proposed work packages, **not pre-existing GitHub PR numbers**. The same exact-source implementation may be split into smaller PRs if doing so improves review; never combine unrelated security fixes with a large design diff. Parallelism is allowed only with non-overlapping shared-file ownership.

| Package | Scope and entry condition | Primary deliverables | Exit / independent gate |
|---|---|---|---|
| **TI-00 — Product integrity** (independent critical lane) | Owner authorizes bounded investigation/containment; any time | TI-01–TI-14 verified/contained; no unapproved positive verification, demo credentials or fake operational claims; deployment-auth configuration read-only check | Security/Truth reviewer, real negative tests, exact-head CI; specific Owner policies for D2/payment wording |
| **RX-00 — Evidence and custody lock** | Owner approves planning baseline | Versioned route AST dump, 289-path disposition baseline, GLM/Opus conflict register, PR exact heads, 12 functional journeys, environment identity | No unresolved “who owns this route/shell/authority” among **pilot** routes; Owner approves extraction strategy |
| **RX-01 — High-fidelity experience and ADR** | RX-00; existing `DESIGN.md` authoritative | Three grammars, tokens, real component interactions, UX-REF-01–10 initial references, shell/context ADRs, public/mobile footer, brand proof | Owner PASS/FIX/HOLD at reference widths; selected visual direction recorded; no automatic runtime change |
| **RX-02 — Foundation and governance** | RX-01 signed; security/technical review of context proposal | Shared token source (web/native adapters), corrected Tailwind/shadcn variants, status and money/Trust kits, Public/Workspace/Focused chrome, manifest renderers, route ownership registry, initial CODEOWNERS, enforceable CI | Shell prototypes tested with **actual APIs/roles** in isolated staging as authorized; axe/contrast/keyboard/rollback; no downgrade of current guards |
| **RX-03 — Cross-shell reference pilot** | RX-02 accepted; isolated runtime and test identities available | One connected public→personal→dealer→independent review experience, and main-backed Trade subjourney; side-by-side 5 viewport evidence | First **visibly unified** MVP slice. Owner visual PASS + functional/tenant/step-up negative UAT + exact-head CI; no production release |
| **RX-04 — Consumer/owner/seller and auth** | RX-03; Seller continuity baseline frozen | Marketplace/Vehicle Detail lower sections, Seller single studio, Owner Today/Garage, saved/compare, Passport/Trust, auth and account context | URL/search, guest draft/auth handoff, media, 409, idempotent publish, Trust/version, no fake currency; Owner UAT |
| **RX-05 — Dealer/reviewer migration** | RX-03; Dealer #258 tests baseline | All canonical Dealer workflows under consistent Workspace; public profile separate; reviewer independently isolated; legacy redirect plan | Approved-claim/branch/staff/stock/media/revocation tests; 390–1920; no marketing footer on dealer operations |
| **RX-06 — Trade, Garage, Service, communications and institutions** | RX-00 explicit source custody for each unmerged domain; RX-02; TI verification policy | Trade/import/Logistics, real Garage/Mechanic, Service Network, communications, insurance/finance/government/admin evidence and workflow workbenches | Real transaction/status/authority preservation; no unmerged backend activation; governed unavailable state for unsupported domains |
| **RX-07 — Native, PWA and performance** | RX-02 token/manifest contract; native harness available | Native design semantics and supported navigation; route-level lazy imports, image/font loading, PWA metadata/offline truth | Native device/emulator tests, PWA installability where approved, budget and Core Web Vitals measurement; no false feature parity |
| **RX-08 — Legacy retirement and hardening** | All migrating route families accepted; legacy eligibility audit | Remove dead UI, independent local kits and obsolete nav; preserve redirects; forbid deprecated styling on new code | No unintended old UI reachable; no dead routes, orphan auth boundary or false nav; visual CI/ownership established |
| **RX-09 — Programme certification/release decision** | All required phase exits; deployment authority separately available | Final multi-role UAT, accessibility, performance and security evidence register; exact-head branch/CI and release recommendation | Independent review + explicit Owner merge/deployment decisions; no implied live payment or migrations |

### 10.1 Dependency map and parallel rules

```text
TI-00 truth/security containment ───────────────────────────────► release gate
RX-00 source custody ──► RX-01 visual ADR ──► RX-02 foundation ──► RX-03 pilot
                                                  ├────► RX-04 consumer/seller
                                                  ├────► RX-05 dealer/review
                                                  ├────► RX-06 trade/garage/institutional (also needs source custody)
                                                  └────► RX-07 native/performance
                                   RX-04 + RX-05 + RX-06 + RX-07 ──► RX-08 ──► RX-09
```

- TI-00 may operate in parallel with Owner design review but can block unsafe reference screens and all launch authority.
- **The context-manifest security contract** is required before migrating authenticated shells. Workspaces must not wait for wholesale merger of unrelated domains.
- Trade/Garage unmerged functionality stays independently gated; the new shell may be demonstrated on currently merged routes/isolated approved fixtures without claiming feature integration.
- Consumer, dealer and institutional page compositions may proceed concurrently **after** shared shell/tokens freeze if they avoid shared-file conflicts.
- RX-07 performance code splitting can begin after initial shell correctness, but chunk boundaries must not break feature gates or session behavior.

### 10.2 First engineering milestone: measurable and visible

**RX-03 must be more than “we built tokens.”** Deliver an Owner-demonstrable set showing: (a) public Home/Marketplace → real Vehicle Detail; (b) login → My CarUp → vehicle; (c) canonical Dealer dashboard → stock → inquiries; (d) independent reviewer route; (e) existing Trade import-order view if main-backed. The same CarUp brand and context grammar must remain visible; public and workspace footers must each follow their explicit policy. Real API data and separate authorized identities are required for final pilot certification.

**Stop/rework triggers:** a private route renders under public chrome; incorrect organization appears; password step-up disappears; `returnTo` loses path/query; saved state changes; Seller draft/media is lost; production billing or real-dealer publication is inadvertently enabled; a button falsely claims verification/approval; reference screens are not approved by Owner.

### 10.3 Change sequencing and rollback

- Introduce shell variants **behind route-family-specific presentation flags**, separately from existing domain feature flags. A visual fallback must not grant access to a former role or bypass backend restrictions.
- Before swapping a route, record route, old and new providers/guards, exported hooks, object IDs, focus control and tests.
- Preserve old URLs using explicit compatibility redirects; retain query strings, browser history and meaningful return paths. Do not create a central redirect that erases the selected VIN/organization/order.
- Roll back **presentation flags and page composition** only. No reversal of committed transaction, reviewer audit, schema migration, approved dealer state or real-world payment is permitted by a UI rollback.
- Each PR posts an exact-head evidence bundle: changed paths, source ancestry, CI job IDs, Owner UAT screenshots, pass/fix/hold, reviewer approval, merge gate and post-merge source verification.

---

## 11. Engineering enforcement: the missing product quality gates

Opus reports that the **required** main ruleset checks omit web unit, Playwright, axe and actual visual assertions even where non-required workflows exist. Correct this **through governed CI changes**; do not bypass current checks. Introduce as advisory/baseline first for legacy debt, but **make new presentation work fail** when it introduces a regression. After migration, ratchet gates to all active routes.

| Gate | Automated contract | Minimum acceptance |
|---|---|---|
| **CI-01 Source and PR custody** | Base on latest main, changed-file collision detection, branch provenance/lockfile scan, exact SHA | No unauthorized shared-file edits or PR-less imports |
| **CI-02 Route ownership** | AST-generated route table vs declared shell map; no protected business route inside PublicShell | 100% active paths classified, redirects deliberate, no 404 for settings/account |
| **CI-03 Nav and context parity** | One manifest/registry projection feeds desktop, mobile, footer, rail and native where supported; verified membership cases | Deep links, multi-tenant switch, correct active nav, no duplicate orphan maps |
| **CI-04 Design tokens and styling** | ESLint/style rules for changed lines; approved semantic tokens, no new `.glass-*`, unapproved backdrop blur/glow, generic card fleets, hard-coded role hue | Zero newly introduced violations; exceptions documented and independently reviewed |
| **CI-05 Visual regression** | Screenshot assertions for accepted reference routes at 360/390/768/1280/1920, responsive/scrolling/focus | Material diffs reviewed; no “screenshot exists” pseudo-test |
| **CI-06 Accessibility** | axe WCAG A/AA + keyboard traps, skip link, focus/inert, target size, announcements, reduced motion and contrast | 0 critical/serious; AA target; no hidden-focus or bottom-nav collision |
| **CI-07 Behavioral/Trust parity** | Real API contract tests, state-machine negative tests, canonical Trust/verdict, price/currency, Seller save/claim, Dealer authority, communications, reviewer | 100% accepted journey invariants pass; no fake values or unjustified success |
| **CI-08 Performance** | Route chunk/bundle budget and repeatable lab tests; report script/asset sizes; avoid all-pages initial JS | **Candidate** initial JS ≤200 KB gzip, subject to measured Owner acceptance; publish actual achieved budgets, no fabricated RUM |
| **CI-09 Security, data and release** | Secrets scan, client credential scan, permission/tenant refusal, step-up, provider/feature flags, migration/deploy isolation | Existing required checks green; negative auth and truth guards green; no release inferred from CI |

**Technical implementation details:** Compiled Tailwind CSS must be inspected for unsupported v4 shorthand under v3 before style migration. Neutral skeleton/background tones must not inherit CarUp orange action color. A route-level React error boundary should prevent one malformed API response from blanking an entire app. Route-level `lazy()` must not trigger duplicate fetch/session boot, remount errors or extra unscoped API calls. Verify request-storm reproduction at source and network layers.

### 11.1 Performance and network budgets (proposed, not proven rollout results)

- Reference mobile profile: **360×800 Chrome Android**, throttled at **200–300 ms RTT**; measure on actual supported devices too.
- Propose initial executable JS **≤200 KB gzip**, measured from a standard production Vite build with a versioned configuration; Opus's ~179 KB experiment indicates feasibility, not guaranteed production performance.
- LCP lab target **≤2.5 s** on a documented representative page/network when achievable; measure CLS/INP or interaction latency and compare with current baseline. Do not claim RUM p75 from synthetic snapshots.
- Self-host a reduced-font weight set, responsive images (`srcset`/`sizes`), avoid hidden giant panels, prefetch conservatively, limit mobile above-the-fold UI and expensive scripts.
- A zero/offline/error/slow-network state must remain truthful and useful, especially for imports, Marketplace and claim workflows.

---

## 12. Owner, independent reviewer and UAT certification

### 12.1 Mandatory evidence levels

1. **Source review (S):** route/import/authorization and state preservation; no claim about rendered quality.
2. **Local mock (R-L):** visual geometry, keyboard, a11y and performance hypotheses only; no authenticated business certification.
3. **Real isolated staging (R-S):** real backend/DB, separate role/membership identities, populated controlled fixtures, allowed test payments only; requires explicit environment permission.
4. **Owner UAT (O):** physical review of reference composition and key flows with PASS/FIX/HOLD, at 360/390/768/1280/1920.
5. **Independent certification (I):** third-party exact-head source/security/functionality review plus real reproducible CI and post-merge evidence.
6. **Release authority (L):** **separate explicit Owner decision**, environment safety, secrets/DB/provider controls, no automatic activation.

A route does not become “certified” when its screenshot renders. The 24 GLM authenticated UAT cases (6 journeys × 4 widths) remain **OPEN** until executed against an authorized isolated runtime.

### 12.2 Cross-product UAT matrix (minimum; expand after reference design)

| UAT group | Journey | Core assertions / evidence | Minimum roles |
|---|---|---|---|
| U01 | Public Home → Marketplace → Vehicle Detail → Save/Compare | One public header/footer across widths, no invented currency/score, saved state persists | Guest, buyer |
| U02 | Guest Sell → Register/Login → Seller Studio → Publish/Resume | Focused navigation, draft+media persisted across auth, 409s preserved, one main CTA per step | Guest, owner/seller |
| U03 | My CarUp → My Garage → Vehicle Passport → Service | Correct owner identity and evidence, no fictitious service interval, mobile focus | Owner |
| U04 | Dealer profile → Claim → Reviewer → Dealer Dashboard | Privacy of pending documents, independent review, correct approval and public-media transition | Public, dealer claimant, separate reviewer |
| U05 | Dealer Dashboard → Stock → Inquiries → Staff/Branches | One workspace chrome, tenant/branch context, changes persist, no legacy matrix or marketing footer | Dealer owner, staff/other tenant |
| U06 | Mechanic/Garage → Job → Parts → Schedule → Service record | Real jobs and permissions, compact table→mobile list, no fake CRM; unmerged operations flagged HOLD | Mechanic, garage manager |
| U07 | Trade RFQ → Import → Documents → Shipment/CAP | Real import state and allowed actor; status steps and timeline; no false VERIFIED or real-money activation | Trade buyer/operator/reviewer |
| U08 | Reviewer Case → Evidence → Decision → Audit | Step-up and independence, forbidden negative paths, no “success” without mutation | Distinct reviewers, unauthorized user |
| U09 | Communications on Vehicle/Job/Order | Object context and provider state, failure vs empty, message threading/replay | Buyer, operator, admin |
| U10 | Bank/Insurance/Government operations | No fake policies/approvals; approved data scopes and meaningful unavailable/sandbox states | Appropriate each-role account |
| U11 | Mobile web/PWA all shells | 360/390, 768, safe area, drawer keyboard/focus, bottom tabs, accessible touch targets | Guest, owner, dealer |
| U12 | Native supported journeys | Device/OS back, intent, session, manifest/status parity; unsupported roles blocked honestly | Native user |

Every UAT group shall report **scenario IDs, environment/build SHA, role/tenant identities, input fixtures, expected/actual backend outcomes, screenshots and videos where allowed, defects and re-test outcome**. Negative-path tests are required for permission denial, stale data, missing backend, empty data, failed upload, duplicate work, cross-tenant access, expired review ticket and offline conditions.

### 12.3 Visual Owner gate — concrete acceptance questions

At each reference review, the Owner must be able to answer **yes** to all of these:

- Does it immediately look like the approved CarUp identity—not a generic dashboard template or competing microsite?
- Is the above-the-fold content focused on the actual vehicle, transaction or next action, rather than decorative cards?
- Are typography, spacing, alignment, controls, context bar, brand, footer and mobile navigation consistent with adjacent routes?
- Is the operator view genuinely **compact**, but usable without horizontal overflow/hidden actions at 390px?
- Does every status communicate its data source, confidence/freshness and next step truthfully?
- Can I perform real representative actions and return without losing my selected item/context?
- Can I tell what is pending, not yet verified, disabled, test-only or unavailable without being misled?
- Do the empty, error, loading, permission-denied and partial-data designs look intentional and remain accessible?

**Pass rule:** An Owner “looks good” is not enough; record named PASS/FIX/HOLD against each exact design reference and the functional preservation matrix. **FIX** blocks promotion of the affected family. **HOLD** requires explicit approved reason and user-visible truthful treatment.

### 12.4 Independent review and merge checklist

For every candidate: exact head unchanged since Owner UAT; author and independent reviewer distinct; required CI green; nonrequired failures classified with evidence rather than bypassed; screenshot and functional logs tied to SHA; no authority or tenant boundary removed; security/finance approval if domain relevant; PR ready rather than draft; Owner **merge-only** authorization separate; verify merge commit, source tree and new `main` CI; deployment remains separately gated.

---

## 13. Risk register and controls

| Risk | Impact | Mitigation / trigger |
|---|---|---|
| Large UI rewrite mutates business logic | Seller drafts, Trust, claims, import/finance states break | Extract behavior unchanged, cover contract/negative tests, route-family flags; STOP on delta |
| New shell drops route/access checks | Privilege escalation, cross-tenant reads, data leaks | Move guard policies intact; back-end refusal matrix; independent review before removing old layouts |
| Context manifest becomes security authority | UI selection turns into unauthorized grant | Server derives context, endpoints still enforce independent object/domain permissions |
| Stale stacked PR merged for a visual component | Erases newer Dealer features, conflicts with source custody | Current-main extraction only; no whole-branch merges |
| Accidental production/deployment from merged code | Old/new build confusion, unsupported features live | Deployment provenance, authorized preview only; release-only workflow gates |
| Product marketing misstates certification, rates or payments | Regulatory/commercial trust harm | Truth-first states and gate; no claims without data/provider authority |
| Over-compact UI harms accessibility | Small buttons/readability, invisible keyboard focus | ≥44px touch target candidates, responsive mobile list-detail, WCAG AA checks |
| Design tokens not truly enforced | Local variants proliferate again | CI changed-file gate and CODEOWNERS, accepted component catalogue |
| False confidence from mock screenshots | Owner tests beautiful but nonfunctional screens | Mandatory real isolated authenticated UAT |
| Bundle/code split causes duplicate calls | Request storms, session resets, inconsistent data | Network baseline, effect-dependency tests, lazy loading/focus/history regression |
| Legacy route immediately deleted | Valid user stranded; bypass created by fallback | Eligibility census, redirect/gate compatibility, explicit sunset checks |
| Native visually copies web but lacks features | False mobile product parity | Native capability registry; honest unavailable state; device QA |
| Untracked repo worktree folders committed | Credential/PII leak and huge artifact pollution | Explicit gitignore and staged diff inspection; never blind `git add .` |

---

## 14. Progress, governance, source control and change procedure

### 14.1 Programme control fields (update through implementation)

| Field | Initial value |
|---|---|
| Governing programme | `CARUP-UX-REBUILD-01` |
| Master-plan status | **PROPOSED — OWNER APPROVAL CANDIDATE** |
| Baseline | `main@9f2bebfe66a19e4d90c44085a3166562d2176626` |
| Approved visual reference IDs | **NONE** — proposed UX-REF-01–10, awaiting actual design and Owner PASS |
| Engineering authorization | **NONE from this document** |
| Live/staging deployment authority | **NONE** |
| Shared/production migrations | **NONE** |
| Real payments / dealer publication | **NONE** |
| GLM 24 authenticated UAT checks | **OPEN** |
| Opus native runtime certification | **NOT RUN** |
| Independent final release certification | **NOT STARTED** |

### 14.2 Ownership model

- **Owner:** approves actual visual identity references, contextual navigation defaults, branch/domain custody, material commercial wording and release/merge-only gates.
- **Programme Moderator:** holds custody, validates claims independently, issues ACCEPT/REMEDIATE/BLOCK for each specialist return, records exact-head tests and Owner decisions, prevents scope drift.
- **Presentation architect/design lead:** owns design tokens, component catalogue, shells, navigation presentation, core UX references, source CODEOWNERS and design CI.
- **Backend/security/domain leads:** retain API/authorization and data-policy ownership; certify source preservation and sandbox separation.
- **Independent reviewer:** validates exact-head changes, anti-privilege regressions, accessibility and UAT evidence; does not self-certify.
- **Owner UAT:** physically tests the accepted source on approved environments with real controlled data and records decisions.

### 14.3 Master-plan versioning

- A change to the *target architecture, design principles, shell taxonomy, functional authority or release policy* requires `MP01` revision, Owner/Moderator decision, reason, changed lines and new acceptance impact.
- A new approved domain/feature may add to the preservation and route registers but **may not establish another styling system** without a formal exception to `DESIGN.md`.
- Store sanitised route/component/UAT registers in repo as separate inspectable data artifacts in a later authorized PR (e.g. `docs/product-experience/registers/*.csv`). The attached GLM Excel/Opus prose remains historical research evidence, not an automatically mergeable truth source.
- On every release candidate, regenerate route and component coverage from actual head and verify that new PRs have not made this document stale.

### 14.4 Follow-up evidence artifacts recommended for authorised implementation

1. `docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` — effective nested routes, guards, required shell, migrations and evidence.
2. `docs/product-experience/UI_COMPONENT_DISPOSITION_REGISTER.csv` — 289 GLM baseline file records **plus validated Opus/Moderator overrides and any new files**, not only a summary count.
3. `docs/product-experience/UI_FUNCTIONAL_PRESERVATION_MATRIX.md` — expanded FP-01–12 with exact backend routes/tests and fixtures.
4. `docs/product-experience/UI_SOURCE_PR_CUSTODY_MATRIX.md` — exact current tip/base, accepted evidence, conflicts and extraction candidates.
5. `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` — Owner-approved source components/swatches, type, density, responsive layouts.
6. `docs/product-experience/UI_VISUAL_UAT_LEDGER.md` — actual before/after screenshots and PASS/FIX/HOLD tied to SHA.
7. `docs/product-experience/UI_CI_QUALITY_GATE_REGISTER.md` — which gates are advisory/required and exact run evidence.
8. `docs/product-experience/UI_TRUTH_AND_SECURITY_ISSUES.md` — redacted, authorized remediation statuses; do not expose credentials.

**Do not create these empty registers merely to imply implementation has begun.** They are specified deliverables for RX-00 onwards.

---

## 15. Acceptance criteria for the entire CARUP-UX-REBUILD-01 programme

The programme may claim **UNIFIED UI COMPLETE** only after **all** criteria below have been demonstrated and independently accepted:

1. **100%** of active route paths map to exactly one intended presentation family and the proper access policy; no business operations under PublicShell.
2. No competing uncontrolled main navigation, dashboard sidebar, footer or workspace chrome exists on reachable UI. Legitimate local task navigation uses the governed context model.
3. All approved reference screens use the same brand/tokens/typographic grammar and pass physical Owner visual review on desktop, tablet and mobile.
4. `DESIGN.md` restrictions on default glass, generic card fleets, false zeroes and competing mini-brand systems are made **testable** and enforced by required CI on active presentation code.
5. All **12** preservation journeys and the complete accepted owner/role UAT matrix retain real API operations, persistence, safety and authorization; no rollback of accepted Dealer 1.0 function.
6. Canonical Vehicle Truth/Trust, money/currency, temporal evidence and reviewer labels are consistent across public, owner, dealer, importer and institutional representations.
7. D1/D2 and other material security/truth defects are demonstrably remediated or safely inaccessible; no P1 authority risk is waived for design convenience.
8. WCAG 2.2 AA-oriented automated and physical checks cover shell focus, navigation, forms, touch sizes, alt text, error recovery and mobile no-overflow. Existing local-mock findings are closed by real-source tests.
9. Performance budgets are measured with production builds on recorded network/device profiles; performance or business KPIs are never invented.
10. Native/React Native supported capabilities have consistent brand/state language and independently pass actual simulator/device tests; unsupported operator roles are honest about coverage.
11. All relevant old UI is intentionally retained (compatibility) or removed after verified parity; no older shell silently reappears from a feature branch.
12. Exact-head CI, independent review, Owner UAT and merge verification are complete. **Deployment, migrations, real-dealer publication and payments remain separately governed.**

**Planning approval checkpoint (to be signed by Owner):**

| Field | Value |
|---|---|
| Owner decision | `PENDING — APPROVE MASTER PLAN / RETURN FOR REVISION` |
| Approved version / SHA | `PENDING` |
| Selected architecture | `PROPOSED: Option B + selective C` |
| Approved visual composition | `PENDING UX-REF review` |
| Authorized first execution unit | `NONE — separately specify RX-00 or TI-00` |
| Allowed environments/operations | `READ-ONLY RESEARCH ONLY UNTIL AUTHORIZED` |
| Moderator final disposition | `REVIEW CANDIDATE — NOT IMPLEMENTATION CERTIFIED` |

---

# Part II — Research addendum (v0.9.1)

## 16. What Part II adds and how to use it

Part II turns the Opus IR01 evidence into planning inputs that v0.9.0 did not yet carry:
- **errata** to v0.9.0 statements (§17);
- **independently re-verified facts** (§18, Appendix E);
- a **measurable unification scorecard** with baselines (§19);
- the **evidence-derived requirements** for the context manifest (§20);
- the **shell-migration hazard checklist** (§21);
- **domain specifics** (§22);
- **test and CI remediation** (§23);
- **runtime baselines** (§24);
- **custody detail** (§25);
- the **rationale for OD-11–OD-17** (§26);
- **market constraints** (§27);
- the **open-verification register** (§28);
- **operating lessons for agents** (§29).

It uses the same evidence labels as Part I:
- **S**: source-verified at `9f2bebfe`;
- **G**: Git/PR history;
- **R-L**: rendered locally against a stub API, with synthetic sessions labelled LOCAL-MOCK and every non-local host blocked;
- **R-static**: deployed static assets only;
- **D**: document assertion;
- **J**: judgment;
- **OPEN**: needs verification.

**Precedence:** a §17 erratum controls the Part I statement it corrects. Everywhere else, Part I's decisions stand, and Part II adds detail.

---

## 17. Errata and clarifications to v0.9.0

| ID | Part I location | v0.9.0 statement | Correction / clarification (evidence) |
|---|---|---|---|
| E-01 | §2.3, raw palette row | "8,555 in 366 runtime files incl. CSS/JS" | 366 is the size of the runtime scope (`git ls-files web/src` minus tests: 366 runtime and 170 test files). The **8,555 raw palette utilities occur in 228** of those files [S] |
| E-02 | §2.3, semantic row | "496 total, only 51 in application code" | 496 semantic utilities in total, **442 of them inside `components/ui`**. The Opus app-code measure (inventory C5) is **51**, so app code bypasses tokens by about 168:1. Because the token values equal the palette values, the bypass looks identical today, which is why reviewers never saw it; it now blocks any re-theme [S][J] |
| E-03 | §2.3, `card-shadow` row | "persistent use" | Opus figures: `card-shadow` appears **212 times in 78 files**; **207 of 314 `<Card>` tags** carry the deprecated `border-0 card-shadow` recipe (75 files); **76 reachable files** use it, including the Vehicle Detail lower half and the Owner Dashboard [S][G] |
| E-04 | §2.3, glass row | Definitions dead; 28 blurs | Strengthened. In the `9f2bebfe` build Tailwind drops `.glass-card`/`.glass-dark` from the compiled CSS, and **0 elements** use them across 132 rendered captures [R-L]. The look is recreated by: 28 `backdrop-blur` (including both shell top bars and the mobile bottom bar); 22 translucent-plus-blur strings; 30 ambient glow blobs; 25 coloured glow shadows plus 18 arbitrary glows; 107 `bg-gradient-*` [S] |
| E-05 | §2.2, G1 | "PRs #4, #16, #18, #56, #57, #94" | Navigation programme PRs: **#16, #18, #54–#57, #94** (2026-06-03 → 06-24). June redesign burst: **#3–#6, #16, #73**. #4 belongs to the redesign burst [G] |
| E-06 | §2.2, history rewrite | "Opus also documents a historical Git-history rewrite" | Confirmed and specified. **CR-1 (`4a8c4811`, 2026-07-26) rewrote 901 commits.** GitHub `mergeCommit` OIDs for PRs merged before that date are **not** ancestors of `main`, so attribute them by the first mainline commit containing the change, or by subject match [G] |
| E-07 | §2.4, bundle | "~787 KB gzip" | Exact Opus build: entry chunk **3,116,435 B** raw / **787,298 B** gzip-9 / **602,605 B** brotli-11, plus 221 KB CSS. Lazy-pages experiment (not a patch): entry **611,739 B** raw / **179,386 B** gzip. App.tsx imports about 123 pages statically and has one `lazy()` route [R build][S] |
| E-08 | §6, TI-03 | "can default/ratchet `trust_score` to ≥80" | **Source-verified.** `verifyTradeProfile` is restricted to platform admin or reviewer. It sets `verification_status:'VERIFIED'` and `trust_score = min(100, max(previous ‖ 50, payload ‖ 80))` (`backend/services/diaspora/diasporaTradeProfileService.js:248-257`). The score defaults to ≥80, and re-verification can only raise it. The action is privileged-only, not anonymous, which bears on severity [S] |
| E-09 | §7, FP-06 | Treats `/mechanic/work-orders` as a working journey to preserve | On `main`, the web client cannot supply the tenant that the work-order and parts APIs require (TI-19), so these flows fail before reaching the protected contract. FP-06 must **first establish a working baseline** (API contract plus a verified tenant from the context manifest), then preserve it [S; runtime with a real tenant OPEN] |
| E-10 | §2.1 / §9, PR census | "53 open PRs … many stacked" | The open PRs form **one stacked chain**. #254's head contains **22 other open-PR heads plus the four Trade OS milestone commits**; an earlier figure of 26 counted those milestones. There are 178 unmerged remote branches, and **109 conflict textually** with `main` [G] |
| E-11 | §9, PR-less branches | "(Opus Appendix J)" | Exact refs: `fix/carup-mvp-stab-01-client-readiness` @`a42d3c8a` (2026-10-22; 256 commits in no PR; 166 UI files; 87 mobile runtime files differ from `main`) and `feat/ca-owner-02-management-convergence` @`2b6a1099` [G] |
| E-12 | §2.4, provenance | "Reported by Opus using static deployment artifacts" | Mechanism: each deployment's own static `carup-provenance.json`. Production `carup.dev` reports `78303ed6`; `staging.carup.dev` reports `8353dbdd` on `feat/garage-1.0-final-business-os-completion`. These are **self-reported** until platform deployment metadata confirms them (OV-02) [R-static] |
| E-13 | §2.5, accessibility | "101/128 … research baseline" | The violations recur in **all seven shell families**: `color-contrast` in 94 captures (522 nodes); `link-name` in every DashboardLayout role (icon-only links); **no skip link anywhere**. **316 of 336 Tab stops** across 28 mobile captures land in the invisible off-canvas sidebar. On public 390 px pages the fixed bottom bar **fully obscures focus** (WCAG 2.2 SC 2.4.11) [R-L] |
| E-14 | §1.2, Opus limits | "Screens behind login used synthetic sessions/stub API" | Also true for the public captures: all Opus runtime evidence comes from the `9f2bebfe` production build served locally against a stub API, with every non-local request blocked. **No live data was rendered** [R-L] |
| E-15 | §2.2, G3 | "compact mobile bottom bar" | `CompactBottomNav` (`c28a086b`, 2026-08-27; no recorded rationale) renders **only in `MainLayout`**: public and auth, and absent from every dashboard. It hard-codes five tabs plus its own `ROLE_HOME`, and contradicts the manifest on Sell (it sends guests to `/sell`, the manifest to `/register`) [S][G] |

---

## 18. Independently re-verified facts

The Opus coordinator re-checked **19 load-bearing claims** directly against the code: 18 during IR01, plus TI-03 for this revision. The full ledger is **Appendix E**.
- **18 were confirmed** exactly as stated.
- **1 was corrected**: the #254 containment count, 22 open PRs plus 4 milestone commits, not 26.

Treat these as the **highest-confidence facts** in the research base. The two most consequential sets are:
- the truth defects: SC-1, SC-2, SC-8, SC-14, SC-16, SC-19;
- the structural facts: SC-9, SC-10, SC-11, SC-15, SC-18.

---

## 19. Unification scorecard: measured baseline to target

This makes the §15 acceptance criteria measurable.
- Baselines are measured at `9f2bebfe` [S unless marked].
- Targets are proposals for Owner approval.
- Each metric must be **automated** in the CI-02 to CI-08 gates (§11) before RX-02 exits. The Opus measurement scripts are research tools and must be re-implemented in-repo, not copied.

| # | Metric | Baseline @ `9f2bebfe` | Target at UNIFIED UI COMPLETE |
|---|---|---|---|
| U-01 | Route-level shell variants | **7** | **3** families + protected review composition |
| U-02 | Workflow routes inside the public shell | **32 of 59** `MainLayout` routes | **0** |
| U-03 | Top-bar implementations | **4** (+ 6 copy-pasted auth layouts) | **1** header component, 3 variants |
| U-04 | Hard-coded navigation maps outside registry/manifest | **~20** | **0** |
| U-05 | Navigation UIs | **8**, fed by 2 configs + 4 inline lists | All rendered from one projection |
| U-06 | Page routes without a registry entry | **34–35** of 137 | **0** |
| U-07 | Navigation-equivalence mismatches (518 persona×destination rows) [computed] | DESKTOP≠MOBILE **90** · OFFERED-BUT-BOUNCES **52** · HYDRATION-FLIP **45** · URL-ONLY **14** · MEMBERSHIP-BLIND **9** | **0** in each class |
| U-08 | Sidebar routes highlighting more than one item | **37** | **0** |
| U-09 | Desktop mega-menu items → distinct destinations (guest) | **77 → 19** | Every entry a distinct, real destination |
| U-10 | Raw palette utilities in app code | **8,555** (228 files) | **0 new**; legacy ratcheted to 0 |
| U-11 | Semantic-token utilities in app code | **51** | All colour via tokens |
| U-12 | `--carup-*` brand variables referenced | **0** | Generated token layer, used everywhere |
| U-13 | CarUp component variants (`cva` outside `components/ui`) | **0** | Catalogue of approved variants |
| U-14 | `<Card>` with deprecated `border-0 card-shadow` | **207 of 314** | **0** |
| U-15 | `backdrop-blur` / `bg-gradient-*` | **28 / 107** | Only justified overlays and photo scrims (documented) |
| U-16 | Outer content widths | **12** (36 container recipes) | **≤3** (one per grammar) |
| U-17 | `<h1>` recipes | **28** | **1 per grammar** |
| U-18 | Status→colour mapping sites | **108 in 53 files** (2 centralized) | **1** registry |
| U-19 | Trust readers | **6** | **1** (`TrustLens`) |
| U-20 | Price formatters | **≥7** | **1** (`MoneyDisplay`) |
| U-21 | Vehicle tile/row implementations | **≥18** (1 shared) | **2** (card + row) |
| U-22 | Primary orange fill with white text | orange-500 **2.80:1** (×140); hover-orange outline/ghost **2.78:1** (307/346) | **≥4.5:1** |
| U-23 | Skeletons rendering in brand orange | **46 / 46** | **0** (neutral token) |
| U-24 | Tailwind-v4-only utilities emitting no CSS on v3 | `outline-hidden` ×29, `(--var)` ×30 | **0** (compile-asserted) |
| U-25 | Entry JavaScript (gzip) | **787 KB** (1 `lazy()` route) | **≤200 KB** candidate (CI-08) |
| U-26 | Lab LCP, 390×844, Slow-4G, CPU 4× [R-L] | **5.0–9.0 s** across 10 routes | **≤2.5 s** on the documented profile |
| U-27 | Lab CLS, owner dashboard [R-L] | **0.133** | **≤0.1** |
| U-28 | Axe captures with violations [R-L] | **101 / 128** | **0** serious/critical on reference routes |
| U-29 | Skip links | **0** shells | **Every** shell |
| U-30 | Off-canvas focus leakage <1024 px [R-L] | **316 / 336** Tab stops | **0** (`inert`) |
| U-31 | Forced 500/403 announced with `role=alert` [R-L] | **2 / 10** pages | **All** |
| U-32 | Visual-regression assertions | **0** | Every family × 5 widths (§5) |
| U-33 | Required CI checks running web tests | **0** | Unit + a11y + visual + route-shell + navigation parity |
| U-34 | Shell families crossed in the dealer journey | **5** | **0** unexpected (Focused entry excepted) |
| U-35 | Native hard-coded colours / theme | **338** hex (42 distinct), **empty** theme | Generated shared tokens |
| U-36 | Native coverage of governed features | **6 of 104** | Documented capability map; honest "not on mobile" states |
| U-37 | PWA installable | **No** (no manifest) | Yes, if OD-10 approves the PWA scope |

---

## 20. Navigation and context: requirements for `SessionWorkspaceManifest`

These requirements derive from the evidence and extend §3.4. They are proposals for security and API review.

| ID | Requirement | Evidence |
|---|---|---|
| NC-01 | Represent every authority dimension the backend already knows: platform role (`users.role`); verified tenant membership (`tenant_users`); legal and organization authority; institutional roles; platform admin. **Navigation must never key on `user.role` alone** | All surfaces key on one `UserRole` today, while `dealerVerifiedWorkspaceService` states users.role is "deliberately NOT an authorization criterion" [S] |
| NC-02 | Support **several organizations of the same kind**: a context picker replaces today's unhandled `409 MULTIPLE_DEALERS_REQUIRE_EXPLICIT_TENANT_SELECTION` | No client handles the 409 [S] |
| NC-03 | Include `member` and `reviewer`, which are absent from the frontend `UserRole`, and normalize role aliases identically in client and server (`platform_admin`/`super_admin`) | `/dashboard` self-redirect; admin pages may resolve "disabled" (TI-20) [S] |
| NC-04 | A context switch **posts the selected tenant**, returns a server-approved context, and invalidates context-scoped caches. It replaces the inert global-role switcher | SC-7 [S] |
| NC-05 | One projection feeds **every** surface: mega-menu, account menu, drawer, bottom bar, workspace rail, footer, breadcrumbs, active state and native tabs. **0 hard-coded lists** | ~20 independent maps (§19, U-04) [S] |
| NC-06 | Active-state semantics are declared per entry, exact or prefix, with **one** active item | 37 routes multi-highlight; "Overview" prefix-matches every child [S] |
| NC-07 | An equivalence test asserts that desktop, mobile and native expose the same authorized destinations per context | U-07 baselines [computed] |
| NC-08 | Return paths carry **path plus query plus context**; protected redirects never drop `?vin=` or filters | `routeAccess.ts:124-127` keeps the pathname only [S] |
| NC-09 | Governance overrides are a **display and SPA** concern; anything that must be *blocked* is enforced at the API | No domain API consults the governance overrides [S] |
| NC-10 | Planned features without routes (e.g. `/settings`) never render as live links. The dead-link gate must treat "planned" as **not linkable** | The gate passes `/settings` because a planned entry exists [S] |
| NC-11 | Dealer canonical workspace, reviewer benches and Trade operations become reachable from global navigation for authorized contexts | Global navigation never links to `/dealer/dashboard`; reviewer benches are not linked from the admin console [S] |
| NC-12 | Sign-out clears **session** state only; drafts and favourites survive | `localStorage.clear()` (TI-24) [S] |

---

## 21. Shell-migration hazard checklist (RX-02 to RX-08)

Every route-family PR attaches this checklist alongside the §7 migration contract.

| ID | Hazard | Control |
|---|---|---|
| MH-01 | **Atomic blast radius.** Replacing `MainLayout` re-chromes **66** routes; replacing `DashboardLayout` re-chromes **63**, including 6 legacy dealer routes | Move the 32 workflow routes out of `MainLayout` **before or with** the swap; use route-family presentation flags (§10.3) |
| MH-02 | **Behaviour inside layouts.** `evaluateRouteAccess` (`DashboardLayout.tsx:92-102`); `RegistryRouteBoundary` (runs with `enforceAuth={false}` in `MainLayout.tsx:20`); `trackNav`; the auth bootstrap loader (`role=status`, `aria-busy`); `returnTo`; `LazyRouteBoundary`; `FeatureStatePages` | Port as contracts with tests; diff guards before and after; **67 routes rely on their layout alone for SPA access control** |
| MH-03 | **Page-level layout assumptions:** 27 pages render their own `<main>` inside the layout's `<main>`; 24 page roots force `min-h-screen` beneath a 64 px sticky header | Remove during migration; shell owns `<main>` and min-height |
| MH-04 | **Sticky offsets.** Some assume the 64 px header (`top-24`, `top-28`, a JavaScript `offset = 100`); others ignore it (`lg:top-5`, `lg:top-6`, `top-8`). The Vehicle Detail price panel slides 41 px under the header at 1920 px. The compare tray hard-codes `bottom-[5rem]` for the bottom bar | Header height and bottom-bar offset become tokens (`--header-h`, `--bottom-nav-h`); scroll-padding |
| MH-05 | **Cross-shell components must be versioned, not forked:** `EvidenceReview` + `ExtractionReviewPanel` (4 shells); `dealerButtonWrap` (3); `MarketplaceListingCard`; `ListingImage`; `SellerInquiriesCard`; `DealerProfileMedia`; `VehicleLifeStageTimeline` | Move once to the shared kit; consumers migrate in their own wave |
| MH-06 | **Tailwind v4 syntax on v3.** The primitives contain `outline-hidden`, `(--var)`, `has-data-*`, `@container`, `field-sizing` and `in-data-*`, none of which compile on v3. `Alert` uses an undefined `var(--spacing)` | Upgrade or rewrite **before** token migration; add a compiled-CSS assertion |
| MH-07 | **Mis-mapped `--accent`.** shadcn's neutral hover/placeholder token is brand orange | Split into neutral `accent` and brand `action` tokens before restyling any primitive |
| MH-08 | **Duplicate requests on authenticated loads.** The auth boot effect re-sets a freshly parsed user, which recreates every request callback. Vehicle Detail issues 16 GETs, 3 of them duplicated. Shell switches remount the header and refetch [R-L] | Fix identity stability first, or performance baselines are meaningless; network-count tests per route |
| MH-09 | **Request-loop pattern.** `useCarUpApi()` returns a new object every render; pages that use it as an effect dependency loop (`/diaspora/containers`: about 300–480 GET/s) [R-L][S] | Memoize or split the aggregate; lint rule against using it as a dependency |
| MH-10 | **Dead code inflating the surface:** `Home.tsx` + `App.css` (Vite boilerplate); orphaned `VerificationReview.tsx` (503 lines); 27–28 unused primitives (the two lanes counted differently), including `breadcrumb`, `sidebar`, `navigation-menu`, `empty`, `form` and `chart` | Retire the dead pages; evaluate unused primitives as seeds for the new shells |
| MH-11 | **Blank screens.** A reviewer who types `/admin` gets a blank page | Route-level error boundaries in every family |
| MH-12 | **Footer below 1024 px.** The public footer is hidden today, which also hides the only public route into Trade OS on mobile | Footer accordion at every width (OD-06) |

---

## 22. Domain specifics the rebuild must carry

These inputs come from the Opus domain lanes. Each sub-section names what a domain's reference design (§5) and migration PR must reflect.

### 22.1 Vehicle presentation (FP-01, FP-02, UX-REF-01/02)

- **Six independent Trust readers**, each with its own vocabulary, all collapse into `TrustLens`:
  - `MarketplaceListingCard.TrustPreview`;
  - `MarketplaceCompare.trustLabel`, which merges `stale` and `unavailable` into "Not evaluated";
  - `VehicleDetail.readPublicTrust` and `presentTrust`;
  - a duplicate reader in `VehicleProfile`;
  - `ownerStatedValues.readOwnerTrustClaim`;
  - `intelligenceDisplay.displayTrust`.

  The canonical projection (`listingSummaryService`) defines the output [S].
- **At least 7 price formatters** collapse into `MoneyDisplay`. Known defects:
  - owner `statedPrice` always prefixes "$", so ZiG amounts display as dollars (`ownerStatedValues.ts:65-67`);
  - the Marketplace spotlight drops "$";
  - Vehicle Detail formats through `data/mockData.ts` [S].
- **18 or more vehicle tile/row implementations**, of which only `MarketplaceListingCard` is shared (6 pages). Target: one card and one row (U-21) [S].
- **Vehicle Detail** is 3,138 lines. Its upper showroom is a reference; its lower half (20 `<Card>`, tabs, gradient sidebar) is rebuilt.
  - The legacy Verification tab must stop presenting stolen-then-recovered as "CID check passed", zero logs as "no rollback anomalies", and an absent row as "no stolen alert".
  - Its test (`VehicleDetail.trust.test.tsx:510-523`) changes **in the same PR** [S].
- **The owner "Vehicle Passport"** (`VehicleProfile`) uses none of the shared passport components. DESIGN.md §21 requires one component contract with modes.

### 22.2 Seller (FP-03, UX-REF-04)

- **Two Seller Studios:**
  - guest `/sell`: an editorial dark header, glass panels, and steps Vehicle → Listing → Photos → Preview;
  - signed-in `/dashboard/sell-vehicle`: a legacy stepper, and steps Vehicle Details → Location & Pricing → Images & Features → Review.

  They **reuse one saved step index**, although their step lists differ. Converge on one studio with one step model [S].
- **"Sell" is three journeys:**
  - Home goes to `/sell`;
  - the navbar CTA, mega-menu and drawer send guests to `/register` with no `returnTo`;
  - signed-in users skip the intent router (DESIGN.md §11.1).
- **Draft and deep-link conflicts:** a stale guest draft silently overrides `?vin=`, and protected redirects drop the query [S].
- **Seller Intelligence** is truthful but not decision-grade. It has no action queue or benchmark, and zero values draw as 2% bars. Add next actions [S][J].

### 22.3 Dealership (FP-05, UX-REF-05)

- `DealerCanonicalWorkspaceLayout` wraps **only** `/dealer/dashboard`. Its six destinations render in the public shell (SC-15).
- The workspace has no logo, account menu or sign-out, and global navigation never links to it.
- Stock, staff, billing and enquiries **never display the dealership's name**, and no branch context exists. Organization (and later branch) must appear on every Dealer page [S].
- **Four visual generations sit on one journey:** legacy cards; grey intelligence panels; Dealer 1.0 blue underline links; UAT-R1 `rounded-3xl`/`font-black`. Every quick action crosses two of them [S][J].
- **Reviewer benches have strong governance**: password step-up, 40/80-character reasons, DB-enforced independence. They are not linked from the admin console. Keep the governance; add the entry point (NC-11).
- **#258 restored the legacy `/dealer` permission matrix verbatim** on 2026-11-07 (`e5330de0`), after removing it on 2026-11-03 (`189e82f9`). No product path grants the platform role `dealer` (TI-05) [G][S].

### 22.4 Garage and mechanics (FP-06, FP-07, UX-REF-06)

- **My Garage** (a private owner's collection) and the **commercial garage operating system** are different products and must never share a name in navigation.
- **The operating system does not exist on `main`**: 0 files in `pages/dashboard/garage` and `components/garage`. It lives on #197 → #209 → #239–#242, mounted in the legacy `DashboardLayout role="mechanic"` with `<Card>` primitives, so it is functionally new but visually old.
- No product path on `main` creates a garage membership [S][G].
- **The mechanic web flows fail on `main` before reaching their contract** (E-09, TI-19).
- **Workshop organization** for the reference design (benchmark §27): queue by stage → job card (status, technician, timestamp) → estimate and customer approval with photo/video evidence → work → invoice → payment. Declined work is kept for follow-up [J].

### 22.5 Trade, imports and logistics (FP-08, FP-09, UX-REF-07)

- **What is on `main`:** only the June–July "Phases 1–10" generation. 29 runtime files sit in `pages/diaspora`, and the domain UI totals 11,653 lines across 40 files [S].
- **`DiasporaTrade.tsx`** is 1,689 lines holding 17 components. Shared helpers are copied: `labelize` 5 times, `formatMoney` 4 times.
- **Hand-built UI repeated across pages:**
  - 46 section cards in 2 radii;
  - 35 status pills;
  - 9 auth spinners;
  - 7 access-denied alerts;
  - 15 hand-styled native selects.

  Decompose with behaviour-preserving moves before any redesign [S].
- **Why Trade sits in the public shell:** the routes accreted onto a public placeholder (PR #22), and 10 page files hand-roll auth gates.
- **No mobile entry:** the only public route in (the footer) is hidden below `lg` [S][G].
- **Target structure: the Import Order as the anchor object.** It has:
  - one object header;
  - one lifecycle rail fed by **one** backend projection;
  - one next-action region;
  - tabs: Overview · Quotes · Documents (task list: required / uploaded / verified by whom) · Shipping (milestone events) · Customs (including CBCA pre-shipment inspection) · Payments · Activity.

  CAP Journey & Arrival and the Passport become **modes** of that object [J].
- **Reuse:**
  - `SafeTradeTimeline` + `deriveTimeline` is the base for the shared `LifecycleRail`;
  - `DataStateNotes`, the passport sections, `PaymentMilestonesCard` and `RequireDiasporaAuth`;
  - from the unmerged `TradeOSWorkspaceLayout`, **only** the trade-identity slot and the settle-timeout context read. Its dark header and hard-coded `NAV_ITEMS` are not reused [S][G].

### 22.6 Communications (FP-10, UX-REF-09)

- **Object context needs contract work.** Threads carry listing, escrow, financing and subject IDs but **no VIN, import-order or work-order column**, and both inboxes print IDs as unlinked text. UX-REF-09 therefore depends on a separately authorized data-contract change [S].
- **The flow ends in a toast, not a thread.** An inquiry becomes a thread only asynchronously, through the `domain_events` worker, and the inquiry modal ends with a toast rather than a route to the thread. The composer keeps a typed draft when the user switches threads [S].
- **One conversation, five renderings.** The same marketplace inquiry renders five times with different transforms: `SellerInquiriesCard`, legacy `Leads` (twice), `DealerTenantInquiries`, `AdminInquiryCard`, and the owner thread. Vehicle Detail offers three contact paths. Converge on one conversation kit [S].

### 22.7 Parts and PartSentry (UX-REF-06 adjunct)

- **Four disconnected products:**
  - consumer parts and services catalogues, which are empty by design;
  - mechanic stock, which needs a tenant;
  - "garage parts", which has no surface;
  - PartSentry, a per-VIN repair ledger written from two near-duplicate forms.
- **Contract:** build one part-identity, fitment and provenance chip. Never show "Ledger Verified" for an empty ledger (TI-07) [S].

### 22.8 Institutional and administration (FP-11, UX-REF-08)

- **Three institutional sub-brands exist today:** orange (shell, insurance, admin); indigo (bank, government); blue-900/slate (reviewer shell). Converge on one Workspace(institutional) grammar [S].
- **Patterns to extract into the Document-review pattern:**
  - `VehicleOperationsReview`: server-derived `allowed_actions`, required reasons, audit trail;
  - `IdentityVerificationCaseManagement`: reason codes, "counts are NOT zero";
  - `TrustReviewQueue`: audit dialog;
  - the dealer workbenches: step-up and DB-enforced independence.
- **Patterns to retire:**
  - auto-filled reasons;
  - reasons collected through `window.prompt`;
  - "Nothing pending review. 🎉" shown on a read failure [S].

### 22.9 Native and PWA (FP-12, UX-REF-10)

- **Native on `main`:** 56 runtime files (10,009 lines), last changed 2026-08-28. It renders 6 of 104 governed features, all owner or marketplace [S][G].
- **Three visual dialects:**
  - a navy/orange tab shell;
  - light-slate NativeWind screens;
  - a dark verification flow with a blue `#2563EB` CTA.
- **No token layer:** 338 hex literals (42 distinct), 230 inline style objects, 150 `fontSize` literals across 17 sizes, and an undefined `text-xxs` [S].
- **DESIGN.md does not address native.** Add a native section, or a native appendix to the token specification, in RX-01 [S][J].
- **The open native stack (#223 → #232) is a hazard.** It forks the palette again (navy900 `#081B2C`, radii 18/30) and replaces the governed tab resolver with a static shell. Re-base it on shared tokens and **keep the governed tabs** [G].
- **Web and native disagree.** Web bottom bar: Home / Market / Verify / Sell / Account, white, lucide. Native tabs: Dashboard / Marketplace / Garage / Messages / More, navy, Ionicons. The vehicle route also differs (`/marketplace/:id` vs `/vehicle/[vin]`), so define a canonical deep-link map [S].

---

## 23. Test-suite and CI remediation specifics (CI-01 to CI-09)

### 23.1 Tests that encode defects and must change with their fix

| Test | Encodes | Change with |
|---|---|---|
| `web/src/pages/VehicleDetail.trust.test.tsx:510-523` | Legacy trustGraph "Verified" verdicts as "real signals" | TI-07 / §22.1 |
| `tests/agents/27-feature-registry-navigation-map.spec.ts:272` | The inert "Switch Portal Role" offer | TI-14 / NC-04 |
| `mobile/tests/login-submit-button.test.ts:32-37` | Debug copy "VISIBLE LOGIN BUTTON BELOW" | TI-15 |
| Navigation dead-link gate | Treats a *planned* registry entry (`/settings`) as linkable | NC-10 |

### 23.2 Tests that will break without protecting behaviour

- **Source-text contracts.** About **20 web domain test files** are source-text contracts (`readFileSync` + `toContain`). Replace them with behavioural tests **before** the matching UI is rebuilt; otherwise every redesign PR fights them [S].
- **Exact-copy assertions.** Accepted physical tests assert exact copy. Grep `web/tests` and `tests/` before rewording any UI text on an accepted page [D].

### 23.3 Tests that cannot see the defects that matter

- **Mocked API layer.** Unit tests mock `useCarUpApi` throughout. That is why the missing-tenant failures (TI-19) stayed invisible. **CI-07 must add contract tests against a real isolated API** for each FP journey [S].
- **Hollow visual audit.** The 39-shot "visual audit" asserts only non-empty pages and the absence of 5xx errors. It is not a visual test [S].

### 23.4 What CI actually enforces today

- **Required checks.** The `main` ruleset (read 2026-11-10) requires only "Lint · Types · Build · Tests" and "Secret scan". That job runs **no web unit, Playwright, axe or visual test** [S].
- **Tests that never run as required checks:**
  - navigation config tests run only in the non-required Navigation Intelligence and Referral CI;
  - the Communications suite (31 unit test files, 6 Playwright specs) is not wired to CI;
  - the mobile vitest suite (5 files) and `test:static` (5 scripts) never run;
  - native CI omits the `marketplace-media-contract` check;
  - `CompactBottomNav` has no unit test [S].
- **Missing review infrastructure:** no style lint, no class/token assertions, no Storybook or visual-regression tool, no CODEOWNERS, no PR template. The `main` ruleset also does not reference DESIGN.md [S].

### 23.5 Workflow-trigger hygiene

- Several workflows run on **every** pull request without path filters. Others write to shared staging when their paths match.
- **Before opening any PR,** check which workflows its diff triggers. A path filter is evaluated against the **whole PR diff**, not just the latest push.
- **One-shot staging workflows** should be `workflow_dispatch` only [S][D].
- **Example:** this documentation PR touches only `docs/product-experience/`, which matches no staging workflow's path filter.

---

## 24. Performance, accessibility and runtime baselines (for CI-06 and CI-08)

All figures come from Opus R-L runs: the `9f2bebfe` production build served locally against a stub API, with every non-local host blocked. They are **lab baselines, not field data**. Re-measure at each exact implementation head.

**Lab performance.**

| Setting | Value |
|---|---|
| Viewport | 390×844 |
| CPU | 4× slowdown |
| Network | Slow-4G (562.5 ms RTT, 1.47 Mbit/s) |
| Runs | 4 cold runs per route; medians shown |

| Route | LCP | FCP | CLS (max) | INP proxy | JS transfer | API requests |
|---|---|---|---|---|---|---|
| `/` | 5.1 s | 5.1 s | 0 | 200 ms | 589 KB | 5 |
| `/marketplace` | 8.5 s | 5.1 s | 0 | 176 ms | 589 KB | 5 |
| `/marketplace/:id` | 9.0 s | 5.0 s | 0 | 184 ms | 589 KB | 18 |
| `/search` | 5.1 s | 5.1 s | 0 | 176 ms | 589 KB | 6 |
| `/login` | 5.0 s | 5.0 s | 0 | — | 589 KB | 1 |
| `/dashboard` (owner) | 5.7 s | 4.9 s | 0.133 | 92 ms | 589 KB | 11 |
| `/mechanic` | 5.7 s | 4.9 s | 0 | 112 ms | 589 KB | 6 |
| `/admin` | 5.7 s | 4.9 s | 0 | 128 ms | 596 KB | 5 |
| `/dealer/dashboard` | 6.6 s | 5.2 s | 0.003 | — | 589 KB | 10 |
| `/diaspora` | 5.2 s | 5.2 s | 0 | 196 ms | 589 KB | 2 |

The same 589 KB of JavaScript precedes first paint on every route (E-07).

**Accessibility** (R-L, axe-core 4.12.1, WCAG 2.0–2.2 A/AA):
- 101 of 128 captures have at least one violation (E-13).
- Recurring rules: `color-contrast`, `link-name`, `button-name`, `label`, `select-name`, `target-size`, `aria-valid-attr-value`.
- No skip link anywhere.
- Off-canvas focus leakage and a focus-obscuring bottom bar.

**Layout:**
- Horizontal overflow at 390 px: owner dashboard 30 px, legacy dealer dashboard 18 px, admin trust review 55 px. The admin trust review also overflows by 19 px at 1280 px.
- Seven different content max-widths: 1440, 1400, 1280, 1152, 1100, 896, and 448–576 px.
- H1 runs from 84 px/900 (home) to 24 px/700 (dashboards).

**States:**
- Only 2 of 10 pages announce forced errors with `role=alert`.
- The protected shells share one accessible loader.
- Public marketplace loading shows seven unlabelled skeletons and no live region.

**Not yet measured** (OV-08, OV-09): field performance (RUM/CrUX), Safari and Firefox, real devices, populated tables at 390 px, real authenticated data.

---

## 25. Branch custody specifics (extends §9)

### Topology

The open PRs form **one chain**:
- **Base:** T3 `b446d8ea` ⊂ T4 `736f06c5` ⊂ T5 `5079b0b3` ⊂ T6 `b6ba1ccd` ⊂ #207.
- **One line:** #207 → #214 → #220 → #221 → #222 → #229 → #231 → #235 → #238 → #239 → #240 → #241 → #242.
- **A parallel line:** #207 → #243 → #244 → #245 … #251.
- **Join and tip:** the lines join in #253; #254 is the tip.
- **Fork point:** every branch forked at `bb9d9900` is exactly **429 commits behind** `main` (the Dealer 1.0 merge) [G].

### Ports instead of merges

- #221 ported #197, #208, #209 and #213 in **55 commits with 0 merges**.
- The native PRs #223–#232 were "recustodied" file by file onto a PR-less branch.
- Result: screens exist in **2–4 divergent versions** [G].

### Off-main inventory

- **287 runtime UI files** absent from `main` (238 web, 49 mobile).
- **57 route paths**.
- **2 shells**: `TradeOSWorkspaceLayout` (17 routes) and `CorporateLayout` (10 routes).
- Eight `/diaspora/*` routes are re-parented to the Trade shell.
- Main's 5 `/mechanic/*` routes coexist with 12 new `/garage/*` routes [G][S].

### Conflict hotspots

- 109 of 178 unmerged branches (31 of 53 open PRs) conflict textually with `main`.
- Most-conflicted files: `App.tsx` (67 branches), `VehicleDetail.tsx` (56), `DealerDirectory.tsx` (54).
- `App.tsx` has **24 distinct versions** among the 53 open heads, and none equals `main`'s.
- 24 open PRs edit `App.tsx`, and 24 edit `featureRegistry.ts` [G].

### Semantic conflicts git does not flag

- **Duplicate billing route.** #251 adds `/dealer/subscription` under the legacy role-based portal, duplicating `main`'s `/dealers/billing` on the canonical tenant model. A simulated merge places it under `LegacyDealerRouteGate` without a conflict marker.
- **Missing contrast fix.** Every unmerged branch lacks #258's `orange-700` contrast fix to the shells [G][S].

### Extraction seeds and their dependencies

| Seed | Source | Depends on | Notes |
|---|---|---|---|
| Workspace navigation primitives (`workspaceModel`, `WorkspaceBreadcrumbs`, parent link, exit actions, `CarUpWorkspaceBar`) | #244 | APIs already on `main`; every `WS_STYLE` token already occurs in `main`'s Seller pages | Generalize from 3 workspaces to the manifest's contexts; drop the single-role reachability check |
| Vehicle capability panels | #244 | #244's backend | HOLD |
| Trade order chrome | #243/#244 | #243's journey route and #207's shell | HOLD (OD-11) |
| `TruthState` grammar | #222 | — | Seed for the status registry |
| `Fact` / `UnverifiedMark` / `Unshown` | #243 | — | Seed for evidence primitives |
| Organization switcher | #221 | — | Seed for the context switcher (NC-04) |
| Native tokens and primitives | #223 | — | Re-base on shared tokens; keep governed tabs |
| Route-level `lazy()` | `6f054f7c` | — | §6.2 |

### Work mixing (B07)

Of 1,920 de-duplicated open-PR commits:
- 447 are UI-only;
- 621 are backend-only;
- 136 mix both (7%).

But 28 of the 33 UI-touching PRs also change the backend. **Domain lanes can keep shipping services if presentation files have one owner** (§9.1) [G][J].

---

## 26. Rationale for OD-11 to OD-17

- **OD-11 (Trade lineage).** #207 → #243 → #244 carries CAP and the workspace layer. #214 and #215 are separate, overlapping T3–T13 branches of more than 65k lines each. Choosing one lineage avoids extracting three variants of the same surfaces [G].
- **OD-12 (Garage model).** Two incompatible unmerged tenant designs exist. #197 lets a tenant role satisfy a platform role. Garage 1.0 keeps `activeTenant` plus tenant types and roles, explicitly to stop #197 offering platform-admin navigation to a garage admin. The second fits NC-01 [G][S].
- **OD-13 (PR-less custody).** The newest native and Corporate UI is invisible to PR review today. Draft PRs make it reviewable without merging [G].
- **OD-14 (seed-only screens).** Claims, FraudAlerts and RegistryVerification read only migration seed rows, and AIMonitoring shows literal KPIs. Hiding them is the truthful default [S].
- **OD-15 (price context).** Market price context is the largest decision-making gap against the leaders. Their trust comes from published methods and explicit "no rating" states (§27) [D].
- **OD-16 (independence).** UI must not imply independent review where the server does not enforce it [S].
- **OD-17 (production containment).** Production self-reports `78303ed6`, 1,431 commits behind `main`, and still ships demo access. A reviewed fix exists off `main` [R-static][G].

---

## 27. Market and benchmark constraints (research snapshot; verify before use)

Sources were accessed 2026-11-10 and are recorded in the Opus report, Appendix G. Several competitor sites block automated clients, and facts taken from search snippets are secondary. **Never use competitor imagery or proprietary designs as CarUp assets.**

### Zimbabwe and cross-border realities

- **Traffic share.** Mobile was about **61.5%** of web traffic in Oct 2025 and **67.7%** in Oct 2026, with an anomalous mid-2026 trough of 49–51%. Android holds **87–92%** of mobile. Samsung accounts for 41–45% of devices and Transsion brands about 15%. **360 px** is the most common width (StatCounter).
- **Network speed.** Ookla publishes **no** mobile median for Zimbabwe (the fixed median is 53.96 Mbps, Sept 2026). Phone RTT for African and importer audiences is **200–325 ms**.
- **Data price.** Sources conflict: **US$43.75/GB** (Cable.co.uk 2023, ranked 237/237) against about **US$3.54/GB** (Business Day 2024).
- **Currency.** USD dominates; ZiG is rising (snippet).
- **Imports.** CBCA pre-shipment conformity assessment applies to used-vehicle imports.
- **Design implication:** reference device **360×800 Android Chrome at 200–300 ms RTT**, plus explicit image and font budgets [D].

### Proof points from leading products

- **AutoTrader South Africa:** 89% mobile traffic. It passes every Core Web Vital on phones (LCP 1.2 s, INP 150 ms, CLS 0.00) at p75 RTT 200 ms, with 31 KB of homepage HTML. Its cards show "Fair Price / High Price / No Rating" (https://www.autotrader.co.za/).
- **AutoTrader UK:** p75 phone LCP 0.8 s (CrUX via https://treo.sh/sitespeed/www.autotrader.co.uk?formFactor=phone).
- **AutoScout24** publishes its price-label method: 14 months of comparables, more than 10 million records and over 70 equipment features. Labels cannot be bought and are recalculated daily (https://www.autoscout24.de/promo/preisbewertung/).
- **Carfax** states it "does not have the complete history of every vehicle" (https://www.carfax.com/vehicle-history-reports/).
- **Japanese exporters (BE FORWARD, SBT Japan):** slow on phones (LCP 5.5–6.6 s, INP 375–425 ms) although 87.8% of SBT's traffic is mobile. They show explicit post-purchase tasks such as Download Invoice, Upload Proof of Payment and Track Shipments.
- **NN/g on comparison:** compare at most 5 items, and **2 on mobile**, with sticky headers and "highlight differences" (https://www.nngroup.com/articles/comparison-tables/).
- **Baymard on filters:** 28% of sites lack an applied-filter overview (snippet).
- **Design-system structure to borrow:** Carbon's density scale (24/32/40/48/64 px rows); Material's compact width class (<600 dp); Apple HIG tab rules (never hide or disable a tab; avoid "More"); GOV.UK task lists.

### Where CarUp stands

- **Ahead on truth semantics** [J]:
  - it separates seller statements from verified evidence;
  - it shows Trust only once evaluated;
  - it writes "currency not recorded" rather than inventing a currency;
  - its landed-cost estimate is labelled advisory.
- **Behind on** [J]:
  - price context;
  - speed;
  - density;
  - image responsiveness (`srcset`);
  - font loading (7 Inter weights through a CSS `@import`);
  - coherence.

---

## 28. Open-verification register

These items must be closed by evidence, not assumed. Owners are proposed.

| ID | Unknown | Why it matters | Resolver | Evidence that closes it |
|---|---|---|---|---|
| OV-01 | Whether any deployed backend accepts the demo credentials | TI-01 severity (P0 vs P1), OD-17 | Ops/security, read-only | Written review of the deployed auth configuration (environment mode, passwordless flag, seeded password state). **No login attempt** |
| OV-02 | True deployed frontend and backend identities | Every UAT result depends on it | Ops | Immutable platform deployment metadata for production and staging |
| OV-03 | Rendered quality of every shell with real authenticated, populated data | Visual acceptance (§5, §12) | Owner/QA in an authorized isolated environment | The 24 GLM authenticated checks and the Opus shell families, captured at 5 widths |
| OV-04 | Platform-admin pages resolving to "disabled" after hydration | TI-20 | QA with a real platform-admin test identity | Screenshot plus network log |
| OV-05 | Password-recovery CSRF behaviour at runtime | TI-11 | QA | Isolated environment request/response evidence |
| OV-06 | LendingQueue null `monthly_payment` crash | TI-21 | QA | Isolated environment repro (kept private) |
| OV-07 | Native runtime: guest entry, Garage `cost` crash, CSRF refusals | TI-15/16 | Native QA | Simulator or device run |
| OV-08 | Field performance | CI-08 targets | Platform | RUM or CrUX after an authorized release |
| OV-09 | Populated dense tables at 360/390 px | P08, §3.5 mobile workbench | QA | Populated fixture run per table page |
| OV-10 | Business acceptance of the Garage and Trade branch content | OD-11/12 | Domain leads | Written acceptance per extracted unit |
| OV-11 | Zimbabwe mobile network median | Budgets | Product/analytics | Licensed data or CarUp's own RUM |
| OV-12 | Availability of isolated test identities and data for the RX-03 pilot | Pilot certification | Owner/ops | Named identities per role and membership, with consent |

---

## 29. Operating lessons for agents (from IR01 execution)

1. **Write outputs early, then refine.** Running twelve parallel research agents hit account usage and credit limits mid-run, seven times in all. Agents that had already written their notes lost nothing; an agent that had not yet written lost everything. Resume interrupted agents and tell them what is already on disk.
2. **Verify the remote at every phase boundary** with `git ls-remote`, and record the SHA. `main` did not move during IR01, but shared branches have moved minutes after pinning.
3. **Never certify from metrics alone.** Look at the screenshots: green axe and overflow runs have hidden clipped labels before.
4. **Isolate runtime research:**
   - use a throwaway worktree on a path without spaces (guarded scripts silently do nothing under paths with spaces);
   - use a stub API, and block every non-local host;
   - label captures LOCAL-MOCK;
   - never use real credentials;
   - check deployments through static provenance only.
5. **Public-repository hygiene:**
   - no credentials, exploit scripts or working reproductions of unfixed defects in the repo;
   - keep security specifics at class level in repo documents;
   - never bulk-add large untracked folders, such as copied worktrees, in the working directory.
6. **Pickaxe before rewriting.** Several containment fixes already exist off `main` (§6.2). Search all refs with `git log --all -S` before writing new code.
7. **Distinguish units when reconciling counts:**
   - route elements vs paths;
   - wrappers vs visual variants;
   - occurrence scope vs files containing occurrences.

   Most GLM/Opus "disagreements" were unit differences (Appendix C, §17).

---

## Appendix A — GLM IR01-R2 289-file component disposition baseline

The following table is mechanically transcribed from **`CarUp-IR01-R2-Registers.xlsx` → `3 Components`**, not invented or independently certified. Its primary disposition totals reconcile to **289**. **Where a row conflicts with §8, §8 is the controlling planning override** (e.g., keep Dealer behavioral guard while rebuilding its chrome; conditionally retire legacy gate). “REBUILD” describes a presentation migration candidate, **not** permission to discard functional logic. It must be revalidated against the implementation PR's exact head.

| # | Source file | GLM primary | GLM secondary / context |
|---:|---|---|---|
| 1 | `web/src/components/DisputePanel.tsx` | **REBUILD** | — |
| 2 | `web/src/components/EvidenceUploadModal.tsx` | **REBUILD** | — |
| 3 | `web/src/components/ExtractionReviewPanel.tsx` | **REBUILD** | — |
| 4 | `web/src/components/PremiumEvidenceGallery.tsx` | **REBUILD** | — |
| 5 | `web/src/components/PreviewProvenanceBanner.tsx` | **REBUILD** | — |
| 6 | `web/src/components/SourceCoveragePanel.tsx` | **REBUILD** | — |
| 7 | `web/src/components/TrustDecisionPanel.tsx` | **REBUILD** | — |
| 8 | `web/src/components/VehicleCompletenessPanel.tsx` | **REBUILD** | — |
| 9 | `web/src/components/VehicleDisclosurePanel.tsx` | **REBUILD** | — |
| 10 | `web/src/components/VehicleHistoryReport.tsx` | **REBUILD** | — |
| 11 | `web/src/components/VehicleLifeStageTimeline.tsx` | **REBUILD** | — |
| 12 | `web/src/components/VehicleTemporalComparison.tsx` | **REBUILD** | — |
| 13 | `web/src/components/dealer/DealerCanonicalWorkspaceLayout.tsx` | **KEEP** | Extend as WorkspaceShell(dealer) base |
| 14 | `web/src/components/dealer/DealerDraftReview.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 15 | `web/src/components/dealer/DealerReviewerLayout.tsx` | **KEEP** | Restyle only |
| 16 | `web/src/components/dealer/DealerVinListingPanel.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 17 | `web/src/components/dealer/LegacyDealerRouteGate.tsx` | **RETIRE** | Keep frozen redirect map constant |
| 18 | `web/src/components/dealer/PrivateMediaThumb.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 19 | `web/src/components/dealer/ReviewerStepUpField.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 20 | `web/src/components/dealer/profile/DealerProfileMedia.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 21 | `web/src/components/dealer/profile/DeclaredSectionCard.tsx` | **KEEP** | Restyle via WorkspaceShell(dealer) |
| 22 | `web/src/components/referral/ReferralEventLog.tsx` | **REBUILD** | — |
| 23 | `web/src/components/referral/ReferralRealList.tsx` | **REBUILD** | — |
| 24 | `web/src/components/communications/CommunicationMessagePartView.tsx` | **KEEP** | — |
| 25 | `web/src/components/communications/CommunicationMultimodalComposer.tsx` | **KEEP** | — |
| 26 | `web/src/components/owner/OwnerNotificationBell.tsx` | **KEEP** | — |
| 27 | `web/src/components/home/JourneyMediaStory.tsx` | **KEEP** | — |
| 28 | `web/src/components/seller/SellerWorkspaceHeader.tsx` | **REBUILD** | — |
| 29 | `web/src/components/diaspora/DataStateNotes.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 30 | `web/src/components/diaspora/PaymentMilestonesCard.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 31 | `web/src/components/diaspora/safetrade/SafeTradeActions.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 32 | `web/src/components/diaspora/safetrade/SafeTradeAssuranceNotice.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 33 | `web/src/components/diaspora/safetrade/SafeTradeDisputes.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 34 | `web/src/components/diaspora/safetrade/SafeTradeEligibilityPanel.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 35 | `web/src/components/diaspora/safetrade/SafeTradeMilestones.tsx` | **EXTRACT** | Promote to shared primitive |
| 36 | `web/src/components/diaspora/safetrade/SafeTradeStatusBanner.tsx` | **REBUILD** | Keep flag semantics + non-custodial notice verbatim |
| 37 | `web/src/components/diaspora/safetrade/SafeTradeTimeline.tsx` | **EXTRACT** | Promote to shared primitive |
| 38 | `web/src/components/diaspora/subscription/BillingOperationsPanel.tsx` | **REBUILD** | Keep entitlement tests |
| 39 | `web/src/components/diaspora/subscription/EntitlementDenialPanel.tsx` | **REBUILD** | Keep entitlement tests |
| 40 | `web/src/components/diaspora/subscription/PlanComparison.tsx` | **REBUILD** | Keep entitlement tests |
| 41 | `web/src/components/diaspora/subscription/SubscriptionActions.tsx` | **REBUILD** | Keep entitlement tests |
| 42 | `web/src/components/diaspora/subscription/SubscriptionStatusCard.tsx` | **REBUILD** | Keep entitlement tests |
| 43 | `web/src/components/diaspora/subscription/UsageDashboard.tsx` | **REBUILD** | Keep entitlement tests |
| 44 | `web/src/components/intelligence/ActivityInstrumentation.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 45 | `web/src/components/intelligence/CommandCentre.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 46 | `web/src/components/intelligence/DealerIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 47 | `web/src/components/intelligence/FinanceIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 48 | `web/src/components/intelligence/GovernmentIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 49 | `web/src/components/intelligence/ListingInsights.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 50 | `web/src/components/intelligence/MarketplacePulse.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 51 | `web/src/components/intelligence/NextBestActions.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 52 | `web/src/components/intelligence/PartsIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 53 | `web/src/components/intelligence/PeriodicReport.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 54 | `web/src/components/intelligence/ReferralIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 55 | `web/src/components/intelligence/ServiceIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 56 | `web/src/components/intelligence/TradeIntelligence.tsx` | **REBUILD** | Keep existing *.test.tsx semantics |
| 57 | `web/src/components/routing/FeatureStatePages.tsx` | **KEEP** | — |
| 58 | `web/src/components/routing/LazyRouteBoundary.tsx` | **KEEP** | — |
| 59 | `web/src/components/routing/RegistryRouteBoundary.tsx` | **KEEP** | — |
| 60 | `web/src/components/ui/accordion.tsx` | **KEEP** | Restyle via tokens only |
| 61 | `web/src/components/ui/alert-dialog.tsx` | **KEEP** | Restyle via tokens only |
| 62 | `web/src/components/ui/alert.tsx` | **KEEP** | Restyle via tokens only |
| 63 | `web/src/components/ui/aspect-ratio.tsx` | **KEEP** | Restyle via tokens only |
| 64 | `web/src/components/ui/avatar.tsx` | **KEEP** | Restyle via tokens only |
| 65 | `web/src/components/ui/badge.tsx` | **KEEP** | Restyle via tokens only |
| 66 | `web/src/components/ui/breadcrumb.tsx` | **KEEP** | Restyle via tokens only |
| 67 | `web/src/components/ui/button-group.tsx` | **KEEP** | Restyle via tokens only |
| 68 | `web/src/components/ui/button.tsx` | **KEEP** | Restyle via tokens only |
| 69 | `web/src/components/ui/calendar.tsx` | **KEEP** | Restyle via tokens only |
| 70 | `web/src/components/ui/card.tsx` | **KEEP** | Restyle via tokens only |
| 71 | `web/src/components/ui/carousel.tsx` | **KEEP** | Restyle via tokens only |
| 72 | `web/src/components/ui/chart.tsx` | **KEEP** | Restyle via tokens only |
| 73 | `web/src/components/ui/checkbox.tsx` | **KEEP** | Restyle via tokens only |
| 74 | `web/src/components/ui/collapsible.tsx` | **KEEP** | Restyle via tokens only |
| 75 | `web/src/components/ui/command.tsx` | **KEEP** | Restyle via tokens only |
| 76 | `web/src/components/ui/context-menu.tsx` | **KEEP** | Restyle via tokens only |
| 77 | `web/src/components/ui/dialog.tsx` | **KEEP** | Restyle via tokens only |
| 78 | `web/src/components/ui/drawer.tsx` | **KEEP** | Restyle via tokens only |
| 79 | `web/src/components/ui/dropdown-menu.tsx` | **KEEP** | Restyle via tokens only |
| 80 | `web/src/components/ui/empty.tsx` | **KEEP** | Restyle via tokens only |
| 81 | `web/src/components/ui/field.tsx` | **KEEP** | Restyle via tokens only |
| 82 | `web/src/components/ui/form.tsx` | **KEEP** | Restyle via tokens only |
| 83 | `web/src/components/ui/hover-card.tsx` | **KEEP** | Restyle via tokens only |
| 84 | `web/src/components/ui/input-group.tsx` | **KEEP** | Restyle via tokens only |
| 85 | `web/src/components/ui/input-otp.tsx` | **KEEP** | Restyle via tokens only |
| 86 | `web/src/components/ui/input.tsx` | **KEEP** | Restyle via tokens only |
| 87 | `web/src/components/ui/item.tsx` | **KEEP** | Restyle via tokens only |
| 88 | `web/src/components/ui/kbd.tsx` | **KEEP** | Restyle via tokens only |
| 89 | `web/src/components/ui/label.tsx` | **KEEP** | Restyle via tokens only |
| 90 | `web/src/components/ui/menubar.tsx` | **KEEP** | Restyle via tokens only |
| 91 | `web/src/components/ui/navigation-menu.tsx` | **KEEP** | Restyle via tokens only |
| 92 | `web/src/components/ui/pagination.tsx` | **KEEP** | Restyle via tokens only |
| 93 | `web/src/components/ui/popover.tsx` | **KEEP** | Restyle via tokens only |
| 94 | `web/src/components/ui/progress.tsx` | **KEEP** | Restyle via tokens only |
| 95 | `web/src/components/ui/radio-group.tsx` | **KEEP** | Restyle via tokens only |
| 96 | `web/src/components/ui/resizable.tsx` | **KEEP** | Restyle via tokens only |
| 97 | `web/src/components/ui/scroll-area.tsx` | **KEEP** | Restyle via tokens only |
| 98 | `web/src/components/ui/select.tsx` | **KEEP** | Restyle via tokens only |
| 99 | `web/src/components/ui/separator.tsx` | **KEEP** | Restyle via tokens only |
| 100 | `web/src/components/ui/sheet.tsx` | **KEEP** | Restyle via tokens only |
| 101 | `web/src/components/ui/sidebar.tsx` | **KEEP** | Restyle via tokens only |
| 102 | `web/src/components/ui/skeleton.tsx` | **KEEP** | Restyle via tokens only |
| 103 | `web/src/components/ui/slider.tsx` | **KEEP** | Restyle via tokens only |
| 104 | `web/src/components/ui/sonner.tsx` | **KEEP** | Restyle via tokens only |
| 105 | `web/src/components/ui/spinner.tsx` | **KEEP** | Restyle via tokens only |
| 106 | `web/src/components/ui/switch.tsx` | **KEEP** | Restyle via tokens only |
| 107 | `web/src/components/ui/table.tsx` | **KEEP** | Restyle via tokens only |
| 108 | `web/src/components/ui/tabs.tsx` | **KEEP** | Restyle via tokens only |
| 109 | `web/src/components/ui/textarea.tsx` | **KEEP** | Restyle via tokens only |
| 110 | `web/src/components/ui/toggle-group.tsx` | **KEEP** | Restyle via tokens only |
| 111 | `web/src/components/ui/toggle.tsx` | **KEEP** | Restyle via tokens only |
| 112 | `web/src/components/ui/tooltip.tsx` | **KEEP** | Restyle via tokens only |
| 113 | `web/src/components/marketplace/AllInPricePanel.tsx` | **KEEP** | Shared vehicle-story components |
| 114 | `web/src/components/marketplace/BuyerAssistantDrawer.tsx` | **KEEP** | Shared vehicle-story components |
| 115 | `web/src/components/marketplace/InquiryModal.tsx` | **KEEP** | Shared vehicle-story components |
| 116 | `web/src/components/marketplace/ListingImage.tsx` | **KEEP** | Shared vehicle-story components |
| 117 | `web/src/components/marketplace/MarketplaceListingCard.tsx` | **KEEP** | Shared vehicle-story components |
| 118 | `web/src/components/marketplace/MarketplaceShareSheet.tsx` | **KEEP** | Shared vehicle-story components |
| 119 | `web/src/components/marketplace/SafetyWarnings.tsx` | **KEEP** | Shared vehicle-story components |
| 120 | `web/src/components/marketplace/SellerInquiriesCard.tsx` | **KEEP** | Shared vehicle-story components |
| 121 | `web/src/components/marketplace/TrustSummaryPanel.tsx` | **KEEP** | Shared vehicle-story components |
| 122 | `web/src/components/marketplace/VehicleIntelligenceStory.tsx` | **KEEP** | Shared vehicle-story components |
| 123 | `web/src/components/sell/FactReconciliationPanel.tsx` | **KEEP** | Seller continuity contract |
| 124 | `web/src/components/sell/ListingQualityPanel.tsx` | **KEEP** | Seller continuity contract |
| 125 | `web/src/components/sell/SellIntentRouter.tsx` | **KEEP** | Seller continuity contract |
| 126 | `web/src/components/sell/SellerDocumentAutofillNotice.tsx` | **KEEP** | Seller continuity contract |
| 127 | `web/src/components/sell/SellerRouteErrorBoundary.tsx` | **KEEP** | Seller continuity contract |
| 128 | `web/src/components/sell/VehicleHistoryCoveragePanel.tsx` | **KEEP** | Seller continuity contract |
| 129 | `web/src/components/sell/VehicleHistoryDisclosuresSection.tsx` | **KEEP** | Seller continuity contract |
| 130 | `web/src/components/sell/VehicleIdentificationNotice.tsx` | **KEEP** | Seller continuity contract |
| 131 | `web/src/components/admin/NavigationAnalyticsPanel.tsx` | **REBUILD** | — |
| 132 | `web/src/components/layout/CompactBottomNav.tsx` | **CORRECT** | Consume navigationManifest |
| 133 | `web/src/components/layout/DashboardLayout.tsx` | **REBUILD** | Behavior contract pinned by existing tests |
| 134 | `web/src/components/layout/Footer.tsx` | **KEEP** | Restyle via shells |
| 135 | `web/src/components/layout/MainLayout.tsx` | **KEEP** | Restyle via shells |
| 136 | `web/src/components/layout/MobileNavDrawer.tsx` | **KEEP** | Restyle via shells |
| 137 | `web/src/components/layout/Navbar.tsx` | **KEEP** | Restyle via shells |
| 138 | `web/src/components/layout/ScrollToTop.tsx` | **KEEP** | Restyle via shells |
| 139 | `web/src/components/vehicle/VehicleHistoryObligationsSections.tsx` | **REBUILD** | — |
| 140 | `web/src/components/listing/OwnerListingMedia.tsx` | **REBUILD** | — |
| 141 | `web/src/features/communications/ChannelIcon.tsx` | **KEEP** | Restyle in later wave |
| 142 | `web/src/features/communications/admin/AuditDrawer.tsx` | **KEEP** | Restyle in later wave |
| 143 | `web/src/features/communications/admin/AuditSearch.tsx` | **KEEP** | Restyle in later wave |
| 144 | `web/src/features/communications/admin/BulkActionBar.tsx` | **KEEP** | Restyle in later wave |
| 145 | `web/src/features/communications/admin/ChannelFilterBar.tsx` | **KEEP** | Restyle in later wave |
| 146 | `web/src/features/communications/admin/CommandCenterHeader.tsx` | **KEEP** | Restyle in later wave |
| 147 | `web/src/features/communications/admin/CommandCenterNav.tsx` | **KEEP** | Restyle in later wave |
| 148 | `web/src/features/communications/admin/ContextRail.tsx` | **KEEP** | Restyle in later wave |
| 149 | `web/src/features/communications/admin/ConversationHeader.tsx` | **KEEP** | Restyle in later wave |
| 150 | `web/src/features/communications/admin/ConversationRow.tsx` | **KEEP** | Restyle in later wave |
| 151 | `web/src/features/communications/admin/DeliveryAttemptList.tsx` | **KEEP** | Restyle in later wave |
| 152 | `web/src/features/communications/admin/DeliveryRecoveryPanel.tsx` | **KEEP** | Restyle in later wave |
| 153 | `web/src/features/communications/admin/DeliveryStateBadge.tsx` | **KEEP** | Restyle in later wave |
| 154 | `web/src/features/communications/admin/HandoffBar.tsx` | **KEEP** | Restyle in later wave |
| 155 | `web/src/features/communications/admin/MessageBubble.tsx` | **KEEP** | Restyle in later wave |
| 156 | `web/src/features/communications/admin/MessageTechnicalDetails.tsx` | **KEEP** | Restyle in later wave |
| 157 | `web/src/features/communications/admin/ProviderHealthPanel.tsx` | **KEEP** | Restyle in later wave |
| 158 | `web/src/features/communications/admin/ProviderSmokeTestPanel.tsx` | **KEEP** | Restyle in later wave |
| 159 | `web/src/features/communications/admin/ProviderTelemetryPanel.tsx` | **KEEP** | Restyle in later wave |
| 160 | `web/src/features/communications/admin/QueueOverview.tsx` | **KEEP** | Restyle in later wave |
| 161 | `web/src/features/communications/admin/RecoveryView.tsx` | **KEEP** | Restyle in later wave |
| 162 | `web/src/features/communications/admin/ReplyComposer.tsx` | **KEEP** | Restyle in later wave |
| 163 | `web/src/features/communications/admin/SettingsView.tsx` | **KEEP** | Restyle in later wave |
| 164 | `web/src/features/communications/admin/SlaWorklist.tsx` | **KEEP** | Restyle in later wave |
| 165 | `web/src/features/communications/admin/VirtualList.tsx` | **KEEP** | Restyle in later wave |
| 166 | `web/src/features/communications/admin/WorkerHealthPanel.tsx` | **KEEP** | Restyle in later wave |
| 167 | `web/src/pages/APIDocs.tsx` | **REBUILD** | Routes unchanged |
| 168 | `web/src/pages/About.tsx` | **REBUILD** | Routes unchanged |
| 169 | `web/src/pages/Blog.tsx` | **REBUILD** | Routes unchanged |
| 170 | `web/src/pages/Careers.tsx` | **REBUILD** | Routes unchanged |
| 171 | `web/src/pages/Contact.tsx` | **REBUILD** | Routes unchanged |
| 172 | `web/src/pages/DealerBillingReadiness.tsx` | **REBUILD** | Routes unchanged |
| 173 | `web/src/pages/DealerBuyerFeedback.tsx` | **REBUILD** | Routes unchanged |
| 174 | `web/src/pages/DealerBuyerFeedbackReview.tsx` | **REBUILD** | Routes unchanged |
| 175 | `web/src/pages/DealerClaimReview.tsx` | **REBUILD** | Routes unchanged |
| 176 | `web/src/pages/DealerClaimWorkspace.tsx` | **REBUILD** | Routes unchanged |
| 177 | `web/src/pages/DealerComplianceApplicationReview.tsx` | **REBUILD** | Routes unchanged |
| 178 | `web/src/pages/DealerDirectory.tsx` | **REBUILD** | Routes unchanged |
| 179 | `web/src/pages/DealerFullStorefrontReview.tsx` | **REBUILD** | Routes unchanged |
| 180 | `web/src/pages/DealerLegalActivationReview.tsx` | **REBUILD** | Routes unchanged |
| 181 | `web/src/pages/DealerOperatingDetails.tsx` | **REBUILD** | Routes unchanged |
| 182 | `web/src/pages/DealerOperatingLifecycleReview.tsx` | **REBUILD** | Routes unchanged |
| 183 | `web/src/pages/DealerResearchCorrection.tsx` | **REBUILD** | Routes unchanged |
| 184 | `web/src/pages/DealerResearchProfile.tsx` | **REBUILD** | Routes unchanged |
| 185 | `web/src/pages/DealerResearchReview.tsx` | **REBUILD** | Routes unchanged |
| 186 | `web/src/pages/DealerStaffConsole.tsx` | **REBUILD** | Routes unchanged |
| 187 | `web/src/pages/DealerTenantInquiries.tsx` | **REBUILD** | Routes unchanged |
| 188 | `web/src/pages/DealerTenantInventory.tsx` | **REBUILD** | Routes unchanged |
| 189 | `web/src/pages/GarageDirectory.tsx` | **REBUILD** | Routes unchanged |
| 190 | `web/src/pages/GuestSell.tsx` | **REBUILD** | Routes unchanged |
| 191 | `web/src/pages/HelpCenter.tsx` | **REBUILD** | Routes unchanged |
| 192 | `web/src/pages/Home.tsx` | **RETIRE** | Delete |
| 193 | `web/src/pages/InsuranceDirectory.tsx` | **REBUILD** | Routes unchanged |
| 194 | `web/src/pages/Landing.tsx` | **REBUILD** | Routes unchanged |
| 195 | `web/src/pages/Marketplace.tsx` | **REBUILD** | Routes unchanged |
| 196 | `web/src/pages/MarketplaceCategoryPage.tsx` | **REBUILD** | Routes unchanged |
| 197 | `web/src/pages/MarketplaceCompare.tsx` | **REBUILD** | Routes unchanged |
| 198 | `web/src/pages/PressKit.tsx` | **REBUILD** | Routes unchanged |
| 199 | `web/src/pages/Pricing.tsx` | **CORRECT** | Honest disclosure; content test |
| 200 | `web/src/pages/PrivacyPolicy.tsx` | **REBUILD** | Routes unchanged |
| 201 | `web/src/pages/Security.tsx` | **REBUILD** | Routes unchanged |
| 202 | `web/src/pages/SharedReport.tsx` | **REBUILD** | Routes unchanged |
| 203 | `web/src/pages/Support.tsx` | **REBUILD** | Routes unchanged |
| 204 | `web/src/pages/TermsOfService.tsx` | **REBUILD** | Routes unchanged |
| 205 | `web/src/pages/TrustSafety.tsx` | **REBUILD** | Routes unchanged |
| 206 | `web/src/pages/VehicleDetail.tsx` | **REBUILD** | Routes unchanged |
| 207 | `web/src/pages/VehicleSearch.tsx` | **REBUILD** | Routes unchanged |
| 208 | `web/src/pages/diaspora/DiasporaAiCommandCenter.tsx` | **REBUILD** | 71 backend suites green |
| 209 | `web/src/pages/diaspora/DiasporaConfirmedImport.tsx` | **REBUILD** | 71 backend suites green |
| 210 | `web/src/pages/diaspora/DiasporaContainerMarketplace.tsx` | **REBUILD** | 71 backend suites green |
| 211 | `web/src/pages/diaspora/DiasporaDriveConnections.tsx` | **REBUILD** | 71 backend suites green |
| 212 | `web/src/pages/diaspora/DiasporaOrderPassport.tsx` | **REBUILD** | 71 backend suites green |
| 213 | `web/src/pages/diaspora/DiasporaReverseRfq.tsx` | **REBUILD** | 71 backend suites green |
| 214 | `web/src/pages/diaspora/DiasporaSafeTrade.tsx` | **REBUILD** | 71 backend suites green |
| 215 | `web/src/pages/diaspora/DiasporaSafeTradeDetail.tsx` | **REBUILD** | 71 backend suites green |
| 216 | `web/src/pages/diaspora/DiasporaSafeTradeOperations.tsx` | **REBUILD** | 71 backend suites green |
| 217 | `web/src/pages/diaspora/DiasporaStockManager.tsx` | **REBUILD** | 71 backend suites green |
| 218 | `web/src/pages/diaspora/DiasporaStockPassport.tsx` | **REBUILD** | 71 backend suites green |
| 219 | `web/src/pages/diaspora/DiasporaSubscription.tsx` | **REBUILD** | 71 backend suites green |
| 220 | `web/src/pages/diaspora/DiasporaTrade.tsx` | **EXTRACT** | Verbatim file moves; then lazy() |
| 221 | `web/src/pages/diaspora/DiasporaTradeGraph.tsx` | **REBUILD** | 71 backend suites green |
| 222 | `web/src/pages/diaspora/DiasporaTradeProfile.tsx` | **REBUILD** | 71 backend suites green |
| 223 | `web/src/pages/diaspora/DiasporaWorkbookDryRun.tsx` | **REBUILD** | 71 backend suites green |
| 224 | `web/src/pages/diaspora/DiasporaWorkbookOperatorConsole.tsx` | **REBUILD** | 71 backend suites green |
| 225 | `web/src/pages/auth/ForgotPassword.tsx` | **REBUILD** | — |
| 226 | `web/src/pages/auth/KYCVerification.tsx` | **CORRECT** | Wire to /api/identity/verification-sessions (exists) |
| 227 | `web/src/pages/auth/Login.tsx` | **CORRECT** | P0 lane first; AuthShell in M1 |
| 228 | `web/src/pages/auth/LoginErrorAlert.tsx` | **REBUILD** | — |
| 229 | `web/src/pages/auth/Register.tsx` | **REBUILD** | — |
| 230 | `web/src/pages/auth/ResetPassword.tsx` | **REBUILD** | — |
| 231 | `web/src/pages/auth/VerifyEmail.tsx` | **REBUILD** | — |
| 232 | `web/src/pages/dashboard/dealer/DealerDashboard.tsx` | **REBUILD** | — |
| 233 | `web/src/pages/dashboard/dealer/Inventory.tsx` | **RETIRE** | Keep publish/price handlers by moving to canonical pages |
| 234 | `web/src/pages/dashboard/dealer/Leads.tsx` | **CORRECT** | loadFailed state if retained during transition |
| 235 | `web/src/pages/dashboard/dealer/LegacyDealerDashboard.tsx` | **RETIRE** | Remove after gate redirect map proven |
| 236 | `web/src/pages/dashboard/dealer/Promotions.tsx` | **RETIRE** | — |
| 237 | `web/src/pages/dashboard/dealer/SalesAnalytics.tsx` | **RETIRE** | Preserve intelligence wrapper |
| 238 | `web/src/pages/dashboard/shared/GovernanceReviewQueue.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 239 | `web/src/pages/dashboard/shared/TrustReviewQueue.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 240 | `web/src/pages/dashboard/owner/AIDashboard.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 241 | `web/src/pages/dashboard/owner/Communications.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 242 | `web/src/pages/dashboard/owner/EvidenceVault.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 243 | `web/src/pages/dashboard/owner/InsuranceRecords.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 244 | `web/src/pages/dashboard/owner/MyGarage.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 245 | `web/src/pages/dashboard/owner/MyListings.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 246 | `web/src/pages/dashboard/owner/OwnerDashboard.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 247 | `web/src/pages/dashboard/owner/PartSentry.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 248 | `web/src/pages/dashboard/owner/ReferralWallet.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 249 | `web/src/pages/dashboard/owner/SavedCars.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 250 | `web/src/pages/dashboard/owner/SellVehicle.tsx` | **EXTRACT** | Split behavior module first; restyle render tree only |
| 251 | `web/src/pages/dashboard/owner/SellerIntelligence.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 252 | `web/src/pages/dashboard/owner/ServiceHistory.tsx` | **CORRECT** | Remove or derive |
| 253 | `web/src/pages/dashboard/owner/VehicleProfile.tsx` | **REBUILD** | SellerResume/SellFlow tests must stay green |
| 254 | `web/src/pages/dashboard/insurance/Claims.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 255 | `web/src/pages/dashboard/insurance/FraudAlerts.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 256 | `web/src/pages/dashboard/insurance/InsuranceDashboard.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 257 | `web/src/pages/dashboard/insurance/RiskAnalysis.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 258 | `web/src/pages/dashboard/bank/BankDashboard.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 259 | `web/src/pages/dashboard/bank/CollateralMap.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 260 | `web/src/pages/dashboard/bank/CreditRiskAnalysis.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 261 | `web/src/pages/dashboard/bank/LendingQueue.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 262 | `web/src/pages/dashboard/government/ComplianceReports.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 263 | `web/src/pages/dashboard/government/GovernmentDashboard.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 264 | `web/src/pages/dashboard/government/RegistryVerification.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 265 | `web/src/pages/dashboard/mechanic/CustomerRecords.tsx` | **CORRECT** | Real data or honest empty; registry-hide meanwhile |
| 266 | `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx` | **HOLD** | Functional fixes (F1) proceed now |
| 267 | `web/src/pages/dashboard/mechanic/PartsTracking.tsx` | **HOLD** | Functional fixes (F1) proceed now |
| 268 | `web/src/pages/dashboard/mechanic/ServiceLogs.tsx` | **HOLD** | Functional fixes (F1) proceed now |
| 269 | `web/src/pages/dashboard/mechanic/WorkOrders.tsx` | **HOLD** | Functional fixes (F1) proceed now |
| 270 | `web/src/pages/dashboard/admin/AIMonitoring.tsx` | **CORRECT** | Honest not-tracked states; fix health mapping |
| 271 | `web/src/pages/dashboard/admin/AdminDashboard.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 272 | `web/src/pages/dashboard/admin/Communications.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 273 | `web/src/pages/dashboard/admin/DealerCompliance.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 274 | `web/src/pages/dashboard/admin/EvidenceReview.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 275 | `web/src/pages/dashboard/admin/FeatureGovernanceConsole.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 276 | `web/src/pages/dashboard/admin/FraudQueue.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 277 | `web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 278 | `web/src/pages/dashboard/admin/MarketplaceModeration.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 279 | `web/src/pages/dashboard/admin/ReferralCampaigns.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 280 | `web/src/pages/dashboard/admin/ReferralCodes.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 281 | `web/src/pages/dashboard/admin/ReferralImportRoutes.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 282 | `web/src/pages/dashboard/admin/ReferralLocalLeads.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 283 | `web/src/pages/dashboard/admin/ReferralMarketing.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 284 | `web/src/pages/dashboard/admin/ReferralTrustReview.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 285 | `web/src/pages/dashboard/admin/UserManagement.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 286 | `web/src/pages/dashboard/admin/VehicleOperationsReview.tsx` | **REBUILD** | Keep role-guard + step-up tests |
| 287 | `web/src/pages/dashboard/admin/VerificationReview.tsx` | **RETIRE** | Delete |
| 288 | `web/src/context/AuthContext.tsx` | **CORRECT** | With P0 lane |
| 289 | `web/src/context/FeatureGovernanceContext.tsx` | **KEEP** | — |


---

## Appendix B — Exact 139-path route-to-shell planning map

This normalized route map is sourced from **GLM R2 `1 Route Register`** and corrected by the decisions in §§3, 6–8. It is **planning-only**: the existing nested route tree and effective guards must be regenerated against the execution SHA before mutation. The `*` catch-all and redirects are **inside** the 139 paths. **Target shell is a presentation placement, not an access grant.** Where the precise view requires Owner design approval or future feature integration, the note is explicit.

| ID | Current path | Current parent | Proposed presentation owner | Migration / caution |
|---|---|---|---|---|
| R001 | `/` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R002 | `/marketplace` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R003 | `/sell` | `MainLayout` | **Focused (seller/claim)** | Preserve account/tenant return and form state; check role guard. |
| R004 | `/marketplace/parts` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R005 | `/marketplace/services` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R006 | `/marketplace/compare` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R007 | `/marketplace/listing/:id` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R008 | `/marketplace/:id` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R009 | `/search` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R010 | `/reports/shared/:token` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R011 | `/dealers` | `MainLayout` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R012 | `/dealers/feedback` | `MainLayout` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R013 | `/dealers/:seedId` | `MainLayout` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R014 | `/dealers/:seedId/claim` | `MainLayout` | **Focused (seller/claim)** | Preserve account/tenant return and form state; check role guard. |
| R015 | `/dealers/:seedId/correction` | `MainLayout` | **Focused (seller/claim)** | Preserve account/tenant return and form state; check role guard. |
| R016 | `/dealers/claims` | `MainLayout` | **Focused (seller/claim)** | Preserve account/tenant return and form state; check role guard. |
| R017 | `/dealers/operating-details` | `MainLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R018 | `/dealers/billing` | `MainLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R019 | `/dealers/staff` | `MainLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R020 | `/dealers/stock` | `MainLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R021 | `/dealers/inquiries` | `MainLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R022 | `/garages` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R023 | `/insurance` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R024 | `/pricing` | `MainLayout` | **Public (commercial HOLD)** | No active trial/price claim without provider authority. |
| R025 | `/about` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R026 | `/contact` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R027 | `/careers` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R028 | `/press` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R029 | `/blog` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R030 | `/help` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R031 | `/trust` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R032 | `/privacy` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R033 | `/terms` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R034 | `/support` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R035 | `/security` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R036 | `/api-docs` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R037 | `/diaspora` | `MainLayout` | **Public** | Showroom/public, governed nav/footer and appropriate domain states. |
| R038 | `/diaspora/imports` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R039 | `/diaspora/imports/new` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R040 | `/diaspora/imports/:id` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R041 | `/diaspora/imports/:id/documents` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R042 | `/diaspora/imports/:id/shipment` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R043 | `/diaspora/imports/:id/passport` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R044 | `/diaspora/stock` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R045 | `/diaspora/trade-profile` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R046 | `/diaspora/stock/:id/passport` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R047 | `/diaspora/rfq` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R048 | `/diaspora/ai-commands` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R049 | `/diaspora/containers` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R050 | `/diaspora/drive` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R051 | `/diaspora/subscription` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R052 | `/diaspora/safetrade` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R053 | `/diaspora/safetrade/:id` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R054 | `/diaspora/trade-graph` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R055 | `/diaspora/safetrade/operations` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R056 | `/diaspora/workbook/import` | `MainLayout` | **Workspace (trade)** | Workflows; retain URLs, importer/reviewer permissions and source states. |
| R057 | `/admin/diaspora/compliance` | `MainLayout` | **Workspace (trade/institutional)** | Reparent from MainLayout with existing access checks. |
| R058 | `/admin/diaspora/workbooks` | `MainLayout` | **Workspace (trade/institutional)** | Reparent from MainLayout with existing access checks. |
| R059 | `/admin/diaspora/workbooks/new` | `MainLayout` | **Workspace (trade/institutional)** | Reparent from MainLayout with existing access checks. |
| R060 | `/login` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R061 | `/register` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R062 | `/verify-otp` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R063 | `/auth/forgot-password` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R064 | `/auth/reset-password` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R065 | `/auth/verify-email` | `MainLayout(hideNav)` | **Focused (auth)** | No public/mobile bottom bar; preserve CSRF/returnTo. |
| R066 | `/kyc` | `MainLayout(hideNav)` | **Focused (identity; HOLD)** | No fake KYC; gated until governed identity flow. |
| R067 | `/dashboard` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Task-first owner Today. |
| R068 | `/dashboard/garage` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R069 | `/dashboard/evidence` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R070 | `/dashboard/garage/:id` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R071 | `/dashboard/service-history` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R072 | `/dashboard/insurance` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R073 | `/dashboard/partsentry` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R074 | `/dashboard/listings` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R075 | `/dashboard/saved` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R076 | `/dashboard/sell-vehicle` | `DashboardLayout(role=owner)` | **Focused (seller/claim)** | Preserve account/tenant return and form state; check role guard. |
| R077 | `/dashboard/ai` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R078 | `/dashboard/referrals` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R079 | `/dashboard/communications` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R080 | `/dashboard/intelligence` | `DashboardLayout(role=owner)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R081 | `/dealer/dashboard` | `DealerCanonicalWorkspaceLayout` | **Workspace (dealer)** | Keep canonical tenant grants; no public marketing footer. |
| R082 | `/dealer` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R083 | `/dealer/inventory` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R084 | `/dealer/leads` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R085 | `/dealer/promotions` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R086 | `/dealer/analytics` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R087 | `/dealer/evidence` | `LegacyDealerRouteGate` | **Legacy gate → Workspace (dealer)** | Keep eligibility/redirect guard until safe retirement. |
| R088 | `/mechanic` | `DashboardLayout(role=mechanic)` | **Workspace (mechanic)** | Preserve actual mechanic operations; unmerged Garage features HOLD. |
| R089 | `/mechanic/work-orders` | `DashboardLayout(role=mechanic)` | **Workspace (mechanic)** | Preserve actual mechanic operations; unmerged Garage features HOLD. |
| R090 | `/mechanic/service-logs` | `DashboardLayout(role=mechanic)` | **Workspace (mechanic)** | Preserve actual mechanic operations; unmerged Garage features HOLD. |
| R091 | `/mechanic/parts` | `DashboardLayout(role=mechanic)` | **Workspace (mechanic)** | Preserve actual mechanic operations; unmerged Garage features HOLD. |
| R092 | `/mechanic/customers` | `DashboardLayout(role=mechanic)` | **Workspace (mechanic; HOLD)** | Static CRM blocked; no fabricated customer data. |
| R093 | `/insurance-dash` | `DashboardLayout(role=insurance)` | **Workspace (institutional)** | Only real authorized data and honest unavailable states. |
| R094 | `/insurance-dash/claims` | `DashboardLayout(role=insurance)` | **Workspace (institutional)** | Only real authorized data and honest unavailable states. |
| R095 | `/insurance-dash/risk` | `DashboardLayout(role=insurance)` | **Workspace (institutional)** | Only real authorized data and honest unavailable states. |
| R096 | `/insurance-dash/fraud` | `DashboardLayout(role=insurance)` | **Workspace (institutional)** | Only real authorized data and honest unavailable states. |
| R097 | `/government` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R098 | `/government/registry` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R099 | `/government/compliance` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R100 | `/government/evidence` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R101 | `/government/trust-review` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R102 | `/government/governance-review` | `DashboardLayout(role=government)` | **Workspace (institutional)** | Preserve governmental review constraints. |
| R103 | `/bank` | `DashboardLayout(role=bank)` | **Workspace (institutional)** | Keep bank-scope and actual finance state. |
| R104 | `/bank/applications` | `DashboardLayout(role=bank)` | **Workspace (institutional)** | Keep bank-scope and actual finance state. |
| R105 | `/bank/collateral` | `DashboardLayout(role=bank)` | **Workspace (institutional)** | Keep bank-scope and actual finance state. |
| R106 | `/bank/risk` | `DashboardLayout(role=bank)` | **Workspace (institutional)** | Keep bank-scope and actual finance state. |
| R107 | `/admin` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R108 | `/admin/features` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R109 | `/admin/users` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R110 | `/admin/ai` | `DashboardLayout(role=admin)` | **Workspace (admin; HOLD)** | Static operational metrics blocked until evidence-backed. |
| R111 | `/admin/moderation` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R112 | `/admin/evidence` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R113 | `/admin/vehicles/:vin/review` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R114 | `/admin/fraud-queue` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R115 | `/admin/dealer-compliance` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R116 | `/admin/verification` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R117 | `/admin/trust-review` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R118 | `/admin/governance-review` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R119 | `/admin/referrals` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R120 | `/admin/referrals/codes` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R121 | `/admin/referrals/local-leads` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R122 | `/admin/referrals/import-routes` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R123 | `/admin/referrals/marketing` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R124 | `/admin/referrals/trust` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R125 | `/admin/communications` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R126 | `/admin/communications/inbox/:threadId` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R127 | `/admin/communications/:section` | `DashboardLayout(role=admin)` | **Workspace (admin)** | Keep reviewed route/permission guards and context. |
| R128 | `/dashboard/admin/communications` | `DashboardLayout(role=admin)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R129 | `/dashboard/admin/communications/inbox/:threadId` | `DashboardLayout(role=admin)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R130 | `/dashboard/admin/communications/:section` | `DashboardLayout(role=admin)` | **Workspace (personal)** | Keep auth and vehicle context; focused Seller exception above. |
| R131 | `/admin/dealer-claims` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R132 | `/admin/dealer-research-review` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R133 | `/admin/dealer-compliance-submissions` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R134 | `/admin/dealer-legal-activation` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R135 | `/admin/dealer-full-storefront-review` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R136 | `/admin/dealer-buyer-feedback` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R137 | `/admin/dealer-vehicle-evidence` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R138 | `/admin/dealer-operating-lifecycle` | `DealerReviewerLayout` | **Review (isolated Workspace)** | Separate reviewer authority, step-up, PII and audit. |
| R139 | `*` | `—` | **Context-aware NotFound** | Never drop auth/guard context; return route remains safe. |
---

## Appendix C — Reconciliation ledger: material GLM versus Opus differences

| Ledger ID | Apparent disagreement | Resolved planning rule | Verification still required |
|---|---|---|---|
| REC-01 | GLM “139 paths + 11 wrappers + 1 redirect” vs Opus “150 route elements” | **139 includes the redirect**; total **150**. See Appendix B. | AST re-run on final implementation SHA |
| REC-02 | GLM “11 shells” vs Opus “7 shells” | Different unit: route wrapper occurrences vs effective visual regimes. Normalize to route / wrapper / component / visual variant in route authority register. | Live DOM and shell component graph |
| REC-03 | GLM “8,550 raw vs 432 token” vs Opus “8,555 raw vs 496 token” | Different source and token inclusion scopes; shared conclusion is direct palette dependence. | Versioned scanner with exact file list/regex |
| REC-04 | GLM 289 component REBUILD/KEEP dispositions vs Opus route treatments | A file-level migration treatment ≠ a URL disposition or authorization treatment. **Presentation may rebuild while behavior and URL remain.** | Per-wave target component mapping |
| REC-05 | GLM `DealerCanonicalWorkspaceLayout` KEEP vs Opus shell replacement | KEEP its proven grant/error behavior; replace visual chrome; independent auth review required. | Dealer exact-head UAT |
| REC-06 | GLM `LegacyDealerRouteGate` RETIRE vs Opus retire-now preference | **Conditional retirement only**; do not strand legacy identities or weaken redirects. | Eligibility census and safe route matrix |
| REC-07 | GLM AuthShell/ReviewShell vs Opus Public/Workspace/Focused | Three *visual* families with explicit **Auth Focused** and **Reviewer Protected** compositions and independent review security. | Owner reference samples and actual role UAT |
| REC-08 | GLM M2 wording leaves dealer operating views “inside public chrome” | **Rejected.** Business operations move to workspace chrome while URLs/auth remain safe. | Route ownership CI |
| REC-09 | GLM 22 PR records vs Opus 53 open PRs | GLM is selected, Opus is broad census. Record current exact head and accepted source lineage separately. | Fresh GitHub PR search before cuts |
| REC-10 | GLM 116 unauth screenshots vs Opus 132 local-mock captures | Different environments and test methods. Neither is a genuine real-data authenticated certification. | Authorized staging + independent UAT |
| REC-11 | GLM count of “692 rows” vs independently observed 672 substantive records | Do not use ambiguous grand totals. Audit sheet-specific rows and artifact version IDs. | Export register with explicit row definition |
| REC-12 | GLM basic bundle vs Opus lazy experiment | ~790 KB baseline and ~179 KB experimental are not directly equivalent runtime results. | Exact-build repeatable bundle + RUM/lab evidence |
| REC-13 | Opus reported older production/staging builds vs main | Treat as **reported static asset provenance**, not deployment authorization or proof of what Owner tested. | Authorized live deployment identity read |
| REC-14 | Global role switch vs context-aware business navigation | Existing global-role switch insufficient; new server-derived context manifest is *proposed*, not an existing API. | Membership-model/API contract and penetration/negative tests |
| REC-15 | Old global CSS `.glass-*` utility definition vs no usage | The definitions are obsolete; other blur/gradient panels still create visual debt. | Compiled CSS and reachable component audit |

### C.1 Research that is sufficient; research that is not

**Accepted for planning:** the accumulation history, merged versus unmerged separation, core-shell fragmentation, source styling/debt, broad functional preservation and the feasibility of Option B with selective replacement.

**Not yet accepted as product truth:** live production auth exposure; real data completeness across all roles; existence of approved Garage/Trade integrations on main; account/tenant context server manifest; native UI quality; final global benchmark superiority; runtime performance on field devices; fully accessible authenticated review workspaces. These become targeted implementation/certification tasks, not grounds for another unbounded archaeological discovery.

---

## Appendix D — Planning and authorization terminology

- **Research ACCEPT:** sufficiently reliable to support a design/architecture proposal; does **not** certify a shipped feature.
- **Owner design PASS:** reviewed composition and interaction language approved at a specific reference build and viewport.
- **Engineering ACCEPT:** scoped implementation satisfies exact-head source, behavior, tests and review criteria; may still be unmerged or unshipped.
- **Merge authorization:** an explicit source-control instruction with required independent review and checks.
- **Deployment authorization:** separate decision for a named environment, artifact SHA and scope.
- **Verified:** an actual authorized actor, evidence basis and traceable status; never an arbitrary colorful badge.
- **Tenant/organization context:** user-visible selection of an existing, server-verified membership—not a new entitlement.
- **UI convergence:** one intentional chrome and interaction grammar, consistent nav/state, true function, passed cross-route UAT—not merely equal colors.
- **HOLD:** preserve the boundary and user-visible truthful status until missing evidence, data authority or separate programme acceptance is resolved.

**Document completion condition:** This file is the **approval-ready master plan** at version `0.9.1` (v0.9.0 text plus the Part II research addendum). It is not evidence that the first engineering PR has started or that a release can happen. The Owner should comment with `APPROVE MASTER PLAN` or specific requested revisions. The Moderator then establishes the separately authorized first execution unit and its GitHub custody.
---

## Appendix E — Coordinator verification ledger (v0.9.1)

**What this ledger is.** These are claims the Opus coordinator re-checked directly against `main` @ `9f2bebfe`, separately from the research lanes that made them. Each row records what the coordinator found.
- **SC-1–SC-18** were checked during IR01, from 2026-11-09 to 2026-11-10.
- **SC-19** was checked for this revision.
- **Public-repo rule:** no credentials appear here. Security items are stated at class level.

| SC | Claim | Evidence (reproducible) | Result |
|---|---|---|---|
| SC-1 | Trade OS "Mark Zimbabwe Ready" can never succeed | `web/src/pages/diaspora/DiasporaTrade.tsx:989` sends `{nextStatus}`. `web/src/hooks/useCarUpApi.ts:1241-1245` passes it through unchanged. `backend/routes/diasporaRoutes.js:124-127` requires `status` | **Confirmed:** every click returns 400 |
| SC-2 | "Link vehicle record" lets the client assert verification | `DiasporaTrade.tsx:1015-1021` sends `verification_status:'VERIFIED'`. `backend/services/diaspora/diasporaImportOrderService.js:417-433` checks only that the payload equals VERIFIED, then persists it | **Confirmed** |
| SC-3 | Native login shows debug copy, and a test requires it | `mobile/app/(auth)/login.tsx:160`; `mobile/tests/login-submit-button.test.ts:32-33` | **Confirmed** |
| SC-4 | The web PWA is not installable | `web/src/main.tsx:23` registers `/sw.js`. There is no manifest in `web/public`, and no manifest link in `web/index.html` | **Confirmed** |
| SC-5 | The native lock screen shows the internal codename | `mobile/providers/SecureSessionProvider.tsx:105` | **Confirmed** |
| SC-6 | `Home.tsx` is dead Vite boilerplate; `Landing.tsx` is the live homepage | `web/src/pages/Home.tsx` is 20 lines. `web/src/App.tsx:17,268` routes `/` to `Landing`. `VehicleDetail.tsx` is 3,138 lines | **Confirmed** |
| SC-7 | "Switch Portal Role" can never switch to a different role | No `tenantId` is passed at `Navbar.tsx:189`, `DashboardLayout.tsx:52` or `MobileNavDrawer.tsx:62`. `backend/server.js:492-494` accepts only the user's own role or a verified tenant role | **Confirmed** |
| SC-8 | Mechanic customer records are fabricated, and "Add Customer" is inert | `web/src/pages/dashboard/mechanic/CustomerRecords.tsx:8-13` (static array); the `<Button>` at `:26` has no handler | **Confirmed** |
| SC-9 | Tokens and primitives are unchanged since the scaffold | `web/tailwind.config.js`, `web/components.json`, `ui/button.tsx` and `ui/card.tsx` each have exactly one commit, `771a3ca3`. `index.css` has `771a3ca3` and `5a22f19c` | **Confirmed** |
| SC-10 | DESIGN.md had no PR of its own | Added in `70f42ae6` (2026-08-30) on the #194 integration branch; reached `main` via `bb9d9900` (2026-09-04) | **Confirmed** |
| SC-11 | `main` took no merges between 2026-09-04 and 2026-11-08 | First-parent history runs `bb9d9900` → `9f2bebfe` | **Confirmed** |
| SC-12 | "#254 contains 26 open-PR heads" | `merge-base --is-ancestor` finds **22** open-PR heads inside `1d3b6901`; the 26 included the 4 T3–T6 milestone commits | **Corrected → 22 + 4** |
| SC-13 | The newest MVP-STAB work has no PR | `a42d3c8a` is on `origin/fix/carup-mvp-stab-01-client-readiness`, and no open PR uses that branch | **Confirmed** |
| SC-14 | Login renders "Quick Demo Access" with no gate | `web/src/pages/auth/Login.tsx:204-212`: the block renders unconditionally and its buttons post seeded identities to the real login. Present in the production bundle [R-static] | **Confirmed (source and bundle)**. Whether a backend accepts the credentials is OPEN (OV-01) |
| SC-15 | The canonical dealer shell wraps only `/dealer/dashboard` | `App.tsx:376-378`. The dealer tenant pages at `App.tsx:283-288` sit inside the `MainLayout` block opened at `App.tsx:267` | **Confirmed** |
| SC-16 | "Next Service 500 km" is fabricated | `web/src/pages/dashboard/owner/ServiceHistory.tsx:60` | **Confirmed** |
| SC-17 | There are no visual-regression assertions | No file in `web` or `tests` uses `toHaveScreenshot`, `toMatchImageSnapshot` or `pixelmatch` | **Confirmed** (0) |
| SC-18 | Tailwind v4 syntax runs on Tailwind v3, and `--accent` is brand orange | `web/package.json:93` declares tailwindcss `^3.4.19`. `outline-hidden` ×29 (e.g. `ui/popover.tsx:33`); `(--var)` utilities (e.g. `ui/chart.tsx:207`). `index.css:21` and `index.css:40` set the same orange value | **Confirmed** |
| SC-19 | Trade-profile verification defaults the trust score to ≥80 and only ratchets it up | `backend/services/diaspora/diasporaTradeProfileService.js:248-257` (privileged: admin or reviewer only) | **Confirmed** |

Remote baseline checks: `origin/main` = `9f2bebfe66a19e4d90c44085a3166562d2176626` at 2026-11-09T23:28:43Z, 2026-11-10T09:25:05Z and 2026-11-10T12:03:02Z. It was also unchanged when this revision was prepared.

---

## Appendix F — Route migration groups mapped to Appendix B and RX waves

The Opus route lane derived these groups from measured coupling: shared shells, journey links, and components shared across shells. Together they cover all 139 paths, with each path counted once. **Shell swaps are atomic (MH-01): extract the 32 workflow routes from `MainLayout` before or with its replacement.**

| Group | Appendix B rows | Routes | Proposed wave |
|---|---|---|---|
| G1 Buyer discovery and decision | R001, R002, R004–R010 | 9 | RX-03 pilot (Home → Marketplace → Vehicle Detail), completed in RX-04 |
| G2 Seller flow | R003, R074, R076, R080 | 4 | RX-04 |
| G3 Auth and identity | R060–R066 | 7 | RX-03 (login → My CarUp), completed in RX-04 |
| G4 Owner workspace | R067–R073, R075, R077–R079 | 11 | RX-03 (My CarUp pilot), completed in RX-04 |
| G5 Dealer public → claim | R011–R015 | 5 | RX-05 |
| G6 Dealer business workspace | R016–R021, R081, R082–R087 (legacy → redirects) | 13 | RX-03 pilot (dashboard → stock → enquiries); RX-05; legacy retirement in RX-08 |
| G7 Dealer review | R131–R138 | 8 | RX-03 pilot (independent reviewer); RX-05 |
| G8 Diaspora buyer journey | R037–R043, R047, R051–R053 | 11 | RX-06, after OD-11; a `main`-backed order view is possible in RX-03 |
| G9 Diaspora supplier tools | R044–R046, R048–R050, R054, R056 | 8 | RX-06 |
| G10 Diaspora operations | R055, R057–R059 | 4 | RX-06 |
| G11 Admin console | R107–R130 | 24 | RX-06; shares queue components with G12, so move them together |
| G12 Government | R097–R102 | 6 | RX-06, with G11 |
| G13 Service network (**HOLD**) | R022, R088–R092 | 6 | RX-06, after OD-12 |
| G14 Insurance and finance (**HOLD**) | R023, R093–R096, R103–R106 | 9 | RX-06: honest "not available" state (OD-14); correct LendingQueue |
| G15 Content and legal | R024–R036 | 13 | RX-04 (public shell); `/pricing` stays on commercial HOLD (TI-12) |
| G16 System states | R139 (plus FeatureState pages, the loader, `LazyRouteBoundary`) | 1 | RX-02 foundation |

Count check: 9 + 4 + 7 + 11 + 5 + 13 + 8 + 11 + 8 + 4 + 24 + 6 + 6 + 9 + 13 + 1 = **139**.

---

## Appendix G — Specialist agent brief contract (mandatory clauses)

Every brief issued to a specialist agent or engineer under CARUP-UX-REBUILD-01 must include these clauses verbatim, or reference this appendix by version. They exist to stop the pattern IR01 found: each lane invented its own shell, palette, navigation list and status map (§1.2 of the Opus report; §25).

```text
CARUP-UX-REBUILD-01 BRIEF CONTRACT (MP01 v0.9.1, Appendix G)
1. Baseline: record `git ls-remote origin refs/heads/main` before starting and at every phase
   boundary; branch from that SHA; no stacked chains; no PR-less custody; never re-author
   another branch's work — carry it by reviewed cherry-pick with provenance.
2. Authorities: read DESIGN.md, docs/marketplace/MARKETPLACE_VISUAL_DNA.md and this master plan
   (§§3, 6–11, Part II) before designing. Where they conflict, raise it; do not choose silently.
3. Presentation boundary: consume the published tokens, shells (Public / Workspace / Focused),
   navigation projection, status registry, TrustLens, MoneyDisplay, DataState and VehicleIdentity.
   You may NOT create: a layout/shell, header, footer, sidebar, navigation list, palette, colour
   literal, status→colour map, trust reader, price formatter or vehicle card. Need one? Request a
   catalogue change from the presentation lane (CODEOWNERS).
4. Routes: every new or moved route declares its shell family and registry entry in the
   route-shell register; business routes never render in PublicShell.
5. Truth: no fabricated data, counts, badges, KPIs or personas; unmeasured ≠ 0; failed read ≠
   empty; verification states name actor, source and time; never assert verification from the
   client; currency always explicit.
6. Authority: never move a server check into a UI-only check; navigation visibility is not a
   permission; tenant/organization context comes from the server.
7. Evidence: tag claims S / G / R-L / R-static / D / J / OPEN; give path:line or SHA; label any
   synthetic-session capture LOCAL-MOCK; never present mock renders as authenticated UAT.
8. Tests: behavioural and real-API contract tests for touched journeys; update any test that
   encodes a defect in the same PR; screenshots at 360, 390, 768, 1280, 1920; axe 0 serious.
9. Environments: no staging/production calls, logins or writes unless the brief names the
   environment and scope; check which CI workflows a PR's diff triggers before opening it.
10. Public repository: no credentials, exploit scripts or reproductions of unfixed defects;
    security specifics stay at class level in repo documents.
11. Output hygiene: write your deliverable file early and refine it in place; report exact
    files written, commands run with exit codes, and what remains unverified.
```

---

## Appendix H — Research evidence index (private custody)

The research materials below inform this plan. They are **not** in this repository and are **not** dependencies of it. The Owner holds them privately.
- **Integrity:** SHA-256 digests let any reviewer confirm that a copy matches the version this plan cites.
- **Repository additions:** any material later added to the repository must first be sanitized and approved under §1.2 and §14.3.

| Artefact | Producer | SHA-256 |
|---|---|---|
| `CarUp UI rebuild architecture research.md` (Opus IR01 full report: Deliverables 1–14, Appendices A–K) | Opus IR01 | `1cf2e0facec5d45c91588f1b99f52d8d665cb4fa4088b89d75e2c2b5d682138a` |
| `carup-ui-rebuild-report.html` (presentation version of the same report) | Opus IR01 | `adab6bb6e50df1688be0121e7f50d411ceebccd0feda1c29289a3310d45db316` |
| `Part 1 - Main report (Deliverables 1-14).md` (chat-attachable split) | Opus IR01 | `dd8e8ab09a30ac60a8a032bb05496145034100160cb0d6dd8f2cf8349d008c99` |
| `00-coordinator-verification-ledger.md` (SC-1–SC-18, unredacted local version) | Opus IR01 | `a07a2d6cc057877d6f6727fa05b059db4e7d39f4d48f35075943156191e5d657` |
| `CarUp-IR01-R2-Research-Report.docx` | GLM IR01-R2 | `f880d20c98335b6d4207e48874badf6057f74c1244e97ed4b6868e78fe038940` |
| `CarUp-IR01-R2-Registers.xlsx` | GLM IR01-R2 | `6b68c21c8e6537773c621c96352a10842ff3078c1c58fac25a65c470e8e0c73a` |
| `CarUp-IR01-R2-Critical-Issue-Memorandum.docx` | GLM IR01-R2 | `5689dc24431d2352d77fdd315e887113daa73f23b5c1fa4f23e7429b407dd41b` |
| `CarUp-IR01-R2-Architecture-Decision-Dossier.docx` | GLM IR01-R2 | `d55cfdb05e3998de591ef4d8eb00c65a2a58e66a3325a026530b26cc5809ff28` |
| `SHA256SUMS.txt` (GLM package manifest, incl. visual captures and repro scripts) | GLM IR01-R2 | `14232873b8d6f29c139ef3f7c90e070d1def5e4f3d2cc4e8465a9817241898f6` |

**Not for this repository:**
- the GLM `repro-scripts/`;
- the Opus runtime harness scripts;
- the screenshots;
- any unredacted ledger.

They contain working reproductions or environment detail. Keep them in private custody unless the Owner explicitly approves a sanitized subset (§1.2; Part II §29.5).
