# Vehicle Trust OS — Production Smoke Checklist

Run AFTER migrations applied + PR #103 merged + deployments healthy on `vhmnajoeicasaigiophh`.
Use **labelled production-safe** fixtures only (e.g. VIN prefix `SMOKE-`); clean up or clearly
label. Do not use real customer data. Government/registry items are labelled synthetic — NOT live
official confirmations.

## Pre-smoke
- [ ] Backend `/api/health` returns healthy (Supabase reachable, OCR provider status reported).
- [ ] Frontend loads; `VITE_API_URL` points at the production backend.
- [ ] Migration ledger shows all ten applied; verification (tables/RLS/policies/grants/functions/
      indexes/triggers) green.

## Labelled production-safe smoke tests
1. [ ] **Seller draft vehicle** — create a `SMOKE-` vehicle; `publication_status='draft'`.
2. [ ] **Identity fields** — set VIN/chassis/engine/plate (or temp-ID); persisted + readable.
3. [ ] **Evidence upload** — upload one labelled evidence item; stored with provenance `uploaded`.
4. [ ] **OCR extraction** — run extraction; rows in `vehicle_document_extractions` with match_status.
5. [ ] **Mismatch review** — produce one deliberate mismatch → routes to a review task (not auto-accepted).
6. [ ] **Admin approve/reject** — reviewer decision recorded in `review_decisions` + `trust_audit_events`.
7. [ ] **Listing publication gate** — vehicle cannot publish until policy passes; then publishes.
8. [ ] **Marketplace trust display** — public card shows only verified/public-safe claims (no restricted/pending leak).
9. [ ] **Buyer trust explanation** — buyer view shows itemized, evidence-linked explanation + limitations.
10. [ ] **Ownership continuity** — transfer ownership + relist same VIN; prior passport history preserved.
11. [ ] **Audit creation** — each consequential action writes an audit event (none lost).
12. [ ] **Role & tenant isolation** — non-privileged user cannot read restricted tables; cross-tenant returns nothing.

## STOP immediately (declare NOT READY — VEHICLE TRUST BLOCKERS REMAIN) if any:
- [ ] Wrong-VIN evidence attachment
- [ ] Private/restricted evidence exposed publicly
- [ ] Cross-tenant access possible
- [ ] Incomplete vehicle shown as "verified"/clean
- [ ] Unsupported official-government claim surfaced as confirmed
- [ ] Lost/missing audit event for a consequential action
- [ ] Repeated production 5xx
- [ ] Failed migration or deployment

## Result (record one)
- `VEHICLE TRUST OS MVP LIVE — PRODUCTION SMOKE GREEN`
- `NOT READY — VEHICLE TRUST BLOCKERS REMAIN`

Record: operator, timestamps, fixture VINs used + cleanup, links to logs/audit events.
