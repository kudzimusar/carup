# EB-5 — Production Cutover Receipt (2026-07-26 UTC)

> Owner authorizations: **"APPROVE EB-5 PRODUCTION CUTOVER WITH FAIL-CLOSED GATES"**, **"Authorize
> full #3-#18"**, **"APPROVE #19 PHASE-8/9/10 HARDENING"**. Production Supabase project
> `vhmnajoeicasaigiophh` (PostgreSQL 17.6). No secret values appear in this document.

## 1. Database — migrations

- **Ledger #3–#18 applied** in ledger order, checksum-verified against the frozen tree, one
  transaction each, recorded in the official `supabase_migrations.schema_migrations` (16/16).
  Production-side version bumps +1s for #12/#13/#15 (collisions with production's own
  vehicle-life migrations at those date-versions).
- **Ledger #19** (`20260726120000_diaspora_phase8_9_10_client_grant_hardening`, frozen sha256:12
  `6674706778b5`): closes the Supabase DEFAULT-PRIVILEGES grant gap on the 19 Phase 8/9/10 tables.
  Proven on real Postgres 17 (30/30, `backend/tests/realpg/phase8-9-acl-realpg.mjs`), merged as
  PR #125 (`2603997`), applied **staging first** (workflow run 30208491963; verify re-run
  30208601860 after the `pg_attribute.attacl` column-grant check fix) and then **production**
  (single transaction + ledger row).
- **Post-apply production contract, verified live (19/19 tables):** anon=NONE ·
  authenticated=SELECT-only · service_role=FULL · RLS enabled · pg_policies byte-identical ·
  row counts unchanged · zero column-level client ACLs · PG17 MAINTAIN absent from client roles ·
  live probes denied (anon SELECT / anon INSERT / authenticated INSERT → 42501) ·
  `vehicles` anon SELECT (public marketplace) intact.
- **Gate D2:** canonical deployed-staging UAT after #19 — **42 passed / 0 failed / 0 skipped /
  0 flaky** (run 30208660637).

## 2. Deployments

| Surface | New production deployment | Rollback target |
|---|---|---|
| Backend `carup-backend` → `carup-backend.vercel.app` | `dpl_BdVLLavsujDZdD8tFwaa9uipv4ee` | `dpl_HeJSMec12jXDAmhweYAVWSpsPm5i` |
| Frontend `carup` → `carup.vercel.app` | `dpl_EK8Wq2Wzy9oBuoVwjFvrfpK9uKKZ` | `dpl_HRTZgAgmcDTBpZSDsdAxRyhDcBnm` |

Rollback = `vercel alias set <rollback-deployment-url> <canonical-domain>` (or redeploy the
rollback ID from the Vercel dashboard). Database rollback for #19 is intentionally absent
(tightening-only); restore-from-backup under explicit authorization.

- Backend health post-deploy: `/api/health` → `status=UP`, `supabase.status=healthy`,
  `outboxBacklog=0`.
- Frontend built with `VITE_API_URL=https://carup-backend.vercel.app/api`; the served bundle
  references the production backend and contains **zero** staging references
  (`carup-backend-staging`, staging project ref: 0 occurrences).

## 3. Public-journey smoke (production, no UAT identities created)

Chromium against `carup.vercel.app`: home → marketplace (live DB listing rendered via the
production backend) → diaspora entry. **Console: 0 errors, 0 warnings.** All API requests to
`carup-backend.vercel.app` only, statuses 200/202 — no 4xx/5xx, no page errors.

## 4. Risky surfaces — proven OFF (three independent layers)

| Surface | Flag layer (`/api/features/effective`, env=production) | DB layer | UI layer |
|---|---|---|---|
| Real-money SafeTrade | `diaspora.safetrade`: hidden, visible=false, accessible=false | CHECK `live_payment=false`; CHECK `provider ∈ {sandbox,fake}`; 0 rows; writes service-role-only (#19) | no SafeTrade UI |
| Live billing / subscriptions | `diaspora.subscription`: hidden, visible=false, accessible=false | 0 subscription/billing-event rows | no billing UI |
| Live Drive | `diaspora.drive-connections`: visible=false, accessible=false | 0 drive-connection rows | no Drive UI |
| Confirmed workbook import | only `workbook-dry-run` / operator console registered; both visible=false, accessible=false | 0 workbook batch rows | no import-confirm UI |
| Trade Graph UI | no trade-graph feature registered | 0 rows in all 7 `trade_graph_*` tables; client writes revoked (#19) | no Trade Graph UI |
| UI-10 | not registered | — | not present |

## 5. Residual findings (recorded, out of authorized scope)

1. ~~**`diaspora_oauth_states`** (ledger #10, H6) carries the same Supabase default anon grants #19
   removed elsewhere. Inert: RLS enabled with **zero policies** (default-deny) and 0 rows. Close
   via a #20 under its own authorization.~~ **CLOSED (2026-07-27)** by ledger #20
   (`20260727090000_diaspora_oauth_states_client_grant_hardening`, PR #126) — see
   `docs/DIASPORA_TRADE_OS_20_OAUTH_STATES_CLOSURE_RECEIPT.md`.
2. Repo-convention hardening candidates flagged by review (not changed here): GitHub Actions
   pinned by tag (`@v4`) rather than commit SHA; `workflow_dispatch` usable from any ref;
   Supabase pooler TLS verified via credential/ref checks rather than CA pinning
   (`rejectUnauthorized: false` — pre-existing pattern across the program).

## 6. Credential hygiene

- The production Session-pooler credential file `~/.db.vhmnajoeicasaigiophh.supabase.co` was
  **deleted** at cutover completion.
- **REQUIRED FOLLOW-UP (owner):** rotate the production database password again — it transited
  an operator terminal during EB-5 — and do not share the new value. The staging credential
  exists only as the `DIASPORA_STAGING_DATABASE_URL` GitHub secret (post-CR-1).

## Verdict

**EB-5 COMPLETE — PRODUCTION CUTOVER VERIFIED** (migrations #3–#19 applied + verified; staging
gates green incl. 42/0/0/0 UAT; production deploys healthy; bundle production-only; smoke clean;
risky surfaces proven OFF at flag, DB, and UI layers).
