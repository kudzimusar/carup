import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoneyDisplay } from './MoneyDisplay'

describe('MoneyDisplay', () => {
  it('renders amount, explicit currency and source label', () => {
    render(<MoneyDisplay amount={18500} currency="USD" source="asking" />)
    expect(screen.getByTestId('money-value')).toHaveTextContent('$18,500')
    expect(screen.getByText('Asking price')).toBeInTheDocument()
  })

  it('never renders ZiG with a $ glyph — negative case', () => {
    render(<MoneyDisplay amount={7200} currency="ZiG" source="estimate" />)
    const value = screen.getByTestId('money-value')
    expect(value).toHaveTextContent('ZiG 7,200')
    expect(value.textContent).not.toContain('$')
  })

  it('renders the missing state for a null amount — no fabricated figure', () => {
    render(<MoneyDisplay amount={null} currency="USD" source="asking" />)
    expect(screen.getByTestId('money-missing')).toHaveTextContent('Not recorded')
    expect(screen.queryByTestId('money-value')).toBeNull()
  })

  it('renders the missing state when currency is unknown — currency is mandatory', () => {
    render(<MoneyDisplay amount={500} currency="EUR" />)
    expect(screen.getByTestId('money-missing')).toBeInTheDocument()
  })

  it('uses tabular numerals for price alignment (token contract)', () => {
    render(<MoneyDisplay amount={1000} currency="USD" />)
    expect(screen.getByTestId('money-value')).toHaveClass('tabular-nums')
  })

  it('has an accessible label naming source and amount', () => {
    render(<MoneyDisplay amount={9000} currency="ZiG" source="agreed" />)
    expect(screen.getByLabelText(/Agreed price/)).toBeInTheDocument()
    expect(screen.getByLabelText(/ZiG/)).toBeInTheDocument()
  })

  it('supports the large size variant', () => {
    render(<MoneyDisplay amount={25000} currency="USD" size="lg" />)
    expect(screen.getByTestId('money-value').className).toContain('text-[20px]')
  })
})
