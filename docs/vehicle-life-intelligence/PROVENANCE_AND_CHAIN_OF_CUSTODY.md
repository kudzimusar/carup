# Provenance & Chain of Custody (Milestone 1)

Implements master plan §5 (Phase 4): make evidence traceable, tamper-evident, and
source-aware. Backed by migration `20260621120000_*` and the services in
`backend/services/evidence/`.

## Source registry (`evidence_sources`)

A governed catalog of where evidence comes from (master plan §5.2). Columns include
`source_type`, `organization`, `country`, `verification_status`, `trust_tier`,
`legal_basis`, `permitted_evidence_classes[]`, `adapter_id`, `active`, plus **restricted**
`contact_reference` / `credential_reference`.

- The base table is RLS-protected and revoked from `anon`/`authenticated`.
- A public view `evidence_sources_public` and `sourceRegistryService.toPublicSource()`
  expose only the allowlisted summary — restricted credentials can never leak (master plan §2.4, §5.6).
- `sourcePermitsClass()` enforces that a source may only supply its permitted classes.

**Seeded sources:** `owner_upload` and `dealer_upload` are `verified` first-party sources.
`inspection_centre`, `jp_auction_sandbox`, and `government_registry_sandbox` are seeded as
**`unverified` sandbox** entries — they are NOT live and are clearly marked as fixtures/
pending legal agreement (master plan §2.6). Backfill links existing owner/dealer evidence to
the matching source.

## Provenance fields on `vehicle_evidence`

Added by M1 (master plan §5.3): `source_id`, `source_record_id`, `received_at`,
`perceptual_hash`, `checksum_algorithm`, `original_asset_id` (parent for transformed assets),
`evidence_set_id`, `event_date` + `event_date_precision`, `capture_country`,
`odometer_value`/`odometer_unit`, `component_tags[]`, `declared_condition`, `retention_class`.
The pre-existing SHA-256 `checksum` is retained and now annotated with `checksum_algorithm`.

### Integrity controls (master plan §5.4)

- **Cryptographic checksum:** SHA-256 (`checksumForBuffer`), unchanged.
- **Perceptual hash:** dHash abstraction in `perceptualHash.js`. PNG is decoded and a real
  64-bit dHash is produced; formats without an available decoder return
  `{ supported: false }` rather than a fabricated hash (honest capability — master plan §2.6).
  `hammingDistance()` / `isNearDuplicate()` provide the near-duplicate hook for M2/M3.
- **Versioned corrections, not destructive overwrite:** corrections are modeled as new
  records/events; the provenance log is append-only.

## Chain-of-custody events (`evidence_provenance_events`)

Immutable, **hash-chained** log (master plan §5.5). Each event stores `sequence`,
`event_type`, actor (`actor_user_id`/`actor_role`/`actor_type`), `source_route`, `request_id`,
`ip_address`, `details`, `content_hash`, and `prev_hash`.

- `content_hash` = SHA-256 over the canonical event payload (excludes the DB timestamp so it
  is reproducible). `prev_hash` links to the previous event for the same evidence id.
- **Tamper-evidence:** `verifyProvenanceChain()` recomputes every hash and checks linkage;
  any edit breaks the chain. Defence in depth: DB triggers (`carup_provenance_block_mutation`)
  reject UPDATE/DELETE so the log is append-only at the database level.
- Tracked event types: created, uploaded, imported, validated, transformed, ai_requested,
  ai_completed, ai_failed, reviewer_opened, approved, rejected, requested_more_info,
  published, unpublished, disputed, resolved, corrected, superseded, retention_hold, deleted.

The upload flow records an `uploaded` event best-effort (`recordEvidenceUploadProvenance`) —
provenance is recorded, never gating (a provenance write failure must not block evidence capture).

## Privacy of provenance (master plan §5.6)

`GET /api/vehicles/:vin/evidence/:id/provenance` is role-scoped: admin/government/reviewer
see full events; everyone else receives `toPublicProvenanceSummary()` (event type, role,
timestamp, sequence — **no IP addresses, no raw actor IDs, no content hashes**).
