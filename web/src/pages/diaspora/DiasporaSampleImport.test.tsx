/**
 * LR02 — the public sample journey (/diaspora/sample).
 *  - every sample order in every mode (seven sections + Passport) is rendered by the REAL Import Order view,
 *    labelled SAMPLE, with no write control and no link to a real order (/diaspora/imports/...) or a
 *    protected tool (/admin/..., /diaspora/containers): links stay in the sample or go to the Trade entry;
 *    the one exit besides the entry is the public request preparation, outside the sample order;
 *  - every identifier in the sample data carries SAMPLE;
 *  - it reads nothing (no fetch);
 *  - with the Trade presentation off it is "not found".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DiasporaSampleImport from './DiasporaSampleImport'
import { SAMPLE_BUYER_ID, SAMPLE_MODES, SAMPLE_ORDERS } from '@/content/trade/sampleImportJourney'

const flags = vi.hoisted(() => ({ showroom: true, unified: false }))
vi.mock('@/lib/presentationFlags', async importOriginal => ({ ...(await importOriginal<object>()), isShowroomPagesEnabled: () => flags.showroom }))
vi.mock('@/components/shell/unifiedFlag', async importOriginal => ({ ...(await importOriginal<object>()), isUnifiedUiEnabled: () => flags.unified }))

const fetchSpy = vi.fn(() => Promise.reject(new Error('the sample must not read anything')))

function mountAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/diaspora/sample" element={<DiasporaSampleImport />} /></Routes>
    </MemoryRouter>,
  )
}

const hrefs = (el: Element) => [...el.querySelectorAll('a[href]')].map(a => a.getAttribute('href') ?? '')
const IN_SAMPLE = (href: string) => /^\/diaspora\/sample(\?|$)/.test(href)
const REAL_ORDER_OR_TOOL = /^\/(diaspora\/(imports|containers|rfq|stock|safetrade|subscription|trade-profile|trade-graph|drive|workbook|ai-commands)|admin)\b/

beforeEach(() => {
  flags.showroom = true
  flags.unified = false
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe.each(SAMPLE_ORDERS.map(sample => [sample.key, sample] as const))('sample order “%s”', (key, sample) => {
  it.each(SAMPLE_MODES)('%s: read-only, labelled SAMPLE, and every link stays in the sample', mode => {
    const { container } = mountAt(`/diaspora/sample?order=${key}&mode=${mode}`)

    const view = screen.getByTestId('trade-order-view')
    expect(view).toHaveAttribute('data-state', 'ready')
    expect(view).toHaveAttribute('data-mode', mode)
    expect(screen.getByTestId('trade-order-reference')).toHaveTextContent(/^SAMPLE\d\d$/)
    expect(screen.getByTestId('trade-order-reference')).toHaveTextContent(sample.order.id.slice(0, 8))

    const banner = screen.getByTestId('trade-sample-banner')
    expect(banner).toHaveTextContent('SAMPLE — an illustrative import, not a real order. Nothing here can be changed.')
    expect(banner).toHaveTextContent('This is how an import order looks to its buyer.')

    // No write control anywhere: no form, field, select or button.
    expect(container.querySelectorAll('form, input, select, textarea, button')).toHaveLength(0)

    // Inside the sample order: only sample links and the back link to the Trade entry.
    const order = screen.getByTestId('trade-sample-order')
    expect(hrefs(order).filter(h => !(IN_SAMPLE(h) || h === '/diaspora'))).toEqual([])
    expect(hrefs(order).filter(h => REAL_ORDER_OR_TOOL.test(h))).toEqual([])
    expect(within(order).getByTestId('trade-order-back')).toHaveAttribute('href', '/diaspora')

    // The whole page: the one other link is the public request preparation, outside the sample order.
    const others = hrefs(container).filter(h => !(IN_SAMPLE(h) || h === '/diaspora'))
    expect(others).toEqual(['/diaspora/imports/new'])
    expect(order.contains(screen.getByTestId('trade-sample-start'))).toBe(false)

    // It reads nothing.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the sample journey page', () => {
  it('order links keep you in the sample: tabs, Passport, the phase chooser (keeping the section) and the back link', () => {
    mountAt('/diaspora/sample?order=request&mode=quotes')
    const tabs = within(screen.getByTestId('trade-order-tabs'))
    expect(tabs.getByRole('link', { name: /^Quotes/ })).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByRole('link', { name: /^Documents/ })).toHaveAttribute('href', '/diaspora/sample?order=request&mode=documents')
    expect(tabs.getByRole('link', { name: /^Shipping & CAP/ })).toHaveAttribute('href', '/diaspora/sample?order=request&mode=shipping')
    expect(tabs.getByRole('link', { name: /^Overview/ })).toHaveAttribute('href', '/diaspora/sample?order=request')
    expect(screen.getByTestId('trade-order-passport-link')).toHaveAttribute('href', '/diaspora/sample?order=request&mode=passport')
    expect(screen.getByTestId('trade-sample-phase-sea')).toHaveAttribute('href', '/diaspora/sample?order=sea&mode=quotes')
    expect(screen.getByTestId('trade-sample-phase-request')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('trade-order-back')).toHaveTextContent('CarUp Trade')
  })

  it('the phase chooser lists the seven phases, then the three exceptions', () => {
    mountAt('/diaspora/sample')
    const chooser = screen.getByTestId('trade-sample-chooser')
    expect(within(chooser).getAllByRole('link').map(a => a.getAttribute('data-testid'))).toEqual(
      ['request', 'documents', 'loading', 'sea', 'customs', 'ready', 'handover', 'flagged', 'disputed', 'cancelled'].map(k => `trade-sample-phase-${k}`),
    )
  })

  it('an unknown order or mode falls back to the first sample and its overview', () => {
    mountAt('/diaspora/sample?order=46d0a2be-real-order&mode=delete')
    expect(screen.getByTestId('trade-sample')).toHaveAttribute('data-sample-order', 'request')
    expect(screen.getByTestId('trade-order-view')).toHaveAttribute('data-mode', 'overview')
  })

  it('shows the order to its buyer (the sample buyer is “You”), never as an operator', () => {
    mountAt('/diaspora/sample?order=documents&mode=passport')
    expect(screen.getByTestId('order-passport-buyer')).toHaveTextContent('You')
    expect(screen.queryByTestId('trade-next-step-operator')).toBeNull()
  })

  it('with the Trade presentation off it is not found; either presentation shows it', () => {
    flags.showroom = false
    mountAt('/diaspora/sample')
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-sample')).toBeNull()
    cleanup()
    flags.unified = true
    mountAt('/diaspora/sample')
    expect(screen.getByTestId('trade-sample')).toBeInTheDocument()
  })
})

describe('the sample data', () => {
  /** Every identifier-like value (ids, account references, VINs, chassis and lot numbers, files, refs, carriers, seals). */
  function identifiers(value: unknown, key = '', out: Array<[string, string]> = []): Array<[string, string]> {
    if (Array.isArray(value)) value.forEach(v => identifiers(v, key, out))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => identifiers(v, k, out))
    else if (typeof value === 'string' && /(^id$|_id$|_by$|^documentId$|vin|Vin|chassis|lot_number|file_name|tracking_number|carrier_name|external_reference|cryptographic_seal)/.test(key)) out.push([key, value])
    return out
  }

  it('every identifier carries SAMPLE', () => {
    const all = SAMPLE_ORDERS.flatMap(sample => identifiers(sample))
    expect(all.length).toBeGreaterThan(200)
    expect(all.filter(([, v]) => !v.includes('SAMPLE'))).toEqual([])
  })

  it('one order per phase, then the three exceptions, all for the one sample buyer, with unique ids', () => {
    expect(SAMPLE_ORDERS.map(s => s.order.status)).toEqual([
      'QUOTE_ISSUED', 'DOCUMENTS_PENDING', 'CONTAINER_BOOKED', 'SHIPPED', 'DUTY_PENDING', 'ROADWORTHINESS_PENDING', 'COMPLETED',
      'FLAGGED_FOR_REVIEW', 'DISPUTED', 'CANCELLED',
    ])
    expect(SAMPLE_ORDERS.every(s => s.order.buyer_id === SAMPLE_BUYER_ID)).toBe(true)
    const ids = SAMPLE_ORDERS.flatMap(sample => identifiers(sample)).filter(([k]) => k === 'id').map(([, v]) => v)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
