/**
 * CA-OWNER-02 — TEST UTILITY (imported only by tests): the box a control is GUARANTEED at a 390 px viewport.
 *
 * jsdom performs no layout — every element measures 0×0 — so a touch-target test cannot measure. What it can pin is the
 * rule that produces the size: the Tailwind utilities that apply at 390 px. An unprefixed utility applies; a `max-*`
 * breakpoint utility applies too and overrides it (max-sm over max-md over max-lg, Tailwind's own order); a min-width
 * breakpoint (`sm:`, `md:`, `lg:` …) does not apply at 390 px, and neither does a state variant — except `focus:` when
 * asked for, for a skip link that is only visible while focused. Height and width are each the larger of the fixed and
 * the minimum size; a size no utility fixes reads as 0. The real-browser geometry is measured separately.
 */
const APPLY_ORDER = ['', 'focus', 'max-2xl', 'max-xl', 'max-lg', 'max-md', 'max-sm']

function spacingPx(value: string): number | null {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 4
  const px = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value)
  return px ? Number(px[1]) : null
}

export function phoneBox(el: Element, { focused = false }: { focused?: boolean } = {}): { height: number; width: number } {
  const applied: Record<string, { rank: number; px: number }> = {}
  for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
    const m = /^(?:([a-z0-9-]+):)?(min-h|min-w|h|w|size)-(.+)$/.exec(token)
    if (!m) continue
    const variant = m[1] ?? ''
    if (variant === 'focus' && !focused) continue
    const rank = APPLY_ORDER.indexOf(variant)
    const px = spacingPx(m[3])
    if (rank < 0 || px === null) continue
    for (const prop of m[2] === 'size' ? ['h', 'w'] : [m[2]]) {
      if (!applied[prop] || applied[prop].rank <= rank) applied[prop] = { rank, px }
    }
  }
  const at = (prop: string) => applied[prop]?.px ?? 0
  return { height: Math.max(at('h'), at('min-h')), width: Math.max(at('w'), at('min-w')) }
}
