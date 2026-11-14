# RX-02A S1-3 — Shared Component Contracts, Catalogue and Ownership

Status: DRAFT (PR branch) · Authority: `UI_DESIGN_REFERENCE_AND_TOKENS.md` §6 · Change control: CODEOWNERS presentation lane (MP01 §9.1)

## Components delivered (`web/src/components/truth/`)

| Component | Contract | States / variants | Key invariants (tested) |
|---|---|---|---|
| `MoneyDisplay` | §6.3 | source: asking / agreed / estimate / guide; sizes md/lg | Currency mandatory + explicit and **always visible** (`$18,500 USD` — a bare "$" is ambiguous); ZiG never "$" (ZWG alias accepted); tabular numerals; missing amount → labelled "Not recorded", never fabricated; currency provenance is **three-way distinct**: recorded-but-unsupported code (e.g. EUR) → amount + verbatim code flagged "Unsupported currency" (no conversion, no invented values); unrecorded currency (null/blank) → amount + "Currency not recorded" |
| `VehicleIdentity` | §6.1 | card / row / header × exposure: **public (default)** / workspace | One presentation across Marketplace, saved, Seller preview, garage; missing fields → "Not recorded"; thumbnail placeholder labelled; **public-safe by default (MP01 FP-02 / Passport): the VIN is withheld entirely** — labelled "Restricted", never masked or derived — including when no `exposure` prop is passed; the **full identity (raw VIN) requires an explicit `exposure="workspace"` opt-in** for authenticated surfaces; the prop selects a display projection only — server authorization remains authoritative |
| `DataState` | §6.5 | loading / empty / error / forbidden / not-measured / unavailable | Failed read never rendered as empty; error = `role="alert"`; error copy is neutral recovery only — **no unverified mutation assurances**; loading = polite labelled live region with neutral skeletons; not-measured never 0; unavailable renders no dead control |
| `TrustLens` | §6.2 | evaluated / partial / stale / not-evaluated / insufficient-data / unavailable | Always carries source count + freshness; no score prop exists — never invents a score; labels describe **evaluation coverage only** — no label or tone claims verified vehicle facts (Truth-owner confirmation of exact backend semantics tracked as a gate item) |
| `EvidenceLine` | §6.4 | — | actor · source · time in order; missing provenance labelled, never fabricated |

Formatting authority: `money.ts` (`formatMoney`, `normalizeCurrency`) — pure, unit-tested.

## Catalogue (working visual showcase)

`web/src/pages/dev/ComponentCatalogue.tsx`, route `/dev/component-catalogue`, **registered only when `import.meta.env.DEV`** — no production route or navigation link is added. Every component renders in every contract state (§10.3: isolated renderer before any route consumes a component), including the public-default and explicit-workspace VehicleIdentity projections and the three-way MoneyDisplay currency-provenance states.

## Ownership

Root `CODEOWNERS`: presentation lane owns `shared/tokens/`, generated token outputs, `web/src/components/truth/`, the catalogue renderer, `docs/product-experience/`, and `.github/workflows/`.

## Verification

- Component tests: `web/src/components/truth/*.test.tsx` + `money.test.ts` — negative cases included (ZiG-as-$ prevention, visible-currency-not-sr-only, three-way currency-provenance distinction — recorded-unsupported vs unrecorded vs missing amount — with no conversion/invented values, failed-read-is-not-empty, no unverified mutation assurance in error copy, default-public-safe-VIN-withholding plus explicit-workspace-full-identity, no "verif*" wording in any TrustLens state, no invented score/provenance, missing-value honesty, keyboard-operable actions).
- Local battery on the branch head: tsc, full web Vitest suite, production build — see PR body.
- Responsive evidence at 360/390/768/1280/1920 against the dev catalogue: desktop Chromium viewport emulation (Playwright), classified as local fixtures — not authenticated UAT, not physical Android/iOS.

## Consumption (not in this PR)

Home, Marketplace, Owner, Dealer and Trade migrate onto these renderers in later slices; domain teams consume and do not extend visually (CODEOWNERS). VehicleIdentity is public-safe by default (no prop needed); authenticated surfaces that need the full identity MUST pass `exposure="workspace"` explicitly, and the public API projection must not carry the raw VIN in the first place (server-side governance, MP01 FP-02).
