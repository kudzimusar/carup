/**
 * Trade OS T12 — responsive certification at seven widths, on the deployed frontend.
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
 * It also asserts the page actually RENDERED its T12 content at each width. A surface that fails to
 * load has a perfect scrollWidth, and certifying that would be certifying nothing.
 *
 * Usage:
 *   node scripts/uat/t12-responsive-certification.mjs --fe <url> --session-file <path> --case <id> [--out <dir>]
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
// The case the T12 journeys created. Passed in rather than hardcoded, because a case id is
// generated, not a fixture.
const CASE = args.case || null;
if (!CASE) { console.error('--case is required (the id printed by t12-customs-journeys.mjs)'); process.exit(2); }

const SURFACES = [
  // The workspace is opened by typing a case reference, so the harness types it: the certification
  // has to exercise the LOADED state, not the empty prompt.
  { name: 'operator customs workspace', path: '/diaspora/customs', as: 'operator', expect: 'customs-destination-workspace', openShipment: CASE, settled: 'customs-assessment' },
  { name: 'participant destination view', path: `/diaspora/my-customs/${SUBJECT}`, as: 'customer', expect: 'my-customs-destination' },
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
      await page.waitForTimeout(1200);
      if (surface.openShipment) {
        await page.fill('[data-testid="customs-input"]', surface.openShipment);
        await page.click('[data-testid="customs-submit"]');
        // Wait for the real content, not a spinner — a page that never loaded overflows nothing.
        await page.waitForSelector(`[data-testid="${surface.settled}"]`, { timeout: 20000 });
        await page.waitForTimeout(800);
      }

      // The surface must actually be there. An unrendered page overflows nothing.
      const rendered = await page.locator(`[data-testid="${surface.expect}"]`).count();
      // Read the page text with the DISCLAIMERS removed.
      //
      // Those sentences are required to NAME the boundary they refuse to cross — "it does not mean
      // the container has sailed" is the single most important line on the participant page, and a
      // naive scan flags it for containing the word "sailed". The ban is on the page CLAIMING a
      // later phase's fact, not on it disclaiming one. Checking the disclaimers separately below is
      // the difference between a firewall and a word filter.
      const visibleText = await page.evaluate(() => {
        const clone = document.body.cloneNode(true);
        for (const el of clone.querySelectorAll('[data-testid$="disclaimer"], [data-testid$="-note"], [data-testid$="-detail"]')) el.remove();
        return clone.innerText.slice(0, 6000);
      });
      // …and the disclaimers must still be PRESENT and still say it.
      const disclaimerText = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid$="disclaimer"], [data-testid$="-note"]')].map((e) => e.innerText).join(' '));

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
        // The T12 sentence that must survive at every width. "Not yet assessed" is the whole phase
        // in three words: an unassessed duty is unknown, never zero and never a dash.
        saysNotKnown: /Not recorded|Not yet assessed/i.test(visibleText),
        // The boundary must be STATED, not merely un-violated. An absent disclaimer is a silent
        // page, and silence is what lets a reader assume the container has gone.
        statesBoundary: /is not ZIMRA|does not assess duty|not arriving in the destination country|has not verified|not the same as it being nil/i.test(disclaimerText),
        // T12 may name customs steps — that is its vocabulary. What it may NEVER do is CLAIM one:
        // "cleared", "duty paid", or a registration T13+ and the CVR own. Whole words only: a bare
        // substring ban is the defect where `eta` matched `metadata` and `vin` matched "leaving".
        saysLaterPhase: /\bcleared\b|duty paid|customs approved|\bregistered\b|\bZINARA\b|number plate/i.test(visibleText),
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
  if (r.rendered && !r.statesBoundary) bits.push('THE BOUNDARY IS NOT STATED');
  if (r.error) bits.push(r.error);
  console.log(`  ${r.ok && !r.saysLaterPhase && (!r.rendered || r.statesBoundary) ? 'PASS' : 'FAIL'}  ${String(r.width).padStart(4)}px  scrollWidth=${r.scrollWidth ?? '?'}${bits.length ? `  — ${bits.join(' · ')}` : ''}`);
  if (r.consoleErrors?.length) console.log(`         console: ${r.consoleErrors.join(' | ')}`);
}
const failed = results.filter((r) => !r.ok || r.saysLaterPhase || (r.rendered && !r.statesBoundary));
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
process.exit(failed.length ? 1 : 0);
