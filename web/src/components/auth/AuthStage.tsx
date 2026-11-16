import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import { PUBLIC_IDENTITY } from '@/config/publicIdentity'

/**
 * RX03-AUTH-FOCUSED-IDENTITY — the RX-03 sign-in / account stage (Focused grammar).
 *
 * ONE chrome for the five account routes (/login, /register, /auth/forgot-password,
 * /auth/reset-password, /auth/verify-email): the Option 5 mark, the task title, an explicit way back
 * to browsing, and the real page form as `children` (pages render form-only under
 * FocusedEmbedContext, so nothing is duplicated). No navigation bar, bottom tab bar or footer.
 *
 * Phones: a slim navy band (horizontal reversed logo + "Continue browsing") above a light task area.
 * Desktop: an editorial brand panel — the APPROVED Home film poster as a CSS background that only
 * loads at lg+ (never on phones; never a video) — beside the task column; the logo appears once.
 * Presentation only: no authentication, role or session logic lives here.
 */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-2'

export function AuthStage({
  title,
  subtitle,
  wide = false,
  exitTestId = 'auth-exit',
  onExit,
  children,
}: {
  title: string
  subtitle?: ReactNode
  /** The multi-step registration needs a wider task column than sign-in or recovery. */
  wide?: boolean
  exitTestId?: string
  onExit: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-[100dvh] bg-[#F6F4F0] text-[#09122A] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" data-testid="auth-stage">
      <a href="#auth-task" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-[#09122A] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white">
        Skip to the form
      </a>
      {/* Desktop brand panel — decorative image via CSS background (lg only), real text on top. */}
      <aside
        // The approved Home film poster, as a CSS background that only applies at lg+ (phones never fetch it).
        className="relative hidden overflow-hidden bg-[#09122A] text-white lg:flex lg:flex-col lg:justify-between lg:bg-cover lg:bg-center lg:bg-[url('/media/home-film/home-landscape-poster.jpg')]"
        data-testid="auth-brand-panel"
        aria-label="CarUp"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#09122A]/80 via-[#09122A]/55 to-[#09122A]/90" aria-hidden="true" />
        <div className="relative px-12 pt-12">
          <BrandIdentity role="stacked" surface="dark" height={76} decorative priority />
        </div>
        <div className="relative px-12 pb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">{PUBLIC_IDENTITY.descriptor}</p>
          <p className="mt-3 max-w-md text-[2.5rem] font-bold leading-[1.04] tracking-[-0.035em]">
            {PUBLIC_IDENTITY.tagline}
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-7 text-white/80">
            Your saved cars, enquiries, garage and import orders stay with your CarUp account.
          </p>
          <p className="mt-10 text-[11px] text-white/60">CarUp brand film still · AI-generated, not inventory</p>
        </div>
      </aside>

      <div className="flex min-h-[100dvh] flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between bg-[#09122A] px-4 text-white lg:bg-transparent lg:px-10 lg:text-[#09122A]">
          {/* The logo appears once: in this band on phones, in the brand panel on desktop. */}
          <span className="lg:invisible" data-testid="auth-band-logo">
            <BrandIdentity role="logo" surface="dark" height={28} decorative priority />
            <span className="sr-only">CarUp</span>
          </span>
          <button
            type="button"
            onClick={onExit}
            data-testid={exitTestId}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-white/90 hover:text-white lg:border lg:border-[#09122A]/15 lg:text-[#09122A] lg:hover:bg-white ${FOCUS}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Continue browsing
          </button>
        </header>
        <main id="auth-task" tabIndex={-1} className="flex flex-1 justify-center px-4 pb-10 pt-8 outline-none sm:px-6 lg:items-center lg:px-10">
          <div className={`w-full ${wide ? 'max-w-[560px]' : 'max-w-[420px]'}`}>
            <h1 className="text-[1.9rem] font-bold leading-[1.1] tracking-[-0.03em] text-[#09122A]" data-testid="auth-title">
              {title}
            </h1>
            {subtitle && <div className="mt-2 text-[15px] leading-6 text-slate-600">{subtitle}</div>}
            <div className="mt-7">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
