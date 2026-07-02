# Vehicle Trust OS — Remaining Key Features Roadmap

As of `integration/vehicle-trust-os-product-activation` (from release `3fb1650`), 2026-06-25.

## A. Required BEFORE MVP production release
1. **Rotate + sanitize committed production DB credentials** (deferred Gate-15 blocker) — rotate the
   `vhmnajoeicasaigiophh` password; replace hardcoded connection strings in the 28 scripts with env
   vars; re-run secret scan to 0. **Hard production-cutover blocker.**
2. **Staging deploy + interactive UAT** (Phase 19 script) on `eoyenigwevnxwwhyhaer` — operator with
   Vercel deploy access; all 15 UAT steps green; Playwright critical journey green.
3. **Seller-onboarding completeness panel** — surface required/present/missing/rejected/awaiting
   documents + completeness % + explicit publication-blocked reasons in `SellVehicle` (backend
   `completenessEvaluator` exists; wire the UI).
4. **Mobile sensitive-state test** — automated unit test for logout clearing the verification store
   (needs RN/jest harness).

## B. Required IMMEDIATELY AFTER MVP release
1. **Web marketplace admin moderation UI** — expose existing `/admin/marketplace/...` actions
   (approve/reject/suppress/request-evidence) in the admin console.
2. **Mobile seller/dealer vehicle creation** + document capture-to-evidence (beyond KYC) + missing-
   document checklist + publication status screen.
3. **Persistent mobile offline upload queue** — durable retry (currently in-memory only).
4. **Per-field OCR correction (amend) flow** end-to-end with the immutable-content + new-row pattern
   surfaced in the UI.

## C. Later platform expansion
1. Buyer-facing PDF report export (privacy-safe, traceable).
2. Richer temporal/visual comparison UI (region highlights, before/after slider).
3. Cross-source corroboration scoring + source-diversity dashboards.
4. Reviewer analytics + SLA dashboards on review-queue age.
5. Distributed rate limiting / WAF activation (infra docs already drafted).

## D. External partner / API dependencies (cannot be "live" until contracted)
1. **Official Zimbabwe registries** — ZIMRA, CVR, ZINARA, VID, CID: real adapters + data-sharing
   agreements. Until then, UI must NOT claim live official verification (already enforced).
2. **Japanese auction / importer / shipping / insurer** ingestion adapters — currently sandbox/
   fixture only; require credentials + contracts.
3. **AI/OCR provider** production budget + consented evaluation set for live quality numbers.
4. **Monitoring/paging, Redis, Cloudflare, paid Supabase PITR** — infra accounts for production ops.
