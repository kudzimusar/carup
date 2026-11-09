#!/usr/bin/env node
/**
 * The per-run, per-viewport Golden Seller identity for the Diaspora Deployed Staging UAT gate.
 *
 * Spec 38 measures a Seller's own inventory and inquiries. Run as the shared `uat.buyer` account,
 * it inherited every earlier run's history, so a count like "this Seller's inquiries" depended on
 * how many runs had come before (2026-09-13: KPI 140 against 26 observed; 2026-09-26: 144 against 2).
 * The Seller workflow already mints one Seller per run; this does the same for the gate, per
 * VIEWPORT, because the three shards run serially against the same database and would otherwise
 * inherit each other's inquiries.
 *
 * Both sides derive the same address from the aggregate run id and the project, so nothing is
 * transmitted between jobs: Bootstrap mints the three identities (it is the only job that touches
 * the database), and each shard computes its own address and uses the password it already derives.
 */
import { pathToFileURL } from 'node:url';

export const GATE_PROJECTS = Object.freeze({
  chromium: 'chromium',
  'tablet-chromium': 'tablet',
  'mobile-chromium': 'mobile',
});

/** `seller-<github_run_id>-<attempt>` — the aggregate run id the gate already uses for fixture_scope. */
const RUN_ID_SHAPE = /^seller-(\d+)-(\d+)$/;

export function goldenSellerIdentity(stagingRunId, project) {
  const match = RUN_ID_SHAPE.exec(String(stagingRunId || ''));
  if (!match) throw new Error(`staging run id must look like seller-<run>-<attempt>, got ${JSON.stringify(stagingRunId)}`);
  const short = GATE_PROJECTS[project];
  if (!short) throw new Error(`unknown gate project ${JSON.stringify(project)}`);
  const [, run, attempt] = match;
  return {
    id: `u_golden_${run}_${attempt}_${short}`,
    email: `golden.seller.${run}-${attempt}-${short}@carup-staging.test`,
    name: `Golden Dynamic Seller ${run}-${attempt} ${short} (staging automation)`,
    role: 'owner',
  };
}

export function goldenSellerIdentitiesForRun(stagingRunId) {
  return Object.keys(GATE_PROJECTS).map((project) => goldenSellerIdentity(stagingRunId, project));
}

// Shard use: print the email for GITHUB_ENV. `node golden-seller-identity.mjs <run-id> <project>`
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.stdout.write(`${goldenSellerIdentity(process.argv[2], process.argv[3]).email}\n`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
