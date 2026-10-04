# CarUp hash-chained audit ledger

**Programme:** One CarUp, OC-3D (ledger and evidence hardening; source and PGlite only)
**Status:** source on branch `feat/oc-3d-ledger-hardening-offline`. Nothing in this document has been applied to any live database.

## 1. What it is, in truthful terms (4A)

CarUp keeps a **hash-chained audit ledger**: the table `blockchain_events`, which keeps its historical name for compatibility.

It is **not a blockchain**. There is no external party, no consensus, no replication, and no government chain. The database owner can rewrite rows.

What it provides is **tamper evidence**:

- Every event carries the hash of the event before it.
- Every event carries a signature:
  - a system HMAC under a server secret, or
  - a custodial stakeholder ECDSA signature.
- `verifyChain` recomputes the whole chain **from genesis**, using the hash scheme each event was written with, and classifies every signature.

**Rule of authority:** the ledger *records* decisions made by domain authorities (Identity, Trust, ownership, publication, payments, registry). It never *makes* one. Nothing reads a ledger row as permission to act.

Compatibility names that stay: the `blockchain_events` table, the `services/blockchain/` directory, the `CARUP_BLOCKCHAIN_*` environment variables. Renaming them would break migrations, custody keys and deployments for no gain in truth. User-facing text says "hash-chained audit ledger" and "tamper-evident", never "blockchain", "immutable" or "append-only" (append-only is not enforced until the §3 candidate is applied).

## 2. What changed in OC-3D

| Item | Before | After |
|---|---|---|
| **4C** Checkpoint | A **trust root**. If the mutable checkpoint row agreed with the event it named, everything before it was skipped. | A **witness**. The chain is always verified from genesis. A checkpoint naming a missing event, or disagreeing with recomputed history, breaks the chain. |
| **4D** Serialization | v1 hashed `JSON.stringify` (insertion order); JSONB re-orders keys. | One primitive, `ledgerCanonicalSerialization.canonicalSerialize`: keys sorted by UTF-16 code units (RFC 8785 order), JSON-persistence normalization. Used to write **and** verify. |
| **4E** Hash scheme | v1: `sha256(prev + vin + type + ts + JSON)`. Field boundaries can shift; payload key order matters. | v2: `'v2:' + sha256('carup.ledger.event.v2\n' + canonical({previous_hash, vin, event_type, timestamp, payload}))`. v1 rows are verified exactly as written and never reinterpreted. New events are v2 only once `CARUP_LEDGER_HASH_VERSION=2` is set by the staged rollout. Chains may run v1 then v2. |
| **4H** Signatures | Checked only when shaped `signer:proof`. A `SYSTEM_SIGNATURE` placeholder or any colon-less token passed silently. | Per event `signature_status`: `verified`, `absent`, `legacy_unverified` or `invalid`. `invalid` breaks the chain, and so does a v2 event without `verified`. The report says `authenticated` only when every event verified. |
| **4I** Evidence provenance | Writer hashed insertion order; JSONB re-ordered `details`. The shipped verifier called **untouched** history `content_hash_mismatch` (reproduced on the real schema). | Writer and verifier share the canonical primitive (`v2:` content hash). A v1 row that cannot be reproduced is `legacy_hash_unverifiable`: neither tampered nor valid. |
| **4J** Writers | `addEvent` plus the diaspora ownership handoff, each building the envelope. | One boundary, `addEvent`. Domain code submits `{ vin, eventType, payload, client?, signerId? }`, and a source contract pins it. |

**What a "signature" proves:**

- **System HMAC:** the CarUp server, holding `CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET`, produced this hash.
- **Stakeholder ECDSA:** the keys are derived server-side, so the signature proves the **server** signed for that stakeholder. It does not prove the stakeholder did, so it gives no non-repudiation.
- **Placeholders and tokens:** a `SYSTEM_SIGNATURE` placeholder, an opaque token, or a signer with no public-key history is **not a signature** (`legacy_unverified`).

The UI reflects this. PartSentry shows "Ledger Verified" only when the chain is intact **and** authenticated. An intact but unauthenticated chain reads "Hash chain intact — signatures unverified".

## 3. Append-only enforcement: candidates, not applied (4F)

`database/migration-candidates/oc3d/` is outside `database/migrations`, so no runner or workflow picks it up. It is proven in PGlite on the repository's own schema (`backend/tests/oc3d-ledger-append-only-candidates.test.js`).

- **`20261004130000_oc3d_ledger_append_only.sql`**
  - Row `BEFORE UPDATE`/`DELETE` triggers and a statement `BEFORE TRUNCATE` trigger on `blockchain_events`.
  - A `TRUNCATE` trigger on `evidence_provenance_events`, which already refused row UPDATE/DELETE.
  - Revokes UPDATE/DELETE/TRUNCATE from `anon`, `authenticated` and `service_role`.
  - Adds a `NOT VALID` hash-shape check (v1 or v2) for new rows.
  - Its Down section deliberately does **not** re-grant write access.
- **`20261004130100_oc3d_ledger_fork_guard_and_retention.sql`**
  - Adds a unique `(vin, previous_hash)` constraint. Both writers read the tail, then insert; concurrent writers forked chains into a permanently "broken" state. The candidate **refuses** to run over an already-forked ledger.
  - Changes the ledger and provenance foreign keys from `ON DELETE CASCADE` to `RESTRICT`.

**Limitation, proven not assumed.** These bind the application roles. The table owner or a superuser can still bypass triggers (for example with `session_replication_role = replica`). Database ownership is not cryptographic immutability. What survives that bypass is the tamper **evidence** above.

The SQLite-era triggers in `004_add_tamper_proofing.sql` never protected PostgreSQL; they do not even parse there.

## 4. Deletion policy (4G)

| Path | Effect on history | Classification |
|---|---|---|
| `blockchain_events.vin → vehicles ON DELETE CASCADE` | Deleting a vehicle erased its audit history, which then read as "empty". | **RESTRICT REQUIRED.** Candidate implemented. |
| `evidence_provenance_events.evidence_id → vehicle_evidence ON DELETE CASCADE` | Already blocked de facto: the row triggers refuse the cascaded delete. | **RESTRICT REQUIRED.** Candidate makes the FK say so. |
| Physical deletion of `vehicle_evidence` / `vehicles` that carry history | Would erase evidence. | **SOFT-DELETION / TOMBSTONE REQUIRED.** Provenance already models `deleted` / `superseded` events. |
| `rolling_integrity_checkpoints.vin → vehicles ON DELETE CASCADE` | Removes a derived witness only, and is unreachable once the vehicle is RESTRICTed by its events. | **LEGITIMATE CASCADE** |
| `public_keys.user_id → users ON DELETE CASCADE` | Erasing a user erases the public-key history needed to verify that user's historical signatures, which become `legacy_unverified`. | **OWNER DECISION REQUIRED** (privacy erasure versus verifiability) |
| `goldenVehicleFixture` teardown deletes `blockchain_events`, `rolling_integrity_checkpoints`, `evidence_provenance_events` | Fixture cleanup on staging. It already collides with the provenance triggers and will collide with the ledger candidate. | **OWNER DECISION REQUIRED.** Retire fixture VINs, or a documented staging-only maintenance role. |
| `server.js` signup compensation `DELETE FROM users` | Removes a seconds-old row that has no history. | **LEGITIMATE** |

## 5. One audit direction (4K)

Audit stores are classified by role; this phase merges none of them. The rule: **domain-authority histories are never collapsed into a generic audit table.**

**Canonical future platform-audit primitive:** `auditLogger.logAuditEvent`, which writes `trust_audit_events` from 38 call sites despite the historical "trust" prefix. Security events stay separate. Domain authorities keep their own decision records. The hash-chained ledger records vehicle-lifecycle facts with tamper evidence.

| Store | Writer(s) (detected) | Classification |
|---|---|---|
| `trust_audit_events` | `auditLogger.logAuditEvent` (38 call sites), marketplace moderation | **Platform audit** (de facto canonical) |
| `organization_audit_logs` | `auditLogger` (organization path), `server.js` | **Platform audit** (tenant/organization-scoped) |
| `security_events` | trust enforcement engine | **Security audit** |
| `audit_logs` | No such table in repository migrations | Not present |
| `system_audit_logs`, `role_switch_logs`, `signature_verification_logs`, `gateway_integration_logs` | No runtime writer | **Legacy** |
| `blockchain_events` | `blockchainService.addEvent` only | **Domain history** (tamper-evident; records, never decides) |
| `evidence_provenance_events` | `provenanceService.recordProvenanceEvent` | **Evidence provenance** |
| `verification_decisions`, `review_decisions`, `trust_change_log`, `eligibility_decisions`, `finance_provider_decisions`, `insurance_provider_decisions`, `garage_application_decisions`, `dealer_compliance_decisions`, `dispute_events` | Their own domain services | **Domain authority** |
| `trust_score_history`, `vehicle_ownership_history`, `vehicle_plate_history`, `vehicle_ownership_transfer_events`, `diaspora_shipment_stage_events`, `diaspora_customs_events`, `escrow_trust_events`, `partsentry_logs`, `provider_activation_history`, `diaspora_stock_ledger` | Their own domain services | **Domain history** |
| `escrow_reconciliation_ledger` | Escrow provider service | **Domain authority** (financial reconciliation) |
| `financial_ledger` | No runtime writer | **Legacy** |
| `ai_inference_logs`, `navigation_analytics_events`, `marketplace_activity_events`, `referral_events`, `domain_events`, `outbox_events`, `webhook_logs`, `*_webhook_events` | Various | **Analytical / integration events** |

## 6. Rollout order (not performed here)

1. Read-only production audit: forks, hash shapes, signature forms, provider labels. This was not possible in OC-3D because production catalog access was unavailable.
2. Promote the candidates into `database/migrations` on an authorised staging lane, and run them on the restored staging database.
3. Set `CARUP_LEDGER_HASH_VERSION=2` on staging, then production, with the new code.
4. Decide the two owner items in §4.

There is no backfill: v1 history stays v1.
