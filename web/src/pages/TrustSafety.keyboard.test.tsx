/**
 * PC01-F F4 — the Trust & Safety evidence dropzone was a clickable <div>: no role, no tab stop, so a
 * keyboard user could never attach evidence (WCAG 2.1.1, level A). It is now a keyboard button: Tab
 * reaches it and Enter or Space opens the same file picker a click does.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { installTailwindVisibility, tabTo } from '@/test/keyboardReach'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const TrustSafety = (await import('./TrustSafety')).default

describe('Trust & Safety evidence attachments', () => {
  it('PC01-F F4: the dropzone is a keyboard button — Tab reaches it, Enter and Space open the file picker', async () => {
    const restore = installTailwindVisibility()
    try {
      const user = userEvent.setup()
      const { container } = render(<MemoryRouter><TrustSafety /></MemoryRouter>)
      const zone = screen.getByRole('button', { name: /click to upload/i })
      const picker = container.querySelector('input[type="file"]') as HTMLInputElement
      const opened = vi.fn()
      picker.addEventListener('click', opened)

      expect(await tabTo(user, zone), 'Tab never reaches the dropzone').toBe(true)
      await user.keyboard('{Enter}')
      expect(opened).toHaveBeenCalledTimes(1)
      await user.keyboard(' ')
      expect(opened).toHaveBeenCalledTimes(2)
    } finally {
      restore()
    }
  })
})
