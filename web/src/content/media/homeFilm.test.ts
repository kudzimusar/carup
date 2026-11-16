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
  })
})

describe('the five Owner-approved cuts (RX03-P2, 2026-11-16)', () => {
  afterEach(() => vi.unstubAllEnvs())
  // The exact approved bytes. Any re-encode, crop or swap fails here, not in review.
  const APPROVED: [string, string][] = [
    ['home-landscape-poster.jpg', '281443691f5bfab53dd210223dc020173d47d8d056c56d25545dcd1b2f73a0b1'],
    ['home-landscape.mp4', '1e557b0d1cb99640ac749913f41ea72e537e549dcc34ae6bfe0252316b1f40d8'],
    ['home-landscape.webm', 'e93c4220e448667ed95143095a2c4ca25eebdc77091c36fc4d1e246576131150'],
    ['home-portrait-poster.jpg', '6795835f1e55d7aaaef964c292896e23b82aad7b9daa56f9909b577dad50008c'],
    ['home-portrait.mp4', '9e74a1370de8b1911ae2ac2cdeae6fb8626a3e8da7ac13a85512cb83325759c2'],
    ['home-portrait.webm', '5390d7f9e61fdb342b9f1d14870c0180406aebb926f09d65deae73b8c019759f'],
    ['scan-square-poster.jpg', '20215c46e1baf7dfa504a88e81da3ec0c6336086b02aeacc46924d051b8b8622'],
    ['scan-square.mp4', '1cd24bee1334ff331840100802c10f32dc6d579dd058648c040ba6e53902c61e'],
    ['scan-square.webm', 'c39c31f3f8418b442a27379ce7c6d3e4022da67994778e7e4f5772d9b775519f'],
    ['sourcing-landscape-poster.jpg', '09855a14e9d78e03ee05322cef4a4026cf5b5899f05b3175f41723abdefca436'],
    ['sourcing-landscape.mp4', 'c008e756fa21fa7fba6b457f5218b0546c677f12f3b222d67a732d8e87c7fd75'],
    ['sourcing-landscape.webm', '7eaccb6591db7eebb3c60752825c6a480b7fe51eb881cb856160fd3bf14bfd91'],
    ['sourcing-portrait-poster.jpg', '23642eca8c11498d06cef1c10cbaae06917d8f8af648fbd963a7d041d9356691'],
    ['sourcing-portrait.mp4', 'ee5e8f4f2d160ad56c1a8de9cf7706c4e494923dd5156ece5656a8810622b1dc'],
    ['sourcing-portrait.webm', '65bb63cdc6a473db2e529a270dc8a72b190e9179c82a23b61662118888326452'],
  ]

  it('every approved file is on disk with its exact approved hash, and the manifest lists exactly these', () => {
    const publicDir = join(__dirname, '../../../public/media/home-film')
    for (const [name, hash] of APPROVED) {
      expect(createHash('sha256').update(readFileSync(join(publicDir, name))).digest('hex'), name).toBe(hash)
    }
    const listed = ([HOME_FILM, SOURCING_FILM, SCAN_FILM] as CinematicFilm[])
      .flatMap(f => [f.landscape, f.portrait].filter(Boolean).flatMap(r => [...r!.sources, r!.poster]))
      .map(file => [file.src.split('/').pop(), file.sha256])
      .sort()
    expect(listed).toEqual([...APPROVED].sort())
  })

  it('all three manifests record the Owner approval and confirmed rights', () => {
    for (const film of [HOME_FILM, SOURCING_FILM, SCAN_FILM] as CinematicFilm[]) {
      expect(film.review, film.id).toBe('approved')
      expect(film.provenance.approvedBy).toBe('Owner (CarUp)')
      expect(film.provenance.approvedAt).toBe('2026-11-16')
      expect(film.provenance.approvalRef).toMatch(/RX03-P2-CONNECTED-PILOT-CLOSURE-AND-RX04-ENTRY-LR01/)
      expect(film.rights.licenceRef).toMatch(/Owner confirmed commercial rights for website publication/)
    }
    expect(HOME_FILM_STATUS.state).toBe('approved')
  })

  it('approved cuts may play in a production build (the page release switches still decide whether Home shows them)', () => {
    vi.stubEnv('PROD', true)
    for (const film of [HOME_FILM, SOURCING_FILM, SCAN_FILM]) expect(playableFilm(film)).toBe(film)
  })
})
