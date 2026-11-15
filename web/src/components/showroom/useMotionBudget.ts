import { useEffect, useState } from 'react'

/**
 * How much motion and media this visitor should receive.
 *
 *  - `reducedMotion`: the OS/browser asks for reduced motion → no autoplay, no Ken Burns, no
 *    auto-advance. Manual controls still work.
 *  - `saveData`: Data Saver is on or the connection is 2G-class → never download video; stills only.
 *
 * Both are read live, so turning either setting on mid-visit takes effect immediately.
 */
export interface MotionBudget {
  reducedMotion: boolean
  saveData: boolean
}

type NetworkInformationLike = {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function connection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

export function readSaveData(): boolean {
  const info = connection()
  if (!info) return false
  if (info.saveData === true) return true
  return info.effectiveType === 'slow-2g' || info.effectiveType === '2g'
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useMotionBudget(): MotionBudget {
  const [budget, setBudget] = useState<MotionBudget>(() => ({
    reducedMotion: readReducedMotion(),
    saveData: readSaveData(),
  }))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    const sync = () => setBudget({ reducedMotion: readReducedMotion(), saveData: readSaveData() })
    query?.addEventListener?.('change', sync)
    const info = connection()
    info?.addEventListener?.('change', sync)
    return () => {
      query?.removeEventListener?.('change', sync)
      info?.removeEventListener?.('change', sync)
    }
  }, [])

  return budget
}
