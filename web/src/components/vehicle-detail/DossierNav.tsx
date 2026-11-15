import { useEffect, useState, type MouseEvent } from 'react'

/**
 * RX03-P1A-R2 — the in-page section rail for the Vehicle Detail dossier.
 *
 * A horizontal pill scroller on phones and a sticky pill rail from 1024 px. Every item is a real
 * `<a href="#id">`, so the page still works with scripting off and a link can be copied; with
 * scripting on the click scrolls smoothly (instantly under reduced motion) and moves focus to the
 * section without a second jump. The highlighted pill follows the section being read.
 *
 * Purely navigational: it renders the labels it is given and reads nothing about the vehicle.
 */
export type DossierNavItem = { id: string; label: string }

/** Distance from the top of the viewport at which a section counts as "being read". */
const READING_LINE_PX = 168

export function DossierNav({ items, className = '' }: { items: DossierNavItem[]; className?: string }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  const idsKey = items.map((item) => item.id).join('|')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function' || !idsKey) return
    const ids = idsKey.split('|')
    let frame = 0
    const update = () => {
      frame = 0
      let current = ids[0]
      for (const id of ids) {
        const section = document.getElementById(id)
        if (section && section.getBoundingClientRect().top <= READING_LINE_PX) current = id
      }
      // A short last section can never reach the reading line; at the end of the page it is the
      // one being read.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      const last = document.getElementById(ids[ids.length - 1])
      if (atEnd && last && last.getBoundingClientRect().top < window.innerHeight) current = ids[ids.length - 1]
      setActiveId(current)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [idsKey])

  const jumpTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    event.preventDefault()
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    section.focus({ preventScroll: true })
    setActiveId(id)
  }

  return (
    <nav aria-label="Vehicle dossier sections" className={className} data-testid="vehicle-detail-dossier-nav">
      <ul className="carup-rail -mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:scroll-px-0 md:px-0">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                onClick={(event) => jumpTo(event, item.id)}
                aria-current={active ? 'true' : undefined}
                className={`inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-[#09122A] text-white'
                    : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-[#09122A]'
                }`}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
