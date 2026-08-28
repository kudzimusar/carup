/**
 * Seller Journey 1.0 / S4 — what CarUp can honestly say about a file the seller chose.
 *
 * THE LINE THIS DOES NOT CROSS. The plan forbids inventing an AI or heuristic "good photo" score
 * without a governed signal, and that restraint is the point: telling a seller a photo is blurry,
 * dark or unappealing would be a CarUp judgement about media quality that no source backs, on a
 * platform whose whole proposition is that its judgements are backed.
 *
 * What is left is what the browser actually knows without guessing — the declared type, the byte
 * size, and how many photos the listing already holds. Those are measurements, and each rejection
 * below names the file and the measurement that caused it.
 *
 * THE DEFECT THIS CLOSES. Files failing the `image/*` filter were dropped silently. A seller who
 * picked a PDF of their registration alongside three photos saw three appear and no word about the
 * fourth, so the honest reading of the screen was "CarUp lost my file".
 */

/** The listing cap the authenticated Sell form has always enforced. */
export const LISTING_IMAGE_LIMIT = 15

/**
 * 12 MB. Chosen to comfortably admit a modern phone photo while refusing the multi-hundred-megabyte
 * files that fail late in an upload — the seller learns immediately rather than after a long wait.
 */
export const MAX_LISTING_IMAGE_BYTES = 12 * 1024 * 1024

export interface RejectedListingImage {
  name: string
  reason: string
}

export interface ListingImageIntake {
  accepted: File[]
  rejected: RejectedListingImage[]
}

const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`

/**
 * Screen a batch of chosen files against the deterministic rules, preserving selection order.
 *
 * @param files      what the seller picked
 * @param alreadyHeld how many photos the listing already carries
 */
export function screenListingImages(files: File[], alreadyHeld: number): ListingImageIntake {
  const accepted: File[] = []
  const rejected: RejectedListingImage[] = []
  let remaining = Math.max(0, LISTING_IMAGE_LIMIT - alreadyHeld)

  for (const file of files) {
    const name = file?.name || 'This file'

    if (!String(file?.type || '').startsWith('image/')) {
      rejected.push({ name, reason: 'Not an image file. Listing photos must be JPG or PNG.' })
      continue
    }

    // `>` not `>=`: a file exactly on the limit is within it. An off-by-one here refuses a file the
    // stated rule says is fine, which is worse than no rule.
    if (Number(file?.size) > MAX_LISTING_IMAGE_BYTES) {
      rejected.push({
        name,
        reason: `Too large at ${megabytes(Number(file.size))}. The limit is ${megabytes(MAX_LISTING_IMAGE_BYTES)} per photo.`,
      })
      continue
    }

    if (remaining <= 0) {
      rejected.push({ name, reason: `A listing holds at most ${LISTING_IMAGE_LIMIT} photos.` })
      continue
    }

    accepted.push(file)
    remaining -= 1
  }

  return { accepted, rejected }
}
