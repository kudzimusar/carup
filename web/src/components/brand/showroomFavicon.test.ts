/** RX03-P2-R4 R3-09 — Option 5 browser icon with the showroom presentation; untouched when OFF. */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { document.head.innerHTML = ''; vi.doUnmock('@/lib/presentationFlags'); vi.resetModules() })

async function load(on: boolean) {
  vi.resetModules()
  vi.doMock('@/lib/presentationFlags', () => ({ isShowroomChromeEnabled: () => on }))
  return import('./showroomFavicon')
}

describe('applyShowroomFavicon', () => {
  it('flags OFF: leaves the existing index.html icon exactly as it is', async () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    const { applyShowroomFavicon } = await load(false)
    expect(applyShowroomFavicon()).toBe(false)
    expect(document.head.innerHTML).toBe('<link rel="icon" type="image/svg+xml" href="/favicon.svg">')
  })
  it('showroom ON: exactly one icon link, pointing at the ledgered Option 5 app symbol', async () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    const { applyShowroomFavicon } = await load(true)
    expect(applyShowroomFavicon()).toBe(true)
    applyShowroomFavicon()
    const icons = document.head.querySelectorAll('link[rel="icon"]')
    expect(icons).toHaveLength(1)
    expect(icons[0].getAttribute('href')).toContain('carup-app-icon-orange')
    expect(document.head.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1)
  })
})
