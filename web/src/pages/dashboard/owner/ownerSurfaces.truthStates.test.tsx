/**
 * SJO-5 / SJO-7 — three owner/Seller surfaces that turned a FAILED read into a measured claim.
 *
 * Each was confirmed by independent adversarial verification on the joined #194 head. The rule in
 * all three cases is the same one PartsTracking already encodes: a value that has not been
 * successfully read must never render as a measured result, and a genuine value AFTER a successful
 * read is correct and must keep rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, screen, waitFor } from '@testing-library/react'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

// ═══════════════════════════════════════════════════════════════════════════════════
// SellerIntelligence — an unreadable listing set rendered as an empty comparison table
// ═══════════════════════════════════════════════════════════════════════════════════

describe('SellerIntelligence listing comparison (SJO-5)', () => {
  const SRC = read('./SellerIntelligence.tsx')

  it('tracks the owned-vehicles read separately from the pulse read', () => {
    // The four reads settle INDEPENDENTLY under Promise.allSettled, and a rejected owned-vehicles
    // read becomes []. Deriving the page state from the PULSE result alone meant a failed vehicles
    // read still rendered state 'ready' — with a table body of zero rows.
    expect(SRC).toMatch(/vehiclesRead: vehicleResult\.status === 'fulfilled'/)
    expect(SRC).toMatch(/const vehiclesRead = settled\?\.key === readKey \? settled\.vehiclesRead : false/)
  })

  it('an unread listing set is stated, not rendered as "no listings"', () => {
    expect(SRC).toMatch(/seller-intelligence-listings-unavailable/)
    expect(SRC).toMatch(/it is not a statement that you have no listings/)
    // And a SUCCESSFUL empty read still gets its own honest, distinct message.
    expect(SRC).toMatch(/seller-intelligence-no-listings/)
    expect(SRC).toMatch(/You have no listings yet/)
    // The two must be different branches, or the distinction is cosmetic.
    const unavailableAt = SRC.indexOf('seller-intelligence-listings-unavailable')
    const noneAt = SRC.indexOf('seller-intelligence-no-listings')
    expect(unavailableAt).toBeGreaterThan(-1)
    expect(noneAt).toBeGreaterThan(unavailableAt)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════
// VehicleProfile — a governed insurance record rendered a bare "$" with no figure
// ═══════════════════════════════════════════════════════════════════════════════════

describe('VehicleProfile insurance record (SJO-5)', () => {
  const SRC = read('./VehicleProfile.tsx')

  it('never prints a money token for a premium CarUp does not hold', () => {
    // The passport-timeline mapper sets `insurer` and leaves premium/type/provider/expiryDate
    // absent; the renderer read `ir.provider` and `${ir.premium}/year`, so EVERY governed record
    // printed a blank provider and a bare "$/year". A currency symbol with no amount is not a
    // smaller fact than a premium — it is an invented one.
    expect(SRC).not.toMatch(/\$\{ir\.premium\}/)
    expect(SRC).not.toMatch(/\{ir\.provider\}/)
    expect(SRC).not.toMatch(/\{ir\.type\}/)
  })

  it('names the absent fields instead of leaving them blank', () => {
    expect(SRC).toMatch(/insurance-record-insurer/)
    expect(SRC).toMatch(/Insurer not recorded/)
    expect(SRC).toMatch(/Policy: \{ir\.policyNumber \|\| 'not recorded'\}/)
    expect(SRC).toMatch(/end date not recorded/)
    expect(SRC).toMatch(/premium are not held by CarUp for this record/)
  })

  it('the unknown-cast that let the shape through is gone', () => {
    // `as unknown as InsuranceRecord[]` bypassed the compiler and is exactly how a shape
    // satisfying none of the required fields reached a renderer that dereferenced them.
    expect(SRC).not.toMatch(/as unknown as InsuranceRecord\[\]/)
    expect(SRC).toMatch(/\)\) as InsuranceRecord\[\]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════
// SellerDocumentAutofillNotice — a failed health read became a product claim
// ═══════════════════════════════════════════════════════════════════════════════════

describe('SellerDocumentAutofillNotice availability (SJO-7)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => { vi.resetModules() })
  afterEach(() => { globalThis.fetch = originalFetch })

  async function renderNotice() {
    const { SellerDocumentAutofillNotice } = await import('@/components/sell/SellerDocumentAutofillNotice')
    return render(<SellerDocumentAutofillNotice />)
  }

  it('a FAILED health read is never published as "Coming soon"', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
    await renderNotice()
    await waitFor(() =>
      expect(screen.getByTestId('seller-autofill-availability').textContent)
        .toMatch(/could not be checked/i))
    // "Coming soon on this preview" is a statement about the PRODUCT. A network fault is not.
    expect(screen.getByTestId('seller-autofill-availability').textContent)
      .not.toMatch(/coming soon/i)
  })

  it('a non-OK health response is a failed read, not an answer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    await renderNotice()
    await waitFor(() =>
      expect(screen.getByTestId('seller-autofill-availability').textContent)
        .toMatch(/could not be checked/i))
  })

  it('ANTI-VACUITY: a SUCCESSFUL read with no providers still says "Coming soon"', async () => {
    // The genuine measured negative must survive — the fix suppresses an UNMEASURED claim only.
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ocrProviders: {} }) }) as unknown as typeof fetch
    await renderNotice()
    await waitFor(() =>
      expect(screen.getByTestId('seller-autofill-availability').textContent)
        .toMatch(/coming soon/i))
  })

  it('a SUCCESSFUL read with a live provider reports it available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ocrProviders: { gemini: true } }) }) as unknown as typeof fetch
    await renderNotice()
    await waitFor(() =>
      expect(screen.getByTestId('seller-autofill-availability').textContent)
        .toMatch(/provider available/i))
  })
})
