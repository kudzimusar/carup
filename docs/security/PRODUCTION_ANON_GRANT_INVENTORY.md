# Production current-state inventory — anonymous read surface

**Project:** `vhmnajoeicasaigiophh` (production) · **Date:** 2026-08-25
**Mode:** read-only. No production mutation, no console SQL, no customer document opened.
**Evidence rule:** structural only — column *names*, row *counts*, HTTP status. No row value was read or recorded.

## Identity proof (mandatory, not inferred)

Identity was **not** taken from table contents or environment names.

| Source | Result |
|---|---|
| MCP transport binding (`.mcp.json`) | `project_ref=vhmnajoeicasaigiophh`, `read_only=true` |
| Project's own edge log stream | 782/782 requests served on host `vhmnajoeicasaigiophh.supabase.co`, no other host |
| Anon key JWT `ref` claim | `vhmnajoeicasaigiophh` |
| `SUPABASE_URL` hostname | `vhmnajoeicasaigiophh` |

The probe scripts **abort** unless the URL ref, the JWT ref and the expected ref all agree, and unless the key's `role` claim is `anon`.

Distinctness from staging is independently established: production has 183 public tables / 58 migrations / 352 vehicles; `vehicle_listing_summaries` exists in production and **does not exist** in staging.

## Verdict: **FAIL** — one live breach, two loaded surfaces

### Live breach — `public.vehicles`

```
GET /rest/v1/vehicles?select=*&limit=1   ->  HTTP 206
content-range: 0-0/352        columns visible: 45
```

**352 real customer rows**, every column, to anyone holding the anon key — including
`owner_id`, `current_seller_id`, `plate_number`, `chassis_number`, `engine_number`,
`normalized_plate_number`, `tenant_id`.

Two release invariants are defeated below the application: unpublished listings are readable, and the five identifiers the passport withholds as "Not shown publicly" are handed over.

### Loaded but not leaking — `vehicle_evidence`, `vehicle_listing_summaries`

Both grant anon SELECT (54 and 34 columns) and both carry an admitting policy, but both hold **0 rows** in production today. The grant is a surface awaiting data.

`vehicle_listing_summaries` is a **new finding** (created by `20260603132036_marketplace_listing_summary_infra.sql`). Its ACL is `anon=arwdDxtm` — *all* privileges, not the `SELECT` the migration granted; the extra rights came from the `pg_default_acl` rule. It is dormant: nothing in the codebase writes to it. **Not in scope for #176** — tracked for the follow-up DB lane.

## Why only `vehicles` is live

Dozens of public tables carry a stray anon SELECT grant, but RLS is enabled and **no policy admits anon**, so they return `200` with zero rows. Probed directly: `users` (29 rows) → 0 rows; `safepay_escrows` (468 rows) → 0 rows.

`vehicles` is the exception — it pairs the grant with `vehicles_public_read USING (true)` for role `public`. **Grant + permissive policy** is what makes a surface live. RLS is row security; it is not a column contract.

## Control — the probe can observe a denial

| Control table (no anon grant) | Result |
|---|---|
| `ocr_documents` | HTTP 401 · SQLSTATE **42501** · "permission denied for table ocr_documents" |
| `user_sessions` | HTTP 401 · SQLSTATE **42501** |
| `trust_audit_events` | HTTP 401 · SQLSTATE **42501** |

A denial is therefore distinguishable from an empty result. An all-zero answer is never accepted as success on its own.

## Indirect surfaces — clean

| Check | Result |
|---|---|
| Views / materialized views over either table | **none** |
| Functions / RPCs referencing either table | **none** |
| SECURITY DEFINER + anon/PUBLIC EXECUTE | **none** |
| Table ownership | both `postgres`; no ownership-inherited access |

## Permanent gate — baseline captured

The gate in `backend/tests/db-anon-grant-posture.test.js` was run **live against production**:

```
static half : 6 pass / 0 fail
live half   : 0 pass / 9 fail      <-- correct pre-migration baseline
```

It fails closed and refuses to grade green while the exposure stands. Post-migration all 15 must pass; the control turning `42501` is what proves the revoke took effect rather than the table merely being empty.

## Correction to the record

An earlier revision of the `vehicle_evidence` migration header claimed the anon key "ships in the browser bundle and is therefore held by everyone". **That was never measured and is false for the deployed builds.** The `carup` Vercel project defines no `VITE_*` variables, Vite inlines only `VITE_`-prefixed values, and the sole browser Supabase client is tree-shaken out because nothing imports `useVehicles`. Both deployed bundles were fetched and scanned: no project ref, no JWT in either.

This narrows *likelihood*, not the defect. An anon key is a publishable credential by design — it lives in dashboards, CI and local `.env` files, and one future build with `VITE_SUPABASE_ANON_KEY` set would publish it to every visitor. Anyone holding it reads all 45 columns of all 352 rows today.
