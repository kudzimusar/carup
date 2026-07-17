# CVR Provider Dossier — Government Source Activation

Source key: `cvr` · Capability: `government_source` · Jurisdiction: `ZW`
Registry: Central Vehicle Registry (Registration & Ownership)

> Honesty note: records only codebase-verified facts + labelled UNKNOWNs. No invented
> endpoints, credentials, permissions, or provider facts.

## Purpose (§77 minimum semantics)
Confirm registration status, registered identity, and a privacy-safe
ownership-verification state — WITHOUT exposing owner identity.

## Verified transport options (engine-supported)
- `simulator` / sandbox — IMPLEMENTED and tested.
- `secure_batch_file` — engine-ready (append-only imports ledger, Storage path only).
- `official_api` / `partner_api` — STUB only; returns `unavailable`/`credential_pending`
  in `live`/`pilot_live` until wired. No endpoint assumed.
- Preferred real transport: UNKNOWN — requires provider confirmation.

## Required agreements / identifiers
- Data-sharing agreement with the CVR: UNKNOWN — requires provider confirmation.
- Required query identifiers: `vin`, `plate`.
- Credential reference: env-key NAME only; actual credential UNKNOWN — requires provider confirmation.

## Expected fields (privileged unless marked buyer-safe)
`registration_number`, `registration_status`*, `registered_make`*, `registered_model`*,
`registered_year`*, `ownership_verified`, `ownership_verification_state`* (derived),
`logbook_serial`. Map: `GOVERNMENT_FIELD_MAPS.cvr`.

## Privacy / legal constraints
- Owner identity is NEVER returned. Ownership is exposed only as a derived state:
  `verified` / `unverified` / `unknown`.
- `registration_number` and `logbook_serial` are privileged-only (never buyer-facing).
- Sandbox/partner/manual results are honestly labelled; never presented as a live CVR
  confirmation.
- Permitted-use / privacy terms for registration + ownership data: UNKNOWN — requires
  provider confirmation (owner PII handling is likely tightly restricted).

## Contacts
- Integration contact: UNKNOWN — requires provider confirmation.
- Data-protection / legal authority: UNKNOWN — requires provider confirmation.

## Unresolved questions (external gates)
1. Sanctioned channel (API vs batch) and whether ownership can be returned even as a boolean.
2. Formal agreement + permitted-use scope for registration/ownership data.
3. Exact privacy constraints on any owner-derived field.
4. Credential issuance + rotation and environment key name.

## Completion classification
**ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED** — check path, §77 map (with privacy-safe
ownership state), honest persistence, fraud/review feed, buyer/partner projection, and operator
controls implemented and sandbox-tested; live activation gated on a signed CVR agreement (then a
credential). Live transport fails closed until wired.
