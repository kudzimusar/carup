# Production Access & Cutover Method (canonical — prevents the access loop from recurring)

**Executed cutover:** 2026-07-02/03 · main merge `ef7a4323…c6fdc` · 16/16 migrations · smoke 21/21.
No credential values appear in this document. Never commit tokens, DB passwords, service-role
keys, or connection strings.

## Ground rules learned (the expensive way)

1. **Worktree paths are irrelevant.** `carup-pa`, `carup-kimi`, etc. are Git worktrees of
   `kudzimusar/carup`, not environments. Always discover the repo root with
   `git rev-parse --show-toplevel`; never encode a folder name into an access decision.
2. **Authorization ≠ connection.** An owner authorization phrase grants permission; it does not
   place a credential into the agent's shell. Verify a working connection *before* declaring a
   cutover executable.
3. **Project identity is verified, never assumed.** Before any mutation, prove the target:
   - production must be `vhmnajoeicasaigiophh` (name CarUp, region ap-south-1);
   - staging must be `eoyenigwevnxwwhyhaer` (carup-staging, ap-southeast-2);
   - run a read-only probe (row counts / `current_database()`) and refuse on mismatch.

## Preferred access order for production DB operations

### 1. Official Supabase MCP (when connected + authenticated to the CarUp org)
Use MCP tools directly. Confirm it can list BOTH CarUp projects, then select only the intended ref.

### 2. Supabase CLI → Management API (the method that worked; no DB password involved)
Requires: `supabase login` completed on the machine (token stored by the CLI; the agent never
extracts or prints it).
```bash
supabase projects list                      # must show both CarUp refs
supabase link --project-ref vhmnajoeicasaigiophh    # token-only; skip DB password prompt
supabase db query --linked --output json -f <file.sql>   # runs via Management API
```
- Migrations: extract **Up-only** (everything before `-- +migrate Down`), wrap `BEGIN; … COMMIT;`,
  verify SHA-256 against the release manifest, apply one at a time, stop on first error
  (runner: `database/scripts/apply_migrations_production.mjs`).
- **Never `supabase db push`. Never run a whole migration file (it contains the Down section).**
- Re-link to staging afterwards if staging work resumes (`supabase link --project-ref eoyenigwevnxwwhyhaer`).

### 3. Direct `pg` with `.env.production` (last resort only)
Only if MCP and Management API are both genuinely unavailable. Gitignored file, session-pooler URL
from the Supabase Connect panel, guard-checked runner. Do not ask the owner to paste secrets into chat.

## Mandatory preflight before any production mutation
1. `git rev-parse --show-toplevel` + HEAD == the expected qualified release SHA; tree clean.
2. All migration hashes match the release-PR manifest.
3. Read-only identity probe returns production (not staging) markers.
4. Record pre-cutover inventory (ledger count, target-table presence) as the recovery position.
5. Release PR is CLEAN/MERGEABLE at the expected head; required checks green.
6. Confirm the app-runtime env is complete — **specifically `JWT_SECRET` on carup-backend**
   (missing it 500s `/api/security/csrf-token` and blocks every mutation app-wide).

## Post-mutation verification (what "done" means)
- Ledger rows for every applied migration; expected tables/views/functions present.
- RLS enabled on sensitive tables; no anon grants on control-plane tables; append-only triggers present.
- `supabase db advisors --linked` — classify; 0 introduced P0/P1 before merging.
- Merge the release PR with `--match-head-commit <expected-sha>`.
- Verify FE+BE production deployments are Ready and built from the merge commit.
- Behavioral DB-binding proof: write through the deployed backend API, read the row in the
  intended project (`database/scripts/production_smoke.mjs`).
- Smoke must confirm fail-closed honesty: adapters `mode=unavailable` in production, coverage never
  `source_connected`, eligibility gated, partner responses redacted, cross-user 403.

## UAT data hygiene in production
Synthetic rows are prefixed (`uat-prod-*`, VIN `UATPRD…`). Append-only audit rows and FK-RESTRICT
targets **cannot and should not be deleted** — instead: delete sessions, **revoke** partner keys,
demote/unverify UAT users, leave the labelled draft vehicle + audit trail in place.
