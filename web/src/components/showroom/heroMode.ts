import type { CinematicFilm } from '@/content/media/homeFilm'

export interface ReelFrame {
  id: string
  src: string
  title: string
  subtitle?: string
  /** Honesty marker shown in the caption, e.g. "Demo media" for synthetic reference photos. */
  badge?: string
  href: string
}

export type HeroMode = 'film' | 'reel' | 'plate'

export function resolveHeroMode(input: {
  film: CinematicFilm | null
  frames: ReelFrame[]
  saveData: boolean
  filmFailed: boolean
}): HeroMode {
  if (input.film && !input.saveData && !input.filmFailed) return 'film'
  if (input.frames.length > 0) return 'reel'
  return 'plate'
}
