# Email 1.0 hardening migration — runbook

`database/migrations/20260826120000_email_1_0_hardening.sql`
**SHA-256 `bf8c1cbfbec807cc2839720416521e584964457c1264bfd9ae9fa20d4ff680e0`**
(supersedes `031f6116…`, `ce739d9f…`, `1a741759…`, `0e74b1c1…`, `c66cfb71…`)

Transactional. Six changes, all additive or provably redundant. **NOT APPLIED.**

| # | Change | Why |
|---|---|---|
| G5-D1 | `email_reply_tokens.version` DEFAULT 1 → 2 | configuration drift; **no backfill** — a v1 row is a credential still in an inbox |
| G5-D3 | DROP `idx_email_reply_tokens_hash` | the UNIQUE constraint already provides an identical btree on the same column |
| R5-D1 | ADD `vehicles.trust_presentation_announced_fingerprint` + partial index | the durable announcement marker |
| **C3-A** | extend `communication_domain_event_dedupe_key()` for `vehicle.trust.presentation_changed` | database idempotency for the Trust announcement |
| **R1** | same function, branch for `user.email.verified` | one welcome work item per verified account |
| **BOUNDARY** | `communication_activation_boundaries` + row for `email_1_0`; index refinements | **new** — the durable watermark that prevents a retroactive mass send |

## Preflight — PASS (live, read-only, re-run after the C3 revision)

| Check | Value | Meaning |
|---|---|---|
| `vehicle.trust.presentation_changed` rows | **0** | no Trust event has ever been emitted |
| ...with a dedupe_key | **0** | nothing to conflict with |
| duplicate fingerprints among them | **0** | the new unique key cannot collide on apply |
| rows that would collide on apply | **0** | apply is safe |
| `vehicles.trust_presentation_announced_fingerprint` | **absent** | ADD COLUMN required |
| live v1 reply tokens | **0** | no delivered credential is at risk |
| `email_reply_tokens.version` default | **`1`** | ALTER required |
| `idx_email_reply_tokens_hash` | **present** | DROP applicable |
| `user.email.verified` rows | **0** | the R1 work item has never been emitted |
| ...with a dedupe_key / conflicting keys | **0 / 0** | the new unique key cannot collide on apply |
| `marketplace.inquiry.created` dedupe keys | **20** | postflight baseline — must be unchanged |

The trigger is `BEFORE INSERT`, so it touches **new rows only**. No backfill, no rewrite of history.

## Apply

Single transactional package via the governed migration path. No `CONCURRENTLY` (it cannot run
inside a transaction block, and an all-or-nothing apply is worth more than avoiding a brief lock on
a single-digit-row table).

## Postflight — assert after apply

1. `version` default is `2`; existing v1 rows still `version = 1` and still resolvable.
2. `idx_email_reply_tokens_hash` gone; `email_reply_tokens_token_hash_key` **still present**.
3. `vehicles.trust_presentation_announced_fingerprint` exists; `idx_vehicles_trust_unannounced` exists.
4. `communication_domain_event_dedupe_key()` has **all three** branches; the marketplace branch is
   byte-identical to `20260811132100`.
5. `marketplace.inquiry.created` dedupe keys still **20** — the change must not have touched them.
6. Insert two `vehicle.trust.presentation_changed` rows with the same `presentation_fingerprint`,
   and two `user.email.verified` rows with the same `recipientUserId`: each second insert must
   raise `23505` on `idx_domain_events_dedupe_key`. Then roll both back.

## Rollback

Forward-only in effect, and safe to leave applied:

- The `version` DEFAULT only affects future implicit inserts.
- The dropped index is provably redundant; recreating it is a one-line `CREATE INDEX`.
- The added column is nullable with no default — invisible to every existing reader.
- The dedupe function is `CREATE OR REPLACE`; the previous body is recoverable verbatim from
  `20260811132100_communications_2_reliability_closure.sql`.

The only irreversible-in-practice element is a dedupe key written onto a new row, which is exactly
the behaviour being bought.

## Deploy ORDER matters

Apply the migration **before** deploying the application. The producer now refuses to emit when the
marker is unreadable (`announcement_state_unavailable`), so an app-before-migration window defers
announcements rather than duplicating them — but applying first avoids the deferral entirely.


## The private reconciliation work queue — the final root correction

Three designs preceded this section. Timestamp inference made a routine recompute look like news and
let a settled prefix starve the batch. Public-table boolean flags failed on privilege reality —
PostgreSQL privileges are additive, and staging grants anon/authenticated **table-level UPDATE on
`public.users`**, so a column-level revoke there was inert; their unconditional clear also wiped work
declared mid-flight. Both mechanisms are gone (never applied anywhere).

Reconciliation work now lives in **`communication_reconciliation_work`**:

| column | meaning |
|---|---|
| `work_type` | `user_email_verified` \| `vehicle_trust_presentation` |
| `subject_id` | user id / vin |
| `generation` | monotonic per row; a material change UPSERTS generation+1 |
| `work_fingerprint` | sha256 over the material trust columns (R5; NULL for R1) — an optimistic-concurrency token, NOT the announcement identity |
| `UNIQUE (work_type, subject_id)` | one current logical work item per subject |

**Enqueued by database triggers in the same transaction as the state change**:
`trg_users_enqueue_welcome_reconciliation` fires only on the `email_verified_at` NULL → NOT NULL
transition; `trg_vehicles_enqueue_trust_reconciliation` fires only when a material trust column moves
(`IS DISTINCT FROM`; `trust_evaluated_at` and `vin` excluded). Both functions are SECURITY DEFINER
with EXECUTE revoked. **No backfill**, so history creates zero rows — baseline by construction.

**Service-only, proven against real PostgreSQL** (`database/test/email_reconciliation_privilege_check.mjs`,
run on every backend test pass): RLS enabled **and forced**, `REVOKE ALL` from PUBLIC/anon/authenticated
— asserted with `SET ROLE` denials and `has_table_privilege()` after emulating Supabase's default
privileges, not from migration text. `service_role` retains full access, so the worker still works.

**Retirement is an atomic conditional delete** on `(id, generation, work_fingerprint)`. Zero affected
rows means a newer generation landed mid-reconciliation and survives for the next pass — the fix for
the lost-update race, proven by an interleaving test that fails under an unconditional clear.

### Measured on live staging, before any apply

| | count |
|---|---|
| verified accounts | **76** → triggers fire only post-migration → **0 work rows** |
| Trust positions | **38** → same → **0 work rows** |
| `communication_reconciliation_work` present | **0** (never applied anywhere) |
| `public.users` RLS | enabled, **0 policies** (see `docs/security/PREEXISTING_USERS_TABLE_WRITE_PRIVILEGE.md`) |

Zero recovery work is created by the apply itself. Re-measure immediately before the real apply.

