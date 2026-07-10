# Phase 7C — Staging Acceptance Report

**Date:** 2026-06-19  
**PR:** #72 (phase-7c-native-verification-production-loop)  
**SHA:** `c26763503899a33848dad71837561a98032c14d4`  
**Staging Backend:** `carup-backend-staging-git-phase-7c-nati-bb2612-pay-pass-project.vercel.app`  
**Staging Supabase:** `eoyenigwevnxwwhyhaer`  

## Gate 1 — Automated Staging Acceptance: PASSED

| Metric | Value |
|--------|-------|
| Total tests | 26 |
| Pass | **26** |
| Fail | **0** |
| Skip | 0 |

### Scenario Results

| # | Scenario | Tests | Result |
|---|----------|-------|--------|
| 1 | Cup/non-document containment | 6 | **PASS** |
| 2 | Request resubmission | 6 | **PASS** |
| 3 | Idempotency and stale-version conflict | 4 | **PASS** |
| 4 | Authorization (401/403/admin) | 3 | **PASS** |
| 5 | Controlled valid-document policy path | 7 | **PASS** |

### Staging Verification Session IDs

| Purpose | Session ID |
|---------|-----------|
| Scenario 1 (cup containment) → Scenario 2 (resubmission) | `47222441-3dd6-4941-96a6-ed545d1b2865` |
| Scenario 3 (idempotency) | `1809b856-9d47-461d-b1da-49dc6cf98e80` |
| Scenario 5 (policy path) | `2f16c10a-a67f-4a26-9e05-4f187b0c5420` |

### Decision IDs

| Session | Decision ID | Action |
|---------|------------|--------|
| `47222441-...` | `dec_24a1c1099ec5405a` | `request_resubmission` |

### Automated Suite Totals

| Suite | Result |
|-------|--------|
| Backend (this report) | 26/26 pass, 0 fail (Gate 1 scenarios only) |
| Full backend test suite | 499 total, 492 pass, 0 fail, 7 skip (pre-existing) |
| Web vitest | 119/119 |
| Web TS build | Pass |
| Web production build | Pass |
| Mobile vitest | 18/18 |
| Mobile TS build | Pass |
| Mobile Expo iOS export | Pass |
| All Vercel checks | 4/4 green |

### Limitations

1. **Gemini API key not configured in staging** — all document classification falls back to `uncertain`/`DOCUMENT_TOO_SMALL`, which correctly prevents approval by policy. Scenario 5g validates this policy works.
2. **Audit event IDs** not returned in review API response; recorded in `trust_audit_events` table (verifiable via direct DB query). Decision record includes `audit_event_type` as proof.
3. **Before/after row counts** require service-role key which is encrypted at the Vercel project level and accessible only at runtime by the Supabase integration; not exposed via `vercel env pull`.

## Recommendation

**PROCEED** to Gate 2 (owner mobile smoke test).  

All five acceptance scenarios pass. All automated suites remain green. No release blockers identified.
