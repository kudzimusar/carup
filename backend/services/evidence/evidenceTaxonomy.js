/**
 * Vehicle Life Evidence Taxonomy — Milestone 1 (master plan §4).
 *
 * Canonical, framework-neutral source of truth for the eight life-stage evidence
 * CLASSES and their SUBTYPES. The database table `evidence_class_taxonomy`
 * (migration 20260621120000) is seeded from the same definitions; this module is
 * what the upload validator and the taxonomy-discovery endpoint use at runtime so
 * validation never depends on a live DB round-trip.
 *
 * Backward compatibility (master plan §4.2): the 13 legacy `evidence_type` values
 * keep working. LEGACY_TYPE_TO_CLASS maps each to its life-stage class; the legacy
 * type is preserved as the `evidence_subtype` for old records.
 */

export const EVIDENCE_CLASSES = Object.freeze([
  'import',
  'auction',
  'accident',
  'repair',
  'inspection',
  'ownership_transfer',
  'dealer_listing',
  'current_condition',
]);

/**
 * Subtype catalog per class. Mirrors the seed in migration 20260621120000.
 * Flags: d=document, ed=requires_event_date, mi=requires_mileage, co=supports_components.
 */
export const CLASS_SUBTYPES = Object.freeze({
  import: [
    { code: 'export_yard_photo', label: 'Export-yard photo', co: true, ed: true },
    { code: 'port_photo', label: 'Port photo', ed: true },
    { code: 'container_loading', label: 'Container loading/unloading', ed: true },
    { code: 'bill_of_lading', label: 'Bill of lading', d: true, ed: true },
    { code: 'export_certificate', label: 'Export certificate', d: true, ed: true },
    { code: 'customs_entry', label: 'Customs entry', d: true, ed: true },
    { code: 'duty_clearance_document', label: 'Duty / clearance document', d: true, ed: true },
    { code: 'import_inspection', label: 'Import inspection', co: true, ed: true },
  ],
  auction: [
    { code: 'auction_image', label: 'Auction image', co: true, ed: true },
    { code: 'auction_sheet', label: 'Auction sheet', d: true, ed: true },
    { code: 'damage_diagram', label: 'Damage diagram', co: true, ed: true },
    { code: 'auction_grade', label: 'Auction grade', ed: true },
    { code: 'lot_metadata', label: 'Lot metadata', ed: true },
    { code: 'mileage_reading', label: 'Mileage reading', mi: true, ed: true },
    { code: 'source_listing_snapshot', label: 'Source listing snapshot', ed: true },
  ],
  accident: [
    { code: 'scene_photo', label: 'Scene photo', co: true, ed: true },
    { code: 'police_report', label: 'Police report', d: true, ed: true },
    { code: 'insurer_assessment', label: 'Insurer assessment', d: true, co: true, ed: true },
    { code: 'tow_record', label: 'Tow record', d: true, ed: true },
    { code: 'damage_map', label: 'Damage map', co: true, ed: true },
    { code: 'severity_assessment', label: 'Severity assessment', co: true, ed: true },
  ],
  repair: [
    { code: 'before_repair', label: 'Before repair', co: true, ed: true },
    { code: 'during_repair', label: 'During repair', co: true, ed: true },
    { code: 'after_repair', label: 'After repair', co: true, ed: true },
    { code: 'repair_invoice', label: 'Repair invoice', d: true, ed: true },
    { code: 'parts_list', label: 'Parts list', d: true, ed: true },
    { code: 'replaced_component', label: 'Replaced component', co: true, ed: true },
    { code: 'paint_body_work', label: 'Paint / body work', co: true, ed: true },
    { code: 'structural_repair', label: 'Structural repair', co: true, ed: true },
    { code: 'mechanic_certification', label: 'Mechanic certification', d: true, ed: true },
  ],
  inspection: [
    { code: 'pre_purchase_inspection', label: 'Pre-purchase inspection', d: true, co: true, ed: true },
    { code: 'roadworthiness', label: 'Roadworthiness', d: true, ed: true },
    { code: 'mechanical_inspection', label: 'Mechanical inspection', co: true, ed: true },
    { code: 'chassis_inspection', label: 'Chassis inspection', co: true, ed: true },
    { code: 'emissions', label: 'Emissions', d: true, ed: true },
    { code: 'brake_tyre_suspension', label: 'Brake / tyre / suspension', co: true, ed: true },
    { code: 'odometer_reading', label: 'Odometer reading', mi: true, ed: true },
    { code: 'inspector_report', label: 'Inspector report', d: true, ed: true },
  ],
  ownership_transfer: [
    { code: 'transfer_record', label: 'Transfer record', d: true, ed: true },
    { code: 'sale_agreement', label: 'Sale agreement', d: true, ed: true },
    { code: 'condition_at_handover', label: 'Condition at handover', co: true, ed: true },
    { code: 'mileage_at_transfer', label: 'Mileage at transfer', mi: true, ed: true },
    { code: 'ownership_transition', label: 'Ownership transition', d: true, ed: true },
  ],
  dealer_listing: [
    { code: 'listing_photograph', label: 'Listing photograph', co: true, ed: true },
    { code: 'seller_description_snapshot', label: 'Seller/dealer description snapshot', ed: true },
    { code: 'advertised_mileage', label: 'Advertised mileage', mi: true, ed: true },
    { code: 'advertised_condition', label: 'Advertised condition', ed: true },
    { code: 'price_history', label: 'Price / price history', ed: true },
    { code: 'listing_source', label: 'Listing source and date', ed: true },
    { code: 'declared_status', label: 'Declared accident/repair status', ed: true },
  ],
  current_condition: [
    { code: 'exterior_viewpoint', label: 'Exterior viewpoint', co: true },
    { code: 'interior', label: 'Interior', co: true },
    { code: 'engine_bay', label: 'Engine bay', co: true },
    { code: 'underbody', label: 'Underbody', co: true },
    { code: 'tyres', label: 'Tyres', co: true },
    { code: 'dashboard', label: 'Dashboard' },
    { code: 'odometer', label: 'Odometer', mi: true },
    { code: 'vin_chassis_plate', label: 'VIN / chassis / plate' },
    { code: 'current_defect', label: 'Current defect', co: true },
  ],
});

/** Legacy evidence_type -> life-stage class (master plan §4.2). */
export const LEGACY_TYPE_TO_CLASS = Object.freeze({
  import_photo: 'import',
  customs_photo: 'import',
  auction_photo: 'auction',
  inspection_photo: 'inspection',
  odometer_photo: 'inspection',
  damage_photo: 'accident',
  repair_photo: 'repair',
  dealer_listing_photo: 'dealer_listing',
  owner_handover_photo: 'ownership_transfer',
  registration_document: 'ownership_transfer',
  insurance_document: 'accident',
  police_clearance_document: 'accident',
  ownership_transfer_document: 'ownership_transfer',
});

export const LEGACY_EVIDENCE_TYPES = Object.freeze(Object.keys(LEGACY_TYPE_TO_CLASS));

export function isValidClass(evidenceClass) {
  return EVIDENCE_CLASSES.includes(evidenceClass);
}

export function subtypesForClass(evidenceClass) {
  return CLASS_SUBTYPES[evidenceClass] || [];
}

export function isValidSubtype(evidenceClass, subtypeCode) {
  return subtypesForClass(evidenceClass).some((s) => s.code === subtypeCode);
}

export function classForLegacyType(legacyType) {
  return LEGACY_TYPE_TO_CLASS[legacyType] || null;
}

/** Full taxonomy payload for the discovery endpoint / upload forms (master plan §4.5). */
export function getTaxonomy() {
  return {
    version: 'vehicle_life_evidence.v1',
    classes: EVIDENCE_CLASSES.map((evidence_class) => ({
      evidence_class,
      subtypes: subtypesForClass(evidence_class).map((s) => ({
        subtype_code: s.code,
        label: s.label,
        is_document: !!s.d,
        requires_event_date: !!s.ed,
        requires_mileage: !!s.mi,
        supports_components: !!s.co,
      })),
    })),
    legacy_type_to_class: { ...LEGACY_TYPE_TO_CLASS },
  };
}

/**
 * Resolve and validate a classification for an upload.
 * Accepts either an explicit {evidence_class, evidence_subtype} OR a legacy
 * {evidence_type}. Returns the normalized classification or structured errors.
 * This NEVER infers silently across vehicles — it only normalizes the submitted
 * classification (master plan §2.1 evidence-first).
 */
export function resolveClassification({ evidence_class, evidence_subtype, evidence_type } = {}) {
  const errors = [];

  // Path A: explicit class provided.
  if (evidence_class) {
    if (!isValidClass(evidence_class)) {
      errors.push(`Unknown evidence_class '${evidence_class}'.`);
      return { ok: false, errors };
    }
    if (evidence_subtype && !isValidSubtype(evidence_class, evidence_subtype)) {
      errors.push(`Subtype '${evidence_subtype}' is not valid for class '${evidence_class}'.`);
      return { ok: false, errors };
    }
    return {
      ok: true,
      evidence_class,
      evidence_subtype: evidence_subtype || null,
      legacy_evidence_type: evidence_type || null,
      errors,
    };
  }

  // Path B: legacy evidence_type only.
  if (evidence_type) {
    const mapped = classForLegacyType(evidence_type);
    if (!mapped) {
      errors.push(`Unknown legacy evidence_type '${evidence_type}'.`);
      return { ok: false, errors };
    }
    return {
      ok: true,
      evidence_class: mapped,
      evidence_subtype: evidence_type,
      legacy_evidence_type: evidence_type,
      errors,
    };
  }

  errors.push('Either evidence_class or a legacy evidence_type is required.');
  return { ok: false, errors };
}

export default {
  EVIDENCE_CLASSES,
  CLASS_SUBTYPES,
  LEGACY_TYPE_TO_CLASS,
  LEGACY_EVIDENCE_TYPES,
  isValidClass,
  subtypesForClass,
  isValidSubtype,
  classForLegacyType,
  getTaxonomy,
  resolveClassification,
};
