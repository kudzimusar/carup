# CARUP-UX-REBUILD-01 · RX-01B-ICR01 — Final Handoff Closure Report

**Prepared by:** Kimmy — Lead Product Experience Designer
**Date:** 2026-11-11 · **Moderator disposition executed:** REMEDIATE — BOUNDED CORRECTIONS ONLY
**Scope guard:** visual direction (Ink Precision, Direction A) **preserved**; no redesign, no new design cycle, no application-code mutation, no merge, no deployment, no commercial action.
**Governing plan:** MP01 v0.9.2 · `docs/product-experience/CARUP_UNIFIED_EXPERIENCE_REBUILD_MASTER_PLAN.md` @ PR #259 head `9940647f`

---

## 1. Exact source and artifact identities

### 1.1 Sources of truth (read-only)

| Identity | Value | Nature |
|---|---|---|
| Master plan | MP01 v0.9.2, PR #259 head `9940647ff091e46a03cf5480e046f95b34788cdf` | **Git commit SHA** (verified live via repository read at this head) |
| MP01 file SHA at head | `57236b5a567786d073c51c062a7a0ede10a1663f` | Git blob SHA of the plan file |
| Governing design authority | `DESIGN.md` (reached main via PR #194) | Repository document |
| Baseline | `main@9f2bebfe66a19e4d90c44085a3166562d2176626` | Git commit SHA |

### 1.2 Design artifacts delivered under ICR01 (corrected package)

| Artifact | Identity | Bytes | SHA-256 (truncated) |
|---|---|---|---|
| Interactive prototype (corrected) | `carup-rx01a-prototype.html` — review version **`a56e4f3`** (supersedes `e1ffca4`, which superseded `2d2e9a5`) | 116,047 | `106901355f37…30f0` |
| Reviewable preview | `app/index.html` (byte-identical copy of the prototype) | 116,047 | `106901355f37…30f0` |
| Token & component contract | `UI_DESIGN_REFERENCE_AND_TOKENS.md` v1.1 (S0-corrected compositing footnotes) | 16,339 | `94d60605…68997` |
| RX-01B completion package (route table corrected) | `CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | 21,227 | see manifest |
| Route-to-shell authority register | `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` (139 rows) | 27,585 | `aa0e95c1…d75aa` |
| Contrast checker (machine-checkable) | `carup-contrast-check.py` (S0-corrected: dark soft tints composited onto `#13233D`; failing regression gate) | — | see manifest |
| Contrast matrix | `rx01b-contrast-matrix.json` / `.csv` (45 shipped pairings, S0-corrected) | — | see manifest |
| Evidence package | `rx01b-evidence/` — 48 PNG + `INDEX.md` + `capture-index.json` | — | see manifest |
| Checksum manifest | `RX01B-ICR01-SHA256MANIFEST.txt` — **60 entries, all verify `OK`** (48 captures + 12 non-image artifacts incl. `VERIFICATION.md`, which shipped in prior bundles but was never manifested; count reconciled in S0-B) | — | self-authenticating via `sha256sum -c` |

### 1.3 Identity correction (C01 root cause)

The identifier **`2d2e9a5`** used in the RX-01B return is a **platform preview version ID** assigned by the design-preview version manager — it is **not** a Git commit SHA, was never claimed to be one, and must not be cited as repository provenance. Repository provenance is cited only as in §1.1. Preview version IDs are content-pinned by the SHA-256 manifest, so the design evidence is reproducible even outside the preview platform.

---

## 2. C01–C06 closure evidence

### C01 — Source/evidence custody and artifact identity · CLOSED

- Root cause recorded: version ID vs Git SHA conflation risk (§1.3).
- **48-capture evidence package** from the corrected source bytes (`rx01b-evidence/`, `INDEX.md`, `capture-index.json`): P01–P28 all screens @390×844; D01–D06 workspace chrome @1440×900; W01–W08 five-width matrix (360/768/1280/1920); S01–S06 data states incl. loading/empty/error, the honest-403 boundary, and the Trade-context gate state.
- **SHA-256 checksum manifest** over prototype + app copy + all docs + register + checker + matrix + evidence indexes + `VERIFICATION.md` + 48 captures = **60 entries, all verified OK** (`sha256sum -c RX01B-ICR01-SHA256MANIFEST.txt` → 0 failures; entry count reconciled with §1.2).
- Precise versioning: token doc v1.1 (supersedes v1.0 with a change note); prototype review version `a56e4f3`; older RX-01A preview (`ea13ba5`, 17-screen concept) is **superseded** and was never substituted for RX-01B evidence.

### C02 — WCAG 2.2 AA contrast failures corrected · CLOSED

Four failing pairings found by evidence-based audit, corrected, and re-verified:

| Token | Was | Now | Worst case before | Verifies |
|---|---|---|---|---|
| `color-text-3` (light) | `#8A919D` | `#5A6572` | 2.80:1 | 4.96–5.67:1 |
| `color-text-3` (dark) | `#6E7887` | `#9AA5B4` | 4.09:1 | 5.01–7.32:1 |
| `success` ink | `#15803D` | `#166534` | 4.40:1 | 6.25:1 |
| `warning` ink | `#B45309` | `#92400E` | 4.46:1 | 6.29:1 |

- **Machine-checkable artifact:** `carup-contrast-check.py` — single source of truth for the shipped palette; recomputes all pairings; exit code 1 on any AA failure. Current run (S0-corrected): **45 shipped pairings, 0 failures** (22 light + 23 dark-body; dark soft tints alpha-composited onto `#13233D` before measuring; includes the hard rule that light-mode text on `--action-soft` uses `--action-hover` at 6.24:1, and dark-mode text on the dark action-soft keeps full-strength `#FB7A3C` at 4.92:1).
- Machine-readable matrix: `rx01b-contrast-matrix.{json,csv}` (45 rows).
- Corrections applied to the prototype CSS and the token doc; evidence captures regenerated afterwards so images match final bytes.

### C03 — Route-to-shell reconciliation · CLOSED

- **139-row register** `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` — one row per Appendix B path (R001–R139), each carrying: current parent, Appendix F group, proposed shell, focused mode, UX-REF mapping, reviewer-isolation flag, migration caution.
- **Group memberships verified exactly against Appendix F** (sum check 139): G2 = R003/R074/R076/R080 only; G4 = R067–R073, R075, R077–R079 (R074 is G2, not G4); G5 = R011–R015; G13 = R022, R088–R092; G14 = R023, R093–R096, R103–R106; G7 reviewer = R131–R138.
- **G2/G4 boundary:** R074 (`/dashboard/listings`) and R080 (`/dashboard/intelligence`) are Appendix-F G2 (seller-flow group) though they ride WorkspaceShell(personal) — the register records both facts separately; the package §5.1 summary table was corrected (it previously implied "R067–R080" for G4).
- **Exceptions separated:** G13/G14 rows carry their Appendix F.1 containment cautions (R092 fabricated CRM contained; R094/R096/R098/R110 seed-only states kept with honest copy; mechanic routes need verified tenant per TI-19).
- **NotFound vs 403:** R139 (`*`) is the context-aware **404 route**; **403 is a response state, not a route** — the `restricted` screen demonstrates an honest permission-boundary page for a real attempted destination.
- **Reviewer independence:** R131–R138 flagged `reviewer_isolated=yes`; reviewer destinations never appear as ordinary dealer workspace actions (NC-11), preserved in the prototype's dealer rail.

### C04 — Type reconciliation + dark tokens + supported modes · CLOSED

- **Inter shipping set: 400 / 500 / 600 / 700** (self-hosted, 4 files). Display maximum is 700; the prototype's 49 `font-weight:800` declarations were reconciled to 700 (verified 0 remaining). Spec-text/prototype mismatch eliminated.
- **JetBrains Mono** remains the single reference monospace (no IBM Plex Mono anywhere in prototype or spec).
- **Dark-surface state tokens finished:** status inks `success #4ADE80`, `warning #FBBF24`, `danger #F87171`, `info #93C5FD`, `neutral #A8B1BE` on rgba-tinted dark soft backgrounds over `#13233D` — every pairing AA-verified against the composited opaque tint (soft-tint range 4.87–7.36:1) and included in the checker.
- **Supported modes clarified** (token doc §1.4): (1) Light everywhere at launch; (2) workspace ink chrome always on — not a dark mode; (3) dark body optional comfort toggle, token-complete but disabled-by-default pending Owner swatch sign-off on `#FB7A3C`; (4) no public dark at launch; forced-colors must not break components.

### C05 — Acceptance recording · CLOSED

- **Owner acceptance of the RX-01A visual direction (Ink Precision)** is recorded as fact in this closure register.
- Explicitly **not** recorded as approved: OD-01–OD-17 — all remain **`PENDING OWNER DECISION`** per MP01 §0/§14.1. Direction acceptance is a design-input fact, not a decision-row status change.
- **Hero photography (D-02) remains an open, bounded decision** ahead of the production asset lock; illustration placeholder language stays in the spec until then.

### C06 — Production-intent docs + custody proposal · CLOSED

- Handoff-ready set (all corrected and manifest-pinned): token/component contract (v1.1), completion package (UX-REF matrix, component contracts, native appendix, handoff contract §7), 139-row route register, contrast checker + matrix, prototype, evidence package.
- **Custody:** authorized **Draft documentation-only PR #260** (branch `docs/rx01b-icr01-design-certification` off `main@9f2bebfe…`, docs-only path triggers no staging workflow per §23.5). Not merged; merge awaits explicit authorization.
- An RX-02 engineering team can begin against this package without inventing conventions: every color, status, component, route→shell mapping, and state behavior is specified and machine-checkable.

---

## 2A. Final delivery corrections (first return, per Moderator directive)

**A — Reviewer navigation isolation (NC-11).** The shared dealer workspace rail previously exposed a "Review queue" destination. Corrected: the dealer rail (`RAIL`) now contains only dealer destinations (Today · Stock · Enquiries · Import orders). A separate, dedicated reviewer-only navigation composition (`REVIEWER_RAIL`) renders exclusively inside protected review sessions (queue, claim bench), with the step-up masthead and no organization context. Verified programmatically and visually: dealer rail contains no reviewer destination; the reviewer composition retains Review queue / Dealer claims / Trust reviews / Identity cases; the honest-403 `restricted` boundary is preserved unchanged.

**B — Document consistency.** (1) The prototype's Inter font request ships weights **400/500/600/700 only** — the 800 request is removed, matching the approved specification. (2) The manifest-entry count is reconciled in S0-B: the closure report, `VERIFICATION.md`, and the manifest all state **60 entries** (prototype, app copy, four documents, route register, contrast checker, matrix JSON+CSV, evidence INDEX, capture-index, `VERIFICATION.md` — which shipped in prior bundles but was never manifested — 48 captures). Affected checksums and screenshots were regenerated; the reviewable preview was re-saved as version `a56e4f3`.

## 2B. Second final correction — reviewer-context isolation (per Moderator directive, this return)

**C — Protected reviewer identity on the decision bench.** The `reviewer` decision screen previously used the shared `desktopShell` rail account and footer, exposing the dealer identity `T. Moyo — Owner` and `Signed in as T. Moyo · Mvura Motors`. Corrected: in protected review mode the workbench renders the same identity model as `reviewer-queue` — "Independent review · Reviewer · step-up active" masthead, rail ending in **Exit review session** (no dealer account identity), protected util footer (**All actions audited · Session: independent review · No org/branch context carried**), and no dealer workspace actions (Export / + Add vehicle suppressed). Verified programmatically — **15/15 focused checks**: no dealer name, organization or branch string anywhere in either protected screen; dealer screens retain their full identity (no regression) — and visually (P19, W06 re-rendered).

**D — Trade-context gating of the Import orders destination.** The dealer rail destination **Import orders** is now entitlement-filtered by session Trade context (`ctxTrade` gate on the SessionWorkspaceManifest model): it renders only when the session carries authorized Trade context, and disappears — never a dead stub — when absent. Cross-role visibility is not hardcoded into the handoff (NC-05, NC-10). New evidence capture **S06** renders the dealer rail with the destination absent; the rule is recorded in the completion package §5.2 (rule 4).

Only the affected evidence was regenerated (P19, W06) plus the one new gate-evidence capture (S06); all other captures, tokens, route mappings and screens are unchanged in behavior.

## 2C. S0 contrast-methodology correction (per Moderator directive RX02A-LR01 §3, this return)

**Finding (review discussion_r4534685312 on PR #260):** the checker measured dark status inks against `#0B1526` (`dm-ink`) instead of the actual semitransparent status tints composited onto `#13233D` as specified by the token contract.

**Fix (no approved color changed):**
1. The checker now alpha-composites each dark soft tint — `rgba(status_ink, 0.12)` and `rgba(251,122,60, 0.14)` over `#13233D` — and measures WCAG contrast against the computed opaque result.
2. Six composited pairings added to the shipped set: five dark status soft tints plus dark action on the dark action-soft tint. Shipped set is now **45 pairings** (was 39).
3. Composited results: ok 7.03, warn 7.36, danger **4.87**, info 6.76, neutral 5.79, action 4.92 — **all pass AA ≥4.5:1**; the soft-tint minimum is 4.87:1 (danger).
4. Contract clarification recorded in the token doc: on the dark action-soft tint, full-strength `#FB7A3C` stays mandatory (4.92:1) — the light-mode darker-hover-ink rule does **not** carry to dark (`#9A3412` = 1.78:1 on the dark tint).
5. **Failing regression added:** weakened danger ink `#E45E5E` on the danger soft tint = **3.89:1, rejected**. The checker exits 0 only if every shipped pairing passes AND every regression pairing fails; a mutated copy with the shipped danger ink weakened to `#E45E5E` exits 1 — the gate demonstrably bites.
6. Matrices regenerated (JSON/CSV, 45 rows); verification documentation updated; all "39 pairings" count statements corrected to 45.

No other design changes were made.

## 3. Corrected specifications (summary of normative changes)

**Tokens:** `text-3` → `#5A6572` (light) / `#9AA5B4` (dark); `success` → `#166534`; `warning` → `#92400E`; dark surface scale `#0B1526 / #13233D / #1D2A42 / #24344F`; dark status inks as §2-C04. All other palette values unchanged (Direction A preserved).

**Type:** Inter 400/500/600/700; display ≤700; JetBrains Mono 400/500.

**Routes:** per the 139-row register; summary table in the completion package §5.1 corrected to exact ranges (no more "R067–R080").

**Modes:** Light (launch, all families); ink workspace chrome (always); dark body (optional, gated on D-07 swatch sign-off); public dark (not at launch).

**Navigation:** protected review sessions carry their own identity chrome (masthead, rail, footer, actions) — no dealer identity, organization, branch or business context; workspace rail destinations are entitlement-filtered from session context (Import orders ⇐ authorized Trade context only).

---

## 4. Engineering handoff index

| # | Item | Artifact | State |
|---|---|---|---|
| 1 | Token & component contract | `UI_DESIGN_REFERENCE_AND_TOKENS.md` v1.1 | Ready (in Draft PR #260) |
| 2 | Route-to-shell authority register | `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` | Ready (in Draft PR #260) |
| 3 | Completion package (UX-REF-01–10, contracts, native appendix, handoff contract §7, D-register §8) | `CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | Ready |
| 4 | Interactive prototype (28 screens, corrected) | `carup-rx01a-prototype.html` (review version `a56e4f3`) | Ready for Owner visual gate at 5 widths |
| 5 | Contrast gate | `carup-contrast-check.py` + matrix JSON/CSV | Ready for CI-04/CI-06 wiring |
| 6 | Visual evidence (48 captures + index) | `rx01b-evidence/` | Ready |
| 7 | Integrity manifest | `RX01B-ICR01-SHA256MANIFEST.txt` (60/60 OK) | Ready |
| 8 | Custody | Draft PR #260 (documentation-only, not merged) | Awaiting authorization + independent review |

---

## 5. Remaining Owner decisions

| ID | Decision | Status |
|---|---|---|
| OD-01–OD-17 | All master-plan decision rows | **PENDING OWNER DECISION** (visual-direction acceptance does not advance any row) |
| D-02 | Hero photography vs refined illustration for public hero bands | OPEN — bounded, must close before production asset lock |
| D-07 | Dark action-orange swatch `#FB7A3C` sign-off (unlocks dark-body comfort toggle) | OPEN — pending visual gate |

---

## 6. Confirmation — no unauthorized operations

Within this remediation I confirm:

1. **No unauthorized repository mutation:** the only write action against `kudzimusar/carup` is the explicitly authorized **Draft documentation-only PR #260** (branch `docs/rx01b-icr01-design-certification` off `main@9f2bebfe…`; updated in place with this second correction — no new PR). No merges, no application-code commits, no issue/review actions taken by me. All other repository access was read-only (directory listings, file reads, code search) to reconcile against MP01 at the exact head.
2. **No deployment** to any environment; no service, database, or schema change.
3. **No commercial action:** no dealer publication, payment activation, entitlement or pricing change.
4. **No authorization/policy change:** reviewer independence, tenant boundaries and server-enforced checks untouched; the prototype is self-contained front-end with clearly labeled illustrative fixtures and is **not** presented as authenticated functional UAT.
5. **Scope discipline:** bounded corrections C01–C06 and the two Moderator-directed final corrections (A/B, then C/D) only; the accepted Ink Precision direction is preserved byte-for-byte except the audited corrections; no new design cycle began.

— Kimmy, Lead Product Experience Designer · RX-01B-ICR01 return
