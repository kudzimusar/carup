import { describe, expect, it } from 'vitest'
import {
  DEALER_FILE_REFUSAL_MESSAGES,
  dealerFileRefusalFromError,
  describeDealerFileLocation,
  describeDealerFileRefusal,
} from './dealerFileRefusal'

describe('Owner UAT D2 — plain-language claim workbook refusals', () => {
  it('names the tab and row of an impossible latitude and says nothing was saved', () => {
    expect(describeDealerFileRefusal('INVALID_LATITUDE', 'BRANCHES!2')).toBe(
      'BRANCHES tab, row 2: latitude must be a number between -90 and 90 (Harare is about -17.8). ' +
        'Check that latitude and longitude are not swapped. Nothing was saved — correct the file and upload it again.')
  })

  it('reads every location shape the parsers emit', () => {
    expect(describeDealerFileLocation('BUSINESS!2.tax_clearance_expiry')).toBe('BUSINESS tab, row 2 (tax clearance expiry)')
    expect(describeDealerFileLocation('FINANCE_PAYMENTS!3:7')).toBe('FINANCE_PAYMENTS tab, row 3, column 7')
    expect(describeDealerFileLocation('BUSINESS')).toBe('BUSINESS tab')
    expect(describeDealerFileLocation('BUSINESS.Registered legal name')).toBe('BUSINESS tab, column “Registered legal name”')
    expect(describeDealerFileLocation('LICENCES_AUTHORIZATIONS:BR-9')).toBe('LICENCES_AUTHORIZATIONS tab (branch reference “BR-9”)')
    for (const unknown of [undefined, '', 'branches!2', 'README - Instructions', 'X'.repeat(141)])
      expect(describeDealerFileLocation(unknown)).toBe('')
  })

  it('starts a sentence without a location with a capital letter', () => {
    expect(describeDealerFileRefusal('UNEXPECTED_WORKBOOK_TABS')).toMatch(/^The workbook must keep exactly its 12 CarUp tabs\./)
  })

  it('never hides an unknown code and never echoes free text as a code', () => {
    expect(describeDealerFileRefusal('SOME_NEW_REFUSAL', 'BRANCHES!4')).toBe(
      'BRANCHES tab, row 4: this file was not accepted (SOME_NEW_REFUSAL). Nothing was saved — correct the file and upload it again.')
    expect(describeDealerFileRefusal('<b>x</b>')).toContain('(FILE_REFUSED)')
  })

  it('maps every parser code to a full sentence', () => {
    for (const [code, text] of Object.entries(DEALER_FILE_REFUSAL_MESSAGES)) {
      expect(text.length, code).toBeGreaterThan(20)
      expect(text.trim().endsWith('.') || text.trim().endsWith('”).'), code).toBe(true)
    }
  })

  it('reads code and location from an apiRequest failure, and keeps ordinary messages', () => {
    const failure = Object.assign(new Error('INVALID_LATITUDE'), { data: { error: 'INVALID_LATITUDE', code: 'INVALID_LATITUDE', location: 'BRANCHES!2' } })
    expect(dealerFileRefusalFromError(failure, 'x')).toMatch(/^BRANCHES tab, row 2: latitude/)
    expect(dealerFileRefusalFromError(new Error('NOT_XLSX_ZIP'), 'x')).toMatch(/^This file is not an Excel workbook/)
    expect(dealerFileRefusalFromError(new Error('Upload one valid .xlsx file no larger than 8MB'), 'x'))
      .toBe('Upload one valid .xlsx file no larger than 8MB')
    expect(dealerFileRefusalFromError('boom', 'Workbook import rejected')).toBe('Workbook import rejected')
  })
})
