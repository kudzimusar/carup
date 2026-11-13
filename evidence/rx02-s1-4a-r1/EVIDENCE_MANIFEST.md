# RX02-S1-4A-R1-EVIDENCE-CLOSE-01 — Evidence Manifest

- **Task**: RX02-S1-4A-R1-EVIDENCE-CLOSE-01 (evidence-only closeout; NO source change)
- **PR**: kudzimusar/carup#266 (Draft)
- **Source SHA (exact, unchanged)**: `f2f481d3dd2b014ff30ee75de1f5001ca368f0cf`
- **Branch**: `feat/rx02a-s1-4a-shell-prototype`
- **Closeout date (UTC)**: 2026-11-13
- **Base image**: monorepo main @ `8bc00bd75f5285997065872514d10db8fbecd24f` + 15 PR files (verified 15/15 against f2f481d blob SHAs — see `verify-s15a.txt`)

## 1. Test results

| Suite | Command (run in monorepo root) | Result | Exit |
|---|---|---|---|
| Focused | `npm run test:unit --workspace=web -- shellPrototype.test.tsx` | **Test Files 1 passed (1) / Tests 26 passed (26)** | 0 |
| Complete web suite | `npm run test:unit --workspace=web` | **Test Files 171 passed (171) / Tests 1631 passed (1631)** | 0 |

Logs (full, unabridged): `focused-tests.log`, `full-test-unit.log`.
Install gate: `npm ci --no-audit --no-fund --include-staged=true` then `node scripts/ensure-fonts.mjs` (6 faces, hashes match manifest).

### 1,630 vs 1,631 reconciliation

The figure **1,630 tests** in doc §8.1 was copied verbatim from the ORIGINAL head `17c6821` evidence, recorded before the R1 commit. R1 replaced 1 footer test ("renders the projected public footer (desktop only)") with 2 tests ("renders the projected public footer at EVERY viewport", "keeps the fixed bottom tab bar a SEPARATE surface from the footer") — net **+1** → **1,631**. The actual full-suite run above at SHA `f2f481d` reports 171 files / **1631 tests**, matching §9 of the doc. The §8.1 line is a stale copy-forward, not a test discrepancy. This is explained in the versioned PR comment; no docs-only commit made (Moderator: docs-only commit only if the reviewer requires it).

## 2. Production build + DEV-only exclusion evidence

| Item | File | Key content |
|---|---|---|
| Build log | `build.log` | `npm run build` → vite 7.3.5, 2818 modules transformed, built in 10.87s, `BUILD_EXIT=0` |
| Type check | `tsc.log` | `TSC_EXIT=0` |
| dist inventory | `dist-inventory.txt` | 29 files, every file with byte size |
| Positive app marker | `dist-positive-marker.txt` | dist exists; index.html loads hashed bundle `index-Bu2xQqVL.js`; "Zimbabwe" identity marker present; `createRoot` entrypoint present; bundles non-empty (JS 3,377,379 B total) |
| Exclusion search | `dist-exclusion-search.txt` | 6/6 tokens **zero hits**, each with command + exit status 1: `rx02-s1-4a-shells`, `FICTIONAL_FIXTURE_NOTICE`, `fixture-dealer-001`, `shell-public-footer`, `Rx02S14ShellPrototype`, `P. Ndlovu` |
| dist checksums | `dist-checksums-sha256.txt` | SHA-256 of all 29 dist files |

Build input SHA: `f2f481d3dd2b014ff30ee75de1f5001ca368f0cf`. Any token hit would have been reported as a genuine production-isolation defect — none found. Note: an earlier script-quoting bug split the two-word token; the corrected run (each token quoted, `grep -rnF`) is what is recorded.

## 3. Screenshot + browser-verification evidence (from R1 capture run)

11 PNG captures + 1 machine-readable report, unchanged since the R1 capture at the same source SHA (checksums in `screenshots-sha256.txt`):

| File | Content |
|---|---|
| `r1-footer-mobile-360.png` / `-390.png` | Footer scrolled into view at mobile widths |
| `r1-footer-full-mobile-360.png` / `-390.png` | Full-page captures, mobile |
| `r1-footer-tablet-768.png`, `r1-footer-full-tablet-768.png` | Tablet |
| `r1-footer-desktop-1280.png` / `-1920.png`, `r1-footer-full-desktop-1280.png` / `-1920.png` | Desktop |
| `r1-masthead-brand-dark-360.png` | Dark/ink brand surface (public masthead, tone="ink") |
| `r1-report.json` | Computed styles, clearance geometry, overflow, keyboard, axe |

`r1-report.json` key results (overallOk: true):
- Footer `display: block`, visible at **all five widths** (360/390/768/1280/1920)
- Clearance: legal row bottom **704px** vs fixed bottom-bar top **731px** at 360/390 (27px clear, no overlap); bar `display:none` at ≥lg
- Overflow: scrollWidth == clientWidth at all widths (ok: true ×5)
- Keyboard: footer link focus ring confirmed at 360/390/768
- axe-core: **0 violations** at all five widths

The PNG captures ship in the attached evidence ZIP (checksums + source SHA inside); the machine-readable report is `r1-report.json` in this directory.

## 4. PR-file byte verification

`verify-s15a.sh` / `verify-s15a.txt`: all 15 files of PR #266 byte-match the blob SHAs at head `f2f481d` (`VERIFY_OK=15 VERIFY_FAIL=0`).

## 5. Contents listing

```
evidence/rx02-s1-4a-r1/
├── EVIDENCE_MANIFEST.md          (this file)
├── verify-s15a.sh
├── verify-s15a.txt
├── tsc.log
├── build.log
├── focused-tests.log
├── full-test-unit.log
├── dist-inventory.txt
├── dist-positive-marker.txt
├── dist-exclusion-search.txt
├── dist-checksums-sha256.txt
├── screenshots-sha256.txt
└── r1-report.json
```
