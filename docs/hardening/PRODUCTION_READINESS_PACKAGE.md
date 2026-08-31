# Non-Seller Production-Readiness Package

**Scope:** the consolidated non-Seller system on `hardening/non-seller-convergence`.
**No production write, migration, secret change or deployment was performed to produce this
document.** Everything below is derived from repository evidence and local PGlite rehearsal.

**Verdict: BLOCKED for production activation.** Reasons are enumerated in §7 and are all
owner/environment gates, not code defects.

---

## 1. Ordered migration inventory

PR #194 adds **17** migrations to `database/migrations/` relative to `main` (`ba208963`).
`git diff --name-status origin/main...HEAD -- database/migrations/` returns **17 × status
`A`, zero `M`** — no published migration was edited in place.

Apply order is lexicographic by full filename, which matches the dependency DAG for all 17.

| # | Migration | Fresh-DB safe? | Dependency guard |
|---|---|---|---|
| 1 | `20260826120000_email_1_0_hardening` | **upgrade-only** | bare `ALTER TABLE email_reply_tokens ALTER COLUMN version SET DEFAULT 2` |
| 2 | `20260827120000_intelligence_activity_ledger` | both | `CREATE TABLE IF NOT EXISTS` |
| 3 | `20260827130000_intelligence_rollups` | both | `CREATE TABLE IF NOT EXISTS` |
| 4 | `20260827140000_intelligence_post_review_hardening` | **silently upgrade-only** | function bodies reference #2's tables; unresolved at `CREATE` time → **unguarded soft edge** |
| 5 | `20260828120000_intelligence_recommendations` | both | `IF NOT EXISTS` |
| 6 | `20260828133000_global_vehicle_taxonomy_s0` | both | `ALTER TABLE IF EXISTS vehicles` |
| 7 | `20260828140000_global_vehicle_taxonomy_imports_s0` | both | `ALTER TABLE IF EXISTS diaspora_import_orders` |
| 8 | `20260828143000_global_vehicle_taxonomy_color_s0` | both | `ALTER TABLE IF EXISTS vehicles` |
| 9 | `20260828160000_seller_s3_location_visibility_province_only` | both | `EXISTS (SELECT 1 FROM pg_constraint …)` |
| 10 | `20260828203000_passport_ownership_transfer_authority` | **upgrade-only** | bare `ALTER TABLE vehicle_ownership_history` |
| 11 | `20260828210000_issue158_private_key_custody` | upgrade-only | `DO $pre$ … RAISE EXCEPTION` |
| 12 | `20260828220000_passport_ownership_transfer_communications` | **upgrade-only** | bare INSERTs into `communication_templates` |
| 13 | `20260829003000_issue158_custody_rollout_upgrade` | upgrade-only | self-sufficient re-create + `ADD COLUMN IF NOT EXISTS` |
| 14 | `20260829020000_issue158_activation_boundary_hardening` | upgrade-only | requires `blockchain_custody_rollout` **+ RAISE** |
| 15 | `20260829040000_issue158_terminal_event_uniqueness` | upgrade-only | requires `blockchain_signing_watermarks` **+ RAISE** |
| 16 | `20260829123000_user_registration_profiles` *(Seller-owned)* | both | `CREATE TABLE IF NOT EXISTS`, RLS enabled **and forced** |
| 17 | `20260830060000_issue158_terminal_operation_identity` | upgrade-only | requires `uq_blockchain_events_terminal_signer` **+ RAISE**; tolerates an absent ledger table |

**Two objects are created by NO executable migration** — they exist only in the
non-executable `supabase_schema.sql` snapshot: `public.vehicle_ownership_history` and
`public.blockchain_events`. Migrations 10 and 17 depend on them. On a database provisioned
purely from the executable migration set, #10 fails outright and #17 no-ops its ledger work.
This is a real gap in the provisioning story and is listed as a residual.

### Integrity checks (all PASS)

- **Marker check:** all 17 carry exactly one `-- +migrate Up`. The only marker-less files in
  the tree are the 4 governed provenance-pinned migrations, retired `009`, and the schema
  snapshot — none touched by this PR. All four provenance `sha256` pins still match, so
  `PROVENANCE_PIN_BROKEN` cannot fire.
- **Duplicate versions:** zero duplicate filenames across all 158 files. The 8
  timestamp-prefix collisions are exactly `KNOWN_TIMESTAMP_PREFIX_COLLISIONS`; this PR adds
  none. Verified by running the runner's own `assertDeterministicVersions` over the real set.
- **Corpus parse:** verified by running `parseMigrationSource` over all 157 executable files.
- **No in-place edits:** `backend/db/` and `migration-integrity.test.js` are untouched.

### Down semantics, stated honestly

- 5 have genuinely executable Downs (`20260828120000`, `133000`, `140000`, `143000`, `20260829123000`).
- 6 declare forward-only in a comment-only Down and are honest about it (the Issue #158 chain
  and `20260828203000`).
- 3 have no Down marker but document rollback in-file (`20260827120000/130000/140000`).
- **1 has neither**: `20260826120000_email_1_0_hardening` — no Down marker, no in-file
  rollback note; rollback exists only in the runbook, off-artifact.

---

## 2. Preflight and rehearsal

Rehearsed locally against **real PostgreSQL (PGlite)** running the **real migration files**,
from representative pre-migration states — a custody-only database, a legacy monolithic
database, a PREPARED database with a live legacy writer, and a forward-skewed
pre-hardening history.

```sh
# Migration corpus integrity (parser + real corpus + provenance pins)
node --test backend/tests/migration-integrity.test.js            # 24/24

# Issue #158 chain applied to real PostgreSQL from four pre-migration states
node --test backend/tests/issue-158-*.test.js \
            backend/tests/passport-v16-postgres-authorities.test.js   # 68/68
```

**A defect was found and fixed by this rehearsal**: migration 17's preflight hard-failed with
`public.blockchain_events is absent`, which broke 13 tests. Its predecessor (`20260829040000`)
and the protected finalizer both guard the same work with `IF to_regclass(...) IS NOT NULL`,
so a custody-only database is already inside the chain's contract; only the new migration
refused one. Refusing there protects nothing and blocks custody finalization. Now consistent.

**Lock-risk notes (unchanged, restated honestly):** `20260829040000` and `20260830060000`
each scan `public.blockchain_events` once under a lock that blocks concurrent writes to that
table. `CREATE INDEX CONCURRENTLY` is deliberately not used — it cannot run inside a
transaction block and this repository's runner applies each migration transactionally.
`ADD COLUMN … NULL` is catalog-only (no rewrite). `ADD CONSTRAINT … NOT VALID` +
`VALIDATE CONSTRAINT` takes `SHARE UPDATE EXCLUSIVE` for a second scan.

**Maintenance window required:** yes, for the Issue #158 chain (11 → 17). The protected
rollout already requires old writers to be drained.

**Abort points:** every Issue #158 migration raises before mutating anything. The finalizer
(`database/scripts/issue158_private_key_custody_finalize.sql`) has **nine distinct
`RAISE EXCEPTION` preconditions** before it erases any private material, now including the
three operation-identity objects and a check that no terminal row lacks an identity.

**Post-migration verification queries** are the assertions in
`backend/tests/issue-158-terminal-operation-identity.test.js` (§3, "the database itself
refuses…"), which can be run against a staging database directly.

---

## 3. Runtime configuration inventory

**No secret value is printed anywhere in this document or in the repository.**

Method: `process.env.*` across `backend/` (141 names; 98 in non-test code) and
`import.meta.env.*` across `web/src` (6 names).

> **Inventory hazard, stated explicitly:** a bare `process.env` grep is **incomplete**.
> `communicationConfigurationValidator.js` reads ~40 further keys off an *injected* `env`
> object, as do `authMiddleware`, `capabilityFlags` and `listingSummaryService`. Any
> env inventory built by grep alone under-reports.

| Class | Variables | Status |
|---|---|---|
| **Startup-fatal (pre-existing)** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, OCR provider under `OCR_MODE=strict` | present |
| **Startup-fatal (added this cycle, production only)** | `JWT_SECRET`, `CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET`, `CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET` | **owner action required** |
| **Correctly fail-closed** | `INTELLIGENCE_WORKER_SECRET`, `*_WEBHOOK_SECRET` (finance/insurance/escrow), `COMMUNICATION_WORKER_SECRET`, `CRON_SECRET`, `CARUP_ALLOW_SYNTHETIC_ACTIVITY`, `CARUP_ALLOW_X_USER_ID_FALLBACK` | verified |
| **Tuning defaults (permissive by design)** | `PORT`, `COMMUNICATION_*`, `AI_PROVIDER_TIMEOUT_MS`, `OCR_*`, `DIASPORA_*` (default OFF), `EVENT_WORKER_*`, `CORS_ALLOWED_ORIGINS` (empty → hardcoded allow-list, i.e. closed), `REDIS_URL` (absent → in-memory limits, per-instance on serverless), `CAPABILITY_KILL_SWITCH` | acceptable |
| **Web** | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MARKETPLACE_ALLOW_MOCK`; build-time `VITE_COMMIT_SHA`, `VERCEL_*` | present |

### Closed this cycle

1. **All 16 undocumented names added to `backend/env.example`** with REQUIRED-vs-optional
   comments. They were absent from *both* templates, so provisioning from them produced a
   server that booted healthy and threw on the first ledger write.
2. **Boot-time validation extended** — a production deployment missing `JWT_SECRET` or either
   ledger secret now refuses to boot instead of serving `status: 'UP'` and failing at first
   use. Gated on `CARUP_ENV`/`VERCEL_ENV`, never `NODE_ENV`.
3. **Ephemeral signing secrets closed in production.** `masterSecret()` and
   `currentSystemSecret()` fell back to `crypto.randomBytes` whenever `NODE_ENV === 'test'`.
   In a deployment mis-set that way the ledger would keep accepting writes while every
   signature became unverifiable across instances and restarts.

### Owner/provider action required before activation

`JWT_SECRET`, `CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET`, `CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET`
must be provisioned in the production environment. **Unverified from here** — this cycle made
no production credential read or write.

---

## 4. Deployment

**Frontend provenance — the strongest part of the system.** `web/vite.config.ts` plumbs
`VERCEL_GIT_COMMIT_SHA` into `VITE_COMMIT_SHA` and emits `/carup-provenance.json`.
`web/build/previewPairing.ts` **fails closed**: an unpaired preview gets the RFC-2606
sentinel `https://unpaired-preview.carup.invalid/api` rather than silently borrowing main's
backend.

**Backend provenance.** `backend/config/buildProvenance.js` resolves
`VERCEL_GIT_COMMIT_SHA || GITHUB_SHA || CARUP_BUILD_SHA`, reports
`provenance_available: false` when unknown, and `assertRuntimeRevisionParity()` treats
unknown provenance as **failure**. Surfaced at `/api/health`.

**Health endpoints.** `/api/health` (public) and `/health` (operator-authenticated).

**Pipeline.** There is **no deploy workflow**. `ci.yml` states "NO automatic production
deploy. Production promotion is a separate, manually-approved step." Deployment is Vercel Git
integration plus manual promotion.

> **Merging to main does NOT promote CarUp production.** A READY `main` deployment is not
> production provenance. Promotion is a separate owner-controlled action.

**Ordering: migrate before deploy.** The runtime fails closed on absent migrations
(`isMissingCustodyRolloutContractFunction` never infers `FINALIZED`; a terminal write names
the migration it needs), so deploy-before-migrate degrades safely for non-terminal writes but
refuses terminal ones. Migrating first avoids that window entirely.

**Residual:** `backend/vercel.json` is literally `{}`, and no `crons` key exists in any
`vercel.json` despite `CRON_SECRET` being an accepted scheduler credential. Cron scheduling
therefore lives entirely in Vercel dashboard state that is not represented in the repo and
cannot be code-reviewed.

---

## 5. Observability

| Capability | Status |
|---|---|
| Correlation IDs | **present** — `correlationMiddleware.js` accepts `x-request-id`/`x-correlation-id`, else mints `req-<uuid>`, echoes both, propagates via `AsyncLocalStorage` |
| Latency telemetry | present — `telemetryMiddleware.js`, warns >500ms |
| Audit logs | present — `auditLogger.js`, authoritative `trust_audit_events` + FK-safe legacy mirror |
| Health checks | present — `/api/health`, `/health` |
| Outbox visibility | present — health reports `domain_events` pending count |
| Migration diagnostics | **strong** — parse errors are hard failures; per-file exclusion logging; the runtime never infers `FINALIZED` from a missing function |
| **Error telemetry** | **ABSENT** — `backend/services/ai/sentry.js` is a stub with no SDK dependency; `captureException` only calls `logger.error` |

---

## 6. Security posture

Closed this cycle (each with a regression test in
`backend/tests/non-seller-authority-hardening.test.js`):

- `/api/verification` was mounted **bare** — no auth on the mount and none on any of its five
  routes — making it a second, unauthenticated authority over vehicle trust, registry records
  (`cvr_ownership_records`, `zimra_declarations`) and identity verification level. CSRF was
  not a barrier: the token endpoint issues a guest-bound token to anyone. Now gated at the
  mount with `authorizeSessionRole(['admin','government'])`, which also disables the
  `x-user-id` fallback. **Zero product and zero test callers existed**, so the blast radius
  of the gate is nil.
- The OCR approval reviewer came from `req.body.actorId` and was written to
  `administrative_overrides` as the accountable reviewer. Now taken from the session.
- `isUserIdFallbackAllowed()` inferred permission from `NODE_ENV` alone.
- `masterSecret()` / `currentSystemSecret()` minted ephemeral secrets under `NODE_ENV=test`.
- The diaspora handoff ledger writer signed with the **retired hardcoded system secret**, so
  every handoff event it wrote would fail `verifyChain` for that VIN forever. Now uses the
  canonical `signSystemLedgerHash`, and the absence guard is **repo-wide** rather than scoped
  to the two files it was written for.

### Not closed — evidence limits stated plainly

- **Anonymous access is NOT proven closed by CI.** The nine `LIVE:` anon-probe tests in
  `backend/tests/db-anon-grant-posture.test.js` are **skipped** without
  `CARUP_ANON_PROBE_URL`/`KEY`. They are the executable evidence for the anon posture, and
  they did not run. Per the measurement rule, no anon residual is claimed closed here.
- RLS, service-role grants, default privileges, tenant boundaries and destructive foreign
  keys were audited from migration source only. Several candidate findings in this area were
  **refuted** on verification (the `ON DELETE CASCADE` chain, the `service_role` grants on
  the intelligence tables, and the anon-revoke migrations all survived refutation attempts).

---

## 7. Production-readiness verdict

**BLOCKED.** Not for code defects — the battery is green — but for these gates:

1. Three required production secrets must be provisioned by the owner (§3).
2. The Issue #158 chain needs a maintenance window with old writers drained (§2).
3. `vehicle_ownership_history` and `blockchain_events` are created by no executable
   migration (§1).
4. Anon access is unproven by executable evidence in CI (§6).
5. Error telemetry is a stub (§5).
6. Cron scheduling is unrepresented in the repo (§4).
7. **Seller is not integrated.** The final Seller candidate has not joined.

**PRODUCTION NOT ACTIVATED. No production write, migration, secret change or deployment was
performed in this cycle.**
