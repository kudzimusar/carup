# Email 1.0 hardening migration — runbook

`database/migrations/20260826120000_email_1_0_hardening.sql`
**SHA-256 `ce739d9f78ef5166a7cb6314aac6ed591e7498bdba564c06d11436769cb4257e`**
(supersedes `1a741759…`, `0e74b1c1…` and `c66cfb71…`)

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


## Baseline by construction — the root correction

The earlier design INFERRED outstanding work from timestamps and produced four defects from that one
choice: a routine Trust recompute made a historical vehicle eligible; the LIMIT bounded inferred
candidates so a settled prefix starved real work; a non-actionable row held the queue forever; and the
watermark table itself was a client-writable security surface.

Inference is gone. Two explicit flags, set by DATABASE TRIGGER in the same transaction as the change
that created the work:

| flag | set when | never set by |
|---|---|---|
| `users.email_welcome_reconcile_required` | `email_verified_at` transitions NULL → NOT NULL | any other update to the row |
| `vehicles.trust_presentation_reconcile_required` | a MATERIAL trust column changes (`IS DISTINCT FROM`) | `trust_evaluated_at`, `vin` |

Both are `NOT NULL DEFAULT false` and **nothing backfills them**, so history is baseline *by
construction* rather than by a comparison a later write can invalidate. The scans select
`WHERE flag = TRUE` and apply the LIMIT to rows that are already pending, so no JavaScript
post-filter can let a settled row occupy the batch.

`communication_activation_boundaries` was **removed rather than secured** — with explicit flags it
participates in no correctness rule, and unnecessary authority is worth less than deleted authority.
It had never been applied anywhere.

### Grants

Column-level `REVOKE UPDATE` on both flags from `PUBLIC, anon, authenticated`, plus `REVOKE ALL ON
FUNCTION` for all three trigger functions — `CREATE FUNCTION` grants EXECUTE to PUBLIC by default,
and this repo's `db-anon-grant-posture` gate correctly refuses a migration that omits it.

### Measured on live staging, before any apply

| | count |
|---|---|
| verified accounts | **76** → all default FALSE → **0 pending** |
| Trust positions | **38** → all default FALSE → **0 pending** |
| obsolete boundary table present | **0** (never applied anywhere) |

Zero recovery work is created by the apply itself. Re-measure immediately before the real apply.

