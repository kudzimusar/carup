# Source Partner Onboarding (Milestone 2)

How to add a new external evidence source (auction, importer/shipping, inspection centre,
dealer/marketplace, insurer/repair, government registry) to CarUp's ingestion framework.
Implements master plan §6.3 / §6.6.

## Architecture recap

```
provider (adapter)  ──fetchPage→ raw records ──mapRecord→ normalized ──validateRecord→ ok?
        │                                                                      │
        └─ downloadAsset(ref) → bytes                                          ▼
ingestionService.runIngestionJob:  idempotency → quarantine → identity resolution
        → listing snapshot (immutable) → import assets as evidence (+provenance)
        → ingestion_jobs status (succeeded/partial/failed_retryable/dead_letter)
```

Tables: `ingestion_jobs`, `source_records`, `vehicle_identity_candidates`, `listing_snapshots`
(migration `20260621130000_external_source_ingestion.sql`); evidence + provenance reuse M1.

## Steps to onboard a new source

1. **Register the source** in `evidence_sources` (M1) with `code`, `source_type`, `country`,
   `permitted_evidence_classes`, `legal_basis`, and `verification_status='unverified'` until a
   data-sharing agreement exists.
2. **Implement the adapter** under `backend/services/ingestion/adapters/` satisfying the
   `sourceProvider` interface: `id`, `sourceCode`, `mode`, `fetchPage`, `mapRecord`,
   `validateRecord`, `downloadAsset`. Use `sandboxJpAuctionAdapter.js` as the template.
3. **Set `mode` honestly:** `fixture` (synthetic), `sandbox` (provider sandbox env), or `live`
   (real production API). **Never set `live` until credentials + contract verification pass.**
4. **Register** the adapter in `registerAdapters.js`.
5. **Add contract tests** (see `ingestion-framework.test.js`): idempotency, quarantine on
   invalid records, identity routing (auto-link vs review), provenance on import.
6. **Configure secrets** for live mode via environment (never in the repo); document required
   env keys in the adapter header.
7. **Document the external blocker** if the real API/credentials/legal agreement is unavailable
   — keep the adapter in fixture/sandbox mode and continue all independent work (master plan §2.6).

## Identity resolution policy (master plan §6.4)

- Auto-link only at confidence ≥ `AUTO_LINK_THRESHOLD` (0.9): VIN (0.99) or chassis (0.92).
- Plate (0.7), source vehicle id (0.75), auction lot (0.6), make/model/year (0.3) → **review**.
- Conflicting VINs always → review. Ambiguous matches enter `vehicle_identity_candidates`
  (the human queue) and are **never silently attached**.

## Operational notes

- Re-running an import is **idempotent** per `(source_id, source_record_id)` + content hash.
- Invalid records are **quarantined** with a reason; they never fail the whole batch.
- Listing captures are **immutable + versioned** (append-only; DB trigger enforced).
- Imported evidence is created `verification_status='pending'`, `visibility_level='restricted'`
  — it requires governed review (M5) before it can become public.
- Jobs retry with backoff and move to `dead_letter` after `max_attempts`.

## Current status of seeded sources

| code | type | mode / status |
|---|---|---|
| owner_upload | owner | verified (first-party) |
| dealer_upload | dealer | verified (first-party) |
| inspection_centre | inspector | **sandbox / unverified** (partner agreement pending) |
| jp_auction_sandbox | auction | **fixture** (adapter implemented; no live API) |
| government_registry_sandbox | government | **sandbox / unverified** (legal agreement pending) |

**No external provider is live.** The `sandbox_jp_auction` adapter is contract-complete and
fixture-backed to prove the end-to-end path; promoting it to live requires the real API +
credentials + a signed data agreement (external blocker — master plan §6.6).
