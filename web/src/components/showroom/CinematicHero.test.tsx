import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CinematicHero } from './CinematicHero'
import { resolveHeroMode, type ReelFrame } from './heroMode'
import type { CinematicFilm } from '@/content/media/homeFilm'

const frames: ReelFrame[] = [
  { id: 'A', src: '/a.jpg', title: '2019 Toyota Hilux', subtitle: 'Harare', href: '/marketplace/A', badge: 'Demo media' },
  { id: 'B', src: '/b.jpg', title: '2018 Subaru Impreza', href: '/marketplace/B' },
]

const HASH = 'a'.repeat(64)
const film: CinematicFilm = {
  id: 'test-film',
  disclosure: 'CarUp brand film — editorial, not inventory',
  landscape: {
    sources: [{ src: '/media/home-film/film.webm', type: 'video/webm', sha256: HASH, bytes: 1000 }],
    poster: { src: '/media/home-film/poster.jpg', sha256: HASH, bytes: 100 },
    width: 1920,
    height: 1080,
    durationSeconds: 12,
  },
  provenance: { generator: 'test', model: 'test', generationIds: ['g1'], generatedAt: '2026-11-15', approvedBy: 'Owner', approvedAt: '2026-11-15', approvalRef: 'https://example.test/approval' },
  rights: { owner: 'CarUp', licence: 'test licence', licenceRef: 'https://example.test/licence' },
}

function mockMedia({ reduce = false }: { reduce?: boolean } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function setSaveData(on: boolean) {
  Object.defineProperty(navigator, 'connection', { configurable: true, value: on ? { saveData: true } : undefined })
}

function renderHero(props: Partial<React.ComponentProps<typeof CinematicHero>> = {}) {
  return render(
    <MemoryRouter>
      <CinematicHero film={null} frames={frames} framesState="ready" {...props}>
        <h1>Find the car.</h1>
      </CinematicHero>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockMedia()
  setSaveData(false)
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
})
afterEach(() => setSaveData(false))

describe('resolveHeroMode', () => {
  it('prefers an approved film, then the live reel, then the brand plate', () => {
    expect(resolveHeroMode({ film, frames, saveData: false, filmFailed: false })).toBe('film')
    expect(resolveHeroMode({ film: null, frames, saveData: false, filmFailed: false })).toBe('reel')
    expect(resolveHeroMode({ film: null, frames: [], saveData: false, filmFailed: false })).toBe('plate')
  })

  it('never downloads film under Data Saver, and falls back when the film fails', () => {
    expect(resolveHeroMode({ film, frames, saveData: true, filmFailed: false })).toBe('reel')
    expect(resolveHeroMode({ film, frames, saveData: false, filmFailed: true })).toBe('reel')
    expect(resolveHeroMode({ film, frames: [], saveData: true, filmFailed: false })).toBe('plate')
  })
})

describe('CinematicHero', () => {
  it('keeps the page content (search, headline) independent of the media', () => {
    renderHero({ frames: [], framesState: 'unavailable' })
    expect(screen.getByRole('heading', { name: 'Find the car.' })).toBeInTheDocument()
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'plate')
    expect(screen.queryByTestId('home-hero-motion-toggle')).toBeNull()
  })

  it('captions the live listing honestly and links to it', () => {
    renderHero()
    const caption = screen.getByTestId('home-hero-reel-caption')
    expect(caption).toHaveAttribute('href', '/marketplace/A')
    expect(caption).toHaveTextContent('2019 Toyota Hilux')
    expect(screen.getByTestId('home-hero-reel-badge')).toHaveTextContent('Demo media')
  })

  it('has a real pause control that stops the motion', () => {
    renderHero()
    const hero = screen.getByTestId('home-hero')
    const toggle = screen.getByRole('button', { name: 'Pause showroom motion' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(hero).toHaveAttribute('data-hero-playing', 'true')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Play showroom motion' })).toHaveAttribute('aria-pressed', 'true')
    expect(hero).toHaveAttribute('data-hero-playing', 'false')
  })

  it('does not animate for visitors who ask for reduced motion', () => {
    mockMedia({ reduce: true })
    renderHero()
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-playing', 'false')
    expect(screen.queryByTestId('home-hero-motion-toggle')).toBeNull()
    // Manual navigation stays available.
    expect(screen.getByRole('button', { name: 'Next live listing' })).toBeInTheDocument()
  })

  it('plays an approved film muted and inline, with its disclosure', () => {
    const { container } = renderHero({ film })
    const video = container.querySelector('video') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('poster', '/media/home-film/poster.jpg')
    expect(screen.getByTestId('home-hero-disclosure')).toHaveTextContent('editorial, not inventory')
  })

  it('shows only the poster when motion is reduced, and no video under Data Saver', () => {
    mockMedia({ reduce: true })
    const reduced = renderHero({ film })
    expect(reduced.container.querySelector('video')).toBeNull()
    expect(screen.getByTestId('home-hero-film-poster')).toHaveAttribute('src', '/media/home-film/poster.jpg')
    reduced.unmount()

    mockMedia()
    setSaveData(true)
    const saving = renderHero({ film })
    expect(saving.container.querySelector('video')).toBeNull()
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'reel')
  })

  it('falls back to the reel when the film cannot play', () => {
    const { container } = renderHero({ film })
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'reel')
  })

  it('fetches one reel photo at a time: the next only after the current one has loaded', () => {
    renderHero()
    const slots = screen.getAllByTestId('home-hero-reel-frame')
    expect(slots[0].querySelector('img')).not.toBeNull()
    expect(slots[1].querySelector('img')).toBeNull()
    fireEvent.load(slots[0].querySelector('img') as HTMLImageElement)
    expect(screen.getAllByTestId('home-hero-reel-frame')[1].querySelector('img')).not.toBeNull()
  })

  it('refuses a film whose manifest does not validate (no rights record) and plays the reel instead', () => {
    const unrecorded = { ...film, rights: { owner: '', licence: '', licenceRef: '' } }
    const { container } = renderHero({ film: unrecorded })
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'reel')
  })
})
