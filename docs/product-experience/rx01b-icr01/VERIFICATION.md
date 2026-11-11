# RX-01B-ICR01 — Verification Instructions

**Programme:** CARUP-UX-REBUILD-01 · **Return:** RX-01B-ICR01 Final Handoff Closure (second correction applied)
**Design source:** MP01 v0.9.2 @ PR #259 head `9940647ff091e46a03cf5480e046f95b34788cdf` (file blob `57236b5a567786d073c51c062a7a0ede10a1663f`)
**Base:** `main@9f2bebfe66a19e4d90c44085a3166562d2176626` (verified at branch creation)
**Draft PR:** #260 (`docs/rx01b-icr01-design-certification`, documentation-only, not merged)
**Authorization:** Moderator directive — final evidence packaging + one Draft documentation-only PR + bounded reviewer-context correction. No merge, no deployment, no application-code change, no commercial action.

## Package layout in this branch

| Path | Content |
|---|---|
| `docs/product-experience/UI_DESIGN_REFERENCE_AND_TOKENS.md` | Token & component contract v1.1 (corrected, WCAG AA-verified) |
| `docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` | 139-row route-to-shell authority register (R001–R139, Appendix B/F reconciled) |
| `docs/product-experience/rx01b-icr01/CARUP-UX-REBUILD-01_RX01B_DESIGN_SYSTEM_AND_EXPERIENCE_COMPLETION_PACKAGE.md` | UX-REF-01–10 completion package (§5.2 rule 4: Trade-gated Import orders; rule 8: protected review identity chrome) |
| `docs/product-experience/rx01b-icr01/CARUP-UX-REBUILD-01_RX01B_ICR01_FINAL_HANDOFF_CLOSURE_REPORT.md` | ICR01 closure report (C01–C06 + final corrections A/B + second correction C/D) |
| `docs/product-experience/rx01b-icr01/carup-contrast-check.py` | Machine-checkable WCAG 2.2 AA contrast gate |
| `docs/product-experience/rx01b-icr01/rx01b-contrast-matrix.{json,csv}` | 39 shipped token pairings, all AA-passing |
| `docs/product-experience/rx01b-icr01/VERIFICATION.md` | this file |

## Complete certification ZIP (delivered via programme channel, not committed)

`CARUP-UX-REBUILD-01_RX01B_ICR01_CERTIFICATION_BUNDLE.zip` — contains the above plus the corrected 28-screen prototype (`carup-rx01a-prototype.html` + `app/index.html`), all 48 evidence screenshots (`rx01b-evidence/`, incl. S06 Trade-gate capture; P19/W06 re-rendered with protected reviewer identity), `capture-index.json`, evidence `INDEX.md`, and `RX01B-ICR01-SHA256MANIFEST.txt`.

- **ZIP SHA-256:** `68069dd53bbefffc6f7d913298110c75cd05cc889dbe6115cf2f51ee1425d9e8`
- **Prototype SHA-256:** `106901355f37b4b22ce0e771ec26db06ac45238929e07d8134d05672644d30f0`
- Manifest: 59 entries covering every file in the ZIP (the manifest itself excluded): 11 non-image artifacts + 48 captures. Screenshot binaries are intentionally **not** duplicated into git.

## How to verify

```bash
# 1. Integrity — extract the ZIP, then:
sha256sum -c RX01B-ICR01-SHA256MANIFEST.txt
# expected: 59 lines "...: OK", zero failures

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
# 5. Reviewer-context isolation (render reviewer + reviewer-queue, assert):
#    - no "T. Moyo", no "Mvura Motors", no "Borrowdale" anywhere in either screen
#    - masthead "Independent review · Reviewer · step-up active"; footer
#      "All actions audited / Session: independent review / No org/branch context carried"
#    - dealer rail: "Import orders" present with ctxTrade=true, absent with ctxTrade=false
```

## Workflow hygiene (MP01 §23.5)

This PR touches only `docs/product-experience/`, which matches no staging/one-shot deployment workflow path filter; no workflow writes to shared staging from this diff.
