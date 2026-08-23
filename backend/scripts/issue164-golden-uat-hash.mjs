#!/usr/bin/env node
/**
 * Issue #164 Phase 8 — offline credential hasher for the Golden UAT accounts.
 *
 * WHY THIS EXISTS
 * ---------------
 * `issue164-golden-uat-auth.mjs --mode=grant` needs a working staging credential to write the hash
 * itself. When the operator's local staging credentials are not usable, the hashing step can still be
 * performed offline — hashing needs no database at all — and only the RESULTING HASH needs to travel.
 *
 * That split is the point:
 *   · the plaintext password is typed once, into a hidden prompt. It is never echoed, never passed as
 *     an argument (so it cannot enter shell history or a process list), never written to disk, and
 *     never transmitted anywhere;
 *   · what leaves this process is a scrypt hash — a one-way digest that is safe to hand to the party
 *     applying it, exactly as it would sit in the database;
 *   · the hash is produced by the SAME governed `hashPassword` the registration path uses, so the
 *     resulting credential verifies through the real, unmodified login path. No bypass, no weakened
 *     check, no alternative hashing.
 *
 * The output file is created EXCLUSIVELY at 0600 (an existing path is refused, never overwritten or
 * followed through a symlink) and is intended to be deleted as soon as the hash has been applied.
 *
 *   node backend/scripts/issue164-golden-uat-hash.mjs --out=/tmp/golden-uat.hash
 */
import { openSync, fchmodSync, writeSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIN_LENGTH = 12;

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

/**
 * Read a line from the terminal without echoing it. Reads from stdin in raw mode so the characters
 * never appear on screen and never reach the shell — which is what keeps the password out of history,
 * out of `ps`, and out of any log.
 */
export function readHiddenLine(prompt, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      // Non-interactive: accept a single line on stdin (e.g. from a password manager) but still never
      // take it as an argument.
      let buf = '';
      input.setEncoding('utf8');
      input.on('data', (d) => { buf += d; });
      input.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      input.on('error', reject);
      return;
    }
    output.write(prompt);
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {        // Enter / EOT
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        resolve(value);
        return;
      }
      if (ch === '\u0003') {                                       // Ctrl-C
        input.setRawMode(false);
        output.write('\n');
        process.exit(130);
        return;
      }
      if (ch === '\u007f' || ch === '\b') {                        // Backspace
        value = value.slice(0, -1);
        return;
      }
      // Ignore other control characters; append printable input.
      if (ch >= ' ') value += ch;
    };
    input.on('data', onData);
  });
}

async function main() {
  const outArg = process.argv.find((a) => /^--out=/.test(a));
  if (!outArg) fail('pass --out=<path> so the hash is written to a file rather than printed');
  const outPath = outArg.split('=').slice(1).join('=');

  const password = await readHiddenLine('Choose the Golden UAT password (input hidden): ');
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    fail(`password must be at least ${MIN_LENGTH} characters (nothing was written)`);
  }
  const confirm = process.stdin.isTTY
    ? await readHiddenLine('Confirm password: ')
    : password;
  if (confirm !== password) fail('passwords did not match (nothing was written)');

  const { hashPassword } = await import('../utils/passwordAuth.js');
  const hash = await hashPassword(password);

  // Only the one-way hash is persisted, and the file must be owner-only FOR CERTAIN.
  //
  // `writeFileSync(path, data, { mode })` applies mode only when it CREATES the file. Writing over an
  // existing `/tmp/golden-uat.hash` left at 0644 would therefore land a credential-adjacent digest
  // world-readable, and a symlink planted at that path in a shared /tmp would be followed to wherever
  // it points. `wx` is the secure-create idiom: O_CREAT|O_EXCL fails if anything already exists at the
  // path — regular file, directory or symlink, dangling or not — so neither hazard is reachable.
  // fchmod on the open descriptor then pins 0600 regardless of umask.
  let fd;
  try {
    fd = openSync(outPath, 'wx', 0o600);
  } catch (e) {
    if (e?.code === 'EEXIST') {
      fail(`${outPath} already exists — remove it first rather than overwriting (its permissions and target cannot be trusted)`);
    }
    fail(`could not create ${outPath}: ${e?.message || e}`);
  }
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${hash}\n`, null, 'utf8');
  } finally {
    closeSync(fd);
  }

  // Deliberately no password, and no hash, in stdout.
  console.log(JSON.stringify({
    ok: true,
    wrote: outPath,
    scheme: hash.split(':')[0],
    note: 'plaintext password was never stored, echoed, or transmitted; delete this file once applied',
  }, null, 2));
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('issue164-golden-uat-hash.mjs'))) {
  main().catch((e) => fail(e?.message || String(e)));
}
