/**
 * Generates the synthetic OCR accuracy corpus.
 *
 * Every fixture is rendered from the field values in ocr-corpus-manifest.json, so the expected
 * values are machine-known by construction: the same strings become the pixels and the answer
 * key. No real document, no real person, no real identifier.
 *
 *   node backend/tests/tools/generate-ocr-corpus.mjs
 *
 * Output: docs/features/o2/uat-assets/ocr-corpus/
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(root, 'docs/features/o2/uat-assets/ocr-corpus');
const manifest = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr-corpus-manifest.json'), 'utf8'));

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; background: #6b7280; }
  .sheet { background: #f8f7f2; color: #101216; padding: 34px 40px; position: relative; overflow: hidden; }
  .banner { background: #b91c1c; color: #fff; font-size: 19px; font-weight: 800; letter-spacing: 2px;
            padding: 7px 12px; text-align: center; margin-bottom: 18px; }
  .title { font-size: 26px; font-weight: 800; letter-spacing: 1px; }
  .authority { font-size: 15px; color: #374151; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 28px; }
  .row .label { font-size: 12px; letter-spacing: 1.4px; color: #4b5563; text-transform: uppercase; }
  .row .value { font-size: 25px; font-weight: 700; letter-spacing: 0.6px; }
  .wide { grid-column: 1 / -1; }
  .footer { position: absolute; left: 40px; right: 40px; bottom: 16px; font-size: 12px; color: #4b5563; }
  .glare { position: absolute; inset: 0; pointer-events: none;
           background: radial-gradient(ellipse 46% 40% at 62% 32%, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.72) 38%, rgba(255,255,255,0) 72%); }
`;

function rows(fields) {
  return fields.map(({ label, value, wide }) => `
    <div class="row ${wide ? 'wide' : ''}">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </div>`).join('');
}

function sheet({ width, height, title, authority, fields, footer, glare }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
    <div class="sheet" style="width:${width}px;height:${height}px">
      <div class="banner">SYNTHETIC TEST ASSET — NOT A REAL DOCUMENT</div>
      <div class="title">${title}</div>
      <div class="authority">${authority}</div>
      <div class="grid">${rows(fields)}</div>
      <div class="footer">${footer}</div>
      ${glare ? '<div class="glare"></div>' : ''}
    </div></body></html>`;
}

const NON_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0 }
  .scene { width: 1012px; height: 638px; background: linear-gradient(#87b8e8 0%, #cfe3f5 58%, #6e8f5a 58%, #476b32 100%); position: relative; }
  .sun { position:absolute; top:70px; right:130px; width:120px; height:120px; border-radius:50%; background:#ffe9a8; }
  .hill { position:absolute; bottom:120px; left:-60px; width:520px; height:280px; border-radius:50%; background:#5f7f45; }
  .hill2 { position:absolute; bottom:150px; right:-80px; width:600px; height:300px; border-radius:50%; background:#6c8d4f; }
</style></head><body><div class="scene"><div class="sun"></div><div class="hill"></div><div class="hill2"></div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
mkdirSync(outDir, { recursive: true });

for (const fixture of manifest.fixtures) {
  if (fixture.kind === 'unsupported_file') {
    writeFileSync(path.join(outDir, fixture.file), fixture.textContent, 'utf8');
    console.log(`wrote ${fixture.file} (text)`);
    continue;
  }

  const html = fixture.kind === 'non_document'
    ? NON_DOCUMENT
    : sheet({ ...manifest.layouts[fixture.layout], glare: fixture.render?.glare });

  await page.setContent(html, { waitUntil: 'load' });
  const element = await page.$(fixture.kind === 'non_document' ? '.scene' : '.sheet');

  if (fixture.render?.blurPx) await element.evaluate((el, px) => { el.style.filter = `blur(${px}px)`; }, fixture.render.blurPx);
  if (fixture.render?.rotateDeg) {
    await page.evaluate((deg) => {
      document.body.style.padding = '90px';
      document.querySelector('.sheet').style.transform = `rotate(${deg}deg)`;
    }, fixture.render.rotateDeg);
  }

  const clip = fixture.render?.cropFraction
    ? await element.evaluate((el, fraction) => {
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: Math.round(box.height * fraction) };
    }, fixture.render.cropFraction)
    : undefined;

  const buffer = fixture.render?.rotateDeg
    ? await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 830 } })
    : await (clip ? page.screenshot({ clip }) : element.screenshot());

  writeFileSync(path.join(outDir, fixture.file), buffer);
  console.log(`wrote ${fixture.file} (${buffer.length} bytes)`);
}

await browser.close();
console.log(`\ncorpus written to ${path.relative(root, outDir)}`);
