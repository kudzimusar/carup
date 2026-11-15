import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GalleryStage } from './GalleryStage'
import { MobileContactBar } from './MobileContactBar'
import { DossierNav } from './DossierNav'
import { DossierSection } from './DossierSection'
import { ScoreRing } from './ScoreRing'

/**
 * RX03-P1A-R2 — the Vehicle Detail presentational pieces. None of them reads vehicle data; these
 * tests pin the interaction and docking rules the page relies on.
 */

function stage(count: number, onStep = vi.fn()) {
  render(
    <GalleryStage count={count} onStep={onStep} label="Listing photos" data-testid="stage">
      <img alt="" data-testid="photo" />
      <button type="button">Save</button>
    </GalleryStage>,
  )
  return { el: screen.getByTestId('stage'), onStep }
}

describe('GalleryStage', () => {
  it('is a plain container with fewer than two photos: no role, not focusable, no gesture', () => {
    const { el, onStep } = stage(1)
    expect(el.getAttribute('role')).toBeNull()
    expect(el.getAttribute('tabindex')).toBeNull()
    expect(el.getAttribute('aria-label')).toBeNull()
    fireEvent.keyDown(el, { key: 'ArrowRight' })
    fireEvent.pointerDown(el, { clientX: 300, clientY: 100, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'touch' })
    expect(onStep).not.toHaveBeenCalled()
  })

  it('becomes a focusable, named carousel group with two or more photos', () => {
    const { el } = stage(3)
    expect(el.getAttribute('role')).toBe('group')
    expect(el.getAttribute('aria-roledescription')).toBe('carousel')
    expect(el.getAttribute('aria-label')).toBe('Listing photos')
    expect(el.tabIndex).toBe(0)
  })

  it('steps with ←/→ only while the stage itself has focus', () => {
    const { el, onStep } = stage(3)
    fireEvent.keyDown(el, { key: 'ArrowRight' })
    fireEvent.keyDown(el, { key: 'ArrowLeft' })
    expect(onStep.mock.calls).toEqual([[1], [-1]])
    // Arrow keys on a control inside the stage keep their ordinary meaning.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Save' }), { key: 'ArrowRight' })
    expect(onStep).toHaveBeenCalledTimes(2)
  })

  it('turns a deliberate horizontal swipe into a step, and ignores taps, scrolls and control presses', () => {
    const { el, onStep } = stage(3)
    const swipe = (from: [number, number], to: [number, number], target: Element = el) => {
      fireEvent.pointerDown(target, { clientX: from[0], clientY: from[1], pointerId: 7, pointerType: 'touch' })
      fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 7, pointerType: 'touch' })
    }
    swipe([300, 200], [120, 210]) // leftward → next
    swipe([100, 200], [280, 190]) // rightward → previous
    expect(onStep.mock.calls).toEqual([[1], [-1]])

    swipe([200, 200], [185, 200]) // a tap with a little drift
    swipe([200, 100], [150, 400]) // a vertical scroll
    swipe([300, 200], [100, 200], screen.getByRole('button', { name: 'Save' })) // pressed a control
    expect(onStep).toHaveBeenCalledTimes(2)
  })
})

describe('MobileContactBar', () => {
  it('docks flush with the screen edge when the shell nav stepped aside for the claim', () => {
    render(<MobileContactBar honoured price="$48,500"><button type="button">Contact</button></MobileContactBar>)
    const bar = screen.getByTestId('vehicle-detail-contact-bar')
    expect(bar.getAttribute('data-docked')).toBe('bottom')
    expect(bar.className).toContain('bottom-0')
    expect(bar.className).toContain('pb-[calc(0.75rem+env(safe-area-inset-bottom))]')
    expect(bar.className).toContain('lg:hidden')
    expect(bar.textContent).toContain('$48,500')
    expect(screen.getByRole('button', { name: 'Contact' })).toBeTruthy()
  })

  it('sits above the legacy bottom navigation when no shell honours the claim', () => {
    render(<MobileContactBar honoured={false} price="Price not recorded"><span /></MobileContactBar>)
    const bar = screen.getByTestId('vehicle-detail-contact-bar')
    expect(bar.getAttribute('data-docked')).toBe('above-nav')
    expect(bar.className).toContain('bottom-[calc(4.75rem+env(safe-area-inset-bottom))]')
    expect(bar.className).not.toMatch(/(^|\s)bottom-0(\s|$)/)
    // The governed string is printed as given — the bar never formats or invents a price.
    expect(bar.textContent).toContain('Price not recorded')
  })
})

describe('DossierNav + DossierSection', () => {
  it('renders one real anchor per section and jumps to it, moving focus without a second scroll', () => {
    render(
      <>
        <DossierNav items={[{ id: 'vd-a', label: 'Overview' }, { id: 'vd-b', label: 'Trust' }]} />
        <DossierSection id="vd-a" eyebrow="Overview" title="A"><p>a</p></DossierSection>
        <DossierSection id="vd-b" eyebrow="Trust" title="B"><p>b</p></DossierSection>
      </>,
    )
    const trust = screen.getByRole('link', { name: 'Trust' })
    expect(trust.getAttribute('href')).toBe('#vd-b')
    const target = document.getElementById('vd-b')!
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    fireEvent.click(trust)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(target)
    expect(trust.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })

  it('labels a section by its own heading, or by a heading its content carries', () => {
    render(
      <>
        <DossierSection id="vd-x" eyebrow="Trust" title="Trust and safety"><p /></DossierSection>
        <DossierSection id="vd-y" eyebrow="Evidence" labelledBy="inner"><h2 id="inner">Verified evidence</h2></DossierSection>
      </>,
    )
    expect(screen.getByRole('region', { name: 'Trust and safety' }).id).toBe('vd-x')
    expect(screen.getByRole('region', { name: 'Verified evidence' }).id).toBe('vd-y')
    // No duplicate heading when the content brings its own.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Trust and safety', 'Verified evidence'])
  })
})

describe('ScoreRing', () => {
  it('is decorative and clamps to 0–100', () => {
    const { container } = render(<><ScoreRing value={140} /><ScoreRing value={-5} /></>)
    const svgs = container.querySelectorAll('svg')
    expect(Array.from(svgs).every((svg) => svg.getAttribute('aria-hidden') === 'true')).toBe(true)
    const offsets = Array.from(svgs).map((svg) => Number(svg.querySelectorAll('circle')[1].getAttribute('stroke-dashoffset')))
    expect(offsets[0]).toBeCloseTo(0)
    expect(offsets[1]).toBeCloseTo(2 * Math.PI * 22)
  })
})
