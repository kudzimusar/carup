/** RX03-P2-R4 — a signed-out save says it lives on this device only and offers sign-in. */
import { describe, expect, it, vi } from 'vitest'
const success = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => success(...a) } }))

describe('announceGuestSave', () => {
  it('names the device-only scope and links sign-in back to this page', async () => {
    const { announceGuestSave } = await import('./guestSave')
    window.history.pushState({}, '', '/marketplace?make=Toyota')
    const navigate = vi.fn()
    announceGuestSave('Toyota Vitz', navigate)
    const [title, opts] = success.mock.calls[0] as [string, { description: string; action: { label: string; onClick: () => void } }]
    expect(title).toBe('Toyota Vitz saved on this device')
    expect(opts.description).toMatch(/not in a CarUp account/)
    opts.action.onClick()
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?returnTo=/))
    expect(decodeURIComponent(navigate.mock.calls[0][0])).toContain('/marketplace?make=Toyota')
  })
})
