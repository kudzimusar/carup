# T11-CAP-LR01-R2 — staging application and historical ingestion receipt

**Programme:** T11-CAP-LR01-R2 · **Product PR:** #243 (draft) · **Target:** approved staging project `eoyenigwevnxwwhyhaer` only · **Production:** not accessed

This receipt covers authority steps **C** (database-model closure, applied) and **D** (idempotent real historical ingestion). Every figure below was
read from the workflow run's own output *and* re-read independently through the read-only staging connection.

## 1. Custody

| | |
|---|---|
| Product commit the run was pinned to | `471f76801ba460a03ca6459d4ae841f05ac1ff98` (on `feat/trade-os-t11-cap-lr01-journey-arrival`) |
| Certification branch | `cert/t11-cap-lr01-r2-converge` — `7db70693` (product + **one workflow file**), push trigger retired at `7c850f05` |
| Workflow run | **40274757763** — conclusion `success`, 16 of 16 steps green, started 2026-10-26T05:32:22Z |
| Custody gate inside the run | event = push · branch name · product SHA is an ancestor of the cert head **and** of the product branch · `git diff` product…cert is exactly `.github/workflows/t11-cap-lr01-r2-converge.yml` · eight reviewed blobs pinned |
| Reviewed bytes (git blob) | migration `49d75cb5…` · converge script `14aa7ddc…` · ingest script `15d136b7…` · facts file `1fcaa761…` · expected manifest `76796ecf…` · R1 harness `c24ab3bb…` · R1 seed `90924e2e…` · migration parser `6c94f383…` |
| Authority to write | workflow secret `DIASPORA_STAGING_DATABASE_URL`; the harness refuses any URL that is not the approved staging project and refuses the production reference **by name**, and the workflow refuses it a second time before any script runs |
| Concurrency | no other session was running; no in-flight workflow touched staging |

## 2. Step C — the five additive authorities (one migration)

`database/migrations/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql`, applied in **one transaction together with its ledger row**.

| Phase | Result (from the run) |
|---|---|
| Preflight (read-only) | `READY_TO_APPLY` — no ledger row, no owned object present (a *partial* state would have been a STOP); live prerequisites (6 tables, 9 columns and types) verified against the live catalog |
| Foreign-object fingerprint, before | `477cad5045daed30118e68973fb9d290` over **8 901** objects the migration does not own |
| Apply | `20260926090000_…authorities.sql:applied`; the same fingerprint taken **after, inside the transaction**, before commit — identical, so the transaction was allowed to commit |
| Verify (inside apply, then an independent second pass) | `CATALOG_MATCHES_EXPECTED` — functions 4 · tables 5 · triggers 11 · constraints 97 · indexes 18 · **0 problems** |

Independent read-only re-check: all five tables have **row security enabled and forced**, **0 policies**, and **no privilege at all for `anon` or `authenticated`**
(`service_role` can read). The migration ledger row is present exactly once.

## 3. Step D — the historical ingestion

Source of the facts: the Owner-authorised capture of the Owner's own purchase, transcribed **verbatim** into
`backend/scripts/data/t11-cap-r2-historical-facts.json` (sha256 of the file the run read: `b1c48fdd38cac199c3fe08f77920ed289e8e465f059be5b16f868f37328e1516`).
The page's capability token is **not** in the facts, the repository, the database, the logs or this document (it was never held by this programme).

| Phase | Result |
|---|---|
| Rehearsal gate (no database) | 267 migration checks (PGlite) + 100 ingestion/harness tests green |
| Preflight — the **whole write inside a transaction that is rolled back** | `committed:false`; would create parties 5 · dispatches 1 · ledger rows 14 · specification observations 13 · media references 50 |
| Apply | `committed:true`; created **exactly** those counts (5 / 1 / 14 / 13 / 50) |
| Verify | `MATCHES`, 0 problems |
| **Idempotency** — a second `apply` in the same run | `created:{}`, `existing` = all 83 rows, verdict `MATCHES`, **no new audit entry** |

### Everything else was untouched (the tripwire, before = after, taken inside the transaction)

| Fingerprint (`md5(row_to_json(t)::text)`) | Before | After |
|---|---|---|
| Protected vehicle — the Nissan Serena `GFC27-027051` | `e9d216b9ca1eb39440d9be8ab39123e6` | `e9d216b9ca1eb39440d9be8ab39123e6` |
| Target vehicle — the Honda Vezel `RU3-1316558` | `80823a186bc7beb2c071b64a0be677fd` | `80823a186bc7beb2c071b64a0be677fd` |
| Import order `3e2b66a0-1e8b-43c9-bd48-507f88016f71` | `4714abd7b98bd752e093ee02f71a7f59` | `4714abd7b98bd752e093ee02f71a7f59` |
| Shipment `f8cb8f50-ba8d-4cff-b515-1fb1fbe9c1fb` | `4f7431fda0687016896867f2370b5e06` | `4f7431fda0687016896867f2370b5e06` |

| Count | Before = after |
|---|---|
| shipment stage events / observations / legs | 1 / 0 / 1 |
| shipments / orders / vehicles | 4 / 221 / 370 |
| evidence rows (Vezel / Serena) | 53 / 5 |
| `listing_images` (Vezel / Serena) | 0 / 10 |
| T8 documents on the order | 3 |
| payment milestones / customs cases | 0 / 0 |
| `domain_events` / `notification_queue` | 1 947 / 1 888 (nothing emitted, nothing queued) |

## 4. What the database now holds (independently read through the read-only connection, 2026-10-26)

* **Reported progress — 14 rows**, `entry_sequence` 1…14: Booking **7**, Departure **1**, B/L **3**, Dispatch **1**, Clearing & Delivery **2**; every `reported_status = COMPLETED`;
  **`event_time` and `event_time_basis` are NULL on all 14** (the source supplied no time and none was invented); `verification_status = REPORTED`; action takers exactly as the
  source stated them (BE FORWARD, SHIPPING COMPANY, BF DOCUMENT CENTER, BE FORWARD TANZANIA, and the customer's own two actions); the source's own misspelling ("Comfirmed") kept verbatim.
* **Parties — 5**: consignee, notify party, document delivery address, document centre, destination agent. The consignee row holds the *declared name* and `HARARE / Zimbabwe` only:
  **street address, phone and email are NULL** (they live on the owner's account profile, the one home for those details).
* **Document dispatch — 1**: `DELIVERED`, status phrase **"Arrived at delivery address"** in the sender's own words, document type `bill_of_lading`, recipient = the delivery-address party;
  **`tracking_number`, `courier_name`, `dispatched_at`, `delivered_at` are all NULL** — the portal stores a *status phrase* in its tracking-number field and states no number, courier or time.
* **Specification observations — 13**: model code, registration and manufacture year/month, engine displacement, steering side, seats, doors, fuel detail, and five equipment items — each with its raw source value.
* **Media references — 50**: gallery positions 1…50, all distinct, 50 distinct evidence assets, one designated primary (position 1, basis `SOURCE_FIRST_IMAGE`, a *stated* choice),
  all for `RU3-1316558`; **no binary was copied, no `listing_images` row was written, no evidence row was edited.**

## 5. Provenance proof

Every ingested row carries, in backend columns: `source_system` (`BE_FORWARD_CAP`), `source_reference` (the external purchase reference), `source_position` (the row's place on the source
page), `evidence_ref` (a pointer into the private capture bundle), `evidence_digest` (sha256 of the captured text node), `observed_at` (the capture's time, **not** the import time),
`imported_at`, `ingestion_run` (`t11-cap-lr01-r2-ingest-1`), and `metadata.provenance` naming the programme and the facts file's digest. The customer's page shows attribution
("Reported by …") from this data; **provenance is retained, and it is a record, not a dependency.**

## 6. Conflict behaviour (the ingestion STOPS and reports; it never "fixes")

Each of these is a tested stop condition (64 ingestion tests; mutation pass 67/67): a vehicle owned by someone else · two live orders for the vehicle · an order naming a *different* external reference ·
two live shipments · a photograph count other than 50 · two photographs sharing an upload instant (the order would be a guess) · a non-image or a rejected asset ·
a prerequisite migration not applied · an existing row that **disagrees** with the plan (reported by table, never overwritten) · a live row the plan does not contain ·
an existing row that carries a completion time · a divergent dispatch / specification / media reference · and the **tripwire**: if the protected vehicle, the target vehicle, the order, the shipment,
any movement event, any notification or any count outside the five tables moves, the whole run **rolls back**. On the real staging data, every precondition held (one live order, one live shipment, 50 distinct images).

## 7. Rollback and recovery

Nothing is ever deleted: the new tables have an immutability guard and a no-delete guard. Recovery is `--mode=supersede`, which marks *this run's* rows `SUPERSEDED` (leaving other runs'
rows alone), requires a typed confirmation, is audited, and has its own tripwire (if it moves anything else it rolls back and supersedes nothing). A repeat of `apply` then records afresh.
The migration itself is additive; a rollback would drop only the five tables and four functions it owns.

## 8. Audit trail

Five audit entries, one per table (`CAP_R2_PROGRESS_INGESTED`, `…_PARTIES_…`, `…_DISPATCH_…`, `…_SPECIFICATIONS_…`, `…_MEDIA_REFERENCED`), `actor_id` NULL (no person is named), created
**2026-10-26 05:34:51Z (database clock)**. The idempotent second apply wrote none.

*Production Supabase `vhmnajoeicasaigiophh` was not accessed, queried, migrated or mutated. No external site was contacted.*
