/**
 * RX03 Addendum 05 — the showroom masthead navigation (desktop). Purpose-grouped panels from
 * config/showroomNavigation: each panel pairs one featured story (a different form per group) with
 * plain link columns. Same accessible dropdown primitive and navigation analytics as the accepted
 * mega menus; the accepted chrome is unchanged.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, ScanLine, ShieldCheck, Wrench } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { trackNav } from '@/lib/navigationAnalytics'
import type { ShowroomNavGroup } from '@/config/showroomNavigation'
import { AskCarUpMark } from '@/components/showroom/launch/AskCarUpMark'

function FeatureTile({ group, launchPreview }: { group: ShowroomNavGroup; launchPreview: boolean }) {
  const f = group.feature
  const scanPreview = group.id === 'sell' && launchPreview
  // The tile keeps its own colours when it holds focus (hover moves focus in a Radix menu, and a keyboard
  // open focuses the tile first): the menu item's generic focus:bg-accent turned the navy tiles peach with
  // unreadable white copy (axe color-contrast 1.12:1). The `!` is needed because the item classes sit on the Radix
  // Item and these on the Slot child, so stylesheet order decides otherwise. The ring below still shows keyboard focus.
  const tone = group.id === 'import' || group.id === 'explore' || group.id === 'intelligence'
    ? 'bg-[#09122A] text-white focus:!bg-[#09122A] focus:!text-white'
    : 'bg-[#F6F4F0] text-[#09122A] focus:!bg-[#F6F4F0] focus:!text-[#09122A]'
  return (
    <DropdownMenuItem asChild>
      <Link
        to={scanPreview ? '/#scan-to-start' : f.href}
        onClick={() => trackNav({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: f.featureId, node_id: `${group.id}.feature`, destination_route_pattern: f.href })}
        className={`group relative flex min-h-[220px] cursor-pointer flex-col !items-stretch justify-between overflow-hidden rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] ${tone}`}
        data-testid={`showroom-nav-feature-${group.id}`}
      >
        {group.id === 'import' && (
          <img src="/media/home-film/sourcing-landscape-poster.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-500 group-hover:scale-105" onError={event => { event.currentTarget.style.display = 'none' }} />
        )}
        {group.id === 'import' && <div className="absolute inset-0 bg-gradient-to-t from-[#09122A] via-[#09122A]/60 to-transparent" aria-hidden="true" />}
        <div className="relative">
          {group.id === 'explore' && <span className="inline-flex rounded-full bg-white/10 p-1.5 ring-1 ring-white/15"><AskCarUpMark size={30} /></span>}
          {group.id === 'intelligence' && <ShieldCheck className="h-8 w-8 text-[#FE7D18]" aria-hidden="true" />}
          {group.id === 'services' && <Wrench className="h-7 w-7 text-[#C2410C]" aria-hidden="true" />}
          {group.id === 'sell' && (scanPreview
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF1E6] px-2.5 py-1 text-[11px] font-semibold text-[#9A3412]"><ScanLine className="h-3.5 w-3.5" aria-hidden="true" /> Launch preview</span>
            : <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">Sell</span>)}
        </div>
        <div className="relative">
          <p className="text-lg font-bold leading-6 tracking-[-0.015em]">{scanPreview ? 'Scan to Start' : f.title}</p>
          <p className={`mt-1.5 text-[13px] leading-5 ${tone.includes('text-white') ? 'text-white/75' : 'text-slate-600'}`}>
            {scanPreview ? 'Photograph the registration book; CarUp drafts the listing for you to confirm.' : f.copy}
          </p>
          <span className={`mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold ${tone.includes('text-white') ? 'text-[#FFB27A]' : 'text-[#C2410C]'}`}>
            {scanPreview ? 'See how it works' : f.cta} <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </DropdownMenuItem>
  )
}

export function ShowroomMegaNav({ groups, launchPreview }: { groups: ShowroomNavGroup[]; launchPreview: boolean }) {
  return (
    <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main" data-testid="showroom-mega-nav">
      {groups.map(group => (
        <DropdownMenu key={group.id} onOpenChange={open => { if (open) trackNav({ event_type: 'navigation_surface_opened', surface: 'mega_menu', node_id: `showroom-${group.id}` }) }}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[14.5px] font-medium text-[#09122A]/80 transition-colors hover:bg-[#F1EFEA] hover:text-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] data-[state=open]:bg-[#09122A] data-[state=open]:text-white xl:px-3.5"
              data-testid={`showroom-nav-${group.id}`}
            >
              <span aria-hidden="true">{group.shortLabel}</span>
              <span className="sr-only">{group.label}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={12}
            collisionPadding={16}
            className={`${group.columns.length >= 3 ? "w-[min(840px,calc(100vw-2rem))]" : group.columns.length === 2 ? "w-[min(720px,calc(100vw-2rem))]" : "w-[min(580px,calc(100vw-2rem))]"} rounded-3xl border-0 p-3 shadow-[0_30px_80px_-24px_rgba(9,18,42,0.45)] ring-1 ring-black/5`}
            data-testid={`showroom-nav-panel-${group.id}`}
          >
            <div className="grid grid-cols-[250px_minmax(0,1fr)] gap-4">
              <FeatureTile group={group} launchPreview={launchPreview} />
              <div className="grid content-start gap-x-6 gap-y-5 p-2" style={{ gridTemplateColumns: `repeat(${Math.min(group.columns.length, 3)}, minmax(0, 1fr))` }}>
                {group.columns.map((column, columnIndex) => (
                  <div key={column.title} className="min-w-0">
                    <p id={`showroom-nav-${group.id}-col-${columnIndex}`} className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">{column.title}</p>
                    {/* Inside role="menu" a column is a labelled group of menu items (axe aria-required-children /
                        aria-required-parent): the list keeps its layout, not list semantics. */}
                    <ul role="group" aria-labelledby={`showroom-nav-${group.id}-col-${columnIndex}`} className="mt-2 space-y-0.5">
                      {column.links.map(link => (
                        <li key={link.id} role="none">
                          <DropdownMenuItem asChild>
                            <Link
                              to={link.href}
                              onClick={() => trackNav({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: link.featureId, node_id: link.id, destination_route_pattern: link.href })}
                              className="flex min-h-10 cursor-pointer flex-col !items-start justify-center gap-0 rounded-xl px-2 py-1.5 text-left text-[14px] text-[#09122A] outline-none transition-colors hover:bg-[#F6F4F0] focus-visible:bg-[#F6F4F0]"
                              data-testid={`showroom-nav-link-${link.id}`}
                            >
                              <span className="font-medium">{link.label}</span>
                              {link.description && <span className="text-[12px] text-slate-600">{link.description}</span>}
                            </Link>
                          </DropdownMenuItem>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </nav>
  )
}
