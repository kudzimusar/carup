/**
 * RX03 Addendum 05 — the phone masthead search (showroom chrome, below lg). One field that opens the
 * live Marketplace query; on Marketplace it reflects the current query so it never fights the page.
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'

export function ShowroomHeaderSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const current = location.pathname === '/marketplace' ? new URLSearchParams(location.search).get('q') ?? '' : ''
  const [value, setValue] = useState(current)
  const [lastCurrent, setLastCurrent] = useState(current)
  if (current !== lastCurrent) { setLastCurrent(current); setValue(current) }

  return (
    <form
      role="search"
      aria-label="Search cars"
      className="min-w-0 flex-1 lg:hidden"
      onSubmit={event => {
        event.preventDefault()
        const q = value.trim()
        navigate(q ? `/marketplace?q=${encodeURIComponent(q)}` : '/marketplace')
      }}
      data-testid="showroom-header-search"
    >
      <label htmlFor="showroom-header-search-input" className="sr-only">Search make, model or city</label>
      <div className="relative ml-auto max-w-[260px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C2410C]" aria-hidden="true" />
        <input
          id="showroom-header-search-input"
          type="search"
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder="Search cars"
          enterKeyHint="search"
          autoComplete="off"
          className="h-10 w-full rounded-full border-0 bg-[#F1EFEA] pl-9 pr-3 text-[15px] text-[#09122A] placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
        />
      </div>
    </form>
  )
}
