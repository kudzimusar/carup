# Secrets Rotation Runbook (Milestone 6, master plan §12.4)

> This document contains **procedures only**. It contains **no secret values** and none must ever
> be committed or printed.

## Inventory & ownership

| Secret | Used by | Store | Owner | Rotation |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | API/workers (server-side only) | host env / secret manager | platform | 90 days + on exposure |
| `SUPABASE_ANON_KEY` | client (publishable) | host env | platform | as needed |
| `JWT_SECRET` | CSRF/session signing (M6 fix: no service-role fallback) | host env | security | 90 days |
| `GEMINI_API_KEY` (+ other AI keys) | AI provider | host env | AI owner | 90 days + on exposure |
| `REDIS_URL` | distributed rate limiter | host env | platform | on exposure |
| `AUTOMATION_WEBHOOK_URL` | event bus webhooks | host env | platform | on exposure |

## Principles

- **Least privilege:** service-role key is server-only and never shipped to the browser; frontend
  bundles receive only `VITE_`-prefixed publishable values. CI uses test-only placeholders.
- **Separation:** distinct dev / staging / production credentials; never reuse across envs.
- **No repo secrets:** `.gitignore` covers `.env*` (except `.env.example`); CI scans for leaks.
- **Auditing:** access to the secret manager is logged; rotations recorded with date + actor.

## Routine rotation

1. Generate the new secret in the provider console (Supabase/Google/Redis).
2. Add it to the secret manager as a new version; deploy API/workers to pick it up (rolling).
3. Verify health, then revoke the old version.
4. Record date/actor.

## EMERGENCY: rotate a potentially-exposed Supabase service-role key

1. **Contain:** in the Supabase dashboard, generate a new service-role key (project → API settings).
2. **Deploy:** update `SUPABASE_SERVICE_ROLE_KEY` in the host secret manager for API + workers;
   roll the processes. Confirm `/api/health` shows healthy Supabase.
3. **Revoke** the old key in Supabase.
4. **Invalidate sessions** if compromise is suspected: rotate `JWT_SECRET` too (forces re-auth) and
   mark active `user_sessions` invalid.
5. **Audit:** review `trust_audit_events`, `diaspora_import_audit_log`, and DB/storage access logs
   for unauthorized use during the exposure window; quarantine any suspect data changes.
6. **Report:** file a SEV1 per the DR runbook; notify stakeholders if data was accessed.
7. **Record** the rotation + findings.

> Per the master plan, any previously-exposed service-role key MUST be rotated through this secure
> process. This runbook is the procedure; execution requires Supabase project access (not performed
> here) and must be done by an authorized operator.
