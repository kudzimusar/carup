# CR-1 — Owner Credential-Rotation Checklist

> **Owner-only actions.** Nothing here is executed by automation. No secret values appear in this
> document. Rotation is REQUIRED regardless of the history rewrite: the exposed values must be
> assumed compromised for as long as they remain valid.

## Credential classes that appeared in current or historical blobs

| # | Class | Where it appeared (redacted) | Rotation action |
| --- | --- | --- | --- |
| 1 | **Production Postgres password** (project `vhmnajoeicasaigiophh`) | historical blobs incl. `backend/scripts/apply_migration.js` comment (removed from tree 2026-07-26); docs (sanitized to `[ROTATED-SEE-CR1]`); ~13 history commits carry credential-shaped URIs | Supabase Dashboard → CarUp (production) → Settings → Database → **Reset database password**. Update every dependent store (see below). |
| 2 | **Staging Postgres password** (project `eoyenigwevnxwwhyhaer`) | docs (sanitized); operator terminal history; temporary local file `~/.db.eoyenigwevnxwwhyhaer.supabase.co` (delete it) | Reset staging DB password; update `DIASPORA_STAGING_DATABASE_URL` GitHub Actions secret; delete the local temp file. |
| 3 | **Supabase service-role keys** (both projects) | env-only by design; no literal found in tree or history scans — rotate as precaution if either JWT ever left the env | Supabase Dashboard → Settings → API → roll service-role key; update Vercel envs (`carup-backend`, `carup-backend-staging`). |
| 4 | **JWT_SECRET / app-level secrets** | env-only; no tree/history hits | Rotate opportunistically at the same maintenance window. |

## Dependent stores to update after rotation

- **GitHub Actions secrets:** `DIASPORA_STAGING_DATABASE_URL` (deployed-staging UAT workflow).
- **Vercel envs:** `carup-backend-staging` (staging Supabase URL/keys), `carup-backend` (production — owner only).
- **Local operator machines:** delete `~/.db.eoyenigwevnxwwhyhaer.supabase.co`; purge shell history of any `printf/export` lines containing passwords.

## Verification after rotation (no secrets in logs)

1. Staging: `/api/health` on `carup-backend-staging.vercel.app` → `supabase: healthy`.
2. Deployed-staging UAT workflow re-run → 42/0/0/0 (proves the rotated GitHub secret works).
3. Production: `/api/health` on the production backend (owner-run) — read-only check only; **no
   production deploy or migration under this checklist** (EB-5 separate).

## Sequencing note

Rotate **before or together with** the history rewrite. Rewriting history without rotating leaves the
old values valid; rotating without rewriting leaves dead values in history (acceptable interim state —
the rewrite then removes residue).

---
**STATUS (2026-07-26): EXECUTED.** Rotation performed by the owner (staging verified; first attempt caught ineffective and redone; GitHub secret re-set after an invalid value was detected from CI). See docs/security/CR1_EXECUTION_LEDGER.md.
