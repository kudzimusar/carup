#!/usr/bin/env node
/**
 * Issue #164 Phase 8 — minimum staging-only authentication for Golden Vehicle UAT.
 *
 * WHY THIS EXISTS
 * ---------------
 * §12 requires the Golden A/B journey to be walked as an AUTHENTICATED Owner as well as an anonymous
 * Buyer. The Golden identities already exist at application level (`golden-a-owner-stg` etc., created
 * by the Phase 7 fixture) but were provisioned without a credential, so nobody can sign in as them.
 *
 * HOW IDENTITY WORKS HERE (documented before provisioning, as required)
 * --------------------------------------------------------------------
 * CarUp does NOT use Supabase Auth for application login. There is no `auth.users` row, no Auth UUID,
 * and therefore no Auth-UUID -> application-user bridge to build. The governed path is entirely
 * application-level:
 *
 *     POST /api/auth/login  (backend/server.js)
 *       -> SELECT id, name, email, phone, role, password_hash FROM public.users WHERE email = ?
 *       -> evaluateLoginCredentials({ user, password })      (backend/utils/passwordAuth.js)
 *            · user.password_hash present -> verifyPassword(password, hash)   [scrypt]
 *            · no hash + passwordless allowed (dev only) -> legacy path
 *            · otherwise -> { ok: false, reason: 'password_not_set' }         <- today's Golden users
 *       -> INSERT INTO public.user_sessions (real session token, no mock)
 *
 * So `users.id` IS the application identity, and the ONLY thing standing between the Golden owner and
 * a real session is an unset `password_hash`. The minimum provisioning is therefore to set that hash
 * on the EXISTING Golden rows through the same `hashPassword` the registration path uses. That:
 *   · preserves the Golden application identities exactly (same ids, same emails, same roles);
 *   · introduces no new identity, no bridge table, and no change to the Golden truth model;
 *   · uses the real, unmodified login path — no auth bypass, no `x-user-id` shortcut, no weakened
 *     credential check, no `ALLOW_PASSWORDLESS` toggle;
 *   · is removable: `--mode=revoke` clears the hash again, returning the accounts to unusable.
 *
 * SECRET HANDLING
 * ---------------
 * The password is read from the environment (`GOLDEN_UAT_PASSWORD`) and is never written to disk,
 * never printed, never included in a receipt, and never committed. Only the scrypt hash reaches the
 * database. `--mode=status` reports whether each account CAN authenticate, never any credential.
 *
 * Staging only: the same exact-host guard as the Golden fixture runner; the production ref is refused.
 *
 *   node backend/scripts/issue164-golden-uat-auth.mjs --mode=status
 *   GOLDEN_UAT_PASSWORD='...' node backend/scripts/issue164-golden-uat-auth.mjs --mode=grant
 *   node backend/scripts/issue164-golden-uat-auth.mjs --mode=revoke
 */
import { pathToFileURL } from 'node:url';

const MODE = (process.argv.find((a) => /^--mode=/.test(a)) || '--mode=status').split('=')[1];
const blocked = (m) => { console.error(`BLOCKED: ${m}`); process.exit(2); };
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

if (!['status', 'grant', 'revoke'].includes(MODE)) blocked(`unknown --mode=${MODE}`);

// The exact set this script may ever touch. Hard-pinned: there is no account input, because an input
// is a lever, and a lever that sets credentials is exactly what should not exist.
const GOLDEN_UAT_ACCOUNTS = Object.freeze([
  'golden-a-owner-stg@carup-staging.test',
  'golden-a-buyer-stg@carup-staging.test',
  'golden-b-owner-stg@carup-staging.test',
  'golden-b-buyer-stg@carup-staging.test',
]);

async function main() {
  const { evaluateStagingGuard } = await import('./issue164-golden-vehicles.mjs');
  const guard = evaluateStagingGuard(process.env);
  if (!guard.ok) blocked(guard.reason);
  console.log(`staging identity OK: host=${guard.host}`);

  const { supabase } = await import('../db/supabase.js');
  const { hashPassword } = await import('../utils/passwordAuth.js');

  // Every account must already exist as a synthetic Golden fixture row. This script provisions a
  // credential for an existing identity; it never creates a user, and never touches a non-fixture one.
  const { data: rows, error } = await supabase
    .from('users').select('id, email, role, password_hash').in('email', GOLDEN_UAT_ACCOUNTS);
  if (error) fail(`users read failed: ${error.message}`);
  const found = rows || [];
  for (const row of found) {
    if (!/@carup-staging\.test$/.test(row.email || '')) {
      blocked(`refusing to touch ${row.email}: not a @carup-staging.test synthetic fixture identity`);
    }
  }

  if (MODE === 'status') {
    const report = GOLDEN_UAT_ACCOUNTS.map((email) => {
      const row = found.find((r) => r.email === email);
      return {
        email,
        exists: !!row,
        userId: row?.id ?? null,
        role: row?.role ?? null,
        // Whether a credential is set — never the credential itself.
        canAuthenticate: !!row?.password_hash,
      };
    });
    console.log(JSON.stringify({ mode: 'status', accounts: report }, null, 2));
    return;
  }

  if (MODE === 'grant') {
    const password = process.env.GOLDEN_UAT_PASSWORD;
    if (!password) blocked('GOLDEN_UAT_PASSWORD is not set (never hardcode or commit it)');
    if (password.length < 12) blocked('GOLDEN_UAT_PASSWORD must be at least 12 characters');
    const results = [];
    for (const email of GOLDEN_UAT_ACCOUNTS) {
      const row = found.find((r) => r.email === email);
      if (!row) { results.push({ email, action: 'skipped', reason: 'identity does not exist on staging' }); continue; }
      // Hashed with the SAME governed helper the registration path uses; the plaintext never leaves
      // this process and is not returned, logged or persisted.
      const password_hash = await hashPassword(password);
      const { error: updErr } = await supabase.from('users').update({ password_hash }).eq('id', row.id);
      if (updErr) fail(`credential update failed for ${email}: ${updErr.message}`);
      results.push({ email, userId: row.id, role: row.role, action: 'credential_set' });
    }
    // Deliberately no password in the receipt.
    console.log(JSON.stringify({ mode: 'grant', accounts: results, note: 'password not recorded' }, null, 2));
    return;
  }

  if (MODE === 'revoke') {
    const results = [];
    for (const email of GOLDEN_UAT_ACCOUNTS) {
      const row = found.find((r) => r.email === email);
      if (!row) { results.push({ email, action: 'skipped', reason: 'absent' }); continue; }
      const { error: updErr } = await supabase.from('users').update({ password_hash: null }).eq('id', row.id);
      if (updErr) fail(`credential revoke failed for ${email}: ${updErr.message}`);
      results.push({ email, userId: row.id, action: 'credential_cleared' });
    }
    console.log(JSON.stringify({ mode: 'revoke', accounts: results }, null, 2));
  }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('issue164-golden-uat-auth.mjs'))) {
  main().catch((e) => fail(e?.stack || e?.message || String(e)));
}

export { GOLDEN_UAT_ACCOUNTS };
