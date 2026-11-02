# CARUP-PAY-04-LR01 — sanitized evidence

Level 1 only: the isolated local stack (`carup-pay04-supabase`, API 127.0.0.1:56321, DB 127.0.0.1:56322), the local
garage payment-provider **simulator**, synthetic `.invalid` QA identities. No production, no shared staging, no
provider, no real money. Runtime candidate for every physical artefact: `d421965ec3ffaea19a45a6a53fe4601fe89313fc`.

| File | What it is |
|---|---|
| `http-matrix-d421965e.json` | The authenticated HTTP matrix: directive cases 1–23, the garage refund (R), concurrency (C1–C3), database invariants (INV) and the review fixes (RV1, RV2) — every money claim read back from the database. Records the runtime commit and the harness commit |
| `browser-journal-d421965e.json` | The headed-Chromium journal (provenance, case 6, cases 7/19, 8–12, refund, operator review, case 24 at three widths) |
| `qa-seed-summary-d421965e.json` | What the QA seed created (synthetic users, two garages, branches, the simulated merchant, payment instructions) — no credentials |
| `screens/*.png` | Element screenshots of the journeys (never full-page; see the PAY-03B finding) |
| `manifest-d421965e.json` | SHA-256 of every published file |
| `pg-certification.md` | The integrated PostgreSQL certification in both orders (upgrade fingerprint, certified PAY smokes on the PAY-04 writers, PAY-04 smokes) |
| `rls-and-privileges.md` | Fresh-install catalog evidence: RLS, grants, SECURITY DEFINER and `search_path` of every PAY-04 table and function; who enabled the simulator and when |
| `mutation-results.md` | 37/37 mutants of the review and UAT fixes killed at the runtime candidate, each by its intended assertion |
| `pay04_mutation_r1.py` | The mutation harness (disposable PostgreSQL and a detached worktree only) |

Published by `scripts/uat/pay04-sanitize-evidence.mjs <sha>`: the operator's home path is redacted and any file that
still contains a secret-shaped value (session tokens, simulator or provider secrets, JWTs, passwords) is refused.
Private, unsanitized logs stay outside the repository.
