# Vehicle Passport / Trust Lifecycle 1.0 — Planning Baseline Receipt

**Date:** 2026-08-28  
**Decision:** PLAN RECORDED / RUNTIME NOT AUTHORIZED

## Planning-time live anchors

- main: ba208963d863654157335189c60f587cbe330041
- Post-Reunification plan PR #181: 857d672abbe64ae8ac3651d4d94c71fddca74aa2
- Marketplace / Seller runtime PR #182: abc11e9682a7140a9e3e60f995d9537ad4043b8a
- Communications / Email PR #183: 507530aadff17ec8aa4830d3cb392efda6876031
- Intelligence plan PR #184: 0ea51b58cb7c89286112546d8b3f588f157199fe
- Intelligence runtime PR #185: 0b9fa0304878b3d16210db55fb2a3f7f1261f65d
- Seller Journey docs PR #186: e251ab2f2caa4aa944277ccc67e0f665d77ce739

These anchors will become stale. They are evidence of what was reviewed while authoring the plan, not implementation bases.

## Existing contracts reviewed

Repository evidence reviewed while forming the plan included:

- docs/canonical-vehicle-truth/ADR-001-trust-authority.md
- docs/canonical-vehicle-truth/FACT_MODEL.md
- docs/canonical-vehicle-truth/MEDIA_EVIDENCE_CONTRACT.md
- docs/canonical-vehicle-truth/ADR-003-passport-lookup-policy.md
- docs/canonical-vehicle-truth/ISSUE164_PHASE8_SURFACE_CONVERGENCE.md
- docs/vehicle-trust-os/CORE_VEHICLE_TRUST_OS_MVP_RELEASE_PLAN.md
- docs/vehicle-trust-os/FINAL_COMPLETION_REPORT.md
- docs/vehicle-trust-os/REMAINING_KEY_FEATURES_ROADMAP.md
- docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md
- Seller Journey 1.0 plan at PR #186
- Marketplace Visual DNA at PR #182
- CarUp Intelligence canonical plan at PR #184
- Post-Reunification Product Advancement plan at PR #181

## Market benchmarks reviewed

Public/official product information was reviewed for:

- CARFAX Vehicle History / Car Care;
- carVertical;
- Experian AutoCheck;
- VINwiki;
- UK MOT / recall history;
- European Commission Digital Product Passport / Battery Passport;
- ZINARA;
- Zimbabwe VID;
- ZIMRA motor-vehicle customs-clearance due diligence.

See MARKET_BENCHMARK_AND_DIFFERENTIATION_MATRIX.md for the capability synthesis and source URLs.

## Architectural conclusion

The programme must be a **convergence/productization layer**, not a rebuild of Truth or Trust.

Protected relationship:

**Evidence / observations → Canonical Truth → Canonical Trust → Vehicle Passport → role-scoped actions**

The Passport is the durable vehicle experience. It is not the canonical source for facts already owned by domain records.

## Dependency conclusion

Seller Journey 1.0 is the immediate upstream programme.

Runtime activation of Vehicle Passport / Trust Lifecycle 1.0 must wait for:

1. accepted Seller Journey state or a live reconciliation that explicitly identifies what remains;
2. an allowed source-write lane;
3. a fresh V0 authority/schema/security gap inventory.

## Runtime status

**BLOCKED BY PROGRAMME SEQUENCING, intentionally.**

This is not a defect. The planning package exists now so future agents have a repository-owned manual and do not reconstruct the programme from chat history.
