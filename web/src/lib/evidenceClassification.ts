/**
 * Canonical evidence classification display helpers — Operations Control Plane M1.
 *
 * THE RULE: semantic meaning = evidence_class + evidence_subtype. The legacy
 * evidence_type is compatibility metadata. Any surface that labels an evidence
 * row must prefer the canonical classification, so a row canonically classed
 * import/commercial_invoice is never presented as a "Registration Document"
 * because of its legacy field. Legacy-only historical rows (no evidence_class)
 * keep their historical label.
 */

type ClassifiedEvidence = {
  evidence_type?: string | null
  evidence_class?: string | null
  evidence_subtype?: string | null
}

const CLASS_LABELS: Record<string, string> = {
  import: 'Import',
  auction: 'Auction',
  accident: 'Accident',
  repair: 'Repair',
  inspection: 'Inspection',
  ownership_transfer: 'Ownership Transfer',
  registration: 'Zimbabwe Registration',
  dealer_listing: 'Dealer Listing',
  current_condition: 'Current Condition',
}

export function titleCaseCode(value?: string | null): string {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** The grouping key for an evidence row: canonical class first, legacy type as fallback. */
export function evidenceGroupKey(item: ClassifiedEvidence): string {
  return item.evidence_class || item.evidence_type || 'other'
}

/** Human label for a group key (a class code or a legacy type). */
export function evidenceGroupLabel(key: string): string {
  return CLASS_LABELS[key] || titleCaseCode(key)
}

/**
 * Does this row semantically qualify as an ownership/registration document?
 * Mirrors backend satisfiesOwnershipRegistrationRequirementRow: canonical class
 * wins (a canonical import row NEVER qualifies regardless of its legacy field);
 * legacy-only historical rows qualify through the two historical document types.
 */
const NON_DOCUMENT_OWNERSHIP_SUBTYPES = new Set(['condition_at_handover', 'mileage_at_transfer'])

export function satisfiesOwnershipRegistration(item: ClassifiedEvidence): boolean {
  if (item.evidence_class) {
    if (item.evidence_class !== 'registration' && item.evidence_class !== 'ownership_transfer') return false
    return !NON_DOCUMENT_OWNERSHIP_SUBTYPES.has(item.evidence_subtype || '')
  }
  return item.evidence_type === 'registration_document' || item.evidence_type === 'ownership_transfer_document'
}

/** Canonical-first label for one evidence row. */
export function evidenceClassificationLabel(item: ClassifiedEvidence): string {
  if (item.evidence_class) {
    const classLabel = CLASS_LABELS[item.evidence_class] || titleCaseCode(item.evidence_class)
    return item.evidence_subtype
      ? `${classLabel} — ${titleCaseCode(item.evidence_subtype)}`
      : classLabel
  }
  return titleCaseCode(item.evidence_type || 'evidence')
}
