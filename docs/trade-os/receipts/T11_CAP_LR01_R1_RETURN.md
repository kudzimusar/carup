# T11-CAP-LR01-R1 — Return packet

**Written for:** the Moderator. Detail and evidence are in [T11_CAP_LR01_R1_UAT_RECEIPT.md](T11_CAP_LR01_R1_UAT_RECEIPT.md); this is the consolidated packet.

**Production (`vhmnajoeicasaigiophh`): not accessed.** **Canonical staging: untouched** (both canonical hosts still serve Garage `8353dbdd`, `dpl_76Zt2nhw…`).
**Self-acceptance: none.** Acceptance is yours.

## What the Moderator asked for, and where it stands

| Required | Result |
|---|---|
| **D2 remediation evidence** | Fixed in T11's participant tracking (`1a985971`) and in the Journey's own selection and alert recipients. 14 regression tests; ~30 retired-behaviour tests rewritten to the ruled rule with positive controls; every mutant killed. |
| **Vezel real-data provenance** | Vehicle `RU3-1316558`, order `3e2b66a0-1e8b-43c9-bd48-507f88016f71`, shipment `f8cb8f50-ba8d-4cff-b515-1fb1fbe9c1fb`, one declared leg `1568f390-0179-43fb-bb6e-b622b9759992`, created from CAP-observed facts only; every field's basis recorded; nothing invented (receipt §4). |
| **Serena untouched** | md5 `e9d216b9ca1eb39440d9be8ab39123e6` before and after the seed, after the Owner's uploads, and after both D9 runs; vehicles 369 → 370 (the Vezel only). |
| **Final candidate SHA** | **`b1de03726866d46d9ce1a3c52eb6a6a930b9e016`** — the branch merged onto the runtime canonical staging serves, because the Trade OS base cannot authenticate against current staging (receipt §2). Journey/D2/seed files byte-identical to the branch. |
| **Tests** | Backend 9,474 · 0 fail · 39 skipped (+9 environmental cancellations, identical on the Garage baseline); web 3,034/3,034; `tsc -b`, build, lint, manifest in sync; PGlite checks 23/39/32 (receipt §12). |
| **Preview deployment** | backend `dpl_3YjzzxjkNWadqBpJ4rtdUkMPhKs8`, web `dpl_2NsEfzijAERNPf968ymBm4KDGNWG`; paired, proven from the served provenance and a browser capture of every `/api` host. |
| **Authenticated physical UAT** | Kingston Musarurwa (`u_66cace85fad949e4`), the Owner signing in themselves in a visible window. Vezel: plan and estimate worded as such, nothing departed/arrived/cleared/delivered, one declared leg, no invented ETA history, documents 3 of 6 awaiting review, statistics "no organiser recorded". Serena: "No journey yet", nothing borrowed. |
| **Phone / tablet / desktop** | 390 / 768 / 1280 (and 1920): no horizontal scroll, no element past the edge, no critical fact clipped; 24 private screenshots including before-import and after-import (receipt §10, §14). |
| **Authorization isolation** | Kingston reads both vehicles and his own unrelated order; two unrelated ordinary identities are refused every request, identically for what exists and what does not (run `40167377258`, PASS). |
| **D9 result** | **Bounded certification PASS** on the real staging database with the exact candidate's code — 26 checks, always rolled back, nothing survived (runs `40174488695`, `40174673754`; receipt §11). Residual, stated as an environment limitation: the worker's claim loop, the PostgREST insert path and the inbox read path were not exercised. |
| **Remaining follow-ups** | Receipt §13 (eleven items; none blocks what is delivered). |
| **Draft PR custody** | See below. |

## The Owner's request mid-run (media and forms)

Done for what CAP supports: the three documents into the order's Documents page and into the passport's evidence, and all 50 gallery photos into the passport's evidence (Import → Export-yard photo), all Private and awaiting review. Not done, with reasons: the Seller Studio listing form (its identifier rule needs 12+ characters and the Vezel's real chassis has 11 — a model blocker, nothing padded or saved) and the order page's container-reservation form (the purchase is on a vessel with no container). The CAP token stayed in memory only; no file, commit, receipt or git history holds it (scanned); it remains in this session's transcript.

## Findings the Moderator should read first

1. **Nobody can sign in to current staging through a Trade OS-base backend** (the session table moved behind a dedicated authority on 2026-10-16/17). Any physical UAT of PR #207's lineage needs the current runtime.
2. **My own CAP-03 route was never registered in the platform's route governance**, so the runtime served it as HTTP 404 — found only by running on the current platform; fixed, and the T8 route it links to registered too.
3. **The alert path's earlier "unproven" status is closed on the real schema** — but only for the notifier-to-notice stages; the worker loop itself still needs a runtime that processes events with this code.
4. **The draft PR's CI is red for two reasons that are not this work's** (receipt §12a): an expired-date fixture in frozen T3 (`diaspora-logistics-rfq.test.js:236`), which also masks the steps behind it; and the deployed-staging gate refusing an unregistered branch. I changed neither T3 nor the governance files. Registering the branch for that gate is your decision.

## Draft PR

**Draft PR #243** — <https://github.com/kudzimusar/carup/pull/243> · base `feat/trade-os-client-demo-convergence` (parent head `577428de`, unchanged at the last poll) ·
head `feat/trade-os-t11-cap-lr01-journey-arrival`, opened at `9a0f3878` (local == origin). **Draft, not merged, not marked ready.** Commits above `9a0f3878` are
documentation-only (this packet and the receipt) and are recorded in the PR automatically.

CI on `9a0f3878` is **7 pass · 3 fail · 4 skipped**, and neither failure is a defect in this work (receipt §12a): a frozen T3 test whose hard-coded 2026-10 dates have
expired (proven: fails on the real clock, passes 18/18 with the clock pinned), and the deployed-staging gate refusing the branch as `UNGOVERNED_BRANCH` before touching staging.
The web type-check, route validation and production build sit behind the first failure and never ran in CI, so I ran them on that exact head: all clean, with a negative control.

`RECOMMEND ACCEPT — T11-CAP-LR01-R1`
