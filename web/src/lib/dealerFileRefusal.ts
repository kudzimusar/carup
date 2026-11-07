/**
 * CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D2.
 *
 * The claim workbook / CSV parsers refuse a file with a stable code and, when known, WHERE in the
 * applicant's OWN file (backend `location`: "BRANCHES!2", "BUSINESS!2.tax_clearance_expiry",
 * "FINANCE_PAYMENTS!3:7", "BUSINESS", "LICENCES_AUTHORIZATIONS:BR-1"). Before this, the applicant saw
 * only "INVALID_LATITUDE" at the bottom of the page. This turns code + location into one sentence the
 * applicant can act on. An unknown code is still shown verbatim — never guessed at or hidden.
 */
const UNSAFE_FILE =
  'For safety CarUp accepts only plain Excel workbooks without macros, external links or embedded objects. Save a clean copy as “Excel Workbook (.xlsx)” and upload that.'
const UNREADABLE = 'This Excel file could not be read. Open it and save it again as “Excel Workbook (.xlsx)”.'
const FRESH_COPY =
  'Download a fresh prefilled workbook and copy your answers into it without editing the heading row.'

export const DEALER_FILE_REFUSAL_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  INVALID_LATITUDE:
    'latitude must be a number between -90 and 90 (Harare is about -17.8). Check that latitude and longitude are not swapped.',
  INVALID_LONGITUDE: 'longitude must be a number between -180 and 180 (Harare is about 31.0).',
  INVALID_DECIMAL: 'this cell must contain a plain number, for example -17.8292.',
  INVALID_INTEGER: 'this cell must contain a whole number, for example 40.',
  INVALID_DATE: 'type dates as YYYY-MM-DD, for example 2027-03-31.',
  INVALID_CALENDAR_DATE: 'this date does not exist. Type a real date as YYYY-MM-DD, for example 2027-02-28.',
  INVALID_COUNTRY: 'use a two-letter country code, for example ZW.',
  WORKBOOK_FORMULA_REFUSED: 'formulas are not accepted. Replace the formula with the plain value you want to submit.',
  NON_LITERAL_CELL: 'only plain typed values are accepted — no formulas, links or formatted rich text.',
  CELL_TOO_LONG: 'this cell is longer than 4,000 characters. Shorten it.',
  WORKBOOK_HEADER_DRIFT: 'a column heading was changed. ' + FRESH_COPY,
  FIELD_REGISTRY_DRIFT: 'a required column is missing or renamed. ' + FRESH_COPY,
  UNEXPECTED_WORKBOOK_TABS: 'the workbook must keep exactly its 12 CarUp tabs. Do not add, rename or delete tabs.',
  WORKBOOK_ROW_OR_COLUMN_LIMIT: 'a tab has more rows or columns than CarUp accepts. Delete extra or empty rows and columns.',
  SINGLE_BUSINESS_REQUIRED: 'the BUSINESS tab must contain exactly one business row.',
  WORKBOOK_CLAIM_REFERENCE_MISMATCH:
    'this workbook was downloaded for a different claim. Download the prefilled workbook for this claim and use that one.',
  SOURCE_CUSTODY_MISMATCH:
    'this workbook does not match this claim’s research record. Download the prefilled workbook for this claim again.',
  LEGAL_NAME_AND_COUNTRY_REQUIRED: 'fill in the registered legal name and the two-letter country code on the BUSINESS tab.',
  TOO_MANY_BRANCHES: 'a workbook can list at most 100 branches.',
  DUPLICATE_OR_MISSING_BRANCH_REF: 'every branch row needs its own, different branch reference.',
  CROSS_SOURCE_BRANCH_REFERENCE: 'a branch row points to a different research record. Keep the prefilled source research ID.',
  INVALID_SOURCE_CONFIRMATION: 'confirmation columns accept only YES, CORRECT or UNKNOWN.',
  ORPHAN_BRANCH_REFERENCE: 'this row refers to a branch reference that is not listed on the BRANCHES tab.',
  INVALID_WORKBOOK_SIZE: 'the file is empty or larger than 8 MB.',
  NOT_XLSX_ZIP: 'this file is not an Excel workbook. Save it as “Excel Workbook (.xlsx)” and upload it again.',
  INVALID_XLSX_STRUCTURE: UNREADABLE,
  MISSING_XLSX_PARTS: UNREADABLE,
  INVALID_ZIP_DIRECTORY: UNREADABLE,
  INVALID_ZIP_ENTRY: UNSAFE_FILE,
  ZIP_LIMITS_EXCEEDED: UNSAFE_FILE,
  UNSAFE_XLSX_PART: UNSAFE_FILE,
  ZIP_EXPANSION_LIMIT: UNSAFE_FILE,
  FORBIDDEN_XLSX_CONTENT: UNSAFE_FILE,
  STALE_INTAKE_VERSION:
    'your application was changed in another window or tab. Reload this page to see the latest saved version, then upload again.',
  CLAIM_APPROVAL_REQUIRED: 'a completed workbook can be uploaded only after your claim is approved.',
  CLAIM_NOT_APPROVED: 'a completed workbook can be uploaded only after your claim is approved.',
})

const CODE = /^[A-Z][A-Z0-9_]{2,80}$/

/** "BRANCHES!2" → "BRANCHES tab, row 2"; unknown shapes → '' (the sentence then has no prefix). */
export function describeDealerFileLocation(location?: string): string {
  if (typeof location !== 'string' || location.length > 140) return ''
  const match = /^([A-Z][A-Z_]{1,39})(?:([!.:])(.+))?$/.exec(location)
  if (!match) return ''
  const [, tab, separator, rest] = match
  if (!separator) return `${tab} tab`
  if (separator === '!') {
    const cell = /^(\d{1,6})(?:([:.])(.+))?$/.exec(rest)
    if (!cell) return `${tab} tab`
    const [, row, kind, what] = cell
    if (!kind) return `${tab} tab, row ${row}`
    if (kind === ':') return `${tab} tab, row ${row}, column ${what}`
    return `${tab} tab, row ${row} (${what.replace(/_/g, ' ')})`
  }
  if (separator === '.') return `${tab} tab, column “${rest}”`
  return `${tab} tab (branch reference “${rest}”)`
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function describeDealerFileRefusal(code?: string, location?: string): string {
  const where = describeDealerFileLocation(location)
  const known = code ? DEALER_FILE_REFUSAL_MESSAGES[code] : undefined
  const tail = ' Nothing was saved — correct the file and upload it again.'
  if (known) return (where ? `${where}: ${known}` : capitalise(known)) + tail
  const label = code && CODE.test(code) ? code : 'FILE_REFUSED'
  return `${where ? where + ': t' : 'T'}his file was not accepted (${label}).${tail}`
}

/** Reads `{ code, location }` from an apiRequest failure (its parsed body is on `.data`). */
export function dealerFileRefusalFromError(problem: unknown, fallback: string): string {
  const data = (problem as { data?: { code?: unknown; location?: unknown } } | null)?.data
  const message = problem instanceof Error ? problem.message : ''
  const code = typeof data?.code === 'string' ? data.code : CODE.test(message) ? message : undefined
  if (!code) return message || fallback
  return describeDealerFileRefusal(code, typeof data?.location === 'string' ? data.location : undefined)
}
