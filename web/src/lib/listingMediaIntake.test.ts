/**
 * Seller Journey 1.0 / S4 — deterministic media feedback, and nothing else.
 *
 * The plan is explicit that CarUp must NOT invent an AI or heuristic "good photo" score without a
 * governed signal. Telling a seller their photo is blurry, badly lit or unappealing would be a
 * CarUp judgement about evidence quality that no source backs.
 *
 * What IS honest is what the browser can measure without guessing: the file's declared type, its
 * size, and how many photos the listing already holds. Those are facts, not opinions.
 *
 * The defect this closes: files that failed the `image/*` filter were dropped SILENTLY. A seller who
 * selected a PDF of their registration and three photos saw three photos appear and no explanation
 * for the fourth — so the honest reading of the screen was "CarUp lost my file".
 */
import { describe, expect, it } from 'vitest'
import { LISTING_IMAGE_LIMIT, MAX_LISTING_IMAGE_BYTES, screenListingImages } from './listingMediaIntake'

const file = (name: string, type: string, size: number) =>
  ({ name, type, size }) as File

const photo = (name: string, size = 1_000_000) => file(name, 'image/jpeg', size)

describe('S4 listing media intake', () => {
  it('accepts ordinary photos and reports no complaint', () => {
    const result = screenListingImages([photo('front.jpg'), photo('rear.jpg')], 0)
    expect(result.accepted).toHaveLength(2)
    expect(result.rejected).toEqual([])
  })

  it('names a file it cannot accept instead of dropping it silently', () => {
    const result = screenListingImages([photo('front.jpg'), file('registration.pdf', 'application/pdf', 500)], 0)

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    // The seller must be able to tell WHICH file and WHY — "some files were skipped" is the same
    // silence with extra words.
    expect(result.rejected[0].name).toBe('registration.pdf')
    expect(result.rejected[0].reason).toMatch(/not an image/i)
  })

  it('rejects a file over the size limit, by name', () => {
    const huge = photo('huge.jpg', MAX_LISTING_IMAGE_BYTES + 1)
    const result = screenListingImages([huge], 0)

    expect(result.accepted).toEqual([])
    expect(result.rejected[0].name).toBe('huge.jpg')
    expect(result.rejected[0].reason).toMatch(/too large/i)
    // The limit is stated, so the seller knows what would work.
    expect(result.rejected[0].reason).toMatch(/\d/)
  })

  it('accepts a file exactly on the limit — the boundary is not a rejection', () => {
    const result = screenListingImages([photo('exact.jpg', MAX_LISTING_IMAGE_BYTES)], 0)
    expect(result.accepted).toHaveLength(1)
  })

  it('takes what fits when the listing is near its limit and says what it could not take', () => {
    const result = screenListingImages([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], LISTING_IMAGE_LIMIT - 1)

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(2)
    for (const rejected of result.rejected) {
      expect(rejected.reason).toMatch(new RegExp(String(LISTING_IMAGE_LIMIT)))
    }
  })

  it('accepts nothing once the listing is already full', () => {
    const result = screenListingImages([photo('a.jpg')], LISTING_IMAGE_LIMIT)
    expect(result.accepted).toEqual([])
    expect(result.rejected).toHaveLength(1)
  })

  it('offers no opinion about how good a photo is', () => {
    const result = screenListingImages([photo('dark-and-blurry.jpg')], 0)
    // The file is accepted plainly: the shape carries an accept list and a reject list, and nothing
    // that could hold a verdict.
    expect(Object.keys(result)).toEqual(['accepted', 'rejected'])
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('uses no quality vocabulary in any reason it can produce', () => {
    // Asserted over the REASONS CarUp writes, not over a serialization that would also contain the
    // seller's own filename — a seller may call their file anything.
    const reasons = [
      ...screenListingImages([file('doc.pdf', 'application/pdf', 1)], 0).rejected,
      ...screenListingImages([photo('big.jpg', MAX_LISTING_IMAGE_BYTES + 1)], 0).rejected,
      ...screenListingImages([photo('extra.jpg')], LISTING_IMAGE_LIMIT).rejected,
    ].map(entry => entry.reason)

    expect(reasons).toHaveLength(3)
    for (const reason of reasons) {
      expect(reason).not.toMatch(/quality|score|blurry|blurred|lighting|grade|poor|bad|good/i)
    }
  })

  it('preserves the seller selection order among accepted files', () => {
    const files = [photo('1.jpg'), file('x.pdf', 'application/pdf', 1), photo('2.jpg'), photo('3.jpg')]
    const result = screenListingImages(files, 0)
    expect(result.accepted.map(f => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg'])
  })
})
