# CarUp Referral Engine — UAT journey runner

`referral-uat-journeys.mjs` is an executable, dependency-free Node ESM script that drives the
**deployed staging API over HTTP** through 10 end-to-end UAT journeys (auth boundaries, the
local-marketplace and import referral chains, the correct-wallet attribution proof, the
marketing state machine, trust holds/disputes/audit, channel inbound attribution, and the safe
AI agent gateway).

**Nothing in this directory contains a secret, password, URL, or key.** Every credential and
the API base URL are read from environment variables at runtime. The script never prints a
password and redacts session tokens from its output.

---

## 1. Required environment variables (names only)

| Variable | Purpose |
| --- | --- |
| `STAGING_API_BASE_URL` | Base URL of the **staging** API (e.g. the host serving `/api/...`). No trailing slash needed. |
| `UAT_ADMIN_EMAIL` | Email of the seeded staging UAT **admin** account. |
| `UAT_ADMIN_PASSWORD` | Password of the seeded staging UAT **admin** account. |
| `UAT_OWNER_EMAIL` | Email of the seeded staging UAT **owner** account. |
| `UAT_OWNER_PASSWORD` | Password of the seeded staging UAT **owner** account. |

Optional (recommended) — strengthens the staging-only guard:

| Variable | Purpose |
| --- | --- |
| `STAGING_SUPABASE_URL` (or `SUPABASE_URL`) | The staging Supabase URL. If set, its project ref must equal the approved staging ref or the runner aborts. |

If any **required** variable is missing or blank, the runner prints exactly which variable(s)
are missing and exits with code `1` — before making any network call.

---

## 2. Create `backend/.env.uat.local` (git-ignored)

`.env*` files are already ignored by the repo `.gitignore` (`.env.*`), so this file is never
committed. Create it under `backend/` with **your** values (the placeholders below are not real
credentials):

```sh
# backend/.env.uat.local   — DO NOT COMMIT (already gitignored)
export STAGING_API_BASE_URL="https://<your-staging-host>"
export UAT_ADMIN_EMAIL="uat-admin@carup.local"
export UAT_ADMIN_PASSWORD="<your strong unique admin password>"
export UAT_OWNER_EMAIL="uat-owner@carup.local"
export UAT_OWNER_PASSWORD="<your strong unique owner password>"
# Optional, recommended:
export STAGING_SUPABASE_URL="https://<staging-ref>.supabase.co"
```

Source it before running:

```sh
set -a; source backend/.env.uat.local; set +a
```

---

## 3. Staging-only safety guard

Before doing anything, the runner asserts the target is the **staging** environment and refuses
otherwise (`ABORT: not staging`, exit `1`):

- It refuses if the production Supabase ref `vhmnajoeicasaigiophh` appears anywhere in the
  configured target.
- If `STAGING_SUPABASE_URL` / `SUPABASE_URL` is provided, its project ref must equal the approved
  staging ref `eoyenigwevnxwwhyhaer`.
- The API host must be recognisable as staging (contains `staging`/`stg`/`uat`/`localhost`, or
  the configured Supabase URL resolves to the staging ref).

These refs mirror `scripts/provision-staging-qa-accounts.mjs` and are public project identifiers,
not secrets.

---

## 4. Seed the UAT users first

The runner logs in as real seeded accounts; seed them once against staging using the existing
script (it is staging-only, idempotent, and never prints passwords):

```sh
# In a STAGING shell that has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the STAGING project:
UAT_SEED_CONFIRM=yes \
UAT_ADMIN_PASSWORD="<your strong unique admin password>" \
UAT_OWNER_PASSWORD="<your strong unique owner password>" \
node backend/scripts/seed-uat-referral-users.mjs
```

This upserts `uat-admin@carup.local` (role `admin`) and `uat-owner@carup.local` (role `owner`)
into the staging `users` table. Use the **same** passwords for `UAT_ADMIN_PASSWORD` /
`UAT_OWNER_PASSWORD` in `backend/.env.uat.local` so login succeeds.

> The admin account exists because `/api/auth/switch-role` blocks owner→admin escalation by
> design; UAT therefore needs a real admin that logs in normally.

---

## 5. Run the journeys (single command)

```sh
set -a; source backend/.env.uat.local; set +a && node backend/scripts/uat/referral-uat-journeys.mjs
```

The runner:

- Logs in (admin + owner), fetches a CSRF token bound to each authenticated session
  (`GET /api/security/csrf-token`), keeps a per-session cookie jar, and sends `x-csrf-token`
  on mutating requests — mirroring `web/src/.../Login.tsx`.
- Prints `PASS` / `FAIL` / `SKIP` per step, then a per-journey summary table.
- Exits **non-zero** if any step failed. A `SKIP` (a step that genuinely cannot be exercised)
  never fails the run.

---

## Notes

- Read-only safety: the runner only touches referral/marketing/trust data it creates itself
  (uniquely tagged per run via a `uat-<timestamp>` run tag) and the two seeded UAT accounts. It
  performs no destructive operations.
- No new dependencies: pure Node 20+ (`fetch`, `URL`, `crypto`-free). Run with any Node ≥ 20.
