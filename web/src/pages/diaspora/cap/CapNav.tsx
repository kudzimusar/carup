/**
 * "On this page" — in-page links to the sections that exist for this viewer. A long, ordered page is navigable by keyboard and by assistive technology
 * without a hidden tab model; the links are plain anchors, so they work with scripting off and are announced as links to a named section.
 */
export function CapNav({ items }: { items: Array<{ id: string; label: string }> }) {
  if (items.length < 4) return null
  return (
    <nav aria-label="On this page" className="mt-5 -mx-1 overflow-x-auto px-1" data-testid="cap-nav">
      <ul className="flex min-w-max gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
