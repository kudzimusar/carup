import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { CommandCenterNav } from './CommandCenterNav'
import { COMMAND_CENTER_SECTIONS } from './commandCenterSections'

function render(active: (typeof COMMAND_CENTER_SECTIONS)[number], badges = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CommandCenterNav basePath="/admin/communications" active={active} badges={badges} />
    </MemoryRouter>,
  )
}

describe('CommandCenterNav', () => {
  it('renders a deep-linkable tab per section with inbox at the base path', () => {
    const html = render('inbox')
    for (const section of COMMAND_CENTER_SECTIONS) {
      expect(html).toContain(`data-testid="section-${section}"`)
    }
    expect(html).toContain('href="/admin/communications"')          // inbox → base
    expect(html).toContain('href="/admin/communications/recovery"') // others → base/section
    expect(html).toContain('href="/admin/communications/providers"')
  })

  it('marks the active section and shows badges', () => {
    const html = render('recovery', { recovery: 3 })
    expect(html).toContain('data-testid="section-recovery"')
    expect(html).toMatch(/data-testid="section-recovery"[^>]*data-active="true"/)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('>3<')
  })
})
