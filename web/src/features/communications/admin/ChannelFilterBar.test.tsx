import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChannelFilterBar } from './ChannelFilterBar'

describe('ChannelFilterBar', () => {
  it('renders a chip per channel with a count, most-active first, plus All', () => {
    const html = renderToStaticMarkup(
      <ChannelFilterBar counts={{ whatsapp: 5, telegram: 2, email: 0 }} active={null} onSelect={() => {}} />,
    )
    expect(html).toContain('All')
    expect(html).toContain('WhatsApp')
    expect(html).toContain('Telegram')
    expect(html).toContain('data-channel="whatsapp"')
    // Zero-count channels are hidden.
    expect(html).not.toContain('data-channel="email"')
    // Most-active channel appears before the less-active one.
    expect(html.indexOf('WhatsApp')).toBeLessThan(html.indexOf('Telegram'))
  })

  it('renders nothing when there are no threads on any channel', () => {
    expect(renderToStaticMarkup(<ChannelFilterBar counts={{ whatsapp: 0 }} active={null} onSelect={() => {}} />)).toBe('')
  })

  it('marks the active channel', () => {
    const html = renderToStaticMarkup(<ChannelFilterBar counts={{ whatsapp: 3 }} active="whatsapp" onSelect={() => {}} />)
    expect(html).toContain('aria-pressed="true"')
  })
})
