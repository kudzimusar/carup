/**
 * RX03 — the Home cinematic film manifest (ingestion interface for the media specialist).
 *
 * STATUS: HOLD. No film has been generated, paid for or imported. `HOME_FILM` stays `null` until
 * approved footage arrives; until then Home plays the live-listing reel. See HOME_FILM_INGESTION.md.
 *
 * A film plays only if `validateFilm` accepts its manifest. Anything incomplete — a missing rights
 * record, an unapproved cut, a file outside /media/home-film/, a source without its expected hash —
 * fails closed to the reel, so the page can never show unrecorded media by accident. The expected
 * hashes are verified against the committed files by `homeFilm.test.ts`.
 *
 * Content rules (RX03-P1A-R2 dispatch): silent; ~10–15 s seamless loop; several vehicle categories;
 * no text, prices, logos or navigation burned in; no fabricated manufacturer badges or implied
 * partnerships; editorial brand media, never presented as inventory.
 */
export interface CinematicSource {
  /** Same-origin path under /media/home-film/. */
  src: string
  type: 'video/webm' | 'video/mp4'
  /** Lower-case hex SHA-256 of the committed file. */
  sha256: string
  bytes: number
}

export interface CinematicRendition {
  /** Preferred first (e.g. AV1/VP9 WebM), widely supported last (H.264 MP4). */
  sources: CinematicSource[]
  poster: { src: string; sha256: string; bytes: number }
  width: number
  height: number
  durationSeconds: number
}

export interface CinematicFilm {
  id: string
  /** Shown beside the pause control so a viewer can tell brand film from inventory. */
  disclosure: string
  landscape: CinematicRendition
  /** 9:16 rendition for phones in portrait. Optional; landscape is cropped when absent. */
  portrait?: CinematicRendition
  provenance: {
    generator: string
    model: string
    /** Generator job / generation ids, for audit. */
    generationIds: string[]
    generatedAt: string
    /** Owner approval of this exact cut. */
    approvedBy: string
    approvedAt: string
    /** Where the approval is recorded (issue comment URL or equivalent). */
    approvalRef: string
  }
  rights: {
    owner: string
    /** Licence or terms the footage is used under. */
    licence: string
    licenceRef: string
    attribution?: string
    /** Any limitation on use (territory, term, channel). */
    restrictions?: string
  }
}

export const HOME_FILM: CinematicFilm | null = null

export const HOME_FILM_STATUS = {
  state: 'hold' as const,
  reason: 'Higgsfield generation awaits Owner sign-in to the tool and approval of the credit estimate; no paid generation was attempted.',
}

const SHA256 = /^[0-9a-f]{64}$/
const FILM_PATH = /^\/media\/home-film\/[A-Za-z0-9._-]+$/

function checkRendition(name: string, r: CinematicRendition | undefined, reasons: string[]) {
  if (!r) { reasons.push(`${name}: missing`); return }
  if (!Array.isArray(r.sources) || r.sources.length === 0) reasons.push(`${name}: no sources`)
  for (const [i, s] of (r.sources || []).entries()) {
    if (!FILM_PATH.test(s.src)) reasons.push(`${name}.sources[${i}]: must be a file under /media/home-film/`)
    if (s.type !== 'video/webm' && s.type !== 'video/mp4') reasons.push(`${name}.sources[${i}]: unsupported type`)
    if (!SHA256.test(s.sha256)) reasons.push(`${name}.sources[${i}]: missing sha256`)
    if (!(s.bytes > 0)) reasons.push(`${name}.sources[${i}]: missing size`)
  }
  if (!r.poster || !FILM_PATH.test(r.poster.src) || !SHA256.test(r.poster.sha256) || !(r.poster.bytes > 0)) {
    reasons.push(`${name}.poster: needs a /media/home-film/ path, sha256 and size`)
  }
  if (!(r.width > 0 && r.height > 0)) reasons.push(`${name}: missing dimensions`)
  if (!(r.durationSeconds > 0 && r.durationSeconds <= 30)) reasons.push(`${name}: duration must be 0–30 s`)
}

/** Fail-closed acceptance of a film manifest. */
export function validateFilm(film: CinematicFilm | null | undefined): { ok: true } | { ok: false; reasons: string[] } {
  if (!film) return { ok: false, reasons: ['no film'] }
  const reasons: string[] = []
  if (!film.id?.trim()) reasons.push('id: missing')
  if (!film.disclosure?.trim()) reasons.push('disclosure: missing')
  checkRendition('landscape', film.landscape, reasons)
  if (film.portrait) checkRendition('portrait', film.portrait, reasons)
  const p = film.provenance
  if (!p?.generator?.trim() || !p.model?.trim()) reasons.push('provenance: generator and model required')
  if (!Array.isArray(p?.generationIds) || p.generationIds.length === 0) reasons.push('provenance: generation ids required')
  if (!p?.approvedBy?.trim() || !p.approvedAt?.trim() || !p.approvalRef?.trim()) reasons.push('provenance: Owner approval of this cut required')
  const r = film.rights
  if (!r?.owner?.trim() || !r.licence?.trim() || !r.licenceRef?.trim()) reasons.push('rights: owner, licence and licence reference required')
  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/** The film the hero may play: the manifest's film only when it validates. */
export function playableFilm(film: CinematicFilm | null = HOME_FILM): CinematicFilm | null {
  return validateFilm(film).ok ? film : null
}
