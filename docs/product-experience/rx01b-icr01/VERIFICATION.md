# RX-01B-ICR01 — Verification Instructions

**Programme:** CARUP-UX-REBUILD-01 · **Return:** RX-01B-ICR01 Final Handoff Closure
**Design source:** MP01 v0.9.2 @ PR #259 head `9940647ff091e46a03cf5480e046f95b34788cdf` (file blob `57236b5a567786d073c51c062a7a0ede10a1663f`)
**Base:** `main@9f2bebfe66a19e4d90c44085a3166562d2176626` (verified at branch creation)
**Authorization:** Moderator directive — final evidence packaging + one Draft documentation-only PR. No merge, no deployment, no application-code change, no commercial action.

## Package layout in this branch

| Path | Content |
|---|---|
| `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` | Token & component contract v1.1 (corrected, WCAG AA-verified) |
| `docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` | 139-row route-to-shell authority register (R001–R139, Appendix B/F reconciled) |
| `docs/product-experience/rx01b-icr01/CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | UX-REF-01–10 completion package |
| `docs/product-experience/rx01b-icr01/CARUP-UX-REBUILD-01_RX01B_ICR01_FINAL_HANDOFF_CLOSURE_REPORT.md` | ICR01 closure report (C01–C06 + final corrections A/B) |
| `docs/product-experience/rx01b-icr01/carup-contrast-check.py` | Machine-checkable WCAG 2.2 AA contrast gate |
| `docs/product-experience/rx01b-icr01/rx01b-contrast-matrix.{json,csv}` | 39 shipped token pairings, all AA-passing |
| `docs/product-experience/rx01b-icr01/VERIFICATION.md` | this file |

## Complete certification ZIP (delivered via programme channel, not committed)

`CARUP-UX-REBUILD-01_RX01B_ICR01_CERTIFICATION_BUNDLE.zip` — contains the above plus the corrected 28-screen prototype (`carup-rx01a-prototype.html` + `app/index.html`), all 47 evidence screenshots (`rx01b-evidence/`), `capture-index.json`, evidence `INDEX.md`, and `RX01B-ICR01-SHA256MANIFEST.txt`.

- **ZIP SHA-256:** `e5895b7ee6ba39aa9bfd3dec861c08c366c21d67de33b9e7e357b986c79a1608`
- **Prototype SHA-256:** `edad4730c98c0d72640044f4036379a891f1ffca6fcb0da6b0b34dda3273987a`
- Manifest: 58 entries covering every file in the ZIP (the manifest itself excluded). Screenshot binaries are intentionally **not** duplicated into git.

## How to verify

```bash
# 1. Integrity — extract the ZIP, then:
sha256sum -c RX01B-ICR01-SHA256MANIFEST.txt
# expected: 58 lines "...: OK", zero failures

# 2. Contrast — from the extracted package:
python3 carup-contrast-check.py
# expected final line: "39 shipped pairings checked — 0 AA failures." (exit code 0)

# 3. Route register:
python3 - <<'PY'
import csv
rows = list(csv.DictReader(open('UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv')))
ids = [r['route_id'] for r in rows]
assert len(rows) == 139 and len(set(ids)) == 139
assert ids == [f"R{i:03d}" for i in range(1, 140)]
print("route register OK: 139 unique routes R001–R139")
PY

# 4. Prototype screens — open carup-rx01a-prototype.html; the walkthrough grid
#    lists 12 UX-REF journeys over 28 reachable screens (no console errors).
```

## Workflow hygiene (MP01 §23.5)

This PR touches only `docs/product-experience/`, which matches no staging/one-shot deployment workflow path filter; no workflow writes to shared staging from this diff.
