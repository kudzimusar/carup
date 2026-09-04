/**
 * Vehicle Life Evidence Taxonomy — Milestone 1 (master plan §4).
 *
 * Canonical, framework-neutral source of truth for the life-stage evidence
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
  'registration',
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
    { code: 'commercial_invoice', label: 'Commercial invoice', d: true, ed: true },
    { code: 'payment_receipt', label: 'Purchase / payment receipt', d: true, ed: true },
    { code: 'transit_declaration', label: 'Transit declaration', d: true, ed: true },
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
  registration: [
    { code: 'cvr_first_registration', label: 'CVR first registration', d: true, ed: true },
    { code: 'registration_book', label: 'Registration book / certificate', d: true, ed: true },
    { code: 'registration_plate_record', label: 'Registration plate record', d: true, ed: true },
    { code: 'police_clearance_first_registration', label: 'Police clearance for first registration', d: true, ed: true },
    { code: 'reregistration_record', label: 'Re-registration record', d: true, ed: true },
    { code: 'temporary_import_permit', label: 'Temporary import permit', d: true, ed: true },
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
  // New uploads use their Zimbabwe registration meaning. Historical rows are not rewritten.
  registration_document: 'registration',
  insurance_document: 'accident',
  police_clearance_document: 'registration',
  ownership_transfer_document: 'ownership_transfer',
});

export const LEGACY_EVIDENCE_TYPES = Object.freeze(Object.keys(LEGACY_TYPE_TO_CLASS));

/**
 * Generic compatibility artifact-form values (Operations Control Plane M1).
 *
 * The legacy 13-value vocabulary cannot honestly represent every canonical
 * subtype (there is no legacy value for an import commercial invoice — which is
 * exactly how import documents ended up stored as `registration_document`).
 * These two values satisfy the NOT NULL legacy column for canonical-first
 * uploads WITHOUT smuggling in false semantics: they say only "document" or
 * "photo"; the meaning lives entirely in evidence_class + evidence_subtype.
 * They are deliberately NOT in LEGACY_TYPE_TO_CLASS — they carry no class of
 * their own and are invalid without a canonical classification.
 */
export const GENERIC_COMPAT_DOCUMENT_TYPE = 'vehicle_life_document';
export const GENERIC_COMPAT_PHOTO_TYPE = 'vehicle_life_photo';
export const GENERIC_COMPAT_TYPES = Object.freeze([
  GENERIC_COMPAT_DOCUMENT_TYPE,
  GENERIC_COMPAT_PHOTO_TYPE,
]);

/**
 * Exact legacy counterparts for canonical subtypes. Only pairs whose semantic
 * identity is EXACT are mapped; everything else falls back to the generic
 * artifact-form value so no new record can ever be born with a false legacy
 * meaning again.
 */
const SUBTYPE_TO_EXACT_LEGACY = Object.freeze({
  'registration:cvr_first_registration': 'registration_document',
  'registration:registration_book': 'registration_document',
  'registration:registration_plate_record': 'registration_document',
  'registration:reregistration_record': 'registration_document',
  'registration:temporary_import_permit': 'registration_document',
  'registration:police_clearance_first_registration': 'police_clearance_document',
  'ownership_transfer:transfer_record': 'ownership_transfer_document',
  'ownership_transfer:sale_agreement': 'ownership_transfer_document',
  'ownership_transfer:ownership_transition': 'ownership_transfer_document',
  'ownership_transfer:condition_at_handover': 'owner_handover_photo',
  'accident:insurer_assessment': 'insurance_document',
});

const CLASS_TO_PHOTO_LEGACY = Object.freeze({
  import: 'import_photo',
  auction: 'auction_photo',
  inspection: 'inspection_photo',
  accident: 'damage_photo',
  repair: 'repair_photo',
  dealer_listing: 'dealer_listing_photo',
  ownership_transfer: 'owner_handover_photo',
});

function subtypeDefinition(evidenceClass, subtypeCode) {
  return subtypesForClass(evidenceClass).find((s) => s.code === subtypeCode) || null;
}

/**
 * Derive the compatibility `evidence_type` for a canonical-first record.
 * Deterministic; exact legacy counterpart when one exists, otherwise the
 * generic artifact-form value.
 */
export function deriveLegacyCompatibilityType(evidenceClass, subtypeCode) {
  if (!isValidClass(evidenceClass) || !isValidSubtype(evidenceClass, subtypeCode)) return null;
  const exact = SUBTYPE_TO_EXACT_LEGACY[`${evidenceClass}:${subtypeCode}`];
  if (exact) return exact;
  const def = subtypeDefinition(evidenceClass, subtypeCode);
  if (def?.mi && (evidenceClass === 'inspection' || evidenceClass === 'current_condition')) {
    return 'odometer_photo';
  }
  if (def?.d) return GENERIC_COMPAT_DOCUMENT_TYPE;
  return CLASS_TO_PHOTO_LEGACY[evidenceClass] || GENERIC_COMPAT_PHOTO_TYPE;
}

// ---------------------------------------------------------------------------
// Canonical semantic resolution (Operations Control Plane M1).
//
// THE RULE: semantic meaning = evidence_class + evidence_subtype. The legacy
// evidence_type is compatibility metadata and artifact-form/storage input only.
// When a row carries a canonical class, every predicate below IGNORES the
// legacy field — a commercial invoice stored under legacy `registration_document`
// is import evidence, never registration evidence. Rows with no canonical class
// (historical legacy-only rows) fall back to LEGACY_TYPE_TO_CLASS so they stay
// readable without being rewritten.
// ---------------------------------------------------------------------------

/**
 * Resolve the semantic classification of a stored evidence row.
 * @returns {{ evidence_class: string|null, evidence_subtype: string|null,
 *             semantic_source: 'canonical'|'legacy_fallback'|null }}
 */
export function resolveSemanticClassification(row = {}) {
  const evidenceClass = row.evidence_class || null;
  if (evidenceClass && isValidClass(evidenceClass)) {
    return {
      evidence_class: evidenceClass,
      evidence_subtype: row.evidence_subtype || null,
      semantic_source: 'canonical',
    };
  }
  const legacyClass = classForLegacyType(row.evidence_type);
  if (legacyClass) {
    return {
      evidence_class: legacyClass,
      evidence_subtype: row.evidence_subtype || row.evidence_type || null,
      semantic_source: 'legacy_fallback',
    };
  }
  return { evidence_class: null, evidence_subtype: null, semantic_source: null };
}

/** Artifact form: is this row a document (vs photo/media)? Canonical subtype flag wins. */
export function isDocumentArtifactRow(row = {}) {
  const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
  if (semantic_source === 'canonical' && cls && sub) {
    const def = subtypeDefinition(cls, sub);
    if (def) return !!def.d;
  }
  const type = row.evidence_type;
  if (type === GENERIC_COMPAT_DOCUMENT_TYPE) return true;
  if (type === GENERIC_COMPAT_PHOTO_TYPE) return false;
  return ['registration_document', 'insurance_document', 'police_clearance_document', 'ownership_transfer_document'].includes(type);
}

export function isImportEvidenceRow(row = {}) {
  return resolveSemanticClassification(row).evidence_class === 'import';
}

export function isInspectionEvidenceRow(row = {}) {
  return resolveSemanticClassification(row).evidence_class === 'inspection';
}

/** Zimbabwe registration evidence. Import/transit/export artifacts are NEVER this. */
export function isRegistrationEvidenceRow(row = {}) {
  return resolveSemanticClassification(row).evidence_class === 'registration';
}

export function isOwnershipTransferEvidenceRow(row = {}) {
  return resolveSemanticClassification(row).evidence_class === 'ownership_transfer';
}

/**
 * Is this row a Zimbabwe Temporary Import Permit?
 * ONLY registration/temporary_import_permit qualifies. A transit declaration
 * (import/transit_declaration — e.g. a Tanzania T1) is transit evidence and
 * must never be interpreted as a TIP.
 */
export function isTemporaryImportPermitRow(row = {}) {
  const { evidence_class: cls, evidence_subtype: sub } = resolveSemanticClassification(row);
  return cls === 'registration' && sub === 'temporary_import_permit';
}

/**
 * May this row satisfy the publication "ownership / registration document"
 * requirement? Semantically: a DOCUMENT artifact whose life-stage class is
 * registration or ownership_transfer. Canonical classification wins; a
 * legacy-only historical row qualifies through its legacy mapping. A canonical
 * import row NEVER qualifies regardless of its legacy compatibility value.
 */
export function satisfiesOwnershipRegistrationRequirementRow(row = {}) {
  const { evidence_class: cls, semantic_source } = resolveSemanticClassification(row);
  if (cls !== 'registration' && cls !== 'ownership_transfer') return false;
  if (semantic_source === 'canonical') return isDocumentArtifactRow(row);
  // Legacy fallback: only the two historical ownership/registration document types.
  return ['registration_document', 'ownership_transfer_document'].includes(row.evidence_type);
}

/**
 * May this row contribute to a Seller Authority evidence basis?
 * Ownership/registration documents always; import purchase-chain documents
 * (invoice, payment receipt, bill of lading, export certificate) may CONTRIBUTE
 * to a permanent-import authority review without ever counting as registration.
 */
export function isSellerAuthorityCandidateRow(row = {}) {
  if (satisfiesOwnershipRegistrationRequirementRow(row)) return true;
  const { evidence_class: cls, evidence_subtype: sub, semantic_source } = resolveSemanticClassification(row);
  if (semantic_source !== 'canonical') return false;
  return cls === 'import'
    && ['commercial_invoice', 'payment_receipt', 'bill_of_lading', 'export_certificate'].includes(sub);
}

/** Human-readable canonical label ("Import — Commercial invoice"), null when unresolvable. */
export function semanticClassificationLabel(row = {}) {
  const { evidence_class: cls, evidence_subtype: sub } = resolveSemanticClassification(row);
  if (!cls) return null;
  const classLabel = cls.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const def = sub ? subtypeDefinition(cls, sub) : null;
  if (def) return `${classLabel} — ${def.label}`;
  if (sub) return `${classLabel} — ${sub.replace(/_/g, ' ')}`;
  return classLabel;
}

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
  GENERIC_COMPAT_TYPES,
  GENERIC_COMPAT_DOCUMENT_TYPE,
  GENERIC_COMPAT_PHOTO_TYPE,
  isValidClass,
  subtypesForClass,
  isValidSubtype,
  classForLegacyType,
  deriveLegacyCompatibilityType,
  resolveSemanticClassification,
  isDocumentArtifactRow,
  isImportEvidenceRow,
  isInspectionEvidenceRow,
  isRegistrationEvidenceRow,
  isOwnershipTransferEvidenceRow,
  isTemporaryImportPermitRow,
  satisfiesOwnershipRegistrationRequirementRow,
  isSellerAuthorityCandidateRow,
  semanticClassificationLabel,
  getTaxonomy,
  resolveClassification,
};
