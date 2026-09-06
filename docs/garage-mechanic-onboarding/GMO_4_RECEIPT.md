# GMO-4 — Canonical Business Activation · RECEIPT

**Status: PASS, with one gap stated below.** A garage workspace can now come into existence.

Before this phase, **nothing in the product created a tenant or a membership** — verified by
grepping every non-test path. Every garage that existed was a SQL fixture. GMO-4 is the first
product path that makes one.

## Where the safety lives, and why it lives there

All of it is in the `activate_garage_application` PostgreSQL function, because the guarantees
required are transactional and the Supabase client cannot express a transaction.

| guarantee | how |
|---|---|
| **atomic** | tenant + founding membership + the application's claim commit together or not at all |
| **serialized** | `FOR UPDATE` on the application row; a concurrent activation queues behind it |
| **idempotent** | an already-activated application returns its existing tenant, `created=false` |
| **derived** | every value comes from the approved row; the caller passes an application id |

The consequence worth stating plainly: **there is no parameter by which any caller can choose the
tenant, the founder or the role.** A browser cannot pass a tenant id because no such argument
exists; cannot nominate a founder because the founder is read from `applicant_user_id` inside the
transaction; cannot pick a role because `'admin'` is a literal in the function body. That is
stronger than validating input, and it is why the logic sits in the database rather than above it.

## PO-1, honoured exactly

The founding role is the **tenant-scoped `admin`**. The person's platform role is untouched — the
function cannot write `users` at all, proven by reading the *deployed* function definition back out
of PostgreSQL. A garage operator is a platform `owner` who is `admin` inside one tenant: precisely
the shape the seven authorization layers already expect, and precisely what #197's certified Garage
role acceptance assumes.

## PO-6, confirmed with no architectural conflict

`tenant_users` is `UNIQUE (tenant_id, user_id)` — **not** unique on `user_id`. A person may belong
to many garages, so there is no canonical constraint to report as a conflict. Proven live: the same
person founded a second garage and both memberships coexist independently.

## Real PostgreSQL — 25 checks, all PASS

**Refusals (15):** a submitted, draft or rejected application cannot activate; a nonexistent one
cannot; a blank trading name cannot become a tenant name; a failed activation leaves no orphan
tenant. **The happy path:** tenant is `type=garage`, active, named from the approved application;
the founder is the **applicant, not the reviewer who ran activation**; the founding role is `admin`;
the platform role is unchanged. **Idempotency:** a second call returns the same tenant, the same
membership and the same role with `created=false`, and exactly one tenant and one membership
remain.

**Atomicity by fault injection (7).** A trigger was installed to make the founding-membership insert
fail *after* the tenant row had been created — the interleaving that would otherwise leave a garage
nobody can reach. Result: the tenant was rolled back, no orphan membership survived, and the
application **stayed `approved`, unactivated**. That is the Part 10 gate *"failed activation becomes
'approved and activated'"*, closed by demonstration rather than by argument.

**Read back from the deployed function (3),** not from the source file: the row lock is present, the
claim is guarded, and `users` is unreachable.

**The updated return shape (3):** `founding_role` is returned so the audit records what the database
actually wrote.

## Belt and braces on the race

The claim is guarded on `activated_tenant_id IS NULL` and a claim that wins no rows **aborts the
transaction**, rolling back the tenant and membership. The function is therefore correct *even if
the lock were removed*: a loser rolls back completely rather than leaving an orphan. A guarantee
that rests only on a lock is a guarantee that rests on timing.

## ~~GAP~~ — CLOSED 2026-09-06: true concurrent-session racing EXECUTED

Eight genuinely concurrent activations, fired together at the deployed governed endpoint. Each POST
is its own serverless invocation and therefore its own database session, so this is a real race and
not a simulation of one.

```
8 calls in 3694ms · ok 8 · created=true 1 · created=false 7 · other 0
  ✅ all winners report exactly ONE tenant      distinct tenant_ids = 1
  ✅ exactly ONE caller created it              created=true = 1
  ✅ every call was answered                    8/8
  ✅ no non-2xx call reported a tenant          0 non-2xx
```

Database readback afterwards, 5/5: the application names exactly the tenant every racer reported;
**exactly one tenant exists**; exactly one founding membership; its role is the tenant-scoped
`admin` (PO-1); and the fixture was cleaned up.

Seven losers all returned `created=false` with the winner's tenant — the idempotent path — rather
than erroring. No loser left an orphan.

The approved application was created directly and is **labelled a concurrency fixture**: what is
under test is whether the activation function serializes, not whether onboarding produced the row.
The Golden Journey creates its applications through the product and does not use this.

Harness: `scripts/uat/gmo-4-activation-race.mjs`.

### The original gap, kept for the record


I could not run two genuinely simultaneous database sessions. `dblink` is not installed and
installing it needs a loopback credential; `postgres_fdw` likewise; no staging credentials exist in
this worktree for a two-connection Node harness; and scheduling `pg_cron` to manufacture overlap is
both unreliable for this purpose and a hazard this project has been burned by before.

**What that means honestly:** serialization is established by (a) the row lock being present in the
deployed function, (b) the guarded claim making a lost race roll back regardless of lock behaviour,
and (c) the idempotent path being proven. It is **not** established by observing two transactions
collide. To close it properly: run two concurrent `POST /rest/v1/rpc/activate_garage_application`
calls against staging with a real service-role key and assert exactly one tenant results.

I am recording this rather than describing the 25 sequential checks as a race test.

## Decisions worth recording

- **Approve and activate are separate calls.** If activation fails the reviewer's decision still
  stands and `POST .../activate` retries it idempotently. A transient database problem must not cost
  a judgment someone already made, and must not force them to make it again.
- **A no-op retry writes no audit line and emits no event.** A log recording the garage being built
  three times is a log that cannot be read.
- **An unconfirmable activation is never reported as success.** Empty, null and tenant-less results
  all raise *"could not be confirmed. Nothing was changed"*. Telling someone they have a workspace
  they cannot open is the worst available outcome.
- **The founding role is read back, not asserted.** An audit line claiming `admin` while the function
  wrote something else would be a lie in the one record meant to settle disputes.

## Evidence

| gate | result |
|---|---|
| `gmo-4-garage-activation.test.js` | **19 / 19** |
| `garageApplications.test.tsx` (incl. activation UI) | **21 / 21** |
| GMO 1–4 + mounting + migrations + boundaries | **127 / 127** |
| Service Network parent regression | **286 / 286** |
| real PostgreSQL | **25 / 25** |
| typecheck | clean |

## Mutation gates — 11 of 11 red, all reverted

| # | mutation | result |
|---|---|---|
| 1 | let a caller pass a tenant id through | **red** (2) |
| 2 | report an unconfirmable activation as success | **red** |
| 3 | a failed activation still reports a tenant | **red** |
| 4 | audit a no-op retry as a real build | **red** |
| 5 | hardcode the founding role in the audit | **red** |
| 6 | drop step-up from the activate route | **red** |
| 7 | remove the row lock | **red** *(see below)* |
| 8 | remove the guarded claim | **red** |
| 9 | activation writes the platform role | **red** |
| 10 | remove the ALREADY_ACTIVATED abort | **red** |
| 11 | founding role becomes `super_admin` | **red** |

**#7 initially stayed GREEN, and that was a real hole.** The migration explains its own guarantees
in prose at the top, so my `/FOR UPDATE/` assertion was matching the *comment describing the lock*
rather than the lock — and survived the lock being deleted. Fixed by stripping SQL comments before
asserting, and by matching the whole statement rather than a phrase. This is the same failure class
as the X4 biometric false positive: a check that could not see what it claimed to see.

A related catch: the GMO-3 route test pinned the step-up count at exactly 2, so adding the activate
route turned it red. Rather than bump the number, the assertion now names each sensitive route and
requires role + capability + step-up on each — so a future route added without step-up fails here
instead of quietly moving a count.
