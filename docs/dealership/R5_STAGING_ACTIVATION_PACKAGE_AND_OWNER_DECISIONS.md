# CARUP-DEALER-ONB-001-LR01-R5 — staging activation package (NOT ACTIVATED) and Owner decision register

**Status:** prepared, not executed. No staging deployment, shared-database migration, preview alias, real dealer publication or payment has been performed. Every step below needs the separate, explicit Owner authority named in its row.

## 1. Candidate identity

| Item | Value |
|---|---|
| Source | Draft PR #258, branch `feat/carup-dealer-1-0-unified-longrun` — exact SHA is the head named in the R5 return comment, after its CI is green |
| Protected main | `bb9d9900c700873ca57df0ac18a1a5c01f77711a` |
| Frontend / backend preview pair | **None approved.** Must be created by the exact-SHA preview procedure (cached Vercel CLI from a clean worktree; web built with `VITE_API_URL` pinned to the immutable backend deployment host) and registered in `web/preview-backend-pairing.json` + `web/preview-frontend-pairing.json` in one commit. No borrowed hosts. |

## 2. Environment variables (names only — values come from the governed secret store)

| Variable | Where | Purpose |
|---|---|---|
| `DEALER_MEDIA_REVIEW_TICKET_SECRET` | backend | HMAC secret for scope-bound media review tickets (shared across instances) |
| `CARUP_DEALER_OCR_LOCAL_ENABLED` | backend | Keep unset/`false` on staging (local OCR is opt-in) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` | backend | Existing staging values; unchanged |
| `VITE_API_URL` | web build | The immutable backend preview host |
| Never on staging | — | `DEALER_SEED_DATABASE_URL`, `CARUP_DEALER_RESEARCH_XLSX`, `DEALER_ISOLATED_POSTGRES_URL`, `DEALER_BROWSER_*` (local/CI-only) |

## 3. Migration sequence (20 additive, filename order)

`20261103120000` → `20261103143000` (see `database/migrations/202611031*.sql`). Rehearsal order:

1. **Staging clone / PITR marker** recorded (Owner authority: *staging clone*).
2. Apply all 20 to the **clone** through the governed migration runner; run `database/test/dealer_1_0_pglite_check.mjs` semantics against the clone, never staging itself.
3. EXPLAIN the canonical-table trigger lookups (`vehicles`, `vehicle_evidence`, `marketplace_inquiries`, `tenants`, `tenant_users`, `dealer_profiles`, `vehicle_seller_authority`) on clone-sized data; attach the DBA review.
4. Confirm `pg_cron` job `carup-dealer-listing-lapse-sweep` is registered only if `pg_cron` exists.
5. Only then (separate Owner authority: *staging migration*) apply to staging.

## 4. Kill-switch and backout

| Level | Action | Data effect |
|---|---|---|
| K1 — UI | Remove the dealership routes from `web/src/App.tsx` / hide nav (redeploy web) | none |
| K2 — API | Unmount `dealerRouter` (`backend/server.js` `app.use(dealerRouter)`) | none |
| K3 — canonical triggers | `DROP TRIGGER` the six R4 triggers on canonical tables (list in `R4_INTEGRATION_ROLLBACK_AND_RELEASE_GATES.md`) | none; tables kept |
| K4 — schedule | `SELECT cron.unschedule('carup-dealer-listing-lapse-sweep')` | none |
| K5 — down migrations | Reverse order; each custody-bearing migration **refuses** while append-only rows exist — use forward-fix instead | destructive only when empty |

## 5. Smoke / health / negative checks after any authorized staging apply

- `/api/health` and the exact SHA served by both preview hosts.
- `/api/dealership/research` returns only reviewed prelistings; **0 real dealers published** (no research row reviewed for publication).
- Anonymous `/api/dealership/research/:seed/inventory` → empty for every real seed.
- Dealer routes without a session → 401; another tenant's VIN/inquiry → 403/404.
- No payment, Paynow or subscription call is reachable from dealer routes.
- Marketplace Reference Regression green on the registered pair.

## 6. Owner decision register (each is the Owner's to make; none is assumed)

| # | Decision | Needed for | Current state |
|---|---|---|---|
| O1 | Authorize an isolated non-production staging preview pair + clone (distinct permission) | INTEGRATION READY | Not authorized |
| O2 | Appoint named independent Security, DBA and Functional reviewers (agent reviews are advisory) | INTEGRATION READY | Agent reviews only |
| O3 | Legal owner/approver of the Zimbabwe dealer policy (only a DRAFT row exists) | PILOT READY | Not appointed |
| O4 | Per-record publication eligibility for the 104 researched dealers | PILOT READY | 0 approved |
| O5 | Pilot coordinator and 12 consenting real dealers | PILOT READY | None |
| O6 | OEM / logo rights policy | PILOT READY | Placeholder only |
| O7 | Tariffs and billing actor: tenant role `dealer` vs `tenant_admin` (PAY-03B billing authority) | COMMERCIAL READY | Undecided |
| O8 | PAY-03B #251 and garage-owned PAY-05 #254 sequencing (separate finance programmes, independent finance review) | COMMERCIAL READY | Both Draft |
| O9 | Launch scope: are C04 true AI mapping, C21 financing, C22 warranty, C23 real buyer reviews, C25 foreign onboarding mandatory for the first launch, or deferred? | Scope sign-off before merge | Implemented only as fail-closed/declaration-only |
| O10 | Minimum core claim-first pilot vs full commercial product — explicit sign-off; no silent scope reduction | Merge/release | Not signed |
| O11 | After an independent claim **revocation**, may the same public URL invite a new claim ("Claim this dealership"), or must it stay closed pending dispute review? (Phase 7 screenshot shows it re-opens.) | Pilot policy | Undecided |
| O12 | Publication of REAL researched records: single reviewer + password today; require a two-person rule and/or an Owner publication-policy row before any real record is published (Security review #2) | PILOT READY | Not decided; 0 real records published |

## 7. Independent review dispositions (R5, 7 Nov 2026 — agent reviewers, advisory, not named certifiers)

| Review | Finding | Disposition |
|---|---|---|
| Security #1 | Takedown reversible by one reviewer; old storefront revives | **Fixed** (`9731a20d`): different reviewer required; storefront approval must post-date the latest takedown |
| Security #2 | One reviewer can publish real researched records | **Owner decision O12** (latent: real rows exist only in a private local import) |
| Security #3 | Public media endpoint returns up to 24 × 4 MB base64 per anonymous request | **Open** — replace with short-lived signed URLs/thumbnails + byte cap before staging |
| Security #4 | Live branch name on public media view | **Fixed** — reviewed snapshot name |
| Security #5 | Step-up password limits spread across buckets; no per-account lockout | **Open** — add per-user failed step-up lockout; confirm app-wide limiter change |
| Security #6 | Legacy profile route edits activated profiles | **Fixed** — 409 + test |
| Security #7 | Conflict-of-interest gaps (reviewer with own claim; tenant members as storefront/legal reviewers) | **Open** |
| Security #8 | No write limits on owner routes; queue issues up to 200 tickets/call; ticket RPC `search_path`/`p_now` | **Open** |
| DBA #1/#3/#5/#7 | `::text` casts, REPEATABLE READ leak, inquiry lock, `lock_timeout` | **Fixed** |
| DBA #4 | Deadlock possible between dealer writes and suspension (outcome correct, dealer write retried) | **Open** — document lock order, retry on 40P01 |
| DBA #6 | Downs of 120000/121000/122000 lack custody checks; 125000 Down re-grants | **Open** |
| DBA #8 | pg_cron job scheduled on apply; purge `cron.job_run_details` | **Ops runbook** |
| Functional #1 | Register cited failed runs | **Fixed** — outcomes derived from run JSON; `--verify-runs` |
| Functional #2 | T32 contrast | **Fixed** — 0 critical/serious on all scanned pages at `94e0923b` |
| Functional #3 | C02: activation carries over only legal name, trading name and the first branch; GPS/hours/extra branches/policy tabs are retyped | **Open — engineering gap** |
| Functional #4 | C12 lifecycle workbench has no browser test (SQL/unit only) | **Open** |
| Functional #6 | Unwired/untested routes (`intake/template`, `requirements`, `documents`, membership summary; unpublish, CSV, OCR UI, billing page not browser-tested); legacy global-role dealer workspace runs in parallel | **Open** |
