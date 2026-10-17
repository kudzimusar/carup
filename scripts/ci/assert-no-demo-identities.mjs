#!/usr/bin/env node
/**
 * R14 (OC-5D) — a PRODUCTION web bundle carries no demo identity and no demo password.
 *
 * Hiding the demo buttons is not enough: the hard-coded password would still ship in the JavaScript.
 * Login.tsx defines the identities behind a build-time flag that vite.config.ts sets only for a
 * non-production Vercel environment, so a production build folds them out. This scans a built `dist`
 * directory for what must not be there.
 *
 * Usage: node scripts/ci/assert-no-demo-identities.mjs <distDir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const FORBIDDEN_IN_PRODUCTION = Object.freeze([
  'password123',
  'Quick Demo Access',
  'dealer@crocomoto.co.zw',
  'simba@garage.co.zw',
  // The owner demo identity. It could not be a needle while CustomerRecords hard-coded it as a
  // "customer" (it shipped in every build); that page now reads the garage's real customers, so the
  // only remaining copy is Login's, which a production build folds out. (Not the NAME: "Tendai
  // Moyo" is also a form placeholder, which is not an identity.)
  'tendai@email.co.zw',
]);

export function scanDist(distDir) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|html|css|json|map)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      for (const needle of FORBIDDEN_IN_PRODUCTION) {
        if (text.includes(needle)) hits.push({ file: path.relative(distDir, full), needle });
      }
    }
  };
  walk(distDir);
  return hits;
}

if (process.argv[1] && process.argv[1].endsWith('assert-no-demo-identities.mjs')) {
  const distDir = process.argv[2];
  if (!distDir) { process.stderr.write('usage: assert-no-demo-identities.mjs <distDir>\n'); process.exit(2); }
  const hits = scanDist(distDir);
  if (hits.length) {
    process.stderr.write(`R14: the production bundle carries demo identities:\n  ${hits.map((h) => `${h.file}: ${h.needle}`).join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`R14: no demo identity in the production bundle (${FORBIDDEN_IN_PRODUCTION.length} needles)\n`);
}
