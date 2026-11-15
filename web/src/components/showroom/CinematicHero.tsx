/**
 * RX03-P1a — the cinematic stage at the top of Home.
 *
 * Media layer, in order of preference:
 *   1. `film`  — an approved, silent brand film (see content/media/homeFilm.ts).
 *   2. `reel`  — a slow motion reel of LIVE published Marketplace photos, each frame captioned with
 *                the real vehicle it shows and linking to it. Never stock, never invented.
 *   3. `plate` — the Option 5 brand plate (navy + roofline), used while inventory loads, when no
 *                listing has a usable photo, or when the read failed.
 *
 * The media is decoration: it never blocks search or navigation, carries no text that matters,
 * and is hidden from assistive technology. Motion stops for reduced-motion users, off-screen,
 * in a background tab, and whenever the visitor presses Pause. Data Saver / 2G never downloads video.
 */
import '@/styles/showroom.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import { validateFilm, type CinematicFilm, type CinematicRendition } from '@/content/media/homeFilm'
import { resolveHeroMode, type ReelFrame } from './heroMode'
import { useMotionBudget } from './useMotionBudget'
import { ResponsivePhoto } from './ResponsivePhoto'
import { PHOTO_SIZES } from '@/lib/mediaDelivery'

const REEL_INTERVAL_MS = 6500

function usePortraitPhone() {
  const query = '(max-width: 767px) and (orientation: portrait)'
  const [portrait, setPortrait] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const sync = () => setPortrait(list.matches)
    list.addEventListener?.('change', sync)
    return () => list.removeEventListener?.('change', sync)
  }, [])
  return portrait
}

/** Motion runs only while the stage is on screen and the tab is visible. */
function useStageVisible(ref: React.RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true)
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden')
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setInView(entries.some(entry => entry.isIntersecting)), { threshold: 0.15 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return inView && pageVisible
}

function FilmLayer({
  rendition,
  playing,
  stillOnly,
  onFailed,
}: {
  rendition: CinematicRendition
  playing: boolean
  stillOnly: boolean
  onFailed: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      // Autoplay can still be refused (Low Power Mode, browser policy). The poster stays; the
      // visitor can press Play, which is a user gesture and normally succeeds.
      video.play().catch(() => { /* poster remains */ })
    } else {
      video.pause()
    }
  }, [playing])

  if (stillOnly) {
    return <img src={rendition.poster.src} alt="" className="h-full w-full object-cover" data-testid="home-hero-film-poster" />
  }

  return (
    <video
      ref={videoRef}
      className="h-full w-full object-cover"
      poster={rendition.poster.src}
      muted
      playsInline
      loop
      preload="metadata"
      autoPlay={playing}
      disablePictureInPicture
      disableRemotePlayback
      onError={onFailed}
      data-testid="home-hero-film"
    >
      {rendition.sources.map(source => (
        <source key={source.src} src={source.src} type={source.type} onError={onFailed} />
      ))}
    </video>
  )
}

function ReelLayer({ frames, active, playing }: { frames: ReelFrame[]; active: number; playing: boolean }) {
  // Seller photos can be large originals, so the reel fetches one frame at a time: the frame on
  // screen, and the next one only after the current one has finished loading. "Furthest frame
  // needed so far" only grows, so it is adjusted during render or in onLoad, never in an effect.
  const [loadedUpTo, setLoadedUpTo] = useState(0)
  if (active > loadedUpTo) setLoadedUpTo(active)
  const shouldLoad = (index: number) => index <= loadedUpTo
  const prefetchNext = (index: number) => {
    if (index === active && frames.length > 1) setLoadedUpTo(current => Math.max(current, Math.min(active + 1, frames.length - 1)))
  }

  return (
    <>
      {frames.map((frame, index) => (
        <div
          key={frame.id}
          className={`absolute inset-0 transition-opacity [transition-duration:1400ms] ease-out ${index === active ? 'opacity-100' : 'opacity-0'}`}
          data-testid="home-hero-reel-frame"
          data-active={index === active ? 'true' : 'false'}
        >
          {shouldLoad(index) && (
            <ResponsivePhoto
              src={frame.src}
              alt=""
              sizes={PHOTO_SIZES.heroReel}
              priority={index === 0}
              className="carup-kenburns h-full w-full object-cover"
              style={{
                animationPlayState: playing && index === active ? 'running' : 'paused',
                animationName: index === active ? undefined : 'none',
              }}
              onLoad={() => prefetchNext(index)}
            />
          )}
        </div>
      ))}
    </>
  )
}

function PlateLayer() {
  return (
    <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_78%_18%,#1B2B52_0%,#0D1838_42%,#09122A_78%)]" data-testid="home-hero-plate">
      <div className="absolute -right-[12%] top-[14%] w-[86%] max-w-[1100px] opacity-[0.14] sm:w-[70%]">
        <BrandIdentity role="mark" surface="dark" height={260} decorative className="h-auto w-full" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(180deg,transparent,rgba(254,125,24,0.10))]" />
    </div>
  )
}

interface CinematicHeroProps {
  film: CinematicFilm | null
  frames: ReelFrame[]
  framesState: 'loading' | 'ready' | 'unavailable'
  children: ReactNode
}

export function CinematicHero({ film: filmProp, frames, framesState, children }: CinematicHeroProps) {
  // Only a manifest that passes validation (rights, approval, hashes, same-origin files) may play.
  const film = validateFilm(filmProp).ok ? filmProp : null
  const stageRef = useRef<HTMLElement>(null)
  const { reducedMotion, saveData } = useMotionBudget()
  const portrait = usePortraitPhone()
  const stageVisible = useStageVisible(stageRef)
  const [userPaused, setUserPaused] = useState(false)
  const [hoverHold, setHoverHold] = useState(false)
  const [filmFailed, setFilmFailed] = useState(false)
  const [activeRaw, setActive] = useState(0)

  const mode = resolveHeroMode({ film, frames, saveData, filmFailed })
  const playing = !reducedMotion && !userPaused && !hoverHold && stageVisible
  const reel = useMemo(() => frames.slice(0, 5), [frames])
  const active = reel.length ? activeRaw % reel.length : 0

  useEffect(() => {
    if (mode !== 'reel' || !playing || reel.length < 2) return
    const timer = window.setTimeout(() => setActive(index => (index + 1) % reel.length), REEL_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [mode, playing, reel.length, active])

  const step = useCallback((delta: number) => {
    setActive(index => (index + delta + reel.length) % reel.length)
  }, [reel.length])

  const rendition = film ? (portrait && film.portrait ? film.portrait : film.landscape) : null
  const current = mode === 'reel' ? reel[active] : null
  const motionControllable = !reducedMotion && (mode === 'film' || (mode === 'reel' && reel.length > 1))

  return (
    <section
      ref={stageRef}
      className="relative isolate flex min-h-[calc(100svh-8.5rem)] flex-col overflow-hidden bg-[#09122A] text-white sm:min-h-[640px] lg:min-h-[min(92vh,940px)]"
      data-testid="home-hero"
      data-hero-mode={mode}
      data-hero-playing={playing && mode !== 'plate' ? 'true' : 'false'}
    >
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {mode === 'film' && rendition && (
          <FilmLayer
            rendition={rendition}
            playing={playing}
            stillOnly={reducedMotion}
            onFailed={() => setFilmFailed(true)}
          />
        )}
        {mode === 'reel' && <ReelLayer frames={reel} active={active} playing={playing} />}
        {mode === 'plate' && <PlateLayer />}
        {/* Legibility scrims: the copy must read over any frame, bright or dark. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,18,42,0.55)_0%,rgba(9,18,42,0.10)_28%,rgba(9,18,42,0.35)_58%,rgba(9,18,42,0.94)_100%)]" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(9,18,42,0.82)_0%,rgba(9,18,42,0.35)_46%,transparent_72%)] lg:block" />
      </div>

      <div className="relative flex flex-1 flex-col">{children}</div>

      {/* Media controls: what is playing, which frame, and a real Pause. */}
      {mode !== 'plate' && (
        <div
          className="section-padding relative mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 pb-4 sm:pb-6"
          onMouseEnter={() => setHoverHold(true)}
          onMouseLeave={() => setHoverHold(false)}
          onFocus={() => setHoverHold(true)}
          onBlur={() => setHoverHold(false)}
          data-testid="home-hero-media-controls"
        >
          <div className="min-w-0 flex-1 text-[11px] leading-4 text-white/80">
            {mode === 'film' && film && <span data-testid="home-hero-disclosure">{film.disclosure}</span>}
            {mode === 'reel' && current && (
              <Link
                to={current.href}
                className="group inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-white/20 bg-[#09122A]/45 py-1.5 pl-3 pr-2 backdrop-blur-md transition hover:border-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]"
                data-testid="home-hero-reel-caption"
              >
                <span className="hidden shrink-0 font-semibold uppercase tracking-[0.14em] text-[#FFB27A] sm:inline">Live listing</span>
                {current.badge && (
                  <span className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#09122A]" data-testid="home-hero-reel-badge">{current.badge}</span>
                )}
                <span className="min-w-0 truncate font-semibold text-white">{current.title}</span>
                {current.subtitle && <span className="hidden truncate text-white/70 sm:inline">· {current.subtitle}</span>}
                <ArrowUpRight className="h-4 w-4 shrink-0 text-white/80 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {mode === 'reel' && reel.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  className="hidden h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#09122A]/45 text-white backdrop-blur-md transition hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] sm:flex"
                  aria-label="Previous live listing"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="hidden items-center gap-1 px-1 sm:flex" role="group" aria-label="Live listings in the reel">
                  {reel.map((frame, index) => (
                    <button
                      key={frame.id}
                      type="button"
                      onClick={() => setActive(index)}
                      aria-label={`Show live listing ${index + 1} of ${reel.length}: ${frame.title}`}
                      aria-current={index === active ? 'true' : undefined}
                      className="group flex h-11 w-7 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] sm:w-9"
                    >
                      <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/30">
                        <span
                          key={index === active ? `active-${active}` : `idle-${index}`}
                          className={`absolute inset-y-0 left-0 rounded-full bg-white ${index === active ? 'carup-reel-progress' : ''}`}
                          style={{
                            width: index < active ? '100%' : index === active ? undefined : '0%',
                            animationDuration: `${REEL_INTERVAL_MS}ms`,
                            animationPlayState: playing ? 'running' : 'paused',
                          }}
                        />
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => step(1)}
                  className="hidden h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#09122A]/45 text-white backdrop-blur-md transition hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] sm:flex"
                  aria-label="Next live listing"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
            {motionControllable && (
              <button
                type="button"
                onClick={() => setUserPaused(paused => !paused)}
                aria-pressed={userPaused}
                aria-label={userPaused ? 'Play showroom motion' : 'Pause showroom motion'}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-[#09122A]/55 text-white backdrop-blur-md transition hover:border-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]"
                data-testid="home-hero-motion-toggle"
              >
                {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
      )}
      {mode === 'plate' && framesState === 'unavailable' && (
        <p className="sr-only" data-testid="home-hero-plate-reason">Live Marketplace photos are unavailable right now.</p>
      )}
    </section>
  )
}
