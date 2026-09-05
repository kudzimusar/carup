/**
 * Zimbabwe registration / market-readiness lifecycle.
 *
 * This is deliberately NOT a Trust score. A vehicle can have strong documentary identity while its
 * Zimbabwe registration is still progressing. Provenance remains separate: a legacy/default value
 * with no registration_status_source is not a recorded registration claim.
 */
export const ZIMBABWE_REGISTRATION_STATUSES = Object.freeze([
  'unknown',
  'import_in_transit',
  'arrived_customs_pending',
  'customs_cleared_cvr_pending',
  'cvr_plate_pending',
  'locally_registered',
  'temporary_foreign_tip',
  'reregistration_pending',
]);

const STATUS_SET = new Set(ZIMBABWE_REGISTRATION_STATUSES);

export const ZIMBABWE_REGISTRATION_PRESENTATION = Object.freeze({
  unknown: { label: 'Registration status not established', shortLabel: 'Registration not established', stage: 'unknown', ordinarilyListable: false, requiresLocalPlate: false },
  import_in_transit: { label: 'Import in transit', shortLabel: 'Import in transit', stage: 'pending', ordinarilyListable: true, requiresLocalPlate: false },
  arrived_customs_pending: { label: 'Arrived — customs pending', shortLabel: 'Customs pending', stage: 'pending', ordinarilyListable: true, requiresLocalPlate: false },
  customs_cleared_cvr_pending: { label: 'Customs cleared — local registration pending', shortLabel: 'Local registration pending', stage: 'pending', ordinarilyListable: true, requiresLocalPlate: false },
  cvr_plate_pending: { label: 'CVR processing — plate pending', shortLabel: 'Plate pending', stage: 'pending', ordinarilyListable: true, requiresLocalPlate: false },
  locally_registered: { label: 'Locally registered in Zimbabwe', shortLabel: 'Locally registered', stage: 'registered', ordinarilyListable: true, requiresLocalPlate: true },
  temporary_foreign_tip: { label: 'Temporary foreign vehicle — TIP', shortLabel: 'Temporary import permit', stage: 'temporary', ordinarilyListable: false, requiresLocalPlate: false },
  reregistration_pending: { label: 'Re-registration pending', shortLabel: 'Re-registration pending', stage: 'pending', ordinarilyListable: true, requiresLocalPlate: false },
});

export function isZimbabweRegistrationStatus(value) {
  return STATUS_SET.has(String(value || '').trim().toLowerCase());
}

export function normalizeZimbabweRegistrationStatus(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (STATUS_SET.has(lower)) return lower;
  if (lower === 'local') return 'locally_registered';
  // Old "Imported / Foreign-registered" and schema-default "Current" are too broad/unproven to map
  // to any exact new stage. Unknown is the only non-invented interpretation.
  if (lower === 'imported' || lower === 'current') return 'unknown';
  return null;
}

export function registrationPresentation(status) {
  const normalized = normalizeZimbabweRegistrationStatus(status) || 'unknown';
  return ZIMBABWE_REGISTRATION_PRESENTATION[normalized];
}

export function evaluateZimbabweRegistrationReadiness({
  status,
  statusSource = null,
  plateNumber = null,
  tempPlateId = null,
} = {}) {
  const normalized = normalizeZimbabweRegistrationStatus(status);
  const hasSource = String(statusSource || '').trim().length > 0;

  if (!normalized || !hasSource) {
    return {
      status: 'not_recorded',
      lifecycle_status: null,
      label: ZIMBABWE_REGISTRATION_PRESENTATION.unknown.label,
      short_label: ZIMBABWE_REGISTRATION_PRESENTATION.unknown.shortLabel,
      publication_blocking: true,
      reason_codes: ['registration_stage_not_recorded'],
      source: null,
    };
  }

  const presentation = ZIMBABWE_REGISTRATION_PRESENTATION[normalized];
  const reasons = [];
  let publicationBlocking = !presentation.ordinarilyListable;
  let state = presentation.stage === 'pending' ? 'pending' : presentation.stage;

  if (normalized === 'unknown') {
    publicationBlocking = true;
    state = 'not_established';
    reasons.push('registration_stage_unknown');
  }
  if (normalized === 'temporary_foreign_tip') reasons.push('temporary_import_sale_review_required');
  if (presentation.requiresLocalPlate && !String(plateNumber || '').trim()) {
    publicationBlocking = true;
    state = 'incomplete';
    reasons.push('local_plate_not_recorded');
  }
  // A TIP number is context for temporary admission only. It never substitutes for a Zimbabwe plate.
  if (normalized === 'temporary_foreign_tip' && !String(tempPlateId || '').trim()) {
    reasons.push('temporary_import_permit_number_not_recorded');
  }
  if (presentation.stage === 'pending') reasons.push(`registration_pending:${normalized}`);

  return {
    status: state,
    lifecycle_status: normalized,
    label: presentation.label,
    short_label: presentation.shortLabel,
    publication_blocking: publicationBlocking,
    reason_codes: reasons,
    source: String(statusSource),
  };
}

export default {
  ZIMBABWE_REGISTRATION_STATUSES,
  ZIMBABWE_REGISTRATION_PRESENTATION,
  isZimbabweRegistrationStatus,
  normalizeZimbabweRegistrationStatus,
  registrationPresentation,
  evaluateZimbabweRegistrationReadiness,
};
