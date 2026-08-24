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
 *   node backend/scripts/issue164-golden-uat-auth.mjs --mode=grant --hash-file=/tmp/golden-uat.hash
 *   GOLDEN_UAT_PASSWORD='...' node backend/scripts/issue164-golden-uat-auth.mjs --mode=grant
 *   node backend/scripts/issue164-golden-uat-auth.mjs --mode=revoke
 */
import { pathToFileURL } from 'node:url';

const MODE = (process.argv.find((a) => /^--mode=/.test(a)) || '--mode=status').split('=')[1];
const blocked = (m) => { console.error(`BLOCKED: ${m}`); process.exit(2); };
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const VALID_MODES = ['status', 'grant', 'revoke'];

/**
 * Validated only when this file is RUN, never on import — the same correction applied to
 * issue164-golden-vehicles.mjs. Module-scope arg parsing is what killed the grant path: an importer
 * carrying its own `--mode=` exits(2) here before reaching its own main(). Leaving the identical
 * construct in the script being repaired would just move the trap.
 */
function assertValidMode() {
  if (!VALID_MODES.includes(MODE)) blocked(`unknown --mode=${MODE}`);
}

// The exact set this script may ever touch. Hard-pinned: there is no account input, because an input
// is a lever, and a lever that sets credentials is exactly what should not exist.
// The four permitted identities, pinned as ID/EMAIL PAIRS.
//
// The ids were previously derived by filtering GOLDEN_USERS on this email list. That coupled the
// REVOCATION SET to the current email spelling: renaming an entry in code dropped its unchanged id
// out of the set, and since a granted credential outlives any deployment, the row it was granted to
// could never be cleared again. The id is the identity and must be pinned in its own right.
const GOLDEN_UAT_IDENTITIES = Object.freeze([
  { id: 'golden-a-owner-stg', email: 'golden-a-owner-stg@carup-staging.test', role: 'owner' },
  { id: 'golden-a-buyer-stg', email: 'golden-a-buyer-stg@carup-staging.test', role: 'owner' },
  { id: 'golden-b-owner-stg', email: 'golden-b-owner-stg@carup-staging.test', role: 'owner' },
  { id: 'golden-b-buyer-stg', email: 'golden-b-buyer-stg@carup-staging.test', role: 'owner' },
]);

const GOLDEN_UAT_ACCOUNTS = Object.freeze(GOLDEN_UAT_IDENTITIES.map((i) => i.email));
const GOLDEN_UAT_IDS = Object.freeze(GOLDEN_UAT_IDENTITIES.map((i) => i.id));

// Cardinality is asserted at load: a pair silently lost to an edit would shrink both the grant target
// and the revocation set, and the second failure is the dangerous one.
if (GOLDEN_UAT_IDENTITIES.length !== 4
  || new Set(GOLDEN_UAT_IDS).size !== 4
  || new Set(GOLDEN_UAT_ACCOUNTS).size !== 4) {
  blocked('the Golden UAT identity table must contain exactly four distinct id/email pairs');
}

async function main() {
  const { evaluateStagingGuard } = await import('./issue164-golden-vehicles.mjs');
  const guard = evaluateStagingGuard(process.env);
  if (!guard.ok) blocked(guard.reason);
  console.log(`staging identity OK: host=${guard.host}`);

  // Credential input is validated BEFORE any client is built or any row is read. A malformed
  // hash should cost the operator a fast refusal, not a database round-trip — and nothing should
  // reach the database on a run that was never going to be able to finish.
  let preHashed = null;
  if (MODE === 'grant') {
    // TWO ways to supply the credential, and they exist for different threat models.
    //
    //   --hash-file=<path>  the owner ran issue164-golden-uat-hash.mjs, which prompted once (hidden)
    //                       and wrote ONLY a one-way scrypt hash at mode 0600. This process reads that
    //                       file and writes it straight to password_hash. The plaintext never existed
    //                       outside the owner's prompt, and the HASH never passes through anyone
    //                       else's hands — notably not through an assistant's transcript or an MCP
    //                       tool call, which is exactly what this path exists to avoid.
    //
    //   GOLDEN_UAT_PASSWORD the original path: the plaintext is hashed here with the same governed
    //                       helper and never leaves the process.
    //
    // The hash file is preferred when someone other than the password's owner is driving the run.
    const hashFileArg = process.argv.find((a) => /^--hash-file=/.test(a));
    // Two credential sources is an ambiguity, and silently preferring one means the operator cannot
    // tell which credential was written. Refuse and make them choose.
    if (hashFileArg && process.env.GOLDEN_UAT_PASSWORD) {
      blocked('supply EITHER --hash-file or GOLDEN_UAT_PASSWORD, not both — refusing to guess which credential you meant');
    }
    // Assign to the OUTER `preHashed`. A `let` here would shadow it: the file would be read and
    // validated into a binding that dies with this block, and the write below would see null — the
    // credential path dead by construction, which is the exact defect class this change was fixing.
    if (hashFileArg) {
      const { readFileSync, lstatSync } = await import('node:fs');
      const hashPath = hashFileArg.split('=').slice(1).join('=');
      // The producer creates this file with O_EXCL at mode 0600 precisely so nobody else can plant or
      // read it. Honour that here: a symlink would let readFileSync be redirected, and a
      // group/world-readable or foreign-owned file is not the file the owner made.
      try {
        const st = lstatSync(hashPath);
        if (st.isSymbolicLink()) blocked('--hash-file is a symlink — refusing to follow it');
        if (!st.isFile()) blocked('--hash-file is not a regular file');
        if ((st.mode & 0o077) !== 0) blocked('--hash-file is group/world accessible — expected mode 0600');
        if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
          blocked('--hash-file is not owned by the current user — refusing to read it');
        }
      } catch (e) {
        if (e?.code) blocked(`could not stat --hash-file: ${e.code}`);
        throw e;
      }
      try {
        preHashed = readFileSync(hashPath, 'utf8').trim();
      } catch (e) {
        // The message names the ERROR, never the file's contents.
        blocked(`could not read --hash-file: ${e.code || 'unreadable'}`);
      }
      // Shape only. A hash is never printed, and a malformed one must not reach the column: a
      // password_hash that verifyPassword cannot parse locks the account out while LOOKING provisioned.
      if (!preHashed) blocked('--hash-file is empty');
      if (/\s/.test(preHashed)) blocked('--hash-file must contain exactly one hash and no whitespace');
      // Validate the FORMAT explicitly. `verifyPassword` returns false for a malformed hash exactly as
      // it does for a valid hash and a wrong password, so calling it proves nothing about the hash —
      // garbage sailed straight through that check. The governed format is produced by hashPassword:
      // `scrypt:<32-hex salt>:<hex derived key>`, and verifyPassword rejects anything else outright.
      // A password_hash the verifier cannot parse would lock the account out while LOOKING provisioned.
      // EXACT lengths, not "at least". hashPassword uses randomBytes(16) -> 32 hex salt and
      // SCRYPT_KEYLEN = 64 bytes -> 128 hex key, always; verifyPassword compares buffers of equal
      // length and returns false otherwise. A `{64,}` lower bound accepted a TRUNCATED key, which is
      // precisely the "locked out while LOOKING provisioned" state this check exists to prevent.
      const [scheme, salt, derived] = preHashed.split(':');
      if (scheme !== 'scrypt' || !/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(derived || '')) {
        blocked('--hash-file is not a governed scrypt hash (expected scrypt:<32-hex salt>:<128-hex key>) — refusing to write it');
      }
    } else {
      // No hash file: the plaintext path, validated here for the same reason — before any DB access.
      const password = process.env.GOLDEN_UAT_PASSWORD;
      if (!password) blocked('supply --hash-file=<path> or GOLDEN_UAT_PASSWORD (never hardcode or commit it)');
      if (password.length < 12) blocked('GOLDEN_UAT_PASSWORD must be at least 12 characters');
    }
  }

  // Reported from the SAME binding the write below reads, and BEFORE any database access.
  //
  // That placement is the whole point. A `let` inside the validation block would shadow this binding,
  // leaving the file read, validated — and discarded. Logging the source from the inner scope would
  // still have said "hash-file" while the write saw null, so the log would have corroborated a broken
  // path. Read here, it goes wrong exactly when the credential does, and a dummy key still reaches it.
  if (MODE === 'grant') console.log(`credential source: ${preHashed ? 'hash-file' : 'env'}`);

  const { supabase } = await import('../db/supabase.js');
  const { hashPassword } = await import('../utils/passwordAuth.js');

  // Every account must already exist as a synthetic Golden fixture row. This script provisions a
  // credential for an existing identity; it never creates a user, and never touches a non-fixture one.
  // Read by BOTH the pinned emails AND the deterministic fixture ids.
  //
  // Loading by email alone made drift invisible in the one direction that matters most: if a granted
  // fixture's EMAIL changes, the row is absent from an email-keyed read, so `revoke` reports it
  // missing and the shared UAT hash stays live on it. And if that pinned email was meanwhile
  // reassigned to a different user, the same email-keyed path would clear THAT user's password
  // instead. Identity here is the id — the email is a label on it.
  const [byEmail, byId] = await Promise.all([
    supabase.from('users').select('id, email, role, password_hash').in('email', GOLDEN_UAT_ACCOUNTS),
    supabase.from('users').select('id, email, role, password_hash').in('id', GOLDEN_UAT_IDS),
  ]);
  if (byEmail.error) fail(`users read failed: ${byEmail.error.message}`);
  if (byId.error) fail(`users read by id failed: ${byId.error.message}`);
  const found = [...new Map([...(byEmail.data || []), ...(byId.data || [])]
    .map((r) => [r.id, r])).values()];
  // GRANT only — for the same reason the role check is. A previously granted fixture row that has been
  // renamed to a non-synthetic address (or whose email is now null) still holds the shared UAT hash,
  // and an unconditional refusal here would exit before `revoke` could clear it. Provisioning a
  // credential onto such a row is forbidden; REMOVING one from it is exactly what we want to allow.
  const nonSynthetic = found.filter((r) => !/@carup-staging\.test$/.test(r.email || ''));
  if (MODE === 'grant' && nonSynthetic.length > 0) {
    blocked('refusing to provision: a pinned identity no longer carries a @carup-staging.test address:\n  '
      + nonSynthetic.map((r) => `${r.id}`).join('\n  '));
  }
  if (nonSynthetic.length > 0) {
    console.warn(`[carup] ${nonSynthetic.length} pinned identity/identities no longer carry a `
      + `@carup-staging.test address (${MODE} continues so the credential can be cleared)`);
  }

  // IDENTITY AND ROLE, not just the address.
  //
  // Matching on email alone means a staging row that has DRIFTED still receives the shared UAT
  // credential — and `POST /api/auth/login` copies `users.role` straight into the session. A pinned
  // address whose role had become `admin` would turn an owner/buyer grant into an administrator
  // login. The Golden identities are deterministic (id and role are fixtures, not observations), so
  // both are required to match, and ANY mismatch fails the whole grant rather than skipping a row.
  // THE INVARIANT: every id that can RECEIVE this credential must already be in the set that can
  // REVOKE it. Building `expected` from the mutable GOLDEN_USERS broke that — if a Golden user's id
  // changed while its email stayed (e.g. before bootstrapping a fresh staging database), grant
  // accepted and provisioned the NEW id while revoke went on iterating the pinned OLD ids and
  // reported that identity absent. The credential would have been unclearable. One table is
  // authoritative for both operations.
  const expected = new Map(GOLDEN_UAT_IDENTITIES.map((i) => [i.email, { id: i.id, role: i.role }]));
  const drifted = [];
  for (const row of found) {
    const want = expected.get(row.email);
    if (!want) { drifted.push(`${row.email}: not a known Golden identity`); continue; }
    if (row.id !== want.id) drifted.push(`${row.email}: id is not the deterministic fixture id`);
    if (row.role !== want.role) drifted.push(`${row.email}: role is '${row.role}', expected '${want.role}'`);
  }
  // GRANT only. Applying this to every mode was backwards: if a row drifts to a privileged role AFTER
  // a credential was granted, refusing `revoke` would leave the shared UAT password ACTIVE on exactly
  // the account that most needs it cleared. `status` must stay diagnostic for the same reason — you
  // cannot investigate drift with a command that refuses to run because of it.
  if (MODE === 'grant' && drifted.length > 0) {
    blocked(`Golden identities have drifted — refusing to provision any credential:\n  ${drifted.join('\n  ')}`);
  }
  if (drifted.length > 0) {
    console.warn(`[carup] identity drift detected (${MODE} continues):\n  ${drifted.join('\n  ')}`);
  }

  if (MODE === 'status') {
    const report = GOLDEN_UAT_ACCOUNTS.map((email, index) => {
      // Resolve by id FIRST so a renamed row is still reported against its fixture identity.
      const row = found.find((r) => r.id === GOLDEN_UAT_IDS[index]) || found.find((r) => r.email === email);
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
    // All four pinned identities must exist BEFORE anything is written. Provisioning three of four and
    // exiting 0 would report success while the documented UAT logins cannot all run — a partial grant
    // is not a grant. Missing identities mean the Phase 7 fixture has not been bootstrapped.
    const missing = GOLDEN_UAT_IDENTITIES
      .filter((i) => !found.some((r) => r.id === i.id))
      .map((i) => `${i.email} (${i.id})`);
    if (missing.length > 0) {
      fail(`missing Golden identities on staging: ${missing.join(', ')} — run the Golden Vehicles fixture (mode=bootstrap) first`);
    }
    const results = [];
    for (const identity of GOLDEN_UAT_IDENTITIES) {
      const { id: pinnedId, email } = identity;
      // Matched AND written by the pinned id. Writing the discovered `row.id` is what allowed grant
      // and revoke to diverge; the drift check above has already refused any mismatch, so by the time
      // we are here the pinned id IS the row's id.
      const row = found.find((r) => r.id === pinnedId);
      if (!row) { results.push({ email, userId: pinnedId, action: 'skipped', reason: 'identity does not exist on staging' }); continue; }
      // Hashed with the SAME governed helper the registration path uses; the plaintext never leaves
      // this process and is not returned, logged or persisted. When a pre-computed hash was supplied,
      // it is written verbatim — it was produced by this same helper on the owner's machine.
      const password_hash = preHashed ?? await hashPassword(password);
      const { error: updErr } = await supabase.from('users').update({ password_hash }).eq('id', pinnedId);
      if (updErr) {
        // There is no transaction across four single-row updates, so a mid-loop failure leaves a
        // PARTIAL grant. Exiting without saying which rows were already written would leave the
        // operator unable to reason about the state. (`fail` exits 1, so a partial grant can never
        // exit 0.)
        console.error(JSON.stringify({
          mode: 'grant', outcome: 'partial', alreadyWritten: results.map((r) => r.email), failedAt: email,
        }, null, 2));
        fail(`credential update failed for ${email}: ${updErr.message}`);
      }
      results.push({ email, userId: pinnedId, role: row.role, action: 'credential_set' });
    }
    // Deliberately no password in the receipt.
    console.log(JSON.stringify({
      mode: 'grant', accounts: results,
      credentialSource: preHashed ? 'hash-file' : 'env',
      // Keep this exact phrase: the security test strips it before asserting that the word never
      // appears inside a console.log, and rewording it silently defeats that check.
      note: 'password not recorded',
      hashRecorded: false,
    }, null, 2));
    return;
  }

  if (MODE === 'revoke') {
    // Keyed on the DETERMINISTIC ID. Revocation must not be defeated by a renamed row, and must never
    // reach a different user who happens to hold a pinned address now.
    const results = [];
    for (const userId of GOLDEN_UAT_IDS) {
      const row = found.find((r) => r.id === userId);
      if (!row) { results.push({ userId, action: 'skipped', reason: 'absent' }); continue; }
      const { error: updErr } = await supabase.from('users').update({ password_hash: null }).eq('id', userId);
      if (updErr) fail(`credential revoke failed for ${userId}: ${updErr.message}`);
      results.push({ userId, email: row.email, action: 'credential_cleared' });
    }
    // A pinned EMAIL that now resolves to a row outside the fixture id set is reported, never touched.
    const foreign = found.filter((r) => !GOLDEN_UAT_IDS.includes(r.id));
    console.log(JSON.stringify({
      mode: 'revoke', accounts: results,
      unrelatedRowsHoldingAPinnedEmail: foreign.map((r) => ({ userId: r.id, email: r.email })),
    }, null, 2));
  }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('issue164-golden-uat-auth.mjs'))) {
  assertValidMode();
  main().catch((e) => fail(e?.stack || e?.message || String(e)));
}

export { GOLDEN_UAT_ACCOUNTS };
