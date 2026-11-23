/**
 * RX06-LR06 (Owner decision N1) — every refusal the dealer photo upload can return is worded plainly: no internal
 * code, no scanner detail, and "Nothing was saved" only where the server refuses before storing anything.
 */
import { describe, expect, it } from 'vitest'
import { describeMediaUploadFailure } from './mediaUploadFailure'

const refused = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const INTERNAL = /[A-Z]{3,}_[A-Z_]{3,}/ // any internal code shape, e.g. MALWARE_SCANNER_UNAVAILABLE
const SCANNER = /clam|antivirus engine|signature|scanner/i

describe('describeMediaUploadFailure', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['scanner unavailable (503)', refused(503, 'MALWARE_SCANNER_UNAVAILABLE'), /could not check this photo for viruses just now.*Nothing was saved.*Try again in a few minutes/],
    ['infected file (400)', refused(400, 'MALWARE_DETECTED'), /may be harmful.*Nothing was saved.*different photo/],
    ['wrong format', refused(400, 'INVALID_DEALER_MEDIA_FORMAT'), /not a PNG or JPEG photo/],
    ['bytes do not match the type', refused(400, 'DEALER_MEDIA_MAGIC_MISMATCH'), /not a PNG or JPEG photo/],
    ['unreadable bytes', refused(400, 'INVALID_DEALER_MEDIA_BYTES'), /could not be read/],
    ['caption/alt text missing', refused(400, 'ACCESSIBLE_CAPTION_AND_ALT_TEXT_REQUIRED'), /caption and a short description/],
    ['brand logo', refused(422, 'OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED'), /logos cannot be uploaded here/],
    ['category', refused(400, 'INVALID_DEALER_MEDIA_CATEGORY'), /Choose what this photo shows/],
    ['branch', refused(400, 'INVALID_MEDIA_BRANCH_ID'), /Choose the branch/],
    ['storage failed', refused(503, 'PRIVATE_MEDIA_STORAGE_FAILED'), /could not store this photo just now/],
    ['code in the error body', refused(503, 'Service temporarily unavailable', 'MALWARE_SCANNER_UNAVAILABLE'), /could not check this photo for viruses/],
    ['request limit (429)', refused(429, 'Too many requests, please try again later.'), /too many requests.*Nothing was saved.*Wait a minute/],
    ['ended session (401)', refused(401, 'Unauthorized. Session is invalid or expired.'), /session has ended.*Sign in again/],
    ['ended session (typed)', Object.assign(new Error('x'), { name: 'SessionExpiredError' }), /session has ended/],
    ['permission (403)', refused(403, 'DEALER_OPERATING_ACCESS_REQUIRED'), /cannot upload photos for this dealership/],
    ['no connection', new TypeError('Failed to fetch'), /could not be reached.*cannot confirm whether the photo was uploaded/],
    ['unknown server error', refused(500, 'An unexpected internal server error occurred'), /could not confirm this upload.*Check your photo list/],
    ['not an error at all', undefined, /could not confirm this upload/],
  ]
  it.each(cases)('%s', (_name, err, words) => {
    const text = describeMediaUploadFailure(err)
    expect(text).toMatch(words)
    expect(text).not.toMatch(INTERNAL) // the internal code is never shown
    expect(text).not.toMatch(SCANNER) // the virus check is never described in detail
  })

  it('claims "Nothing was saved" only when the server refused before storing anything', () => {
    expect(describeMediaUploadFailure(new TypeError('Failed to fetch'))).not.toMatch(/Nothing was saved/)
    expect(describeMediaUploadFailure(refused(500, 'boom'))).not.toMatch(/Nothing was saved/)
    expect(describeMediaUploadFailure(refused(503, 'MALWARE_SCANNER_UNAVAILABLE'))).toMatch(/Nothing was saved/)
  })
})
