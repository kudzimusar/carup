# Vehicle Life Evidence Taxonomy (Milestone 1)

Canonical reference for the eight life-stage evidence **classes**, their **subtypes**, and
the mapping from the 13 legacy `evidence_type` values. Source of truth in code:
[`backend/services/evidence/evidenceTaxonomy.js`](../../backend/services/evidence/evidenceTaxonomy.js);
seeded into the `evidence_class_taxonomy` table by migration
`20260621120000_vehicle_life_evidence_taxonomy_provenance.sql`. Discovery endpoint:
`GET /api/evidence/taxonomy`.

## Why a class layer

Before M1 every upload was one of 13 flat `evidence_type` values. M1 layers eight
first-class **life-stage classes** above the legacy type so each item is meaningful in the
context of the vehicle's life (master plan §4.1). The legacy `evidence_type` is preserved
and still drives role authorization and storage routing; `evidence_class` + `evidence_subtype`
enrich it and can be refined by the uploader.

## The eight classes

| Class | Meaning | Example subtypes |
|---|---|---|
| `import` | Bringing the vehicle into the country | export_yard_photo, bill_of_lading, customs_entry, duty_clearance_document, import_inspection |
| `auction` | Auction / export-market record | auction_image, auction_sheet, damage_diagram, auction_grade, mileage_reading |
| `accident` | Damage / incident evidence | scene_photo, police_report, insurer_assessment, damage_map, severity_assessment |
| `repair` | Repair / body / paint work | before_repair, during_repair, after_repair, repair_invoice, replaced_component, structural_repair |
| `inspection` | Inspection / roadworthiness | pre_purchase_inspection, roadworthiness, chassis_inspection, odometer_reading, inspector_report |
| `ownership_transfer` | Change of ownership | transfer_record, sale_agreement, condition_at_handover, mileage_at_transfer |
| `dealer_listing` | A listing/advert snapshot | listing_photograph, seller_description_snapshot, advertised_mileage, price_history, declared_status |
| `current_condition` | The vehicle as it is now | exterior_viewpoint, interior, engine_bay, underbody, odometer, vin_chassis_plate, current_defect |

The full subtype catalog (with `requires_event_date`, `requires_mileage`, `supports_components`,
`is_document` flags) is in `CLASS_SUBTYPES` and the seed.

## Legacy `evidence_type` → class mapping (backward compatibility)

Applied by the migration backfill and `LEGACY_TYPE_TO_CLASS`. Existing rows keep their
legacy `evidence_type` as their `evidence_subtype`; only the new `evidence_class` is derived.

| legacy evidence_type | evidence_class |
|---|---|
| import_photo | import |
| customs_photo | import |
| auction_photo | auction |
| inspection_photo | inspection |
| odometer_photo | inspection |
| damage_photo | accident |
| repair_photo | repair |
| dealer_listing_photo | dealer_listing |
| owner_handover_photo | ownership_transfer |
| registration_document | ownership_transfer |
| insurance_document | accident |
| police_clearance_document | accident |
| ownership_transfer_document | ownership_transfer |

These are best-fit defaults for historical records; reviewers can re-classify legacy items.
New uploads may set `evidence_class`/`evidence_subtype` explicitly.

## Validation rules (master plan §4.7)

- `evidence_type` (legacy) remains required and must be one of the 13 known types.
- If `evidence_class` is provided it must be one of the eight classes; if `evidence_subtype`
  is also provided it must belong to that class — otherwise the upload fails (`400`).
- If only a legacy `evidence_type` is provided, the class is derived and the subtype is the
  legacy type.
- `event_date_precision` ∈ {day, month, year, unknown}; `odometer_value` must be numeric.

Invalid class/subtype combinations fail safely at the service boundary (covered by
`backend/tests/vehicle-life-taxonomy.test.js` and `evidence-catalog-routes.test.js`).
