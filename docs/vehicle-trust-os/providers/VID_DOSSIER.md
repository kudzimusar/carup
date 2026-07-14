# VID Provider Dossier — Government Source Activation

Source key: `vid` · Capability: `government_source` · Jurisdiction: `ZW`
Registry: VID (Vehicle Inspection / Roadworthiness)

> Honesty note: records only codebase-verified facts + labelled UNKNOWNs. No invented
> endpoints, credentials, permissions, or provider facts.

## Purpose (§79 minimum semantics)
Confirm inspection/fitness status, test/expiry dates, result category, and identity mismatch.

## Verified transport options (engine-supported)
- `simulator` / sandbox — IMPLEMENTED and tested.
- `secure_batch_file` — engine-ready (append-only imports ledger, Storage path only).
- `official_api` / `partner_api` — STUB only; `unavailable`/`credential_pending` in
  `live`/`pilot_live` until wired. No endpoint assumed.
- Preferred real transport: UNKNOWN — requires provider confirmation.

## Required agreements / identifiers
- Data-sharing agreement with VID: UNKNOWN — requires provider confirmation.
- Required query identifiers: `vin`.
- Credential reference: env-key NAME only; actual credential UNKNOWN — requires provider confirmation.

## Expected fields (privileged unless marked buyer-safe)
`inspection_status`*, `inspection_date`*, `expiry_date`*, `result_category`*,
`certificate_serial`, `odometer_reading`. Map: `GOVERNMENT_FIELD_MAPS.vid`.

## Privacy / legal constraints
- `certificate_serial` and raw `odometer_reading` are privileged-only (odometer feeds the
  fraud engine's mileage checks; it is not a buyer-facing field here).
- Buyer/partner projection exposes only inspection status, dates, and result category.
- Sandbox/partner/manual results are honestly labelled; never a live VID confirmation.
- Permitted-use terms: UNKNOWN — requires provider confirmation.

## Contacts
- Integration contact: UNKNOWN — requires provider confirmation.
- Legal / data-sharing authority: UNKNOWN — requires provider confirmation.

## Unresolved questions (external gates)
1. Sanctioned channel (API vs batch) and how certificates are keyed (VIN vs certificate serial).
2. Formal agreement + permitted-use scope.
3. Whether odometer-at-inspection may be shared and under what constraints.
4. Credential issuance + rotation and environment key name.

## Completion classification
**ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED** — check path, §79 map, honest persistence,
fraud/review feed (including odometer signals), buyer/partner projection, and operator controls
implemented and sandbox-tested; live activation gated on a signed VID agreement (then a
credential). Live transport fails closed until wired.
