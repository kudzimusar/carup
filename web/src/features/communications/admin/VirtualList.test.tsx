import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VirtualList } from './VirtualList'

describe('VirtualList', () => {
  it('mounts only a bounded window of rows regardless of total item count', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => ({ id: `row-${i}` }))
    const html = renderToStaticMarkup(
      <VirtualList
        items={items}
        itemHeight={96}
        height={560}
        overscan={6}
        getKey={(it) => it.id}
        renderItem={(it) => <div data-testid="v-row">{it.id}</div>}
      />,
    )
    const mounted = (html.match(/data-testid="v-row"/g) || []).length
    // A 560px viewport at 96px/row ≈ 6 visible + 12 overscan ≈ 18 rows — never 10,000.
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(40)
    // The full scroll height is still represented (spacer = total * itemHeight).
    expect(html).toContain(`height:${10_000 * 96}px`)
    // The first rows are in the initial window; a deep row is NOT mounted.
    expect(html).toContain('row-0')
    expect(html).not.toContain('row-9999')
  })

  it('renders a footer (e.g. Load more) after the rows', () => {
    const html = renderToStaticMarkup(
      <VirtualList items={[{ id: 'a' }]} itemHeight={96} height={200} getKey={(it) => it.id} renderItem={(it) => <span>{it.id}</span>} footer={<button>Load more</button>} />,
    )
    expect(html).toContain('Load more')
  })
})
