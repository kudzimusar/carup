# CarUp Release Candidate 1 (RC1) Integration Matrix
**Phase 0 Read-Only Audit Report**

## 1. Release-Candidate Composition Recommendation

I recommend initializing `release/carup-v1-rc1` from current `main` (which now includes Navigation Intelligence), and integrating the open branches in the following order:

1. **Base:** Current `main`
2. **Spine:** PR #73 (`feature/marketplace-v1-production-integration`)
3. **Dependencies:**
   - PR #72 (`phase-7c-native-verification-production-loop`)
   - PR #11 (`codex/partsentry-public-card-approval-backend`)
   - PR #66 (`feature/mobile-registry-drawer`)
   - PR #58 (`codex/diaspora-shipment-read-scoping`)

## 2. Integration Matrix

| PR / Feature | Branch | Files / Areas Changed | Depends On | Conflicts With | Include / Port / Defer | Reason |
|---|---|---|---|---|---|---|
| **Current `main`** | `main` | Base application & Governance docs | N/A | N/A | **BASE** | Must be the base for `release/carup-v1-rc1`. Includes merged Navigation Intelligence. |
| **PR #73** | `feature/marketplace-v1-production-integration` | 93 files: Web UI, E2E tests, Backend APIs, Middlewares, Marketplace services, Auth contracts, Migrations/Seeds | `main` | Likely `main` (Navbar.tsx overlap), PR #11 (Trust governance), PR #72 (Auth/identity) | **INCLUDE** | Designated integration spine for Marketplace v1. Must be revalidated against latest `main`. |
| **PR #72** | `phase-7c-native-verification-production-loop` | 74 files: Identity services, Verification flows, Admin routes, Mobile UI, DB Migrations | Core Identity, `main` | PR #73 (shared types, `server.js` overlap) | **INCLUDE** | Required. PR #73 marketplace relies on the governed `passport_verified` state, which requires this review loop to prevent mock/invented identity verification. |
| **PR #11** | `codex/partsentry-public-card-approval-backend` | 12 files: PartSentry review routes, Trust governance, Marketplace summaries, Migrations | `main` | PR #73 (`server.js`, ListingSummaryService) | **INCLUDE** | Required. We must not display a public PartSentry claim without the governed write/approval workflow. PR #73 read-side suppression needs this backend logic. |
| **PR #66** | `feature/mobile-registry-drawer` | 2 files: `web/src/components/layout/Navbar.tsx`, `web/src/config/featureRegistry.ts` | `main` | PR #73 (`Navbar.tsx` modifications) | **INCLUDE** | Ensures canonical routes (`/marketplace/parts`, `/marketplace/services`) match the Registry and removes legacy links. Must resolve conflict with PR #73's Navbar changes. |
| **PR #58** | `codex/diaspora-shipment-read-scoping` | 3 files: Diaspora routes, services, tests | `main` | None | **INCLUDE** | Hardens read access. Necessary to ensure shipment details don't leak into Marketplace metadata (crucial cross-feature validation). |

## 3. Subsystem Overlap & Risk Analysis

- **Shared Configuration / Layout Overlaps:** 
  - `web/src/components/layout/Navbar.tsx` is modified by both PR #73 and PR #66. Conflict resolution must preserve both the registry-driven mobile drawer and the Marketplace v1 deep-links.
  - `web/src/config/featureRegistry.ts` is modified by both PR #73 and PR #66.
- **Backend Routing Overlaps:**
  - `backend/server.js` is modified by PR #73, PR #72, and PR #11. Route registration order must be preserved.
- **Data Models / Trust Flags:**
  - PR #73 consumes `passport_verified` and `partsentry_checked`.
  - PR #72 provides the real identity workflow for `passport_verified`.
  - PR #11 provides the real approval workflow for `partsentry_checked`.
  - *Risk:* Mock fallbacks in PR #73 must be stripped out in favor of the real governed flags introduced by PR #72 and PR #11.

## 4. Current State Observations

- **Features present only in previews:** The integrated Marketplace V1 UI, the Admin Verification Loop, PartSentry approvals, and Diaspora read-hardening exist only in their respective PR branches.
- **Features present on `main`:** Navigation Intelligence protocol and truth-first rendering constraints are merged.
- **Staging Mock Fallbacks:** PR #73 includes staging QA seeds (`marketplace_v1_staging_qa_seed.sql`). During Phase 3, we must ensure these are explicitly marked and distinct from any legacy visual placeholders or mock APIs.

---

**Next Action:** Awaiting Product Owner approval of this matrix. Once approved, I will begin Phase 1: creating `release/carup-v1-rc1` from `main` and reconciling PR #73 as the integration spine.
