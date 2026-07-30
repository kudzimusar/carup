export interface DiasporaDocumentTypeRecord {
  document_type?: string | null
}

export const DIASPORA_REQUIRED_DOCUMENT_RULES = [
  {
    label: 'Buyer identity document',
    acceptedTypes: ['passport', 'national_id', 'residence_card'],
  },
  {
    label: 'Invoice or auction sheet',
    acceptedTypes: ['commercial_invoice', 'auction_sheet'],
  },
  {
    label: 'Export certificate',
    acceptedTypes: ['export_certificate'],
  },
  {
    label: 'Bill of lading',
    acceptedTypes: ['bill_of_lading'],
  },
  {
    label: 'ZIMRA duty assessment',
    acceptedTypes: ['customs_declaration', 'duty_receipt', 'zimra_duty_assessment'],
  },
] as const

export function buildDiasporaRequiredDocumentChecklist(documents: DiasporaDocumentTypeRecord[]) {
  const uploadedTypes = new Set(
    documents
      .map(document => String(document.document_type || '').trim().toLowerCase())
      .filter(Boolean),
  )

  return DIASPORA_REQUIRED_DOCUMENT_RULES.map(rule => ({
    label: rule.label,
    uploaded: rule.acceptedTypes.some(type => uploadedTypes.has(type)),
  }))
}
