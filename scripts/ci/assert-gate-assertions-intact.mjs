#!/usr/bin/env node
/**
 * The deployed-staging gate's assertions must MATTER.
 *
 * Repairing that gate proved its infrastructure — it refuses an ungoverned or stale pairing, and
 * eight mutations of those refusals go red. That is only half of what an integration gate has to
 * demonstrate. The other half is that its PRODUCT assertions are load-bearing: weakening one has to
 * be noticed by something.
 *
 * Proving that by re-running the suite is not available in ordinary CI — the specs drive deployed
 * staging, take ~30 minutes on one viewport, and cannot run concurrently with another run without
 * rotating its identities out from under it. So the load-bearing assertions are PINNED here, and
 * this runs in seconds alongside the unit suites.
 *
 * This is deliberately narrow. It pins the handful of assertions that carry the security, T5 and T2
 * invariants — not the whole file — so ordinary maintenance stays possible and a silent weakening
 * does not.
 */
import { readFileSync } from 'node:fs';

const PINS = [
  {
    file: 'tests/agents/34-diaspora-staging-browser-security.spec.ts',
    why: 'anonymous denial + no record payload. A 404 alone is never authorization evidence.',
    require: [
      /expect\(\[401, 403, 404\], `\$\{p\} must deny anonymous access/,
      /must not leak record data`\)\.not\.toMatch\(/,
      /spoofed x-stakeholder-role must not grant reviewer power'\)\.not\.toBe\(200\)/,
      /a refused verify must not leak profile data'\)\.not\.toMatch\(/,
    ],
    forbid: [
      // Denial must never be satisfied by a 2xx appearing in the accepted set.
      /toContain\(res\.status\(\)\)[\s\S]{0,40}200/,
    ],
  },
  {
    file: 'tests/agents/45-trade-os-container-demo-staging.spec.ts',
    why: 'T5 invariants: capacity is asserted positively, overfill is denied, cross-tenant is denied.',
    require: [
      /overfill is atomically denied at approval and capacity is unchanged/,
      /getByTestId\('diaspora-container-reserve-error'\)\)\.toContainText\(\/overfill\/i\)/,
      /getByTestId\('diaspora-container-capacity-line'\)\)\.toContainText\('Used 22\/60'\)/,
      /cross-tenant denial: a rival tenant admin cannot see, approve or close this container/,
    ],
    forbid: [/capacity-line'\)\)\.not\.toContainText/],
  },
  {
    file: 'tests/agents/46-trade-os-rfq2-staging.spec.ts',
    why: 'T2 authority: creation is a 201, and a second differing acceptance is refused.',
    require: [
      /expect\(createdRes\.status\(\)\)\.toBe\(201\)/,
      /SECURITY: the award is atomic — a second, different acceptance is refused/,
      /SECURITY: a supplier in ANOTHER tenant discovers it, and sees no private buyer data/,
    ],
    forbid: [/expect\(\[200, 201, 202\]\)\.toContain\(createdRes\.status\(\)\)/],
  },
];

let failed = 0;
for (const pin of PINS) {
  const source = readFileSync(pin.file, 'utf8');
  for (const rx of pin.require) {
    if (!rx.test(source)) {
      console.error(`WEAKENED  ${pin.file}\n  missing: ${rx}\n  why it matters: ${pin.why}`);
      failed += 1;
    }
  }
  for (const rx of pin.forbid) {
    if (rx.test(source)) {
      console.error(`WEAKENED  ${pin.file}\n  forbidden shape present: ${rx}\n  why it matters: ${pin.why}`);
      failed += 1;
    }
  }
}
if (failed) {
  console.error(`\n${failed} load-bearing deployed-gate assertion(s) were weakened.`);
  process.exit(1);
}
console.log(`gate assertions intact: ${PINS.length} suites pinned`);
