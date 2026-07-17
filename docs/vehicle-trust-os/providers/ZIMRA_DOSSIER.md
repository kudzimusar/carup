# ZIMRA Provider Dossier — Government Source Activation

Source key: `zimra` · Capability: `government_source` · Jurisdiction: `ZW`
Registry: Zimbabwe Revenue Authority (Customs & Import Duty)

> Honesty note: this dossier records only what is verified in the CarUp codebase plus
> clearly-labelled UNKNOWNs. It does NOT invent endpoints, credentials, permissions, or
> provider facts. Every external fact required for live activation is marked
> "UNKNOWN — requires provider confirmation".

## Purpose (§76 minimum semantics)
Confirm the customs/import provenance of an imported vehicle: import/customs reference,
declared identity, import date, and duty/status category (and permitted mismatches).

## Verified transport options (engine-supported)
The shared provider platform supports these transports (`provider_registry.transport`):
`simulator`, `official_api`, `partner_api`, `signed_webhook`, `secure_batch_file`,
`manual_verification`. For ZIMRA today:
- `simulator` / sandbox — IMPLEMENTED and tested (deterministic synthetic customs payloads).
- `secure_batch_file` — engine-ready (append-only `government_source_batch_imports` records a
  Storage path + checksum only). Awaiting a real signed feed.
- `official_api` — STUB only. `makeGovernmentInvoke` returns `unavailable` / `credential_pending`
  for `live`/`pilot_live` until a real transport is wired. No endpoint is assumed.
- Preferred real transport: UNKNOWN — requires provider confirmation (ZIMRA may offer a
  batch/file exchange or a controlled API; not verified).

## Required agreements / identifiers
- Data-sharing agreement with ZIMRA: UNKNOWN — requires provider confirmation.
- Required query identifiers (engine config `required_identifiers`): `vin`, `chassis`.
- Credential reference: stored as a `credential_ref` env-key NAME only (never a secret).
  Actual credential: UNKNOWN — requires provider confirmation.

## Expected fields (mapped, privileged unless marked buyer-safe)
`customs_ref_number`, `import_date`*, `port_of_entry`, `declared_make`*, `declared_model`*,
`declared_year`*, `duty_status`* (`*` = buyer-safe projection). Source of truth for the map:
`backend/services/sourceVerification/governmentActivation.js` → `GOVERNMENT_FIELD_MAPS.zimra`.

## Privacy / legal constraints
- `customs_ref_number` is a permitted internal reference held privileged-only (admin/government).
- Buyer/partner projection exposes only import date, duty status and the already-public
  declared make/model/year. Raw payloads are never exposed to buyers.
- Legal basis for any non-live result is honestly labelled (sandbox / partner_file / manual /
  unavailable). A sandbox result can never be presented as a live ZIMRA confirmation.
- Retention / permitted-use terms for ZIMRA data: UNKNOWN — requires provider confirmation.

## Contacts
- Integration / data-office contact: UNKNOWN — requires provider confirmation.
- Legal / data-sharing authority: UNKNOWN — requires provider confirmation.

## Unresolved questions (external gates)
1. Does ZIMRA expose an API, or is a secure batch/file exchange the sanctioned channel?
2. What is the formal data-sharing agreement and permitted-use scope?
3. Which identifiers are accepted (VIN vs chassis vs customs entry number)?
4. Credential issuance + rotation process and environment key name?

## Completion classification
**ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED** — the governed check path, §76 field map,
append-only persistence with honest mode labels, fraud/review feed, buyer/partner projection,
and operator controls are implemented and tested in sandbox; live activation is gated on a
signed ZIMRA data-sharing agreement (then a credential), with the live transport failing closed
until wired.
