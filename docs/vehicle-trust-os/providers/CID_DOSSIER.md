# CID Provider Dossier — Government Source Activation

Source key: `cid` · Capability: `government_source` · Jurisdiction: `ZW`
Registry: CID (Police Clearance / Stolen & Reported-Interest Check)

> Honesty note: records only codebase-verified facts + labelled UNKNOWNs. No invented
> endpoints, credentials, permissions, or provider facts. CID is the most access-restricted
> source; nothing here should be read as an existing police authorization.

## Purpose (§80 minimum semantics)
Confirm stolen / reported-interest status, query time, a permitted reference, and confidence,
with STRICT access logging.

## Verified transport options (engine-supported)
- `simulator` / sandbox — IMPLEMENTED and tested.
- `secure_batch_file` — engine-ready (append-only imports ledger, Storage path only).
- `official_api` / `signed_webhook` / `manual_verification` — STUB / manual only; live/pilot
  returns `unavailable`/`credential_pending` until wired. No endpoint assumed.
- Preferred real transport: UNKNOWN — requires provider confirmation. A controlled
  manual-verification or tightly-scoped query channel is the most likely sanctioned path.

## Required agreements / identifiers
- Formal police data-sharing agreement + authorized-user controls: UNKNOWN — requires provider
  confirmation. This is a hard external gate; CID access is legally sensitive.
- Required query identifiers: `vin`, `chassis`, `engine`.
- Credential reference: env-key NAME only; actual credential UNKNOWN — requires provider confirmation.

## Expected fields (privileged unless marked buyer-safe)
`stolen_check_status`, `stolen_status_category`* (derived: cleared/flagged/unknown),
`clearance_ref_number`, `chassis_verified`, `engine_number_verified`, `interpol_queried`,
`case_reference`, `queried_at`*. Map: `GOVERNMENT_FIELD_MAPS.cid`.

## Privacy / legal constraints (strict)
- Buyers see ONLY a coarse `stolen_status_category` + `queried_at`. `clearance_ref_number`,
  `case_reference`, and per-identifier verification booleans are NEVER buyer-facing.
- STRICT ACCESS LOGGING: every check — including denials — writes an APPEND-ONLY
  `provider_request_attempts` row (correlation id + VIN + outcome). This is the audit trail
  required for CID access and is enforced by the governed execution path.
- A high_risk (flagged-stolen) result is a hard stop: it feeds the fraud engine's
  `cid_high_risk` critical detector and blocks publication.
- Sandbox/manual results are honestly labelled; never a live police confirmation.
- Permitted-use, authorized-officer, and retention terms: UNKNOWN — requires provider confirmation.

## Contacts
- Police integration / liaison: UNKNOWN — requires provider confirmation.
- Legal / data-sharing + access-authorization authority: UNKNOWN — requires provider confirmation.

## Unresolved questions (external gates)
1. Legally sanctioned channel and whether automated queries are permitted at all vs manual.
2. Authorized-user model (who may trigger a CID check) and mandated audit retention.
3. Which references may be surfaced, and to whom, without compromising an investigation.
4. Credential issuance + rotation and environment key name.

## Completion classification
**ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED** — check path, §80 map, honest persistence,
critical fraud/publication-block feed, strict append-only access logging, buyer/partner
projection (references stripped), and operator controls implemented and sandbox-tested; live
activation gated on a signed police data-sharing agreement with authorized-user controls (then a
credential). Live transport fails closed until wired.
