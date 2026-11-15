import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOME_FILM, HOME_FILM_STATUS, playableFilm, validateFilm, type CinematicFilm } from './homeFilm'

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

  it('every file it lists exists under web/public with the recorded hash and size', () => {
    if (!HOME_FILM) return
    const publicDir = join(__dirname, '../../../public')
    const files = [HOME_FILM.landscape, HOME_FILM.portrait].filter(Boolean).flatMap(r => [...r!.sources, r!.poster])
    for (const file of files) {
      const path = join(publicDir, file.src)
      expect(existsSync(path), file.src).toBe(true)
      const bytes = readFileSync(path)
      expect(bytes.length, file.src).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), file.src).toBe(file.sha256)
    }
    expect(validateFilm(HOME_FILM)).toEqual({ ok: true })
  })
})
