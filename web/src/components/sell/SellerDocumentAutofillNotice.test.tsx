/**
 * Seller document-autofill capability truth (O2 OCR continuation 6).
 *
 * The rule this file protects: the Seller "OCR provider available" badge must reflect the CANONICAL
 * selected OCR runtime (`health.ocr.configured`), never whether some unrelated AI provider holds
 * credentials. With Cloudflare selected but unconfigured and Gemini configured, the surface must NOT
 * claim availability. A failed health read is "could not be checked", never a product claim. Mock
 * reachability never makes the surface claim availability.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SellerDocumentAutofillNotice } from './SellerDocumentAutofillNotice'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mockHealth(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch)
}

function mockHealthReject() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch)
}

const badge = () => screen.getByTestId('seller-autofill-availability')

describe('SellerDocumentAutofillNotice capability truth', () => {
  it('selected cloudflare + configured=true → OCR provider available', async () => {
    mockHealth({ ocr: { selectedProvider: 'cloudflare', selectedModel: '@cf/qwen/qwen3.8-27b', configured: true, mockRuntimeAllowed: false }, ocrProviders: { cloudflare: true, gemini: false } })
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('OCR provider available'))
  })

  it('selected cloudflare + configured=false + gemini=true → NOT available', async () => {
    mockHealth({ ocr: { selectedProvider: 'cloudflare', selectedModel: '@cf/qwen/qwen3.8-27b', configured: false, mockRuntimeAllowed: false }, ocrProviders: { cloudflare: false, gemini: true } })
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('Coming soon on this preview'))
    expect(badge()).not.toHaveTextContent('OCR provider available')
  })

  it('health read fails → Availability could not be checked', async () => {
    mockHealthReject()
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('Availability could not be checked'))
  })

  it('non-ok health response → Availability could not be checked (no product claim)', async () => {
    mockHealth({}, false)
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('Availability could not be checked'))
  })

  it('mockRuntimeAllowed=false + configured=false → never claims availability, never mentions mock', async () => {
    mockHealth({ ocr: { selectedProvider: 'cloudflare', selectedModel: '@cf/qwen/qwen3.8-27b', configured: false, mockRuntimeAllowed: false }, ocrProviders: { cloudflare: false, gemini: true } })
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('Coming soon on this preview'))
    expect(document.body.textContent || '').not.toMatch(/mock/i)
  })

  it('legacy backend without ocr projection → not available (no false positive from ocrProviders map)', async () => {
    // A backend that predates the canonical projection must not render "available" just because
    // some unrelated AI provider has credentials.
    mockHealth({ ocrProviders: { gemini: true, groq: true } })
    render(<SellerDocumentAutofillNotice />)
    await waitFor(() => expect(badge()).toHaveTextContent('Coming soon on this preview'))
    expect(badge()).not.toHaveTextContent('OCR provider available')
  })
})
