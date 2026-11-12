# RX-02A S1-2 — Surface-2 Contract Reconciliation (B3)

**Programme:** CARUP-UX-REBUILD-01 · **Gate:** RX-02A S1-2 (CI-04) · **Date:** 2026-11-12

## Discrepancy

The RX-01B contrast certification recorded the `surface-2` background as `#EBEBE5`
(3 certified light-mode pairings: `text`, `text-2`, `text-3` on `surface-2`).
The governing design contract (`shared/tokens/tokens.json`, accepted in PR #260)
pins `color-bg-surface-2` to `#E9E9E4`.

## Decision

**The governing design contract is the authority: `surface-2` = `#E9E9E4`.**

- The RX-01B checker reference `#EBEBE5` predates the accepted contract and was a
  measurement artifact of the pre-contract surface inventory.
- The contract value is the *darker* of the two. For these dark-on-light pairings
  the ratios decrease slightly on the darker surface, but every certified pairing
  keeps WCAG AA (≥ 4.5:1) on the contract value (computed with the same WCAG
  relative-luminance formula that reproduces the certified matrix ratios exactly):

| Pairing | Certified ratio on `#EBEBE5` | Ratio on contract `#E9E9E4` | AA (normal) |
| --- | --- | --- | --- |
| `text` on `surface-2` (`#191D27`) | 14.08 | 13.83 | ✅ |
| `text-2` on `surface-2` (`#59616F`) | 5.22 | 5.12 | ✅ |
| `text-3` on `surface-2` (`#5A6572`) | 4.96 | 4.87 | ✅ |

## Artifact handling (no silent changes)

- `shared/tokens/tokens.json` — **unchanged**; it already pins `#E9E9E4`.
- `scripts/rx01b-reference-matrix.json` — the 3 historical entries keep their
  certified `#EBEBE5` values (certification evidence is never overwritten) and
  gain a `reconciliation` block recording the authority, the contract value, and
  this decision.
- `scripts/tests/tokens.test.mjs` — the existing carried-drift assertions
  (exactly 3 surface-2 pairs; contract value pinned; 45/45 resolve + AA) remain
  the executable proof; `scripts/tests/ci04-gate.test.mjs` additionally asserts
  every carried pair carries reconciliation metadata.

## Traceability

45 certified pairings remain fully traceable; the 3 surface-2 differences are
reconciled here and closed for S1-2. No design token was altered by this
reconciliation.
