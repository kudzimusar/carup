# CarUp Intelligence 1.0 — Implementation Lane Receipts

This directory holds the phase receipts for the **CarUp Intelligence 1.0 — Data, Analytics, AI & Stakeholder Intelligence** implementation programme (phases I0–I19).

## Lane facts

- **Canonical plan:** `docs/intelligence/CARUP_INTELLIGENCE_DATA_ANALYTICS_CANONICAL_PLAN.md` (PR #184, documentation head `0ea51b58cb7c89286112546d8b3f588f157199fe`). The plan itself remains owned by the documentation lane; this implementation lane does not modify it.
- **Owner authorization:** recorded on PR #184. It supersedes the plan's earlier "no third lane while Lane A and Lane B are active" restriction for this dedicated Intelligence lane only.
- **Branch:** `feat/carup-intelligence-1-0`, created from canonical `main@ba208963d863654157335189c60f587cbe330041` (verified equal to the SHA recorded at authorization; `main` had not moved).
- **Sibling lanes at branch time:** PR #182 (Marketplace Reliability / Reference UX, head `1242494e`) and PR #183 (Communications / Email Experience, head `507530aa`) — both open drafts. This lane must not overwrite or regress their files.
- **Production boundary:** this lane may implement and certify source + governed staging migrations only. No production promotion, production migrations, partner/government activation, or live money movement.

## Receipt index

| Phase | Receipt | Status |
|---|---|---|
| I0 | `I0_STAKEHOLDER_PROCESS_DATA_AUTHORITY_INVENTORY.md` (+ evidence appendices in `i0-appendices/`) | **complete** |
| I1 | `I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md` (+ verification lenses in `i1-appendices/`) | **frozen** |
| I2 | `I2_FIRST_PARTY_ACTIVITY_LEDGER.md` | **complete** — staging migration applied and proven |
| I3 | `I3_MARKETPLACE_INSTRUMENTATION.md` | I3a (server) + I3b (web) **complete**; I3c (mobile) + web card call sites **sequenced after PR #182** (those files are owned/created by that lane) |
| I4 | `I4_ROLLUPS_AND_READ_MODELS.md` | **complete** — reconciliation proven; staging migration applied |
| I5 | `I5_AUTHORIZATION_AND_PRIVACY_PROJECTIONS.md` | **complete** — boundaries proven; gap G5 closed for Intelligence |
| I6 | `I6_COMPLETENESS_AND_REVIEW_REMEDIATION.md` | **complete** — LC1/LO1 shipped; I2–I5 adversarial review resolved and pinned by 28 regression tests |
| — | `SECURITY_CLOSURE_G1_G2_G3.md` | **complete** @ `96eccff2` — G1/G2/G3 closed and proven live (moderator gate) |
| I7 | `I7_SELLER_OWNER_INTELLIGENCE.md` | in progress — Marketplace Pulse shipped; listing insights next |
