# Issue #164 Phase 8 — FINAL 32-step physical UAT result sheet

> **Clean sheet. No PASS is inherited from the first run.**
>
> The first physical UAT (14 PASS / 18 FAIL) was executed against `main`'s backend, not the candidate
> — see Addendum A of `ISSUE164_PHASE8_PHYSICAL_UAT_REMEDIATION_HANDOFF.md`. Its results are historical
> evidence only. Every step below starts blank and must be re-observed on the certified candidate.

## Candidate under test

| | |
|---|---|
| **Exact SHA** | `2f7e257a249b34d678b90869957245aab2d8707a` (docs-only descendant of `ff081b07…`, the Codex-round-6-clean, exact-head-CI-green code-certified commit — no file under `backend/`, `web/`, `database/`, or `scripts/` differs between the two) |
| **Frontend preview** | `https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app` |
| **Backend preview** | `https://carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app` |
| **Canonical staging** | `eoyenigwevnxwwhyhaer` |
| **Provenance receipt** | `evidence/issue164-phase8-provenance-receipt-2f7e257a.txt` — SHA equality **EQUAL**, zero calls to the stable staging backend |

**Before starting, re-run the receipt.** If the head has moved, the run is invalid:

```bash
node scripts/issue164-uat-provenance-receipt.mjs \
  --frontend=https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app \
  --expected-sha=$(git -C "$(git rev-parse --show-toplevel)" rev-parse HEAD)
```

Use the live PR head, not a pasted SHA — any push since this sheet was last edited moves the deployed
head and makes a hardcoded SHA stale.

## Recording rules

- Every step gets a **fresh** PASS/FAIL plus screenshot evidence. **No screenshot = no PASS.**
- A step that previously failed for the backend mismatch is `INVALID FOR CANDIDATE CERTIFICATION` in
  the historical record and has **no result** until re-observed here.
- A FAIL is an evidenced defect: record the step number, VIN, surface, and what was shown instead.

## Golden A — unauthenticated Buyer (private/incognito)

| # | Step | Expected | Result | Evidence |
|---:|---|---|:---:|---|
| 1 | Landing loads published listings | Featured cars load; no fake Verified badge, no `Trust NN` on cards | | |
| 2 | Golden A Landing facts | 2019 Toyota Hilux · USD 21,500 · **Bulawayo, Bulawayo Metropolitan, Zimbabwe** · first two governed tags only | | |
| 3 | Landing search `Hilux` | Navigates to `/marketplace?q=Hilux`, query preserved | | |
| 4 | Golden A Marketplace facts | Same identity/price/currency/location; no filler spec chips; no invented seller label | | |
| 5 | Landing ↔ Marketplace consistency | Identical identity, price, currency, location, primary image | | |
| 6 | Detail/Passport Trust | **60** · moderate · low · **`trust-decision-1.0.0`** · limitations listed | | |
| 7 | Same Trust everywhere for this VIN | Same score and version; no second numeric authority | | |
| 8 | Gallery vs verified evidence | **5** listing photos; **4** verified documents in a separate section | | |
| 9 | Reg. country / authority | Governed value or *not recorded* — never a bare `ZW`/`CVR` | | |
| 10 | Seller block | Only what the seller published; no fabricated phone; action disabled | | |
| 11 | Anonymous payload privacy | No `owner_id`, `tenant_id`, `current_seller_id` in any public payload | | |

## Golden A — authenticated Owner

| # | Step | Expected | Result | Evidence |
|---:|---|---|:---:|---|
| 12 | Owner Dashboard loads | Bell shows the real count from `/notifications/me`; never a confident `0` on a failed read | | |
| 13 | *Needs your attention* | Golden A **is** evaluated — no "awaiting assessment" item for it | | |
| 14 | Wallet / Trust Index / value tiles | *Not available* — no fabricated balance, score or trend | | |
| 15 | My Garage | Asking Price, stated mileage, trust bar only because a score exists; real media or neutral placeholder; **counts must not be false zeros** | | |
| 16 | `/dashboard/garage/CARUPGLDNA0000001` | No valuation language; header image is real listing media | | |
| 17 | Specs / purchase date | Recorded value or *Not recorded* — **`Purchased` must not be `created_at`** | | |
| 18 | Service / parts history | **Parts and services must not double-count one PartSentry row.** Measured truth: 1 part, 0 services, 1 active policy | | |
| 19 | Owner Trust vs public Trust | Identical **60** / same version | | |
| 20 | Owner top-bar search | `Hilux` → `/search?q=Hilux`; intent preserved. **Also check a narrow viewport** (OBS-14) | | |

## Golden B — unauthenticated Buyer (private/incognito)

| # | Step | Expected | Result | Evidence |
|---:|---|---|:---:|---|
| 21 | Marketplace search for the VIN | **Must NOT appear** — it is draft | | |
| 22 | Direct `/marketplace/CARUPGLDNB0000002` | Passport renders but not as a published listing; Reserve disabled with explanation | | |
| 23 | Trust | **50** · evaluated · moderate · low · **`trust-decision-1.0.0`** | | |
| 24 | Evidence & gallery | Both empty/withheld; pending document NOT shown publicly; absence never a clean bill of health | | |

## Golden B — authenticated Owner

| # | Step | Expected | Result | Evidence |
|---:|---|---|:---:|---|
| 25 | *Needs your attention* | Reflects real outstanding work. **Must not say "no completed trust assessment"** — B is evaluated at 50 | | |
| 26 | My Garage → Golden B | Recorded status or *Status not recorded*; no invented "Active" | | |
| 27 | `/dashboard/garage/CARUPGLDNB0000002` | Pending evidence shows as pending; no valuation, no stock image, **no fabricated purchase date** | | |
| 28 | Attempt to publish | Refused, **naming the blocking requirement** (ownership document awaiting verification). Vehicle stays draft | | |

## Cross-cutting

| # | Step | Expected | Result | Evidence |
|---:|---|---|:---:|---|
| 29 | `/dealers`, `/garages`, `/insurance` | Explicit verified-only empty states; no invented companies | | |
| 30 | `/press` and `/blog` | No fabricated integrations, personnel, metrics, partnerships or seeded comments; surfaces still live and visually intact | | |
| 31 | Search the UI for "blockchain" | Product surfaces say **CarUp audit ledger** | | |
| 32 | Local Storage | No key asserting reservation/escrow/payment/transaction state | | |

## Responsive / accessibility re-checks (OBS items)

| Item | Expected | Result | Evidence |
|---|---|:---:|---|
| OBS-16 | My Listings mobile: `Publish to Marketplace` stays **inside** the card; no horizontal overflow | | |
| OBS-06 | Disabled Call/WhatsApp/Reserve are **legible** and clearly disabled | | |
| OBS-02 | Detail price/action panel does not obstruct content while scrolling | | |
| OBS-14 | Owner search available on a narrow viewport | | |

## Non-regression invariants — must all still hold

1. Golden B absent from public Marketplace while draft.
2. Golden B Passport renders without becoming a published listing.
3. Golden B pending document withheld publicly, visible to its owner as pending.
4. Golden B draft listing media withheld publicly.
5. Reserve for B cannot initiate a transaction.
6. Publication gate rejects B and leaves it draft.
7. No fabricated seller phone; Call disabled when no number is published.
8. No bare `ZW`/`CVR` registration fallback.
9. Listing media and verified evidence remain distinct.
10. Dealer/Garage/Insurance directories keep honest verified-only empty states.
11. No `blockchain` wording on product surfaces.
12. Local Storage asserts no transaction truth.
13. Landing and owner search preserve query intent.
14. Wallet/value tiles invent no balance or trend.
15. No stock image substituted where vehicle media is unavailable.

## Result

| | |
|---|---|
| **PASS** | / 32 |
| **FAIL** | / 32 |
| **Overall** | |

A clean **32/32** on the certified candidate is the release gate. Regression tests are necessary but
not sufficient.

## After a clean run

1. Revoke the temporary Golden credentials (`--mode=revoke`) and delete the hash file.
2. Independent collaborator approval.
3. Protected merge to `main` — no admin bypass.
4. Post-merge staging smoke / invariant proof.
5. Close PR #161 as superseded.
6. Close Issue #164 with final receipts.
