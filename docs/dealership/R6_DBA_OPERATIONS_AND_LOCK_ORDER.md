# CarUp Dealership 1.0 — R6 DBA operations, lock order and rollback custody

Scope: the 23 dealership migrations `database/migrations/20261103120000…146000` (Draft PR #258).
This closes the R5 advisory DBA review findings #2, #4, #6, #7 and #8; the R6 independent DBA
review of candidate b2da0a74 ("review 2", findings #1–#12; section 8 maps each one); and the
closure re-verification of 4476e2c8 ("review 3": N1, N2, N4 and the #3/#8/#12 leftovers;
section 9). #1, #3, #5 and the first part of #7 of the R5 review were closed in 9731a20d. Every number below comes from a **disposable** local
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
| 3 | **all** the tenant's `vehicles` rows (any publication status), **ascending VIN**; several dealers at once: ascending **(tenant_id, vin)** | `FOR NO KEY UPDATE` | the canonical write guard can only lock a vehicle before the link |
| 4 | `dealer_approved_seed_links` row | `FOR UPDATE` (suspend/withdraw) or `FOR SHARE` (guard, preparation, inquiry) | last |

Why the order has to be this way round: `dealer_guard_canonical_listing_write` is a
`BEFORE ROW` trigger on `vehicles`. PostgreSQL locks the vehicle row **before** the trigger
runs, and only then does the trigger take `FOR SHARE` on the link. So "vehicle, then link" is
fixed for every canonical publish, unpublish or seller change (`POST /api/vehicles/:vin/publish`
included). Before R6, every suspension or withdrawal path took the link first and then updated
vehicles. That cycle is review cases T5 and T6.

Why **all** VINs, not only published ones (review 2 #3): a dealer transaction that publishes a
draft VIN holds that draft row **and** the link `FOR SHARE`. A published-only pre-lock skipped the
draft, reached the link, waited for the dealer — and the dealer's next (ascending) VIN was already
held by the suspension: 40P01, with the suspension as the victim. Locking every VIN of the tenant
in ascending order makes the suspension queue behind the dealer's first VIN instead.

Why **(tenant_id, vin)** across dealers (review 2 #4): the lapse sweep works tenant by tenant, so
the country-policy trigger, which locks several dealers' VINs in one statement, must use the same
order. A global ascending-VIN order interleaved tenants differently and deadlocked against the
sweep.

`FOR NO KEY UPDATE` is the same mode the withdrawal `UPDATE` takes anyway. It does not block
the `FOR KEY SHARE` locks that foreign-key checks take on a VIN (for example a branch
assignment). It is deliberately weaker than `FOR UPDATE`.

### Where it is enforced

- `dealer_lock_tenant_programme_vins(uuid)` (20261103141000, service_role only; renamed from
  `dealer_lock_tenant_public_listings` when it stopped being published-only) takes rule 3 for one
  tenant. `dealer_withdraw_tenant_public_listings` calls it before its `UPDATE`, so two
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
- The country-policy trigger takes rule 3 for every affected dealer in **one** statement ordered
  by `(tenant_id, vin)`, then locks the links in ascending `tenant_id` order.
- `dealer_prepare_canonical_listing` takes the VIN `FOR UPDATE` **before** the link
  `FOR SHARE`, the same way round as the guard.
- The inquiry guard takes only the link `FOR SHARE`; it reads the listed VIN's tenant without
  locking it, so it never conflicts with rule 3.
- The lapse sweep visits dealers in ascending `tenant_id`. For each one it takes rule 3 through the
  withdrawal function, and the withdrawal `UPDATE` then fires the canonical guard, which takes the
  link `FOR SHARE` (rule 4) — so the sweep does lock links, after the VINs, in rule order. Its
  `(tenant_id, vin)` order is the policy trigger's order.
- The activation carry-over trigger (20261103144000, `AFTER INSERT` on
  `dealer_approved_seed_links`) runs inside the governed activation, after the activation has
  locked the claim, policy (`FOR SHARE`), link and profile. It writes only the new dealer's
  `dealer_branches`, declaration and provenance rows; it never touches `vehicles`, and no listing
  write can reach that tenant through the guard before the link commits. It adds no edge to the
  order above.

### Rules for new code and for operations

1. Never lock `dealer_approved_seed_links` and then write a programme VIN in the same
   transaction. Lock the VIN first. **This includes the two inserts that take the link through a
   guard (review 3, #3 leftover):** an `INSERT` of a new programme VIN (the vehicle guard takes the
   link `FOR SHARE`) and an `INSERT` of an enquiry to a programme tenant or VIN (the enquiry guard
   takes the link `FOR SHARE`). In a multi-statement transaction such an insert must come **last**,
   after every write to an existing programme VIN — or lock those VINs first
   (`SELECT … WHERE tenant_id = … ORDER BY vin FOR NO KEY UPDATE`). Otherwise a concurrent
   suspension (lifecycle decision, claim revocation, tenant/profile/policy/membership write) can
   still deadlock with it: the suspension pre-locks the existing VINs, queues on the link behind the
   insert's `FOR SHARE`, and the dealer's next VIN write queues behind the suspension. PostgreSQL
   then aborts one of them with 40P01 — in practice the suspension, because it started waiting
   first and so runs the deadlock check first. This is **fail-safe**: nothing is half-applied, the
   dealer's transaction commits, and the backend retries the lifecycle RPC (section "Bounded
   retry"), whose next attempt withdraws the listing. The backend itself never builds such a
   transaction: every PostgREST insert or update is its own single-statement transaction. Behaviour
   was deliberately not changed: pre-locking every VIN of the tenant on each programme-VIN or
   enquiry insert would serialise all of a dealer's inserts behind each other for a fail-safe case.
2. If one transaction writes several programme VINs, write them in ascending VIN order (several
   dealers: ascending `(tenant_id, vin)`).
3. Suspend, withdraw or reinstate through `dealer_record_operating_lifecycle_decision`, not
   through a direct `UPDATE dealer_approved_seed_links`.
4. **Emergency containment** (the R5 review recipe), made deadlock-safe:
   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '3s';
   -- rule 3 for every active dealer: ALL their VINs, one statement, ascending (tenant_id, vin)
   SELECT 1 FROM vehicles v JOIN dealer_approved_seed_links l ON l.tenant_id = v.tenant_id
    WHERE l.operating_status = 'ACTIVE'
    ORDER BY v.tenant_id, v.vin FOR NO KEY UPDATE OF v;
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

Review 2 added, in block `R6 DBA review 2` (four synthetic dealers whose VIN order is the reverse
of their tenant order):

| Interleaving | First transaction | Second | Before review 2 | After |
|---|---|---|---|---|
| #3 | dealer publishes draft VIN …1, then edits published VIN …3 | lifecycle SUSPEND | 40P01 (suspension victim) | both commit; 0 public listings |
| #4 | lapse sweep (blocked mid-way on a held VIN) | country-policy SUSPENDED | 40P01 | sweep withdraws both dealers, 0 skipped; policy commits |
| #2 | a dealer transaction holds one lapsed dealer's VIN | lapse sweep | sweep waits for ever (cut by the 15 s harness guard) | that dealer skipped after 2 s and recorded; the other withdrawn; the next run withdraws the skipped one |

Mutants killed: published-only pre-lock (#3 → 40P01), global-VIN policy order (#4 → 40P01), no
per-tenant exception handler, no function `lock_timeout`, unordered sweep driver, cron command
without `statement_timeout` (#2).

Each pre-lock was mutation-checked by removing it. All 7 mutants failed with 40P01 (lifecycle
VIN pre-lock, lifecycle profile lock, preparation order, and the claim, tenant, membership and
policy triggers). Replacing `FOR NO KEY UPDATE` with `FOR UPDATE` passes, as expected: that only
adds blocking against FK `KEY SHARE`, it is not a correctness change. The R5 two-session publish-vs-suspend
interleavings and the R5 media-ticket single-use race are unchanged and still pass.

### deadlock_timeout and lock_timeout

PostgreSQL checks for a deadlock only after a lock wait reaches `deadlock_timeout` (default
**1 s**). Every bound used here is longer:

- 3 s for migrations: `SET LOCAL lock_timeout`, Up and Down.
- 2 s for each dealer the lapse sweep visits.

So a real cycle is always found and broken first: one victim gets 40P01 after about 1 s, and the
other transaction carries on. A plain long wait behind an idle or long transaction is cut at 2–3 s
with 55P03.

In the sweep, both outcomes skip only that dealer. Backend RPCs retry 40P01 after a 1–40 ms, then
1–80 ms jitter, at most 3 calls in total. A deadlocked attempt has already waited about
`deadlock_timeout` (1 s) before PostgreSQL broke the cycle, so one deadlock costs a caller about
1 s, and a caller that is the victim three times in a row gives up after about **3 s**
(3 × 1 s + ≤ 120 ms of jitter) with the original 40P01.

If a target database sets `deadlock_timeout` to 2 s or more, keep `lock_timeout` above it.
Otherwise a cycle is reported as 55P03, which is never retried, instead of 40P01. Check it with
`SHOW deadlock_timeout`.

### Isolation level (review 2 #7)

Every governance write needs READ COMMITTED, and refuses otherwise with a non-retryable P0001
error. Under REPEATABLE READ or SERIALIZABLE, its authority read could use a snapshot older than a
committed suspension. The writes covered:

- a listing write on a programme VIN: `DEALER_LISTING_WRITE_REQUIRES_READ_COMMITTED`
- any withdrawal, including a lifecycle decision, a suspension trigger or the sweep:
  `DEALER_LISTING_WITHDRAWAL_REQUIRES_READ_COMMITTED`
- an enquiry to a programme tenant or VIN: `DEALER_INQUIRY_REQUIRES_READ_COMMITTED`. This one was
  added in review 2 #6. Under REPEATABLE READ an enquiry used to be accepted after a suspension
  had committed. Native proof: refused under REPEATABLE READ, refused as not current under READ
  COMMITTED, and a non-programme enquiry under REPEATABLE READ is unaffected.

Consequences:
- An operator who opens `BEGIN ISOLATION LEVEL SERIALIZABLE` and then suspends a dealer, deletes
  an owner membership or changes a programme tenant gets that refusal. Use READ COMMITTED, the
  PostgreSQL and PostgREST default.
- 40001 only arises under REPEATABLE READ or SERIALIZABLE. Every governed path refuses those
  levels before it does any work, so the 40001 branch of the backend retry is effectively dead.
  It stays as a harmless defence; it never turns a refusal into a retry.

### Bounded retry (backend)

`backend/services/dealer/dealerTransientSqlRetry.js` → `rpcWithTransientRetry(db, fn, args)`

- Each `db.rpc` is one PostgREST transaction. When PostgreSQL returns **40P01** (deadlock
  victim) or **40001** (serialisation failure), the whole transaction has already been rolled
  back, so calling it again cannot apply anything twice.
- At most **3 calls in total**. The wait between calls is full jitter: up to 40 ms, then up to
  80 ms, capped at 250 ms. Each deadlocked attempt has itself waited about `deadlock_timeout`
  (1 s) before PostgreSQL chose it as the victim, so a persistent conflict comes back as the
  original 40P01 after about **3 s** (≈ 1 s × 3 calls + ≤ 120 ms of jitter).
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

The lifecycle decision **can still be the (retried) victim** in exactly one case: the rule-1
leftover above, where a dealer transaction inserts a programme VIN or an enquiry and only then
writes an existing VIN. Every interleaving proved in this section ends without a 40P01.

These RPCs are not wired, but could be:

- `dealer_record_independent_claim_review` (claim revocation) and
  `dealer_record_atomic_compliance_decision` (profile restriction). Both are whole-transaction
  RPCs on the suspension side. Like the lifecycle decision, they are no deadlock victim in the
  interleavings proved above, but can be in the rule-1 leftover case; there the caller sees a
  503 and may simply repeat the decision.
- The canonical publish route `backend/routes/vehiclesRoutes.js` is a single-statement
  `.update()`. It can no longer deadlock against a suspension.

---

## 2. Rollback custody (finding #6)

Every Down that would drop business or append-only rows now refuses, **before any DDL**, while
those rows exist. 21 of the 23 migrations do this. The other two hold no rows:
- 20261103124000 only drops a function.
- 20261103125000 is the privilege barrier described below.

| Migration | Refusal | Custody |
|---|---|---|
| 20261103120000 | `CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY` | imported research snapshots (source row hashes) |
| 20261103121000 | `CANNOT_ROLLBACK_WITH_DEALER_CLAIM_REQUESTS` | claim requests |
| 20261103121000 | `CANNOT_ROLLBACK_WITH_RESEARCH_PUBLICATION_LEDGER` | append-only publication events **or** public profiles |
| 20261103122000 | `CANNOT_ROLLBACK_WITH_RESEARCH_CORRECTION_REQUESTS` | third-party correction/takedown requests |
| 20261103123000 | `CANNOT_ROLLBACK_WITH_CLAIM_EVIDENCE_OR_INTAKE_CUSTODY` (review 2 #5) | private documentary evidence, intake drafts/receipts, review events or appeals — even on a never-reviewed (AWAITING) claim |
| 20261103132000 | `CANNOT_ROLLBACK_WITH_COUNTRY_POLICY_CUSTODY` (review 2 #5) | any country-policy row except the DRAFT row the migration seeds itself |

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
- After the full 23-migration rollback, `authenticated` holds **0** table-wide grants and
  **0** authority-column grants on `dealer_profiles`.
- 6 of 6 guard mutants are killed. One of them re-adds the `GRANT` to the 125000 Down.
- Review 2 #5 checks:
  - The 123000 refusal is proved in a rolled-back sandbox holding only an AWAITING claim with one
    evidence row, so the reviewed-claim refusal cannot be what fires.
  - The 132000 refusal fires while a decided policy exists. With only the re-seeded DRAFT row
    left, the full rollback then passes through it.
  - Both refusal mutants are killed.

**Full rollback is still impossible once any dealer is activated.** That is by design: fix
forward.

---

## 3. Migration locking (R5 finding #7; review 2 #1 and #9)

- **Every Up and every Down is bounded and transaction-scoped.**
  - `SET LOCAL lock_timeout = '3s';` follows `-- +migrate Up` in **20 of the 23** migrations:
    every one that locks a pre-existing table. The locks come from foreign keys to `users`,
    `tenants`, `vehicles`, `dealer_profiles`, `dealer_branches`, `organizations` or
    `marketplace_inquiries`, and from triggers, policies and `ALTER TABLE`.
  - 20261103120000, 122000 and 124000 create only new `dealer_*` objects and functions, so their
    Ups have no `SET`.
  - The same line is now the first statement of **all 23 Downs**. A Down takes ACCESS EXCLUSIVE
    on canonical tables (it drops FK triggers and policies). Before this change it could wait for
    ever behind a reader, and every later reader of `vehicles` queued behind it (review 2 #1).
- **Why `SET LOCAL`** (review 2 #9). Each migration runs in its own transaction: the runner below,
  the governed staging apply scripts and the harness's implicit multi-statement transaction. The
  bound therefore ends with the migration and never leaks into a later one or into the
  application session. The old session-scoped `SET` did leak.
- If a migration or rollback fails with **55P03**, its transaction was rolled back and nothing
  changed. Wait for the long transaction to finish, or stop it, then re-run.
- **One transaction per section is enforced, not assumed** (review 3 N2). `SET LOCAL` is a silent
  no-op outside a transaction block, so an autocommit apply (plain `psql -f`, which sends every
  statement as its own transaction) would have lost the 3 s bound and could stop half-way.
  Right after its `SET LOCAL lock_timeout` (at the top for the three Ups without one), every Up
  and every Down — all 46 sections — now runs
  `SET LOCAL carup.dealer_migration_txn = 'on'` and a guard `DO` block. If the marker is not set,
  the statements are not sharing one transaction: the guard raises a WARNING naming
  `DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION`, **ends its own session**
  (`pg_terminate_backend(pg_backend_pid())`, allowed for any role on its own backend) and then
  raises the same error. Ending the session matters: without `ON_ERROR_STOP`, psql would print
  the error and carry on with the next statement; with the session gone it stops (exit status 2).
  A dedicated marker is used instead of testing `lock_timeout = 0`, because a role- or
  database-level `lock_timeout` default would make that test pass in autocommit.
- **The only supported ways to apply a section** are the runner below, or
  `psql -1 -v ON_ERROR_STOP=1 -f <one section>` (each file holds an Up and a Down section; apply
  only the one you mean). The harness's multi-statement queries are also single implicit
  transactions.
- 20261103138000's two `CHECK` constraints stay validated inline, and the file says why:
  - They constrain only the columns added in the same migration, which are `NULL` on every
    existing row, so validation cannot fail.
  - `ADD COLUMN` already holds ACCESS EXCLUSIVE on `dealer_branches` until the migration
    transaction commits, so `NOT VALID` + `VALIDATE` in the same transaction would not shorten
    any lock.

**Proof (native PG17).**
- **Up:** a concurrent session holds `ROW EXCLUSIVE` on `dealer_profiles`, `dealer_branches` or
  `vehicles`. Starting from `lock_timeout = 0`, migrations 125000, 138000 and 141000 each fail with
  **55P03 after 3.0 s** and leave the catalog unchanged.
- **Down** (review 2 #1 reproduction): a reader holds `ACCESS SHARE` on `dealer_profiles`,
  `vehicles`, `tenants` or `users`. The Downs of 143000, 142000, 141000, 132000 and 121000 each give
  up with **55P03 after 3.0 s** and change nothing (same relation, trigger and function counts).
  An application `SELECT` that queued behind the Down's lock request finishes about **3 ms**
  after the Down gives up.
- **Leak check:** `SHOW lock_timeout` is still `0` after the initial apply and after the full
  reapply.
- **Static check:** every Up and Down has the expected `SET LOCAL`, and no file has a
  session-scoped `SET lock_timeout`.
- **Mutants:** removing the Down's `SET LOCAL` is caught, and so is turning an Up's `SET LOCAL`
  back into `SET` (the leak check fires).
- **One-transaction guard** (review 3 N2):
  - The harness checks statically that all 46 sections start with the guard, before any other
    statement.
  - On native PG17 it replays each section's opening statements the way an autocommit client
    does: 46/46 are refused, the session is ended, and a canary `CREATE TABLE` sent afterwards
    never runs. The same statements inside one transaction pass.
  - With psql 16 against PG17 (disposable cluster, 146000 Down):
    - plain `psql -f` and `psql -v ON_ERROR_STOP=1 -f` both stop at the guard with exit status 2
      and change nothing (71 functions, 85 triggers and 181 relations before and after);
    - `psql -1 -v ON_ERROR_STOP=1 -f` applies the Down and then the Up, and `lock_timeout` is `0`
      afterwards;
    - a non-superuser login role is also stopped.
  - Mutants killed: guard removed from a Down; the guard condition replaced; the guard made never
    to fire (caught at runtime: autocommit no longer refused); the `pg_terminate_backend` call
    made a no-op (caught at runtime: the canary ran).

**Apply runner for a staging-clone rehearsal**: `backend/scripts/dealership/applyDealerMigrations.mjs`.

```bash
node backend/scripts/dealership/applyDealerMigrations.mjs --url postgresql://postgres@127.0.0.1:<port>/<db> [--direction up|down] [--only <file>] [--dry-run]
# a NON-loopback clone (never a shared database) needs BOTH flags, typed exactly:
#   --allow-non-loopback --confirm-target=<host>:<port>/<database>
```

- It runs one transaction per migration (`BEGIN; <section>; COMMIT`, with `ROLLBACK` and a stop on
  the first error). Down runs newest to oldest.
- It refuses a transaction-pooler endpoint (port 6543 or a `pooler.` host).
- It reads the target only from `--url` or `DEALER_MIGRATION_DATABASE_URL`, never from
  `DATABASE_URL`.
- It refuses every non-loopback host unless both the flag and the exact confirmation are given.
- **It approves the server node-pg will really reach** (review 3 N1). node-pg honours `?host=`,
  `?port=`, `?options=`, `?user=` and `?dbname=` in a connection string. The first runner checked
  only the WHATWG view of the URL, so
  `postgresql://postgres@127.0.0.1:55492/postgres?host=…pooler.supabase.com&port=6543` was
  approved as loopback. Now:
  - every query parameter except `sslmode` is refused (`CONNECTION_QUERY_PARAMETER_REFUSED`);
  - the target is computed with node-pg's own parser (`pg/lib/connection-parameters`, i.e.
    `pg-connection-string`), and must equal the WHATWG view (`TARGET_PARSE_MISMATCH`, for example
    a percent-encoded `%6c%6fcalhost` that node-pg would decode to `localhost`);
  - the port and database must be written in the URL, so `PGPORT` / `PGDATABASE` can never choose
    the target;
  - after connecting and **before any migration statement**, `current_database()`,
    `inet_server_port()` and — for a loopback target — a loopback `inet_server_addr()` must match
    the approved target (`CONNECTED_SERVER_MISMATCH`, then the connection is closed). A tunnel, a
    pooler, a Unix socket or a redirected session is refused even if the URL looked right.
- Tested by `backend/tests/dealer-migration-runner.test.js`: 12 tests, including the four
  reviewer bypass URLs and an injected client that reports a remote server. All 9 runner mutants
  are killed. It was also run against native PG17 (all 23 migrations, Down then Up, one
  transaction each, the server identity verified as `127.0.0.1:55483`). The bypass URLs and a URL
  without a port are refused before connecting.

## 4. Scheduled job `carup-dealer-listing-lapse-sweep` (finding #8)

**What it does.**
- 20261103141000 runs
  `cron.schedule('carup-dealer-listing-lapse-sweep', '*/10 * * * *', 'SELECT public.dealer_withdraw_lapsed_listing_authority(''pg_cron'')')`,
  but **only where the `pg_cron` extension is installed**. Applying 141000 to such a database
  starts the job at once.
- The job withdraws (never deletes) the public listings of programme dealers whose authority
  lapsed purely by time: legal approval, country policy or profile expiry.
- It finds those dealers with an index nested loop over `dealer_approved_seed_links`. With 100
  dealers it takes **0.33 ms**; see section 5.
- **It is bounded** (review 2 #2). The command is
  `SET statement_timeout = '300s'; SELECT public.dealer_withdraw_lapsed_listing_authority('pg_cron')`.
  - The function runs with `SET lock_timeout = '2s'`.
  - It visits each dealer in ascending `tenant_id`, inside its own subtransaction.
  - If that dealer's VINs cannot be locked within 2 s, or it is chosen as a deadlock victim, the
    sweep rolls back to the subtransaction and skips **that dealer only**. The skip is recorded
    as an append-only `LAPSE_SWEEP_TENANT_SKIPPED` event (`LOCK_NOT_AVAILABLE` or
    `DEADLOCK_DETECTED`), and the result reports `tenants_skipped`.
  - The next run, 10 minutes later, retries the skipped dealer. Meanwhile the guard still
    refuses any new publication for it.
  - Worst case: about 104 dealers × 2 s ≈ 208 s, which is under the 300 s statement bound and
    half the cadence. A run cancelled by the statement bound withdraws nothing.
  - Before this change, one idle dealer transaction stalled the whole sweep for every dealer.

**Idempotent and safe to overlap.**
- A second run straight after the first finds nothing and returns
  `{"tenants_withdrawn":0,"listings_withdrawn":0,"tenants_skipped":0}`.
- pg_cron never runs two instances of the same job at once. A run that is due while the
  previous one is still going is queued.
- The sweep never republishes anything. It locks each dealer's VINs through the withdrawal
  function, in the `(tenant_id, vin)` order that the policy trigger and the lifecycle decision also
  use; the withdrawal `UPDATE` then fires the canonical guard, which takes that dealer's link
  `FOR SHARE` — after the VINs, i.e. in rule order.
- **Lock hold (review 3 N4, accepted residual).** The whole run is one transaction, so every
  withdrawn dealer's VIN locks and link `FOR SHARE` are held until the run commits. A dealer write,
  lifecycle decision or policy change on an already-withdrawn dealer waits for the rest of that
  run.
  - A normal run takes milliseconds (0.33 ms with 100 dealers, section 5).
  - The hold grows only with dealers skipped later in the same run: at most 2 s each.
  - The hard bound is the command's 300 s `statement_timeout`.
  - A waiting writer is itself bounded by its own `lock_timeout` or, for backend RPCs, by the
    retry policy.
  - Not converted to a procedure that commits per dealer:
    - a `SET` clause (the function's `lock_timeout = '2s'`) forbids transaction control in a
      procedure;
    - the cron command is a multi-statement string (`SET statement_timeout …; …`), and an
      implicit transaction block forbids `COMMIT` inside `CALL`;
    - pg_cron is not in the disposable PG17 binaries, so per-dealer commits under pg_cron could not
      be proved here.
  - Revisit if the programme grows far beyond the 104-dealer research universe.
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
SELECT created_at, tenant_id, reason_code FROM dealer_listing_authority_events
 WHERE event_type = 'LAPSE_SWEEP_TENANT_SKIPPED'
 ORDER BY created_at DESC LIMIT 20;                         -- alert if one tenant repeats run after run
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
- Restart: run the same `cron.schedule(...)` call as 141000, with the statement-bounded command
  above.
- 141000's Down unschedules the job, but only after its custody check passes. That unschedule
  swallows errors so a role without pg_cron access can still roll back.

---

## 5. Trigger cost on non-programme rows (finding #2)

**Fixture** (`database/test/dealer_r6_trigger_cost_fixture.sql`). All rows are synthetic,
loaded after the 22 migrations (`DEALER_NATIVE_SCHEMA_ONLY=1`):

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
| S1 | `UPDATE vehicles SET publication_status` | 50,000 | 894 ms | 359 ms | 500 ms | **10.0 µs** |
| S2 | `INSERT INTO vehicles` | 20,000 | 306 ms | 104 ms | 190 ms | **9.5 µs** |
| S3 | single-VIN publish | 1 | 0.07 ms | 0.03 ms | 0.017 ms | 17 µs |
| S4 | `UPDATE vehicles SET price` (column not watched) | 50,000 | 353 ms | 360 ms | **0 (not fired)** | 0 |
| S5 | `UPDATE tenants SET status` | 5,000 | 44 ms | 9.8 ms | 34 ms | 6.7 µs |
| S6 | `UPDATE tenant_users SET role` | 5,000 | 59 ms | 22 ms | 35 ms | 7.0 µs |
| S7 | `INSERT INTO marketplace_inquiries` | 5,000 | 122 ms | 18 ms | 99 ms | 19.7 µs |
| S8 | `UPDATE dealer_profiles` risk column (2 triggers) | 1,000 | 17 ms | 2.8 ms | 13 ms | 13.4 µs |

These are the review 2 figures, from a fresh run at the review-2 head. S7 went up from 12.0 to
19.7 µs per row because the hardened enquiry guard (8076a29b) now makes up to two point lookups:

- the `seller_tenant_id`, parsed as a uuid;
- the listed VIN's own tenant, read by primary key.

It also checks the isolation level. The S5, S6 and S8 statements really change their rows, so the
review 2 #10 `WHEN` clauses do not skip them. A no-op `SET x = x` now fires none of the four
withdrawal triggers.

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
- **R6 VIN pre-lock** for a programme tenant (all VINs): `LockRows → Sort (vin) → Index Scan
  idx_vehicles_tenant`, 0.009 ms.

The text-cast residual reported in round 1 is **closed**. The enquiry guard now parses
`seller_tenant_id` as a uuid in any case, compares it natively and also guards the listed VIN's
tenant (8076a29b).

**Foreign keys to `users` (review 2 #11, information only).**
- The dealership tables declare **39** single-column foreign keys to `users(id)`. **36** of them
  are `ON DELETE RESTRICT` and the rest are `NO ACTION`.
- **35** have no index led by the referencing column. Deleting a `users` row therefore runs up to
  35 sequential scans of dealership tables in its RI checks.
- No index was added, deliberately:
  - The tables are small. Most are append-only ledgers sized by dealers × decisions, with at
    most a few thousand rows each.
  - Hard user deletion is rare.
  - An index on every actor column would add write and WAL cost to every ledger insert, just to
    speed up an operation that RESTRICT is designed to refuse.
- Revisit this if hard user deletion becomes routine. List the unindexed keys with:
  ```sql
  SELECT c.conrelid::regclass, a.attname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.conrelid::regclass::text LIKE 'dealer_%'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
  ```

---

## 7. Activation carry-over bounds (review 2 #8)

The carry-over trigger (20261103144000) used to turn every key of every submitted tab into a
provenance row. The review measured 219,000 rows and 12.9 s for 40 hostile tabs, run while the
activation held its locks. It is now bounded by the intake contract:

- **What is processed.** `dealer_intake_contract_fields()` holds the 11 contract tabs and 111
  fields; the harness pins it to `TEMPLATE_FIELD_REGISTRY`. Only those tabs and fields are noted
  cell by cell, and at most 250 rows per tab.
- **Non-contract tabs are bounded too** (review 3, #8 leftover). One note per non-contract tab
  had no limit: the review measured 50,000 hostile tabs → 50,002 rows in 8.9 s. Now:
  - only the first **25** (in key order) get a note each, named `UNRECOGNISED_TAB_<10-letter hash>`
    (names never collapse, so no note is lost to `ON CONFLICT`);
  - every further one is only counted, in **one** `UNRECOGNISED_TABS` summary note ("N further
    tab(s) …").
- **One note, never one per cell**, for each of:
  - a tab that is not a row list;
  - rows beyond 250;
  - a non-object row;
  - the count of non-contract keys in a tab.
- **Oversized values.** A value over 4 bytes × its field limit is refused by its byte size before
  any regex runs. This bound only changes cost, never the outcome: a 30 MB value takes 61 ms
  instead of 333 ms. That is why its mutant survives.
- **Cap.** Every section-4 note — tab, row, field and cell notes alike — counts toward a cap of
  **25,000** per activation, with one summary note if the cap is reached. The contract alone keeps
  the worst case below it: 26 tab notes plus, for each contract tab, 250 rows × its
  non-structural fields plus 2 tab-level notes, which is **23,048**. The cap is therefore a
  backstop that cannot be reached; the harness asserts that worst case from the registry.
- **No legitimate activation fails or is truncated.** Nothing raises, and nothing legitimate is
  skipped.

| Submission (sandboxed, rolled back) | Provenance rows | Time |
|---|---|---|
| hostile: 40 extra tabs × 250 rows × 20 keys, 3 invalid tab names, a 5 MB value, non-object rows, 260 branch rows | **281** (was about 219,000; 298 in review 2) | 0.18–0.31 s (was about 12.9 s) |
| 50,000 non-contract tabs (review 3) | **27**: 25 listed, 1 summary, 1 branch (was 50,002) | 27 ms native / 50 ms PGlite (was 8.9 s) |
| over-full: every contract tab, BUSINESS too, with 250 rows (the submission function would refuse 250 BUSINESS rows), plus 43 non-contract tabs | 18,172 section-4 rows, within the 23,048 worst case, uncapped | 2.5 s native / 3.7 s PGlite |
| maximal legitimate: every contract tab with 250 rows and every field filled | 19,265, uncapped | 2.2 s native / 3.2 s PGlite |

The `DEALER_R6_C02_CARRYOVER` block is unchanged and still passes: 3 of 5 branches, 5 sections.

---

## 8. Review 2 finding map

| # | Disposition |
|---|---|
| 1 | `SET LOCAL lock_timeout` first in all 23 Downs; native Down probes (section 3) |
| 2 | per-tenant subtransaction sweep, 2 s, skip events, 300 s cron bound (section 4) |
| 3 | pre-lock ALL VINs (section 1) |
| 4 | one `(tenant_id, vin)` order for sweep and policy trigger (section 1) |
| 5 | 123000 / 132000 custody refusals (section 2) |
| 6 | enquiry guard READ COMMITTED check (section 1, isolation) |
| 7 | isolation behaviour and the dead 40001 branch documented (section 1) |
| 8 | carry-over bounded by the intake contract (section 7) |
| 9 | `SET LOCAL` in Ups; apply runner (section 3) |
| 10 | `WHEN` clauses on the profile, membership (UPDATE + DELETE split), tenant and policy triggers |
| 11 | documented, not indexed (section 5, foreign keys) |
| 12 | this document |

## 9. Review 3 (closure re-verification of 4476e2c8)

| Item | Disposition |
|---|---|
| N1 (Medium) runner target bypass via `?host=` / `?port=` | **Fixed.** node-pg's own parser; only `sslmode` allowed; explicit port and database; post-connect identity check (section 3) |
| N2 (Low) `SET LOCAL` silently ineffective in autocommit | **Fixed.** Marker + guard in all 46 Up/Down sections; autocommit apply ends the session; `psql -1 -v ON_ERROR_STOP=1` or the runner (section 3) |
| #8 leftover (Low) one note per non-contract tab | **Fixed.** First 25 listed, the rest counted in one summary note; every section-4 note counts toward the 25,000 cap; 50,000 tabs → 27 rows in 27–50 ms (section 7) |
| #3 leftover (Low, fail-safe) programme-VIN or enquiry insert before a VIN write | **Documented** in rule 1 (insert last, or pre-lock); behaviour unchanged by design |
| N4 (Low) sweep holds withdrawn dealers' locks to the end of the run | **Accepted residual**, bounded and documented (section 4) |
| #12 doc drift | **Fixed** in this revision: 23 migrations; the sweep takes links `FOR SHARE` through the guard; retry give-up ≈ 3 s; the lifecycle decision can be a retried victim in the rule-1 case; runner claims; apply procedure |

## 10. Verification commands

```bash
# migrations: ONLY the runner, or psql in ONE transaction per section with ON_ERROR_STOP
node backend/scripts/dealership/applyDealerMigrations.mjs --url postgresql://postgres@127.0.0.1:<port>/<db> [--direction down]
psql -1 -v ON_ERROR_STOP=1 -f <file containing only the Up (or only the Down) section>
# PGlite (single session)
PATH=/opt/homebrew/bin:$PATH node database/test/dealer_1_0_pglite_check.mjs
# native PG17 (disposable): lock-order races, lock_timeout probes, apply/rollback/reapply
DEALER_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:<port>/carup_dealer_isolated_ci \
  node database/test/dealer_1_0_pglite_check.mjs
# backend (node 22, ci.yml env)
cd backend && NODE_ENV=test … node --test tests/dealer-*.test.js tests/*migration*.test.js
```
