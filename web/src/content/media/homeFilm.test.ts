import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOME_FILM, HOME_FILM_STATUS, SCAN_FILM, SOURCING_FILM, playableFilm, validateFilm, type CinematicFilm } from './homeFilm'

const HASH = 'b'.repeat(64)
const valid: CinematicFilm = {
  id: 'carup-home-film-v1',
  disclosure: 'CarUp brand film — editorial footage, not inventory',
  landscape: {
    sources: [
      { src: '/media/home-film/landscape.webm', type: 'video/webm', sha256: HASH, bytes: 3_000_000 },
      { src: '/media/home-film/landscape.mp4', type: 'video/mp4', sha256: HASH, bytes: 4_000_000 },
    ],
    poster: { src: '/media/home-film/landscape-poster.jpg', sha256: HASH, bytes: 120_000 },
    width: 1920,
    height: 1080,
    durationSeconds: 12,
  },
  portrait: {
    sources: [{ src: '/media/home-film/portrait.mp4', type: 'video/mp4', sha256: HASH, bytes: 2_500_000 }],
    poster: { src: '/media/home-film/portrait-poster.jpg', sha256: HASH, bytes: 90_000 },
    width: 1080,
    height: 1920,
    durationSeconds: 12,
  },
  provenance: {
    generator: 'Higgsfield',
    model: 'Kling 3.0',
    generationIds: ['gen-1', 'gen-2'],
    generatedAt: '2026-11-20',
    approvedBy: 'Owner',
    approvedAt: '2026-11-21',
    approvalRef: 'https://github.com/kudzimusar/carup/issues/261#issuecomment-0',
  },
  rights: { owner: 'CarUp', licence: 'Higgsfield output, commercial use', licenceRef: 'https://example.test/terms' },
}

describe('validateFilm — fail-closed ingestion', () => {
  it('accepts a complete, approved, rights-recorded manifest', () => {
    expect(validateFilm(valid)).toEqual({ ok: true })
    expect(playableFilm(valid)).toBe(valid)
  })

  it.each([
    ['no rights record', { ...valid, rights: { owner: 'CarUp', licence: '', licenceRef: '' } }, 'rights'],
    ['no Owner approval of the cut', { ...valid, provenance: { ...valid.provenance, approvedBy: '' } }, 'approval'],
    ['no generation ids', { ...valid, provenance: { ...valid.provenance, generationIds: [] } }, 'generation ids'],
    ['a remote file', { ...valid, landscape: { ...valid.landscape, sources: [{ ...valid.landscape.sources[0], src: 'https://cdn.example/film.webm' }] } }, '/media/home-film/'],
    ['a source without its hash', { ...valid, landscape: { ...valid.landscape, sources: [{ ...valid.landscape.sources[0], sha256: '' }] } }, 'sha256'],
    ['a poster without its hash', { ...valid, landscape: { ...valid.landscape, poster: { ...valid.landscape.poster, sha256: 'x' } } }, 'poster'],
    ['an overlong cut', { ...valid, landscape: { ...valid.landscape, durationSeconds: 90 } }, 'duration'],
  ] as [string, CinematicFilm, string][])('refuses %s', (_name, film, reason) => {
    const result = validateFilm(film)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reasons.join(' | ')).toContain(reason)
    expect(playableFilm(film)).toBeNull()
  })
})

describe('the committed manifest', () => {
  it('is on HOLD with no film until approved footage is ingested', () => {
    if (HOME_FILM === null) {
      expect(HOME_FILM_STATUS.state).toBe('hold')
      expect(playableFilm()).toBeNull()
    }
  })

  it('every file each film lists exists under web/public with the recorded hash and size', () => {
    const publicDir = join(__dirname, '../../../public')
    const films = [HOME_FILM, SOURCING_FILM, SCAN_FILM].filter(Boolean) as CinematicFilm[]
    for (const film of films) expect(validateFilm(film), film.id).toEqual({ ok: true })
    const files = films.flatMap(film => [film.landscape, film.portrait].filter(Boolean).flatMap(r => [...r!.sources, r!.poster]))
    for (const file of files) {
      const path = join(publicDir, file.src)
      expect(existsSync(path), file.src).toBe(true)
      const bytes = readFileSync(path)
      expect(bytes.length, file.src).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), file.src).toBe(file.sha256)
    }
  })
})

describe('owner-review cuts (RX03 Addendum 05)', () => {
  afterEach(() => vi.unstubAllEnvs())
  const review: CinematicFilm = { ...valid, review: 'owner-review', provenance: { ...valid.provenance, approvedBy: '', approvedAt: '' } }

  it('a review cut needs its credit-authorization reference but not an approval yet', () => {
    expect(validateFilm(review)).toEqual({ ok: true })
    expect(validateFilm({ ...review, provenance: { ...review.provenance, approvalRef: '' } }).ok).toBe(false)
  })

  it('never plays in a production build unless that build opts in; an approved cut always may', () => {
    vi.stubEnv('PROD', true)
    expect(playableFilm(review)).toBeNull()
    expect(playableFilm(valid)).toBe(valid)
    vi.stubEnv('VITE_CARUP_FILM_REVIEW', 'on')
    expect(playableFilm(review)).toBe(review)
  })

  it('plays in non-production review builds and when explicitly allowed', () => {
    vi.stubEnv('PROD', false)
    expect(playableFilm(review)).toBe(review)
    expect(playableFilm(review, { allowOwnerReview: false })).toBeNull()
  })

  it('the ingested films are labelled as AI-generated editorial media, never inventory or records', () => {
    expect(HOME_FILM?.disclosure).toMatch(/AI-generated, not inventory/)
    expect(SOURCING_FILM?.disclosure).toMatch(/not a shipment record/)
    expect(SCAN_FILM?.disclosure).toMatch(/not a real document/)
    expect(HOME_FILM_STATUS.state).not.toBe('approved')
  })
})
