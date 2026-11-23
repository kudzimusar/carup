/**
 * RX06-LR06 (Owner decision N1) — a refused dealer photo upload, said in plain words with what to do next.
 *
 * The server refuses with an internal code (for example MALWARE_SCANNER_UNAVAILABLE). That code is for CarUp, not
 * for the dealer: it is never shown, and the virus check is never described beyond "could not check" or "may be
 * harmful". The refusal itself is unchanged — this only words it.
 *
 * "Nothing was saved" is said only where the server refuses BEFORE storing anything (the virus check, validation,
 * logo rights, the request limit, sign-in and permission). When the outcome is unknown (no answer, or an unexpected
 * server error) the dealer is told CarUp could not confirm the upload and is asked to check the photo list first, so
 * a retry never creates a duplicate by mistake.
 */
import { isNetworkFailure } from '@/components/trade/core/readFailure'

const NOT_SAVED = 'Nothing was saved.'
const FORMAT = `This file is not a PNG or JPEG photo CarUp can accept. ${NOT_SAVED} Choose a PNG or JPEG photo and try again.`
const STORAGE = `CarUp could not store this photo just now, so it was not uploaded. ${NOT_SAVED} Try again later.`
const BRANCH = `Choose the branch this photo belongs to, then upload it again. ${NOT_SAVED}`

const BY_CODE: Record<string, string> = {
  MALWARE_SCANNER_UNAVAILABLE: `CarUp could not check this photo for viruses just now, so it was not uploaded. ${NOT_SAVED} Try again in a few minutes.`,
  MALWARE_DETECTED: `This file was refused because it may be harmful. ${NOT_SAVED} Choose a different photo.`,
  INVALID_DEALER_MEDIA_FORMAT: FORMAT,
  DEALER_MEDIA_MAGIC_MISMATCH: FORMAT,
  INVALID_DEALER_MEDIA_BYTES: `This photo could not be read. ${NOT_SAVED} Choose the photo again, or try a smaller PNG or JPEG.`,
  INVALID_DEALER_MEDIA_ENVELOPE: `The photo did not arrive complete. ${NOT_SAVED} Choose it again and retry.`,
  ACCESSIBLE_CAPTION_AND_ALT_TEXT_REQUIRED: `Add a caption and a short description of what the photo shows (at least 5 characters each), then upload again. ${NOT_SAVED}`,
  OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED: `Manufacturer and brand logos cannot be uploaded here. ${NOT_SAVED} Choose a photo of your own premises or stock.`,
  INVALID_DEALER_MEDIA_CATEGORY: `Choose what this photo shows, then upload it again. ${NOT_SAVED}`,
  INVALID_MEDIA_BRANCH_ID: BRANCH,
  COMPANY_IMAGE_IS_NOT_BRANCH_MEDIA: BRANCH,
  PRIVATE_MEDIA_STORAGE_FAILED: STORAGE,
  DEALER_MEDIA_LOOKUP_UNAVAILABLE: STORAGE,
  DEALER_MEDIA_TICKET_SECRET_UNCONFIGURED: STORAGE,
  STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE: STORAGE,
}

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{5,}$/

export function describeMediaUploadFailure(err: unknown): string {
  const e = (err ?? {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown }
  const status = typeof e.status === 'number' ? e.status : undefined
  const message = typeof e.message === 'string' ? e.message : ''
  const code = typeof e.code === 'string' && e.code ? e.code : CODE_SHAPE.test(message) ? message : undefined
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (status === 429) return `CarUp is receiving too many requests from this connection right now, so the photo was not uploaded. ${NOT_SAVED} Wait a minute, then try again.`
  if (status === 401 || e.name === 'SessionExpiredError') return `Your session has ended, so the photo was not uploaded. ${NOT_SAVED} Sign in again, then upload it again.`
  if (status === 403) return `This account cannot upload photos for this dealership. ${NOT_SAVED}`
  if (isNetworkFailure(status, message)) return 'CarUp could not be reached from this device, so CarUp cannot confirm whether the photo was uploaded. Check the connection and your photo list below before trying again.'
  return 'CarUp could not confirm this upload. Check your photo list below before trying again; if the photo is not there, try again in a few minutes.'
}
