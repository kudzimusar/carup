# CARUP-UX-REBUILD-01 — Brand & Media Asset Custody and Placement Register

**Document ID:** CARUP-UX-REBUILD-01-BA01
**Programme:** CARUP-UX-REBUILD-01 / MP01
**Status:** PROPOSED — documentation-only asset-readiness and integration plan; NO artwork approved, copied or deployed by this document
**Review date:** 2026-11-12
**Parent authority:** CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md §10.4 (MP01 v0.9.3 draft), DESIGN.md and Marketplace Visual DNA
**Evidence classification:** Drive folder metadata/read (not asset-byte inspection) and GitHub source at main 8bc00bd75f5285997065872514d10db8fbecd24f

## 0. Correction R3 (2026-11-16) — supersedes the rows and gates named below

Reason: Owner visual FIX of 2026-11-16 ("We are still seeing too much of the previous UI") and Moderator addendum RX03-R3-ADDENDUM-03 §8. Where this section conflicts with §1–§6, this section governs. Semantic tokens, accessibility rules, truth contracts and the differentiation rules in §4 are unchanged.

| Item | Was | Now |
|---|---|---|
| Source (§1, BA-G0) | "Zero directly accessible files"; BA-G0 open | **Satisfied for Option 5.** The R1/R2 packages are ledgered by SHA-256 in `web/src/assets/brand/option5/ASSET_LEDGER.json` (RX03-P1a). The Drive copies are byte-identical to R1. The Owner's visual PASS of the lockup in context remains the BA-G2 decision. |
| BA-02 phone masthead / drawer | "Compact approved mark in mobile masthead/drawer" | **The stacked Option 5 lockup (orange roofline above the wordmark) at every width,** including the phone header and the Profile sheet. The wordmark-only export and the horizontal lockup both read as the old text logo at header size (Owner, 2026-11-16). A compact mark is used only where a square icon is required (favicon, app icon). |
| BA-03 / BA-04 / BA-05 | Approved lockup, unspecified variant | The stacked lockup: reversed on the navy footer and on auth pages, light in the masthead, the dashboard sidebar and the unified-shell BrandMark slots. |
| BA-06 favicon | Earliest wave RX-07 | **Browser favicon (app-icon SVG) and the 180 px apple-touch icon ship in RX-03**, behind the P1b chrome release switch and byte-verified in the running build. The PWA manifest icon set, the native app icon and the splash stay in RX-07 (BA-07). |
| Delivery | Not specified | Every Option 5 file is shipped verbatim (`?no-inline`). Inlined SVG data URIs are re-encoded by the bundler, so the served bytes would no longer hash to the package. |
| Target design | Not stated | The design target is the **running RX-03 Open/Pocket Showroom** (P1a pages + P1b chrome). The old Home/Marketplace compositions, the older white/card-heavy templates and superseded native navigation are **not** targets. |
| Custody line (§6) | "his current S1-3 PR #264" | Stale: S1-3 is superseded. Kimi's current RX-03 work is local P1a/P1b, held unpushed until D6 (#275) makes ordinary PR checks safe. |

## 1. What is actually available — do not mistake folders for finished artwork

Connected Google Drive contains a CarUp / CarUp Media Files library, with a deliberate taxonomy:

- 00 Brand Identity & Master Assets → 01 Approved Master Logos; 02 Logo Variations; 04 Brand Guidelines; 05 Source Vector Files.
- 02 Website & Web → 01 Header & Navigation Logos; 02 Footer Logos; 03 Favicons; 05 Open Graph & Link Previews.
- 01 Native Apps & Product; 10 Photography & Media Library; 12 Approved Exports & Delivery.

**Read result, 2026-11-12:** the four named master/variation/guidelines/vector folders and the four named website-logo/favicon/Open-Graph destination folders returned **zero directly accessible files**. The overall media library has folders, but their names are not evidence of approved image binaries. No logo design, file size/dimensions, hash, color variant, rights or signed approval is verified. Re-inspect after the actual artwork is supplied. Private Google Drive IDs/links are retained in the Moderator's private source custody, **not published in this repository**.

**Repository baseline:** Navbar, Footer and DashboardLayout build a faux CarUp mark from a Lucide car glyph, orange/amber gradient and styled text. Source examples: web/src/components/layout/Navbar.tsx lines 201–210, Footer.tsx lines 68–80, DashboardLayout.tsx lines 120–130. The email-assets/manifest.json has logo_artwork=null and wordmark_mode=text. A 24×24 favicon.svg is **not approved logo artwork**. No source on main proves that a new branded lockup is available.

**Do not call existing vehicle-image empty states, dealer/OEM logo placeholders or evidence-document placeholders CarUp corporate-logo slots.** Those represent different sources, rights and truth contracts.

## 2. Required acceptance record for EVERY future brand asset

Each asset must have a non-sensitive register entry with: asset ID/version; descriptive original filename; Owner-designated private source folder reference (never public Drive ID); binary SHA-256; MIME/type; intrinsic dimensions/viewBox and transparency; light/dark/mono intent; clear-space/minimum-size and allowed background; export transforms; ownership and distribution licence; named Owner visual approval with date/reference; approved repo/CDN destination; responsible implementation lane; usage surfaces; fallback; tests; status. A filename or folder label saying "approved" does **not** substitute for Owner visual acceptance and file-byte verification.

Allowed status vocabulary: MISSING_SOURCE → CANDIDATE_RECEIVED → RIGHTS_VERIFIED → OWNER_VISUAL_APPROVED → OPTIMIZED_STAGED → CI_VERIFIED → PILOT_UAT_ACCEPTED → RELEASE_APPROVED. Not an automatic chain; every transition has evidence.

If a proposed asset is SVG, sanitize and reject active content, scripts, external image links, embedded tracking, foreignObject and unsafe dependencies; test accessibility, rendering and minimum size. Prefer vector for on-screen brand marks if suitable; create raster variants only from approved source files and preserve traceable hashes. No invented redraw or generic car icon may be silently labelled the Owner-approved CarUp logo.

## 3. Placement and wave matrix

| ID | Placement / current code | Intended branded presentation | Earliest integration wave | Mandatory evidence and guard |
|---|---|---|---|---|
| BA-01 | Canonical logo asset authority; no verified artwork | Master lockup, compact emblem, light/dark/mono variants and optional wordmark; one BrandIdentity/BrandMark rendering contract | RX-02 source custody + Owner selection | Exact asset bytes, licence, visual PASS, variant/background mapping; no different local logos |
| BA-02 | Public Navbar has car-glyph/gradient faux logo | Approved lockup at desktop/tablet header; compact approved mark in mobile masthead/drawer | RX-02 shared PublicShell / RX-03 pilot | Tested link, alt text, zoom, 360–1920 widths; no layout shift or truncated mark |
| BA-03 | Footer has independent faux logo | Authorized reversed/mono lockup on dark public footer; footer still accessible on mobile | RX-02 PublicShell / RX-03 | Contrast, 360/390 footer visibility, link consistency; no misleading company claims introduced |
| BA-04 | DashboardLayout and other role/Dealer/Trade chrome use independently composed identity | One small approved brand mark in WorkspaceShell, with domain/tenant identity kept distinct | RX-02 WorkspaceShell, then RX-03/05/06 | Do not remove role/tenant/reviewer gating; no competing dealer-workspace brand |
| BA-05 | Auth, onboarding, reviewer and focused tasks | Minimal approved mark/wordmark in FocusedShell where appropriate, never an oversized hero | RX-02 shell / RX-03 pilot | Return-to and focus intact; secure flows remain independently governed |
| BA-06 | Existing favicon.svg is a tiny generic icon, not a logo | Owner-approved favicons, touch icons and PWA manifest identities derived from approved master | RX-07 after source approval | Real PNG/ICO/SVG formats and sizes; cache/install checks; no renaming SVG bytes .ico |
| BA-07 | Native/Expo navigation, splash and app icon not audited to exact placements | Native-appropriate app mark, launch imagery and notification assets; do not copy full web masthead | RX-07 | Platform icon/safe-area guidelines, device emulator evidence, separate native release authority |
| BA-08 | Open Graph/social/link-preview folders empty in Drive audit | Correct preview mark/graphic with dimensions/crop and metadata on relevant public pages | RX-03 reference then RX-07 SEO/marketing | Publicly reachable immutable asset, tested social-card metadata; avoid fake vehicle photographs |
| BA-09 | Email logo_artwork=null; wordmark_mode=text | Approved horizontal PNG lockup and dark/light variants served from a durable CarUp-controlled email-assets URL | Communications lane after artwork approval | Preserve fallback to text; update manifest+allowlist+email tests; never promote favicon or preview URL into email |
| BA-10 | Home/campaign hero and educational media are separate from listings | Licensed/Owner-approved editorial/media where useful, with distinct provenance and honest visual hierarchy | RX-03/04 | Marketing imagery must not masquerade as a real listed vehicle, Trust evidence or actual showroom stock |
| BA-11 | Printable documents, receipts, public reports and in-app export screens | Reuse approved mark in governed templates only, respecting legibility/legal context | RX-04–09 depending on template | Content/finance/authority review, print/PDF proof, stable identity |
| BA-12 | Dealer/garage/OEM/insurer/partner logos have separate rights/approval contracts | Render only the *actual* party's approved supplied logo, otherwise honest initials/no-image | Their domain programmes, not CarUp-logo rollout | Never use CarUp mark as a dealer/OEM stand-in or imply franchise/endorsement; preserve dealer reviewer/rights gates |

## 4. Source storage and rendering contract

- **Google Drive is the Owner's source-custody library, not a production hotlink or unauthenticated runtime image CDN.** After explicit approval, an authorized integration engineer imports derived, safe, auditable assets into a versioned public asset location (for example, web/public/brand/ with an immutable manifest, or a controlled media/CDN path). Proposed paths are not evidence of existing files.
- A single typed brand asset manifest maps contexts such as public-header, dark-footer, workspace, focused, favicon, PWA, native and email to approved asset IDs/variants. A shared BrandIdentity component consumes this manifest; functional navigation and shell ownership remain unchanged.
- Explicit loading, decoding, dimensions, fallback and low-bandwidth behaviors. Missing or failed artwork must produce honest, accessible CarUp text identity, not broken images, a third-party logo, random emoji or an unlicensed vehicle photo. Never let fallback change data truth.
- Application and marketing brand assets are **not** listing images, documentary evidence, private uploads, dealer storefront media, OEM/partner logos or payment-provider marks. Maintain separate storage/rights/verification policies.
- Export rights must cover distribution and any public repository/CDN copies; if this is not approved, keep files in private custody and use a separately approved delivery mechanism. Never commit raw confidential brand packages, metadata with secrets, or protected Drive links.

## 5. Actionable gate sequence (parallel to Kimi's S1-3)

**BA-G0 — Source retrieval and decision (NOW, moderator + Owner):** identify where actual final artwork files exist; obtain files/accessible folder and state which variant is canonical; check provenance, licence and explicit Owner visual PASS. The Drive skeleton currently has no approved originals. If missing, mark BA-01 through BA-09 BLOCKED_ASSET and continue other independent engineering.

**BA-G1 — Packaging and component proof (RX-02 / S1-4, one presentation writer):** for files approved in G0, record SHA-256 and manifest, sanitize, derive exports, test a single BrandIdentity component with light/dark/background variants. Make source-package review an explicit prerequisite for replacing faux logos, **not** for writing the rest of the shell code.

**BA-G2 — Cross-shell visual pilot (RX-03):** same real logo across Home/Marketplace/Vehicle Detail, public nav/footer, My CarUp, Dealer and reviewer/Trade shell. Capture 360/390/768/1280/1920 screenshots, keyboard/zoom/contrast, image-load failure and mobile safe-area checks. Owner gives PASS/FIX/HOLD to actual rendered compositions. Record primary asset hash and exact runtime SHA.

**BA-G3 — Connected surfaces (RX-04–07):** Seller, Dealer, Garage, Trade, notifications/email, social/PWA and native app identity consume the same approved vocabulary; separate release/gateway certification for outbound email and app store packages.

**BA-G4 — Final acceptance (RX-09):** no faux CarUp car-icon logo where an approved mark is required; no unapproved image files, dead source URLs, wrong dark/light variant, shifts, 404s, unsafe SVG, broken responsive crop or spurious partner association. Evidence at exact deployment SHA and real browser/device coverage; independently reviewed before Owner deployment permission.

## 6. Stop / rollback / coordination

**STOP for branding rollout:** no byte-verified approved source, ambiguous canonical variant, missing rights/distribution authority, broken image integrity, accessible name/contrast failure, email-client unsupported format, undocumented asset replacement, client-only rewriting of protected content.

**ROLLBACK:** presentation-flag or asset-manifest version reverts to prior *truthful text identity* without touching domain data, API permissions, transactions, dealer publication, payments or evidence records. Do not reinstate misleading fabricated logo claims.

**Custody:** Kimi remains the RX-02/03 presentation-engineering lead. This is a separate **documentation/asset-custody lane**, not a competing write to his current S1-3 PR #264. No runtime code, logo files, main merge or production deployment is authorized by this record.

**Decision note:** Owner's 2026-11-12 request is authority to add the brand/media requirement to the programme, **not** approval of an unseen logo design or upload of artwork to a public repository. MP01 OD-18 remains pending asset and variant acceptance.
