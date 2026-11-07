# CarUp Dealership 1.0 — R6 DBA operations, lock order and rollback custody

Scope: the 20 dealership migrations `database/migrations/20261103120000…143000` (Draft PR #258).
This closes the R5 advisory DBA review findings #2, #4, #6, #7 and #8. #1, #3, #5 and the first
part of #7 were closed in 9731a20d. Every number below comes from a **disposable** local
PostgreSQL 17.11 cluster loaded with **synthetic** rows. No shared, staging or production
database was read or written, and nothing here contains real data or secrets.

---

## 1. Lock order (finding #4: deadlock 40P01)

### The rule

Every dealership write that touches programme stock and its operating link takes row locks in
this order, and **never** the reverse:

| # | Row(s) | Mode | Why it comes here |
|---|--------|------|-------------------|
| 1 | `tenants` row of the dealer | `FOR NO KEY UPDATE` | the lifecycle decision updates it; the tenant trigger starts from it |
| 2 | `dealer_profiles` row of the dealer | `FOR UPDATE` / `FOR NO KEY UPDATE` | the 20261103124000 compliance decision and the profile trigger start from it |
| 3 | the tenant's **published** `vehicles` rows, **ascending VIN** | `FOR NO KEY UPDATE` | the canonical write guard can only lock a vehicle before the link |
| 4 | `dealer_approved_seed_links` row | `FOR UPDATE` (suspend/withdraw) or `FOR SHARE` (guard, preparation, inquiry) | last |

Why the order has to be this way round: `dealer_guard_canonical_listing_write` is a
`BEFORE ROW` trigger on `vehicles`. PostgreSQL locks the vehicle row **before** the trigger
runs, and only then does the trigger take `FOR SHARE` on the link. So "vehicle, then link" is
fixed for every canonical publish, unpublish or seller change (`POST /api/vehicles/:vin/publish`
included). Before R6, every suspension or withdrawal path took the link first and then updated
vehicles. That cycle is review cases T5 and T6.

`FOR NO KEY UPDATE` is the same mode the withdrawal `UPDATE` takes anyway. It does not block
the `FOR KEY SHARE` locks that foreign-key checks take on a VIN (for example a branch
assignment). It is deliberately weaker than `FOR UPDATE`.

### Where it is enforced

- `dealer_lock_tenant_public_listings(uuid)` (20261103141000, service_role only) takes rule 3
  for one tenant. `dealer_withdraw_tenant_public_listings` calls it before its `UPDATE`, so two
  concurrent withdrawals of the same tenant also lock the VINs in one order.
- `dealer_record_operating_lifecycle_decision` (20261103142000) does an unlocked read of the
  link's tenant and profile, then takes rules 1, 2 and 3, then locks the link `FOR UPDATE`. If
  the link was re-pointed in between, it fails closed with
  `APPROVED_DEALER_LINK_CHANGED_DURING_DECISION`. No governed function re-points a link.
- `dealer_suspend_revoked_seed_claim` (claim dispute/revocation trigger, 20261103132000) takes
  rules 1, 2, 3 and then 4. It is written inline because 20261103141000 is not applied yet at
  that point.
- The tenant, profile and owner-membership withdrawal triggers (20261103141000) take rule 3 and
  then 4. Legacy tenants and profiles with no link still return before taking any lock.
- The country-policy trigger takes rule 3 for every affected dealer in **one** ascending-VIN
  statement, then locks the links in ascending `tenant_id` order.
- `dealer_prepare_canonical_listing` takes the VIN `FOR UPDATE` **before** the link
  `FOR SHARE`, the same way round as the guard.
- The inquiry guard takes only the link `FOR SHARE`. `marketplace_inquiries` has no lock on
  `vehicles` that conflicts with rule 3.
- The lapse sweep never locks a link. It locks only VINs, through the withdrawal function.

### Rules for new code and for operations

1. Never lock `dealer_approved_seed_links` and then write a programme VIN in the same
   transaction. Lock the VIN first.
2. If one transaction writes several programme VINs, write them in ascending VIN order.
3. Suspend, withdraw or reinstate through `dealer_record_operating_lifecycle_decision`, not
   through a direct `UPDATE dealer_approved_seed_links`.
4. **Emergency containment** (the R5 review recipe), made deadlock-safe:
   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '3s';
   -- rule 3 for every active dealer, one statement, ascending VIN
   SELECT 1 FROM vehicles v JOIN dealer_approved_seed_links l ON l.tenant_id = v.tenant_id
    WHERE l.operating_status = 'ACTIVE' AND v.publication_status = 'published'
    ORDER BY v.vin FOR NO KEY UPDATE OF v;
   -- rule 4, ascending tenant
   SELECT 1 FROM dealer_approved_seed_links WHERE operating_status = 'ACTIVE' ORDER BY tenant_id FOR UPDATE;
   UPDATE dealer_approved_seed_links SET operating_status = 'SUSPENDED' WHERE operating_status = 'ACTIVE';
   -- must return 0 before COMMIT
   SELECT count(*) FROM vehicles v JOIN dealer_approved_seed_links l ON l.tenant_id = v.tenant_id
    WHERE v.publication_status = 'published';
   COMMIT;
   ```
   If it fails with 55P03 or 40P01, nothing was changed. Run it again.

### Proof (native PG17, independent sessions, `pg_blocking_pids` instead of fixed sleeps)

`database/test/dealer_1_0_pglite_check.mjs`, block `R6 DBA #4`:

| Interleaving | Dealer-side transaction | Concurrent authority loss | Before R6 | After R6 |
|---|---|---|---|---|
| T5 | lock published VIN, then unpublish | lifecycle SUSPEND | 40P01 | both commit; 0 public listings |
| T6 | price edit, then governed-seller restatement | lifecycle SUSPEND | 40P01 | both commit; 0 public listings |
| PREPARE | preparation on a published VIN, queued behind a third session | lifecycle SUSPEND | 40P01 | suspension commits; preparation refused `NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP` |
| PROFILE | direct `dealer_profiles` write (compliance-decision shape) | lifecycle SUSPEND | 40P01 | both commit |
| CLAIM_DISPUTE / TENANT_STATUS / OWNER_MEMBERSHIP / COUNTRY_POLICY | lock published VIN, then unpublish | that write (inspected, then rolled back) | 40P01 | both complete; authority lost with 0 public listings |

Each pre-lock was mutation-checked by removing it. All 7 mutants failed with 40P01 (lifecycle
VIN pre-lock, lifecycle profile lock, preparation order, and the claim, tenant, membership and
policy triggers). Replacing `FOR NO KEY UPDATE` with `FOR UPDATE` passes, as expected: that only
adds blocking against FK `KEY SHARE`, it is not a correctness change. The R5 two-session publish-vs-suspend
interleavings and the R5 media-ticket single-use race are unchanged and still pass.

### Bounded retry (backend)

`backend/services/dealer/dealerTransientSqlRetry.js` → `rpcWithTransientRetry(db, fn, args)`

- Each `db.rpc` is one PostgREST transaction. When PostgreSQL returns **40P01** (deadlock
  victim) or **40001** (serialisation failure), the whole transaction has already been rolled
  back, so calling it again cannot apply anything twice.
- At most **3 calls in total**. The wait between calls is full jitter: up to 40 ms, then up to
  80 ms, capped at 250 ms. A persistent conflict comes back as the original error in about
  0.5 s.
- Everything else is returned after the first call:
  - business refusals (`RAISE EXCEPTION` → P0001)
  - `lock_timeout` (55P03)
  - constraint and privilege errors
  - errors with no SQLSTATE (the code never parses the message text)
  - thrown client or network faults
- Wired into `dealer_prepare_canonical_listing` (`dealerCanonicalListingService.js`) and
  `dealer_record_operating_lifecycle_decision` (`dealerOperatingLifecycleService.js`).
- Tested in `backend/tests/dealer-transient-sql-retry.test.js` (12 tests). 9 of 9 policy mutants
  are killed, including: retry any error, no give-up, 40P01 only, add 55P03, 4 attempts, no
  jitter, match on message text, and swallow thrown errors.

These RPCs are not wired, but could be:

- `dealer_record_independent_claim_review` (claim revocation) and
  `dealer_record_atomic_compliance_decision` (profile restriction). Both are whole-transaction
  RPCs on the suspension side. With the lock order above, neither can still be a deadlock
  victim against the guard.
- The canonical publish route `backend/routes/vehiclesRoutes.js` is a single-statement
  `.update()`. It can no longer deadlock against a suspension.

---

## 2. Rollback custody (finding #6)

Every Down that would drop business or append-only rows now refuses, **before any DDL**, while
those rows exist. 18 of the 20 migrations do this. The other two hold no rows:
- 20261103124000 only drops a function.
- 20261103125000 is the privilege barrier described below.

| Migration | Refusal | Custody |
|---|---|---|
| 20261103120000 | `CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY` | imported research snapshots (source row hashes) |
| 20261103121000 | `CANNOT_ROLLBACK_WITH_DEALER_CLAIM_REQUESTS` | claim requests |
| 20261103121000 | `CANNOT_ROLLBACK_WITH_RESEARCH_PUBLICATION_LEDGER` | append-only publication events **or** public profiles |
| 20261103122000 | `CANNOT_ROLLBACK_WITH_RESEARCH_CORRECTION_REQUESTS` | third-party correction/takedown requests |

The new checks use `to_regclass`, so a Down that runs a second time after its table was
already dropped is still a no-op.

**20261103125000 Down no longer restores the pre-migration grants.**

- The exact pre-migration state was set by 20260626150000: table-wide
  `GRANT INSERT, UPDATE ON dealer_profiles TO authenticated`, plus an owner `UPDATE` policy
  with no status predicate. That state is the privilege-escalation hole 125000 closes: a
  direct PostgREST caller could set `identity_status`, `compliance_review_state`,
  `active_state`, the suspension, investigation and restriction states, or `tenant_id` on its
  own row.
- No dealership rollback needs that state, and every dealership write runs as service_role.
- The Down therefore keeps the column-scoped grants and the status-guarded policy in place,
  and only raises a NOTICE.
- Re-applying the Up is idempotent (`REVOKE`/`GRANT`, then `DROP POLICY IF EXISTS` +
  `CREATE POLICY`).
- To change this barrier, fix forward.

Proof, in the harness (PGlite and native PG17):

- Each refusal fires against custody that is **non-empty** (4 seeds, 6 publication events,
  2 claims, 1 correction request), so none of the passes is vacuous. A refused Down changes
  nothing.
- The ledger-only case is covered: no current public profile, events still present.
- After the full 20-migration rollback, `authenticated` holds **0** table-wide grants and
  **0** authority-column grants on `dealer_profiles`.
- 6 of 6 guard mutants are killed. One of them re-adds the `GRANT` to the 125000 Down.

**Full rollback is still impossible once any dealer is activated.** That is by design: fix
forward.

---

## 3. Migration locking (finding #7)

- `SET lock_timeout = '3s';` now follows `-- +migrate Up` in **17 of the 20** migrations: every
  one that locks a pre-existing table. Locks come from foreign keys to `users`, `tenants`,
  `vehicles`, `dealer_profiles`, `dealer_branches`, `organizations` or
  `marketplace_inquiries`, from triggers and policies, and from `ALTER TABLE`.
- 20261103120000, 122000 and 124000 create only new `dealer_*` objects and functions, so they
  have no `SET`.
- The setting is session-scoped, the same as 141000. A migration run in the same session
  afterwards also inherits the 3 s bound.
- If a migration fails with **55P03**, the transaction was rolled back and nothing changed.
  Wait for the long transaction to finish, or stop it, then re-run the migration.
- 20261103138000's two `CHECK` constraints stay validated inline, and the file says why:
  - They constrain only the columns added in the same migration, which are `NULL` on every
    existing row, so validation cannot fail.
  - `ADD COLUMN` already holds ACCESS EXCLUSIVE on `dealer_branches` until the migration
    transaction commits, so `NOT VALID` + `VALIDATE` in the same transaction would not shorten
    any lock. It only helps when `VALIDATE` runs in a separate transaction.
  - `lock_timeout` bounds the wait for that lock instead.

Proof (native PG17): a concurrent session holds `ROW EXCLUSIVE` on `dealer_profiles`,
`dealer_branches` or `vehicles`. Starting from `lock_timeout = 0`, migrations 125000, 138000 and
141000 each fail with **55P03 after 3.00 s** and leave the catalog unchanged (same relation,
column, function and policy counts). Removing the `SET` is caught: the run then fails with
57014 from the harness's own 15 s guard. A static check pins which of the 20 files have the
`SET`.

---

## 4. Scheduled job `carup-dealer-listing-lapse-sweep` (finding #8)

**What it does.**
- 20261103141000 runs
  `cron.schedule('carup-dealer-listing-lapse-sweep', '*/10 * * * *', 'SELECT public.dealer_withdraw_lapsed_listing_authority(''pg_cron'')')`,
  but **only where the `pg_cron` extension is installed**. Applying 141000 to such a database
  starts the job at once.
- The job withdraws (never deletes) the public listings of programme dealers whose authority
  lapsed purely by time: legal approval, country policy or profile expiry.
- It finds those dealers with an index nested loop over `dealer_approved_seed_links`. With 100
  dealers it takes **0.46 ms**; see section 5.

**Idempotent and safe to overlap.**
- A second run straight after the first finds nothing and returns
  `{"tenants_withdrawn":0,"listings_withdrawn":0}`.
- pg_cron never runs two instances of the same job at once. A run that is due while the
  previous one is still going is queued.
- The sweep never republishes anything. It locks only VINs (rule 3, through the withdrawal
  function), never a link, so it cannot deadlock with a lifecycle decision.
- It needs READ COMMITTED (the database default). If `default_transaction_isolation` is ever
  raised, every run fails with `DEALER_LISTING_WITHDRAWAL_REQUIRES_READ_COMMITTED` and shows
  as `failed`. It fails closed: the canonical guard still refuses publication the moment
  authority lapses.
- Re-applying 141000 calls `cron.schedule` with the same job name, which updates the existing
  job (pg_cron ≥ 1.3) rather than creating a second one.

**Monitoring.**
```sql
SELECT jobid, schedule, active, username FROM cron.job WHERE jobname = 'carup-dealer-listing-lapse-sweep';
SELECT status, return_message, start_time, end_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'carup-dealer-listing-lapse-sweep')
 ORDER BY start_time DESC LIMIT 20;                         -- alert on any status = 'failed'
SELECT created_at, tenant_id, affected_listings FROM dealer_listing_authority_events
 WHERE reason_code = 'OPERATING_AUTHORITY_LAPSED' AND actor_id = 'pg_cron'
 ORDER BY created_at DESC LIMIT 20;                         -- what the sweep actually withdrew
```

**Retention.**
- pg_cron writes one `cron.job_run_details` row per run (`cron.log_run` is on by default). That
  is 144 rows a day, about 52,600 a year, and pg_cron never purges them.
- Purge **only this job's** rows. Other jobs' rows belong to their owners.
  ```sql
  DELETE FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'carup-dealer-listing-lapse-sweep')
     AND end_time < now() - interval '30 days';
  ```
- Run that by hand or schedule it as its own governed job, for example daily at 03:17. Whoever
  owns the database decides; no migration schedules it.
- The append-only `dealer_listing_authority_events` ledger is **not** purged. It is custody, and
  141000's Down refuses while it holds rows.

**Stop or restart.**
- Stop: `SELECT cron.unschedule('carup-dealer-listing-lapse-sweep');`
- Check it stopped: `SELECT count(*) FROM cron.job WHERE jobname = 'carup-dealer-listing-lapse-sweep'` should
  return 0.
- While it is stopped, pure time lapses stay public until the next dealership write or an
  operator runs `SELECT dealer_withdraw_lapsed_listing_authority('ops')`. The canonical guard
  still refuses any **new** publication or seller change once authority lapses.
- Restart: run the same `cron.schedule(...)` call as 141000.
- 141000's Down unschedules the job, but only after its custody check passes. That unschedule
  swallows errors so a role without pg_cron access can still roll back.

---

## 5. Trigger cost on non-programme rows (finding #2)

**Fixture** (`database/test/dealer_r6_trigger_cost_fixture.sql`). All rows are synthetic,
loaded after the 20 migrations (`DEALER_NATIVE_SCHEMA_ONLY=1`):

- **5,000** legacy tenants and **5,000** legacy memberships
- **50,000** legacy vehicles, 5% published, with `idx_vehicles_tenant` as in production
- **1,000** legacy dealer profiles
- **100** programme dealers with 400 VINs. The research seed universe is at most 104 dealers.

Under `session_replication_role = replica`, only the programme links' foreign-key targets are
stubbed.

**Method** (`database/test/dealer_r6_trigger_cost_bench.mjs`):
- Each statement runs as `EXPLAIN (ANALYZE, BUFFERS)` inside `BEGIN … ROLLBACK`, so nothing is
  kept.
- The dealership trigger is enabled or disabled inside the same transaction.
- 7 ON and 7 OFF runs alternate after a warm-up. The tables report medians.
- Two complete runs on PostgreSQL 17.11 (darwin-arm64, data in shared buffers) agreed to
  within about 12%. The table shows the second run.

| # | Statement on legacy rows | Rows | Trigger ON | Trigger OFF | Trigger time | Per row |
|---|---|---|---|---|---|---|
| S1 | `UPDATE vehicles SET publication_status` | 50,000 | 811 ms | 256 ms | 488 ms | **10.1 µs** |
| S2 | `INSERT INTO vehicles` | 20,000 | 318 ms | 111 ms | 190 ms | **9.7 µs** |
| S3 | single-VIN publish | 1 | 0.06 ms | 0.03 ms | 0.015 ms | 15 µs |
| S4 | `UPDATE vehicles SET price` (column not watched) | 50,000 | 311 ms | 313 ms | **0 (not fired)** | 0 |
| S5 | `UPDATE tenants SET status` | 5,000 | 43 ms | 9.6 ms | 34 ms | 6.7 µs |
| S6 | `UPDATE tenant_users SET role` | 5,000 | 52 ms | 16 ms | 35 ms | 7.0 µs |
| S7 | `INSERT INTO marketplace_inquiries` | 5,000 | 81 ms | 18 ms | 60 ms | 12.0 µs |
| S8 | `UPDATE dealer_profiles` risk column (2 triggers) | 1,000 | 17 ms | 2.8 ms | 14 ms | 13.6 µs |

How to read the table:

- **For non-programme rows, the fast path is a constant 7–14 µs per row.** That is one plpgsql
  call plus one lookup in a 3-page `dealer_approved_seed_links` (100 rows, 24 kB). For a
  single-row write it is negligible: 0.03 ms.
- The cost does not grow with the legacy fleet. Every lookup is keyed by the tenant, and no
  legacy row is ever locked: the lookup finds no link, so `FOR SHARE` locks nothing.
- The ×2.9–3.2 ratio on statements touching 20,000–50,000 rows matches the R5 review's ×2.3
  after its `::text` fix. It matters only for rare bulk administrative updates of the watched
  columns.
- Updating columns the triggers do not watch costs nothing (S4).

**Plans.**
- **Guard link lookup**, legacy tenant: `LockRows → Seq Scan` over 3 pages (0.010 ms), because a
  3-page table is cheaper to scan. When the planner is forced, it uses `Index Scan using
  dealer_approved_seed_links_tenant_id_key` (native uuid, 1 buffer), so the guard keeps a
  unique-index point lookup as dealers are added.
- **Lapse-sweep driver**: `Nested Loop → Index Only Scan dealer_approved_seed_links_tenant_id_key
  → Index Scan idx_vehicles_tenant`, 0.159 ms. The whole sweep function takes 0.46 ms.
- **R6 VIN pre-lock** for a programme tenant: `LockRows → Sort (vin) → Index Scan
  idx_vehicles_tenant`, 0.018 ms.

**Residual, not changed here.**
- The inquiry guard compares `dealer_approved_seed_links.tenant_id::text = NEW.seller_tenant_id`
  (141000, `dealer_guard_marketplace_inquiry`). The cast is on the indexed side, so the unique
  index **cannot** be used even when forced. It costs a 3-page seq scan today and would grow
  linearly with the number of dealers.
- It is also an exact text comparison, so a `seller_tenant_id` written as an upper-case or
  non-canonical UUID string would not match its link.
- Cast the text side instead, after checking the canonical UUID shape. The review's #1 fix
  covered the other casts but did not include this one.

---

## 6. Verification commands

```bash
# PGlite (single session)
PATH=/opt/homebrew/bin:$PATH node database/test/dealer_1_0_pglite_check.mjs
# native PG17 (disposable): lock-order races, lock_timeout probes, apply/rollback/reapply
DEALER_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:<port>/carup_dealer_isolated_ci \
  node database/test/dealer_1_0_pglite_check.mjs
# backend (node 22, ci.yml env)
cd backend && NODE_ENV=test … node --test tests/dealer-*.test.js tests/*migration*.test.js
```
