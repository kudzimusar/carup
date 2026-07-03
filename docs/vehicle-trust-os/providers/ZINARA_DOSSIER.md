# ZINARA Provider Dossier — Government Source Activation

Source key: `zinara` · Capability: `government_source` · Jurisdiction: `ZW`
Registry: ZINARA (Road Licensing)

> Honesty note: records only codebase-verified facts + labelled UNKNOWNs. No invented
> endpoints, credentials, permissions, or provider facts.

## Purpose (§78 minimum semantics)
Confirm road-licence status, expiry, identity match, and the permitted status category.

## Verified transport options (engine-supported)
- `simulator` / sandbox — IMPLEMENTED and tested.
- `secure_batch_file` — engine-ready (append-only imports ledger, Storage path only).
- `official_api` / `partner_api` — STUB only; `unavailable`/`credential_pending` in
  `live`/`pilot_live` until wired. No endpoint assumed.
- Preferred real transport: UNKNOWN — requires provider confirmation.

## Required agreements / identifiers
- Data-sharing agreement with ZINARA: UNKNOWN — requires provider confirmation.
- Required query identifiers: `plate`, `vin`.
- Credential reference: env-key NAME only; actual credential UNKNOWN — requires provider confirmation.

## Expected fields (privileged unless marked buyer-safe)
`plate_number`, `licence_status`*, `licence_expiry`*, `status_category`*, `receipt_number`.
Map: `GOVERNMENT_FIELD_MAPS.zinara`.

## Privacy / legal constraints
- `receipt_number` is a permitted internal reference held privileged-only.
- Buyer/partner projection exposes only licence status, expiry, and status category.
- Sandbox/partner/manual results are honestly labelled; never a live ZINARA confirmation.
- Permitted-use terms: UNKNOWN — requires provider confirmation.

## Contacts
- Integration contact: UNKNOWN — requires provider confirmation.
- Legal / data-sharing authority: UNKNOWN — requires provider confirmation.

## Unresolved questions (external gates)
1. Sanctioned channel (API vs batch) and refresh cadence for licence status.
2. Formal agreement + permitted-use scope.
3. Which identifiers are accepted and how plate↔VIN matching is authorized.
4. Credential issuance + rotation and environment key name.

## Completion classification
**ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED** — check path, §78 map, honest persistence,
fraud/review feed, buyer/partner projection, and operator controls implemented and sandbox-tested;
live activation gated on a signed ZINARA agreement (then a credential). Live transport fails
closed until wired.
