/**
 * OC-5R-REL-02 D — tap a control on a page with a sticky header AND a fixed compact bottom bar.
 *
 * WHY THIS EXISTS. Spec 38's tablet step ("Request an inspection") failed in the deployed gate: Playwright
 * reported, retry after retry, that the compact bar and then the sticky header "intercepts pointer
 * events". It was reproduced against the REL-01 bundle at the tablet's 820×1180 before anything was
 * changed (6/6), and the cause isolated:
 *
 *   · the product sets `html { scroll-behavior: smooth }`, so every scroll is an animation;
 *   · Playwright's actionability loop scrolls the control into view, checks what is under the pointer
 *     and — because the control is still moving — reports "element is not stable" between attempts;
 *   · those "not stable" retries shift the alignment sequence so only the two EXTREME alignments are
 *     ever used: the control is put at the very bottom edge (under the compact bar), then the very top
 *     edge (under the sticky header), and never in the middle. scrollY ping-pongs 18 ↔ 1154.
 *   · with smooth scrolling off the same click passes in ~150 ms, and ONE user-equivalent scroll to the
 *     middle of the viewport leaves the control tappable with ZERO overlap (clear band 65–1111px, control
 *     568–612px; the click opens its dialog).
 *
 * So the control is structurally clear and the fault was the harness leaving the scrolling to an
 * auto-scroll that cannot settle. The product, and both bars, are unchanged.
 *
 * WHAT THIS DOES. It scrolls the REAL control to the middle of the viewport (an instant scroll, which
 * is not subject to the smooth-scroll animation and cancels any one already running), waits for the
 * scroll to settle, MEASURES where the control sits against the two bars and fails if it overlaps
 * either, records the geometry as evidence, and then taps NORMALLY — every Playwright actionability
 * check still applies.
 *
 * WHAT IT NEVER DOES: force-click, set pointer-events, hide or remove a bar, change the viewport, or
 * move pixels in the test. If the control cannot be positioned clear of the bars it FAILS, loudly, with
 * the overlap — which is the product-layout defect it would otherwise have masked.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { assessClearance, clearanceFailure } from './safe-tap-geometry.mjs';

/** The site header (sticky, top) and the compact bottom bar (fixed, below 1024px). */
const STICKY_HEADER = 'header.sticky';
const COMPACT_NAV = '[data-testid="compact-bottom-nav"]';

interface Measured {
  viewport: { width: number; height: number };
  scrollY: number;
  cta: { top: number; bottom: number };
  header: { top: number; bottom: number } | null;
  nav: { top: number; bottom: number } | null;
  /** Which element is on top at the control's centre: the control itself, or what is covering it. */
  centreHitTarget: string;
}

/** Wait until the scroll position has been unchanged for several consecutive frames. */
export async function waitForScrollToSettle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = -1;
    let same = 0;
    const tick = () => {
      const now = Math.round(window.scrollY);
      if (now === last) same += 1; else { same = 0; last = now; }
      if (same >= 6) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

async function measure(page: Page, target: Locator): Promise<Measured> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error('safe-tap: the target is not attached');
  return page.evaluate(({ el, headerSelector, navSelector }) => {
    const span = (node: Element | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const rect = (el as Element).getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    let centreHitTarget = 'nothing';
    if (hit) {
      if ((el as Element).contains(hit)) centreHitTarget = 'the control';
      else if (hit.closest(headerSelector)) centreHitTarget = 'the sticky header';
      else if (hit.closest(navSelector)) centreHitTarget = 'the compact bottom bar';
      else centreHitTarget = hit.tagName.toLowerCase();
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollY: Math.round(window.scrollY),
      cta: { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
      header: span(document.querySelector(headerSelector)),
      nav: span(document.querySelector(navSelector)),
      centreHitTarget,
    };
  }, { el: handle, headerSelector: STICKY_HEADER, navSelector: COMPACT_NAV });
}

/**
 * Scroll `target` into the clear band, prove it is clear, record the geometry, then tap it normally.
 * `label` names the control in the evidence and in any failure.
 */
export async function tapClearOfBars(page: Page, target: Locator, testInfo: TestInfo, label: string): Promise<void> {
  await expect(target, `${label}: the control must be present and visible before it is tapped`).toBeVisible({ timeout: 20_000 });

  // One user-equivalent scroll, to the middle of the viewport. `instant` so the app's smooth-scroll
  // animation cannot still be moving the control when it is measured and tapped.
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await waitForScrollToSettle(page);

  const m = await measure(page, target);
  const assessment = assessClearance({ viewportHeight: m.viewport.height, cta: m.cta, header: m.header, nav: m.nav });
  await testInfo.attach(`tap-clearance-${label}-${testInfo.project.name}.json`, {
    contentType: 'application/json',
    body: JSON.stringify({
      label, project: testInfo.project.name, viewport: m.viewport, scrollY: m.scrollY,
      cta: m.cta, stickyHeader: m.header, compactNav: m.nav, clearBand: assessment.band,
      overlapWithStickyHeader: assessment.overlapWithHeader, overlapWithCompactNav: assessment.overlapWithNav,
      centreHitTarget: m.centreHitTarget, clear: assessment.clear,
    }, null, 1),
  });
  expect(assessment.clear, `${label}: cannot be positioned clear of the fixed bars — ${clearanceFailure(assessment)} (viewport ${m.viewport.width}×${m.viewport.height}, scrollY ${m.scrollY})`).toBe(true);
  expect(m.centreHitTarget, `${label}: something is on top of the control's centre`).toBe('the control');

  // A NORMAL tap: all actionability checks apply; nothing is forced.
  await target.click();
}
