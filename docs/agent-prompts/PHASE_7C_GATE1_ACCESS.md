# Phase 7C Gate 1 — Secure Staging Access

## Purpose

Unblock automated staging acceptance without asking the owner to paste database credentials, service-role keys, passwords or session tokens into chat.

Read together with:

- `docs/agent-prompts/PHASE_7C_EXIT_SPRINT.md`
- `docs/handoffs/PHASE_7C_VERIFICATION_CASE_MANAGEMENT_HANDOFF.md`

## Current staging deployments

Use the branch preview deployments associated with PR #72:

- Staging backend: `https://carup-backend-staging-git-phase-7c-nati-bb2612-pay-pass-project.vercel.app`
- Staging frontend: `https://carup-staging-git-phase-7c-native-verif-3e08e9-pay-pass-project.vercel.app`

Verify the backend first:

```bash
curl -fsS https://carup-backend-staging-git-phase-7c-nati-bb2612-pay-pass-project.vercel.app/api/health
```

## Secure environment retrieval

The Vercel CLI is already authenticated. Pull the staging backend environment into a temporary file outside the repository.

```bash
mkdir -p /tmp/carup-phase7c-gate1
chmod 700 /tmp/carup-phase7c-gate1

cd backend
npx vercel link \
  --yes \
  --project carup-backend-staging \
  --scope pay-pass-project

npx vercel env pull \
  /tmp/carup-phase7c-gate1/backend-staging.env \
  --environment=preview \
  --yes \
  --scope pay-pass-project

chmod 600 /tmp/carup-phase7c-gate1/backend-staging.env
```

Rules:

- Never print the environment file.
- Never run `cat`, `grep`, `env`, `printenv`, shell tracing, or debug output that exposes secret values.
- Never copy the file into the repository.
- Ensure `/tmp/carup-phase7c-gate1/` and `.vercel/` are not committed.
- Delete the temporary environment file when Gate 1 is complete.

Load the environment only inside the acceptance-test process or a subshell.

The service-role key may be used for staging verification queries and test-session provisioning. A database connection URL is optional if the acceptance script uses the Supabase client.

## Test sessions without sharing passwords

Do not ask the owner for passwords or tokens.

The authentication middleware accepts a valid token stored in `user_sessions`. Use the staging service-role connection to provision temporary sessions safely.

Preferred sequence:

1. Select an existing staging user with role `admin`.
2. Select an existing non-admin user for the applicant scenario.
3. Select another non-admin user for the 403 authorization scenario.
4. Generate cryptographically random session tokens locally.
5. Insert temporary `user_sessions` rows with:
   - selected `user_id`
   - `active_role` matching the user's stored role
   - random token
   - `is_valid=true`
   - expiry no longer than two hours
6. Keep tokens only in process memory or `/tmp/carup-phase7c-gate1/` with mode `600`.
7. Never write tokens to logs, reports, PR comments or Git commits.
8. Delete or invalidate the temporary sessions after Gate 1.

If suitable users do not exist, create clearly named staging-only test users through a dedicated setup script, then document that user counts increased because of test fixtures. Do not create test users in production.

## Required project guard

All scripts must assert:

```text
SUPABASE_PROJECT_REF=eoyenigwevnxwwhyhaer
```

They must refuse:

```text
vhmnajoeicasaigiophh
```

## Gate 1 execution

After secure environment loading and temporary session creation, execute the scenarios in `PHASE_7C_EXIT_SPRINT.md`:

1. cup/non-document containment
2. request resubmission
3. idempotency and stale-version conflict
4. unauthenticated/non-admin/admin authorization
5. controlled synthetic valid-document policy path

Use the staging backend URL above for all API calls.

Use Supabase service-role access only to:

- provision temporary test sessions
- verify database state
- collect decision/audit identifiers
- clean up or invalidate temporary sessions

Do not bypass the API for the actual workflow decisions being tested.

## Completion cleanup

After Gate 1:

```bash
rm -f /tmp/carup-phase7c-gate1/backend-staging.env
```

Also invalidate or delete all temporary staging sessions created for the run.

The acceptance report must not contain secrets, session tokens, signed preview URLs, raw OCR evidence or private storage paths.