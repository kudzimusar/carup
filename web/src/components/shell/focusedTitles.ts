import { matchPath } from 'react-router-dom'

/**
 * The five account routes that render in the Focused account stage, with their task titles.
 * One map, shared by the unified FocusedShell (nonproduction opt-in) and the RX-03 showroom chrome
 * (MainLayout), so both presentations name the task identically. Presentation only.
 */
export const FOCUSED_TITLES: ReadonlyArray<{ pattern: string; title: string; wide?: boolean }> = [
  { pattern: '/login', title: 'Sign in to CarUp' },
  { pattern: '/register', title: 'Create your CarUp account', wide: true },
  { pattern: '/auth/forgot-password', title: 'Recover your password' },
  { pattern: '/auth/reset-password', title: 'Choose a new password' },
  { pattern: '/auth/verify-email', title: 'Verify your email' },
]

export function focusedTaskFor(pathname: string): { title: string; wide: boolean } | null {
  for (const entry of FOCUSED_TITLES) {
    if (matchPath(entry.pattern, pathname)) return { title: entry.title, wide: Boolean(entry.wide) }
  }
  return null
}

export function focusedTitleFor(pathname: string): string | null {
  return focusedTaskFor(pathname)?.title ?? null
}
