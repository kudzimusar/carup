# CarUp Dealership 1.0 — exact 104-source local integrity audit

**Programme:** CARUP-DEALER-ONB-001-LR01-R1 · **Time:** 4 November 2026 · **Authority:** owner-connected 20-worksheet Google Sheets workbook (exported native XLSX).

**No real business verification or publication decision is represented here.**

## Input custody

- Google Sheet: https://docs.google.com/spreadsheets/d/10YntHvtk9PhrRjZQEMHWfnZgqT84hisTW_oOnt2ZhNQ/edit
- Source original: `Car Dealers Database!A8:K111` (104 source entries).
- DEV-8 crosswalk: `DEV 8 - Seed Catalogue!A2:U105` (104 entries).
- Exact exported XLSX SHA-256: `93ff168fd186debf3f5caa0bac00f2d739bcc4188d3ff4f6170d8d2d269e8ab0`.
- **New Owner-uploaded original workbook** `Zimbabwe Car Dealers & Automotive Companies Database(1).xlsx` has SHA-256 `a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137`, exactly matching the historical canonical attached-source fingerprint; the native Google Sheets re-export is SHA-256 `93ff168fd186debf3f5caa0bac00f2d739bcc4188d3ff4f6170d8d2d269e8ab0`. These remain different binary versions: **do not treat one hash as authorizing import of the other**.
- Source workbook was NEVER committed to a GitHub repo. Contact-rich source/cell values remain privately held.
- **Sheet-by-sheet reconciliation:** 20 worksheet names match. Original source `Car Dealers Database!A8:K111` and 104 `DEV 8 - Seed Catalogue!A2:U105` entries match exactly between uploaded original and native re-export. 18 sheets have no cell-value differences.
- **Eight incidental metadata-cell differences:** `START HERE!E22:E27` (6 cells) and `Data Quality!B24:B25` (2 cells) read `166` in uploaded original vs `136` in native export. These are NOT source IDs/businesses/categories/contacts or verification decisions, and are not evidence of 166 or 136 dealers. Source count stays **104**. Preserve both SHA values in custody.
- For a locally authorized future importer commit, use the exact Owner-attached original hash; refuse the other binary unless an explicit SHA-specific approval and source reconciliation is recorded. This reconciliation did not contact a PostgreSQL server or grant publication eligibility.

## Actual source import exercise

- **Isolated local engine:** disposable SQLite audit DB, NOT the PostgreSQL/PGlite source importer; no shared or production database was contacted.
- Rows inserted: **104**; read-back: **104**; deterministic source-replay read-back: **104**.
- Exact seed IDs: `ZW-DEAL-0001`–`ZW-DEAL-0104`, unique 104 of 104.
- Original row alignment: `A8:K111` matches the corresponding DEV-8 catalogue ID and identical ten source columns **104/104**.
- Source categories: 40 official/franchise-label **unverified**; 28 independent dealer; 13 importer/sourcing; 6 importer/bonded; 5 premium/luxury; 4 dealer/seller unclassified; 3 assembly/manufacturing; 3 marketplace/brokerage; 1 dealer/service; 1 commercial/heavy. **All categories are unreviewed research observations.**
- Geographic source rows: 12 city values observed; Harare 62, Bulawayo 15, Mutare 8, Gweru 5, Beitbridge 4.
- Collision candidates: **26 normalized equal name+city or address+city pairs** require independent duplicate/grouping review; no legal company was merged. **11 repeated source grouping hints** require parent/branch adjudication; highest observed group hint has ten rows.
- Publication eligibility reviewed by an authorized human: **0**; eligible public source entries published by this exercise: **0**; independently legally verified businesses: **0**; logo rights approvals: **0**.
- **Do not equate row identity with legal entity identity or real dealership operating capability.**

## Qualification boundary and next required proof

This local evidence supports **source count, category accounting, raw-to-DEV-8 crosswalk and repeat read-back**, not actual importer correctness on PostgreSQL. The application's private Postgres importer still requires execution with an exact SHA-matching authorized file on an isolated **loopback-only** PostgreSQL target (never shared staging or production). Each research record additionally requires a real independent human publication eligibility review, followed by scoped identity/claim/compliance review. A synthetic fixture may demonstrate the server's public listing behavior, but cannot legally publish any of these 104 source businesses.

A restricted SQLite audit store with the actual source values was created locally for this test and intentionally is **not attached or checked in**. The redacted machine-readable evidence remains available in the conversation attachment. Contacts, private people, licence scans and source URLs must not be added to public artifacts.
