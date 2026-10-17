import { defineConfig } from '@playwright/test';
import staging from './playwright.staging.config';

/**
 * Spec 48's OWN deployed-staging config (OC-5F slice F): the staging harness unchanged, narrowed to
 * spec 48.
 *
 * Spec 48 is deliberately NOT in playwright.staging.config.ts's testMatch. That config's comments
 * call each addition "additive" because certified gates name their spec on the command line, but
 * the aggregate Diaspora gates (diaspora-deployed-staging-shard.yml,
 * diaspora-canonical-staging-uat.yml) run its testMatch WHOLE, and the chromium shard measured
 * ~29.7 of its 35 minutes. Adding a journey there changes what a certified gate runs. Run by
 * .github/workflows/seller-home-lifecycle-staging-uat.yml only.
 */
export default defineConfig({
  ...staging,
  testMatch: /48-seller-home-comms-lifecycle-staging\.spec\.ts/,
});
