# CARUP-UX-REBUILD-01 · RX-01B-ICR01 — Final Handoff Closure Report

**Prepared by:** Kimmy — Lead Product Experience Designer
**Date:** 2026-11-11 · **Moderator disposition executed:** REMEDIATE — BOUNDED CORRECTIONS ONLY
**Scope guard:** visual direction (Ink Precision, Direction A) **preserved**; no redesign, no new design cycle, no repository mutation, no PR opened or merged, no deployment, no commercial action.
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
| Interactive prototype (corrected) | `carup-rx01a-prototype.html` — review version **`a56e4f3`** (supersedes `e1ffca4`, which superseded `2d2e9a5`) | 115,216 | `edad4730…3987a` |
| Reviewable preview | `app/index.html` (byte-identical copy of the prototype) | 115,216 | `edad4730…3987a` |
| Token & component contract | `UI_DESIGN_REFERENCE_AND_TOKENS.md` v1.1 | 15,803 | `44328449…5bc83` |
| RX-01B completion package (route table corrected) | `CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | 20,231 | `a821931c…b70eb` |
| Route-to-shell authority register | `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` (139 rows) | 27,725 | `1dee9347…40c97` |
| Contrast checker (machine-checkable) | `carup-contrast-check.py` | 5,365 | see manifest |
| Contrast matrix | `rx01b-contrast-matrix.json` / `.csv` (39 shipped pairings) | — | see manifest |
| Evidence package | `rx01b-evidence/` — 47 PNG + `INDEX.md` + `capture-index.json` | — | see manifest |
| Checksum manifest | `RX01B-ICR01-SHA256MANIFEST.txt` — **58 entries, all verify `OK`** (count corrected per ICR01 final delivery) | — | self-authenticating via `sha256sum -c` |

### 1.3 Identity correction (C01 root cause)

The identifier **`2d2e9a5`** used in the RX-01B return is a **platform preview version ID** assigned by the design-preview version manager — it is **not** a Git commit SHA, was never claimed to be one, and must not be cited as repository provenance. Repository provenance is cited only as in §1.1. The corrected prototype is saved as review version **`e1ffca4`** under the same regime; its content bytes are additionally pinned by the SHA-256 manifest, so the design evidence is reproducible even outside the preview platform.

---

## 2. C01–C06 closure evidence

### C01 — Source/evidence custody and artifact identity · CLOSED

- Root cause recorded: version ID vs Git SHA conflation risk (§1.3).
- **47-capture evidence package regenerated** from the corrected source bytes (`rx01b-evidence/`, `INDEX.md`, `capture-index.json`): P01–P28 all screens @390×844; D01–D06 workspace chrome @1440×900; W01–W08 five-width matrix (360/768/1280/1920); S01–S05 data states incl. loading/empty/error and the honest-403 boundary.
- **SHA-256 checksum manifest** over prototype + app copy + all docs + register + checker + matrix + evidence indexes + 47 captures = **58 entries, all verified OK** (`sha256sum -c RX01B-ICR01-SHA256MANIFEST.txt` → 0 failures; entry count reconciled with §1.2).
- Precise versioning: token doc v1.1 (supersedes v1.0 with a change note); prototype re-saved as preview version `e1ffca4`; older RX-01A preview (`ea13ba5`, 17-screen concept) is **superseded** and was never substituted for RX-01B evidence.

### C02 — WCAG 2.2 AA contrast failures corrected · CLOSED

Four failing pairings found by evidence-based audit, corrected, and re-verified:

| Token | Was | Now | Worst case before | Verifies |
|---|---|---|---|---|
| `color-text-3` (light) | `#8A919D` | `#5A6572` | 2.80:1 | 4.96–5.67:1 |
| `color-text-3` (dark) | `#6E7887` | `#9AA5B4` | 4.09:1 | 5.01–7.32:1 |
| `success` ink | `#15803D` | `#166534` | 4.40:1 | 6.25:1 |
| `warning` ink | `#B45309` | `#92400E` | 4.46:1 | 6.29:1 |

- **Machine-checkable artifact:** `carup-contrast-check.py` — single source of truth for the shipped palette; recomputes all pairings; exit code 1 on any AA failure. Current run: **39 shipped pairings, 0 failures** (light + dark-body; includes the hard rule that text on `--action-soft` uses `--action-hover` at 6.24:1, and full dark status tokens).
- Machine-readable matrix: `rx01b-contrast-matrix.{json,csv}` (39 rows).
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
- **Dark-surface state tokens finished:** status inks `success #4ADE80`, `warning #FBBF24`, `danger #F87171`, `info #93C5FD`, `neutral #A8B1BE` on rgba-tinted dark soft backgrounds over `#13233D` — every pairing AA-verified (dark status minimum 4.87:1) and included in the checker.
- **Supported modes clarified** (token doc §1.4): (1) Light everywhere at launch; (2) workspace ink chrome always on — not a dark mode; (3) dark body optional comfort toggle, token-complete but disabled-by-default pending Owner swatch sign-off on `#FB7A3C`; (4) no public dark at launch; forced-colors must not break components.

### C05 — Acceptance recording · CLOSED

- **Owner acceptance of the RX-01A visual direction (Ink Precision)** is recorded as fact in this closure register.
- Explicitly **not** recorded as approved: OD-01–OD-17 — all remain **`PENDING OWNER DECISION`** per MP01 §0/§14.1. Direction acceptance is a design-input fact, not a decision-row status change.
- **Hero photography (D-02) remains an open, bounded decision** ahead of the production asset lock; illustration placeholder language stays in the spec until then.

### C06 — Production-intent docs + custody proposal · CLOSED

- Handoff-ready set (all corrected and manifest-pinned): token/component contract (v1.1), completion package (UX-REF matrix, component contracts, native appendix, handoff contract §7), 139-row route register, contrast checker + matrix, prototype, evidence package.
- **Custody proposal:** commit `UI_DESIGN_REFERENCE_AND_TOKENS.md` (v1.1) to `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` exactly as named in MP01 §14.4(5), **in a separately authorized documentation PR** (docs-only path triggers no staging workflow per §23.5); same PR may carry `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` (§14.4(1)) and the ICR01 evidence index. No commit is made now — this report is the custody proposal awaiting Moderator/Owner authorization.
- An RX-02 engineering team can begin against this package without inventing conventions: every color, status, component, route→shell mapping, and state behavior is specified and machine-checkable.

---

## 2A. Final delivery corrections (this return, per Moderator directive)

**A — Reviewer navigation isolation (NC-11).** The shared dealer workspace rail previously exposed a "Review queue" destination. Corrected: the dealer rail (`RAIL`) now contains only dealer destinations (Today · Stock · Enquiries · Import orders). A separate, dedicated reviewer-only navigation composition (`REVIEWER_RAIL`) renders exclusively inside protected review sessions (queue, claim bench), with the step-up masthead and no organization context. Verified programmatically and visually: dealer rail contains no reviewer destination; the reviewer composition retains Review queue / Dealer claims / Trust reviews / Identity cases; the honest-403 `restricted` boundary is preserved unchanged.

**B — Document consistency.** (1) The prototype's Inter font request now ships weights **400/500/600/700 only** — the 800 request is removed, matching the approved specification. (2) The manifest-entry count discrepancy is corrected: the closure report and the manifest both state **58 entries** (prototype, app copy, four documents, route register, contrast checker, matrix JSON+CSV, evidence INDEX, capture-index, 47 captures). Affected checksums and all 47 screenshots were regenerated; the reviewable preview was re-saved as version `a56e4f3`.

No other design changes were made.

## 3. Corrected specifications (summary of normative changes)

**Tokens:** `text-3` → `#5A6572` (light) / `#9AA5B4` (dark); `success` → `#166534`; `warning` → `#92400E`; dark surface scale `#0B1526 / #13233D / #1D2A42 / #24344F`; dark status inks as §2-C04. All other palette values unchanged (Direction A preserved).

**Type:** Inter 400/500/600/700; display ≤700; JetBrains Mono 400/500.

**Routes:** per the 139-row register; summary table in the completion package §5.1 corrected to exact ranges (no more "R067–R080").

**Modes:** Light (launch, all families); ink workspace chrome (always); dark body (optional, gated on D-07 swatch sign-off); public dark (not at launch).

---

## 4. Engineering handoff index

| # | Item | Artifact | State |
|---|---|---|---|
| 1 | Token & component contract | `UI_DESIGN_REFERENCE_AND_TOKENS.md` v1.1 | Ready (custody proposed) |
| 2 | Route-to-shell authority register | `UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` | Ready (custody proposed) |
| 3 | Completion package (UX-REF-01–10, contracts, native appendix, handoff contract §7, D-register §8) | `CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | Ready |
| 4 | Interactive prototype (28 screens, corrected) | preview version `e1ffca4` / `carup-rx01a-prototype.html` | Ready for Owner visual gate at 5 widths |
| 5 | Contrast gate | `carup-contrast-check.py` + matrix JSON/CSV | Ready for CI-04/CI-06 wiring |
| 6 | Visual evidence (47 captures + index) | `rx01b-evidence/` | Ready |
| 7 | Integrity manifest | `RX01B-ICR01-SHA256MANIFEST.txt` (58/58 OK) | Ready |
| 8 | Prior returns (context) | Mission readiness report; RX-01A review package (preview `ea13ba5`, superseded) | Historical |

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

1. **No repository mutation:** no commits, branches, PRs (open/merge/close), file writes, or comment/review actions were performed against `kudzimusar/carup`. All repository access was read-only (directory listings, file reads, code search) to reconcile against MP01 at the exact head.
2. **No deployment** to any environment; no service, database, or schema change.
3. **No commercial action:** no dealer publication, payment activation, entitlement or pricing change.
4. **No authorization/policy change:** reviewer independence, tenant boundaries and server-enforced checks untouched; the prototype is self-contained front-end with clearly labeled illustrative fixtures and is **not** presented as authenticated functional UAT.
5. **Scope discipline:** bounded corrections C01–C06 only; the accepted Ink Precision direction is preserved byte-for-byte except the audited corrections; no new design cycle began.

— Kimmy, Lead Product Experience Designer · RX-01B-ICR01 return
