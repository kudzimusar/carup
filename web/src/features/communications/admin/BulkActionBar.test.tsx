import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BulkActionBar } from './BulkActionBar'

describe('BulkActionBar', () => {
  it('renders nothing when nothing is selected', () => {
    expect(renderToStaticMarkup(<BulkActionBar count={0} onClear={() => {}} />)).toBe('')
  })

  it('shows the selection count and actions', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={3} onAssignToMe={() => {}} onResolve={() => {}} onClear={() => {}} />,
    )
    expect(html).toContain('3 selected')
    expect(html).toContain('Assign to me')
    expect(html).toContain('Resolve')
    expect(html).toContain('Clear')
  })

  it('surfaces a partial-failure result note', () => {
    const html = renderToStaticMarkup(<BulkActionBar count={2} resultNote="Assigned 1 · 1 failed" onClear={() => {}} />)
    expect(html).toContain('Assigned 1 · 1 failed')
  })
})
