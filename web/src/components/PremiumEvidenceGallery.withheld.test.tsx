/**
 * A WITHHELD ARTIFACT MUST NOT CRASH THE PUBLIC PAGE.
 *
 * The security fix makes `file_url` null for a private-bucket document. This gallery then did
 * `item.file_url.endsWith('.pdf')` in three places, and VehicleDetail did it in a fourth.
 *
 * WHY MANUAL BROWSER TESTING MISSED IT, WHICH IS THE POINT OF THIS FILE:
 * the expression is `item.mime_type?.includes('pdf') || item.file_url.endsWith('.pdf')`. The Golden
 * fixture's documents are ALL `application/pdf`, so the first operand short-circuits and the null is
 * never dereferenced. A physical page load therefore passed and proved nothing about this path.
 * An accepted JPEG/PNG document in the private bucket takes the second operand and throws.
 *
 * So the fixture below is deliberately an IMAGE mime type with a null url — the exact combination
 * the Golden dataset cannot produce.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PremiumEvidenceGallery } from './PremiumEvidenceGallery'

/** A verified private-bucket document whose artifact is withheld — image mime, null url. */
const withheldImageDocument = {
  id: 'ev-withheld-image',
  vin: 'CARUPGLDNA0000001',
  evidence_type: 'inspection_photo',
  verification_status: 'verified',
  visibility_level: 'public_safe',
  captured_at: '2026-08-24T02:30:00.000Z',
  uploaded_at: '2026-08-24T02:30:00.000Z',
  verified_at: '2026-08-24T02:35:00.000Z',
  mime_type: 'image/jpeg',
  file_url: null,
  file_availability: 'withheld_private',
  trust_score_impact: 5,
}

const withheldPdfDocument = {
  ...withheldImageDocument,
  id: 'ev-withheld-pdf',
  evidence_type: 'registration_document',
  mime_type: 'application/pdf',
}

const viewablePublicImage = {
  ...withheldImageDocument,
  id: 'ev-public',
  evidence_type: 'inspection_photo',
  mime_type: 'image/png',
  file_url: 'https://cdn.example.test/public/inspection.png',
  file_availability: 'viewable',
}

describe('PremiumEvidenceGallery — withheld private artifacts', () => {
  it('renders an IMAGE-mime withheld document without throwing', () => {
    // Pre-fix this threw `TypeError: Cannot read properties of null (reading 'endsWith')`
    // and took the whole public vehicle page down.
    expect(() =>
      render(<PremiumEvidenceGallery evidence={[withheldImageDocument] as never} />),
    ).not.toThrow()
  })

  it('states that the file is not published rather than rendering a broken image', () => {
    render(<PremiumEvidenceGallery evidence={[withheldImageDocument] as never} />)
    const tile = screen.getByTestId('evidence-file-withheld')
    expect(tile.textContent).toMatch(/file not published/i)
    // An <img src={null}> renders a broken-image glyph, which reads as "this evidence is damaged"
    // rather than "CarUp reviewed this and is not publishing the document".
    expect(tile.querySelector('img')).toBeNull()
  })

  it('handles a PDF-mime withheld document too', () => {
    expect(() =>
      render(<PremiumEvidenceGallery evidence={[withheldPdfDocument] as never} />),
    ).not.toThrow()
    expect(screen.getByTestId('evidence-file-withheld')).toBeTruthy()
  })

  it('a viewable PUBLIC artifact still renders its image — the fix must not over-reach', () => {
    render(<PremiumEvidenceGallery evidence={[viewablePublicImage] as never} />)
    expect(screen.queryByTestId('evidence-file-withheld')).toBeNull()
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example.test/public/inspection.png')
  })

  it('a mixed set renders both states side by side without throwing', () => {
    expect(() =>
      render(
        <PremiumEvidenceGallery
          evidence={[withheldImageDocument, viewablePublicImage, withheldPdfDocument] as never}
        />,
      ),
    ).not.toThrow()
    expect(screen.getAllByTestId('evidence-file-withheld')).toHaveLength(2)
  })
})
