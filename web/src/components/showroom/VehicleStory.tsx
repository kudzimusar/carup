/**
 * RX04-B / I-02 — Vehicle Story: what CarUp knows about this car, chapter by chapter, and where it
 * came from. Every chapter is computed by the page from reads it already made; this component only
 * arranges them. A chapter with nothing recorded says so — it never borrows a stronger provenance,
 * and a vehicle without reviewed evidence never looks reviewed.
 *
 * Provenance vocabulary (CarUp's own): reviewed evidence ("Reviewed by CarUp"), governed records
 * ("Governed record"), seller statements ("Seller-stated"), and "Not recorded".
 */
import { ArrowDown, BadgeCheck, CircleDashed, FileText, History, IdCard, Landmark, ShieldCheck, Store, Wrench } from 'lucide-react'

export type StoryProvenance = 'reviewed' | 'governed' | 'seller' | 'none' | 'loading'

export interface StoryChapter {
  key: 'identity' | 'history' | 'evidence' | 'ownership' | 'service' | 'documents' | 'trust' | 'marketplace'
  title: string
  /** One plain sentence: what is known (or that nothing is). */
  summary: string
  provenance: StoryProvenance
  /** In-page anchor of the chapter's full content. */
  anchor: string
}

const PROVENANCE: Record<StoryProvenance, { label: string; className: string }> = {
  reviewed: { label: 'Reviewed by CarUp', className: 'bg-status-success-soft text-status-success' },
  governed: { label: 'Governed record', className: 'bg-status-info-soft text-status-info' },
  seller: { label: 'Seller-stated', className: 'bg-carup-action-soft text-carup-action-hover' },
  none: { label: 'Not recorded', className: 'bg-carup-bg-surface-2 text-carup-text-2' },
  loading: { label: 'Loading', className: 'bg-carup-bg-surface-2 text-carup-text-3' },
}

const ICONS: Record<StoryChapter['key'], typeof IdCard> = {
  identity: IdCard,
  history: History,
  evidence: BadgeCheck,
  ownership: Landmark,
  service: Wrench,
  documents: FileText,
  trust: ShieldCheck,
  marketplace: Store,
}

export function VehicleStoryOverview({ chapters, vehicleName }: { chapters: StoryChapter[]; vehicleName: string }) {
  const known = chapters.filter(chapter => chapter.provenance !== 'none' && chapter.provenance !== 'loading').length
  return (
    <section id="vd-story" className="scroll-mt-28 pb-10" aria-labelledby="vd-story-title" data-testid="vehicle-story">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-3">Vehicle Story</p>
      <h2 id="vd-story-title" className="mt-2 text-[clamp(1.5rem,2.4vw,2.125rem)] font-bold leading-[1.08] tracking-[-0.03em] text-carup-text">
        What CarUp knows about this {vehicleName}
      </h2>
      <p className="mt-3 max-w-[68ch] text-[15px] leading-6 text-carup-text-2" data-testid="vehicle-story-summary">
        {known} of {chapters.length} chapters have something on record. Each one says where it came from — reviewed evidence, a governed record or the seller’s own statement — and what is still unknown.
      </p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {chapters.map((chapter, index) => {
          const Icon = ICONS[chapter.key]
          const provenance = PROVENANCE[chapter.provenance]
          const empty = chapter.provenance === 'none'
          return (
            <li key={chapter.key} className="min-w-0">
              <a
                href={`#${chapter.anchor}`}
                className={`group flex h-full flex-col rounded-card p-4 ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${empty ? 'bg-carup-bg-surface ring-carup-line' : 'bg-carup-bg-raised ring-carup-line hover:ring-carup-text-3'}`}
                data-testid={`vehicle-story-chapter-${chapter.key}`}
                data-provenance={chapter.provenance}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">
                    <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${provenance.className}`}>
                    {chapter.provenance === 'none' && <CircleDashed className="h-3 w-3" aria-hidden="true" />}
                    {provenance.label}
                  </span>
                </span>
                <span className={`mt-3 text-[15px] font-semibold ${empty ? 'text-carup-text-2' : 'text-carup-text'}`}>{chapter.title}</span>
                <span className="mt-1 text-[13px] leading-5 text-carup-text-2">{chapter.summary}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[12px] font-semibold text-carup-text-3 group-hover:text-carup-text">
                  Read <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** A chapter heading inside the dossier, so the story reads in order without tabs hiding any of it. */
export function StoryChapterHeading({ id, index, title, provenance, note }: { id: string; index: number; title: string; provenance?: StoryProvenance; note?: string }) {
  const p = provenance ? PROVENANCE[provenance] : null
  return (
    <div id={id} className="scroll-mt-28 border-t border-carup-line pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3 tabular-nums">Chapter {String(index).padStart(2, '0')}</span>
        {p && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.className}`}>{p.label}</span>}
      </div>
      <h3 className="mt-1.5 text-lg font-semibold tracking-[-0.015em] text-carup-text">{title}</h3>
      {note && <p className="mt-1 max-w-[68ch] text-[13px] leading-5 text-carup-text-2">{note}</p>}
    </div>
  )
}
