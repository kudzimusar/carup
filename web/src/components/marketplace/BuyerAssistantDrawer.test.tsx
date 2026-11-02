// @vitest-environment jsdom
/**
 * OC-3E-W1 — the buyer assistant tells a visitor WHY its guidance is not AI-assisted.
 *
 * The backend never spends paid inference on a signed-out visitor: it answers with deterministic
 * safe guidance, `ai_available: false` and `ai_reason: 'sign_in_required'`. The drawer must show
 * that guidance and say how to get AI assistance — not claim the provider is down, and not claim
 * the guidance is AI when it is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const marketplaceAiBuyerAssistant = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ marketplaceAiBuyerAssistant }),
}))

const { BuyerAssistantDrawer } = await import('./BuyerAssistantDrawer')

async function askWith(answer: unknown) {
  marketplaceAiBuyerAssistant.mockResolvedValueOnce(answer)
  const user = userEvent.setup()
  render(<BuyerAssistantDrawer />)
  await user.click(screen.getByTestId('marketplace-ai-assistant-open'))
  await user.click(await screen.findByTestId('marketplace-ai-assistant-ask'))
  return screen.findByTestId('marketplace-ai-assistant-result')
}

afterEach(() => { cleanup(); marketplaceAiBuyerAssistant.mockReset() })

describe('BuyerAssistantDrawer — AI availability is stated truthfully', () => {
  it('a signed-out visitor sees safe guidance and is told to sign in for AI assistance', async () => {
    const result = await askWith({ guidance: ['Use the verified inquiry flow.'], ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'sign_in_required' })
    expect(result.textContent).toContain('Use the verified inquiry flow.')
    expect(screen.getByTestId('marketplace-ai-assistant-fallback').textContent).toBe('Sign in for AI-assisted guidance — showing safe guidance')
  })

  it('a provider outage still says the AI is unavailable', async () => {
    await askWith({ guidance: ['Prefer listings with verified evidence.'], ai_status: 'ai_unavailable', ai_available: false })
    expect(screen.getByTestId('marketplace-ai-assistant-fallback').textContent).toBe('AI unavailable — showing safe guidance')
  })

  it('an AI answer WITHHELD for commenting on price or value says so (REL-01 label, now pinned)', async () => {
    await askWith({ guidance: ['Use the verified inquiry flow.'], ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'ai_output_withheld' })
    expect(screen.getByTestId('marketplace-ai-assistant-fallback').textContent).toBe('AI answer withheld (it commented on price or value) — showing safe guidance')
  })

  it('an AI call that TIMED OUT says so, and invites asking again — not that the AI is down', async () => {
    await askWith({ guidance: ['Prefer listings with verified evidence.'], ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'ai_timeout' })
    expect(screen.getByTestId('marketplace-ai-assistant-fallback').textContent).toBe('AI took too long to answer — showing safe guidance. You can ask again.')
  })

  it('an unknown or absent reason still reads as plain unavailability (the timeout label is specific)', async () => {
    await askWith({ guidance: ['Prefer listings with verified evidence.'], ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'something_else' })
    expect(screen.getByTestId('marketplace-ai-assistant-fallback').textContent).toBe('AI unavailable — showing safe guidance')
  })

  it('AI-assisted guidance carries no fallback badge (positive control)', async () => {
    const result = await askWith({ guidance: ['Shortlist two diesel pickups under budget.'], ai_status: 'ai_assisted', ai_available: true })
    expect(result.textContent).toContain('Shortlist two diesel pickups under budget.')
    expect(screen.queryByTestId('marketplace-ai-assistant-fallback')).toBeNull()
  })
})
