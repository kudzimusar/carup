/**
 * OC-5R-REL-02 D — where a control may be tapped on a page that carries TWO fixed/sticky bars.
 *
 * CarUp's shell has a sticky site header (top) and, below 1024px, a fixed compact bottom bar. A control
 * is only genuinely tappable when it sits in the CLEAR BAND between them. This module is pure (no
 * Playwright, no DOM) so the decision can be unit-tested and mutation-tested offline; the staging
 * harness (safe-tap.ts) gathers the rectangles in the browser and asks this module.
 *
 * The bars are NEVER altered to make a control tappable — not hidden, not made click-through, not
 * removed. A control that cannot be positioned inside the band is a layout defect to report, and a
 * force-click would only hide it.
 *
 * @typedef {{ top: number, bottom: number }} Span
 * @typedef {{ viewportHeight: number, cta: Span, header: Span | null, nav: Span | null }} Layout
 */

/** A bar that is display:none (a zero-height rect, as the compact bar is at desktop widths) is absent. */
const present = (bar) => Boolean(bar) && bar.bottom - bar.top > 0;

/**
 * The vertical band in which a control is neither under the header nor under the bottom bar.
 * @param {{ viewportHeight: number, header: Span | null, nav: Span | null }} layout
 */
export function clearBand({ viewportHeight, header, nav }) {
  const from = present(header) ? Math.max(0, header.bottom) : 0;
  const to = present(nav) ? Math.min(viewportHeight, nav.top) : viewportHeight;
  return { from, to };
}

/**
 * How a control sits against the two bars.
 * @param {Layout} layout
 */
export function assessClearance(layout) {
  const { cta, header, nav, viewportHeight } = layout;
  const band = clearBand(layout);
  const overlapWithHeader = present(header) ? Math.max(0, header.bottom - cta.top) : 0;
  const overlapWithNav = present(nav) ? Math.max(0, cta.bottom - nav.top) : 0;
  const offscreen = Math.max(0, cta.bottom - viewportHeight) + Math.max(0, -cta.top);
  return {
    band,
    overlapWithHeader,
    overlapWithNav,
    offscreen,
    clear: cta.top >= band.from && cta.bottom <= band.to && overlapWithHeader === 0 && overlapWithNav === 0 && offscreen === 0,
  };
}

/** A one-line, human-readable reason a control is not clear — empty when it is. */
export function clearanceFailure(assessment) {
  if (assessment.clear) return '';
  const parts = [];
  if (assessment.overlapWithHeader > 0) parts.push(`${assessment.overlapWithHeader}px under the sticky header`);
  if (assessment.overlapWithNav > 0) parts.push(`${assessment.overlapWithNav}px under the compact bottom bar`);
  if (assessment.offscreen > 0) parts.push(`${assessment.offscreen}px outside the viewport`);
  if (parts.length === 0) parts.push('outside the clear band');
  return parts.join(', ');
}
