# ⚠️ OUTSTANDING STAGING CHANGE — three cron jobs are PAUSED

**Paused 2026-09-08 during the staging capacity incident. They must be re-enabled.**

## What was done, and why

The staging instance was CPU-quota throttled (14× degradation). PostgREST could not complete its
startup queries inside the `authenticator` role's 8s `statement_timeout`, so it retried every ~60s
forever and every REST call failed.

Three pg_cron jobs run **every minute** on staging and all three were failing with
`job startup timeout` — consuming the CPU allowance while accomplishing nothing. They were paused
with the owner's explicit approval so the allowance could replenish.

**Only `active` was changed.** The schedules and command bodies were not touched, proved by md5:

| jobid | name | schedule | command md5 | length |
|---|---|---|---|---|
| 1 | `carup-communication-worker-every-minute` | `* * * * *` | `887e40ad5d9f39ccb57e3e89c6dff3ce` | 646 |
| 2 | `carup-events-outbox-every-minute` | `* * * * *` | `61bb80b36147effc7136cfead39562cf` | 698 |
| 8 | `issue164-reservation-expiry-reconcile` | `* * * * *` | `5bae97ff65296935f5ce55569aa6a782` | 56 |

`cron.alter_job` was used rather than `cron.unschedule` precisely so the definitions survive —
`unschedule` deletes the job.

## How to restore

Against **carup-staging** (`eoyenigwevnxwwhyhaer`) — never production:

```sql
select cron.alter_job(job_id := 1, active := true);
select cron.alter_job(job_id := 2, active := true);
select cron.alter_job(job_id := 8, active := true);
```

Then verify — the md5 and schedule columns must still match the table above:

```sql
select jobid, jobname, schedule, active, md5(command) as command_md5, length(command) as command_len
from cron.job order by jobid;
```

A restore that changes any md5 is not a restore. Stop and investigate.

## When to restore

As soon as `node scripts/ci/assert-staging-capacity.mjs` reports healthy. Do not leave staging
running without its outbox drain any longer than the recovery needs: a communications outbox that
nothing drains looks identical to a communications system that is working and has nothing to send.

Related: this programme has already had one incident caused by a mis-set cron
(`misrouted-production-comms-cron`). Both of these jobs are the STAGING equivalents. Do not repoint
them; only flip `active`.
