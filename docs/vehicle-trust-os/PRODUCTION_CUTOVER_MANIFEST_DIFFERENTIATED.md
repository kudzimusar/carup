# Vehicle Trust OS — Differentiated MVP Cutover Manifest (delta)

**Status:** ⛔ **NOT AUTHORIZED.** This supplements `PRODUCTION_CUTOVER_MANIFEST.md` (the
original 10-migration release) with the trust-network increment built this session. No
production change has occurred.

**Date (UTC):** 2026-06-26 · **Integration branch head:** `d2431d5`
**Integration PR:** #106 → `release/core-vehicle-trust-os-mvp` · **Release PR:** #103 → `main`
**Staging:** `eoyenigwevnxwwhyhaer` · **Production:** `vhmnajoeicasaigiophh` (DO NOT TOUCH)

## New migrations added this session (beyond the qualified 10)

Marker-aware, Up only, applied after the existing 10 in dependency order:

| # | File | SHA-256 |
|---|------|---------|
| 11 | `20260626120000_source_verification_network.sql` | `e958180029648a08bc5ff313a0e1798ba33851db6a7bf087ec563eb8bf39aa86` |
| 12 | `20260626130000_partner_api.sql` | `a73e5ae7fc54c8d02ee277ac082e7f6e12ec4c70f93288c3ce0a718a27fdfec5` |

Both depend on `governance_block_mutation()` (20260621160000). PGlite isolated
apply/down/re-up: **12/12 · 12/12 · 12/12**; immutability + RLS-enabled + mode-CHECK +
sandbox-labelling assertions green. They add only NEW tables/views — no existing table is
altered, so rollback is isolated.

## STEP 1 (operator) — apply migrations 11–12 to STAGING

The CLI is authenticated for both CarUp projects, but the agent shell lacks the staging DB
password and the claude.ai MCP lacks staging permission (confirmed: "no permission" for
`eoyenigwevnxwwhyhaer`). An operator with the password runs the marker-aware runner:

```bash
cd <repo root>
export SUPABASE_URL="https://eoyenigwevnxwwhyhaer.supabase.co"
export SUPABASE_DB_URL="postgresql://postgres:${STAGING_DB_PASSWORD}@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres"
node database/scripts/apply_migrations_staging.mjs --dry-run   # expect 12 files, URL=staging
node database/scripts/apply_migrations_staging.mjs             # apply (idempotent)
```
The runner aborts unless `SUPABASE_URL` contains `eoyenigwevnxwwhyhaer`. Never print/commit the password.

**Post-apply staging verification:** the 4 new objects exist
(`source_verification_results`, `source_verification_coverage_public`, `partner_clients`,
`partner_api_requests`); append-only UPDATE/DELETE blocked on the two append-only tables;
RLS enabled; control-plane tables service-role only; `source_verification_results` mode
CHECK rejects a non-enum value.

## STEP 2 (operator) — staging deploy + UAT for the new surfaces

After deploy (Vercel access required; not available to the agent), exercise: run source
checks for a vehicle (one sandbox match, one `UNAVAIL` VIN → unavailable, one `STOLEN`
VIN → high-risk); confirm the buyer `SourceCoveragePanel` labels sandbox as "Sandbox demo
(not live)" and never "confirmed"; create a scoped partner key in the admin portal and call
`/api/partner/v1/vehicles/:vin/trust-summary` — confirm finance dimension stripped, no raw
payload, correlation id + audit row recorded.

## STEP 3 — production cutover (after authorization only)

Identical to the base manifest's production sequence, plus: apply migrations 11–12 with the
source adapters **fail-closed** — leave `SOURCE_VERIFICATION_LIVE` unset so production never
calls sandbox providers; verify the public coverage view returns no `source_connected` for
any vehicle until a real live/partner adapter is wired.

## Production safety invariants for the new code
- Source adapters default **disabled in production** (`sourceVerificationFlags`); sandbox
  results are impossible in prod unless explicitly enabled.
- No new endpoint returns raw provider payloads, owner PII, or reviewer-private notes.
- Partner credentials are stored hashed; the plaintext key is shown once at issuance.
- The unified decision never starts from a flattering baseline and never lets sandbox/AI set
  a governed score.

## Single authorization gate (unchanged)
Owner rotates the `vhmnajoeicasaigiophh` DB password, then replies exactly:
`AUTHORIZE VEHICLE TRUST PRODUCTION CUTOVER`.

**FINAL STATUS: VEHICLE TRUST OS DIFFERENTIATED MVP BLOCKED — EXACT BLOCKER AND RECOVERY
ACTION RECORDED** (staging apply credential · staging deploy/UAT access · Gate-15 rotation +
authorization). Trust-network core built, tested (97 backend + 337 web), committed, pushed.
