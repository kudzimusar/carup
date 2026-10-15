import type { UserEvent } from '@testing-library/user-event'

/**
 * PC01-F F4 — keyboard reach, tested against Tailwind's REAL visibility rules.
 *
 * jsdom has no Tailwind, so in a plain render a `className="hidden"` control looks reachable. With the
 * two rules below installed, user-event's Tab skips `display: none` exactly as a browser does, while an
 * `sr-only` control stays in the tab order — so a test can tell an unreachable file input from a
 * reachable one. Both rules are Tailwind's own, not test inventions.
 */
const TAILWIND_VISIBILITY =
  '.hidden{display:none}'
  + '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}'

export function installTailwindVisibility(): () => void {
  const style = document.createElement('style')
  style.textContent = TAILWIND_VISIBILITY
  document.head.appendChild(style)
  return () => style.remove()
}

/** Press Tab until `target` has focus, or give up after `max` presses. Returns whether it got there. */
export async function tabTo(user: UserEvent, target: Element, max = 200): Promise<boolean> {
  for (let i = 0; i < max && document.activeElement !== target; i += 1) await user.tab()
  return document.activeElement === target
}
