# Vehicle Trust OS — Differentiated MVP Status (honest, per-workstream)

**Branch:** `integration/vehicle-trust-os-product-activation`
**Date (UTC):** 2026-06-26 · **PR:** #106 → `release/core-vehicle-trust-os-mvp`

This document states exactly what is **done + tested**, **partial**, **not started**, and
**blocked (external)**. It does not claim completion that was not built. The directive's
end state ("PRODUCTION SMOKE GREEN") is **not** reached this session — see the blockers.

## Legend
✅ done + automated tests · 🟡 partial · ⬜ not started this session · ⛔ blocked (external)

## Trust network core — built this session (the differentiator)

| WS | Capability | Status | Evidence |
|----|-----------|--------|----------|
| WS2 | ZIMRA/CVR/ZINARA/VID/CID source-verification network: common adapter contract (5 modes live/sandbox/partner_file/manual_verification/unavailable), 5 sandbox adapters w/ clean·mismatch·no_record·unavailable·high_risk fixtures, orchestrator w/ identity cross-check + fail-closed, append-only `source_verification_results` + public coverage view, routes | ✅ | 49 tests (40 service + 9 route); migration PGlite 12/12/12 |
| WS10 | Unified trust decision model: separate dimensions (identity, completeness, confidence, source coverage, source conflicts, fraud, dealer compliance, publication, insurance/finance/escrow eligibility, overall), transparent score (no flattering baseline, sandbox = 0), public projection strips private dims | ✅ | 10 tests (pure aggregation core) + route |
| WS2/10 | Buyer UI: `SourceCoveragePanel` on vehicle detail — per-registry honest status; sandbox shown as "Sandbox demo (not live)", never "confirmed" | ✅ | 7 web tests; tsc 0; vite build 0 |
| WS9 | Controlled Partner API v1: hashed credentials (key shown once), scopes, per-client rate limit, append-only request audit, redacted endpoints (identity/trust-summary/source-coverage/fraud-summary), admin portal, OpenAPI 3.0 spec | ✅ | 12 tests; migration PGlite 12/12/12 |
| WS13 | Differentiator journey integration (subset of the built layers): sources → unified decision → partner consumption; unavailable never becomes clear; not-built modules surface 'not_evaluated' | 🟡 | 2 integration tests (covers WS2+WS10+WS9; full 18-step journey needs the unbuilt workstreams) |
| WS11 | Migrations: `20260626120000_source_verification_network.sql`, `20260626130000_partner_api.sql` — marker-aware, RLS, append-only triggers, indexes | ✅ | PGlite 12/12 up·down·re-up; immutability + RLS-enabled + view-labelling asserts green |
| WS12 | Feature governance — source adapters fail-closed: enabled in staging/tests, **disabled in production** unless `SOURCE_VERIFICATION_LIVE=1` (+ per-provider `SOURCE_<P>_ENABLED`). Production cannot accidentally call sandbox providers | 🟡 | `sourceVerificationFlags` covered by adapter fail-closed tests; runtime DB-override/web-console registration for the new capability flags NOT wired this session |

## Product integration completed in earlier commits on this branch
| WS1 | Seller completeness panel (`VehicleCompletenessPanel`, 15 tests), OCR extraction-review UI, admin marketplace moderation (verified connected), mobile logout sensitive-state clear | ✅ | prior commits 65844e1, 2383d5c |

## Mandatory MVP parts NOT built this session (honest)

| WS | Capability | Status | Note |
|----|-----------|--------|------|
| WS3 | Duplicate/fraud consolidation engine + admin fraud queue | ⬜ | ~18 signals already exist scattered (fraudService, trustGraph odometer/plate, aiVision manipulation, similarity/perceptual-hash, disclosureConflict). No single orchestrator, no fraud-case table/queue/UI built this session. The WS10 fraud dimension currently derives only from source high-risk flags. |
| WS4 | Dealer compliance module (profile, checklist, separate statuses, controls) | ⬜ | No dealer profile entity today (only users.role='dealer' + organizations type='dealership'). Greenfield. |
| WS5 | Native offline document queue (durable, encrypted, idempotent, retry, logout cleanup) | ⬜ | Mobile upload is currently simulated; required RN libs (sqlite/mmkv/netinfo/filesystem) not installed. |
| WS6 | Insurance eligibility adapter (eligible/conditional/manual_review/not_eligible/unavailable + webhook) | ⬜ | Quote service exists (price only); no eligibility decision/adapter/webhook. |
| WS7 | Finance eligibility adapter | ⬜ | Affordability gate exists (approve/reject only); no conditional/manual/unavailable, no lender adapter/webhook. |
| WS8 | Escrow eligibility integration (gate escrow on trust) | ⬜ | Escrow state machine + payment webhook (HMAC+replay+idempotency) already exist; trust-gating + sandbox provider mode not wired. |

These are real, scoped, and have documented reuse points (see `PRODUCT_INTEGRATION_GAP_REPORT.md`
and the discovery notes in this PR). They are the next build waves.

## Blocked — external action required (cannot be completed by the agent)

| Blocker | Why | Recovery action |
|---------|-----|-----------------|
| ⛔ Apply the 2 new migrations to staging `eoyenigwevnxwwhyhaer` | claude.ai Supabase MCP returns "no permission" for the CarUp staging project (it only holds the prohibited `production-os` account). No `.env.staging` with a valid `SUPABASE_DB_URL` in this worktree; `SUPABASE_DB_PASSWORD` not in the agent shell. | Operator runs the staging-apply command in `PRODUCTION_CUTOVER_MANIFEST.md` (CLI is authenticated for both CarUp projects), OR authenticates the staging-scoped MCP via `claude /mcp`. Migrations are PGlite-verified (12/12/12). |
| ⛔ Staging deploy + interactive UAT (WS14) | The Express backend has no deploy pipeline configured in this environment; Vercel project not linked here. Interactive/Playwright UAT needs the deployed, seeded staging app. | Operator with Vercel deploy access deploys to staging and runs the UAT script in `STAGING_PRODUCT_UAT_REPORT.md`. |
| ⛔ Production cutover | Gate-15 committed production credentials remain (deferred, not remediated here); requires production DB password rotation + explicit authorization. | The single authorization gate in `PRODUCTION_CUTOVER_MANIFEST.md`. |

## Test totals (this branch, this session)
- New backend tests: **97** (source-verification 40, source-verification-routes 9, trust-decision 10, partner-api 12, trust-network-journey 2, audit-immutability 20, extraction-routes 4) — **97 pass, 0 fail, 0 skip**.
- Web: **337/337** vitest pass; `tsc --noEmit` exit 0; `vite build` exit 0.
- Migration harness: PGlite **12/12** up · **12/12** down · **12/12** re-up.
- Not run here (require live infra): backend integration suite (`run-tests.js`, needs seeded Supabase), Playwright E2E (needs deployed app).

## Final status
**VEHICLE TRUST OS DIFFERENTIATED MVP — PARTIAL: trust-network core (WS2/WS9/WS10) built,
tested, committed; fraud/dealer/mobile/insurance/finance/escrow not yet built; staging
apply + deploy + UAT + production cutover BLOCKED on external credential/deploy/authorization.**
