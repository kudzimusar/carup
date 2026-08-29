# S3 — Marketplace and Communications Convergence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md` (amended by this phase — §2 below)

## 1. What S3 builds

Two consume-only seams: Marketplace → Service Case, and Service Case → Communications.

**Schema** — `20260901140000_service_network_s3_inquiry_target_garage.sql`: adds the nullable
`marketplace_inquiries.target_provider_tenant_id UUID` plus a partial index. This is the
smallest truthful answer to plan §10.2's question — *which garage tenant was this service request
directed to?* — which the schema could not answer at all: `createInquiry` populates
`seller_id`/`seller_tenant_id` only for vehicle-bound inquiry types, so every
`garage_service_request` landed with both NULL.

**Service** — `backend/services/serviceNetwork/serviceCaseBridgeService.js`:
`bridgeInquiryToServiceCase()` and `bindServiceCaseConversation()`.

## 2. Plan amendment — Communications workflow (evidence-based)

S0 froze `business_workflow='service'`. S3 **amends that on evidence** and reuses the existing
`garage` workflow instead. The canonical stakeholder contract already declares:

- `garage: { requiredRoles: ['vehicle_owner','garage'] }` — exactly the Service Case participants;
- `thread_type: 'general'`;
- an `emailStakeholderMatrix` row whose `identitySource` is literally
  **"work order participant -> channel_identities"**, with `transactional: true`,
  `fallback: 'in_app'`, `tenantRule: 'garage tenant scoping preserved'`.

It was defined for this interaction and has **no producer** on `main`. Adding a near-duplicate
`service` workflow would have created two competing conversation keys for one interaction —
precisely the drift the Pre-S0 reconnaissance flagged, and what Invariant 6 exists to prevent.
Cases stay unambiguous through the subject instead: `subject_type='service_case'`,
`subject_id=<case id>`, which the deterministic thread key
(`communications-2|workflow|tenant|subject_type|subject_id`) already separates. Consequently S3
adds **no** workflow, **no** contract entry and **no** matrix row, and the
`email-stakeholder-matrix` policy regression cannot fire. The S0 receipt carries this amendment
inline.

## 3. Authority decisions honoured

| Rule | How S3 satisfies it |
|---|---|
| Marketplace owns acquisition intent (Invariant 8) | The bridge only READS the inquiry; it never rewrites `status` (a lead pipeline is not a case lifecycle) — asserted by test |
| Never overload seller semantics for routing (§10.2) | Routing uses the new `target_provider_tenant_id`; tests assert `seller_id`/`seller_tenant_id` are untouched |
| Routing must be governed, not guessed | An inquiry with no target garage is **refused** rather than routed to a guessed garage |
| Idempotent bridge (§10.3) | Replay returns the same case (`created:false`); the DB unique index is the guarantee |
| Requester identity is not the operator | The case requester is the inquiry's `buyer_id`, not whoever ran the bridge |
| Source attribution is carried, not invented | Marketplace `source_channel` maps onto the case vocabulary; unmappable values become `unknown`, never a fabricated channel |
| Communications is canonical (Invariant 6) | Binding goes through the existing `ensureBusinessConversation`; no second messages table, no service silo |
| Communications failure ≠ case failure (§15.5) | Binding returns a recoverable receipt (`bound:false` + reason); tests assert the case row is byte-identical after a provider failure and after Communications being entirely absent |
| Legacy compatibility | The column is nullable and **no routing is backfilled**; pre-bridge service inquiries keep working as leads |

## 4. Verification — commands and results

| Gate | Command | Result |
|---|---|---|
| S3 migration proof (real PostgreSQL) | `node database/test/service_network_s3_check.mjs` | **PASS** — additive uuid/nullable column on the REAL inquiries table, legacy row keeps seller columns and gains no fabricated routing, non-UUID target refused (22P02), index proven genuinely partial, Down drops column+index while **preserving all lead rows**, re-Up idempotent |
| S3 convergence contracts | `node --test backend/tests/service-network-s3-bridge.test.js` | **PASS** — 11/11 |
| Full backend suite | `node --test backend/tests/*.test.js` | see §5 |

The migration proof is CI-wired via `backend/tests/service-network-s3-bridge-migration.test.js`.

## 5. Suite result

`node --test backend/tests/*.test.js` — **PASS**: 4398 tests, **4377 pass, 0 fail**, 21 skipped,
48 suites. S2 baseline was 4386/0 fail, so S3 adds 12 tests with **zero regressions**.

## 6. Deliberately NOT in S3

Service notification events (`§15.4`) are **not** subscribed yet: `communication-event-coverage.test.js`
requires an emitter and a subscription to land together, and the recipient-address enrichment gap
means policy-driven email/WhatsApp/push would dead-letter. S3 therefore delivers the conversation
binding only; notification mapping lands with the surfaces that need it. Provider activation remains
out of scope entirely (plan §35), and no test enqueues against staging Postgres (real-adapter hazard).

## 7. `[#194-sensitive]` items for the rebase

- `marketplaceInquiryService.createInquiry` is modified by #194 (metadata allowlist, `emitInquiryCreated`,
  4th deps arg) — populating `target_provider_tenant_id` at inquiry creation time must be added there
  after rebase rather than forked here.
- #194's `serviceIntelligenceService` reads `seller_*` as the service provider target; that reading
  conflicts with §10.2 and must be re-pointed at `target_provider_tenant_id` during the S0 re-run.
- `communicationEventListeners.js` and `communication-event-coverage.test.js` are rewritten by #194 —
  the deferred §15.4 subscriptions must be authored against the post-rebase form.
