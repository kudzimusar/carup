# CARUP-UX-REBUILD-01 · RX-01B — Design System & Experience Completion Package

| Field | Value |
|---|---|
| Assignment | CARUP-UX-REBUILD-01-RX01B-LR01 (Complete the Unified Product Design System and All Connected Experience References) |
| From | Kimmy — Lead Product Experience Designer |
| Disposition basis | Moderator ACCEPT of RX-01A (direction A · Ink Precision, B absorbed) |
| Controlling docs | MP01 v0.9.2 (PR #259, head `9940647f`) · DESIGN.md · UX-REF-01–10 (MP01 §5) |
| Prototype | RX-01B build — 28 connected screens, preview version `RX-01B-v1` (this package) |
| Date | 2026-11-11 |
| Status | **SUBMITTED FOR OWNER FINAL REVIEW — PASS / FIX / HOLD on RX-01** |
| Authority boundary | Design deliverable only. No application-code edits, DB changes, deployments, merges, security-policy changes or commercial activation (RX-01B §7). |

---

## 1. Package identity and version

- **Package:** `CARUP-UX-REBUILD-01-RX01B` · version **1.0**
- **Deliverable 1** (design-system specification): `UI_DESIGN_REFERENCE_AND_TOKENS.md` — complete production-intent token system and component contracts (intended repo path `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md`; custody transfer to Moderator pending).
- **Deliverable 2** (final connected prototype): extended CARUP EXPERIENCE prototype — **28 screens**, all UX-REF journeys, four data states + restricted/unauthorized states, direction toggle retained for regression comparison (A is the locked default). **Preview version `2d2e9a5`.**
- **Deliverable 3** (reference-screen evidence): 48 captures in `rx01b-evidence/` at the five required widths plus populated/empty/loading/error/unauthorized states and the Trade-context gate state (index in §4).
- **Deliverable 4** (navigation & context specification): §5.
- **Deliverable 5** (native design appendix): §6.
- **Deliverable 6** (engineering handoff contract): §7.
- **Deliverable 7** (decision & closure register): §8.

---

## 2. UX-REF-01–10 completion matrix

| Ref | Journey | Prototype screens | Status |
|---|---|---|---|
| 01 | Home → Marketplace → search → Vehicle Detail | `home`, `marketplace`, `vehicle` | **Complete** (RX-01A, preserved) |
| 02 | Vehicle Detail → Passport/Trust → save/enquiry | `vehicle`, `passport`, save toggle, `login` interruption | **Complete** (preserved) |
| 03 | Login return → My CarUp → My Garage | `login` (returnTo), `mycarup`, `garage-m` | **Complete** (preserved) |
| 04 | Guest Sell → account → Seller Studio → draft/resume | `seller`, `seller-form`, draft card in `garage-m` | **Completed in RX-01B**: intent router re-stated as one studio, one step model; autosave/receipt copy; Form 27 declared-evidence chip |
| 05 | Dealer public profile → claim → Today/stock/enquiries | `dealer-profile`, `dealer-claim`, `dealer-today`, `dealer-stock`, `dealer-enquiries` | **Completed in RX-01B**: research-vs-verified split, claim stepper with independent-review handoff, workspace link-through |
| 06 | Garage request → queue → work order → schedule → record | `garage-book` (request + scheduling), `garage-queue`, `garage-job` | **Completed in RX-01B**: slot picker with taken-slot honesty; queue by stage; work order with checklist/timeline/PartSentry record; unmerged commercial flow explicitly HELD (OD-12) |
| 07 | Trade RFQ → import order → documents → shipment/CAP | `trade-rfq` (quotes + honest landed-cost), `trade` (lifecycle rail, docs, CBCA, CAP events, advisory costs) | **Completed in RX-01B**: RFQ→quote→convert chain; one lifecycle projection; duty/cost "not shown > fabricated" |
| 08 | Reviewer queue → evidence → decision → audit | `reviewer-queue` (governed nav), `reviewer-stepup` (explicit step-up), `reviewer` (evidence/decision), `restricted` (boundary) | **Completed in RX-01B**: reviewer-only navigation with no org context; step-up screen; decision panel with 40-char reason; dealer session sees honest 403 |
| 09 | Object-linked communications | `comms` (thread list + conversation), `native-msg` | **Completed in RX-01B**: object chips, delivered/failed/sent/pending states, channel availability chips |
| 10 | Native owner/vehicle task | `native-home`, `native-vehicle`, `native-msg` | **Completed in RX-01B**: vehicle home, documents, odometer/document capture, truthful unknowns, safe web handoff |

All references share one identity, one status kit, one type system (§3 token spec) — verified by rendering every screen in both remaining direction skins and four data states with zero console errors.

---

## 3. RX-01A detail resolutions (§3.F of the brief)

| # | Item | Resolution |
|---|---|---|
| 1 | JetBrains Mono vs IBM Plex Mono | **JetBrains Mono** locked as the single reference monospace; prototype updated to match. Resolved in token spec §2. |
| 2 | Illustration vs photography hero | **Illustration-led now; photography bake-off before RX-02.** Rationale: illustration guarantees tone/crop/aspect discipline and zero licensing/performance risk at launch (390px LCP budget); photography remains a token-level swap (hero art slot) once a media pipeline exists. Recommended production approach: commission/curate photography against the RX-01A composition rules, A/B with real listing media before token lock in RX-02. Not a reopening of identity. |
| 3 | Prototype navigation → real route/context authorities | Full mapping in §5, derived from MP01 Appendix B (139-path register) and Appendix F route groups. No prototype destination exists outside the register; reviewer benches map to R131–R138 only. |
| 4 | Per-screen state & recovery specs | Every screen renders Populated/Empty/Loading/Error via the `DataState` kit; recovery copy specified in `UI_DESIGN_REFERENCE_AND_TOKENS.md` §6.5; evidence in §4. |
| 5 | Five-width review matrix | Delivered: 360×800, 390×844, 768×1024, 1280×800, 1920×1080 (§4). |
| 6 | Truthful claims | Trust scores, forecasts, KPIs, delivery and cost states all render from labeled fixtures with actor/source/time or explicit unknowns; no verification, payment, delivery or rating is asserted anywhere. Landed cost deliberately not shown where no method exists (OD-15). |
| 7 | Contrast/keyboard/touch/mobile readability | Token rules: action pairs ≥4.5:1; 44px targets; focus rings; skip links; single active nav; `role=alert` errors; `inert` off-canvas — all in token spec §5. Prototype verified visually at 360px (no overflow, readable at 200% zoom intent). |
| 8 | Dark workbench comfort | Workspace chrome is ink by default in both directions; body surfaces stay warm-paper for glare balance across multi-hour sessions; optional body dark-toggle specified (D-07). |

---

## 4. Deliverable 3 — Five-width evidence index (`rx01b-evidence/`, 48 captures)

| Width | Captures |
|---|---|
| 360×800 | `w360x800-home`, `w360x800-marketplace`, `w360x800-dealer-profile` |
| 390×844 | `phone-*`: home, marketplace, vehicle, passport, login, mycarup, seller, dealer-profile, dealer-claim, garage-book, reviewer-stepup, native-vehicle, native-home |
| 768×1024 | `w768x1024-dealer-today`, `w768x1024-native-home`, `w768x1024-seller` |
| 1280×800 | `w1280x800-dealer-stock`, `w1280x800-comms`, `w1280x800-reviewer-queue`, plus `desk-*` set at 1440 (dealer today/stock/enquiries, comms, reviewer queue/reviewer, restricted, trade-rfq, trade, garage queue/job, start) |
| 1920×1080 | `w1920x1080-trade`, `w1920x1080-trade-rfq`, `w1920x1080-garage-queue` |

**State evidence:** `state-dealer-stock-empty`, `state-dealer-stock-error`, `state-comms-error`, `state-marketplace-empty`, `state-reviewer-queue-loading`, `state-restricted-unauthorized`, `state-dealer-rail-no-trade-context` (S06 — Trade-gate proof).

Every capture renders the prototype chrome (direction/state labels + fixture disclaimer) so evidence is self-describing. All data labeled illustrative fixtures.

---

## 5. Deliverable 4 — Navigation & context specification

### 5.1 Route-to-shell authority map (consuming MP01 Appendix B — no competing system proposed)

> **ICR01-C03 reconciliation.** The table below is the summary; the exact per-route authority is the companion register `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` (139 rows, one per Appendix B path, group memberships verified against Appendix F: G2 = R003/R074/R076/R080 only; G4 = R067–R073, R075, R077–R079; G7 = R131–R138; R139 NotFound; 403 is a response state, not a route).

| Shell family | Route groups (App. F) | Routes (App. B, exact) | Prototype proof |
|---|---|---|---|
| PublicShell | G1 buyer discovery, G13/G14 public entries, G15 content/legal | R001–R002, R004–R010, R013, R022–R023, R024–R036 | `home` `marketplace` `vehicle` `passport` `dealer-profile` |
| WorkspaceShell(personal) | G4 owner (+ G2 seller-adjacent) | R067–R075, R077–R080 (R076 is Focused seller) | `mycarup`, `garage-m` |
| WorkspaceShell(dealer) | G5–G6 | R011–R012, R017–R021, R081; legacy R082–R087 behind `LegacyDealerRouteGate` until RX-08 | `dealer-today/stock/enquiries` |
| WorkspaceShell(garage/mechanic) | G13 | R088–R092 (R092 contained: honest "not available", TI-04) | `garage-queue`, `garage-job` |
| WorkspaceShell(trade) | G8–G10 | R038–R056 (R037 public landing; R039 focused import flow) | `trade`, `trade-rfq` |
| WorkspaceShell(institutional/admin) | G11–G12, G14 | R093–R127 (R128–R130 ride WorkspaceShell(personal) per Appendix B) | (grammar identical; screens land in RX-06 waves) |
| FocusedShell(auth/seller/claim/identity) | G2–G3, G5 claim entries, G8 import flow | R003, R014–R016, R039, R060–R066, R076 | `login`, `seller`, `seller-form`, `dealer-claim`, `garage-book` |
| ReviewWorkbench (protected composition, not a dealer action) | G7 | R131–R138 | `reviewer-queue`, `reviewer`, `reviewer-stepup` |
| Context-aware NotFound | G16 | R139 | `restricted` (honest 403 response state, not the 404 route) |

### 5.2 Behavior rules (presentation layer only — Feature Registry + Navigation Manifest remain the authorities, NC-05)

1. **One projection feeds every surface** (mega-menu, drawer, bottom bar, rail, footer, native tabs). The SessionWorkspaceManifest (MP01 §3.4) is display/navigation metadata only — never an authorization grant; endpoints keep enforcing independently.
2. **Public mobile tab bar:** five manifest-derived slots — Home · Buy · Verify · Sell · My CarUp; safe-area aware; hidden in Focused flows (auth, sell, claim, review decisions) and never obscures focused content.
3. **Public footer at all widths** (OD-06): full hierarchy via accessible accordion below 1024px.
4. **Workspace:** 224px rail ≥1024px; below 1024 rail hides behind explicit menu; below 720 the workspace uses topbar + task-aware bottom nav; tables become list/detail — mobile layouts are composed, not compressed (verified at 360/390). **Rail destinations are entitlement-filtered from session context** (SessionWorkspaceManifest): the **Import orders** destination renders only when the session carries authorized Trade context (importer/operator authority); when absent it disappears — never a dead stub. Cross-role visibility is never hardcoded (NC-05, NC-10). Gate evidence: `rx01b-evidence/S06-dealer-rail-no-trade-context-1440x900.png`.
5. **Org/branch context:** masthead shows verified org + branch at all times; switching posts the selection and reloads context-scoped data; a missing/expired context renders a permission/status page, never stale data; the 409 multi-dealer case renders a context picker (NC-02); no silent role mutation (NC-04).
6. **Login interruption & return:** Focused auth preserves path + query + context (`returnTo` carries `?vin=`, filters, draft id — NC-08); post-login lands back in the originating object context; no bottom bar during auth.
7. **Empty/disabled/unsupported destinations:** planned-only features never render as live links (NC-10); held capabilities render honest "not available" states with the route kept (OD-14); no dead settings links.
8. **Reviewer separation (binding):** reviewer benches are reachable only through the protected review composition — separate route authority (R131–R138), step-up, PII masking, no org/branch masthead, sessions expire independently. **A reviewer destination never appears as an ordinary dealer action** — the dealer rail does not link review; a dealer-staff session hitting a bench gets the `restricted` 403 treatment, not a blank page (fixes MH-11/TI-27 classes). **Protected review sessions carry their own identity chrome:** "Independent review · Reviewer · step-up active" masthead, rail ending in Exit review session (no dealer account identity), util footer "All actions audited · Session: independent review · No org/branch context carried", and no dealer workspace actions (no Export / + Add vehicle). No dealer identity, organization, branch or business context renders during protected review (verified on `reviewer-queue` and `reviewer`).

---

## 6. Deliverable 5 — Native design appendix (conceptual spec; not a certified implementation)

**Status honesty:** the in-prototype native screens are HTML design proofs. No Expo screen is claimed implemented or working until the Native Engineer certifies it (RX-07, U-12, TI-15 gates).

**Supported native destinations (capability-map entries only, NC-07):** Garage (owner vehicles) · Marketplace browse · Vehicle/Passport view · Messages · Account. Everything else is a safe web handoff or an honest unavailable state.

- **Tab navigation:** governed tabs (Garage · Marketplace · Verify · Messages · More), never hidden/disabled per Apple HIG; tabs derive from the certified capability map, not a static shell.
- **Owner/vehicle workflows:** vehicle home (`native-vehicle`) — documents with expiry + truthful unknowns; odometer camera capture feeding service forecasts (forecast stays "insufficient data" until enough logs exist); document upload with scan status; sell entry handoff.
- **Component/token adaptation:** token JSON package via RN adapter (spec §9); NativeWind/Tailwind theme generated from the same table; 0 hex literals; Inter → system-equivalent stack with identical scale; JetBrains Mono for VIN/refs.
- **Platform behaviors:** safe-area insets; system back/gesture returns to governed tab (no dead ends); keyboard avoids sticky CTA; camera flows use native permission priming; session/step-up parity with web, CSRF-aware mutations (TI-16).
- **Web handoff:** deep links carry object context (VIN, order, thread) and require normal web sign-in; never carry tokens or step-up state in URLs.

---

## 7. Deliverable 6 — Engineering handoff contract (summary per major surface)

Full contract template is MP01 §7. Per-surface summary (source design → runtime component → interaction → dependency → boundary → tests → preservation):

| Surface | Runtime component | Key API/state dependency | Authorization boundary | Required tests | Functional preservation |
|---|---|---|---|---|---|
| Home/Marketplace/Vehicle | PublicShell + VehicleIdentity card/row, TrustLens, MoneyDisplay | listings/search APIs, `marketplaceParams` URL contract, saved vehicles | guest-readable; save needs session | FP-01 contract + URL/filter/save round-trip at 5 widths | marketplaceParams, saved/compare, price+currency |
| Passport | VehicleIdentity header + LifecycleRail + EvidenceLine | canonical Trust projection, freshness/version | public; PII fields masked | FP-02 provenance drift tests; negative: stale/unverified/conflict | no invented verdicts; plate/chassis privacy |
| Login/auth return | FocusedShell(auth) + forms | session API, CSRF, `returnTo` path+query | step-up capable | recovery negative paths (TI-11), draft survival (TI-24), token replay | no demo controls (TI-01), no credentials in bundle |
| Seller Studio | FocusedShell(flow) + Stepper + MediaUploader | `guestSellDraft`, `/vehicles/add`, media scan, idempotency | seller authority 409s | FP-03: draft/media across auth+refresh+failure; duplicate/409 | no lost drafts, no false publication |
| Dealer profile/claim | PublicShell profile + FocusedShell claim | research profile service, claim API, evidence upload | claim requires account; review separate | FP-05: claim→review→activation chain | reviewer independence, media publication gating |
| Dealer Today/Stock/Enquiries | WorkspaceShell(dealer) + TableWorkbench + DataState | tenant inventory/enquiries APIs, verified tenant context | tenant-scoped; staff roles | FP-05; cross-tenant negatives; reload/revoked-grant | #258 behavior baseline frozen |
| Garage queue/work order | WorkspaceShell(garage) + TableWorkbench + LifecycleRail | work-orders/service logs APIs **with verified tenant (TI-19 baseline)** | garage tenant; held flow gated | FP-06 with working tenant baseline; no fabricated CRM | main-backed functions keep operating |
| Trade RFQ/order | WorkspaceShell(trade) + ObjectHeader + LifecycleRail + doc checklist | diaspora import order service, **one** status projection | importer/operator roles | FP-08 transition incl. ZIMBABWE_READY negative (TI-08), docs checklist truth | UUIDs/status semantics; no client VERIFIED (TI-02) |
| Reviewer queue/bench/decision | Review composition + DecisionPanel + evidence viewer | review queue, step-up, audit | **independent reviewer; server-enforced** | step-up negatives, self-approval refusal, 40-char reason | DB-enforced independence preserved verbatim |
| Communications | MessageContext thread kit | threads/transport state APIs, provider registry | object-level access | FP-10: queued→sent→delivered/failed; channel capability | failure ≠ empty (TI-13/TI-23) |
| Native vehicle/owner | RN token adapter + native screens | session, camera, odometer endpoint | native session parity | device/sim back/gesture, capability-map parity | no fabricated states (TI-15) |

All screens: 5-width screenshots, axe 0 serious, keyboard walkthrough, reduced-motion pass (CI-05/06).

---

## 8. Deliverable 7 — Decision & closure register

| ID | RX-01A item | RX-01B resolution | Status |
|---|---|---|---|
| D-01 | Direction adoption | **CLOSED — Direction A adopted**, B absorbed as public warmth variables; B skin retained in prototype only for regression comparison. Recommendation executed per Moderator disposition. | CLOSED |
| D-02 | Hero art direction | **Resolved as recommendation**: illustration-led now; photography bake-off against composition rules before RX-02 token lock (spec §3.F.2). | AWAITING OWNER CONFIRM |
| D-03 | Workspace dark chrome | **CLOSED** — ink workspace chrome locked across all workspace variants (spec §1.4); body dark-toggle specified. | CLOSED (design) |
| D-04 | Stepper as single multi-step container | **CLOSED** — one Stepper contract for seller/claim/auth/recovery flows. | CLOSED |
| D-05 | Inter-only + tabular + mono split | **CLOSED** — 3 shipped weights; tabular numerals mandatory; JetBrains Mono locked. | CLOSED |
| D-06 | Status/trust grammar | **CLOSED** — one registry, four-state DataState everywhere, actor·source·time evidence lines. | CLOSED |

**Remaining Owner decisions before implementation:** OD-07 final token swatch/type sign-off (incl. dark-mode action orange); OD-15 price-context method authority; OD-16 review-independence scope; OD-11/OD-12 Trade/Garage source acceptance (design holds its boundary until then).

---

## 9. Remaining dependency list (categorized)

| Category | Dependency |
|---|---|
| DESIGN | Hero photography bake-off (before RX-02 lock); icon set production; motion micro-spec; illustration commission |
| SOURCE | OD-11 Trade lineage (#207→#243→#244) custody; OD-12 Garage services acceptance; TI-15 native remediation extraction (`896ee73f`) |
| SECURITY | SessionWorkspaceManifest API/security review (MP01 §20); OD-16 independence scope; step-up policy beyond dealer programme; OV-01 demo-credential ops attestation |
| DOMAIN | Working tenant baseline for mechanic APIs (TI-19/FP-06); Trade ZIMBABWE_READY contract fix (TI-08); communications object-link columns (§22.6 data-contract change); OD-15 landed-cost method authority |
| OWNER POLICY | OD-06 footer/mobile policy ratification; OD-10 native scope + PWA installability; OD-14 seed-only content treatment; commercial copy truth (TI-12) |

---

## 10. Authority confirmation

Explicit confirmation of RX-01B §7: **no production React or Expo code was modified; no PRs opened or merged; no databases changed; no services deployed; no authorization altered; no payments activated; no dealers published.** All prototype data is clearly labeled illustrative fixtures; the interactive prototype is a design reference and is not presented as authenticated functional UAT. Repository mutation awaits authorized document custody with the Moderator.

**Readiness statement:** RX-01 is now an implementation-ready product-design authority pending the Owner's final PASS/FIX/HOLD. On PASS, RX-02 may proceed against `UI_DESIGN_REFERENCE_AND_TOKENS.md` and the §7 handoff contract, with functional preservation (FP-01–12) and security boundaries as stated.

— Kimmy, Lead Product Experience Designer · CARUP-UX-REBUILD-01
