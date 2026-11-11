# CarUp UI Design Reference & Tokens — RX-01B

**Document ID:** `CARUP-UX-REBUILD-01-RX01B-UI-TOKENS` · **Intended repository path:** `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` (delivered here as a design artifact; repository custody requires Moderator authorization)
**Version:** 1.1 (RX-01B-ICR01 remediation — C02 contrast corrections, C04 type/dark completion) · **Date:** 2026-11-11 · supersedes v1.0
**Authority:** DESIGN.md (governing visual authority) · MP01 v0.9.2 (PR #259, head `9940647f`) · RX-01A accepted direction (preview version `ea13ba5` — a platform version ID, not a Git SHA)
**Status:** PROPOSED production-intent design system. Adopted only by explicit Owner decision (see D-register in the RX-01B package). Owner acceptance of the RX-01A visual direction is recorded in the ICR01 closure report and does **not** constitute approval of OD-01–OD-17.

---

## 0. How to read this document

This is the enforceable token and component contract that RX-02+ engineering consumes. It replaces hardcoded palette values across ~228 runtime files (MP01 §2.3: 8,555 raw palette utilities, 51 semantic-token utilities in app code) with one generated layer. Values here are **normative**: a screen that cannot be expressed from these tokens is a design-review failure (CI-04), not an invitation to add a local color.

Naming: `--carup-{semantic}` for the runtime contract; primitives are `--carup-raw-*`. The Tailwind theme (RX-02) is generated from the same source table — **one source, two outputs (CSS custom properties + Tailwind config + native adapter)**.

---

## 1. Color

### 1.1 Brand primitives (raw)

| Token | Value | Note |
|---|---|---|
| `--carup-raw-ink` | `#0B1526` | deepest navy-black — commerce chrome |
| `--carup-raw-ink-2` | `#13233D` | depth layer on ink |
| `--carup-raw-navy` | `#0F2440` | structural navy, hero bands |
| `--carup-raw-paper` | `#FAFAF7` | warm white — public background |
| `--carup-raw-surface` | `#F1F1ED` | warm gray panel |
| `--carup-raw-surface-2` | `#E9E9E4` | wells, skeletons, disabled fills |
| `--carup-raw-line` | `#E0E0DA` | hairline |
| `--carup-raw-line-strong` | `#C9C9C2` | control borders |
| `--carup-raw-action` | `#C2410C` | orange-700 — **the only action orange** |
| `--carup-raw-action-hover` | `#9A3412` | orange-800 |
| `--carup-raw-action-soft` | `#FBEADF` | tint surfaces for action context |
| `--carup-raw-orange-signal` | `#F97316` | orange-500 — non-text accent only (logo dot, active markers). **Never** text/background pairing below large-text threshold |

**Deprecated immediately:** orange-500 fills with white text (2.80:1, MP01 U-22), orange skeletons (U-23), any new `.glass-*`/backdrop-blur ambient panels (E-04).

### 1.2 Semantic tokens (the runtime contract)

| Semantic | Light value | Ink-dark value | Use |
|---|---|---|---|
| `color-bg` | paper | `#0B1526` | app background |
| `color-bg-surface` | surface | `#13233D` | panels, cards |
| `color-bg-surface-2` | surface-2 | `#1D2A42` | wells, workbench body |
| `color-bg-raised` | `#FFFFFF` | `#24344F` | inputs, popovers, sheets, elevated cards |
| `color-line` | line | `rgba(255,255,255,.12)` | hairlines |
| `color-line-strong` | line-strong | `rgba(255,255,255,.22)` | control borders |
| `color-text` | `#191D27` | `#F4F6F9` | primary text |
| `color-text-2` | `#59616F` | `#C3CBD6` | secondary text |
| `color-text-3` | `#5A6572` † | `#9AA5B4` † | tertiary, captions |
| `color-action` | action | `#FB7A3C`* | primary actions (light: full strength on paper/surface only) |
| `color-action-hover` | action-hover | `#F97316`* | hover; **mandatory ink on action-soft tints** (6.24:1) |
| `color-action-on` | `#FFFFFF` | `#1A0D05` | text/icons on action |
| `color-action-soft` | action-soft | `rgba(251,122,60,.14)` | selected states, soft CTAs |
| `color-focus` | action | `#FB7A3C` | focus ring (2px + 1px offset) |

† **ICR01-C02 corrected values** (evidence: `carup-contrast-check.py`, 39 shipped pairings, 0 AA failures). Previous `--text-3` values failed WCAG 2.2 AA: light `#8A919D` measured 2.80–3.03:1; dark `#6E7887` measured 4.09:1 on ink and 4.17:1 on raised. Replacements verify 4.96–5.67:1 (light) and 5.01–7.32:1 (dark).

\* Dark-mode action orange is lightened one step to preserve ≥4.5:1 against ink backgrounds (6.92:1 on ink, 5.95:1 on `#13233D`, 5.44:1 on `#1D2A42`); **pending Owner swatch sign-off at visual gate (D-07) — until then the dark-body variant ships behind the mode flag without the action-orange claim.**

### 1.3 Status semantics (one registry — replaces 108 mapping sites in 53 files, U-18)

| Status | Light text/ink | Light soft bg | Dark text/ink | Dark soft bg | Rule |
|---|---|---|---|---|---|
| `success` | `#166534` † | `#E7F3EB` | `#4ADE80` | `rgba(74,222,128,.12)` on `#13233D` | confirmed fact with source |
| `warning` | `#92400E` † | `#FAF0E3` | `#FBBF24` | `rgba(251,191,36,.12)` on `#13233D` | stale, pending, estimate |
| `danger` | `#B91C1C` | `#F9ECEC` | `#F87171` | `rgba(248,113,113,.12)` on `#13233D` | failed, overdue, blocked |
| `info` | `#1D4ED8` | `#EAF0FD` | `#93C5FD` | `rgba(147,197,253,.12)` on `#13233D` | in-progress, informational |
| `neutral` | `#475569` | `#EEF1F5` | `#A8B1BE` | `rgba(168,177,190,.12)` on `#13233D` | not started, unmeasured, unknown |
| `action` | action-hover | action-soft | `#FB7A3C` | `rgba(251,122,60,.14)` | user-actionable emphasis |

† **ICR01-C02 corrected values.** Previous `success #15803D` measured 4.40:1 and `warning #B45309` 4.46:1 — both below AA on their soft tints; replacements verify 6.25:1 and 6.29:1. Dark text inks are used **on the dark soft tints only** (never on light soft tints); each pairing is in the shipped set of `carup-contrast-check.py` and passes AA (dark status minimum 4.87:1). Domain vocabularies (order stages, listing states) **map onto** this registry; they may not introduce new hues.

### 1.4 Surface variants — Public / Workspace / Focused

| Surface | Background | Chrome | Rule |
|---|---|---|---|
| Public (light treatment) | paper | ink header, white search controls | default |
| Public hero band | ink gradient | ink | search-led, one illustration zone |
| Workspace | paper body | **ink chrome permanently** (masthead + rail) | identical across dealer/garage/trade/institutional — atmosphere is not negotiable per role |
| Focused | paper | minimal chrome, no bottom bar | auth, sell, claim, review decision |
| Review (protected composition) | paper | ink chrome + rust masthead accent, no org context | reviewer sessions only |

**Supported modes (ICR01-C04, clarified):**
1. **Light — supported at launch, every shell family.** This is the default everywhere.
2. **Workspace ink chrome — always on**, in both modes and both directions; it is not a "dark mode," it is the workspace identity.
3. **Dark body (workspace surfaces/tokens §1.2–1.3 "Ink-dark" column) — optional per-user comfort toggle, workspace only.** Token set is complete and AA-verified (39 shipped pairings), but the dark action orange `#FB7A3C` remains pending Owner swatch sign-off (D-07), so the toggle ships disabled-by-default until that sign-off.
4. **Public dark — not offered at launch** (D-07); public components must still survive forced-colors/high-contrast modes without breakage.
Components must not break if forced-colors/invert is applied.

---

## 2. Typography

| Role | Family | Weight | Size / line | Notes |
|---|---|---|---|---|
| UI text | Inter | 400/500/600 | 14px / 1.55 | self-hosted, **4 weights shipped: 400, 500, 600, 700** (ICR01-C04; the prototype's 800 usages were reconciled down to 700) |
| Display | Inter | **700 max** | 20–28px / 1.12–1.2 | tracking −0.02em; 800 is not shipped (self-hosted file budget, §11.1) |
| Mono / reference | **JetBrains Mono** | 400/500 | 11–13px | VIN, chassis, refs, case IDs, timestamps in tables |
| Numerals | Inter + `font-variant-numeric: tabular-nums` | — | — | mandatory on money, mileage, counts, table cells |

**Font resolution (RX-01B §3.F.1, CLOSED):** JetBrains Mono is the single reference monospace. The RX-01A prototype rendered IBM Plex Mono; RX-01B switches the prototype and this spec to JetBrains Mono (metric-compatible intent, superior glyph distinction for 0/O, 5/S in VINs). IBM Plex Mono is **not** retained — one mono, no drift.

Rules: base body never below 14px; operational captions minimum 10.5px with 4.5:1 contrast; no italics for emphasis (weight/color only); `prefers-reduced-motion` respected.

---

## 3. Spacing, grid, breakpoints, density

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48 (px). No arbitrary values.
- **Layout grid:** 12-col · gutter 16 (mobile) / 20 (tablet) / 24 (desktop) · page padding token `--pad-page` 16px mobile / 22px desktop.
- **Content widths (canonical, replaces 12 ad hoc widths, U-16):** Public max 1440 · Workspace max 1560 · Focused column max 480 (mobile full-bleed).
- **Breakpoints:** 360 · 768 · 1024 · 1440 · 1920. Behavior summary:

| Width | Shell behavior |
|---|---|
| 360–767 | Phone frames: public bottom tab bar (5 slots, manifest-derived), workspace → topbar + bottom nav, tables become task-first lists, drawer for overflow |
| 768–1023 | Tab bar → compact rail or tabs; workbench lists widen; rail hidden below 1024 with explicit open control |
| 1024–1439 | Full desktop workbench: 224px rail + masthead + dense tables |
| 1440–1919 | Public/Workspace max widths apply |
| 1920+ | Centered max width; tables may use controlled full width |

- **Control geometry:** radii 2 (chrome-tight) / 6 (controls) / 12 (cards, sheets). Height: touch controls 44px; dense table rows 40px desktop (design candidate ratified by Owner dense-data UAT); mobile workbench rows minimum 56px touch.
- **Elevation:** borders and hairlines first; shadow only for sticky CTA bar and sheets (`0 -2px 24px rgba(11,21,38,.16)`). No card-shadow fleets, no glow.

---

## 4. Motion

Duration 120–200ms; easing `cubic-bezier(.2,.7,.3,1)`. Permitted: hover/press feedback, sheet/tab transitions, skeleton shimmer (loading only). Prohibited as default: ambient animation, autoplay, parallax, animated gradients. All motion collapses to instant under `prefers-reduced-motion`.

---

## 5. Touch, focus, accessibility (WCAG 2.2 AA)

- Touch targets ≥44×44px (24px minimum spacing between targets, SC 2.5.8); dense desktop tables may use smaller hit rows **only** with equivalent keyboard/row action.
- Every shell ships a skip link; off-canvas navigation is `inert` when closed with focus restore (fixes E-13 classes); exactly one active nav item (U-08).
- Focus ring: 2px `color-focus`, offset 1px, never removed without replacement.
- Errors announced via `role="alert"` + live region (fixes U-31); bottom bar never obscures focused content (scroll-padding-bottom = bottom-nav height).
- Contrast: text ≥4.5:1; large text ≥3:1; non-text ≥3:1. Action orange pairs only as specified in §1.2.
- Keyboard: all controls operable; dialogs trap focus; ESC closes and returns focus.

---

## 6. Truth components (the status/evidence/Trust/money/data-state kit)

These seven contracts are the only permitted renderers of their data class (replaces 6 Trust readers, ≥7 price formatters, 18+ vehicle tiles — MP01 §22):

1. **`VehicleIdentity`** — one vehicle presentation (title, VIN, year, km, location, thumbnail) across Marketplace card, saved, Seller preview, garage. Variants: `card`, `row`, `header`.
2. **`TrustLens`** — states: `evaluated`, `partial`, `stale`, `not-evaluated`, `insufficient-data`, `unavailable`. Always carries source count/freshness. Never invents a score.
3. **`MoneyDisplay`** — currency mandatory and explicit (USD/ZiG); tabular numerals; source label (`asking`, `agreed`, `estimate`) beside the figure; never renders ZiG as "$".
4. **`EvidenceLine`** — actor · source · time on every evidence/trust row.
5. **`DataState`** — `loading` (neutral skeletons, labeled live region) · `empty` (invitation + next action) · `error` (recovery, `role="alert"`) · `forbidden` · `not-measured` (labelled unknown, never 0) · `unavailable` (held capability, honest copy). **A failed read is never rendered as empty.**
6. **`LifecycleRail`** — one projection of object stages (import order, claim, work order) with `done/current/upcoming/blocked` states fed by the backend lifecycle, never local arrays (TI-18).
7. **`ObjectHeader` + `ActionRegion`** — object title, refs, status badge, context chips; the single primary action per view lives in `ActionRegion`.

Plus the workbench primitives: `TableWorkbench` (40px rows, mono refs, responsive → list), `DecisionPanel` (reason minimum 40 chars, reviewer identity + timestamp recorded, disabled until valid), `DocumentViewer`, `MessageContext` (see §7), `MediaUploader` (preview + scan status + honest failure), `Stepper` (one goal per view, save-and-exit, progress non-linear where drafts exist).

---

## 7. Communications states (UX-REF-09 kit)

Message delivery states render verbatim from provider truth: `queued/pending`, `sent`, `delivered`, `failed` (with retry + channel reason), `read`. Channel availability chips (`available / unavailable / not-configured`) reflect runtime capability — a channel that cannot deliver is never offered as a reply path (TI-23). Threads are object-linked (vehicle, import order, work order, case); object context survives deep links.

---

## 8. Mobile safe-area & keyboard

- Bottom bars: `height = 60px + env(safe-area-inset-bottom)`; content `scroll-padding-bottom` matches. No focused control ever sits under the bar.
- Notch/status: header padding via `env(safe-area-inset-top)` on PWA standalone.
- Focused flows: sticky primary action sits **above** the keyboard; inputs scroll into view; keyboard-open never shrinks below the visible step title.
- Viewport meta: `viewport-fit=cover` mandatory.

---

## 9. Native (Expo) token & theme adapter

- Tokens ship as a JSON token package (same source table) consumed by a small RN adapter: colors → theme object; radii (2/6/12) → style tokens; spacing scale → layout constants; type scale → RN Text variants. **No hex literals in native code** (baseline: 338 hexes in 42 distinct values, U-35).
- Native surfaces use the same status registry, TrustLens vocabulary and MoneyDisplay semantics — identity and truth semantics are shared; navigation chrome is native (bottom tabs), never a web layout copy (§22.9).
- Dark treatment: workspace ink chrome is native-default; body surfaces follow the light set; forced-colors respected.
- Safe areas via `react-native-safe-area-context`; back gesture/system back returns to the governed tab; keyboards dismiss on scroll outside inputs.
- Native capability map governs what renders: supported → native screen; web-only → safe web handoff (deep link, normal web sign-in, object context preserved, **no tokens/step-up in URL**); unsupported → honest "not available on mobile" state (NC-07).

---

## 10. Enforcement (RX-02 contract)

1. Tokens generated from a single source into CSS variables + Tailwind config + native JSON. No hand-added values.
2. CI-04: changed lines using raw palette values or new status mappings fail lint; legacy ratchets to zero.
3. Storybook (or equivalent isolated renderer) hosts each component in every state from §6 before any route consumes it.
4. Visual regression baselines at the five review widths (CI-05) per reference route.

---

**Change control:** any new color, status, component variant or shell requires a catalogue change approved by the presentation-lane owner (CODEOWNERS, MP01 §9.1). Domain teams consume; they do not extend visually.

— Kimmy, Lead Product Experience Designer · RX-01B
