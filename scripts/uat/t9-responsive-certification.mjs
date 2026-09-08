/**
 * Trade OS T9 — responsive certification at seven widths, on the deployed frontend.
 *
 * Two checks per surface, because either alone is insufficient:
 *
 *   1. `document.documentElement.scrollWidth <= innerWidth + 1` — the page body must never scroll
 *      sideways. This catches the T6-class defect where one unwrapped reason string pushed a whole
 *      column past 393px.
 *   2. A per-element sweep for anything wider than the viewport, reported with the offending text,
 *      because a container with `overflow-x: auto` can hide an overflow from check 1 while still
 *      being unusable.
 *
 * It also asserts the page actually RENDERED its T9 content at each width. A surface that fails to
 * load has a perfect scrollWidth, and certifying that would be certifying nothing.
 *
 * Usage:
 *   node scripts/uat/t9-responsive-certification.mjs --fe <url> --session-file <path> [--out <dir>]
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const FE = (args.fe || '').replace(/\/$/, '');
const OUT = args.out || null;
if (!FE || !args['session-file']) { console.error('--fe and --session-file are required'); process.exit(2); }
// Read, never import: a session file that is require()-parsed echoes its token on a syntax error.
const sessions = JSON.parse(readFileSync(args['session-file'], 'utf8'));
if (OUT) mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  [393, 852],   // iPhone 15 — the width that has broken every phase so far
  [820, 1180],  // iPad Air portrait
  [1024, 768],  // iPad landscape
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
];

const SUBJECT = args.subject || 'cargo_reservation/99994444-0000-4000-8000-000000000001';

const SURFACES = [
  { name: 'operator intake workspace', path: '/diaspora/warehouse', as: 'operator', expect: 'warehouse-intake-workspace' },
  { name: 'customer cargo view', path: `/diaspora/cargo/${SUBJECT}`, as: 'customer', expect: 'my-cargo' },
];

const results = [];
const browser = await chromium.launch();

for (const surface of SURFACES) {
  const session = sessions[surface.as];
  for (const [width, height] of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    try {
      // Seed the session the way the app itself stores it, then load the surface.
      await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(([user, token]) => {
        localStorage.setItem('carup_user', JSON.stringify(user));
        localStorage.setItem('carup_token', token);
      }, [session.user, session.token]);
      await page.goto(`${FE}${surface.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // The surface must actually be there. An unrendered page overflows nothing.
      const rendered = await page.locator(`[data-testid="${surface.expect}"]`).count();
      const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 4000));

      const overflow = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const offenders = [];
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width > vw + 1 && r.height > 0) {
            const style = getComputedStyle(el);
            // A deliberate horizontal scroller is allowed; the page body is not.
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
            offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 70) });
          }
        }
        return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, offenders: offenders.slice(0, 4) };
      }, width);

      const bodyScrolls = overflow.scrollWidth > overflow.innerWidth + 1;
      const ok = rendered > 0 && !bodyScrolls && overflow.offenders.length === 0;
      results.push({
        surface: surface.name, width, ok,
        rendered: rendered > 0,
        scrollWidth: overflow.scrollWidth, innerWidth: overflow.innerWidth,
        offenders: overflow.offenders,
        consoleErrors: consoleErrors.slice(0, 2),
        // The T9 sentences that must survive at every width.
        saysNotKnown: /Not known|Not measured|Not assigned|Not recorded/i.test(visibleText),
        saysLaterPhase: /ready to load|loaded|shipped|departed|in transit|customs/i.test(visibleText),
      });
      if (OUT) await page.screenshot({ path: `${OUT}/${surface.as}-${width}.png`, fullPage: true });
    } catch (e) {
      results.push({ surface: surface.name, width, ok: false, error: String(e.message).slice(0, 200) });
    } finally {
      await context.close();
    }
  }
}
await browser.close();

let current = '';
for (const r of results) {
  if (r.surface !== current) { current = r.surface; console.log(`\n── ${current} ──`); }
  const bits = [];
  if (!r.rendered) bits.push('DID NOT RENDER');
  if (r.scrollWidth > r.innerWidth + 1) bits.push(`body scrolls ${r.scrollWidth} > ${r.innerWidth}`);
  for (const o of r.offenders || []) bits.push(`${o.tag}.${o.cls} ${o.w}px "${o.text}"`);
  if (r.saysLaterPhase) bits.push('SPEAKS A LATER PHASE');
  if (r.error) bits.push(r.error);
  console.log(`  ${r.ok && !r.saysLaterPhase ? 'PASS' : 'FAIL'}  ${String(r.width).padStart(4)}px  scrollWidth=${r.scrollWidth ?? '?'}${bits.length ? `  — ${bits.join(' · ')}` : ''}`);
  if (r.consoleErrors?.length) console.log(`         console: ${r.consoleErrors.join(' | ')}`);
}
const failed = results.filter((r) => !r.ok || r.saysLaterPhase);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
process.exit(failed.length ? 1 : 0);
