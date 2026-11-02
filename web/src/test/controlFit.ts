/**
 * The classes that pin an element's height at some screen width: `h-9`, `max-sm:h-11`, `sm:h-10`, `h-[44px]` …
 * `min-h-*` and `h-auto` (at any width) do not pin it.
 *
 * The shared Button sets `h-9 max-sm:h-11`. A button whose words may wrap adds `h-auto`, which replaces `h-9` but NOT the
 * small-screen `max-sm:h-11`. The final PAY-05 rehearsal at ea0511ff showed the result at 390 px: "Pay … on Paynow's page"
 * needed 52 px inside a 44 px button, its first and last lines cut off. jsdom computes no layout; the headed browser spec
 * measures the real boxes (noClippedControls), and this pins the cause.
 */
export function fixedHeightClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => /^(?:[^:\s]+:)*h-(?!auto$)\S+$/.test(c))
}
