/**
 * CARUP-MVP-STAB-01 F-026 / F-020 — the Help Center's popular searches, and the garage FAQ.
 *
 * F-026: a "Popular searches" chip set the query AND cleared the category, while typing set the
 * query only; and four of the five chips ("ZINARA clearance", "Transit imports", "ZiG payments",
 * "Trust score calculation") matched no FAQ at all. A chip now behaves exactly like typing its own
 * text, and every chip finds at least one answer.
 *
 * F-020: faq-9 promised that independent mechanics "can apply through the Mechanic Directory with
 * their trade certifications". There is no such directory and no independent mechanic activation.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HelpCenter from './HelpCenter'

const renderPage = () => render(<MemoryRouter><HelpCenter /></MemoryRouter>)

/**
 * The FAQ questions currently listed, in order — each question is a heading inside its own toggle
 * button. (The empty state is an h3 too; counting it would make "finds nothing" pass as "finds one".)
 */
const listed = () => {
  const heading = screen.getByRole('heading', { level: 2, name: /FAQ/ })
  const section = heading.closest('section') as HTMLElement
  return within(section).queryAllByRole('heading', { level: 3 })
    .filter((h) => h.closest('button'))
    .map((h) => h.textContent)
}
const chips = () => {
  const label = screen.getByText(/Popular searches:/)
  return within(label.parentElement as HTMLElement).getAllByRole('button')
}
const search = () => screen.getByPlaceholderText(/Search history reports/) as HTMLInputElement
/** The category card (its title is the only h3 of that name; FAQ items carry it as a label). */
const mechanicsCategory = () => screen.getByRole('heading', { level: 3, name: 'For Mechanics' })

describe('popular searches', () => {
  it('every chip finds at least one FAQ, and finds exactly what typing its text finds', () => {
    renderPage()
    const names = chips().map((c) => c.textContent as string)
    expect(names.length).toBe(5)
    for (const name of names) {
      cleanup(); renderPage()
      fireEvent.click(chips().find((c) => c.textContent === name) as HTMLElement)
      const byChip = listed()
      expect(search().value).toBe(name)
      expect(byChip.length, `"${name}" finds nothing`).toBeGreaterThan(0)

      cleanup(); renderPage()
      fireEvent.change(search(), { target: { value: name } })
      expect(listed(), `"${name}": the chip and typing disagree`).toEqual(byChip)
    }
  })

  it('a chip keeps the selected category, exactly as typing does', () => {
    renderPage()
    fireEvent.click(mechanicsCategory())
    fireEvent.click(chips().find((c) => c.textContent === 'PartSentry') as HTMLElement)
    expect(screen.getByRole('heading', { level: 2, name: 'For Mechanics FAQs' })).toBeTruthy()
    const byChip = listed()
    cleanup(); renderPage()
    fireEvent.click(mechanicsCategory())
    fireEvent.change(search(), { target: { value: 'PartSentry' } })
    expect(listed()).toEqual(byChip)
  })
})

describe('the garage and mechanic FAQ (faq-9)', () => {
  it('describes the real path and promises no Mechanic Directory', () => {
    renderPage()
    expect(screen.getByText(
      'Garages and service centres register on CarUp and apply for a garage workspace, and CarUp reviews each application. Independent mechanics can\'t apply on their own yet — a garage can invite its mechanics to join its workspace. CarUp does not inspect garages or accredit anyone, and listing does not make a garage a CarUp partner.',
    )).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Mechanic Directory/)
    expect(document.body.textContent).not.toMatch(/Independent mechanics can apply/)
    expect(document.body.textContent).not.toMatch(/Mechanic network/)
  })
})
