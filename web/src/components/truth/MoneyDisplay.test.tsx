import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoneyDisplay } from './MoneyDisplay'

describe('MoneyDisplay', () => {
  it('renders amount, a VISIBLE currency code and the source label', () => {
    render(<MoneyDisplay amount={18500} currency="USD" source="asking" />)
    expect(screen.getByTestId('money-value')).toHaveTextContent('$18,500')
    expect(screen.getByTestId('money-currency')).toHaveTextContent('USD')
    expect(screen.getByText('Asking price')).toBeInTheDocument()
  })

  it('the USD currency code is visibly rendered, not screen-reader-only — R1-01', () => {
    render(<MoneyDisplay amount={18500} currency="USD" source="asking" />)
    const code = screen.getByTestId('money-currency')
    expect(code.textContent).toBe('USD')
    expect(code.className).not.toContain('sr-only')
    expect(screen.getByText('USD')).toBeVisible()
  })

  it('never renders ZiG with a $ glyph — negative case', () => {
    render(<MoneyDisplay amount={7200} currency="ZiG" source="estimate" />)
    const value = screen.getByTestId('money-value')
    expect(value).toHaveTextContent('7,200')
    expect(screen.getByTestId('money-currency')).toHaveTextContent('ZiG')
    expect(value.textContent).not.toContain('$')
  })

  it('renders the missing state for a null amount — no fabricated figure', () => {
    render(<MoneyDisplay amount={null} currency="USD" source="asking" />)
    expect(screen.getByTestId('money-missing')).toHaveTextContent('Not recorded')
    expect(screen.queryByTestId('money-value')).toBeNull()
  })

  it('unsupported currency ≠ missing amount — the amount stays visible, only the currency is flagged — R1-01', () => {
    render(<MoneyDisplay amount={500} currency="EUR" />)
    // The amount IS present: it must not be misrepresented as "Not recorded".
    expect(screen.getByTestId('money-value')).toHaveTextContent('500')
    expect(screen.getByTestId('money-currency-missing')).toHaveTextContent('Currency not recorded')
    expect(screen.queryByTestId('money-missing')).toBeNull()
  })

  it('uses tabular numerals for price alignment (token contract)', () => {
    render(<MoneyDisplay amount={1000} currency="USD" />)
    expect(screen.getByTestId('money-value')).toHaveClass('tabular-nums')
  })

  it('has an accessible label naming source, amount and currency', () => {
    render(<MoneyDisplay amount={9000} currency="ZiG" source="agreed" />)
    expect(screen.getByLabelText(/Agreed price/)).toBeInTheDocument()
    expect(screen.getByLabelText(/9,000 ZiG/)).toBeInTheDocument()
  })

  it('supports the large size variant', () => {
    render(<MoneyDisplay amount={25000} currency="USD" size="lg" />)
    expect(screen.getByTestId('money-value').className).toContain('text-[20px]')
  })
})
