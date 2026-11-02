/** Launch truth: incident intake is unavailable, never a pretend evidence uploader. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { installTailwindVisibility, tabTo } from '@/test/keyboardReach'
import TrustSafety from './TrustSafety'

describe('Trust & Safety truthful keyboard actions', () => {
  it('does not present an upload/send form when incident intake is unavailable', () => {
    const { container } = render(<MemoryRouter><TrustSafety /></MemoryRouter>)
    expect(screen.getByTestId('trust-report-submit')).toBeDisabled()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.getByTestId('trust-report-unavailable')).toHaveTextContent('In-product reporting is not available')
  })
  it('keeps the real support email reachable by keyboard', async () => {
    const restore = installTailwindVisibility()
    try {
      const user = userEvent.setup()
      render(<MemoryRouter><TrustSafety /></MemoryRouter>)
      const support = screen.getByRole('link', { name: 'support@carup.dev' })
      expect(support).toHaveAttribute('href', 'mailto:support@carup.dev')
      expect(await tabTo(user, support)).toBe(true)
    } finally { restore() }
  })
})
