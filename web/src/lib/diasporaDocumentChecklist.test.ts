import { describe, expect, it } from 'vitest'
import { buildDiasporaRequiredDocumentChecklist } from './diasporaDocumentChecklist'

describe('Diaspora required document checklist', () => {
  it('treats a commercial invoice as satisfying the invoice requirement', () => {
    const checklist = buildDiasporaRequiredDocumentChecklist([
      { document_type: 'commercial_invoice' },
    ])

    expect(checklist.find(item => item.label === 'Invoice or auction sheet')?.uploaded).toBe(true)
  })

  it('accepts any supported buyer identity document', () => {
    const checklist = buildDiasporaRequiredDocumentChecklist([
      { document_type: 'residence_card' },
    ])

    expect(checklist.find(item => item.label === 'Buyer identity document')?.uploaded).toBe(true)
  })

  it('leaves unrelated requirements pending', () => {
    const checklist = buildDiasporaRequiredDocumentChecklist([
      { document_type: 'packing_list' },
    ])

    expect(checklist.every(item => item.uploaded === false)).toBe(true)
  })
})
