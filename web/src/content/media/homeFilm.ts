/**
 * RX03-P1a — the Home cinematic film manifest.
 *
 * The hero plays an approved brand film when one is listed here; otherwise it falls back to a
 * motion reel of live published Marketplace photos, and to a still frame when motion is reduced,
 * data is saved or video cannot play.
 *
 * STATUS: HOLD. The Higgsfield generation tools were not connected to the implementation session
 * (2026-11-15), so no film has been generated, paid for or imported. Nothing here is a placeholder
 * video presented as brand media: `HOME_FILM` stays `null` until real, rights-recorded footage is
 * delivered. To activate, drop the encoded files into `web/public/media/home-film/` and fill in the
 * manifest below — no component change is needed.
 *
 * Content rules for the film (from the RX03-P1A-R2 dispatch):
 *  - silent, 10–15 s, seamless loop; no text, prices, logos or navigation burned into the footage;
 *  - several vehicle categories; no fabricated manufacturer badges or implied partnerships;
 *  - it is editorial brand media, never presented as inventory.
 */
export interface CinematicSource {
  src: string
  type: 'video/webm' | 'video/mp4'
}

export interface CinematicRendition {
  sources: CinematicSource[]
  poster: string
  width: number
  height: number
}

export interface CinematicFilm {
  id: string
  /** Shown beside the pause control so a viewer can tell brand film from inventory. */
  disclosure: string
  landscape: CinematicRendition
  /** Optional 9:16 rendition for phones in portrait. */
  portrait?: CinematicRendition
  provenance: {
    generator: string
    model: string
    generatedAt: string
    owner: string
    sha256: Record<string, string>
  }
}

export const HOME_FILM: CinematicFilm | null = null

export const HOME_FILM_STATUS = {
  state: 'hold' as const,
  reason: 'Higgsfield generation was not available to the implementation session; no paid generation was attempted.',
}
