# GARAGE-1.0-FINAL — capability matrix

Written for: the Moderator, who holds final acceptance. This document recommends; it does not accept.

**Final product commit:** `8353dbdd7eb9382d210d8f9eff48a7300ec36224` (PR #242, Draft, base = OPS03 `07b60e5d`; PR #241 untouched).
**Physical UAT:** 20 of 20, one continuous run, on the exact-SHA Preview pair for that commit (backend `dpl_HZdWCS6yVP4WYnkd94orJdsQCX2b`,
web `dpl_86Tvoh2ERqNb7CCB7h9Y3HLZz2Aa`), against staging project `eoyenigwevnxwwhyhaer`. Canonical staging is **unchanged** at `07b60e5d`.

Terminal states (the only three allowed):
**ACCEPTANCE READY** · **SOURCE COMPLETE — PHYSICAL EXTERNAL GATE** · **BLOCKED — exact external/owner authority**.

| # | Capability | Terminal state | What is proven | Where |
|---|---|---|---|---|
| 1 | Activation / setup | ACCEPTANCE READY | Inherited (GMO/OC-5/OPS01). The synthetic Garage is published and active; the setup pages load in the regression test. Not changed. | UAT test 15 |
| 2 | Sites | ACCEPTANCE READY | OPS01 consumed. **New:** the garage chooses the site that does the job when it accepts (required with 2+ active sites, preselected with one, stated when none, held back with a retry if the list cannot load); the hub names the site. Found while building the appointment step — nothing previously gave a customer-created request a site. | UAT 02, 15a; 7 unit tests |
| 3 | Workforce | ACCEPTANCE READY | OPS01 consumed; planned mechanic chosen when confirming an appointment; mechanic assigned to the job. | UAT 02c, 06, 15b |
| 4 | CRM | ACCEPTANCE READY | OPS02 consumed; the new customer relationship is created and shown; the commercial block is admin-only. | UAT 15c; audit `GARAGE_CUSTOMER_RELATIONSHIP_CREATED` |
| 5 | Vehicles | ACCEPTANCE READY | Customer's vehicle; the customer's authority is re-proven against the canonical `vehicles.owner_id`; **the vehicle's own odometer stayed 15,000** after a garage observation of 15,420. | witness `fixture_vehicle` |
| 6 | Appointments | ACCEPTANCE READY | On staging: requested by the customer → confirmed by the garage with a planned mechanic → shown in the hub → marked fulfilled. History `requested, confirmed, fulfilled`. | UAT 02c, 09b; witness |
| 7 | Capacity | ACCEPTANCE READY | OPS03 capacity listing used by the customer to find a bookable slot (site capacity 1); retained OPS03 cases open in the new hub. | UAT 02c, 15 |
| 8 | Estimate | ACCEPTANCE READY | Explicit currency (the form refuses to guess one), blank price = "not recorded" never 0, server-derived total, frozen at send, versions, revise/cancel. 10 sent versions (7 accepted, 3 declined) reconciled across both windows. | UAT 03; reconciliation |
| 9 | Customer authorization | ACCEPTANCE READY | **One authority.** Accepting an estimate calls the existing `mechanic_work_order_decide_authorization` in the same transaction. A direct decision while an estimate is out is refused (`decision_via_estimate`); the garage cannot authorize its own job (`not_custodian`). | UAT 04, 05 |
| 10 | Work order | ACCEPTANCE READY | One per case, created by the first estimate (not by acceptance). | UAT 02, 03 |
| 11 | Mechanic assignment | ACCEPTANCE READY | Assign/unassign; the assignee sees "You". | UAT 06, 07 |
| 12 | Work execution | ACCEPTANCE READY | Enforced **in the database**: start needs an authorized, assigned job; records need a started job; complete needs a record. Four distinct refusals proven on a declined job. | UAT 11; real-PG race suite |
| 13 | Service record | ACCEPTANCE READY | Written after authorization on every row (checked from the DB, not the screen). | reconciliation |
| 14 | Mileage observation | ACCEPTANCE READY | Recorded as `garage_stated`; never rewrites the vehicle. | witness |
| 15 | Parts usage | ACCEPTANCE READY | Backed by a matching consumption movement on every row; reversible. | UAT 07; reconciliation |
| 16 | Inventory | ACCEPTANCE READY | Counted opening quantity (never defaulted), receive, count, append-only ledger with an unbroken balance chain: 10 + 5 − 4 = 11. | UAT 06, 10 |
| 17 | Supplier / procurement | **BLOCKED — no governed supplier or procurement authority exists** | Supplier is free text, shown as "not verified". No registry, rating, SLA or purchase order is claimed or built. | authority reconstruction |
| 18 | Invoice | ACCEPTANCE READY | A document, not a payment. The form **refuses an unpriced line** ("a missing cost is not zero"); total = sum of lines; compared with the estimate (difference 0.00). Gapless `INV-` numbering. | UAT 08 |
| 19a | Payment — recorded by the garage | ACCEPTANCE READY | Partial then final; every row labelled `garage_recorded_external` ("CarUp has not processed or verified this payment"); overpayment refused with the balance named. | UAT 08 |
| 19b | Payment — processed or verified by CarUp | **BLOCKED — no canonical payment authority for garage services** | Marketplace escrow, SafeTrade and Diaspora billing cannot represent a garage service payment and were not force-fitted. | authority reconstruction |
| 20 | Receipt | ACCEPTANCE READY | Exactly one per payment, same amount and source; impossible without a payment (trigger). Gapless `RCT-` numbering. | reconciliation |
| 21 | Communications | **SOURCE COMPLETE — PHYSICAL EXTERNAL GATE** | Governed in-app template and policies exist; events are emitted correctly with dedupe keys. **Delivery needs the canonical communications worker at this build:** the old worker dead-letters unknown events (`NO_CURRENT_SUBSCRIBER`). 27 of this campaign's `garage.*` events are dead-lettered for that reason; case-status notifications (existing events) deliver normally. Owner action: runbook. | UAT 17; witness; runbook |
| 22 | Customer history | ACCEPTANCE READY | The customer's service history carries the mechanic's record and the odometer reading. | UAT 13 |
| 23 | Vehicle history | ACCEPTANCE READY | Passport/lifecycle projection consumed unchanged; convergence tested in the PostgreSQL world and through the customer history. | `garage-history-convergence.test.js`; UAT 13 |
| 24 | Operational analytics | ACCEPTANCE READY | Read-only view over recorded facts, per currency, never added or converted; a long "Not measured" list with a reason for each (capacity/staffing utilisation, revenue, profit, …). | UAT 10 |
| 25 | Audit | ACCEPTANCE READY | 14 audit event types across the final run (13 Garage events plus tenant selection), each written in the same transaction as its change; append-only event tables. | witness `trust_audit_events` |
| 26 | Desktop | ACCEPTANCE READY | 1440×1000, visible Chrome, 52 screenshots in the final run. | `uat-final2-*/screens` |
| 27 | Mobile | ACCEPTANCE READY | 390×844: admin hub, mechanic hub, customer requests, stock, operations — no horizontal overflow. | UAT 12 |
| 28 | Security | ACCEPTANCE READY | Server-side money redaction (the mechanic's hub **payload** has no price); role and tenancy refusals at the right layer; RLS forced on all 11 new tables; no function exposed to `anon` except trigger functions and two pure helpers; zero writes in any other tenant. | UAT 14; activation `verify.json`; witness |
| 29 | Staging runtime | **SOURCE COMPLETE — PHYSICAL EXTERNAL GATE** | Database: migrations applied, catalog identical to the tested world. Runtime: exact-SHA pair proven (paired, staging DB only, sends disabled). **Moving the canonical hosts is an Owner action** (the harness refuses `vercel deploy --prod`/`alias set` for Claude); two guarded scripts are provided. | runbook |

Counts (30 lines, row 19 split in two): 26 ACCEPTANCE READY (rows 1–16, 18, 19a, 20, 22–28), 2 SOURCE COMPLETE — PHYSICAL EXTERNAL GATE (21, 29), 2 BLOCKED on an external authority that does not exist (17, 19b).

## Honest limits

* The canonical staging runtime is not at the final build; everything physical was proven on an exact-SHA Preview pair that shares the staging database. A canonical re-run is specified in the runbook.
* `Diaspora Deployed Staging UAT` and `Seller Home & Lifecycle Staging UAT` are reviewer-gated workflows on PR #242; they were not approved by this campaign.
* The full backend suite (9,019 tests, Node 20, CI environment) has 10 non-passing tests in two files — `vehicle-life-taxonomy` (`pngjs` is absent from this machine's partial install) and `oc5r-prov01-fx-observation-policy` — that fail **identically on the untouched OPS03 parent**, so they are not caused by this campaign.
