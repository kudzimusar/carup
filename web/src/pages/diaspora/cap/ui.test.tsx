import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapSection, Fact, Unshown, UnverifiedMark } from './ui'

describe('Fact', () => {
  it('draws a recorded value, and the words "Not recorded" for anything blank — never an empty gap', () => {
    for (const blank of [null, undefined, '', '   ']) {
      const { container, unmount } = render(<dl><Fact label="Courier" value={blank} /></dl>)
      expect(container.querySelector('dd')).toHaveTextContent('Not recorded')
      unmount()
    }
    render(<dl><Fact label="Mileage" value="134,741 km" /></dl>)
    expect(screen.getByText('Mileage').nextElementSibling).toHaveTextContent('134,741 km')
  })

  it('a zero is a value: it is drawn, not replaced by "Not recorded"', () => {
    render(<dl><Fact label="Seats" value={0} /></dl>)
    expect(screen.getByText('Seats').nextElementSibling).toHaveTextContent('0')
  })

  it('marks a value that is "as recorded, not independently verified" — for the eye and for assistive technology — and never marks an absent one', () => {
    const { rerender } = render(<dl><Fact label="Engine size" value="1,490 cc" marker /></dl>)
    expect(screen.getByTestId('unverified-mark')).toHaveTextContent('†')
    expect(screen.getByTestId('unverified-mark')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Engine size').nextElementSibling).toHaveTextContent('as recorded; not independently verified')
    rerender(<dl><Fact label="Engine size" value={null} marker /></dl>)
    expect(screen.queryByTestId('unverified-mark')).toBeNull()
    rerender(<dl><Fact label="Engine size" value="1,490 cc" /></dl>)
    expect(screen.queryByTestId('unverified-mark')).toBeNull()
  })
})

describe('UnverifiedMark / Unshown / CapSection', () => {
  it('the mark carries its words for people who do not see a dagger', () => {
    const { container } = render(<UnverifiedMark />)
    expect(container.querySelector('.sr-only')).toHaveTextContent('as recorded; not independently verified')
  })

  it('a withheld part and an unreadable part are different sentences, in the projection\'s own words when it gave some', () => {
    const { rerender } = render(<Unshown availability="withheld" />)
    expect(screen.getByText('This is not available to you here.')).toBeInTheDocument()
    rerender(<Unshown availability="unavailable" />)
    expect(screen.getByRole('status')).toHaveTextContent(/could not be read right now.*does not mean there is nothing to show/i)
    rerender(<Unshown availability="withheld" note="Custom words." testId="x" />)
    expect(screen.getByTestId('x')).toHaveTextContent('Custom words.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a section is a named region with a real heading, addressable by its id', () => {
    render(<CapSection id="cap-example" title="Example"><p>body</p></CapSection>)
    const region = screen.getByRole('region', { name: 'Example' })
    expect(region).toHaveAttribute('id', 'cap-example')
    expect(screen.getByRole('heading', { level: 2, name: 'Example' })).toBeInTheDocument()
  })
})
