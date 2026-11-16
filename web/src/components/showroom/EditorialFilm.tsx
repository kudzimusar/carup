/**
 * RX03 Addendum 05 — an editorial film inside a Home section (international sourcing, Scan to Start).
 *
 * Same guarantees as the hero film:
 *  - only a manifest that passes `playableFilm` (fail-closed; owner-review cuts never in production);
 *  - silent, inline, looping, and playing only while on screen in a visible tab;
 *  - reduced motion or Data Saver → the poster only, the video is never requested;
 *  - a visible Pause/Play control (motion longer than five seconds must be pausable);
 *  - a load failure falls back to the poster; no film at all falls back to `fallback`.
 * The film is decoration with a disclosure; the section's text carries the meaning.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import type { CinematicFilm } from '@/content/media/homeFilm'
import { useMotionBudget } from './useMotionBudget'

function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(false)
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden')
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setOnScreen(entries.some(entry => entry.isIntersecting)), { threshold: 0.25 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return onScreen && pageVisible
}

function usePortrait(query = '(max-width: 767px) and (orientation: portrait)') {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const sync = () => setMatch(list.matches)
    list.addEventListener?.('change', sync)
    return () => list.removeEventListener?.('change', sync)
  }, [query])
  return match
}

export function EditorialFilm({
  film,
  label,
  fallback,
  className = '',
  testId = 'editorial-film',
  disclosureTone = 'dark',
  controlsAt = 'bottom',
}: {
  film: CinematicFilm | null
  /** What the pause control controls, e.g. "the sourcing film". */
  label: string
  fallback?: ReactNode
  className?: string
  testId?: string
  disclosureTone?: 'dark' | 'light'
  /** Where the disclosure and Pause sit; 'top' when the section's own text overlaps the film's bottom. */
  controlsAt?: 'bottom' | 'top'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { reducedMotion, saveData } = useMotionBudget()
  const onScreen = useOnScreen(ref)
  const portrait = usePortrait()
  const [paused, setPaused] = useState(false)
  const [failed, setFailed] = useState(false)

  const rendition = film ? (portrait && film.portrait ? film.portrait : film.landscape) : null
  const stillOnly = reducedMotion || saveData || failed
  const playing = !!rendition && !stillOnly && onScreen && !paused

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) Promise.resolve(video.play()).catch(() => { /* poster remains; Play is a user gesture */ })
    else video.pause()
  }, [playing])

  if (!film || !rendition) {
    return <div ref={ref} className={className} data-testid={`${testId}-fallback`}>{fallback}</div>
  }

  const reviewCut = (film.review ?? 'approved') === 'owner-review'
  const chip = disclosureTone === 'dark' ? 'bg-black/55 text-white ring-white/15' : 'bg-white/90 text-[#09122A] ring-black/10'

  return (
    <div
      ref={ref}
      className={`relative isolate overflow-hidden ${className}`}
      data-testid={testId}
      data-film-id={film.id}
      data-film-mode={stillOnly ? 'poster' : 'video'}
      data-film-review={film.review ?? 'approved'}
    >
      {stillOnly ? (
        <img src={rendition.poster.src} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid={`${testId}-poster`} />
      ) : (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          poster={rendition.poster.src}
          muted
          playsInline
          loop
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
          aria-hidden="true"
          data-testid={`${testId}-video`}
        >
          {rendition.sources.map(source => (
            <source key={source.src} src={source.src} type={source.type} onError={() => setFailed(true)} />
          ))}
        </video>
      )}
      <div className={`pointer-events-none absolute inset-x-0 z-10 flex justify-between gap-3 p-3 sm:p-4 ${controlsAt === 'top' ? 'top-0 items-start' : 'bottom-0 items-end'}`}>
        <span className={`pointer-events-auto inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ring-1 backdrop-blur ${chip}`} data-testid={`${testId}-disclosure`}>
          {film.disclosure}
          {reviewCut && <span className="rounded-full bg-[#FE7D18] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-[#09122A]">Owner review cut</span>}
        </span>
        {!stillOnly && (
          <button
            type="button"
            onClick={() => setPaused(value => !value)}
            aria-pressed={paused}
            aria-label={paused ? `Play ${label}` : `Pause ${label}`}
            className={`pointer-events-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] ${chip}`}
            data-testid={`${testId}-toggle`}
          >
            {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  )
}
