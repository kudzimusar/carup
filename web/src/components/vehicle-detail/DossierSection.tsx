import type { ReactNode } from 'react'

/**
 * RX03-P1A-R2 — one open section of the Vehicle Detail dossier: an eyebrow, an optional `<h2>`, a
 * hairline above, generous space, and no box. A section whose content already carries its own
 * `<h2>` (Verified evidence) passes `labelledBy` instead of a title so the outline never gains a
 * duplicate heading.
 *
 * Focusable with `tabIndex={-1}` so the dossier rail can move focus here after a jump. From 1024 px
 * the scroll margin tucks the section's own hairline under the sticky dossier rail, so a jump never
 * shows two rules stacked.
 */
export function DossierSection({
  id,
  eyebrow,
  title,
  labelledBy,
  children,
  className = '',
}: {
  id: string
  eyebrow: string
  title?: ReactNode
  labelledBy?: string
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-title`
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={title ? headingId : labelledBy}
      className={`scroll-mt-20 border-t border-slate-200 py-10 outline-none lg:scroll-mt-36 lg:py-14 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">{eyebrow}</p>
      {title && (
        <h2
          id={headingId}
          className="mt-2 text-[clamp(1.5rem,2.4vw,2.125rem)] font-bold leading-[1.08] tracking-[-0.03em] text-[#09122A]"
        >
          {title}
        </h2>
      )}
      <div className={title ? 'mt-7' : 'mt-3'}>{children}</div>
    </section>
  )
}
